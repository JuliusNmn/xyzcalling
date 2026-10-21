"""Blender CLI: MediaPipe world points -> rest-aware Mixamo rotations -> FBX."""

import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector


LIMBS = [
    ('LeftArm', 11, 13), ('LeftForeArm', 13, 15),
    ('RightArm', 12, 14), ('RightForeArm', 14, 16),
    ('LeftUpLeg', 23, 25), ('LeftLeg', 25, 27),
    ('RightUpLeg', 24, 26), ('RightLeg', 26, 28),
    ('LeftFoot', 27, 31), ('RightFoot', 28, 32),
]


def load_rig(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(path), automatic_bone_orientation=False)
    rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if len(rigs) != 1:
        raise ValueError('Expected exactly one armature')
    rig = rigs[0]
    names = {}
    for bone in rig.pose.bones:
        short = bone.name.rsplit(':', 1)[-1].removeprefix('mixamorig')
        names[short] = bone.name
    required = {'Hips', 'Spine', 'Spine1', 'Spine2',
                *(name for name, _, _ in LIMBS)}
    missing = required - names.keys()
    if missing:
        raise ValueError(f'Missing Mixamo bones: {sorted(missing)}')
    return rig, names


def basis(right, up):
    up = up.normalized()
    right = (right - up * right.dot(up)).normalized()
    if min(right.length, up.length) < 0.5:
        raise ValueError('Degenerate torso landmarks')
    forward = up.cross(right).normalized()
    return Matrix((right, forward, up)).transposed().to_quaternion()


def world_point(point):
    # Camera right -> +X, camera depth -> +Y, image down -> -Z.
    return Vector((point['x'], point['z'], -point['y']))


def set_world_rotation(rig, bone, rotation):
    world = rig.matrix_world @ bone.matrix
    target = Matrix.LocRotScale(world.translation, rotation, world.to_scale())
    bone.matrix = rig.matrix_world.inverted() @ target
    bone.location = (0, 0, 0)
    bone.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def retarget(rig, names, data, alpha, min_visibility):
    if data.get('schema') != 'mediapipe-mixamo-v1':
        raise ValueError('Unsupported landmark schema')
    fps = float(data['fps'])
    frames = data['frames']
    if not math.isfinite(fps) or fps <= 0 or not frames:
        raise ValueError('Invalid frame rate or empty clip')
    for i, frame in enumerate(frames):
        if abs(frame['time'] - i / fps) > 0.001:
            raise ValueError('Only uniform, contiguous video timing is supported')
        if frame['world'] is not None:
            if len(frame['world']) != 33:
                raise ValueError('Expected 33 world landmarks per detected frame')
            if not all(math.isfinite(p[k]) for p in frame['world'] for k in ('x', 'y', 'z')):
                raise ValueError('Nonfinite world landmark')
    rig.animation_data_clear()
    for bone in rig.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    bones = {short: rig.pose.bones[full] for short, full in names.items()}
    rest_q = {name: (rig.matrix_world @ bone.matrix).to_quaternion()
              for name, bone in bones.items()}
    rest_pos = {name: rig.matrix_world @ bone.head for name, bone in bones.items()}
    hips_mid = (rest_pos['LeftUpLeg'] + rest_pos['RightUpLeg']) / 2
    shoulder_mid = (rest_pos['LeftArm'] + rest_pos['RightArm']) / 2
    rest_hip_basis = basis(rest_pos['RightUpLeg'] - rest_pos['LeftUpLeg'],
                           shoulder_mid - hips_mid)
    rest_chest_basis = basis(rest_pos['RightArm'] - rest_pos['LeftArm'],
                             shoulder_mid - hips_mid)
    scene = bpy.context.scene
    scene.render.fps = round(fps)
    scene.render.fps_base = round(fps) / fps
    # Export FBX keys from t=0; Blender's importer adds its own +1 frame offset.
    scene.frame_start, scene.frame_end = 0, len(frames) - 1
    previous = {}
    held = 0
    errors = []
    controlled = ['Hips', 'Spine', 'Spine1', 'Spine2'] + [x[0] for x in LIMBS]

    def apply(name, q):
        bone = bones[name]
        set_world_rotation(rig, bone, q)
        current = bone.rotation_quaternion.copy()
        if name in previous:
            current = previous[name].slerp(current, alpha)
        bone.rotation_quaternion = current
        previous[name] = current.copy()
        bpy.context.view_layer.update()

    for index, frame in enumerate(frames):
        scene.frame_set(index)
        # Evaluate only previously solved values, never the original Mixamo action.
        for name in controlled:
            bones[name].rotation_quaternion = previous.get(name, Quaternion())
        bpy.context.view_layer.update()
        raw = frame['world']
        if raw is None:
            held += 1
        else:
            p = [world_point(x) for x in raw]
            visible = lambda *ids: all(raw[i].get('visibility', 1) >= min_visibility for i in ids)
            hip = (p[23] + p[24]) / 2
            chest = (p[11] + p[12]) / 2
            if visible(11, 12, 23, 24) and (chest - hip).length > 0.05:
                try:
                    hip_q = basis(p[24] - p[23], chest - hip) @ rest_hip_basis.inverted()
                    chest_q = basis(p[12] - p[11], chest - hip) @ rest_chest_basis.inverted()
                    apply('Hips', hip_q @ rest_q['Hips'])
                    for name, weight in [('Spine', 1 / 3), ('Spine1', 2 / 3), ('Spine2', 1)]:
                        apply(name, hip_q.slerp(chest_q, weight) @ rest_q[name])
                except ValueError:
                    held += 1
            for name, a, b in LIMBS:
                direction = p[b] - p[a]
                if not visible(a, b) or direction.length < 0.01:
                    held += 1
                    continue
                bone = bones[name]
                world_q = (rig.matrix_world @ bone.matrix).to_quaternion()
                current = world_q @ Vector((0, 1, 0))
                apply(name, current.rotation_difference(direction) @ world_q)
                actual = (rig.matrix_world.to_3x3() @ (bone.tail - bone.head)).normalized()
                errors.append(math.degrees(actual.angle(direction.normalized())))
        for name in controlled:
            bones[name].keyframe_insert(data_path='rotation_quaternion', frame=index,
                                        group=bones[name].name)
    rig.animation_data.action.name = 'MediaPipe_Body_InPlace'
    report = {
        'frames': len(frames), 'fps': fps, 'last_key_seconds': (len(frames) - 1) / fps,
        'controlled_bones': controlled, 'held_frames_or_limb_updates': held,
        'mean_solved_direction_error_degrees': sum(errors) / len(errors) if errors else None,
        'in_place': True, 'smoothing_alpha': alpha,
        'limitations': ['No root travel, finger or facial capture',
                        'No foot locking; sliding/penetration possible',
                        'Single-vector limbs do not recover axial twist',
                        'Occluded limbs hold their previous local rotation',
                        'Direction error is fit to estimates, not capture accuracy',
                        'No automatic seamless-loop guarantee'],
    }
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--character', type=Path, required=True)
    parser.add_argument('--landmarks', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--alpha', type=float, default=0.6)
    parser.add_argument('--min-visibility', type=float, default=0.5)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if not 0 < args.alpha <= 1 or not 0 <= args.min_visibility <= 1:
        parser.error('Require 0 < alpha <= 1 and 0 <= min-visibility <= 1')
    if args.output.exists():
        raise FileExistsError(f'Refusing to overwrite {args.output}')
    rig, names = load_rig(args.character.resolve())
    data = json.loads(args.landmarks.read_text())
    report = retarget(rig, names, data, args.alpha, args.min_visibility)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.objects:
        if obj.type in {'ARMATURE', 'MESH'}:
            obj.select_set(True)
    bpy.ops.export_scene.fbx(
        filepath=str(args.output.resolve()), use_selection=True,
        object_types={'ARMATURE', 'MESH'}, add_leaf_bones=False,
        bake_anim=True, bake_anim_use_all_actions=False, bake_anim_use_nla_strips=False,
        bake_anim_simplify_factor=0, path_mode='COPY', embed_textures=True,
    )
    report['source'] = data.get('source')
    report['landmark_file'] = args.landmarks.name
    report['output'] = args.output.name
    args.output.with_suffix('.report.json').write_text(json.dumps(report, indent=2) + '\n')
    print('RETARGET_RESULT', json.dumps(report))


if __name__ == '__main__':
    main()
