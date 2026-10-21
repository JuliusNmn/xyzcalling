"""Generate an explicitly synthetic pose fixture or source render from our FBX."""

import argparse
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from blender_retarget import LIMBS, load_rig, retarget


def fixture(rig, names):
    action = rig.animation_data.action
    first, last = (round(v) for v in action.frame_range)
    frames = []
    # Same landmark topology as MediaPipe, but from known FK, NOT model inference.
    for frame in range(first, last + 1):
        bpy.context.scene.frame_set(frame)
        points = [Vector((0, 0, 0)) for _ in range(33)]
        for name, a, b in LIMBS:
            bone = rig.pose.bones[names[name]]
            points[a] = rig.matrix_world @ bone.head
            points[b] = rig.matrix_world @ bone.tail
        center = (points[23] + points[24]) / 2
        points[0] = rig.matrix_world @ rig.pose.bones[names['Head']].head
        points[7] = points[0] + Vector((0.05, 0, 0))
        points[8] = points[0] - Vector((0.05, 0, 0))
        world = []
        for p in points:
            p = p - center
            world.append({'x': p.x, 'y': -p.z, 'z': p.y, 'visibility': 1.0})
        frames.append({'time': (frame - first) / 30, 'world': world, 'image': None})
    return {'schema': 'mediapipe-mixamo-v1', 'fps': 30,
            'source': 'SYNTHETIC-FK-Chicken-Dance-NOT-MediaPipe-inference',
            'frames': frames, 'detected_frames': 0}


def stage(rig):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x, scene.render.resolution_y = 384, 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.background_type = 'WORLD'
    scene.world = bpy.data.worlds.new('CalibrationWorld')
    scene.world.color = (0.65, 0.65, 0.65)
    bpy.ops.object.camera_add(location=(0, -4.3, 1.1))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((0, 0, 0.9)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 2.6
    scene.camera = camera


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--character', type=Path, required=True)
    parser.add_argument('--fixture', type=Path)
    parser.add_argument('--render-dir', type=Path)
    parser.add_argument('--landmarks', type=Path)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--single-frame', type=int)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    rig, names = load_rig(args.character.resolve())
    data = fixture(rig, names)
    if args.fixture:
        if args.fixture.exists():
            raise FileExistsError(args.fixture)
        args.fixture.parent.mkdir(parents=True, exist_ok=True)
        args.fixture.write_text(json.dumps(data))
    if args.check:
        report = retarget(rig, names, data, 1, 0.5)
        assert report['frames'] == 144, report
        assert report['mean_solved_direction_error_degrees'] < 0.1, report
        assert rig.animation_data.action.name == 'MediaPipe_Body_InPlace'
        first = {}
        max_change = 0
        for f in (0, 35, 71, 107, 143):
            bpy.context.scene.frame_set(f)
            for name, _, _ in LIMBS:
                q = rig.pose.bones[names[name]].rotation_quaternion.copy()
                if name not in first:
                    first[name] = q
                max_change = max(max_change, q.rotation_difference(first[name]).angle)
        assert max_change > 0.1, 'Retarget must not be static'
        invalid = dict(data, frames=[dict(data['frames'][0], world=data['frames'][0]['world'][:3])])
        try:
            retarget(rig, names, invalid, 1, 0.5)
        except ValueError:
            pass
        else:
            raise AssertionError('Malformed landmarks were accepted')
        print('CALIBRATION_TESTS', json.dumps(dict(report, max_rotation_change_radians=max_change)))
    if args.landmarks:
        retarget(rig, names, json.loads(args.landmarks.read_text()), 0.6, 0.5)
    if args.render_dir:
        if args.render_dir.exists():
            raise FileExistsError(args.render_dir)
        args.render_dir.mkdir(parents=True)
        stage(rig)
        scene = bpy.context.scene
        if args.single_frame is not None:
            scene.frame_set(args.single_frame)
            scene.render.filepath = str(args.render_dir.resolve() / 'preview.png')
            bpy.ops.render.render(write_still=True)
        else:
            scene.frame_start, scene.frame_end = 1, len(data['frames'])
            if args.landmarks:
                scene.frame_start = 0
                scene.frame_end = len(json.loads(args.landmarks.read_text())['frames']) - 1
            scene.render.filepath = str(args.render_dir.resolve() / 'frame_')
            bpy.ops.render.render(animation=True)


if __name__ == '__main__':
    main()
