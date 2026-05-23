const { desktopCapturer, screen, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const log = require('electron-log');
const { DIRS } = require('./paths');
const { runOcr } = require('./ocr');
const { redactMarkdown } = require('./redact');
const settings = require('./settings');
const db = require('./db');

let timer = null;

function tsStamp(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function ocrAndSave({ pngBuffer, imagePath, mdPath, ts, redactionEnabled }) {
  fs.writeFileSync(imagePath, pngBuffer);
  let markdown = '';
  try {
    markdown = await runOcr(imagePath);
  } catch (err) {
    log.error('OCR failed', err);
  }
  const redacted = redactionEnabled
    ? redactMarkdown(markdown)
    : { text: markdown, didRedact: false };
  fs.writeFileSync(mdPath, redacted.text, 'utf8');
  db.insertCapture({
    ts,
    imagePath,
    markdownPath: mdPath,
    ocrChars: redacted.text.length,
    redacted: redacted.didRedact ? 1 : 0,
  });
}

async function getAllScreenSources() {
  // desktopCapturer returns one source per monitor when types: ['screen'].
  // Thumbnail size is the largest display's bounds so we get full resolution everywhere.
  const displays = screen.getAllDisplays();
  const maxW = Math.max(...displays.map((d) => d.size.width));
  const maxH = Math.max(...displays.map((d) => d.size.height));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxW, height: maxH },
  });
  return { sources, displays };
}

function sourceForDisplay(sources, display) {
  // Electron sets source.display_id to the display.id (as a string) on Win/Linux.
  const idStr = String(display.id);
  return sources.find((s) => s.display_id === idStr) || sources[0];
}

async function captureSinglePrimary(ts, stamp, redactionEnabled) {
  const { sources } = await getAllScreenSources();
  if (!sources.length) {
    log.warn('No screen sources available');
    return;
  }
  const primary = screen.getPrimaryDisplay();
  const src = sourceForDisplay(sources, primary);
  await ocrAndSave({
    pngBuffer: src.thumbnail.toPNG(),
    imagePath: path.join(DIRS.images, `${stamp}.png`),
    mdPath: path.join(DIRS.captures, `${stamp}.md`),
    ts,
    redactionEnabled,
  });
}

async function captureAllSeparate(ts, stamp, redactionEnabled) {
  const { sources } = await getAllScreenSources();
  if (!sources.length) {
    log.warn('No screen sources available');
    return;
  }
  for (let i = 0; i < sources.length; i += 1) {
    const src = sources[i];
    await ocrAndSave({
      pngBuffer: src.thumbnail.toPNG(),
      imagePath: path.join(DIRS.images, `${stamp}-${i}.png`),
      mdPath: path.join(DIRS.captures, `${stamp}-${i}.md`),
      ts,
      redactionEnabled,
    });
  }
}

async function captureAllStitched(ts, stamp, redactionEnabled) {
  const { sources, displays } = await getAllScreenSources();
  if (!sources.length) {
    log.warn('No screen sources available');
    return;
  }
  // Order displays left-to-right; map each to its source.
  const ordered = [...displays].sort((a, b) => a.bounds.x - b.bounds.x);
  const tiles = ordered.map((d) => {
    const src = sourceForDisplay(sources, d);
    return { img: src.thumbnail, size: src.thumbnail.getSize() };
  });
  const totalW = tiles.reduce((acc, t) => acc + t.size.width, 0);
  const totalH = Math.max(...tiles.map((t) => t.size.height));

  // Compose by drawing each tile into a flat RGBA buffer, then build a PNG.
  const stride = totalW * 4;
  const canvas = Buffer.alloc(stride * totalH, 0); // transparent / black background

  let x = 0;
  for (const tile of tiles) {
    const tileBitmap = tile.img.toBitmap(); // BGRA on Windows
    const tw = tile.size.width;
    const th = tile.size.height;
    for (let row = 0; row < th; row += 1) {
      const srcOffset = row * tw * 4;
      const dstOffset = row * stride + x * 4;
      tileBitmap.copy(canvas, dstOffset, srcOffset, srcOffset + tw * 4);
    }
    x += tw;
  }

  const stitched = nativeImage.createFromBuffer(canvas, {
    width: totalW,
    height: totalH,
  });

  await ocrAndSave({
    pngBuffer: stitched.toPNG(),
    imagePath: path.join(DIRS.images, `${stamp}.png`),
    mdPath: path.join(DIRS.captures, `${stamp}.md`),
    ts,
    redactionEnabled,
  });
}

async function captureOnce() {
  const ts = Date.now();
  const stamp = tsStamp(ts);
  const cfg = settings.load();
  const mode = cfg.captureMode || 'primary';

  switch (mode) {
    case 'all-separate':
      return captureAllSeparate(ts, stamp, cfg.redactionEnabled);
    case 'all-stitched':
      return captureAllStitched(ts, stamp, cfg.redactionEnabled);
    case 'primary':
    default:
      return captureSinglePrimary(ts, stamp, cfg.redactionEnabled);
  }
}

function start(intervalMs) {
  stop();
  timer = setInterval(() => {
    captureOnce().catch((err) => log.error('capture loop error', err));
  }, intervalMs);
  log.info(`Capture loop started at ${intervalMs}ms`);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, captureOnce };
