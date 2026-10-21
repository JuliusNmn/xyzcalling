import express from 'express';
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.basename(here) === 'dist-server' ? path.dirname(here) : here;
const videoDirectory = path.resolve(process.env.VIDEO_DIR || path.join(root, 'videos'));
const extensions = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
const app = express();
app.disable('x-powered-by');

async function videoFiles() {
  return (await readdir(videoDirectory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()));
}

app.get('/api/videos', async (_request, response) => {
  const files = await videoFiles();
  const videos = await Promise.all(files.map(async file => ({
    name: file.name,
    title: file.name.replace(/\.[^.]+$/, ''),
    url: `/videos/${encodeURIComponent(file.name)}`,
    bytes: (await stat(path.join(videoDirectory, file.name))).size,
    analysisUrl: `/api/videos/${encodeURIComponent(file.name)}/analysis`,
  })));
  response.setHeader('Cache-Control', 'no-store');
  response.json({ videos: videos.sort((a, b) => a.name.localeCompare(b.name)) });
});

app.get('/api/videos/:name/analysis', async (request, response) => {
  const name = request.params.name;
  if (!(await videoFiles()).some(file => file.name === name)) {
    response.status(404).json({ error: 'Video not found' }); return;
  }
  response.setHeader('Cache-Control', 'no-store');
  try {
    const info = await stat(path.join(videoDirectory, name));
    const data = JSON.parse(await readFile(path.join(videoDirectory, name + '.analysis.json'), 'utf8'));
    if (!data || data.schema !== 'pose-studio.audio-analysis' || data.version !== 1 || data.source?.name !== name ||
        data.source?.bytes !== info.size || !Number.isFinite(data.source?.mtime_ms) || Math.abs(data.source?.mtime_ms - Math.floor(info.mtimeMs)) > 1) {
      response.status(409).json({ error: 'Analysis is stale. Regenerate it with npm run analyze:audio -- --force.' }); return;
    }
    response.json(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      response.status(404).json({ error: 'No audio analysis yet. Run npm run analyze:audio, then reload analysis.' });
    } else if (error instanceof SyntaxError) {
      response.status(422).json({ error: 'Invalid analysis JSON. Regenerate it with --force.' });
    } else { throw error; }
  }
});

app.get('/videos/:name', async (request, response) => {
  const name = request.params.name;
  if (!(await videoFiles()).some(file => file.name === name)) {
    response.status(404).json({ error: 'Video not found' });
    return;
  }
  response.sendFile(name, { root: videoDirectory, dotfiles: 'deny' });
});
app.use('/wasm', express.static(path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm')));
app.use('/character', express.static(path.join(root, 'amsterdam-hackathon/Geo'), { dotfiles: 'deny' }));
app.get('/models/pose_landmarker_full.task', (_request, response) => {
  response.sendFile(path.join(root, 'models/pose_landmarker_full.task'));
});
app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));

if (process.env.NODE_ENV !== 'development' && existsSync(path.join(root, 'dist/index.html'))) {
  app.use(express.static(path.join(root, 'dist')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error.message);
  response.status(500).json({ error: 'Could not read the video library. Check the server log.' });
});

function zeroTierHost(): string {
  try {
    const networks = JSON.parse(execFileSync('/usr/local/bin/zerotier-cli', ['-j', 'listnetworks'], { encoding: 'utf8' }));
    const localIPs = Object.values(networkInterfaces()).flat().map(item => item?.address);
    for (const network of networks) {
      if (network.status !== 'OK') continue;
      for (const address of network.assignedAddresses ?? []) {
        const ip = address.split('/')[0];
        if (ip.includes('.') && localIPs.includes(ip)) return ip;
      }
    }
  } catch { /* A caller can always provide HOST explicitly. */ }
  if (process.env.REQUIRE_ZEROTIER === '1') throw new Error('Waiting for an active ZeroTier IPv4 interface.');
  return '127.0.0.1';
}
const host = process.env.HOST || zeroTierHost();
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, host, () => {
  console.log(`Pose Studio: http://${host}:${port}`);
  console.log(`Video library: ${videoDirectory}`);
});
server.on('error', error => { console.error(error); process.exit(1); });
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
