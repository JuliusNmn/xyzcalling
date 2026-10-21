import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { validateFbxPayload, fbxRoutes } from '../fbx-export-server.ts';

function fixture() {
  return { schema: 'pose-studio.dance-animation', rig: {
    root_transform: { quaternion: [0, 0, 0, 1] },
    bones: Array.from({ length: 65 }, (_, i) => ({ name: `mixamorigBone${i}`, parent: i ? `mixamorigBone${i - 1}` : null, quaternion: [0, 0, 0, 1] })),
  }, animation: { duration: 1, tracks: [{ name: 'mixamorigBone0.quaternion', type: 'quaternion', times: [0, 1], values: [0, 0, 0, 1, 0, 0, 0, 1] }] } };
}

test('FBX request rejects malformed timing, rotations and hierarchy before spawning Blender', () => {
  validateFbxPayload(fixture());
  for (const corrupt of [
    a => a.animation.duration = 601,
    a => a.animation.tracks[0].times[1] = 0,
    a => a.animation.tracks[0].times[1] = .9,
    a => a.animation.tracks[0].values[0] = NaN,
    a => a.animation.tracks[0].values[3] = 0,
    a => a.animation.tracks[0].name = 'unknown.quaternion',
    a => a.animation.tracks[0].type = 'vector',
    a => a.animation.tracks.push(a.animation.tracks[0]),
    a => a.rig.bones[0].parent = 'mixamorigBone64',
    a => a.rig.bones[1].name = a.rig.bones[0].name,
  ]) { const value = fixture(); corrupt(value); assert.throws(() => validateFbxPayload(value), /Invalid FBX/); }
});

test('FBX endpoint returns actionable validation errors', async () => {
  const app = express(); app.use('/api/export/fbx', fbxRoutes(process.cwd()));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/export/fbx`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /Invalid FBX/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
