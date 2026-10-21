import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** Only discover sidecars paired with a video already admitted to the library. */
export async function recordedAnimation(directory: string, name: string) {
  if (path.basename(name) !== name || /[\\/]/.test(name)) return;
  const stem = name.replace(/\.[^.]+$/, '');
  try {
    const metadata = JSON.parse(await readFile(path.join(directory, `${stem}.gvhmr.json`), 'utf8'));
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return;
    const filename = metadata.fbx_file ?? `${stem}.gvhmr.fbx`;
    if (typeof filename !== 'string' || path.basename(filename) !== filename || /[\\/]/.test(filename) ||
        filename.startsWith('.') || !filename.endsWith('.gvhmr.fbx')) return;
    const info = await stat(path.join(directory, filename));
    if (metadata.file !== name || !Number.isFinite(metadata.duration) || metadata.duration <= 0 || !info.isFile() || !info.size) return;
    return { kind: 'gvhmr' as const, filename, url: `/api/videos/${encodeURIComponent(name)}/gvhmr`,
      duration: metadata.duration as number, bytes: info.size, revision: `${info.size}-${info.mtimeMs}`,
      heldOutroFrames: Number.isInteger(metadata.held_black_outro_frames) && metadata.held_black_outro_frames >= 0 ? metadata.held_black_outro_frames as number : null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return;
    throw error;
  }
}
