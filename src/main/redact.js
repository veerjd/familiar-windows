const { execFileSync } = require('child_process');
const path = require('path');
const { app } = require('electron');
const log = require('electron-log');

const PATTERNS = [
  { name: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'aws_secret', re: /\b[A-Za-z0-9/+=]{40}\b(?=[^A-Za-z0-9/+=]|$)/g },
  { name: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { name: 'openai_key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Match digit groups separated by ' ' or '-' only — NOT bare digits with
  // arbitrary punctuation. Then verify the actual digit count is in card range
  // (13–19). The previous /\b(?:\d[ -]?){13,19}\b/ matched any 13–19
  // digit-or-dash run, which ate timestamp filenames like "20260523-141004"
  // (15 chars) on every screenshot.
  {
    name: 'credit_card_spaced',
    re: /\b\d{4}[ -]\d{4}[ -]\d{2,5}(?:[ -]\d{2,5}){0,2}\b/g,
    validate: (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19;
    },
  },
  // Bare runs of 13–19 digits with no separators. A 14-digit unbroken run is
  // unlikely to be anything but a card or a phone-with-extension; in either
  // case "do not log it" is the safer default.
  { name: 'credit_card_bare', re: /\b\d{13,19}\b/g },
  { name: 'password_kv', re: /(?<=password\s*[:=]\s*['"]?)[^\s'"]{4,}/gi },
  { name: 'api_key_kv', re: /(?<=api[_-]?key\s*[:=]\s*['"]?)[^\s'"]{8,}/gi },
];

function rgPath() {
  if (app && app.isPackaged) {
    return path.join(process.resourcesPath, 'rg', 'rg.exe');
  }
  return path.join(__dirname, '..', '..', 'build', 'rg', 'rg.exe');
}

function redactMarkdown(text) {
  if (!text) return { text: '', didRedact: false };
  let out = text;
  let didRedact = false;
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    out = out.replace(p.re, (match) => {
      if (p.validate && !p.validate(match)) return match;
      didRedact = true;
      return '[REDACTED]';
    });
    p.re.lastIndex = 0;
  }
  return { text: out, didRedact };
}

// rg is bundled for parity with upstream Familiar and for future heavier scans.
// The MVP path uses JS regex above; rg is reserved for batch sweeps.
function rgAvailable() {
  try {
    execFileSync(rgPath(), ['--version'], { stdio: 'ignore' });
    return true;
  } catch (err) {
    log.warn('ripgrep not available at', rgPath(), err.message);
    return false;
  }
}

module.exports = { redactMarkdown, rgAvailable, PATTERNS };
