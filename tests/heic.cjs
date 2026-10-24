// Run with: node tests/heic.cjs
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = readFileSync('index.html', 'utf8');
const helper = html.slice(html.indexOf('const isHeicFile'), html.indexOf('/* ---------- adding files:'));
let conversions = 0, loads = 0, fail = false, native = false, revoked = 0;
const context = vm.createContext({
  Blob, Map, WeakMap, Promise,
  window: { HeicTo: async ({ blob, type }) => {
    conversions++;
    assert.equal(type, 'image/png');
    if (fail) throw new Error('Invalid HEIC');
    return new Blob(['converted'], { type });
  } },
  document: {
    createElement: () => ({ remove() {} }),
    head: { appendChild(script) { loads++; queueMicrotask(() => script.onload()); } }
  },
  createImageBitmap: async blob => {
    if (blob.type !== 'image/png' && !native) throw new Error('Unsupported image');
    return { width: 800, height: 600, close() {} };
  },
  Image: class { async decode() { throw new Error('Unsupported image'); } },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => revoked++ }
});
vm.runInContext(helper, context);
const file = (name, type = '') => Object.assign(new Blob(['heic'], { type }), { name });
(async () => {
  assert(context.isHeicFile === undefined); // lexical helper is accessed through the context
  const isHeic = vm.runInContext('isHeicFile', context);
  assert(isHeic(file('PHOTO.HEIC')));
  assert(isHeic(file('image', 'image/heif')));
  assert(!isHeic(file('photo.jpg', 'image/jpeg')));
  const photo = file('photo.heic');
  const [a, b] = await Promise.all([context.decodeMain(photo), context.decodeMain(photo, 200)]);
  assert.equal(a.w, 800); assert.equal(b.h, 600);
  assert.equal(conversions, 1); assert.equal(loads, 1);
  await context.decodeMain(photo);
  assert.equal(conversions, 1); // preview/export reuse
  await assert.rejects(context.decodeMain(file('broken.jpg')), /Unsupported/);
  assert.equal(conversions, 1); // other formats never enter HEIC conversion
  fail = true;
  const broken = file('broken.heif');
  await assert.rejects(context.decodeMain(broken), /Could not decode HEIC/);
  fail = false;
  await context.decodeMain(broken); // failed conversions can retry
  native = true;
  const before = conversions;
  await context.decodeMain(file('native.heic'));
  assert.equal(conversions, before);
  assert(revoked > 0);
  assert.equal(readFileSync('deploy/watermark/index.html', 'utf8'), html);
  console.log('Passed HEIC detection, native decoding, fallback, shared conversion, retry, and synced deployment checks.');
})().catch(err => { console.error(err); process.exitCode = 1; });
