/* Uncompressed BMP, PNG-in-ICO, and stored ZIP containers. */
(function (root) {
  const formats = {
    jpeg: ['image/jpeg', 'jpg'], png: ['image/png', 'png'], webp: ['image/webp', 'webp'],
    bmp: ['image/bmp', 'bmp'], tiff: ['image/tiff', 'tiff'], ico: ['image/x-icon', 'ico']
  };
  function dimensions(w, h, max = 0) {
    if (!(w > 0 && h > 0 && Number.isFinite(w * h))) throw new Error('Invalid image dimensions.');
    const scale = max ? Math.min(1, max / Math.max(w, h)) : 1;
    return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
  }
  function bmp({ width: w, height: h, data }) {
    const stride = Math.ceil(w * 3 / 4) * 4;
    const bytes = new Uint8Array(54 + stride * h), v = new DataView(bytes.buffer);
    v.setUint16(0, 0x4d42, true); v.setUint32(2, bytes.length, true); v.setUint32(10, 54, true);
    v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, -h, true);
    v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, stride * h, true);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, o = 54 + y * stride + x * 3;
      bytes[o] = data[i + 2]; bytes[o + 1] = data[i + 1]; bytes[o + 2] = data[i];
    }
    return new Blob([bytes], { type: 'image/bmp' });
  }
  function ico(png) {
    const header = new Uint8Array(22), v = new DataView(header.buffer);
    v.setUint16(2, 1, true); v.setUint16(4, 1, true); // 0 width/height means 256px
    v.setUint16(10, 1, true); v.setUint16(12, 32, true);
    v.setUint32(14, png.size, true); v.setUint32(18, 22, true);
    return new Blob([header, png], { type: 'image/x-icon' });
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function uniqueName(name, ext, used) {
    const base = (name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim() || 'image').slice(0, 120);
    let result = `${base}.${ext}`, n = 2;
    while (used.has(result.toLowerCase())) result = `${base} (${n++}).${ext}`;
    used.add(result.toLowerCase()); return result;
  }
  async function zip(files) {
    if (files.length > 65535 || files.reduce((n, f) => n + f.blob.size + 1024, 0) > 1024 ** 3) throw new Error('ZIP is too large. Download images individually or convert a smaller batch.');
    const parts = [], directory = []; let offset = 0, directorySize = 0;
    for (const file of files) {
      const name = new TextEncoder().encode(file.name), data = new Uint8Array(await file.blob.arrayBuffer());
      const crc = crc32(data), local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
      l.setUint16(12, 33, true); // 1980-01-01
      l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true);
      l.setUint16(26, name.length, true); local.set(name, 30);
      const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
      c.setUint16(14, 33, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true); central.set(name, 46);
      parts.push(local, file.blob); directory.push(central); directorySize += central.length; offset += local.length + data.length;
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
    return new Blob([...parts, ...directory, end], { type: 'application/zip' });
  }
  root.ConverterCodecs = { formats, dimensions, bmp, ico, crc32, uniqueName, zip };
  if (typeof module !== 'undefined') module.exports = root.ConverterCodecs;
})(globalThis);
