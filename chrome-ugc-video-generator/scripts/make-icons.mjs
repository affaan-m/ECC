// Generates the three PNG icons without any dependency: a warm coral square
// with a white play-triangle. Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function pixel(x, y, size) {
  const r = size * 0.22;
  const far = (cx, cy) => Math.hypot(x - cx, y - cy) > r;
  const outside = (x < r && y < r && far(r, r)) || (x > size - r && y < r && far(size - r, r))
    || (x < r && y > size - r && far(r, size - r)) || (x > size - r && y > size - r && far(size - r, size - r));
  if (outside) return [0, 0, 0, 0];
  const px = x / size;
  const py = y / size;
  const halfHeight = (0.72 - px) * 0.78;
  const inTriangle = px >= 0.36 && px <= 0.72 && Math.abs(py - 0.5) <= Math.min(halfHeight, 0.28);
  return inTriangle ? [255, 250, 245, 255] : [224, 88, 60, 255];
}

function png(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x += 1) {
      raw.set(pixel(x + 0.5, y + 0.5, size), y * stride + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(join(root, 'icons'), { recursive: true });
for (const size of [16, 48, 128]) writeFileSync(join(root, 'icons', `icon${size}.png`), png(size));
console.log('icons written');
