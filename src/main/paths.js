const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.join(os.homedir(), '.familiar');
const DIRS = {
  root: ROOT,
  captures: path.join(ROOT, 'captures'),
  images: path.join(ROOT, 'images'),
  clipboard: path.join(ROOT, 'clipboard'),
  logs: path.join(ROOT, 'logs'),
};

function ensureDirs() {
  for (const dir of Object.values(DIRS)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = {
  DIRS,
  SETTINGS_FILE: path.join(ROOT, 'settings.json'),
  DB_FILE: path.join(ROOT, 'familiar.db'),
  ensureDirs,
};
