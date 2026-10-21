"""Check exported FBX against browser poses and original ground-truth motion."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    folder = args.directory
    expected = json.loads((folder / 'browser-joints.json').read_text())
    truth = json.loads((folder / 'ground-truth-joints.json').read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str((folder / 'generated.fbx').resolve()), automatic_bone_orientation=False)
    rig, = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    names = {b.name.rsplit(':', 1)[-1].removeprefix('mixamorig'): b for b in rig.pose.bones}
    joints = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand',
              'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
              'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase']
    limbs = [('LeftArm', 'LeftForeArm'), ('LeftForeArm', 'LeftHand'), ('RightArm', 'RightForeArm'),
             ('RightForeArm', 'RightHand'), ('LeftUpLeg', 'LeftLeg'), ('LeftLeg', 'LeftFoot'),
             ('RightUpLeg', 'RightLeg'), ('RightLeg', 'RightFoot')]
    errors, capture, angles = [], [], []
    per_joint = {name: [] for name in joints}
    actual = []
    for i in range(len(expected)):
        # Blender's FBX importer adds a frame at the start (t=0 is frame 1).
        bpy.context.scene.frame_set(i + 1)
        positions = {name: rig.matrix_world @ bone.head for name, bone in names.items()}
        actual.append({name: list(p) for name, p in positions.items()})
        errors.extend((positions[name] - Vector(p)).length for name, p in expected[i].items())
        for name in joints:
            # The app is explicitly in place: compare hip-centered joint positions.
            delta = (positions[name] - positions['Hips']) - (Vector(truth[i][name]) - Vector(truth[i]['Hips']))
            capture.append(delta.length)
            per_joint[name].append(delta.length)
        for a, b in limbs:
            direction = positions[b] - positions[a]
            reference = Vector(truth[i][b]) - Vector(truth[i][a])
            angles.append(math.degrees(direction.angle(reference)))
    def percentile(values, p):
        return sorted(values)[round((len(values) - 1) * p)]
    report = {
        'frames': len(expected), 'bones': len(names), 'action_range': list(rig.animation_data.action.frame_range),
        'skinned_meshes': sum(o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers) for o in bpy.context.scene.objects),
        'max_export_error_m': max(errors), 'mean_export_error_m': sum(errors) / len(errors),
        'hip_aligned_mean_joint_error_m': sum(capture) / len(capture),
        'hip_aligned_p95_joint_error_m': percentile(capture, .95),
        'mean_limb_direction_error_degrees': sum(angles) / len(angles),
        'p95_limb_direction_error_degrees': percentile(angles, .95),
        'per_joint_mean_error_m': {k: sum(v) / len(v) for k, v in per_joint.items()},
        'generated_sha256': hashlib.sha256((folder / 'generated.fbx').read_bytes()).hexdigest(),
        'method': 'Actual MediaPipe full inference on rendered source; production TypeScript custom solver and JSON baker; FBX reimported independently in Blender. Hip alignment removes unsupported root travel. No temporal alignment or scale fitting.',
    }
    (folder / 'verification.json').write_text(json.dumps(report, indent=2))
    (folder / 'reimported-joints.json').write_text(json.dumps(actual))
    print(json.dumps(report, indent=2))
    assert len(names) == 65 and report['skinned_meshes'] == 1
    assert max(errors) < .001, 'FBX must reproduce browser joint positions within 1 mm'
    assert tuple(report['action_range']) == (1, len(expected)), 'FBX timing changed'
    # Regression for excerpts whose final key falls between 30 FPS samples.
    fractional = folder / 'fractional.fbx'
    if fractional.exists():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=str(fractional.resolve()))
        armature, = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
        scene = bpy.context.scene
        start, end = armature.animation_data.action.frame_range
        duration = (end - start) / (scene.render.fps / scene.render.fps_base)
        assert abs(duration - .047) < .00001, 'Fractional endpoint duration changed'
        report['fractional_endpoint_duration_seconds'] = duration
        (folder / 'verification.json').write_text(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
