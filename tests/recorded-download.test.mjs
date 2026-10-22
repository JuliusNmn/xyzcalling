import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordedBytes, loadRecordedMotion } from '../src/recorded-animation.ts';

test('saved motion reports download and parse failures separately and never caches incomplete downloads', async () => {
  const originalFetch = globalThis.fetch;
  const asset = { url: '/diagnostic-test', revision: '1', bytes: 4 };
  const signal = new AbortController().signal;
  try {
    globalThis.fetch = async () => { throw new TypeError('Load failed'); };
    await assert.rejects(recordedBytes(asset, signal), /Animation download failed after .*Load failed/);
    globalThis.fetch = async () => new Response('', { status: 404 });
    await assert.rejects(recordedBytes(asset, signal), /HTTP 404/);
    globalThis.fetch = async () => new Response(new Uint8Array(2));
    await assert.rejects(recordedBytes(asset, signal), /Received 2 of 4 expected bytes/);
    let requests = 0;
    globalThis.fetch = async () => { requests++; return new Response(new Uint8Array(4)); };
    assert.equal((await recordedBytes(asset, signal)).byteLength, 4);
    await assert.rejects(loadRecordedMotion(asset, signal), /Animation parsing failed/);
    assert.equal(requests, 1);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(recordedBytes(asset, controller.signal), { name: 'AbortError' });
  } finally { globalThis.fetch = originalFetch; }
});

test('large animations download in bounded ranges, retry a broken chunk, and preserve all bytes', async () => {
  const originalFetch = globalThis.fetch;
  const bytes = Uint8Array.from({ length: 9 * 1024 * 1024 + 7 }, (_, i) => i % 251);
  const asset = { url: '/chunk-test', revision: '1', bytes: bytes.length };
  const calls = [], progress = [];
  let interruptions = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      const [, start, end] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range).map(Number);
      calls.push(start);
      assert(end - start + 1 <= 2 * 1024 * 1024);
      assert.equal(options.cache, 'no-store');
      if (start > 0) assert.equal(options.headers['If-Range'], '"asset-1"');
      if (start > 0 && interruptions < 9) {
        interruptions++;
        return { ok: true, status: 206, arrayBuffer: async () => { throw new TypeError('Load failed'); } };
      }
      return new Response(bytes.slice(start, end + 1), { status: 206, headers: {
        'Content-Range': `bytes ${start}-${end}/${bytes.length}`, ETag: '"asset-1"',
      } });
    };
    const result = await recordedBytes(asset, new AbortController().signal, text => progress.push(text));
    assert.deepEqual(new Uint8Array(result), bytes);
    assert.equal(calls.filter(start => start === 0).length, 1);
    assert.equal(calls.filter(start => start === 2 * 1024 * 1024).length, 10);
    assert.match(progress.at(-1), /9\.4 \/ 9\.4 MB/);
  } finally { globalThis.fetch = originalFetch; }
});

test('range downloads reject changed files and stop retries on cancellation', async () => {
  const originalFetch = globalThis.fetch;
  const asset = { url: '/changed-chunk-test', revision: '1', bytes: 9 * 1024 * 1024 };
  try {
    globalThis.fetch = async () => new Response(new Uint8Array(2 * 1024 * 1024), { status: 206, headers: { 'Content-Range': 'bytes 0-2097151/1' } });
    await assert.rejects(recordedBytes(asset, new AbortController().signal), /incomplete or changed/);
    const controller = new AbortController();
    let calls = 0;
    globalThis.fetch = async () => { calls++; controller.abort(); throw new TypeError('Load failed'); };
    await assert.rejects(recordedBytes(asset, controller.signal), { name: 'AbortError' });
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async () => { calls++; throw new TypeError('Load failed'); };
    await assert.rejects(recordedBytes(asset, new AbortController().signal), /after 10 attempts/);
    assert.equal(calls, 10);
  } finally { globalThis.fetch = originalFetch; }
});
