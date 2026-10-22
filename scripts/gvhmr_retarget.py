"""Bake GVHMR motion onto a Mixamo-named FBX, centered and grounded by default.

Blender --background --python-exit-code 1 --python scripts/gvhmr_retarget.py
-- --input video.gvhmr.npz --character character.fbx --output video.gvhmr.fbx
"""
import argparse
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gvhmr_root_motion import floor_drift

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


def export_fbx(path, rig, report):
    """Sample original keys plus the fractional endpoint in Blender 4.2's exporter.

    Its uniform arange grid otherwise either omits the endpoint or shifts every
    source sample when the step is shortened to fit the clip. Keep the workaround
    local to the export module and fail if its sampling implementation changes.
    """
    import io_scene_fbx.export_fbx_bin as exporter
    start, end = map(float, rig.animation_data.action.frame_range)
    frames = np.arange(report['inference_frames'] + 1, dtype=float)
    frames[-1] = end

    class SamplingNumpy:
        calls = 0

        def __getattr__(self, name):
            return getattr(np, name)

        def arange(self, *args, **kwargs):
            if (len(args) == 2 and args[0] == start and args[1] == np.nextafter(end, np.inf)
                    and kwargs == {'step': 1.0}):
                self.calls += 1
                return frames.copy()
            return np.arange(*args, **kwargs)

    proxy = SamplingNumpy()
    original = exporter.np
    try:
        exporter.np = proxy
        bpy.ops.export_scene.fbx(filepath=str(path), use_selection=True, object_types={'ARMATURE', 'MESH'},
                                add_leaf_bones=False, bake_anim=True, bake_anim_use_all_bones=True,
                                bake_anim_use_nla_strips=False, bake_anim_use_all_actions=True,
                                bake_anim_force_startend_keying=True, bake_anim_step=1,
                                bake_anim_simplify_factor=0, path_mode='COPY', embed_textures=True,
                                axis_forward='-Z', axis_up='Y')
    finally:
        exporter.np = original
    if proxy.calls != 1:
        raise RuntimeError('Unsupported Blender FBX sampling implementation; expected one animation grid')


def bake(data, character, root_motion='in-place'):
    if root_motion not in {'in-place', 'travel'}:
        raise ValueError('root_motion must be in-place or travel')
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
    root_positions = joints[:, 0].copy()
    vertical_drift = floor_drift(joints, fps) if root_motion == 'in-place' else np.zeros(len(joints))
    root_positions[:, 1] -= vertical_drift
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
    rotation_keys = {name: [] for name in MAPPING}
    min_foot_z = float('inf')
    root_locations = []
    samples = []
    sample_indices = set(np.linspace(0, len(times) - 1, min(9, len(times)), dtype=int).tolist())
    for i, t in enumerate(times):
        frame = float(t * fps)
        idx = min(i, len(joints) - 1)
        for source_index, name in enumerate(MAPPING):
            bone = bones[name]
            delta = Matrix(rotations[idx, source_index].tolist()).to_quaternion()
            rotation = conversion @ heading_alignment @ delta @ conversion.inverted() @ rest_world[name].to_quaternion()
            current = world(rig, bone)
            position = current.translation
            if name == 'Hips':
                position = conversion @ heading_alignment @ ((Vector(root_positions[idx].tolist()) - origin) * scale)
                # Center every frame in world space, before converting into the
                # rig's local rest axes. Retain floor-relative height and turns.
                if root_motion == 'in-place':
                    position.x = position.y = 0
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
            rotation_keys[name].append(tuple(q))
            if name == 'Hips':
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
    # Build curves in one pass. Inserting keys during solving repeatedly evaluates
    # the growing action and makes full-length music videos unnecessarily slow.
    rig.animation_data_create()
    action = bpy.data.actions.new('GVHMR full video')
    rig.animation_data.action = action
    frames = np.asarray(times) * fps

    def add_curves(bone, prop, values):
        values = np.asarray(values)
        for axis in range(values.shape[1]):
            curve = action.fcurves.new(bone.path_from_id(prop), index=axis, action_group=bone.name)
            curve.keyframe_points.add(len(frames))
            curve.keyframe_points.foreach_set('co', np.column_stack((frames, values[:, axis])).ravel())
            for key in curve.keyframe_points:
                key.interpolation = 'LINEAR'
            curve.update()

    for name in MAPPING:
        add_curves(bones[name], 'rotation_quaternion', rotation_keys[name])
    add_curves(hips, 'location', [location + local_offset for _, location in root_locations])
    for i in sorted(sample_indices):
        frame = float(times[i] * fps)
        scene.frame_set(math.floor(frame), subframe=frame % 1)
        bpy.context.view_layer.update()
        samples.append(dict(time=times[i], bones={name: [list(row) for row in world(rig, bones[name])] for name in MAPPING}))
    return rig, dict(duration=duration, inference_frames=len(joints), keyed_samples=len(times),
                     root_motion=root_motion,
                     vertical_grounding='3s lower-envelope' if root_motion == 'in-place' else 'original',
                     removed_vertical_drift_range_m=float(np.ptp(vertical_drift) * scale),
                     fps=fps, translation_scale=scale, floor_offset=floor_offset,
                     initial_heading_alignment_degrees=-math.degrees(initial_heading),
                     controlled_bones=MAPPING, samples=samples)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--character', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--root-motion', choices=['in-place', 'travel'], default='in-place',
                        help='Center hips horizontally every frame, or preserve recovered travel')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    data = np.load(args.input, allow_pickle=False)
    rig, report = bake(data, args.character.resolve(), args.root_motion)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.objects:
        if obj.type in {'ARMATURE', 'MESH'}:
            obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    output = args.output.resolve()
    temp = output.with_name(output.stem + '.partial.fbx')
    export_fbx(temp, rig, report)
    # Reimport the deliverable and compare timing and sampled world transforms.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = round(report['fps'])
    bpy.ops.import_scene.fbx(filepath=str(temp), automatic_bone_orientation=False)
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
    # Check every inference frame, not just the transform-comparison samples.
    max_horizontal = 0.
    for index in range(report['inference_frames'] + 1):
        time = min(index / report['fps'], report['duration'])
        frame = time * report['fps'] + action.frame_range[0]
        bpy.context.scene.frame_set(math.floor(frame), subframe=frame % 1)
        pos = world(imported, bones['Hips']).translation
        max_horizontal = max(max_horizontal, math.hypot(pos.x, pos.y))
    report['validation']['max_horizontal_hips_distance_m'] = max_horizontal
    report.pop('samples')
    output.with_suffix('.validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2), flush=True)
    if abs(actual_duration - report['duration']) > 0.001 or max_pos_error > 0.01 or math.degrees(max_angle_error) > 2:
        raise RuntimeError('FBX round-trip validation failed; see validation JSON')
    if args.root_motion == 'in-place' and max_horizontal > 1e-5:
        raise RuntimeError('FBX hips are not centered; see validation JSON')
    temp.replace(output)


if __name__ == '__main__':
    main()
