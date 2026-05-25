const { execFile } = require('child_process');
const path = require('path');
const { app } = require('electron');
const log = require('electron-log');
const { runNative, nativeOcrAvailable } = require('./ocr-native');
const { postProcess } = require('./ocr-layout');

function winOcrScriptPath() {
  const rel = path.join(__dirname, 'windows-ocr.ps1');
  // In a packaged app, __dirname points inside app.asar; the asarUnpack entry
  // extracts the file alongside it so we redirect to the unpacked copy.
  return app.isPackaged ? rel.replace('app.asar', 'app.asar.unpacked') : rel;
}

function runWindowsOcr(imagePath) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', winOcrScriptPath(),
        '-ImagePath', imagePath,
      ],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          return reject(err);
        }
        resolve(stdout || '');
      },
    );
  });
}

async function runOcr(imagePath) {
  // Prefer the bundled native helper: it returns word-level bounding boxes,
  // which lets ocr-layout strip icon glyphs, line-number gutters, and braided
  // side-by-side panes. The PowerShell path remains as a safety net
  // (e.g. binary missing, OCR engine unavailable).
  if (nativeOcrAvailable()) {
    try {
      const result = await runNative(imagePath);
      return postProcess(result);
    } catch (err) {
      log.warn('Native OCR failed, falling back to PowerShell:', err.message);
    }
  }
  return runWindowsOcr(imagePath);
}

module.exports = { runOcr };
