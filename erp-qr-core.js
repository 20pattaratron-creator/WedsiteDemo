// ============================================================================
// erp-qr-core.js — a small offline QR Code encoder (ISO/IEC 18004), byte mode, versions 1–10 (ADR-029, round 12)
// ERP DEMO 4.3.1 · pure: no DOM, no storage, no clock, no dependency
// ----------------------------------------------------------------------------
// Written for the PromptPay QR on printed documents (erp-promptpay.js): a PromptPay / Thai QR payload is at most
// ~150 ASCII characters, so byte mode with versions 1–10 (up to 213 bytes at level M) is all that is needed.
// Steps (ISO/IEC 18004:2015 §7): data bits (mode 0100, character count, bytes, terminator, pad 0xEC 0x11) → split
// into blocks → Reed–Solomon error correction over GF(256) (primitive polynomial x^8+x^4+x^3+x^2+1 = 0x11D) →
// interleave → place into the matrix in the two-column zigzag → try the 8 masks and keep the lowest penalty →
// format information (BCH 15,5 with mask 0x5412) and, from version 7, version information (BCH 18,6).
// The test (tests/promptpay-core.test.cjs) reads the matrix back with an independently written decoder (its own
// tables), checks the Reed–Solomon syndromes and the payload; the Chromium check decodes the printed QR with OpenCV.
// Output: the module matrix (rows of 0 / 1) and an SVG string (one <path>, crisp edges, quiet zone of 4 modules).
// ============================================================================

export const QR_CORE_VERSION = '1.0.0';
export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 10;
export const QR_EC_LEVELS = Object.freeze(['L', 'M', 'Q', 'H']);
// Format-information bits of each error-correction level (L = 01, M = 00, Q = 11, H = 10).
const EC_FORMAT_BITS = Object.freeze({ L: 1, M: 0, Q: 3, H: 2 });

// Error-correction blocks per version and level (ISO/IEC 18004 Table 9):
// [EC codewords per block, blocks in group 1, data codewords per block in group 1, blocks in group 2, data codewords
// per block in group 2]. Group 2 blocks carry one data codeword more than group 1.
const EC_BLOCKS = Object.freeze({
  L: Object.freeze([null, [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69]]),
  M: Object.freeze([null, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]]),
  Q: Object.freeze([null, [13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0], [18, 2, 15, 2, 16], [24, 4, 19, 0, 0], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19], [20, 4, 16, 4, 17], [24, 6, 19, 2, 20]]),
  H: Object.freeze([null, [17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0], [22, 2, 11, 2, 12], [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15], [24, 4, 12, 4, 13], [28, 6, 15, 2, 16]])
});

// ---------------------------------------------------------------- sizes and capacities
export function qrSize(version) {
  return version * 4 + 17;
}
// Modules left for data + error correction after every function pattern (finder, separator, timing, alignment,
// format and version information, the dark module). Derived from the geometry, so the block table above can be checked
// against it (tests): total codewords = floor(raw / 8).
export function rawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}
export function blockSpec(version, ecl) {
  const row = EC_BLOCKS[ecl]?.[version];
  if (!row) throw new Error(`QR: no block table for version ${version} level ${ecl}`);
  const [ec, blocks1, data1, blocks2, data2] = row;
  return { ec, blocks1, data1, blocks2, data2, blocks: blocks1 + blocks2, dataCodewords: blocks1 * data1 + blocks2 * data2, totalCodewords: blocks1 * (data1 + ec) + blocks2 * (data2 + ec) };
}
const countBits = version => (version <= 9 ? 8 : 16);
// Largest byte-mode payload of a version / level.
export function byteCapacity(version, ecl) {
  const bits = blockSpec(version, ecl).dataCodewords * 8 - 4 - countBits(version);
  return Math.floor(bits / 8);
}

// ---------------------------------------------------------------- GF(256) and Reed–Solomon
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();
function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}
// Generator polynomial of degree n: Π (x − α^i), i = 0 … n−1; coefficients highest power first, leading 1 dropped.
const GENERATORS = new Map();
function generator(degree) {
  if (GENERATORS.has(degree)) return GENERATORS.get(degree);
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  const out = poly.slice(1);
  GENERATORS.set(degree, out);
  return out;
}
// The remainder of data(x) · x^n divided by the generator: the n error-correction codewords.
export function reedSolomon(data, degree) {
  const gen = generator(degree);
  const rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    if (factor !== 0) for (let i = 0; i < degree; i += 1) rem[i] ^= gfMul(gen[i], factor);
  }
  return rem;
}

// ---------------------------------------------------------------- data codewords
// UTF-8 bytes of a string (PromptPay payloads are ASCII; anything else is encoded faithfully anyway).
export function utf8Bytes(text) {
  if (typeof TextEncoder === 'function') return [...new TextEncoder().encode(String(text))];
  const out = [];
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}
function dataCodewords(bytes, version, ecl) {
  const spec = blockSpec(version, ecl);
  const capacityBits = spec.dataCodewords * 8;
  const bits = [];
  const push = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);
  if (bits.length > capacityBits) throw new Error('QR: data too long for this version');
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    out.push(byte);
  }
  for (let pad = 0xec; out.length < spec.dataCodewords; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}
// Data split into blocks, each block's error correction, interleaved: data column by column, then EC the same way.
export function interleavedCodewords(bytes, version, ecl) {
  const spec = blockSpec(version, ecl);
  const data = dataCodewords(bytes, version, ecl);
  const blocks = [];
  let offset = 0;
  for (let b = 0; b < spec.blocks; b += 1) {
    const length = b < spec.blocks1 ? spec.data1 : spec.data2;
    const chunk = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ data: chunk, ec: reedSolomon(chunk, spec.ec) });
  }
  const out = [];
  const longest = Math.max(spec.data1, spec.data2);
  for (let i = 0; i < longest; i += 1) for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  for (let i = 0; i < spec.ec; i += 1) for (const block of blocks) out.push(block.ec[i]);
  if (out.length !== spec.totalCodewords) throw new Error('QR: codeword count mismatch');
  return out;
}

// ---------------------------------------------------------------- the matrix
export function alignmentPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const size = qrSize(version);
  const out = [6];
  for (let pos = size - 7, i = 0; i < count - 1; i += 1, pos -= step) out.splice(1, 0, pos);
  return out;
}
// BCH (15, 5) format information: level bits and mask, generator 0x537, XOR 0x5412.
export function formatBits(ecl, mask) {
  const data = (EC_FORMAT_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
// BCH (18, 6) version information, generator 0x1F25 (versions ≥ 7).
export function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}
const bit = (value, i) => ((value >>> i) & 1) === 1;
class Matrix {
  constructor(version) {
    this.version = version;
    this.size = qrSize(version);
    this.dark = Array.from({ length: this.size }, () => new Uint8Array(this.size));
    this.fixed = Array.from({ length: this.size }, () => new Uint8Array(this.size));
  }
  // x = column, y = row
  set(x, y, isDark) {
    this.dark[y][x] = isDark ? 1 : 0;
    this.fixed[y][x] = 1;
  }
}
function drawFunctionPatterns(m) {
  const size = m.size;
  // Timing patterns (row 6 and column 6), drawn first: the finders overwrite their ends.
  for (let i = 0; i < size; i += 1) {
    m.set(6, i, i % 2 === 0);
    m.set(i, 6, i % 2 === 0);
  }
  // Finder patterns with their separators.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        m.set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  // Alignment patterns (not over the finders).
  const positions = alignmentPositions(m.version);
  const last = positions.length - 1;
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) m.set(positions[i] + dx, positions[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // Reserve the format areas (written for real after the mask is chosen) and draw the version information.
  drawFormat(m, 0);
  if (m.version >= 7) {
    const bits = versionBits(m.version);
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      m.set(a, b, bit(bits, i));
      m.set(b, a, bit(bits, i));
    }
  }
}
function drawFormat(m, bits) {
  const size = m.size;
  for (let i = 0; i <= 5; i += 1) m.set(8, i, bit(bits, i));
  m.set(8, 7, bit(bits, 6));
  m.set(8, 8, bit(bits, 7));
  m.set(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i += 1) m.set(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i += 1) m.set(size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i += 1) m.set(8, size - 15 + i, bit(bits, i));
  m.set(8, size - 8, true); // the dark module
}
// Codewords into the free modules: two-column strips from the right, alternately upwards and downwards, skipping
// the vertical timing column. Remainder bits stay light (0), as the standard says.
function placeCodewords(m, codewords) {
  const size = m.size;
  let index = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert += 1) {
      const y = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        if (m.fixed[y][x]) continue;
        if (index < total) {
          m.dark[y][x] = (codewords[index >>> 3] >>> (7 - (index & 7))) & 1;
          index += 1;
        }
      }
    }
  }
  if (index !== total) throw new Error('QR: not every codeword was placed');
}
export const MASKS = Object.freeze([
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  x => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
]);
function applyMask(m, mask) {
  const test = MASKS[mask];
  for (let y = 0; y < m.size; y += 1) for (let x = 0; x < m.size; x += 1) if (!m.fixed[y][x] && test(x, y)) m.dark[y][x] ^= 1;
}
// Penalty of a finished matrix (ISO/IEC 18004 §7.8.3): runs of ≥ 5 (N1 = 3 + extra), 2×2 blocks (N2 = 3), finder-like
// 1:1:3:1:1 patterns with four light modules on one side (N3 = 40), dark share away from 50 % (N4 = 10 per 5 %).
export function penaltyScore(rows) {
  const size = rows.length;
  let score = 0;
  const line = (get) => {
    let run = 1;
    for (let i = 1; i < size; i += 1) {
      if (get(i) === get(i - 1)) { run += 1; continue; }
      if (run >= 5) score += 3 + run - 5;
      run = 1;
    }
    if (run >= 5) score += 3 + run - 5;
    const seq = Array.from({ length: size }, (_, i) => get(i)).join('');
    for (const pattern of ['10111010000', '00001011101']) {
      for (let at = seq.indexOf(pattern); at >= 0; at = seq.indexOf(pattern, at + 1)) score += 40;
    }
  };
  for (let y = 0; y < size; y += 1) line(i => rows[y][i]);
  for (let x = 0; x < size; x += 1) line(i => rows[i][x]);
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const c = rows[y][x];
      if (c === rows[y][x + 1] && c === rows[y + 1][x] && c === rows[y + 1][x + 1]) score += 3;
    }
  }
  let dark = 0;
  for (const row of rows) for (const cell of row) dark += cell;
  const total = size * size;
  score += Math.floor(Math.abs(dark * 100 - total * 50) / total / 5) * 10;
  return score;
}

// ---------------------------------------------------------------- encode
// options: { ecl: 'L' | 'M' (default) | 'Q' | 'H', minVersion, mask (0–7 to force one; default: lowest penalty) }
// → { version, size, ecl, mask, modules: [Uint8Array row …] (1 = dark), byteLength }
export function encodeQr(text, options = {}) {
  const ecl = QR_EC_LEVELS.includes(options.ecl) ? options.ecl : 'M';
  const bytes = utf8Bytes(text);
  const minVersion = Math.max(QR_MIN_VERSION, Math.min(QR_MAX_VERSION, Number(options.minVersion) || QR_MIN_VERSION));
  let version = 0;
  for (let v = minVersion; v <= QR_MAX_VERSION; v += 1) if (bytes.length <= byteCapacity(v, ecl)) { version = v; break; }
  if (!version) throw new Error(`QR: ${bytes.length} bytes do not fit in version ${QR_MAX_VERSION} level ${ecl}`);
  const codewords = interleavedCodewords(bytes, version, ecl);
  const base = new Matrix(version);
  drawFunctionPatterns(base);
  placeCodewords(base, codewords);
  const forced = Number.isInteger(options.mask) && options.mask >= 0 && options.mask <= 7 ? options.mask : null;
  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    if (forced !== null && mask !== forced) continue;
    const m = new Matrix(version);
    for (let y = 0; y < m.size; y += 1) { m.dark[y].set(base.dark[y]); m.fixed[y].set(base.fixed[y]); }
    applyMask(m, mask);
    drawFormat(m, formatBits(ecl, mask));
    const score = penaltyScore(m.dark);
    if (!best || score < best.score) best = { score, mask, matrix: m };
  }
  return { version, size: best.matrix.size, ecl, mask: best.mask, modules: best.matrix.dark, byteLength: bytes.length, penalty: best.score };
}

// SVG of a matrix: one path of the dark modules (runs merged per row), a white background with a quiet zone of
// `border` modules, sized `sizeMm` millimetres (prints at a fixed physical size). label → role="img" + aria-label.
export function qrSvg(qr, options = {}) {
  const border = Number.isInteger(options.border) && options.border >= 0 ? options.border : 4;
  const full = qr.size + border * 2;
  const sizeMm = Number(options.sizeMm) > 0 ? Number(options.sizeMm) : 30;
  // options.size: a CSS length that scales with the document (e.g. "10em"); else sizeMm millimetres.
  const size = /^\d+(?:\.\d+)?(?:em|mm|px)$/.test(String(options.size || '')) ? options.size : `${sizeMm}mm`;
  let path = '';
  qr.modules.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      if (!row[x]) { x += 1; continue; }
      let end = x;
      while (end < row.length && row[end]) end += 1;
      path += `M${x + border} ${y + border}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  });
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const label = options.label ? ` role="img" aria-label="${escape(options.label)}"` : ' aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${size}" height="${size}" shape-rendering="crispEdges" style="display:block;width:${size};height:${size};flex:0 0 auto"${label}><rect width="${full}" height="${full}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
