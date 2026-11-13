// Checks a finished export with ffmpeg and ffprobe, the way a player or an
// upload site would read it, and compares frames of it with images the editor
// saved. Run by hand; it is not part of `pnpm test`.
//
//   pnpm check:export <video.mp4> --size 1080x1920 --fps 30 [--frames 450] [--no-audio]
//     [--still "<name> frame 000045.png"]… [--media-still "<name> frame 000045.png"]…
//
// Exits 0 when every check passes, 1 when one fails, 2 on a usage error or
// when ffmpeg or ffprobe is missing.

import { spawn } from "node:child_process";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { compareFrames, parseStillName } from "./compare.mjs";

const USAGE =
  'Usage: pnpm check:export <video.mp4> --size 1080x1920 --fps 30 [--frames 450] [--no-audio] [--still "<name> frame 000045.png"]… [--media-still "<name> frame 000045.png"]…';
const NO_FFMPEG = "This check needs ffmpeg and ffprobe (brew install ffmpeg).";
const PROFILES = ["High", "Main", "Constrained Baseline", "Baseline"];
const LENGTH_TOLERANCE = 0.001;
const AUDIO_TOLERANCE = 0.05;

function usageError(reason) {
  if (reason) console.error(reason);
  console.error(USAGE);
  process.exit(2);
}

function readArgs() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      tokens: true,
      options: {
        size: { type: "string" },
        fps: { type: "string" },
        frames: { type: "string" },
        "no-audio": { type: "boolean", default: false },
        still: { type: "string", multiple: true },
        "media-still": { type: "string", multiple: true },
      },
    });
  } catch (error) {
    usageError(error instanceof Error ? error.message : undefined);
  }
  const { values, positionals, tokens } = parsed;
  if (positionals.length !== 1) usageError(positionals.length > 1 ? "Give one video file." : undefined);
  const size = /^(\d+)x(\d+)$/.exec(values.size ?? "");
  if (!size || Number(size[1]) === 0 || Number(size[2]) === 0) usageError("--size must look like 1080x1920.");
  const fps = /^[1-9]\d*$/.test(values.fps ?? "") ? Number(values.fps) : usageError("--fps must be a whole number, like 30.");
  let frames = null;
  if (values.frames !== undefined) {
    frames = /^\d+$/.test(values.frames) ? Number(values.frames) : usageError("--frames must be a whole number.");
  }
  return {
    video: positionals[0],
    width: Number(size[1]),
    height: Number(size[2]),
    fps,
    frames,
    noAudio: values["no-audio"],
    // In the order they were given, so the lines follow the command.
    stills: tokens
      .filter((token) => token.kind === "option" && (token.name === "still" || token.name === "media-still"))
      .map((token) => ({ path: token.value, media: token.name === "media-still" })),
  };
}

// Runs a program and collects what it prints. Rejects only when the program
// cannot be started.
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8") }));
  });
}

async function haveTools() {
  try {
    const [ffmpeg, ffprobe] = await Promise.all([run("ffmpeg", ["-version"]), run("ffprobe", ["-version"])]);
    return ffmpeg.code === 0 && ffprobe.code === 0;
  } catch {
    return false;
  }
}

const results = [];
function report(number, name, ok, seen) {
  results.push({ number, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${String(number).padStart(2)}  ${name}: ${seen}`);
}

const firstLine = (text) => text.trim().split("\n")[0] || "no message";
const seconds = (value) => `${value.toFixed(3)} s`;
const number = (value) => (value === undefined ? NaN : Number(value));

async function main() {
  const args = readArgs();
  if (!(await haveTools())) {
    console.error(NO_FFMPEG);
    process.exit(2);
  }

  // 1. The file exists and can be read.
  const probe = await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-count_frames", "-of", "json", args.video]);
  let info = null;
  if (probe.code === 0) {
    try {
      info = JSON.parse(probe.stdout.toString("utf8"));
    } catch {
      info = null;
    }
  }
  if (!info || !Array.isArray(info.streams)) {
    report(1, "the file can be read", false, probe.code === 0 ? "ffprobe printed no stream list" : firstLine(probe.stderr));
    console.log("\nThe file could not be read, so nothing else was checked.");
    process.exit(1);
  }
  report(1, "the file can be read", true, `${basename(args.video)}, ${info.format?.format_name ?? "unknown format"}`);

  // 2. One video stream, at most one audio stream.
  const videos = info.streams.filter((stream) => stream.codec_type === "video");
  const audios = info.streams.filter((stream) => stream.codec_type === "audio");
  report(2, "streams", videos.length === 1 && audios.length <= 1, `${videos.length} video, ${audios.length} audio`);
  const video = videos[0];
  const audio = audios[0];
  const needVideo = (n, name, test) => {
    if (!video) return report(n, name, false, "no video stream");
    const [ok, seen] = test(video);
    report(n, name, ok, seen);
  };

  // 3. H.264, in a profile every player decodes.
  needVideo(3, "video codec", (v) => [v.codec_name === "h264" && PROFILES.includes(v.profile), `${v.codec_name}, profile ${v.profile ?? "unknown"}`]);

  // 4. Pixel format.
  needVideo(4, "pixel format", (v) => [v.pix_fmt === "yuv420p", v.pix_fmt ?? "unknown"]);

  // 5. Size.
  needVideo(5, "size", (v) => [
    v.width === args.width && v.height === args.height,
    `${v.width}x${v.height}${v.width === args.width && v.height === args.height ? "" : `, expected ${args.width}x${args.height}`}`,
  ]);

  // 6. Frame rate, exact.
  const rate = `${args.fps}/1`;
  needVideo(6, "frame rate", (v) => [
    v.r_frame_rate === rate && v.avg_frame_rate === rate,
    `r_frame_rate ${v.r_frame_rate}, avg_frame_rate ${v.avg_frame_rate}${v.r_frame_rate === rate && v.avg_frame_rate === rate ? "" : `, expected ${rate}`}`,
  ]);

  // 7. Frame count.
  const frameCount = video ? number(video.nb_read_frames) : NaN;
  needVideo(7, "frame count", () => {
    if (!Number.isInteger(frameCount)) return [false, "ffprobe counted no frames"];
    if (args.frames === null) return [true, `${frameCount} frames`];
    return [frameCount === args.frames, `${frameCount} frames${frameCount === args.frames ? "" : `, expected ${args.frames}`}`];
  });

  // 8. Length is the frame count over the frame rate, starting at 0.
  const videoStart = video ? number(video.start_time) : NaN;
  const videoLength = video ? number(video.duration) : NaN;
  needVideo(8, "video length", () => {
    if (!Number.isFinite(videoLength) || !Number.isFinite(videoStart)) return [false, "no duration or start time"];
    const expected = frameCount / args.fps;
    const ok = Math.abs(videoLength - expected) <= LENGTH_TOLERANCE && Math.abs(videoStart) <= LENGTH_TOLERANCE;
    return [ok, `${seconds(videoLength)} from ${seconds(videoStart)}, expected ${seconds(Number.isFinite(expected) ? expected : 0)} from 0`];
  });

  // 9. Color tags.
  needVideo(9, "color tags", (v) => {
    const tags = [v.color_space, v.color_primaries, v.color_range];
    const ok = tags.every((tag) => typeof tag === "string" && tag !== "unknown");
    return [ok, `color_space ${v.color_space ?? "unknown"}, color_primaries ${v.color_primaries ?? "unknown"}, color_range ${v.color_range ?? "unknown"}`];
  });

  // 10. No rotation.
  needVideo(10, "no rotation", (v) => {
    const side = (v.side_data_list ?? []).find((entry) => entry && "rotation" in entry);
    const tag = v.tags?.rotate;
    if (side) return [false, `rotation ${side.rotation} in the side data`];
    if (tag !== undefined) return [false, `rotate ${tag} in the tags`];
    return [true, "none"];
  });

  // 11. A keyframe at frame 0 and every 2 × fps frames.
  if (video) {
    const listed = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=key_frame", "-of", "csv=p=0", args.video]);
    const keys = listed.stdout
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line) => line.split(",")[0] === "1");
    const every = 2 * args.fps;
    const missing = [];
    let wanted = 0;
    for (let frame = 0; frame < keys.length; frame += every) {
      wanted++;
      if (!keys[frame]) missing.push(frame);
    }
    const ok = listed.code === 0 && keys.length > 0 && missing.length === 0;
    const seen =
      listed.code !== 0 || keys.length === 0
        ? `could not list the frames: ${firstLine(listed.stderr)}`
        : missing.length === 0
          ? `at frame 0 and every ${every} frames (${wanted} of ${wanted})`
          : `none at frame${missing.length > 1 ? "s" : ""} ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""} (${wanted - missing.length} of ${wanted})`;
    report(11, "keyframes", ok, seen);
  } else {
    report(11, "keyframes", false, "no video stream");
  }

  // 12. The sound track.
  if (args.noAudio) {
    report(12, "audio", !audio, audio ? `an audio stream (${audio.codec_name}), expected none` : "none, as asked");
  } else if (!audio) {
    report(12, "audio", false, "no audio stream");
  } else {
    const start = number(audio.start_time);
    const length = number(audio.duration);
    const format = audio.codec_name === "aac" && audio.sample_rate === "48000" && audio.channels === 2;
    const startsWithVideo = Number.isFinite(start) && Number.isFinite(videoStart) && Math.abs(start - videoStart) <= AUDIO_TOLERANCE;
    const lastsAsVideo = Number.isFinite(length) && Number.isFinite(videoLength) && Math.abs(length - videoLength) <= AUDIO_TOLERANCE;
    report(
      12,
      "audio",
      format && startsWithVideo && lastsAsVideo,
      `${audio.codec_name}, ${audio.sample_rate} Hz, ${audio.channels} channels, ${Number.isFinite(length) ? seconds(length) : "no length"} from ${Number.isFinite(start) ? seconds(start) : "no start"}`,
    );
  }

  // 13. The whole file decodes without an error.
  const decoded = await run("ffmpeg", ["-v", "error", "-i", args.video, "-f", "null", "-"]);
  const decodeErrors = (decoded.stdout.toString("utf8") + decoded.stderr).trim();
  report(13, "decodes without an error", decoded.code === 0 && decodeErrors === "", decodeErrors === "" ? (decoded.code === 0 ? "no errors" : `ffmpeg exited ${decoded.code}`) : firstLine(decodeErrors));

  // 14. Each saved image matches its frame of the video.
  for (const still of args.stills) {
    const name = `frame of ${basename(still.path)}${still.media ? " (media)" : ""}`;
    const [ok, seen] = await compareStill(args.video, still, video, frameCount);
    report(14, name, ok, seen);
  }

  const failed = results.filter((result) => !result.ok);
  console.log(
    failed.length === 0
      ? `\nAll ${results.length} checks passed.`
      : `\n${failed.length} of ${results.length} checks failed: ${[...new Set(failed.map((result) => result.number))].join(", ")}.`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

async function compareStill(videoPath, still, video, frameCount) {
  if (!video) return [false, "no video stream"];
  const frame = parseStillName(still.path);
  if (frame === null) return [false, 'the name does not end in "frame" and six digits, as the editor saves it'];
  if (Number.isInteger(frameCount) && frame >= frameCount) return [false, `the video has no frame ${frame}`];
  const bytes = video.width * video.height * 3;
  const exported = await run("ffmpeg", ["-v", "error", "-i", videoPath, "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const image = await run("ffmpeg", ["-v", "error", "-i", still.path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  if (image.code !== 0 && image.stdout.length === 0) return [false, `the image could not be read: ${firstLine(image.stderr)}`];
  if (exported.stdout.length !== bytes || image.stdout.length !== bytes) return [false, "the image is not the size of the video"];
  const result = compareFrames(
    new Uint8Array(exported.stdout.buffer, exported.stdout.byteOffset, bytes),
    new Uint8Array(image.stdout.buffer, image.stdout.byteOffset, bytes),
    video.width,
    video.height,
    { media: still.media },
  );
  const shown = (value) => (value === null ? "skipped" : value.toFixed(2));
  const seen =
    `frame ${frame}, diff ${result.diff.toFixed(2)}, black ${shown(result.black)}, shifted ${shown(result.shifted)}, ` +
    `color ${result.color === null ? "not measured" : result.color.toFixed(2)}${result.blank ? ", blank still" : ""}` +
    (result.pass ? "" : `; failed: ${result.why.join(", ")}`);
  return [result.pass, seen];
}

await main();
