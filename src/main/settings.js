const fs = require('fs');
const { SETTINGS_FILE } = require('./paths');

const DEFAULTS = {
  captureIntervalMs: 4000,
  retentionHours: 48,
  redactionEnabled: true,
  paused: false,
  captureMode: 'primary', // 'primary' | 'all-separate' | 'all-stitched'
};

function load() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

module.exports = { load, save, DEFAULTS };
