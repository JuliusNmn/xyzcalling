// Full synthetic-video regression. Uses the production solver, baker and HTTP route.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import express from 'express';
import { blenderExecutable, fbxRoutes } from '../fbx-export-server.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = path.resolve(process.argv[2] || `artifacts/fbx-${Date.now()}`);
await mkdir(folder, { recursive: true });
const run = promisify(execFile);
async function command(name, executable, args) {
  console.log(name);
  try {
    const result = await run(executable, args, { cwd: root, maxBuffer: 8 * 1024 * 1024, timeout: 300000 });
    await writeFile(path.join(folder, `${name}.log`), result.stdout + result.stderr);
  } catch (error) { await writeFile(path.join(folder, `${name}.log`), `${error.stdout}\n${error.stderr}`); throw error; }
}
async function blender(name, script, args) {
  await command(name, blenderExecutable(), ['--background', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', ...args]);
}
const character = path.join(root, 'amsterdam-hackathon/Geo/Chicken Dance.fbx');
const hash = async () => createHash('sha256').update(await readFile(character)).digest('hex');
const originalHash = await hash();
await blender('source-render', 'amsterdam-hackathon/mocap/blender_calibration.py', ['--character', character, '--render-dir', path.join(folder, 'source-frames')]);
await command('source-video', 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-framerate', '30', '-start_number', '1', '-i', path.join(folder, 'source-frames/frame_%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(folder, 'original.mp4')]);
await command('inference', 'uv', ['run', '--no-project', '--python', '3.12', '--with', 'mediapipe==1.1.1', '--with', 'opencv-contrib-python==5.0.0.93', 'python', 'amsterdam-hackathon/mocap/extract_pose.py', '--video', path.join(folder, 'original.mp4'), '--model', path.join(root, 'models/pose_landmarker_full.task'), '--output', path.join(folder, 'landmarks.json')]);
await command('browser-solver', process.execPath, ['--import', 'tsx', 'scripts/fbx-validation-fixture.mjs', folder]);
const app = express(); app.use('/api/export/fbx', fbxRoutes(root));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
try {
  console.log('HTTP FBX export');
  const url = `http://127.0.0.1:${server.address().port}/api/export/fbx`;
  const availability = await fetch(url);
  if (!availability.ok) throw new Error(await availability.text());
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await readFile(path.join(folder, 'animation.json')) });
  if (!response.ok) throw new Error(await response.text());
  await writeFile(path.join(folder, 'generated.fbx'), Buffer.from(await response.arrayBuffer()));
  const fractional = JSON.parse(await readFile(path.join(folder, 'animation.json'), 'utf8'));
  fractional.animation.duration = .047;
  for (const track of fractional.animation.tracks) { track.times = [0, 1 / 30, .047]; track.values = track.values.slice(0, 12); }
  const shortResponse = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fractional) });
  if (!shortResponse.ok) throw new Error(await shortResponse.text());
  await writeFile(path.join(folder, 'fractional.fbx'), Buffer.from(await shortResponse.arrayBuffer()));
} finally { await new Promise(resolve => server.close(resolve)); }
await blender('verify', 'scripts/verify_fbx.py', ['--directory', folder]);
await blender('generated-render', 'amsterdam-hackathon/mocap/blender_calibration.py', ['--character', path.join(folder, 'generated.fbx'), '--render-dir', path.join(folder, 'generated-frames')]);
await command('generated-video', 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-framerate', '30', '-start_number', '1', '-i', path.join(folder, 'generated-frames/frame_%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(folder, 'generated.mp4')]);
await command('comparison-video', 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-i', path.join(folder, 'original.mp4'), '-i', path.join(folder, 'generated.mp4'), '-filter_complex', '[0:v][1:v]hstack=inputs=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(folder, 'comparison.mp4')]);
if (originalHash !== await hash()) throw new Error('Source FBX was changed');
const report = JSON.parse(await readFile(path.join(folder, 'verification.json'), 'utf8'));
report.source_sha256 = originalHash;
report.source_unchanged = true;
report.detected_frames = JSON.parse(await readFile(path.join(folder, 'landmarks.json'), 'utf8')).detected_frames;
await writeFile(path.join(folder, 'verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ folder, ...report }, null, 2));
