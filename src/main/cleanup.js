const fs = require('fs');
const log = require('electron-log');
const db = require('./db');

let timer = null;

function purge(retentionHours) {
  const cutoff = Date.now() - retentionHours * 3600 * 1000;
  const rows = db.purgeOldImages(cutoff);
  let removed = 0;
  for (const r of rows) {
    try {
      fs.unlinkSync(r.image_path);
      removed += 1;
    } catch (err) {
      if (err.code !== 'ENOENT') log.warn('unlink failed', r.image_path, err.message);
    }
  }
  db.clearImagePaths(cutoff);
  if (removed > 0) log.info(`purged ${removed} image(s) older than ${retentionHours}h`);
}

function start(retentionHours) {
  stop();
  purge(retentionHours);
  timer = setInterval(() => purge(retentionHours), 60 * 60 * 1000);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, purge };
