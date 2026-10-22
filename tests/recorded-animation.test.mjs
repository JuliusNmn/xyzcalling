import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { excerptAnimation } from '../src/recorded-animation.ts';
import { processAnimation, DEFAULT_PROCESSING } from '../src/animation-processing.ts';
import { recordedAnimation } from '../recorded-animations-server.ts';

function clip() {
  return new AnimationClip('saved', 2, [
    new QuaternionKeyframeTrack('mixamorigHips.quaternion', [0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    new VectorKeyframeTrack('mixamorigHips.position', [0, 1, 2], [0, 100, 0, 100, 100, 0, 200, 100, 0]),
    new VectorKeyframeTrack('mixamorigHips.scale', [0, 2], [1, 1, 1, 1, 1, 1]),
  ]);
}
test('saved excerpts start at the source time and preserve root movement and exact duration', () => {
  const original = clip(), selected = excerptAnimation(original, { kind: 'full', start: .53, end: 1.577 });
  assert(Math.abs(selected.duration - 1.047) < 1e-9);
  assert(Math.abs(selected.tracks[1].values[0] - 53) < 1e-5);
  assert(Math.abs(selected.tracks[1].values.at(-3) - 157.7) < 1e-4);
  assert.equal(selected.tracks[1].times[0], 0);
  assert.equal(original.duration, 2);
  assert.throws(() => excerptAnimation(original, { start: 0, end: 3 }), /does not cover/);
});
test('smoothing and timing keep translations, rotations and scale on one timeline', () => {
  const raw = AnimationClip.toJSON(excerptAnimation(clip(), { start: 0, end: 2 }));
  const before = JSON.stringify(raw);
  const off = processAnimation(raw, { ...DEFAULT_PROCESSING, smoothing: 'off' });
  assert.deepEqual(off.animation.tracks, raw.tracks);
  const advanced = processAnimation(raw, { ...DEFAULT_PROCESSING, advanceMs: 100 });
  const track = advanced.animation.tracks.find(t => t.name.endsWith('.position'));
  assert(Math.abs(track.values[30 * 3] - 110) < 1e-4);
  assert.equal(advanced.animation.tracks.length, 3);
  assert.equal(JSON.stringify(raw), before);
});
test('sidecar discovery rejects missing, malformed and mismatched metadata and path traversal', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pose-sidecar-'));
  try {
    assert.equal(await recordedAnimation(dir, 'dance.mp4'), undefined);
    await writeFile(path.join(dir, 'dance.gvhmr.fbx'), 'fixture');
    await writeFile(path.join(dir, 'dance.gvhmr.json'), JSON.stringify({ file: 'other.mp4', duration: 2 }));
    assert.equal(await recordedAnimation(dir, 'dance.mp4'), undefined);
    await writeFile(path.join(dir, 'dance.gvhmr.json'), JSON.stringify({ file: 'dance.mp4', duration: 2 }));
    const asset = await recordedAnimation(dir, 'dance.mp4');
    assert.equal(asset.duration, 2); assert.equal(asset.bytes, 7); assert.equal(asset.url, '/api/videos/dance.mp4/gvhmr');
    assert.equal(await recordedAnimation(dir, '../dance.mp4'), undefined);
    assert.equal(await recordedAnimation(dir, '..\\dance.mp4'), undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('imported title-named FBX resolves through explicit safe metadata without renaming the video', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pose-import-'));
  try {
    const video = 'First Of The Year ⧸ Dance [video-id].mp4';
    const metadataPath = path.join(dir, 'First Of The Year ⧸ Dance [video-id].gvhmr.json');
    const filename = 'First Of The Year - Dance.gvhmr.fbx';
    await writeFile(path.join(dir, filename), 'fixture');
    const metadata = { file: video, fbx_file: filename, duration: 142.44667, held_black_outro_frames: null };
    await writeFile(metadataPath, JSON.stringify(metadata));
    const asset = await recordedAnimation(dir, video);
    assert.equal(asset.filename, filename); assert.equal(asset.heldOutroFrames, null);
    assert.equal(asset.url, `/api/videos/${encodeURIComponent(video)}/gvhmr`);
    for (const unsafe of ['../outside.gvhmr.fbx', '..\\outside.gvhmr.fbx', '/outside.gvhmr.fbx', '.hidden.gvhmr.fbx', 'model.json', 123]) {
      await writeFile(metadataPath, JSON.stringify({ ...metadata, fbx_file: unsafe }));
      assert.equal(await recordedAnimation(dir, video), undefined);
    }
    await writeFile(metadataPath, JSON.stringify({ ...metadata, fbx_file: 'missing.gvhmr.fbx' }));
    assert.equal(await recordedAnimation(dir, video), undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a short media-container tail holds the final pose without stretching motion; longer gaps fail', () => {
  const original = clip(), selected = excerptAnimation(original, { start: 0, end: 2.173 });
  const position = selected.tracks.find(track => track.name.endsWith('.position'));
  assert.equal(selected.duration, 2.173);
  assert(Math.abs(position.values.at(-3) - 200) < 1e-5);
  assert(Math.abs(position.values[30 * 3] - 100) < 1e-5);
  assert.throws(() => excerptAnimation(original, { start: 0, end: 2.251 }), /does not cover/);
});

test('saved full video and manual loop exports work without an audio sidecar', async () => {
  const { readFile } = await import('node:fs/promises');
  const { extractRecordedAnimation } = await import('../src/recorded-animation.ts');
  const bytes = await readFile(new URL('../videos/officialnickkosir_7696989498051202335.gvhmr.fbx', import.meta.url));
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  globalThis.window = { URL };
  globalThis.fetch = async () => new Response(bytes);
  try {
    const source = { name: 'no-beats.mp4', bytes: 123, recordedAnimation: { url: '/no-audio-fixture', revision: '1' } };
    for (const selection of [{ kind: 'full', start: 0, end: 9.9 }, { kind: 'range', start: .53, end: 1.577 }]) {
      const data = await extractRecordedAnimation(source, selection, undefined, new AbortController().signal);
      assert.equal(data.rhythm, null); assert.equal(data.source.name, source.name);
      assert.equal(data.source.start_seconds, selection.start);
      assert(Math.abs(data.duration_seconds - (selection.end - selection.start)) < 1e-5);
    }
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow; }
});
