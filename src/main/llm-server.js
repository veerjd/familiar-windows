const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const log = require('electron-log');

let proc = null;
let baseUrl = null;
let ready = false;

function binaryPath() {
  // Packaged: extraResources copies build/llm -> resources/llm.
  // Dev: read from the repo's build/llm.
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'llm', 'llamafile.exe');
  }
  return path.resolve(__dirname, '..', '..', 'build', 'llm', 'llamafile.exe');
}

function pickPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/v1/models`, { timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function start() {
  if (proc) return baseUrl;
  const exe = binaryPath();
  if (!fs.existsSync(exe)) {
    log.warn(`Embedded LLM disabled: ${exe} not found. Run "npm run llm:fetch".`);
    return null;
  }
  const port = await pickPort();
  baseUrl = `http://127.0.0.1:${port}`;
  log.info(`Starting embedded LLM at ${baseUrl}`);
  // --server: start HTTP server. --nobrowser: don't try to open a UI.
  // -ngl 0: CPU-only (avoids GPU init failures on machines without compatible drivers).
  proc = spawn(exe, [
    '--server',
    '--nobrowser',
    '--host', '127.0.0.1',
    '--port', String(port),
    '-ngl', '0',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  proc.stdout.on('data', (d) => log.debug('[llm]', d.toString().trim()));
  proc.stderr.on('data', (d) => log.debug('[llm]', d.toString().trim()));
  proc.on('exit', (code, signal) => {
    log.warn(`Embedded LLM exited (code=${code}, signal=${signal})`);
    proc = null;
    ready = false;
    baseUrl = null;
  });
  ready = await waitReady(baseUrl, 60000);
  if (!ready) {
    log.warn('Embedded LLM did not become ready within 60s');
  } else {
    log.info('Embedded LLM ready');
  }
  return baseUrl;
}

function stop() {
  if (!proc) return;
  log.info('Stopping embedded LLM');
  try { proc.kill(); } catch (e) { log.warn('LLM kill failed', e.message); }
  proc = null;
  ready = false;
  baseUrl = null;
}

function getUrl() {
  return ready ? baseUrl : null;
}

module.exports = { start, stop, getUrl };
