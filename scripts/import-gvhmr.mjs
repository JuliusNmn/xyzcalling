// Register title-named FBXs from another machine without renaming/copying motion files.
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { LoadingManager, Texture, TextureLoader } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const run = promisify(execFile);
const videoExtensions = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
const normalized = value => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function matchingAnimations(video, title, files) {
  const stem = path.parse(video).name;
  const titles = [stem.replace(/\s*\[[^\]]+\]$/, ''), title].filter(Boolean);
  // Download descriptions can append hashtags after the actual title.
  const identities = new Set(titles.flatMap(value => [normalized(value), normalized(value.split(/\s+#/)[0])]));
  return files.filter(file => file.endsWith('.gvhmr.fbx') && identities.has(normalized(file.slice(0, -10))));
}
class EmptyTextureLoader extends TextureLoader {
  load(url) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return new Texture(); }
}
async function inspectFbx(file) {
  // FBXLoader uses window.URL for embedded images; no image pixels are needed here.
  globalThis.window = { URL };
  const manager = new LoadingManager(); manager.addHandler(/.*/, new EmptyTextureLoader());
  const bytes = await readFile(file);
  const model = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  try {
    const bones = []; model.traverse(object => { if (object.isBone) bones.push(object.name); });
    const clip = model.animations.find(clip => clip.duration > 0 && clip.tracks.length);
    if (bones.length !== 65 || !bones.includes('mixamorigHips') || !clip) throw new Error('Expected an animated 65-bone Mixamo FBX.');
    return clip.duration;
  } finally {
    model.traverse(object => {
      object.geometry?.dispose(); object.skeleton?.dispose();
      if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    });
  }
}
export async function importGvhmr(directory) {
  const files = await readdir(directory), report = [];
  for (const name of files.filter(file => videoExtensions.has(path.extname(file).toLowerCase()))) {
    const stem = path.parse(name).name, sidecar = path.join(directory, stem + '.gvhmr.json');
    try {
      await stat(sidecar);
      report.push({ video: name, status: 'existing metadata' }); continue;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let title;
    try { title = JSON.parse(await readFile(path.join(directory, stem + '.info.json'), 'utf8')).title; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const candidates = files.includes(stem + '.gvhmr.fbx') ? [stem + '.gvhmr.fbx'] : matchingAnimations(name, title, files);
    if (candidates.length !== 1) {
      report.push({ video: name, status: candidates.length ? 'ambiguous — not linked' : 'no match', candidates }); continue;
    }
    const fbx = candidates[0], video = path.join(directory, name);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', video]);
    const videoDuration = Number(JSON.parse(stdout).format.duration);
    const duration = await inspectFbx(path.join(directory, fbx));
    if (!Number.isFinite(videoDuration) || Math.abs(videoDuration - duration) > .25) {
      report.push({ video: name, status: 'duration mismatch — not linked', fbx, videoDuration, duration }); continue;
    }
    const bytes = await readFile(video), info = await stat(video);
    const metadata = { file: name, fbx_file: fbx, duration, video_duration: videoDuration,
      sha256: createHash('sha256').update(bytes).digest('hex'), bytes: info.size,
      imported_at: new Date().toISOString(), origin: 'imported-fbx',
      matching: 'Unique normalized title and full animation duration (within 250 ms).',
      held_black_outro_frames: null,
      note: 'Imported FBX only. Original inference metadata and per-frame confidence were not supplied.' };
    await writeFile(sidecar, JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
    const row = { video: name, status: 'linked', fbx, videoDuration, duration };
    report.push(row); console.log(JSON.stringify(row));
  }
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(process.argv[2] || process.env.VIDEO_DIR || new URL('../videos/', import.meta.url).pathname);
  console.log(JSON.stringify(await importGvhmr(directory), null, 2));
}
