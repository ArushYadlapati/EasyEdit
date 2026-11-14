import { ExportError, errorMessage, readFailure } from "@/lib/export/messages";
import { mixParts, type VoicePart } from "@/lib/export/mix";
import { sincKernel } from "@/lib/export/resample";
import type { AudioBlock } from "@/lib/export/schedule";
import { voiceWindow, type SoundSchedule, type Voice } from "@/lib/export/sound-schedule";
import type { SoundPacket } from "@/lib/export/source-ring";
import { createVoicePlayer, type VoicePlayer } from "@/lib/export/voice";

// The worker's sound decoders, behind SoundIO: each sounding file is checked once before the file is made, opened as
// its first voice starts and let go of after its last block; each voice reads its own part of the file with its own
// reader. The pool waits only on the IO's promises, never on a timer.

export type SoundProbe = "none" | "decodable" | "undecodable"; // the file's first sound track: none, or whether it decodes here

export type SoundFile = {
  packets(fromSeconds: number, toSeconds: number): AsyncIterator<SoundPacket>; // a new decoder over these seconds of the file
  dispose(): void;
};

export type SoundIO = {
  probe(blob: Blob): Promise<SoundProbe>; // its own short-lived reader; a rejection is named by its cause
  open(blob: Blob): Promise<SoundFile>; // one reader per file, apart from the picture decoders
};

export type SoundPool = {
  open(): Promise<void>; // checks each sounding file once, in voice order, before the file is made
  block(block: AudioBlock): Promise<Float32Array>; // the block's mix: interleaved stereo, sampleCount × 2, fresh each call
  close(): Promise<void>; // lets go of every file and voice still open; never rejects; a second call does nothing
};

export function createSoundPool(schedule: SoundSchedule, files: Record<string, Blob>, io: SoundIO): SoundPool {
  const kernel = sincKernel();
  const silent = new Set<string>(); // fileIds whose file has no sound track
  const opened = new Map<string, SoundFile>(); // fileId → its open file, shared by all its voices
  const players = new Map<Voice, VoicePlayer>();

  const blobOf = (fileId: string): Blob => {
    const blob = files[fileId];
    if (!blob) throw new ExportError("media", fileId);
    return blob;
  };

  async function soundFile(fileId: string): Promise<SoundFile> {
    const open = opened.get(fileId);
    if (open) return open;
    const blob = blobOf(fileId);
    const made = await io.open(blob).catch((error: unknown) => {
      throw new ExportError("media", errorMessage(error));
    });
    opened.set(fileId, made);
    return made;
  }

  return {
    async open() {
      const checked = new Set<string>();
      for (const voice of schedule.voices) {
        if (checked.has(voice.fileId)) continue;
        checked.add(voice.fileId);
        const blob = blobOf(voice.fileId);
        const probe = await io.probe(blob).catch((error: unknown) => {
          throw readFailure(error, "sound");
        });
        if (probe === "undecodable") throw new ExportError("sound", voice.fileId);
        if (probe === "none") silent.add(voice.fileId);
      }
    },

    async block(block) {
      const end = block.startSample + block.sampleCount;
      const active = schedule.voices.filter(
        (voice) => !silent.has(voice.fileId) && voice.start < end && block.startSample < voice.end,
      );

      // One voice after another, so two voices of one file that start in this block share one open file.
      for (const voice of active) {
        if (players.has(voice)) continue;
        const file = await soundFile(voice.fileId);
        const { from, to } = voiceWindow(schedule, voice);
        players.set(voice, createVoicePlayer(schedule, voice, file.packets(from, to), kernel));
      }

      // Together, so a voice that rejects ends the block at once even while another never answers.
      const parts = await Promise.all(
        active.map((voice) =>
          players.get(voice)!.render(block).catch((error: unknown) => {
            throw readFailure(error, "sound");
          }),
        ),
      );
      const mix = mixParts(block.sampleCount, parts.filter((part): part is VoicePart => part !== null));

      for (const voice of active) {
        if (voice.end > end) continue;
        players.get(voice)!.stop();
        players.delete(voice);
      }
      const index = Math.floor(block.startSample / schedule.sampleRate);
      for (const [fileId, file] of opened) {
        if (!(schedule.lastBlock[fileId] <= index)) continue;
        opened.delete(fileId);
        file.dispose();
      }
      return mix;
    },

    // Disposing a file cancels its pending reads and closes its decoders, so the voices are stopped only after. What is
    // let go of leaves the pool, so a second call finds nothing.
    async close() {
      for (const file of opened.values()) {
        try {
          file.dispose();
        } catch {
          // already gone
        }
      }
      for (const player of players.values()) player.stop();
      opened.clear();
      players.clear();
    },
  };
}
