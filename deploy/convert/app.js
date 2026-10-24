'use strict';
const $ = s => document.querySelector(s);
const C = ConverterCodecs;
const items = [];
let busy = false, stopped = false, nextId = 1;
const bytes = n => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
function decode(file) { return ImageConverterEngine.decode(file); }
const { canvas, toBlob } = ImageConverterEngine;
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
$('#cancel').onclick = () => { stopped = true; $('#cancel').disabled = true; $('#status').textContent = 'Stopping after active conversions finish…'; };
$('#convert').onclick = async () => {
  if (busy || !items.length) return;
  const options = { format: $('#format').value, quality: +$('#quality').value / 100, max: +$('#size').value, background: $('#background').value };
  const requested = +$('#parallel').value;
  busy = true; stopped = false; refresh(); $('#cancel').hidden = false; $('#cancel').disabled = false;
  $('#progress').hidden = false; $('#progress').max = items.length; $('#progress').value = 0;
  const names = new Set(); let success = 0, errors = 0, outputBytes = 0, completed = 0;
  // Allocate names in input order, independent of worker completion order.
  for (const item of items) {
    release(item); item.name = C.uniqueName(item.file.name, C.formats[options.format][1], names);
    item.link.hidden = true; item.img.hidden = true; item.status.classList.remove('error'); item.status.textContent = 'Waiting…';
  }
  const pool = new ConverterPool(ImageConverterEngine.convert);
  try {
    const count = ConverterPool.workerCount(navigator, items.map(i => i.file), requested);
    await pool.start(count);
    const mode = pool.workers.length ? `${pool.workers.length} parallel worker${pool.workers.length === 1 ? '' : 's'}` : 'compatibility mode';
    $('#status').textContent = `Starting ${mode}…`;
    await pool.run(items, async (item, process) => {
      item.status.textContent = 'Converting…';
      try {
        const { result, thumbnail, width, height } = await process(item.file, options);
        // This check and reservation run together on the main thread before any await.
        if (outputBytes + result.size > 512 * 1024 ** 2) { stopped = true; throw new Error('Batch output reached 512 MB. Download completed files, then use a smaller batch.'); }
        outputBytes += result.size;
        item.thumb = URL.createObjectURL(thumbnail); item.img.src = item.thumb; item.img.hidden = false;
        item.result = result; item.url = URL.createObjectURL(result);
        item.link.href = item.url; item.link.download = item.name; item.link.textContent = `Download ${item.name}`; item.link.hidden = false;
        item.meta.textContent = `${bytes(item.file.size)} → ${bytes(result.size)} · ${width} × ${height}`;
        item.status.textContent = 'Converted'; success++;
      } catch (err) { item.status.textContent = err.message || String(err); item.status.classList.add('error'); errors++; }
      completed++; $('#progress').value = completed;
      $('#status').textContent = `${stopped ? 'Finishing active images' : `Converting with ${mode}`} · ${completed} of ${items.length} finished`;
    }, () => stopped);
  } catch (err) { errors++; $('#status').textContent = err.message; }
  finally {
    pool.close();
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
