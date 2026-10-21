import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import { characterDefinition, DEFAULT_CHARACTER } from './src/characters.js';

const run = promisify(execFile);
export function blenderExecutable() {
  return process.env.BLENDER_BIN || (existsSync('/Applications/Blender.app/Contents/MacOS/Blender')
    ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender');
}

/** Accept only the bounded Mixamo animation format produced by this app. */
export function validateFbxPayload(data: any) {
  const fail = () => { throw new Error('Invalid FBX animation. Export a nonempty Pose Studio clip of at most 10 minutes.'); };
  const numbers = (a: any, size: number) => Array.isArray(a) && a.length === size && a.every((v: unknown) => typeof v === 'number' && Number.isFinite(v));
  const quat = (a: any) => numbers(a, 4) && Math.abs(Math.hypot(...a) - 1) < .01;
  characterDefinition(data?.character_id ?? DEFAULT_CHARACTER);
  const duration = data?.animation?.duration;
  if (data?.schema !== 'pose-studio.dance-animation' || !Number.isFinite(duration) || duration <= 0 || duration > 600) fail();
  if (!quat(data?.rig?.root_transform?.quaternion) || !numbers(data?.rig?.root_transform?.position, 3) || !numbers(data?.rig?.root_transform?.scale, 3)) fail();
  const bones = data?.rig?.bones, tracks = data?.animation?.tracks;
  if (!Array.isArray(bones) || bones.length !== 65 || !Array.isArray(tracks) || !tracks.length || tracks.length > 195) fail();
  const names = new Set<string>();
  for (const b of bones) {
    if (typeof b?.name !== 'string' || !/^mixamorig[A-Za-z0-9_]+$/.test(b.name) || names.has(b.name) ||
      (b.parent !== null && !names.has(b.parent)) || !quat(b.quaternion) || !numbers(b.position, 3) || !numbers(b.scale, 3)) fail();
    names.add(b.name);
  }
  const seen = new Set<string>();
  for (const t of tracks) {
    if (typeof t?.name !== 'string') fail();
    const [bone, property] = t.name.split('.');
    const rotation = property === 'quaternion';
    if (!names.has(bone) || t.name !== `${bone}.${property}` || seen.has(t.name) ||
        !['quaternion', 'position', 'scale'].includes(property) || t.type !== (rotation ? 'quaternion' : 'vector')) fail();
    seen.add(t.name);
    const count = t.times?.length;
    if (!Number.isInteger(count) || count < 2 || count > 18002 || !numbers(t.times, count) || !numbers(t.values, count * (rotation ? 4 : 3))) fail();
    if (t.times[0] !== 0 || Math.abs(t.times[count - 1] - duration) > .0001 ||
        t.times.some((v: number, i: number) => i > 0 && v <= t.times[i - 1])) fail();
    if (rotation) for (let i = 0; i < count; i++) if (!quat(t.values.slice(i * 4, i * 4 + 4))) fail();
    // The converter preserves rigid bone lengths and unit scale. Only the root
    // may translate; reject unsupported deformation instead of dropping it.
    const rest = bones.find((entry: any) => entry.name === bone);
    if (property === 'scale' && t.values.some((value: number) => Math.abs(value - 1) > .0001)) fail();
    if (property === 'position') {
      if (rest.parent !== null && t.values.some((value: number, i: number) => Math.abs(value - rest.position[i % 3]) > .01)) fail();
      if (!tracks.some((track: any) => track.name === `${bone}.quaternion`)) fail();
    }
  }
}

export function fbxRoutes(root: string) {
  const router = express.Router();
  let active = false;
  router.get('/', async (_request, response) => {
    try { await run(blenderExecutable(), ['--version'], { timeout: 10000 }); response.json({ available: true }); }
    catch { response.status(503).json({ error: 'FBX export requires Blender on the server. Install Blender or set BLENDER_BIN to its executable.' }); }
  });
  router.post('/', express.json({ limit: '32mb' }), async (request, response) => {
    try { validateFbxPayload(request.body); }
    catch (error) { response.status(422).json({ error: (error as Error).message }); return; }
    if (active) { response.status(429).json({ error: 'Another FBX export is running. Please try again shortly.' }); return; }
    active = true;
    const controller = new AbortController();
    const disconnected = () => { if (!response.writableEnded) controller.abort(); };
    response.on('close', disconnected);
    let directory: string | undefined;
    try {
      directory = await mkdtemp(path.join(tmpdir(), 'pose-studio-fbx-'));
      const input = path.join(directory, 'animation.json'), output = path.join(directory, 'animation.fbx');
      await writeFile(input, JSON.stringify(request.body));
      await run(blenderExecutable(), ['--background', '--factory-startup', '--python-exit-code', '1',
        '--python', path.join(root, 'scripts/export_fbx.py'), '--', '--input', input,
        '--character', path.join(root, characterDefinition(request.body.character_id ?? DEFAULT_CHARACTER).file), '--output', output],
      { signal: controller.signal, timeout: 300000, maxBuffer: 2 * 1024 * 1024 });
      // This is a fetch response. An attachment header can make embedded browsers
      // intercept it as a navigation download before the caller receives the blob.
      response.type('application/octet-stream');
      await new Promise<void>((resolve, reject) => response.sendFile(output, error => error ? reject(error) : resolve()));
    } catch (error) {
      console.error('FBX export:', (error as Error).message);
      if (!controller.signal.aborted && !response.headersSent) response.status(500).json({ error: 'FBX conversion failed. Check Blender installation and server logs; JSON export remains available.' });
    } finally {
      response.off('close', disconnected);
      if (directory) await rm(directory, { recursive: true, force: true });
      active = false;
    }
  });
  return router;
}
