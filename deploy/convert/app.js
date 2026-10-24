'use strict';
const $ = s => document.querySelector(s);
const C = ConverterCodecs;
const items = [];
let busy = false, stopped = false, nextId = 1;
const loads = new Map();
const bytes = n => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
function loadScript(src) {
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
  checkSize(w, h); const c = document.createElement('canvas'); c.width = w; c.height = h;
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
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch { URL.revokeObjectURL(url); }
  if (/\.hei[cf]$/i.test(file.name) || /^image\/hei[cf](?:-sequence)?$/i.test(file.type)) {
    await loadScript('../watermark/vendor/heic-to-1.5.2.js');
    try {
      const png = await HeicTo({ blob: file, type: 'image/png' });
      return await decode(png);
    } catch { throw new Error('This HEIC variant could not be decoded. Try exporting it as JPEG or PNG from your photo app.'); }
  }
  throw new Error('This file is damaged or its format is not supported by this browser.');
}
function toBlob(c, type, quality) {
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
function release(item) {
  for (const key of ['url', 'thumb']) if (item[key]) { URL.revokeObjectURL(item[key]); item[key] = null; }
  item.result = null;
}
function refresh() {
  $('#count').textContent = items.length;
  $('#empty').hidden = !!items.length;
  $('#convert').disabled = busy || !items.length;
  $('#clear').disabled = busy || !items.length;
  $('#download-all').disabled = busy || !items.some(i => i.result);
  $('#browse').disabled = busy; $('#files').disabled = busy;
  for (const input of document.querySelectorAll('.settings select,.settings input')) input.disabled = busy;
  for (const button of document.querySelectorAll('.remove')) button.disabled = busy;
  $('#size').disabled = busy || $('#format').value === 'ico';
}
function makeRow(item) {
  const li = document.createElement('li'); li.className = 'file';
  const img = document.createElement('img'); img.className = 'thumb'; img.alt = ''; img.hidden = true;
  const info = document.createElement('div'); info.className = 'info';
  const name = document.createElement('div'); name.className = 'name'; name.textContent = item.file.name;
  const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = bytes(item.file.size);
  const status = document.createElement('div'); status.className = 'file-status'; status.textContent = 'Ready to convert';
  const link = document.createElement('a'); link.hidden = true;
  info.append(name, meta, status, link);
  const remove = document.createElement('button'); remove.className = 'quiet remove'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${item.file.name}`);
  remove.onclick = () => { if (busy) return; release(item); items.splice(items.indexOf(item), 1); li.remove(); refresh(); };
  li.append(img, info, remove); $('#list').append(li); Object.assign(item, { img, meta, status, link });
}
function addFiles(files) {
  if (busy) return;
  let skipped = 0, duplicate = 0;
  for (const file of files) {
    if (!/^image\//i.test(file.type) && !/\.(heic|heif|jpe?g|png|webp|gif|bmp|avif|svg|ico|tiff?)$/i.test(file.name)) { skipped++; continue; }
    if (items.some(i => i.file.name === file.name && i.file.size === file.size && i.file.lastModified === file.lastModified)) { duplicate++; continue; }
    if (items.length >= 100 || file.size > 100 * 1024 ** 2) { skipped++; continue; }
    const item = { id: nextId++, file }; items.push(item); makeRow(item);
  }
  $('#status').textContent = `${items.length} image(s) ready.${duplicate ? ` ${duplicate} duplicate(s) skipped.` : ''}${skipped ? ` ${skipped} file(s) skipped: images only, max 100 files and 100 MB per file.` : ''}`;
  refresh();
}
$('#browse').onclick = () => $('#files').click();
$('#files').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
for (const event of ['dragenter','dragover']) $('#dropzone').addEventListener(event, e => { e.preventDefault(); if (!busy) $('#dropzone').classList.add('drag'); });
$('#dropzone').addEventListener('dragleave', () => $('#dropzone').classList.remove('drag'));
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => { e.preventDefault(); $('#dropzone').classList.remove('drag'); addFiles(e.dataTransfer.files); });
$('#clear').onclick = () => { if (busy) return; items.forEach(release); items.length = 0; $('#list').replaceChildren(); $('#progress').hidden = true; $('#status').textContent = 'Choose images to get started.'; refresh(); };
const notes = { jpeg: 'Smaller files; transparency is replaced with your chosen background.', png: 'Lossless output. Keeps transparency.', webp: 'Adjustable quality. Keeps transparency when supported by your browser.', bmp: 'Uncompressed 24-bit image. Uses your chosen background.', tiff: 'Uncompressed 8-bit RGBA. Keeps transparency; files may be large.', ico: 'A PNG-based 256 × 256 icon, padded with transparency. No cropping.' };
function settingsChanged() {
  const format = $('#format').value;
  $('#format-note').textContent = notes[format];
  $('#quality-row').hidden = !['jpeg','webp'].includes(format);
  $('#background-row').hidden = !['jpeg','bmp'].includes(format);
  $('#size').disabled = busy || format === 'ico';
  $('#quality-value').textContent = `${$('#quality').value}%`;
  if (items.some(i => i.result)) $('#status').textContent = 'Settings changed. Convert again to update your downloads.';
}
for (const input of document.querySelectorAll('.settings select,.settings input')) input.addEventListener('input', settingsChanged);
$('#cancel').onclick = () => { stopped = true; $('#cancel').disabled = true; $('#status').textContent = 'Stopping after the current image…'; };
$('#convert').onclick = async () => {
  if (busy || !items.length) return;
  const format = $('#format').value, quality = +$('#quality').value / 100, max = +$('#size').value, background = $('#background').value;
  busy = true; stopped = false; refresh(); $('#cancel').hidden = false; $('#cancel').disabled = false;
  $('#progress').hidden = false; $('#progress').max = items.length; $('#progress').value = 0;
  const names = new Set(); let success = 0, errors = 0, outputBytes = 0;
  for (const item of items) { release(item); item.link.hidden = true; item.img.hidden = true; item.status.classList.remove('error'); item.status.textContent = 'Waiting…'; }
  try {
    for (let i = 0; i < items.length && !stopped; i++) {
      const item = items[i]; let decoded, out, thumb;
      item.status.textContent = 'Converting…'; $('#status').textContent = `Converting ${i + 1} of ${items.length}: ${item.file.name}`;
      await new Promise(resolve => setTimeout(resolve, 0));
      try {
        decoded = await decode(item.file); checkSize(decoded.w, decoded.h);
        const [w, h] = C.dimensions(decoded.w, decoded.h, format === 'ico' ? 256 : max);
        out = canvas(format === 'ico' ? 256 : w, format === 'ico' ? 256 : h);
        const ctx = out.getContext('2d');
        if (format === 'jpeg' || format === 'bmp') { ctx.fillStyle = background; ctx.fillRect(0, 0, out.width, out.height); }
        ctx.drawImage(decoded.src, (out.width - w) / 2, (out.height - h) / 2, w, h);
        const result = await encode(out, format, quality);
        if (outputBytes + result.size > 512 * 1024 ** 2) { stopped = true; throw new Error('Batch output reached 512 MB. Download completed files, then use a smaller batch.'); }
        const [tw, th] = C.dimensions(out.width, out.height, 120); thumb = canvas(tw, th); thumb.getContext('2d').drawImage(out, 0, 0, tw, th);
        item.thumb = URL.createObjectURL(await toBlob(thumb, 'image/png')); item.img.src = item.thumb; item.img.hidden = false;
        item.result = result; outputBytes += result.size; item.name = C.uniqueName(item.file.name, C.formats[format][1], names);
        item.url = URL.createObjectURL(result); item.link.href = item.url; item.link.download = item.name; item.link.textContent = `Download ${item.name}`; item.link.hidden = false;
        item.meta.textContent = `${bytes(item.file.size)} → ${bytes(result.size)} · ${out.width} × ${out.height}`;
        item.status.textContent = 'Converted'; success++;
      } catch (err) { item.status.textContent = err.message || String(err); item.status.classList.add('error'); errors++; }
      finally { decoded?.close(); if (out) out.width = out.height = 1; if (thumb) thumb.width = thumb.height = 1; }
      $('#progress').value = i + 1;
    }
  } finally {
    for (const item of items) if (item.status.textContent === 'Waiting…') item.status.textContent = 'Not converted';
    busy = false; $('#cancel').hidden = true; refresh(); settingsChanged();
    $('#status').textContent = `${stopped ? 'Stopped. ' : ''}${success} converted${errors ? `, ${errors} failed` : ''}. ${success ? 'Your downloads are ready.' : 'Check the file messages and try again.'}`;
  }
};
$('#download-all').onclick = async () => {
  if (busy) return;
  busy = true; refresh(); $('#status').textContent = 'Preparing ZIP…';
  try {
    const blob = await C.zip(items.filter(i => i.result).map(i => ({ name: i.name, blob: i.result })));
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'converted-images.zip'; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000); $('#status').textContent = 'ZIP download started.';
  } catch (err) { $('#status').textContent = err.message; }
  finally { busy = false; refresh(); $('#size').disabled = $('#format').value === 'ico'; }
};
(async () => {
  try { await toBlob(canvas(1, 1), 'image/webp'); }
  catch { const option = $('#format option[value="webp"]'); option.disabled = true; option.textContent = 'WebP — unavailable in this browser'; }
})();
settingsChanged(); refresh();
