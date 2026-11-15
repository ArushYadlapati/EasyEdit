import { describe, expect, it } from "vitest";
import { formatTimecode } from "@/lib/editor/geometry";
import { parseTime } from "@/lib/editor/parse-time";

describe("parseTime", () => {
  it("reads the readout's own m:ss:ff and h:mm:ss:ff", () => {
    expect(parseTime("0:03:15", 30)).toBe(105);
    expect(parseTime("1:00:03:15", 30)).toBe(108_105);
  });

  it("reads every readout it formats back to the same frame", () => {
    for (const frame of [0, 1, 29, 30, 1799, 1800, 108_105]) expect(parseTime(formatTimecode(frame, 30), 30)).toBe(frame);
  });

  it("reads m:ss as minutes and seconds, and one number as seconds", () => {
    expect(parseTime("1:30", 30)).toBe(2700);
    expect(parseTime("12", 30)).toBe(360);
    expect(parseTime("0", 24)).toBe(0);
  });

  it("takes decimal seconds when there are no frames", () => {
    expect(parseTime("1.5", 30)).toBe(45);
    expect(parseTime("0:02.5", 24)).toBe(60);
  });

  it("carries extra frames and seconds over, as editors do", () => {
    expect(parseTime("0:00:45", 30)).toBe(45);
    expect(parseTime("0:90", 30)).toBe(2700);
  });

  it("ignores spaces around the parts", () => {
    expect(parseTime("  0 : 02 : 10 ", 30)).toBe(70);
  });

  it("refuses what is not a time", () => {
    for (const text of ["", "   ", "abc", "1:2:3:4:5", "-1", "1:-2", "1e3", "0:02.5:10", "1:", ":", "1..2"]) {
      expect(parseTime(text, 30)).toBeNull();
    }
  });
});
