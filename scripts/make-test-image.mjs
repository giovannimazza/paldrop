// Generates a valid PNG test photo (no dependencies) for manual/smoke testing.
// Usage: node scripts/make-test-image.mjs [width] [height] [out.png]
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const width = Number(process.argv[2] ?? 640);
const height = Number(process.argv[3] ?? 480);
const out = process.argv[4] ?? "scripts/test-photo.png";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type: truecolor RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc((width * 3 + 1) * height);
let offset = 0;
for (let y = 0; y < height; y++) {
  raw[offset++] = 0; // filter: none
  for (let x = 0; x < width; x++) {
    raw[offset++] = Math.round((x / width) * 255);
    raw[offset++] = Math.round((y / height) * 255);
    raw[offset++] = 190;
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(out, png);
console.log(`Wrote ${out} (${width}x${height}, ${png.length} bytes)`);
