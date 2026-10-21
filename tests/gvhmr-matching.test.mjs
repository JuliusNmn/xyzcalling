import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingAnimations } from '../scripts/import-gvhmr.mjs';

test('title matching handles downloader IDs, Windows punctuation and shortened social captions', () => {
  const files = [
    'First Of The Year - Skrillex - Mike Song.gvhmr.fbx',
    'PUMPED UP KICKS - DUBSTEP.gvhmr.fbx',
    'Killas in the 🌳🐒🐛🐍🌳.gvhmr.fbx',
    'Robot 🤖 🦾🔥.gvhmr.fbx',
  ];
  assert.deepEqual(matchingAnimations('First Of The Year - Skrillex ⧸ Mike Song [2k0icW6kl7w].mp4', undefined, files), [files[0]]);
  assert.deepEqual(matchingAnimations('PUMPED UP KICKS｜DUBSTEP [LXO-jKksQkM].mp4', undefined, files), [files[1]]);
  assert.deepEqual(matchingAnimations('Killas in the 🌳🐒🐛🐍🌳 #GLITCHING #dance [7403109959577144594].mp4', undefined, files), [files[2]]);
  assert.deepEqual(matchingAnimations('_hide.guy__7182688726886239494.mp4', 'Robot 🤖 🦾🔥 #dance #dancer', files), [files[3]]);
  assert.deepEqual(matchingAnimations('unrelated.mp4', undefined, files), []);
  // Callers must reject ambiguity instead of picking whichever filesystem entry comes first.
  assert.equal(matchingAnimations('PUMPED UP KICKS｜DUBSTEP.mp4', undefined, [...files, 'PUMPED UP KICKS | DUBSTEP.gvhmr.fbx']).length, 2);
});
