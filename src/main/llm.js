const http = require('http');
const log = require('electron-log');
const llmServer = require('./llm-server');

const PROMPT = 'Fix OCR errors in this screen-captured text. '
  + 'Correct misread characters, merge broken words, and fix spacing. '
  + 'Return only the corrected text with no commentary.';

function buildPrompt(text) {
  return `${PROMPT}\n\n${text}`;
}

function postJson(endpoint, pathSuffix, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(pathSuffix, endpoint);
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
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
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`parse error: ${e.message}`)); }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('LLM request timed out')); });
    req.write(body);
    req.end();
  });
}

async function tryOllama(endpoint, model, text) {
  const res = await postJson(endpoint, '/api/generate', {
    model, prompt: buildPrompt(text), stream: false,
  });
  return res.response || '';
}

async function tryEmbedded(endpoint, text) {
  // llamafile exposes an OpenAI-compatible chat endpoint. The "model" field is
  // ignored — the binary serves whatever model it was built with.
  const res = await postJson(endpoint, '/v1/chat/completions', {
    model: 'local',
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: text },
    ],
    stream: false,
    temperature: 0,
  });
  return res?.choices?.[0]?.message?.content || '';
}

async function postProcessOcr(rawText, model, endpoint) {
  if (!rawText || !rawText.trim()) return rawText;
  // 1. User's configured Ollama (preserves power-user setups with larger models).
  try {
    const corrected = await tryOllama(endpoint, model, rawText);
    if (corrected) return corrected;
  } catch (err) {
    log.debug('Ollama unavailable, trying embedded LLM:', err.message);
  }
  // 2. Bundled llamafile.
  const embeddedUrl = llmServer.getUrl();
  if (embeddedUrl) {
    try {
      const corrected = await tryEmbedded(embeddedUrl, rawText);
      if (corrected) return corrected;
    } catch (err) {
      log.warn('Embedded LLM failed, using raw OCR:', err.message);
    }
  }
  return rawText;
}

module.exports = { postProcessOcr };
