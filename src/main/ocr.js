const { execFile } = require('child_process');
const path = require('path');
const { app } = require('electron');

function ocrExePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ocr', 'FamiliarOcr.exe');
  }
  return path.join(__dirname, '..', '..', 'build', 'ocr', 'FamiliarOcr.exe');
}

function runOcr(imagePath) {
  return new Promise((resolve, reject) => {
    execFile(ocrExePath(), [imagePath], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout || '');
    });
  });
}

module.exports = { runOcr };
