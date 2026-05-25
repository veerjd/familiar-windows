const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function nativeOcrExePath() {
  if (app && app.isPackaged) {
    return path.join(process.resourcesPath, 'ocr', 'familiar-ocr.exe');
  }
  return path.join(__dirname, '..', '..', 'build', 'ocr', 'familiar-ocr.exe');
}

function nativeOcrAvailable() {
  try {
    return fs.existsSync(nativeOcrExePath());
  } catch {
    return false;
  }
}

// Returns the parsed JSON object:
//   { lines: [{ text, bbox: [x,y,w,h], words: [{ text, bbox }] }] }
function runNative(imagePath) {
  return new Promise((resolve, reject) => {
    execFile(
      nativeOcrExePath(),
      [imagePath],
      { windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          return reject(err);
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseErr) {
          parseErr.stderr = stderr;
          parseErr.stdoutSample = String(stdout).slice(0, 200);
          reject(parseErr);
        }
      },
    );
  });
}

module.exports = { runNative, nativeOcrAvailable, nativeOcrExePath };
