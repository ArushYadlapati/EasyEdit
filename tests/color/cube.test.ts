import { describe, expect, it } from "vitest";
import { CUBE_MESSAGE, LUT_SIZE, lutName, packBytes, packedLength, parseCube, readLut, shrinkCube, unpackBytes, type ParsedCube } from "@/lib/color/cube";
import { lutValue } from "@/lib/color/grade";

function cubeText(size: number, make: (r: number, g: number, b: number) => number[], head = ""): string {
  let text = `${head}LUT_3D_SIZE ${size}\n`;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) text += `${make(r / (size - 1), g / (size - 1), b / (size - 1)).map((v) => v.toFixed(6)).join(" ")}\n`;
  return text;
}
const parsed = (text: string) => parseCube(text) as ParsedCube;

describe("reading a .cube file", () => {
  it("takes its title, its size and every row, past comments and blank lines", () => {
    const cube = parsed(`# made by a camera\n\nTITLE "Warm Film"\r\n${cubeText(2, (r, g, b) => [r, g, b])}`);
    expect(cube.title).toBe("Warm Film");
    expect(cube.size).toBe(2);
    expect([...cube.values]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1]);
  });
  it("fits the file's own range to 0–1", () => {
    const cube = parsed(cubeText(2, (r, g, b) => [r * 1023, g * 1023, b * 1023], "DOMAIN_MIN 0 0 0\nDOMAIN_MAX 1023 1023 1023\n"));
    expect([...cube.values].slice(3, 6)).toEqual([1, 0, 0]);
  });
  it("says what is wrong with a file it cannot use", () => {
    expect(parseCube("")).toEqual({ error: "empty" });
    expect(parseCube("hello there\n")).toEqual({ error: "empty" });
    expect(parseCube("LUT_1D_SIZE 4\n0 0 0\n1 1 1\n")).toEqual({ error: "one_d" });
    expect(parseCube("LUT_3D_SIZE 1\n0 0 0\n")).toEqual({ error: "size" });
    expect(parseCube("LUT_3D_SIZE 500\n0 0 0\n")).toEqual({ error: "size" });
    expect(parseCube("LUT_3D_SIZE 2\n0 0 0\n1 1 1\n")).toEqual({ error: "count" });
    expect(parseCube(`${cubeText(2, (r, g, b) => [r, g, b])}0 0 0\n`)).toEqual({ error: "count" });
    expect(parseCube("LUT_3D_SIZE 2\n0 0\n")).toEqual({ error: "number" });
    expect(parseCube("LUT_3D_SIZE 2\n0 0 1e999\n")).toEqual({ error: "number" });
    for (const message of Object.values(CUBE_MESSAGE)) expect(message.length).toBeGreaterThan(10);
  });
});

describe("keeping a table", () => {
  it("keeps a small table as it is, a byte a number", () => {
    const lut = shrinkCube(parsed(cubeText(3, (r, g, b) => [b, g, r])));
    expect(lut.size).toBe(3);
    expect(lut.data.length).toBe(81);
    expect([...lut.data.slice(3, 6)]).toEqual([0, 0, 128]); // red 0.5 comes out as blue 0.5
    expect([...lut.data.slice(6, 9)]).toEqual([0, 0, 255]);
  });
  it("samples a larger table down, and it still gives the same colours", () => {
    const make = (r: number, g: number, b: number) => [b * b, 1 - g, Math.sqrt(r)];
    const lut = shrinkCube(parsed(cubeText(33, make)));
    expect(lut.size).toBe(LUT_SIZE);
    for (const c of [[0, 0, 0], [1, 1, 1], [0.5, 0.25, 0.75], [0.31, 0.62, 0.93]] as [number, number, number][]) {
      const out = lutValue(lut, c);
      const want = make(...c);
      // Between its steps a square root or a square is not a straight line, so a little is lost: under two percent.
      for (let i = 0; i < 3; i++) expect(Math.abs(out[i] - want[i])).toBeLessThan(0.02);
    }
    const odd = shrinkCube(parsed(cubeText(20, (r, g, b) => [r, g, b])));
    expect(odd.size).toBe(LUT_SIZE);
    for (let i = 0; i < 3; i++) expect(Math.abs(lutValue(odd, [0.3, 0.6, 0.9])[i] - [0.3, 0.6, 0.9][i])).toBeLessThan(0.006);
  });
  it("packs to text and back", () => {
    for (const length of [0, 1, 2, 3, 4, 81, 14739]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
      const text = packBytes(bytes);
      expect(text).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
      expect([...unpackBytes(text)!]).toEqual([...bytes]);
    }
    expect(packBytes(new Uint8Array([104, 105]))).toBe("aGk=");
    expect(unpackBytes("abc")).toBeNull();
    expect(unpackBytes("ab!d")).toBeNull();
    expect(unpackBytes("a=bc")).toBeNull();
  });
  it("reads a kept table back only when it is the size it says", () => {
    const lut = shrinkCube(parsed(cubeText(3, (r, g, b) => [r, g, b])));
    const text = packBytes(lut.data);
    expect(text.length).toBe(packedLength(3));
    expect(packedLength(LUT_SIZE)).toBe(19652);
    expect([...readLut(3, text)!.data]).toEqual([...lut.data]);
    expect(readLut(4, text)).toBeNull();
    expect(readLut(3, `${text.slice(0, -1)}!`)).toBeNull();
  });
  it("is named by its title, else its file", () => {
    expect(lutName("Kodak 2383.cube", null)).toBe("Kodak 2383");
    expect(lutName("x.cube", "  Teal & Orange ")).toBe("Teal & Orange");
    expect(lutName(".cube", null)).toBe("LUT");
    expect(lutName(`${"a".repeat(90)}.cube`, null).length).toBe(60);
  });
});
