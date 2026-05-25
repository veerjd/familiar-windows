const fs = require('fs');
const { SETTINGS_FILE } = require('./paths');

const DEFAULTS = {
  captureIntervalMs: 8000,
  retentionHours: 720,
  redactionEnabled: true,
  paused: false,
  // 'primary' | 'all-separate' | 'all-stitched' | 'selected-separate' | 'selected-stitched'
  captureMode: 'primary',
  selectedDisplayIds: [], // numeric display IDs, used when captureMode starts with 'selected-'
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
