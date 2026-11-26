import { crc32 as zlibCrc32 } from "node:zlib";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { GET, dynamic } from "@/app/skills/easyedit-video.zip/route";
import { config } from "@/proxy";
import { SKILL_MD, SKILL_TOPICS, skillArchive, skillFiles } from "@/lib/skills";
import { SKILL_ZIP_PATH } from "@/lib/skills/words";
import { ZIP_TIME, crc32, zipFiles } from "@/lib/skills/zip";

type Read = { name: string; data: Uint8Array; crc: number; flags: number; method: number; time: number; date: number };

// A tiny zip reader for the test: the end record, then each central directory entry and the local header it points at.
// Every field the two headers share must agree.
function readZip(bytes: Uint8Array): Read[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true), "end record").toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  expect(view.getUint16(end + 8, true)).toBe(count);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  expect(start + size).toBe(end);
  expect(view.getUint16(end + 20, true), "no comment").toBe(0);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files: Read[] = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true), "central header").toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const length = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    expect(view.getUint16(at + 30, true) + view.getUint16(at + 32, true), "no extra or comment").toBe(0);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength;

    expect(view.getUint32(local, true), `${name}: local header`).toBe(0x04034b50);
    expect(view.getUint16(local + 6, true)).toBe(flags);
    expect(view.getUint16(local + 8, true)).toBe(method);
    expect(view.getUint16(local + 10, true)).toBe(time);
    expect(view.getUint16(local + 12, true)).toBe(date);
    expect(view.getUint32(local + 14, true)).toBe(crc);
    expect(view.getUint32(local + 18, true)).toBe(packed);
    expect(view.getUint32(local + 22, true)).toBe(length);
    expect(view.getUint16(local + 26, true)).toBe(nameLength);
    const extra = view.getUint16(local + 28, true);
    expect(decoder.decode(bytes.subarray(local + 30, local + 30 + nameLength))).toBe(name);
    const from = local + 30 + nameLength + extra;
    expect(packed, `${name}: stored, not packed`).toBe(length);
    files.push({ name, data: bytes.subarray(from, from + length), crc, flags, method, time, date });
  }
  expect(at).toBe(end);
  return files;
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("the zip writer", () => {
  it("computes the same CRC-32 as zlib", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    const sample = new TextEncoder().encode("Read this when you are shaping the first 1–3 seconds. ✂️");
    expect(crc32(sample)).toBe(zlibCrc32(sample));
  });

  it("stores each file under its UTF-8 name with its CRC and a fixed time, in the order given", () => {
    const files = readZip(zipFiles([
      { path: "a/b.md", data: "# Hi\n" },
      { path: "a/café ✓.md", data: "déjà vu" },
      { path: "raw.bin", data: new Uint8Array([0, 1, 2, 255]) },
    ]));
    expect(files.map((f) => f.name)).toEqual(["a/b.md", "a/café ✓.md", "raw.bin"]);
    expect(text(files[0].data)).toBe("# Hi\n");
    expect(text(files[1].data)).toBe("déjà vu");
    expect([...files[2].data]).toEqual([0, 1, 2, 255]);
    for (const f of files) {
      expect(f.crc, f.name).toBe(zlibCrc32(f.data));
      expect(f.method, f.name).toBe(0);
      expect(f.flags & 0x0800, `${f.name}: UTF-8 name`).toBe(0x0800);
      expect(f.date, f.name).toBe(((ZIP_TIME.year - 1980) << 9) | (ZIP_TIME.month << 5) | ZIP_TIME.day);
      expect(f.time, f.name).toBe((ZIP_TIME.hour << 11) | (ZIP_TIME.minute << 5) | (ZIP_TIME.second >> 1));
    }
  });

  it("makes the same bytes every time, and an empty archive is just the end record", () => {
    const entries = [{ path: "x.md", data: "x" }];
    expect(zipFiles(entries)).toEqual(zipFiles(entries));
    expect([...zipFiles([])]).toEqual([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
  });

  it("refuses a path outside the archive, an empty one and a repeated one", () => {
    for (const path of ["", "/etc/x", "../x", "a/../../x", "a\\b"]) expect(() => zipFiles([{ path, data: "" }]), path).toThrow("is not a path inside the archive");
    expect(() => zipFiles([{ path: "a", data: "" }, { path: "a", data: "" }])).toThrow("is in the archive twice");
  });
});

describe("the skill's zip", () => {
  it("holds easyedit-video/SKILL.md and every topic under references/, word for word", () => {
    const files = readZip(skillArchive());
    expect(files.map((f) => f.name)).toEqual([
      "easyedit-video/SKILL.md",
      ...SKILL_TOPICS.map((t) => `easyedit-video/references/${t.id}.md`),
    ]);
    expect(text(files[0].data)).toBe(SKILL_MD);
    SKILL_TOPICS.forEach((topic, i) => expect(text(files[i + 1].data), topic.id).toBe(topic.body));
    expect(files.map((f) => text(f.data))).toEqual(skillFiles().map((f) => f.text));
  });

  it("is served at /skills/easyedit-video.zip to anyone, as a download that can be cached", async () => {
    expect(SKILL_ZIP_PATH).toBe("/skills/easyedit-video.zip");
    expect(dynamic).toBe("force-static");
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="easyedit-video.zip"');
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(skillArchive());
    expect(readZip(body)).toHaveLength(SKILL_TOPICS.length + 1);
  });

  it("is not behind sign-in", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: SKILL_ZIP_PATH })).toBe(false);
  });
});
