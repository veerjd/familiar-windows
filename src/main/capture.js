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
  // desktopCapturer.thumbnailSize is a single max-size applied to ALL sources, so
  // we ask for the largest *physical* pixel dimensions across all displays. Using
  // logical (DPI-scaled) bounds here silently downsamples HiDPI monitors and
  // destroys OCR quality.
  const displays = screen.getAllDisplays();
  const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * (d.scaleFactor || 1))));
  const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * (d.scaleFactor || 1))));
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

function filterDisplays(displays, selectedIds) {
  if (!selectedIds || !selectedIds.length) return [];
  const wanted = new Set(selectedIds.map(String));
  return displays.filter((d) => wanted.has(String(d.id)));
}

async function captureSeparate(ts, stamp, redactionEnabled, displaysSubset) {
  const { sources, displays } = await getAllScreenSources();
  if (!sources.length) {
    log.warn('No screen sources available');
    return;
  }
  const targets = displaysSubset || displays;
  if (!targets.length) {
    log.warn('No displays matched selection — skipping capture');
    return;
  }
  for (let i = 0; i < targets.length; i += 1) {
    const src = sourceForDisplay(sources, targets[i]);
    await ocrAndSave({
      pngBuffer: src.thumbnail.toPNG(),
      imagePath: path.join(DIRS.images, `${stamp}-${i}.png`),
      mdPath: path.join(DIRS.captures, `${stamp}-${i}.md`),
      ts,
      redactionEnabled,
    });
  }
}

async function captureStitched(ts, stamp, redactionEnabled, displaysSubset) {
  const { sources, displays } = await getAllScreenSources();
  if (!sources.length) {
    log.warn('No screen sources available');
    return;
  }
  const targets = displaysSubset || displays;
  if (!targets.length) {
    log.warn('No displays matched selection — skipping capture');
    return;
  }
  // Order displays left-to-right; map each to its source.
  const ordered = [...targets].sort((a, b) => a.bounds.x - b.bounds.x);
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
  const selectedIds = cfg.selectedDisplayIds || [];
  const { redactionEnabled } = cfg;

  switch (mode) {
    case 'all-separate':
      return captureSeparate(ts, stamp, redactionEnabled);
    case 'all-stitched':
      return captureStitched(ts, stamp, redactionEnabled);
    case 'selected-separate': {
      const subset = filterDisplays(screen.getAllDisplays(), selectedIds);
      return captureSeparate(ts, stamp, redactionEnabled, subset);
    }
    case 'selected-stitched': {
      const subset = filterDisplays(screen.getAllDisplays(), selectedIds);
      return captureStitched(ts, stamp, redactionEnabled, subset);
    }
    case 'primary':
    default:
      return captureSinglePrimary(ts, stamp, redactionEnabled);
  }
}

function listDisplays() {
  const primaryId = String(screen.getPrimaryDisplay().id);
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1}`,
    width: d.size.width,
    height: d.size.height,
    x: d.bounds.x,
    y: d.bounds.y,
    primary: String(d.id) === primaryId,
  }));
}

let stopped = true;

function start(intervalMs) {
  stop();
  stopped = false;
  const tick = async () => {
    if (stopped) return;
    const startedAt = Date.now();
    try {
      await captureOnce();
    } catch (err) {
      log.error('capture loop error', err);
    }
    if (stopped) return;
    // Wait at least intervalMs between captures — but never queue them up. If a
    // capture took longer than the interval (slow OCR), fire again immediately.
    const elapsed = Date.now() - startedAt;
    const delay = Math.max(0, intervalMs - elapsed);
    timer = setTimeout(tick, delay);
  };
  log.info(`Capture loop started at ${intervalMs}ms`);
  timer = setTimeout(tick, intervalMs);
}

function stop() {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

module.exports = { start, stop, captureOnce, listDisplays };
