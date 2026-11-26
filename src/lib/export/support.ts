import {
  ACCELERATION_ORDER, encoderConfig, exportOptions, soundCodec, videoSettings, type EncoderConfig, type ExportFormat, type ExportPresetId,
} from "./presets";

// What this browser and computer can export, decided by what the browser can do, never by its name.

export type SupportProbe = {
  hasWorkers: boolean;
  hasOffscreenCanvas: boolean;
  hasVideoEncoder: boolean;
  canEncode(config: EncoderConfig): Promise<boolean>;
  canEncodeAudio(): Promise<boolean>; // an AAC encoder for AUDIO exists
  canEncodeOpus?(): Promise<boolean>; // an Opus encoder, for a WebM's sound; absent counts as no
};

// sizes, audio: what an MP4 can be here (H.264 at each size, AAC). webm, opus: the same for a WebM (VP9, Opus).
export type Support = { browser: boolean; sizes: Partial<Record<ExportPresetId, boolean>>; audio: boolean; webm: Partial<Record<ExportPresetId, boolean>>; opus: boolean };

const unsupported = (): Support => ({ browser: false, sizes: {}, audio: false, webm: {}, opus: false });

// Which sizes a format can be exported at here. A GIF and a file of sound alone need no video encoder, so every
// size offered will do.
export function sizesFor(support: Support, format: ExportFormat): Partial<Record<ExportPresetId, boolean>> {
  if (format === "mp4") return support.sizes;
  if (format === "webm") return support.webm;
  return Object.fromEntries(Object.keys({ ...support.sizes, ...support.webm }).map((id) => [id, true]));
}

// Whether a file of this format will carry sound here.
export function soundFor(support: Support, format: ExportFormat): boolean {
  const codec = soundCodec(format);
  return codec === "aac" ? support.audio : codec === "opus" ? support.opus : codec === "pcm";
}

// Whether this browser can make the format at all: a video at some size, an M4A with its AAC, a GIF or a WAV always.
export function canMake(support: Support, format: ExportFormat): boolean {
  if (!support.browser) return false;
  if (format === "m4a") return support.audio;
  return Object.values(sizesFor(support, format)).some(Boolean);
}

const yes = async (ask: () => Promise<boolean>) => {
  try {
    return await ask();
  } catch {
    return false;
  }
};

// Every offered size is asked about with the browser's choice of encoder first, then in software. AAC is not a
// condition: without it the file has no sound track, and the dialog says so before the export.
export async function checkSupport(probe: SupportProbe, doc: { width: number; height: number; fps: number }): Promise<Support> {
  if (!probe.hasWorkers || !probe.hasOffscreenCanvas || !probe.hasVideoEncoder) return unsupported();
  const sizes: Partial<Record<ExportPresetId, boolean>> = {};
  const webm: Partial<Record<ExportPresetId, boolean>> = {};
  for (const option of exportOptions(doc)) {
    for (const [format, into] of [["mp4", sizes], ["webm", webm]] as const) {
      const settings = videoSettings(option.size, doc.fps, "standard", format);
      let supported = false;
      if (settings) {
        for (const acceleration of ACCELERATION_ORDER) {
          if (await yes(() => probe.canEncode(encoderConfig(settings, acceleration)))) {
            supported = true;
            break;
          }
        }
      }
      into[option.id] = supported;
    }
  }
  // A browser that can encode neither kind of video is one this export was not built for, even for a GIF.
  if (![...Object.values(sizes), ...Object.values(webm)].some(Boolean)) return unsupported();
  return { browser: true, sizes, audio: await yes(() => probe.canEncodeAudio()), webm, opus: await yes(async () => (await probe.canEncodeOpus?.()) ?? false) };
}
