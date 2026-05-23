const { execFile } = require('child_process');
const path = require('path');
const { app } = require('electron');

function tessDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tess');
  }
  return path.join(__dirname, '..', '..', 'build', 'tess');
}

function tessExePath() {
  return path.join(tessDir(), 'tesseract.exe');
}

function tessdataDir() {
  return path.join(tessDir(), 'tessdata');
}

// --psm 6 = "assume a single uniform block of text" — best general-purpose mode
//           for screenshot OCR (better than the default 3 on UI elements).
// --oem 1 = LSTM-only engine (the trained NN, not the legacy engine).
// -l eng  = English. Add more languages by dropping more .traineddata files.
function runOcr(imagePath) {
  return new Promise((resolve, reject) => {
    execFile(
      tessExePath(),
      [imagePath, 'stdout', '--tessdata-dir', tessdataDir(), '-l', 'eng', '--psm', '6', '--oem', '1'],
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

module.exports = { runOcr };
