// A small zip writer for a handful of text files. It only stores them (no compression), names them in UTF-8 and gives
// every file the same timestamp, so the same files always make exactly the same bytes. Plain TypeScript, no Node APIs.

// One file in the archive: its path inside it ("folder/file.md", forward slashes) and its contents.
export type ZipEntry = { path: string; data: Uint8Array | string };

// The time every file is stamped with: 2026-11-25 12:00, when the skill first shipped.
export const ZIP_TIME = { year: 2026, month: 11, day: 25, hour: 12, minute: 0, second: 0 } as const;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

// The CRC-32 of some bytes, the checksum zip keeps for each file (the same as zlib's crc32).
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const UTF8_NAMES = 0x0800; // general purpose flag bit 11: names are UTF-8
const VERSION = 20; // zip 2.0, enough for stored files
const MADE_BY_UNIX = (3 << 8) | VERSION; // so unzip on a Mac or Linux reads the permissions below
const FILE_MODE = 0o100644 * 0x10000; // a plain file, readable by everyone, writable by its owner
const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;

const dosTime = Math.floor(ZIP_TIME.second / 2) + (ZIP_TIME.minute << 5) + (ZIP_TIME.hour << 11);
const dosDate = ZIP_TIME.day + (ZIP_TIME.month << 5) + ((ZIP_TIME.year - 1980) << 9);

// The archive's bytes, files in the order given. Refuses an empty or repeated path, a path that starts with "/" or
// holds "..", and anything past the classic zip limits (65,535 files, 4 GB), which a skill never comes near.
export function zipFiles(entries: readonly ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  const files = entries.map((entry) => {
    if (!entry.path || entry.path.startsWith("/") || entry.path.split("/").includes("..") || entry.path.includes("\\")) {
      throw new Error(`zip: "${entry.path}" is not a path inside the archive.`);
    }
    if (seen.has(entry.path)) throw new Error(`zip: "${entry.path}" is in the archive twice.`);
    seen.add(entry.path);
    const name = encoder.encode(entry.path);
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    return { name, data, crc: crc32(data) };
  });
  if (files.length > 0xffff) throw new Error("zip: too many files.");

  const localSize = files.reduce((sum, f) => sum + LOCAL_HEADER + f.name.length + f.data.length, 0);
  const centralSize = files.reduce((sum, f) => sum + CENTRAL_HEADER + f.name.length, 0);
  if (localSize + centralSize > 0xffffffff) throw new Error("zip: too large.");

  const out = new Uint8Array(localSize + centralSize + END_RECORD);
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (value: number) => {
    view.setUint16(at, value, true);
    at += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(at, value >>> 0, true);
    at += 4;
  };
  const bytes = (value: Uint8Array) => {
    out.set(value, at);
    at += value.length;
  };

  const offsets: number[] = [];
  for (const f of files) {
    offsets.push(at);
    u32(0x04034b50);
    u16(VERSION);
    u16(UTF8_NAMES);
    u16(0); // stored
    u16(dosTime);
    u16(dosDate);
    u32(f.crc);
    u32(f.data.length);
    u32(f.data.length);
    u16(f.name.length);
    u16(0); // no extra field
    bytes(f.name);
    bytes(f.data);
  }

  const centralStart = at;
  files.forEach((f, i) => {
    u32(0x02014b50);
    u16(MADE_BY_UNIX);
    u16(VERSION);
    u16(UTF8_NAMES);
    u16(0);
    u16(dosTime);
    u16(dosDate);
    u32(f.crc);
    u32(f.data.length);
    u32(f.data.length);
    u16(f.name.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk
    u16(0); // internal attributes
    u32(FILE_MODE);
    u32(offsets[i]);
    bytes(f.name);
  });

  const centralEnd = at;
  u32(0x06054b50);
  u16(0); // this disk
  u16(0); // the disk the central directory starts on
  u16(files.length);
  u16(files.length);
  u32(centralEnd - centralStart);
  u32(centralStart);
  u16(0); // no comment
  return out;
}
