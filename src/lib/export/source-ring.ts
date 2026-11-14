import { downmixInto } from "@/lib/export/downmix";

// A file's decoded sound, placed at its own timestamps and downmixed to stereo, holding only what the voice still reads.

// What a decoder gives: mediabunny's AudioSample fits this shape, and so does a test's fake.
export type SoundPacket = {
  readonly timestamp: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly numberOfFrames: number;
  copyTo(
    destination: Float32Array,
    options: { planeIndex: number; format: "f32-planar"; frameOffset?: number; frameCount?: number },
  ): void;
  close(): void;
};

export type SourceRing = {
  readonly rate: number | null; // the decoded rate, fixed by the first packet
  readonly top: number; // one past the last file index stored
  readonly ended: boolean;
  // Downmixes the packet to stereo and stores it at index = round(timestamp × rate), dropping what falls below index 0
  // (priming) without copying it. A later packet overwrites what an earlier one stored at the same indices; a gap reads 0.
  // A packet whose rate or channel count differs from the first throws.
  place(packet: SoundPacket): void;
  end(): void; // no more packets: every index from top on reads 0
  read(channel: 0 | 1, index: number): number; // 0 before the first packet, in a gap, after the end; RangeError below what dropBefore kept
  dropBefore(index: number): void;
  held(): number; // file frames stored now
};

export function createSourceRing(): SourceRing {
  let rate: number | null = null;
  let channels = 0;
  let ended = false;
  let kept = -Infinity; // the lowest index still readable
  let base = 0; // the file index of storage[0]
  let top = 0; // one past the last index stored; storage holds [base, top)
  let stored = false; // whether any packet has been stored yet
  let left = new Float32Array(0);
  let right = new Float32Array(0);
  const planes: Float32Array[] = []; // one scratch plane per channel, grown to the largest packet

  // Makes storage hold [from, to) as well as what it holds now, with 0 in every index it did not hold before.
  function cover(from: number, to: number): void {
    if (!stored) {
      base = top = from;
      stored = true;
    }
    const start = Math.min(base, from);
    const end = Math.max(top, to);
    if (start === base && end - base <= left.length) {
      left.fill(0, top - base, end - base);
      right.fill(0, top - base, end - base);
      top = end;
      return;
    }
    const size = Math.max(end - start, 2 * left.length);
    const nextLeft = new Float32Array(size);
    const nextRight = new Float32Array(size);
    nextLeft.set(left.subarray(0, top - base), base - start);
    nextRight.set(right.subarray(0, top - base), base - start);
    left = nextLeft;
    right = nextRight;
    base = start;
    top = end;
  }

  return {
    get rate() {
      return rate;
    },
    get top() {
      return top;
    },
    get ended() {
      return ended;
    },
    place(packet) {
      if (rate === null) {
        rate = packet.sampleRate;
        channels = packet.numberOfChannels;
      } else if (packet.sampleRate !== rate || packet.numberOfChannels !== channels) {
        throw new Error("The sound changed format partway through the file.");
      }
      const index = Math.round(packet.timestamp * rate);
      const floor = Math.max(0, kept); // nothing is kept below index 0, nor below what was let go
      const frameOffset = Math.max(0, floor - index);
      const frameCount = packet.numberOfFrames - frameOffset;
      if (frameCount <= 0) return; // wholly below: copyTo would throw for an offset at or past the packet's end
      while (planes.length < channels) planes.push(new Float32Array(0));
      for (let c = 0; c < channels; c++) {
        if (planes[c].length < frameCount) planes[c] = new Float32Array(frameCount);
        packet.copyTo(planes[c], { planeIndex: c, format: "f32-planar", frameOffset, frameCount });
      }
      const at = index + frameOffset;
      cover(at, at + frameCount);
      downmixInto(planes, frameCount, left, right, at - base);
    },
    end() {
      ended = true;
    },
    read(channel, index) {
      if (index < kept) throw new RangeError(`File index ${index} was let go; the ring keeps from ${kept}.`);
      if (index < base || index >= top) return 0;
      return (channel === 0 ? left : right)[index - base];
    },
    dropBefore(index) {
      if (index <= kept) return;
      kept = index;
      if (index <= base) return;
      if (index >= top) {
        base = top = index;
        return;
      }
      left.copyWithin(0, index - base, top - base);
      right.copyWithin(0, index - base, top - base);
      base = index;
    },
    held() {
      return top - base;
    },
  };
}
