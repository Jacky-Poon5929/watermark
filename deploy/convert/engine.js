/* Shared main-thread and worker image pipeline. */
(function(root) {
const C = root.ConverterCodecs;
const inWorker = typeof document === 'undefined';
const loads = new Map();
function loadScript(src) {
  if (inWorker) { if (!loads.has(src)) { importScripts(src); loads.set(src, Promise.resolve()); } return loads.get(src); }
  if (!loads.has(src)) loads.set(src, new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = src;
    script.onload = resolve;
    script.onerror = () => { script.remove(); loads.delete(src); reject(new Error('Could not load image support. Reload and try again.')); };
    document.head.appendChild(script);
  }));
  return loads.get(src);
}
async function loadTiff() { await loadScript('vendor/pako_inflate.min.js'); await loadScript('vendor/UTIF.js'); }
function checkSize(w, h) {
  if (!(w > 0 && h > 0) || w * h > 40e6 || Math.max(w, h) > 16384) throw new Error('Image is too large. Use an image under 40 megapixels and 16,384 px per side.');
}
function canvas(w, h) {
  checkSize(w, h); const c = inWorker ? new OffscreenCanvas(w, h) : document.createElement('canvas'); c.width = w; c.height = h;
  return c;
}
async function decode(file) {
  // Decode TIFF explicitly so page selection is consistent across browsers.
  if (/\.tiff?$/i.test(file.name) || /^image\/tiff$/i.test(file.type)) {
    await loadTiff(); const buffer = await file.arrayBuffer(); const page = UTIF.decode(buffer).find(p => p.t256 && p.t257);
    if (!page) throw new Error('No image found in this TIFF.');
    checkSize(page.t256[0], page.t257[0]); UTIF.decodeImage(buffer, page);
    const c = canvas(page.width, page.height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(page)), page.width, page.height), 0, 0);
    // Honour TIFF orientation instead of carrying metadata into the result.
    const orientation = page.t274?.[0] || 1;
    if (orientation > 1 && orientation <= 8) {
      const w = c.width, h = c.height, swapped = orientation >= 5;
      const out = canvas(swapped ? h : w, swapped ? w : h), ctx = out.getContext('2d');
      const transforms = { 2: [-1,0,0,1,w,0], 3: [-1,0,0,-1,w,h], 4: [1,0,0,-1,0,h], 5: [0,1,1,0,0,0], 6: [0,1,-1,0,h,0], 7: [0,-1,-1,0,h,w], 8: [0,-1,1,0,0,w] };
      ctx.setTransform(...transforms[orientation]); ctx.drawImage(c, 0, 0); c.width = c.height = 1;
      return { src: out, w: out.width, h: out.height, close() { out.width = out.height = 1; } };
    }
    return { src: c, w: c.width, h: c.height, close() { c.width = c.height = 1; } };
  }
  try {
    const bitmap = await createImageBitmap(file);
    return { src: bitmap, w: bitmap.width, h: bitmap.height, close: () => bitmap.close() };
  } catch {}
  if (!inWorker) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch { URL.revokeObjectURL(url); }
  }
  if (/\.hei[cf]$/i.test(file.name) || /^image\/hei[cf](?:-sequence)?$/i.test(file.type)) {
    await loadScript('../watermark/vendor/heic-to-1.5.2.js');
    try {
      const bitmap = await HeicTo({ blob: file, type: 'bitmap' });
      return { src: bitmap, w: bitmap.width, h: bitmap.height, close: () => bitmap.close() };
    } catch { throw new Error('This HEIC variant could not be decoded. Try exporting it as JPEG or PNG from your photo app.'); }
  }
  throw new Error('This file is damaged or its format is not supported by this browser.');
}
function toBlob(c, type, quality) {
  if (inWorker) {
    return c.convertToBlob({ type, quality }).then(blob => {
      if (blob.type !== type) throw new Error(`Your browser cannot export ${type.split('/')[1].toUpperCase()}. Choose another format.`);
      return blob;
    });
  }
  return new Promise((resolve, reject) => c.toBlob(blob => {
    if (!blob || blob.type !== type) reject(new Error(`Your browser cannot export ${type.split('/')[1].toUpperCase()}. Choose another format.`));
    else resolve(blob);
  }, type, quality));
}
async function encode(c, format, quality) {
  if (format === 'bmp') return C.bmp(c.getContext('2d').getImageData(0, 0, c.width, c.height));
  if (format === 'tiff') {
    await loadTiff();
    return new Blob([UTIF.encodeImage(c.getContext('2d').getImageData(0, 0, c.width, c.height).data.buffer, c.width, c.height)], { type: 'image/tiff' });
  }
  if (format === 'ico') return C.ico(await toBlob(c, 'image/png'));
  return toBlob(c, C.formats[format][0], quality);
}
async function convert(file, { format, quality, max, background }) {
  let decoded, out, thumb;
  try {
    decoded = await decode(file); checkSize(decoded.w, decoded.h);
    const [w, h] = C.dimensions(decoded.w, decoded.h, format === 'ico' ? 256 : max);
    out = canvas(format === 'ico' ? 256 : w, format === 'ico' ? 256 : h);
    const ctx = out.getContext('2d');
    if (format === 'jpeg' || format === 'bmp') { ctx.fillStyle = background; ctx.fillRect(0, 0, out.width, out.height); }
    ctx.drawImage(decoded.src, (out.width - w) / 2, (out.height - h) / 2, w, h);
    const result = await encode(out, format, quality);
    const [tw, th] = C.dimensions(out.width, out.height, 120);
    thumb = canvas(tw, th); thumb.getContext('2d').drawImage(out, 0, 0, tw, th);
    return { result, thumbnail: await toBlob(thumb, 'image/png'), width: out.width, height: out.height };
  } finally { decoded?.close(); if (out) out.width = out.height = 1; if (thumb) thumb.width = thumb.height = 1; }
}
root.ImageConverterEngine = { convert, decode, canvas, toBlob };
})(globalThis);
