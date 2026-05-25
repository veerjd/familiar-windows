// Downloads a pinned llamafile (binary + embedded model in one file) to build/llm/.
// Idempotent: skips download if the .exe already exists.
//
// We bundle Qwen2.5-0.5B-Instruct (Q4_K_M) — ~673 MiB, fast on CPU, sufficient for
// the actual task (fixing OCR misreads). Size includes the llamafile runtime
// (~400 MB of cosmopolitan-libc + llama.cpp) plus the quantized model weights.
// The file is renamed to .exe so Windows treats it as an executable.

const fs = require('fs');
const path = require('path');
const https = require('https');

const LLAMAFILE_VERSION = '0.8.17';
const MODEL_FILE = 'Qwen2.5-0.5B-Instruct-Q4_K_M.llamafile';
const URL = `https://huggingface.co/Mozilla/Qwen2.5-0.5B-Instruct-llamafile/resolve/main/${MODEL_FILE}?download=true`;
const OUT_DIR = path.resolve(__dirname, '..', 'build', 'llm');
const OUT_EXE = path.join(OUT_DIR, 'llamafile.exe');
const VERSION_FILE = path.join(OUT_DIR, 'VERSION');

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
        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        let lastLogged = 0;
        const file = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total && received - lastLogged > 25 * 1024 * 1024) {
            const pct = ((received / total) * 100).toFixed(0);
            console.log(`  ${pct}% (${(received / 1024 / 1024).toFixed(0)} MB)`);
            lastLogged = received;
          }
        });
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
  const tag = `${LLAMAFILE_VERSION}|${MODEL_FILE}`;
  if (fs.existsSync(OUT_EXE) && fs.existsSync(VERSION_FILE)
      && fs.readFileSync(VERSION_FILE, 'utf8').trim() === tag) {
    console.log('llamafile already present, skipping');
    return;
  }
  console.log(`Downloading ${URL}`);
  console.log('(this is ~673 MiB — first run takes a while)');
  const tmp = OUT_EXE + '.partial';
  await download(URL, tmp);
  if (fs.existsSync(OUT_EXE)) fs.unlinkSync(OUT_EXE);
  fs.renameSync(tmp, OUT_EXE);
  fs.writeFileSync(VERSION_FILE, tag);
  console.log(`llamafile ready at ${OUT_EXE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
