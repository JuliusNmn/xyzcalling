"""Blender integration fixture: moving/turning SMPL-like skeleton and fractional timing.

This tests the actual rig and FBX exporter, without invoking neural inference.
Run in Blender, then run gvhmr_retarget.py on artifacts/gvhmr-fixture.npz.
"""
from pathlib import Path
import sys
import math
import numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from gvhmr_retarget import load_character, world, MAPPING

rig, bones = load_character(ROOT / 'amsterdam-hackathon/Geo/Chicken Dance.fbx')
conversion = Quaternion((1, 0, 0), math.pi / 2)
rest = np.array([list(conversion.inverted() @ world(rig, bones[n]).translation) for n in MAPPING])
parents = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19]
duration, fps = 1.047, 30
count = math.ceil(duration * fps)
rotations, joints = [], []
for i in range(count):
    t = i / fps
    r = [Matrix.Identity(3) for _ in MAPPING]
    p = [Vector(v) for v in rest]
    for j, parent in enumerate(parents):
        local = Quaternion()
        if j == 0:
            local = Quaternion((0, 1, 0), t * .5)
            p[j] += Vector((.3 * t, .08 * math.sin(t * 3), 0))
        if j in [16, 18]:
            local = Quaternion((0, 1, 0), -.6 * math.sin(t * 3))
        if parent == -1:
            r[j] = local.to_matrix()
        else:
            r[j] = r[parent] @ local.to_matrix()
            p[j] = p[parent] + r[parent] @ Vector(rest[j] - rest[parent])
    rotations.append(np.array([list(m) for m in r]))
    joints.append(np.array([list(v) for v in p]))
np.savez_compressed(ROOT / 'artifacts/gvhmr-fixture.npz', rotations_global=rotations,
                    joints_global=joints, rest_joints=rest, duration=duration, fps=fps)
print('Fixture ready')
