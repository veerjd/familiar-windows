const { clipboard } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const log = require('electron-log');
const { DIRS } = require('./paths');
const db = require('./db');

let timer = null;
let lastHash = null;

function hash(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function poll() {
  try {
    const text = clipboard.readText();
    if (!text) return;
    const h = hash(text);
    if (h === lastHash) return;
    lastHash = h;
    const ts = Date.now();
    const file = path.join(DIRS.clipboard, `${ts}.txt`);
    fs.writeFileSync(file, text, 'utf8');
    db.insertClipboard({ ts, kind: 'text', content: text.slice(0, 4000), hash: h });
  } catch (err) {
    log.error('clipboard poll error', err);
  }
}

function start(intervalMs = 1000) {
  stop();
  lastHash = db.lastClipboardHash();
  timer = setInterval(poll, intervalMs);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop };
