import { AUDIO } from "@/lib/export/presets";

// Whether this scope can encode the export's sound track: the one question the page and the worker both ask, so they
// ask it the same way. It asks the browser itself, never through mediabunny: the export worker imports mediabunny
// statically, and a second, dynamic import of it beside that one breaks the chunk the workers share.
export async function canEncodeAac(): Promise<boolean> {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    const config = { codec: AUDIO.codec, sampleRate: AUDIO.sampleRate, numberOfChannels: AUDIO.channels, bitrate: AUDIO.bitrate };
    return (await AudioEncoder.isConfigSupported(config)).supported === true;
  } catch {
    return false;
  }
}
