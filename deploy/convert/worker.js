'use strict';
importScripts('codecs.js', 'engine.js');
self.onmessage = async ({ data }) => {
  try { self.postMessage({ value: await ImageConverterEngine.convert(data.file, data.options) }); }
  catch (error) { self.postMessage({ error: error.message || String(error) }); }
};
if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
  throw new Error('Worker image conversion is unavailable.');
}
self.postMessage({ ready: true });
