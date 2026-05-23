const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const log = require('electron-log');

const { ensureDirs, DIRS } = require('./paths');
const settings = require('./settings');
const db = require('./db');
const capture = require('./capture');
const clipboard = require('./clipboard');
const cleanup = require('./cleanup');
const tray = require('./tray');
const { rgAvailable } = require('./redact');

log.transports.file.resolvePathFn = () => path.join(DIRS.logs, 'main.log');

let state = null;
let settingsWindow = null;

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 520,
    title: 'Familiar Settings',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function handlers() {
  return {
    togglePause: () => {
      state.paused = !state.paused;
      settings.save(state);
      applyState();
    },
    captureNow: () => capture.captureOnce().catch((e) => log.error('manual capture', e)),
    openSettings,
    quit: () => { app.quit(); },
  };
}

function applyState() {
  if (state.paused) {
    capture.stop();
    clipboard.stop();
  } else {
    capture.start(state.captureIntervalMs);
    clipboard.start(1000);
  }
  cleanup.start(state.retentionHours);
  tray.refresh(state, handlers());
}

function setupIpc() {
  ipcMain.handle('settings:get', () => state);
  ipcMain.handle('settings:set', (_e, next) => {
    state = { ...state, ...next };
    settings.save(state);
    applyState();
    return state;
  });
  ipcMain.handle('storage:open', () => shell.openPath(DIRS.root));
  ipcMain.handle('capture:now', () => capture.captureOnce());
}

app.whenReady().then(() => {
  ensureDirs();
  db.init();
  state = settings.load();
  if (!rgAvailable()) log.warn('Bundled ripgrep missing — redaction will use JS regex only');
  tray.create(state, handlers());
  setupIpc();
  applyState();
  log.info('Familiar started');
});

app.on('window-all-closed', (e) => {
  // Tray app: keep running when settings window closes.
  e.preventDefault();
});

app.on('before-quit', () => {
  capture.stop();
  clipboard.stop();
  cleanup.stop();
});
