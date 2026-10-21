import { mkdir, access, writeFile, rename, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await mkdir(new URL('videos/', root), { recursive: true });
await mkdir(new URL('models/', root), { recursive: true });
const model = new URL('models/pose_landmarker_full.task', root);
try { await access(model); }
catch {
  const response = await fetch('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task');
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  const temporary = fileURLToPath(model) + '.download';
  try {
    await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
    await rename(temporary, model);
  } finally { await unlink(temporary).catch(() => {}); }
}
console.log('Video directory and pose model ready.');
