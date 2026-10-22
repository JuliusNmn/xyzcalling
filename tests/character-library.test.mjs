import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { characterRoutes } from '../characters-server.ts';
import { characterDefinition } from '../src/characters.ts';

test('character directory and uploads register stable export targets without accepting file paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pose-models-'));
  const directory = path.join(root, 'assets/characters');
  await mkdir(directory, { recursive: true });
  const bytes = await readFile(new URL('../assets/characters/green-segments.fbx', import.meta.url));
  await writeFile(path.join(directory, 'Dancer.fbx'), bytes);
  await writeFile(path.join(directory, 'ignore.txt'), 'not a model');
  await writeFile(path.join(root, 'outside.fbx'), bytes);
  await symlink(path.join(root, 'outside.fbx'), path.join(directory, 'symlink.fbx'));
  const app = express(); app.use('/api/characters', characterRoutes(root));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const catalog = await (await fetch(base + '/api/characters')).json();
    const model = catalog.characters.find(c => c.name === 'Dancer');
    assert(model); assert.equal(catalog.characters.length, 3);
    assert.equal(characterDefinition(model.id).file, path.join(directory, 'Dancer.fbx'));
    assert.deepEqual(Buffer.from(await (await fetch(base + model.url)).arrayBuffer()), bytes);
    const invalid = await fetch(base + '/api/characters?name=bad.fbx', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'not an FBX' });
    assert.equal(invalid.status, 422);
    const upload = () => fetch(base + '/api/characters?name=' + encodeURIComponent('../../New character.fbx'), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    const response = await upload(); assert.equal(response.status, 201);
    const { character } = await response.json();
    assert.equal(path.dirname(character.file), directory);
    assert.deepEqual(await readFile(character.file), bytes);
    const duplicate = await (await upload()).json(); assert.equal(duplicate.character.id, character.id);
    const refreshed = await (await fetch(base + '/api/characters')).json();
    assert(refreshed.characters.some(c => c.id === character.id));
    assert.throws(() => characterDefinition('../../outside.fbx'), /Unknown character/);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});
