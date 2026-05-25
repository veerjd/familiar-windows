const { Tray, Menu, nativeImage, shell, app } = require('electron');
const path = require('path');
const { DIRS } = require('./paths');

let tray = null;
let baseIcon = null;

// Tray bitmaps on Windows arrive as BGRA. Paint a filled circle with a 1px
// darker outline into the bottom-right corner so the badge reads against
// both light and dark taskbars without needing a second asset.
function paintBadge(image, { r, g, b }) {
  const size = image.getSize();
  const { width, height } = size;
  if (!width || !height) return image;
  const buf = Buffer.from(image.toBitmap()); // copy — toBitmap shares memory

  const diameter = Math.max(6, Math.round(Math.min(width, height) * 0.45));
  const radius = diameter / 2;
  const cx = width - radius - 1;
  const cy = height - radius - 1;
  const outlineR = radius;
  const fillR = radius - 1;

  for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(height, Math.ceil(cy + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(width, Math.ceil(cx + radius)); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > outlineR) continue;
      const i = (y * width + x) * 4;
      if (dist > fillR) {
        // dark outline
        buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 255;
      } else {
        buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, {
    width,
    height,
    scaleFactor: image.getScaleFactors()[0] || 1,
  });
}

function iconFor(state) {
  if (!baseIcon || baseIcon.isEmpty()) return baseIcon || nativeImage.createEmpty();
  const color = state.paused
    ? { r: 220, g: 60, b: 60 }   // red
    : { r: 40, g: 180, b: 80 };  // green
  return paintBadge(baseIcon, color);
}

function build(state, handlers) {
  return Menu.buildFromTemplate([
    { label: state.paused ? 'Resume capture' : 'Pause capture', click: handlers.togglePause },
    { label: 'Capture now', click: handlers.captureNow },
    { type: 'separator' },
    { label: 'Open storage folder', click: () => shell.openPath(DIRS.root) },
    { label: 'Open settings', click: handlers.openSettings },
    { type: 'separator' },
    { label: `Familiar v${app.getVersion()}`, enabled: false },
    { label: 'Quit', click: () => { handlers.quit(); } },
  ]);
}

function create(state, handlers) {
  const iconPath = path.join(__dirname, '..', 'assets', 'familiar.png');
  const loaded = nativeImage.createFromPath(iconPath);
  // Resize the source to a tray-appropriate size up front so the badge math
  // operates on the final on-screen pixels (the source PNG is ~750×400).
  baseIcon = loaded.isEmpty() ? loaded : loaded.resize({ width: 32, height: 32, quality: 'best' });
  tray = new Tray(iconFor(state));
  refresh(state, handlers);
  tray.on('click', () => tray.popUpContextMenu());
  return tray;
}

function refresh(state, handlers) {
  if (!tray) return;
  tray.setImage(iconFor(state));
  tray.setToolTip(state.paused ? 'Familiar — paused' : 'Familiar — capturing');
  tray.setContextMenu(build(state, handlers));
}

module.exports = { create, refresh };
