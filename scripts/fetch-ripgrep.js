// Downloads a pinned ripgrep release for Windows x64 and extracts rg.exe to build/rg/.
// Idempotent: skips download if rg.exe already present.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const RG_VERSION = '14.1.1';
const URL = `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-x86_64-pc-windows-msvc.zip`;
const OUT_DIR = path.resolve(__dirname, '..', 'build', 'rg');
const OUT_EXE = path.join(OUT_DIR, 'rg.exe');
const ZIP_PATH = path.join(OUT_DIR, 'rg.zip');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = (u) => {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(OUT_EXE)) {
    console.log('rg.exe already present, skipping');
    return;
  }
  console.log(`Downloading ${URL}`);
  await download(URL, ZIP_PATH);
  console.log('Extracting rg.exe');
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -Force -Path "${ZIP_PATH}" -DestinationPath "${OUT_DIR}"`,
  ], { stdio: 'inherit' });
  // The zip contains a folder like ripgrep-14.1.1-x86_64-pc-windows-msvc/rg.exe; find and lift it.
  const entries = fs.readdirSync(OUT_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      const candidate = path.join(OUT_DIR, e.name, 'rg.exe');
      if (fs.existsSync(candidate)) {
        fs.renameSync(candidate, OUT_EXE);
        fs.rmSync(path.join(OUT_DIR, e.name), { recursive: true, force: true });
        break;
      }
    }
  }
  fs.unlinkSync(ZIP_PATH);
  if (!fs.existsSync(OUT_EXE)) {
    throw new Error('rg.exe not found after extraction');
  }
  console.log(`rg.exe ready at ${OUT_EXE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
