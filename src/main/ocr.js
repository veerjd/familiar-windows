const { execFile } = require('child_process');
const path = require('path');
const { app } = require('electron');
const log = require('electron-log');
const sharp = require('sharp');

// libvips defaults to one thread per core. We're a background tray app; 2 is
// plenty and keeps the system responsive while OCR runs.
sharp.concurrency(2);
sharp.cache(false); // we never re-read the same image, caching just eats RAM

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

// Preprocess for OCR: grayscale + 2x upscale (cubic) + auto-contrast.
// Tesseract is most accurate on high-DPI, high-contrast glyphs; raw desktop
// screenshots are anti-aliased, low-contrast, often dark-themed. We keep this
// cheap on purpose — lanczos3 + sharpen looked marginally better but cost ~2x
// the CPU per capture.
async function preprocessToBuffer(srcPath) {
  const meta = await sharp(srcPath).metadata();
  const w = meta.width || 0;
  return sharp(srcPath)
    .resize({ width: Math.round(w * 2), kernel: 'cubic' })
    .grayscale()
    .normalise()
    .png({ compressionLevel: 0 }) // we pipe to stdin and discard; skip compression
    .toBuffer();
}

function runTesseract(inputArg, stdinBuffer) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      tessExePath(),
      [
        inputArg, // '-' means read PNG from stdin
        'stdout',
        '--tessdata-dir', tessdataDir(),
        '-l', 'eng',
        '--psm', '3',
        '--oem', '1',
        '--dpi', '288', // we doubled the image, so it's ~2x the original DPI
      ],
      {
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        // Cap Tesseract's internal OpenMP threads. Default is all cores, which
        // makes the OS feel sluggish during each capture. 2 is plenty.
        env: { ...process.env, OMP_THREAD_LIMIT: '2' },
      },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          return reject(err);
        }
        resolve(stdout || '');
      },
    );
    if (stdinBuffer) {
      child.stdin.on('error', () => {}); // swallow EPIPE if tesseract closes early
      child.stdin.end(stdinBuffer);
    }
  });
}

async function runOcr(imagePath) {
  try {
    const buf = await preprocessToBuffer(imagePath);
    return await runTesseract('-', buf);
  } catch (err) {
    log.warn('OCR preprocess failed, falling back to raw image', err);
    return runTesseract(imagePath, null);
  }
}

module.exports = { runOcr };
