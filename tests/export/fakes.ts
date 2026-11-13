import type { DecodedImage, MediaIO, VideoFile } from "@/lib/export/decode-pool";
import type { ExportMedia } from "@/lib/export/protocol";
import type { ResolvedSource } from "@/lib/render/compositor";

// One turn of the event loop: every promise that can settle now has settled.
export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// A Blob the fakes know by its name.
export const file = (name: string): File => new File([name], name);

export const NO_MEDIA: ExportMedia = { files: {}, clips: {} };

export type FakePicture = ResolvedSource & { from: string; at: number };

export type FakeMediaOptions = {
  log?: string[]; // where to write what was asked; a new list by default
  decodable?(name: string): boolean; // canDecode's answer; default true
  firstTimestamp?: number; // every video's first frame; default 0
  missing?(name: string, at: number): boolean; // the reader gives null there
  ends?(name: string, at: number): boolean; // the reader is done there (and after)
  breaks?(name: string, at: number): boolean; // the reader rejects there with Error("decoder closed")
  rejectsWith?(name: string, at: number): Error | null; // the reader rejects there with this error
  hangs?(name: string, at: number): boolean; // the reader's next() never settles there
  unreadable?(name: string): boolean; // openVideo and decodeImage reject with Error("unreadable")
  gate?: Promise<void>; // every reader's next() waits for it
};

export type FakeMediaIO = MediaIO & { log: string[] };

const nameOf = (blob: Blob): string => (blob as File).name;

// MediaIO over named Blobs: it writes each request to its log, and its readers walk the moments they are given.
export function fakeMediaIO(options: FakeMediaOptions = {}): FakeMediaIO {
  const log = options.log ?? [];

  // A plain object, not a generator: return() answers at once even while a next() is still pending.
  function reader(name: string, seconds: number[]): AsyncIterator<ResolvedSource | null> {
    const first = seconds[0];
    log.push(`pictures ${name} from ${first}`);
    let index = 0;
    let finished = false;
    const done = { done: true as const, value: undefined };
    return {
      async next() {
        if (options.gate) await options.gate;
        if (finished || index >= seconds.length) return done;
        const at = seconds[index++];
        if (options.hangs?.(name, at)) return new Promise<never>(() => {});
        if (options.breaks?.(name, at)) throw new Error("decoder closed");
        const error = options.rejectsWith?.(name, at) ?? null;
        if (error) throw error;
        if (options.ends?.(name, at)) {
          finished = true;
          return done;
        }
        if (options.missing?.(name, at)) return { done: false, value: null };
        const picture: FakePicture = { image: {} as CanvasImageSource, width: 720, height: 1280, from: name, at };
        return { done: false, value: picture };
      },
      async return() {
        finished = true;
        log.push(`stop ${name} from ${first}`);
        return done;
      },
    };
  }

  return {
    log,
    async canDecode(blob) {
      const name = nameOf(blob);
      log.push(`can-decode ${name}`);
      return options.decodable?.(name) ?? true;
    },
    async openVideo(blob, maxSide): Promise<VideoFile> {
      const name = nameOf(blob);
      log.push(`open ${name} ${maxSide}`);
      if (options.unreadable?.(name)) throw new Error("unreadable");
      return {
        firstTimestamp: options.firstTimestamp ?? 0,
        pictures: (seconds) => reader(name, seconds),
        dispose: () => {
          log.push(`dispose ${name}`);
        },
      };
    },
    async decodeImage(blob, maxSide): Promise<DecodedImage> {
      const name = nameOf(blob);
      log.push(`image ${name} ${maxSide}`);
      if (options.unreadable?.(name)) throw new Error("unreadable");
      return {
        image: {} as CanvasImageSource,
        width: 400,
        height: 300,
        close: () => {
          log.push(`close ${name}`);
        },
      };
    },
  };
}
