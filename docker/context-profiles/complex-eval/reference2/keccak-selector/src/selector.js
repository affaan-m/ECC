'use strict';
// Keccak-256 (original Keccak padding 0x01, NOT the NIST SHA3-256 suffix 0x06).
// Keccak-f[1600] permutation over 25 64-bit little-endian lanes as BigInts.
const RC = [0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n];
const ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]];
const MASK = 0xffffffffffffffffn;
const rotl = (x, n) => n === 0n ? x : ((x << n) | (x >> (64n - n))) & MASK;

function keccakF(s) {
  for (let round = 0; round < 24; round++) {
    const c = [];
    const d = [];
    for (let x = 0; x < 5; x++) c[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    for (let x = 0; x < 5; x++) d[x] = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1n);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) s[x + 5 * y] ^= d[x];
    const b = new Array(25);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], BigInt(ROT[x][y]));
    }
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) s[x + 5 * y] = b[x + 5 * y] ^ ((~b[(x + 1) % 5 + 5 * y] & MASK) & b[(x + 2) % 5 + 5 * y]);
    }
    s[0] ^= RC[round];
  }
}

function keccak256(bytes) {
  const rate = 136; // 1088-bit rate, 512-bit capacity
  const state = new Array(25).fill(0n);
  const q = rate - (bytes.length % rate);
  const padded = Buffer.concat([bytes, Buffer.from([0x01]), Buffer.alloc(q - 1)]);
  padded[padded.length - 1] |= 0x80;
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate; i++) state[i >> 3] ^= BigInt(padded[offset + i]) << BigInt(8 * (i & 7));
    keccakF(state);
  }
  const out = [];
  for (let i = 0; i < 32; i++) out.push(Number((state[i >> 3] >> BigInt(8 * (i & 7))) & 0xffn));
  return Buffer.from(out);
}

function functionSelector(signature) {
  if (typeof signature !== 'string') throw new TypeError('signature must be a string');
  return `0x${keccak256(Buffer.from(signature, 'utf8')).subarray(0, 4).toString('hex')}`;
}

module.exports = { functionSelector };
