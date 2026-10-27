// A small QR Code READER for the tests (ADR-029): reads a module matrix (true = dark) back to its text, written apart
// from erp-qr-core.js with its own tables taken from ISO/IEC 18004 (error-correction blocks, alignment centres, the
// format / version BCH codes), so a mistake shared by encoder and reader is unlikely. It checks everything a phone
// camera would: the finder / timing patterns, the format information (both copies), the version information
// (version ≥ 7), every Reed–Solomon block (all syndromes zero), the byte-mode segment and the padding.
// Byte mode, versions 1–10 only (what the PromptPay box needs). Not a test file itself (no .test. in the name).
'use strict';

// ECC codewords per block and number of blocks, versions 1–10, levels L / M / Q / H (ISO/IEC 18004 table 9).
const ECC_PER_BLOCK = { L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18], M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26], Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24], H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28] };
const BLOCKS = { L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4], M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5], Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8], H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8] };
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
const MASK = [
  (r, c) => (r + c) % 2 === 0,
  r => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];
function bch(value, generator, degree) {
  let rem = value << degree;
  const top = 31 - Math.clz32(generator);
  for (let bit = 31 - Math.clz32(rem); bit >= top; bit -= 1) if ((rem >> bit) & 1) rem ^= generator << (bit - top);
  return (value << degree) | rem;
}
const formatWord = (ecl, mask) => bch((EC_BITS[ecl] << 3) | mask, 0x537, 10) ^ 0x5412;
const versionWord = version => bch(version, 0x1f25, 12);
// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Array(512);
const LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i += 1) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
const gfMul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
// Syndromes S_i = C(α^i), i = 0 … ecc − 1 (generator roots α^0 … α^(ecc−1)): all zero for a valid codeword.
function syndromesZero(block, ecc) {
  for (let i = 0; i < ecc; i += 1) {
    let value = 0;
    for (const byte of block) value = gfMul(value, EXP[i]) ^ byte;
    if (value) return false;
  }
  return true;
}

function functionMap(size, version) {
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (r, c) => { if (r >= 0 && r < size && c >= 0 && c < size) fn[r][c] = true; };
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) mark(r0 + r, c0 + c);
  for (let i = 0; i < size; i += 1) { mark(6, i); mark(i, 6); }
  const centres = ALIGN[version - 1];
  for (const r of centres) for (const c of centres) {
    if ((r === 6 && c === 6) || (r === 6 && c === centres[centres.length - 1]) || (r === centres[centres.length - 1] && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) mark(r + dr, c + dc);
  }
  for (let i = 0; i <= 8; i += 1) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i += 1) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }
  if (version >= 7) for (let i = 0; i < 6; i += 1) for (let j = 0; j < 3; j += 1) { mark(i, size - 11 + j); mark(size - 11 + j, i); }
  return fn;
}

// matrix: rows of booleans (row-major, no quiet zone) → { text, version, ecl, mask } — throws with the reason.
function readQr(matrix) {
  const size = matrix.length;
  if (!matrix.every(row => row.length === size) || (size - 17) % 4 || size < 21 || size > 57) throw new Error(`reader: bad size ${size}`);
  const version = (size - 17) / 4;
  const at = (r, c) => !!matrix[r][c];
  // Finder patterns (7 × 7: dark ring, light ring, 3 × 3 dark core) and the separators.
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = 0; r < 7; r += 1) for (let c = 0; c < 7; c += 1) {
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      if (at(r0 + r, c0 + c) !== (ring !== 2)) throw new Error('reader: finder pattern');
    }
  }
  for (let i = 8; i < size - 8; i += 1) if (at(6, i) !== (i % 2 === 0) || at(i, 6) !== (i % 2 === 0)) throw new Error('reader: timing pattern');
  if (!at(size - 8, 8)) throw new Error('reader: dark module');
  // Format information: copy 1 around the top-left finder, copy 2 split top-right / bottom-left; both must agree.
  let copy1 = 0;
  let copy2 = 0;
  const bit = (word, i, value) => (value ? word | (1 << i) : word);
  for (let i = 0; i <= 5; i += 1) copy1 = bit(copy1, i, at(i, 8));
  copy1 = bit(copy1, 6, at(7, 8));
  copy1 = bit(copy1, 7, at(8, 8));
  copy1 = bit(copy1, 8, at(8, 7));
  for (let i = 9; i < 15; i += 1) copy1 = bit(copy1, i, at(8, 14 - i));
  for (let i = 0; i < 8; i += 1) copy2 = bit(copy2, i, at(8, size - 1 - i));
  for (let i = 8; i < 15; i += 1) copy2 = bit(copy2, i, at(size - 15 + i, 8));
  if (copy1 !== copy2) throw new Error('reader: the two format copies differ');
  let ecl = '';
  let mask = -1;
  for (const level of Object.keys(EC_BITS)) for (let m = 0; m < 8; m += 1) if (formatWord(level, m) === copy1) { ecl = level; mask = m; }
  if (!ecl) throw new Error('reader: format information is not a valid code word');
  if (version >= 7) {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 18; i += 1) {
      a = bit(a, i, at(Math.floor(i / 3), size - 11 + (i % 3)));
      b = bit(b, i, at(size - 11 + (i % 3), Math.floor(i / 3)));
    }
    if (a !== versionWord(version) || b !== versionWord(version)) throw new Error('reader: version information');
  }
  // Data modules in the zig-zag order (two columns, up and down, skipping the vertical timing column), unmasked.
  const fn = functionMap(size, version);
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let v = 0; v < size; v += 1) {
      const r = upward ? size - 1 - v : v;
      for (let j = 0; j < 2; j += 1) {
        const c = right - j;
        if (fn[r][c]) continue;
        bits.push(at(r, c) !== MASK[mask](r, c) ? 1 : 0);
      }
    }
  }
  const total = Math.floor(bits.length / 8);
  const codewords = [];
  for (let i = 0; i < total; i += 1) { let byte = 0; for (let b = 0; b < 8; b += 1) byte = (byte << 1) | bits[i * 8 + b]; codewords.push(byte); }
  // De-interleave: data codewords column by column (short blocks first), then the ECC codewords.
  const ecc = ECC_PER_BLOCK[ecl][version - 1];
  const count = BLOCKS[ecl][version - 1];
  const shortLen = Math.floor(total / count);
  const longCount = total % count;
  const dataLens = Array.from({ length: count }, (_, i) => shortLen - ecc + (i >= count - longCount ? 1 : 0));
  const blocks = Array.from({ length: count }, () => []);
  let k = 0;
  for (let i = 0; i < Math.max(...dataLens); i += 1) for (let b = 0; b < count; b += 1) if (i < dataLens[b]) blocks[b].push(codewords[k++]);
  for (let i = 0; i < ecc; i += 1) for (let b = 0; b < count; b += 1) blocks[b].push(codewords[k++]);
  if (k !== total) throw new Error('reader: codeword count');
  blocks.forEach((block, i) => { if (!syndromesZero(block, ecc)) throw new Error(`reader: Reed–Solomon block ${i + 1} is not a valid code word`); });
  const data = blocks.flatMap((block, i) => block.slice(0, dataLens[i]));
  // One byte-mode segment, the terminator, then the 0xEC / 0x11 pad bytes.
  const stream = data.flatMap(byte => [7, 6, 5, 4, 3, 2, 1, 0].map(s => (byte >> s) & 1));
  let p = 0;
  const read = n => { let v = 0; for (let i = 0; i < n; i += 1) v = (v << 1) | stream[p++]; return v; };
  if (read(4) !== 0b0100) throw new Error('reader: not byte mode');
  const length = read(version <= 9 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < length; i += 1) bytes.push(read(8));
  const rest = stream.length - p;
  if (rest > 0 && read(Math.min(4, rest)) !== 0) throw new Error('reader: terminator');
  while (p % 8) if (stream[p++]) throw new Error('reader: bit padding');
  for (let i = p / 8, n = 0; i < data.length; i += 1, n += 1) if (data[i] !== (n % 2 ? 0x11 : 0xec)) throw new Error('reader: pad bytes');
  return { text: Buffer.from(bytes).toString('utf8'), version, ecl, mask };
}

// An SVG drawn by qrSvg() → its module matrix (each dark run "M{x} {y}h{n}v1h-{n}z"), without the quiet zone.
function matrixFromSvg(svg) {
  const view = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const path = /<path d="([^"]*)"/.exec(svg);
  if (!view || !path) throw new Error('reader: not a QR svg');
  const full = Number(view[1]);
  const grid = Array.from({ length: full }, () => new Array(full).fill(false));
  for (const m of path[1].matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
    const [x, y, n, back] = m.slice(1).map(Number);
    if (n !== back) throw new Error('reader: run');
    for (let i = 0; i < n; i += 1) grid[y][x + i] = true;
  }
  // The quiet zone is light on every side; the symbol is the dark bounding box.
  let min = full;
  let max = -1;
  grid.forEach((row, y) => row.forEach((dark, x) => { if (dark) { min = Math.min(min, x, y); max = Math.max(max, x, y); } }));
  return { border: min, matrix: grid.slice(min, max + 1).map(row => row.slice(min, max + 1)) };
}

module.exports = { readQr, matrixFromSvg, formatWord, versionWord };
