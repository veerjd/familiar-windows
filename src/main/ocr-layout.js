// Layout-aware post-processing for word-level OCR output.
//
// Input shape (from ocr-native.js):
//   { lines: [{ text, bbox:[x,y,w,h], words: [{ text, bbox:[x,y,w,h] }] }] }
//
// Output: a plain string of text, with junk filtered out and words
// re-grouped into lines by geometry rather than the OCR engine's row order.
//
// Why this exists: Tesseract and Windows.Media.Ocr both happily emit "words"
// for things that are actually icons or single decorative glyphs (tray
// icons, sidebar file-type indicators, line-number gutters in a code
// editor). Stripping them out by geometry + shape is much cheaper and more
// reliable than trying to teach the OCR engine what isn't text.

const DEFAULTS = {
  // Drop any word that is ≤2 chars and contains no alphanumerics. These are
  // overwhelmingly icon glyphs ("€", "™", "*-", ">>"). "OK", "JS", "42",
  // "it" survive because they contain letters or digits.
  dropIconWords: true,

  // A vertical strip narrower than this many pixels, containing only short
  // tokens (≤ gutterMaxTokenLen chars each), is treated as a line-number
  // gutter or icon column and removed.
  dropGutters: true,
  gutterMaxStripWidth: 60,
  gutterMaxTokenLen: 3,
  gutterMinTokens: 4, // ignore tiny clusters — too small to confidently call a "gutter"

  // Lines closer than this (in pixels, vertically) are merged into one
  // reading-order line.
  lineMergeTolerance: 8,

  // Column-aware grouping. Side-by-side panes (editor + terminal, file tree
  // + content) produce words at the same y-coordinate in different x-ranges.
  // The naive reading-order sort braids them. Detect column gutters by
  // finding x-ranges that are empty across most y-bands of the image.
  columnAware: true,
  columnGapMinWidth: 40, // empty x-strip wider than this counts as a gutter
  columnMinEmptyBands: 0.6, // gutter must be empty in ≥60% of sampled y-bands
  columnYBandCount: 20, // number of y-bands to sample across the image
  columnIgnoreTopBottomFrac: 0.1, // skip top/bottom 10% (header/taskbar bars)
};

function isIconWord(text) {
  if (text.length > 2) return false;
  return !/[A-Za-z0-9]/.test(text);
}

// Flatten the engine's lines down to a single list of words with bboxes.
function flattenWords(result) {
  const out = [];
  for (const line of result.lines || []) {
    for (const w of line.words || []) {
      if (!w.text || !w.bbox) continue;
      const [x, y, width, height] = w.bbox;
      out.push({ text: w.text, x, y, w: width, h: height });
    }
  }
  return out;
}

// Find vertical strips (groups of words sharing a similar x range) that look
// like gutters: narrow, only short tokens, at least gutterMinTokens deep.
// Returns a set of word indices to drop.
function detectGutterIndices(words, opts) {
  if (!opts.dropGutters || words.length === 0) return new Set();

  // Bucket words by their *left edge* rounded to 10px. Gutters/icon columns
  // share a consistent left margin.
  const buckets = new Map();
  for (let i = 0; i < words.length; i += 1) {
    const key = Math.round(words[i].x / 10) * 10;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }

  const drop = new Set();
  for (const [, idxs] of buckets) {
    if (idxs.length < opts.gutterMinTokens) continue;

    // Width of this column = max(x + w) − min(x) across all members.
    let minX = Infinity;
    let maxRight = 0;
    let allShort = true;
    for (const i of idxs) {
      const wd = words[i];
      if (wd.x < minX) minX = wd.x;
      if (wd.x + wd.w > maxRight) maxRight = wd.x + wd.w;
      if (wd.text.length > opts.gutterMaxTokenLen) { allShort = false; break; }
    }
    if (!allShort) continue;
    if (maxRight - minX > opts.gutterMaxStripWidth) continue;

    for (const i of idxs) drop.add(i);
  }
  return drop;
}

// Find column boundaries by sampling horizontal y-bands across the image and
// looking for x-ranges that are empty in most bands. A real column gutter is
// empty at most y-positions, even if header/taskbar bars span the whole x at
// y=0 or y=bottom. Returns an array of [xStart, xEnd] regions left-to-right,
// or null if no columns detected.
function detectColumns(words, opts) {
  if (!opts.columnAware || words.length < 4) return null;

  let minX = Infinity;
  let maxX = 0;
  let minY = Infinity;
  let maxY = 0;
  for (const w of words) {
    if (w.x < minX) minX = w.x;
    if (w.x + w.w > maxX) maxX = w.x + w.w;
    if (w.y < minY) minY = w.y;
    if (w.y + w.h > maxY) maxY = w.y + w.h;
  }
  const totalHeight = maxY - minY;
  const totalWidth = maxX - minX + 1;
  if (totalHeight <= 0 || totalWidth <= 0) return null;

  // Sample columnYBandCount y-bands, skipping the top/bottom margin where
  // continuous header/taskbar bars artificially bridge any column gap.
  const yMargin = totalHeight * opts.columnIgnoreTopBottomFrac;
  const yStart = minY + yMargin;
  const yEnd = maxY - yMargin;
  const bandCount = opts.columnYBandCount;
  const bandHeight = (yEnd - yStart) / bandCount;
  if (bandHeight <= 0) return null;

  // For each x-pixel, count how many y-bands have NO word covering that x.
  // A "covered" x in a band = some word in that band's y-range has x in its
  // [x, x+w] extent.
  const emptyCount = new Uint16Array(totalWidth); // per x, count of empty bands

  for (let b = 0; b < bandCount; b += 1) {
    const bandTop = yStart + b * bandHeight;
    const bandBot = bandTop + bandHeight;
    const bandCov = new Uint8Array(totalWidth);
    for (const w of words) {
      // Word's y-range overlaps this band?
      if (w.y + w.h < bandTop || w.y > bandBot) continue;
      const startX = Math.max(0, w.x - minX);
      const endX = Math.min(totalWidth - 1, w.x + w.w - 1 - minX);
      for (let i = startX; i <= endX; i += 1) bandCov[i] = 1;
    }
    // Any band that has zero words at all is a "blank y-band" — don't count
    // its emptiness toward the column metric, since a blank band between
    // paragraphs is not evidence of a column.
    let anyWord = false;
    for (let i = 0; i < totalWidth; i += 1) if (bandCov[i]) { anyWord = true; break; }
    if (!anyWord) continue;
    for (let i = 0; i < totalWidth; i += 1) if (bandCov[i] === 0) emptyCount[i] += 1;
  }

  // An x is "consistently empty" if it's empty in >= columnMinEmptyBands
  // fraction of the bands we counted.
  // Count how many bands actually contributed (anyWord == true). Iterating
  // again is cheap; or just use the max emptyCount as a proxy for total.
  let maxEmpty = 0;
  for (let i = 0; i < totalWidth; i += 1) if (emptyCount[i] > maxEmpty) maxEmpty = emptyCount[i];
  if (maxEmpty === 0) return null;
  const threshold = Math.ceil(maxEmpty * opts.columnMinEmptyBands);

  // Find runs of x where emptyCount[i] >= threshold AND the run is wide enough.
  const gutters = [];
  let runStart = -1;
  for (let i = 0; i < totalWidth; i += 1) {
    if (emptyCount[i] >= threshold) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      if (i - runStart >= opts.columnGapMinWidth) {
        gutters.push({ start: runStart + minX, end: i + minX });
      }
      runStart = -1;
    }
  }
  if (runStart >= 0 && totalWidth - runStart >= opts.columnGapMinWidth) {
    gutters.push({ start: runStart + minX, end: totalWidth + minX });
  }

  if (!gutters.length) return null;

  // Drop edge gutters (before first column / after last column) — those are
  // just margins, not splits.
  const interior = gutters.filter((g) => {
    let hasLeft = false;
    let hasRight = false;
    for (const w of words) {
      if (w.x + w.w <= g.start) { hasLeft = true; if (hasRight) break; }
      else if (w.x >= g.end) { hasRight = true; if (hasLeft) break; }
    }
    return hasLeft && hasRight;
  });
  if (!interior.length) return null;

  const columns = [];
  let prev = minX;
  for (const g of interior) {
    columns.push({ xStart: prev, xEnd: g.start });
    prev = g.end;
  }
  columns.push({ xStart: prev, xEnd: maxX });
  return columns;
}

function splitWordsByColumns(words, columns) {
  if (!columns) return [words];
  const out = columns.map(() => []);
  for (const w of words) {
    const center = w.x + w.w / 2;
    let placed = false;
    for (let i = 0; i < columns.length; i += 1) {
      if (center >= columns[i].xStart && center <= columns[i].xEnd) {
        out[i].push(w);
        placed = true;
        break;
      }
    }
    // Words straddling a column boundary (rare): assign to whichever column
    // contains more of the word's width.
    if (!placed) {
      let best = 0;
      let bestOverlap = -1;
      for (let i = 0; i < columns.length; i += 1) {
        const overlapStart = Math.max(w.x, columns[i].xStart);
        const overlapEnd = Math.min(w.x + w.w, columns[i].xEnd);
        const overlap = overlapEnd - overlapStart;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = i;
        }
      }
      out[best].push(w);
    }
  }
  return out;
}

// Group words into lines by y-coordinate, then sort each line left-to-right.
function reconstructLines(words, opts) {
  if (!words.length) return [];
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  let current = [sorted[0]];
  let currentY = sorted[0].y;
  for (let i = 1; i < sorted.length; i += 1) {
    const w = sorted[i];
    if (Math.abs(w.y - currentY) <= opts.lineMergeTolerance) {
      current.push(w);
    } else {
      current.sort((a, b) => a.x - b.x);
      lines.push(current);
      current = [w];
      currentY = w.y;
    }
  }
  current.sort((a, b) => a.x - b.x);
  lines.push(current);
  return lines;
}

function linesToText(lines) {
  return lines.map((line) => line.map((w) => w.text).join(' ')).join('\n');
}

function postProcess(result, overrides) {
  const opts = { ...DEFAULTS, ...(overrides || {}) };
  let words = flattenWords(result);

  if (opts.dropIconWords) {
    words = words.filter((w) => !isIconWord(w.text));
  }

  if (opts.dropGutters) {
    const drop = detectGutterIndices(words, opts);
    if (drop.size) words = words.filter((_, i) => !drop.has(i));
  }

  const columns = detectColumns(words, opts);
  const wordsPerColumn = splitWordsByColumns(words, columns);
  // Process each column independently, then concatenate left-to-right with
  // a blank-line separator so the boundary is visible in the markdown.
  const chunks = wordsPerColumn.map((cw) => linesToText(reconstructLines(cw, opts)));
  return chunks.filter((c) => c.length).join('\n\n');
}

module.exports = { postProcess, DEFAULTS };
