"""Bake GVHMR world rotations and root trajectory onto the supplied Mixamo FBX.

Blender --background --python-exit-code 1 --python scripts/gvhmr_retarget.py
-- --input video.gvhmr.npz --character character.fbx --output video.gvhmr.fbx
"""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

# SMPL-X's first 22 joints, in parent-before-child order.
MAPPING = ['Hips', 'LeftUpLeg', 'RightUpLeg', 'Spine', 'LeftLeg', 'RightLeg',
           'Spine1', 'LeftFoot', 'RightFoot', 'Spine2', 'LeftToeBase', 'RightToeBase',
           'Neck', 'LeftShoulder', 'RightShoulder', 'Head', 'LeftArm', 'RightArm',
           'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand']


def short(name):
    return name.rsplit(':', 1)[-1].removeprefix('mixamorig')


def load_character(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(path), automatic_bone_orientation=False)
    rig, = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    for obj in bpy.context.scene.objects:
        obj.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    for bone in rig.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    bones = {short(b.name): b for b in rig.pose.bones}
    missing = set(MAPPING) - bones.keys()
    if missing:
        raise ValueError(f'Missing Mixamo bones: {missing}')
    return rig, bones


def world(rig, bone):
    return rig.matrix_world @ bone.matrix


def bake(data, character):
    rotations = data['rotations_global']
    joints = data['joints_global']
    rest_joints = data['rest_joints']
    duration, fps = float(data['duration']), float(data['fps'])
    if rotations.shape != (len(joints), 22, 3, 3) or joints.shape[1:] != (22, 3):
        raise ValueError('Expected matching SMPL-X 22-joint world rotations and positions')
    if not all(np.isfinite(a).all() for a in [rotations, joints, rest_joints]):
        raise ValueError('Nonfinite motion data')
    if duration <= 0 or fps <= 0 or abs(len(joints) - math.ceil(duration * fps - 1e-7)) > 0:
        raise ValueError('Motion does not cover the full source duration')
    rig, bones = load_character(character)
    rest_world = {name: world(rig, bone).copy() for name, bone in bones.items()}
    # GVHMR is Y-up, Blender is Z-up. SMPL-X and Mixamo both face +Z
    # in their canonical Y-up rest space.
    conversion = Quaternion((1, 0, 0), math.pi / 2)
    initial_heading = math.atan2(float(rotations[0, 0, 0, 2]), float(rotations[0, 0, 2, 2]))
    heading_alignment = Quaternion((0, 1, 0), -initial_heading)
    source_leg = sum(np.linalg.norm(rest_joints[a] - rest_joints[b]) for a, b in [(1, 4), (4, 7)])
    target_leg = sum((rest_world[a].translation - rest_world[b].translation).length
                     for a, b in [('LeftUpLeg', 'LeftLeg'), ('LeftLeg', 'LeftFoot')])
    scale = target_leg / source_leg
    origin = Vector((float(joints[0, 0, 0]), 0, float(joints[0, 0, 2])))
    scene = bpy.context.scene
    scene.render.fps = round(fps)
    scene.render.fps_base = round(fps) / fps
    steps = math.ceil(duration * fps - 1e-7)
    scene.frame_start, scene.frame_end = 0, steps
    # Exact duration is represented by a fractional final frame. All preceding
    # samples retain the inference cadence; the final pose holds to the endpoint.
    times = list(np.arange(len(joints)) / fps) + [duration]
    previous = {}
    min_foot_z = float('inf')
    root_locations = []
    samples = []
    sample_indices = set(np.linspace(0, len(times) - 1, min(9, len(times)), dtype=int).tolist())
    for i, t in enumerate(times):
        frame = float(t * fps)
        scene.frame_set(math.floor(frame), subframe=frame % 1)
        idx = min(i, len(joints) - 1)
        for source_index, name in enumerate(MAPPING):
            bone = bones[name]
            delta = Matrix(rotations[idx, source_index].tolist()).to_quaternion()
            rotation = conversion @ heading_alignment @ delta @ conversion.inverted() @ rest_world[name].to_quaternion()
            current = world(rig, bone)
            position = current.translation
            if name == 'Hips':
                position = conversion @ heading_alignment @ ((Vector(joints[idx, 0].tolist()) - origin) * scale)
            bone.matrix = rig.matrix_world.inverted() @ Matrix.LocRotScale(position, rotation, current.to_scale())
            if name != 'Hips':
                bone.location = (0, 0, 0)
            bone.scale = (1, 1, 1)
            q = bone.rotation_quaternion.copy()
            if name in previous and previous[name].dot(q) < 0:
                q.negate()
            bone.rotation_quaternion = q
            previous[name] = q
            bpy.context.view_layer.update()
            bone.keyframe_insert('rotation_quaternion', frame=frame, group=bone.name)
            if name == 'Hips':
                bone.keyframe_insert('location', frame=frame, group=bone.name)
                root_locations.append((frame, bone.location.copy()))
        min_foot_z = min(min_foot_z, *(world(rig, bones[name]).translation.z
                                      for name in ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']))
        if i % 100 == 0:
            print(f'Retarget {i}/{len(times)}', flush=True)
    # One constant floor offset preserves jumps and the recovered trajectory.
    mesh_floor = min((obj.matrix_world @ vertex.co).z for obj in scene.objects if obj.type == 'MESH'
                     for vertex in obj.data.vertices)
    rest_foot_z = min(rest_world[name].translation.z for name in ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'])
    floor_offset = (rest_foot_z - mesh_floor) - min_foot_z
    hips = bones['Hips']
    root_rest_world = rig.matrix_world @ hips.bone.matrix_local
    local_offset = root_rest_world.to_3x3().inverted() @ Vector((0, 0, floor_offset))
    for frame, location in root_locations:
        hips.location = location + local_offset
        hips.keyframe_insert('location', frame=frame, group=hips.name)
    action = rig.animation_data.action
    action.name = 'GVHMR full video'
    for curve in action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = 'LINEAR'
    for i in sorted(sample_indices):
        frame = float(times[i] * fps)
        scene.frame_set(math.floor(frame), subframe=frame % 1)
        bpy.context.view_layer.update()
        samples.append(dict(time=times[i], bones={name: [list(row) for row in world(rig, bones[name])] for name in MAPPING}))
    return rig, dict(duration=duration, inference_frames=len(joints), keyed_samples=len(times),
                     fps=fps, translation_scale=scale, floor_offset=floor_offset,
                     initial_heading_alignment_degrees=-math.degrees(initial_heading),
                     controlled_bones=MAPPING, samples=samples)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--character', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    data = np.load(args.input, allow_pickle=False)
    rig, report = bake(data, args.character.resolve())
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.objects:
        if obj.type in {'ARMATURE', 'MESH'}:
            obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    output = args.output.resolve()
    temp = output.with_name(output.stem + '.partial.fbx')
    endpoint = report['duration'] * report['fps']
    step = endpoint / math.ceil(endpoint - 1e-7)
    bpy.ops.export_scene.fbx(filepath=str(temp), use_selection=True, object_types={'ARMATURE', 'MESH'},
                            add_leaf_bones=False, bake_anim=True, bake_anim_use_all_bones=True,
                            bake_anim_use_nla_strips=False, bake_anim_use_all_actions=True,
                            bake_anim_force_startend_keying=True, bake_anim_step=step,
                            bake_anim_simplify_factor=0, path_mode='COPY', embed_textures=True,
                            axis_forward='-Z', axis_up='Y')
    temp.replace(output)
    # Reimport the deliverable and compare timing and sampled world transforms.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = round(report['fps'])
    bpy.ops.import_scene.fbx(filepath=str(output), automatic_bone_orientation=False)
    imported, = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    bones = {short(b.name): b for b in imported.pose.bones}
    action = imported.animation_data.action
    actual_duration = float(action.frame_range[1] - action.frame_range[0]) / report['fps']
    max_pos_error, max_angle_error = 0., 0.
    for sample in report['samples']:
        frame = sample['time'] * report['fps'] + action.frame_range[0]
        bpy.context.scene.frame_set(math.floor(frame), subframe=frame % 1)
        bpy.context.view_layer.update()
        for name, rows in sample['bones'].items():
            expected, actual = Matrix(rows), world(imported, bones[name])
            max_pos_error = max(max_pos_error, (expected.translation - actual.translation).length)
            angle = expected.to_quaternion().rotation_difference(actual.to_quaternion()).angle
            max_angle_error = max(max_angle_error, min(angle, 2 * math.pi - angle))
    report['validation'] = dict(exported_duration=actual_duration, max_position_error_m=max_pos_error,
                                max_rotation_error_degrees=math.degrees(max_angle_error))
    report.pop('samples')
    output.with_suffix('.validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2), flush=True)
    if abs(actual_duration - report['duration']) > 0.001 or max_pos_error > 0.01 or math.degrees(max_angle_error) > 2:
        raise RuntimeError('FBX round-trip validation failed; see validation JSON')


if __name__ == '__main__':
    main()
