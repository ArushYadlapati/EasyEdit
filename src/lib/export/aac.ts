import { AUDIO } from "@/lib/export/presets";

// Whether this scope can encode the export's sound track: the one question the page and the worker both ask, so they
// ask it the same way. mediabunny loads on the first call, so a page file that imports this one keeps it out of the
// editor's first bundle. An encoder registered later counts; mediabunny keeps each answer for the page's life.
export async function canEncodeAac(): Promise<boolean> {
  try {
    const { canEncodeAudio, Quality } = await import("mediabunny");
    return await canEncodeAudio("aac", {
      numberOfChannels: AUDIO.channels,
      sampleRate: AUDIO.sampleRate,
      quality: new Quality({ bitrate: AUDIO.bitrate }),
    });
  } catch {
    return false;
  }
}
