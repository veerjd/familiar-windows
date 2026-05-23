const { Tray, Menu, nativeImage, shell, app } = require('electron');
const path = require('path');
const { DIRS } = require('./paths');

let tray = null;

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
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Familiar');
  refresh(state, handlers);
  tray.on('click', () => tray.popUpContextMenu());
  return tray;
}

function refresh(state, handlers) {
  if (!tray) return;
  tray.setContextMenu(build(state, handlers));
}

module.exports = { create, refresh };
