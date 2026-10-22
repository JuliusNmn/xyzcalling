import express from 'express';
import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHARACTERS, registerCharacter } from './src/characters.js';

/** Only files discovered in the configured model directory become export targets. */
export function characterRoutes(root: string) {
  const router = express.Router();
  const directory = path.resolve(process.env.CHARACTER_DIR || path.join(root, 'assets/characters'));
  const builtins = CHARACTERS.filter(character => !character.id.startsWith('model-'));
  const entry = (name: string) => registerCharacter({
    id: `model-${createHash('sha256').update(name).digest('hex').slice(0, 16)}`,
    name: name.replace(/(?:-[a-f0-9]{12})?\.fbx$/i, ''), url: `/api/characters/files/${encodeURIComponent(name)}`,
    file: path.join(directory, name),
  });
  router.get('/', async (_request, response) => {
    await mkdir(directory, { recursive: true });
    const files = (await readdir(directory, { withFileTypes: true }))
      .filter(file => file.isFile() && /\.fbx$/i.test(file.name));
    const characters = [...builtins, ...files.filter(file => !builtins.some(c => path.resolve(root, c.file) === path.join(directory, file.name))).map(file => entry(file.name))];
    response.setHeader('Cache-Control', 'no-store');
    response.json({ characters });
  });
  router.use('/files', express.static(directory, { dotfiles: 'deny' }));
  router.post('/', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (request, response) => {
    const bytes = request.body;
    const name = typeof request.query.name === 'string' ? request.query.name : '';
    if (!/\.fbx$/i.test(name) || !Buffer.isBuffer(bytes) || bytes.length < 32 ||
        !/Kaydara FBX Binary|FBXHeaderExtension/.test(bytes.subarray(0, 4096).toString('utf8'))) {
      response.status(422).json({ error: 'Choose a valid character FBX file.' }); return;
    }
    const stem = path.basename(name.replaceAll('\\', '/')).replace(/\.fbx$/i, '').replace(/[^\p{L}\p{N}_ -]/gu, '').slice(0, 80) || 'character';
    const filename = `${stem}-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.fbx`;
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, filename), bytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    response.status(201).json({ character: entry(filename) });
  });
  return router;
}
