const Database = require('better-sqlite3');
const { DB_FILE } = require('./paths');

let db;

function init() {
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS captures (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      image_path TEXT,
      markdown_path TEXT,
      ocr_chars INTEGER,
      redacted INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_captures_ts ON captures(ts);

    CREATE TABLE IF NOT EXISTS clipboard (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      content TEXT,
      hash TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_clipboard_ts ON clipboard(ts);
  `);
}

function insertCapture(row) {
  return db.prepare(`
    INSERT INTO captures (ts, image_path, markdown_path, ocr_chars, redacted)
    VALUES (@ts, @imagePath, @markdownPath, @ocrChars, @redacted)
  `).run({ redacted: 0, ...row });
}

function insertClipboard(row) {
  return db.prepare(`
    INSERT INTO clipboard (ts, kind, content, hash)
    VALUES (@ts, @kind, @content, @hash)
  `).run(row);
}

function lastClipboardHash() {
  const r = db.prepare('SELECT hash FROM clipboard ORDER BY ts DESC LIMIT 1').get();
  return r ? r.hash : null;
}

function purgeOldImages(beforeTs) {
  return db.prepare('SELECT image_path FROM captures WHERE ts < ? AND image_path IS NOT NULL').all(beforeTs);
}

function clearImagePaths(beforeTs) {
  db.prepare('UPDATE captures SET image_path = NULL WHERE ts < ?').run(beforeTs);
}

module.exports = {
  init,
  insertCapture,
  insertClipboard,
  lastClipboardHash,
  purgeOldImages,
  clearImagePaths,
};
