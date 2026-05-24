const http = require('http');
const log = require('electron-log');

const GENERATE_PATH = '/api/generate';

function buildPrompt(text) {
  return (
    'Fix OCR errors in this screen-captured text. ' +
    'Correct misread characters, merge broken words, and fix spacing. ' +
    'Return only the corrected text with no commentary.\n\n' +
    text
  );
}

function ollamaGenerate(endpoint, model, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, prompt, stream: false });
    const url = new URL(GENERATE_PATH, endpoint);
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port) || 11434,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data).response || '');
          } catch (e) {
            reject(new Error(`Ollama parse error: ${e.message}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama timed out')); });
    req.write(body);
    req.end();
  });
}

async function postProcessOcr(rawText, model, endpoint) {
  if (!rawText || !rawText.trim()) return rawText;
  try {
    const corrected = await ollamaGenerate(endpoint, model, buildPrompt(rawText));
    return corrected || rawText;
  } catch (err) {
    log.warn('Ollama post-processing unavailable, using raw OCR', err.message);
    return rawText;
  }
}

module.exports = { postProcessOcr };
