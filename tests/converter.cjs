const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('../deploy/convert/codecs.js');
(async () => {
  assert.deepEqual(C.dimensions(4000, 3000, 1024), [1024, 768]);
  assert.deepEqual(C.dimensions(20, 10, 256), [20, 10]);
  const names = new Set();
  assert.equal(C.uniqueName('a.heic', 'png', names), 'a.png');
  assert.equal(C.uniqueName('a.jpg', 'png', names), 'a (2).png');
  assert.equal(C.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const bmp = C.bmp({ width: 2, height: 1, data: [255,0,0,255,0,255,0,255] });
  const b = new Uint8Array(await bmp.arrayBuffer()), v = new DataView(b.buffer);
  assert.equal(v.getInt32(22, true), -1);
  assert.equal(b.length, 62); assert.deepEqual([...b.slice(54)], [0,0,255,0,255,0,0,0]);
  const zip = await C.zip([{ name: 'héllo.png', blob: new Blob(['hello']) }, { name: 'other.bmp', blob: bmp }]);
  fs.writeFileSync('/tmp/converter-test.zip', Buffer.from(await zip.arrayBuffer()));
  console.log('Passed dimensions, collision-safe filenames, CRC32, BMP layout, and ZIP generation.');
})().catch(err => { console.error(err); process.exitCode = 1; });
