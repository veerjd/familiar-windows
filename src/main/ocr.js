const { execFile } = require('child_process');
const path = require('path');
const { app } = require('electron');
const log = require('electron-log');

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
  return runWindowsOcr(imagePath);
}

module.exports = { runOcr };
