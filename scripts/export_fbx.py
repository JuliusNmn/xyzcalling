"""Bake Pose Studio's Three.js animation onto the original textured Mixamo FBX.

Run with Blender --background --python-exit-code 1 --python scripts/export_fbx.py
-- --input dance.json --character '.../Chicken Dance.fbx' --output dance.fbx.
"""
import argparse
import bisect
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector


def short(name):
    return name.rsplit(':', 1)[-1].removeprefix('mixamorig')


def quaternion(values):
    x, y, z, w = values
    return Quaternion((w, x, y, z)).normalized()


def bake(data, character):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(character), automatic_bone_orientation=False)
    rig, = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    # Remove ALL source animation, including NLA and mesh/object actions.
    for obj in bpy.context.scene.objects:
        obj.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    for bone in rig.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    bones = {short(b.name): b for b in rig.pose.bones}
    skeleton = data['rig']['bones']
    tracks = {t['name'].removesuffix('.quaternion'): t for t in data['animation']['tracks']}
    root_q = quaternion(data['rig']['root_transform']['quaternion'])
    # Three Y-up -> Blender Z-up; both use meters in world space.
    conversion = Quaternion((1, 0, 0), math.pi / 2)
    rest = {}
    for entry in skeleton:
        parent = rest[entry['parent']] if entry['parent'] else root_q
        rest[entry['name']] = parent @ quaternion(entry['quaternion'])
    blender_rest = {name: (rig.matrix_world @ b.matrix).to_quaternion() for name, b in bones.items()}
    controlled = [entry for entry in skeleton if entry['name'] in tracks]
    duration = data['animation']['duration']
    steps = max(1, math.ceil(duration * 30 - 1e-5))
    frame_step = duration * 30 / steps
    scene = bpy.context.scene
    # Preserve exact excerpt duration, even when its last key is between 30 Hz samples.
    scene.render.fps = 30
    scene.render.fps_base = 1
    scene.frame_start, scene.frame_end = 0, steps
    for index in range(steps + 1):
        frame = index * frame_step
        scene.frame_set(math.floor(frame), subframe=frame % 1)
        time = frame / 30
        world = {}
        for entry in skeleton:
            name = entry['name']
            local = quaternion(entry['quaternion'])
            if name in tracks:
                track = tracks[name]
                times, values = track['times'], track['values']
                left = max(0, min(len(times) - 2, bisect.bisect_right(times, time) - 1))
                weight = min(1, max(0, (time - times[left]) / (times[left + 1] - times[left])))
                local = quaternion(values[left * 4:left * 4 + 4]).slerp(
                    quaternion(values[(left + 1) * 4:(left + 2) * 4]), weight)
            parent = world[entry['parent']] if entry['parent'] else root_q
            world[name] = parent @ local
        # Map each rest-relative world rotation into Blender's imported bone axes.
        for entry in controlled:
            name = entry['name']
            bone = bones[short(name)]
            rotation = conversion @ world[name] @ rest[name].inverted() @ conversion.inverted() @ blender_rest[short(name)]
            transform = rig.matrix_world @ bone.matrix
            bone.matrix = rig.matrix_world.inverted() @ Matrix.LocRotScale(transform.translation, rotation, transform.to_scale())
            bone.location = (0, 0, 0)
            bone.scale = (1, 1, 1)
            bpy.context.view_layer.update()
            bone.keyframe_insert('rotation_quaternion', frame=frame, group=bone.name)
    action = rig.animation_data.action
    action.name = data['animation'].get('name', 'Pose Studio')[:120]
    for curve in action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = 'LINEAR'
    return rig


def export(data, character, output):
    rig = bake(data, character)
    # Include the skinned mesh and embed its original textures in the FBX.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.objects:
        if obj.type in {'ARMATURE', 'MESH'}:
            obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    # The sole action has the exact fractional endpoint; scene.frame_end is integer-only.
    # Use subframe sampling rather than custom FPS (Blender's importer rounds custom FPS).
    end = rig.animation_data.action.frame_range[1]
    step = end / max(1, math.ceil(data['animation']['duration'] * 30 - 1e-5))
    bpy.ops.export_scene.fbx(
        filepath=str(output), use_selection=True, object_types={'ARMATURE', 'MESH'},
        add_leaf_bones=False, bake_anim=True, bake_anim_use_all_bones=True,
        bake_anim_use_nla_strips=False, bake_anim_use_all_actions=True,
        bake_anim_force_startend_keying=True, bake_anim_step=step, bake_anim_simplify_factor=0,
        path_mode='COPY', embed_textures=True, axis_forward='-Z', axis_up='Y')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--character', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if args.output.exists():
        raise FileExistsError(args.output)
    export(json.loads(args.input.read_text()), args.character.resolve(), args.output.resolve())
