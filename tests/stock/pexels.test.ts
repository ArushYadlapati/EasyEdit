import { describe, expect, it } from "vitest";
import { isStockFile, readSearch, searchUrl } from "@/lib/stock/pexels";

// Answers in the shape Pexels' API documents.
const video = (change: Record<string, unknown> = {}) => ({
  id: 6754822,
  width: 3840,
  height: 2160,
  duration: 14,
  url: "https://www.pexels.com/video/close-up-shot-of-a-printed-circuit-board-6754822/",
  image: "https://images.pexels.com/videos/6754822/pictures/preview-0.jpg",
  user: { id: 1, name: "Pavel Danilyuk", url: "https://www.pexels.com/@pavel-danilyuk" },
  video_files: [
    { id: 1, quality: "sd", file_type: "video/mp4", width: 640, height: 360, link: "https://videos.pexels.com/video-files/6754822/6754822-sd_640_360_25fps.mp4" },
    { id: 2, quality: "uhd", file_type: "video/mp4", width: 3840, height: 2160, link: "https://videos.pexels.com/video-files/6754822/6754822-uhd_3840_2160_25fps.mp4" },
    { id: 3, quality: "hd", file_type: "video/mp4", width: 1920, height: 1080, link: "https://videos.pexels.com/video-files/6754822/6754822-hd_1920_1080_25fps.mp4" },
    { id: 4, quality: "hls", file_type: "application/x-mpegURL", width: null, height: null, link: "https://videos.pexels.com/video-files/6754822/master.m3u8" },
  ],
  ...change,
});
const photo = (change: Record<string, unknown> = {}) => ({
  id: 414612,
  width: 5184,
  height: 3456,
  url: "https://www.pexels.com/photo/landscape-photography-of-mountains-414612/",
  photographer: "James Wheeler",
  photographer_url: "https://www.pexels.com/@james-wheeler",
  alt: "Mountains under a blue sky",
  src: {
    original: "https://images.pexels.com/photos/414612/pexels-photo-414612.jpeg",
    large2x: "https://images.pexels.com/photos/414612/pexels-photo-414612.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
    medium: "https://images.pexels.com/photos/414612/pexels-photo-414612.jpeg?auto=compress&cs=tinysrgb&h=350",
    small: "https://images.pexels.com/photos/414612/pexels-photo-414612.jpeg?auto=compress&cs=tinysrgb&h=130",
  },
  ...change,
});

describe("a search's address", () => {
  it("searches for the words, a page at a time", () => {
    expect(searchUrl("video", " robot arm ", 2)).toBe("https://api.pexels.com/videos/search?per_page=24&page=2&query=robot+arm");
    expect(searchUrl("image", "a&b=c", 1)).toBe("https://api.pexels.com/v1/search?per_page=24&page=1&query=a%26b%3Dc");
  });
  it("without words is what is popular", () => {
    expect(searchUrl("video", "  ", 1)).toBe("https://api.pexels.com/videos/popular?per_page=24&page=1");
    expect(searchUrl("image", "", 3)).toBe("https://api.pexels.com/v1/curated?per_page=24&page=3");
  });
});

describe("a video", () => {
  it("is read with its 1080p MP4, its length, its maker and a file name from its page", () => {
    expect(readSearch("video", { videos: [video()], next_page: "https://api.pexels.com/videos/search?page=2" })).toEqual({
      more: true,
      items: [
        {
          id: "6754822",
          kind: "video",
          width: 1920,
          height: 1080,
          seconds: 14,
          thumb: "https://images.pexels.com/videos/6754822/pictures/preview-0.jpg",
          file: "https://videos.pexels.com/video-files/6754822/6754822-hd_1920_1080_25fps.mp4",
          fileName: "close-up-shot-of-a-printed-circuit-board-pexels-6754822.mp4",
          by: "Pavel Danilyuk",
          byUrl: "https://www.pexels.com/@pavel-danilyuk",
          page: "https://www.pexels.com/video/close-up-shot-of-a-printed-circuit-board-6754822/",
        },
      ],
    });
  });
  it("takes the smallest file when every one is larger than 1080p, and an upright one by its long side", () => {
    const big = video({ video_files: [video().video_files[1]] });
    expect(readSearch("video", { videos: [big] }).items[0]).toMatchObject({ width: 3840, height: 2160 });
    const upright = video({ video_files: [{ file_type: "video/mp4", width: 1080, height: 1920, link: "https://videos.pexels.com/a.mp4" }, { file_type: "video/mp4", width: 2160, height: 3840, link: "https://videos.pexels.com/b.mp4" }] });
    expect(readSearch("video", { videos: [upright] }).items[0]).toMatchObject({ width: 1080, height: 1920, file: "https://videos.pexels.com/a.mp4" });
  });
  it("is left out with no MP4, no picture, or a file anywhere but Pexels", () => {
    const elsewhere = video({ video_files: [{ file_type: "video/mp4", width: 1920, height: 1080, link: "https://videos.pexels.com.evil.example/x.mp4" }] });
    const plain = video({ video_files: [{ file_type: "video/mp4", width: 1920, height: 1080, link: "http://videos.pexels.com/x.mp4" }] });
    const list = [video({ video_files: [video().video_files[3]] }), video({ image: "" }), elsewhere, plain, video({ id: "x" }), null, "video"];
    expect(readSearch("video", { videos: list })).toEqual({ items: [], more: false });
  });
  it("keeps a maker's link and a page only when they are Pexels' own", () => {
    const item = readSearch("video", { videos: [video({ url: "https://example.com/video/x-6754822/", user: { name: "", url: "javascript:alert(1)" } })] }).items[0];
    expect(item).toMatchObject({ by: "Pexels", byUrl: null, page: null, fileName: "pexels-6754822.mp4" });
  });
});

describe("a photo", () => {
  it("is read with its large picture and its maker", () => {
    expect(readSearch("image", { photos: [photo()] }).items[0]).toEqual({
      id: "414612",
      kind: "image",
      width: 5184,
      height: 3456,
      seconds: null,
      thumb: "https://images.pexels.com/photos/414612/pexels-photo-414612.jpeg?auto=compress&cs=tinysrgb&h=350",
      file: "https://images.pexels.com/photos/414612/pexels-photo-414612.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
      fileName: "landscape-photography-of-mountains-pexels-414612.jpg",
      by: "James Wheeler",
      byUrl: "https://www.pexels.com/@james-wheeler",
      page: "https://www.pexels.com/photo/landscape-photography-of-mountains-414612/",
    });
  });
  it("falls back to the original file, and to its description for a name", () => {
    const item = readSearch("image", { photos: [photo({ url: "", src: { original: photo().src.original, small: photo().src.small } })] }).items[0];
    expect(item).toMatchObject({ file: photo().src.original, thumb: photo().src.small, fileName: "mountains-under-a-blue-sky-pexels-414612.jpg" });
  });
});

describe("an answer that is not Pexels'", () => {
  it("reads as nothing", () => {
    for (const body of [null, "x", [], {}, { videos: "x" }, { photos: {} }]) expect(readSearch("video", body)).toEqual({ items: [], more: false });
    expect(readSearch("image", { videos: [video()] }).items).toEqual([]);
  });
});

describe("a stock file's address", () => {
  it("is only ever on Pexels' file servers, over https", () => {
    expect(isStockFile("https://videos.pexels.com/video-files/1/1.mp4")).toBe(true);
    expect(isStockFile("https://images.pexels.com/photos/1/1.jpeg?w=940")).toBe(true);
    for (const bad of ["http://videos.pexels.com/1.mp4", "https://pexels.com.example/1.mp4", "https://user@videos.pexels.com/1.mp4", "/api/media/1", "", "blob:x"]) expect(isStockFile(bad), bad).toBe(false);
  });
});
