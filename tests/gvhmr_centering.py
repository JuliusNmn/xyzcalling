"""Blender regression: center all frames while preserving vertical motion/turns."""
from pathlib import Path
import sys
import numpy as np
import bpy

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from gvhmr_retarget import bake, world, short

data = dict(np.load(ROOT / 'artifacts/gvhmr-fixture.npz'))
# Include a nonzero start and substantial travel in both horizontal axes.
data['joints_global'] = data['joints_global'].copy()
data['joints_global'][:, :, 0] += 10
data['joints_global'][:, :, 2] += np.linspace(-3, 5, len(data['joints_global']))[:, None]
for character in [ROOT / 'amsterdam-hackathon/Geo/Chicken Dance.fbx',
                  ROOT / 'assets/characters/neutral-low-poly.fbx']:
    positions, rotations = {}, {}
    for mode in ['travel', 'in-place']:
        rig, report = bake(data, character, mode)
        hips = next(b for b in rig.pose.bones if short(b.name) == 'Hips')
        positions[mode], rotations[mode] = [], []
        for frame in range(len(data['joints_global']) + 1):
            bpy.context.scene.frame_set(frame)
            matrix = world(rig, hips)
            positions[mode].append(list(matrix.translation))
            rotations[mode].append(list(matrix.to_quaternion()))
    travel, centered = np.array(positions['travel']), np.array(positions['in-place'])
    assert np.max(np.abs(centered[:, :2])) < 1e-5, centered
    assert np.ptp(travel[:, :2], axis=0).max() > 1
    np.testing.assert_allclose(travel[:, 2], centered[:, 2], atol=1e-5)
    np.testing.assert_allclose(rotations['travel'], rotations['in-place'], atol=1e-5)
    assert np.ptp(centered[:, 2]) > .01
    print(f'PASS: centering, height and turns: {character.name}')
