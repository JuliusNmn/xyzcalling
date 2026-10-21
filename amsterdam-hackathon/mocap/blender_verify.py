"""Compare actual exported/reimported FBX joint heads against the solved rig."""

import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).parent))
from blender_retarget import load_rig, retarget


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def positions(rig, names, frames, start=1):
    result = []
    for frame in range(start, start + frames):
        bpy.context.scene.frame_set(frame)
        result.append({short: rig.matrix_world @ rig.pose.bones[full].head
                       for short, full in names.items()})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--character', type=Path, required=True)
    parser.add_argument('--landmarks', type=Path, required=True)
    parser.add_argument('--baked', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if args.report.exists():
        raise FileExistsError(args.report)
    before = sha256(args.character)
    data = json.loads(args.landmarks.read_text())
    rig, names = load_rig(args.character.resolve())
    result = retarget(rig, names, data, 0.6, 0.5)
    expected = positions(rig, names, len(data['frames']), start=0)
    baked, baked_names = load_rig(args.baked.resolve())
    assert names.keys() == baked_names.keys(), 'Skeleton bone set changed'
    action_range = list(baked.animation_data.action.frame_range)
    assert abs(action_range[0] - 1) < 0.001, action_range
    assert abs(action_range[1] - len(data['frames'])) < 0.001, action_range
    actual = positions(baked, baked_names, len(data['frames']))
    errors = [(actual[i][name] - expected[i][name]).length
              for i in range(len(expected)) for name in names]
    assert max(errors) < 0.001, f'FBX joint roundtrip error: {max(errors)}m'
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    assert meshes and any(m.type == 'ARMATURE' for o in meshes for m in o.modifiers)
    assert before == sha256(args.character), 'Source character changed'
    result.update({
        'verified': True, 'verification': 'Export/reimport joint heads, not motion-capture accuracy',
        'bones': len(names), 'mesh_count': len(meshes), 'reimported_action_range': action_range,
        'max_fbx_roundtrip_joint_error_meters': max(errors),
        'source_sha256': before, 'landmarks_sha256': sha256(args.landmarks),
        'baked_sha256': sha256(args.baked), 'baked_path': str(args.baked.resolve()),
        'capture_source': 'Rendered Mixamo Chicken Dance; synthetic calibration video',
        'actual_mediapipe_inference': True,
        'detected_frames': data['detected_frames'],
    })
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, indent=2) + '\n')
    print('FBX_VERIFIED', json.dumps(result))


if __name__ == '__main__':
    main()
