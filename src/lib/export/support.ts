import {
  ACCELERATION_ORDER, encoderConfig, exportOptions, videoSettings, type EncoderConfig, type ExportPresetId,
} from "./presets";

// What this browser and computer can export, decided by what the browser can do, never by its name.

export type SupportProbe = {
  hasWorkers: boolean;
  hasOffscreenCanvas: boolean;
  hasVideoEncoder: boolean;
  canEncode(config: EncoderConfig): Promise<boolean>;
  canEncodeAudio(): Promise<boolean>; // an AAC encoder for AUDIO exists
};

export type Support = { browser: boolean; sizes: Partial<Record<ExportPresetId, boolean>>; audio: boolean };

const unsupported = (): Support => ({ browser: false, sizes: {}, audio: false });

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
  for (const option of exportOptions(doc)) {
    const settings = videoSettings(option.size, doc.fps);
    let supported = false;
    if (settings) {
      for (const acceleration of ACCELERATION_ORDER) {
        if (await yes(() => probe.canEncode(encoderConfig(settings, acceleration)))) {
          supported = true;
          break;
        }
      }
    }
    sizes[option.id] = supported;
  }
  if (!Object.values(sizes).some(Boolean)) return unsupported();
  return { browser: true, sizes, audio: await yes(() => probe.canEncodeAudio()) };
}
