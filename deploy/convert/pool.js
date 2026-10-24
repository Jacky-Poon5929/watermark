/* Bounded worker lanes, with a serialized main-thread fallback for older browsers. */
(function(root) {
class Lane {
  constructor() {
    this.worker = new Worker('worker.js'); this.dead = false;
    this.ready = new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
    this.timer = setTimeout(() => this.fail(new Error('Worker startup timed out.')), 10000);
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending; if (!pending) return;
      clearTimeout(this.timer); this.pending = null;
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.value);
    };
    this.worker.onerror = event => { event.preventDefault(); this.fail(new Error(event.message || 'Worker failed.')); };
    this.worker.onmessageerror = () => this.fail(new Error('Could not read worker result.'));
  }
  fail(error) { this.dead = true; clearTimeout(this.timer); this.worker.terminate(); this.pending?.reject(error); this.pending = null; }
  convert(file, options) {
    if (this.dead) return Promise.reject(new Error('Worker unavailable.'));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.timer = setTimeout(() => this.fail(new Error('Image conversion timed out.')), 120000);
      try { this.worker.postMessage({ file, options }); } catch (err) { this.fail(err); }
    });
  }
  close() { this.fail(new Error('Worker closed.')); }
}
class ConverterPool {
  constructor(fallback) { this.workers = []; this.fallback = fallback; this.fallbackQueue = Promise.resolve(); }
  static workerCount(device, files, requested = 0) {
    const cpu = Math.max(1, (device.hardwareConcurrency || 4) - 1);
    const memory = device.deviceMemory || 4;
    const cap = memory <= 2 ? 1 : memory <= 4 ? 2 : 4;
    const large = files.some(f => f.size > 20 * 1024 ** 2);
    return Math.max(1, Math.min(files.length || 1, requested || 4, cpu, cap, large ? 1 : 4));
  }
  async start(count) {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return;
    for (let i = 0; i < count; i++) {
      let lane;
      try { lane = new Lane(); await lane.ready; this.workers.push(lane); }
      catch { lane?.close(); break; }
    }
  }
  main(file, options) {
    const job = this.fallbackQueue.then(() => this.fallback(file, options));
    this.fallbackQueue = job.catch(() => {}); return job;
  }
  async run(items, visit, stopped = () => false) {
    let next = 0;
    const lanes = this.workers.length ? this.workers : [null];
    await Promise.all(lanes.map(async lane => {
      while (!stopped() && next < items.length) {
        const item = items[next++];
        await visit(item, async (file, options) => {
          if (lane && !lane.dead) {
            try { return await lane.convert(file, options); }
            catch (error) { if (/timed out/.test(error.message)) throw error; }
          }
          return this.main(file, options);
        });
      }
    }));
  }
  close() { this.workers.forEach(w => w.close()); this.workers = []; }
}
root.ConverterPool = ConverterPool;
if (typeof module !== 'undefined') module.exports = ConverterPool;
})(globalThis);
