import { describe, expect, it, vi } from "vitest";
import { createSoundBus } from "@/lib/audio/sound-bus";

// A pretend Web Audio context that writes down what is built and connected.
function pretendContext(state: "running" | "suspended" = "running") {
  const log: string[] = [];
  let ids = 0;
  const node = (kind: string) => {
    const id = `${kind}${++ids}`;
    return {
      id,
      connect: vi.fn((to: { id: string }, output?: number) => void log.push(`${id}>${to.id}${output === undefined ? "" : `:${output}`}`)),
      disconnect: vi.fn(() => void log.push(`${id} off`)),
    };
  };
  const gains: { id: string; gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> }; channelCount?: number; channelCountMode?: string }[] = [];
  const analysers: { id: string; fftSize: number; fill: number }[] = [];
  const panners: { id: string; pan: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> } }[] = [];
  const ctx = {
    state,
    currentTime: 12,
    destination: { id: "out" },
    resume: vi.fn(async () => {
      ctx.state = "running";
    }),
    close: vi.fn(async () => {}),
    createGain: () => {
      const g = { ...node("gain"), gain: { value: 1, setTargetAtTime: vi.fn() } };
      gains.push(g);
      return g;
    },
    createChannelSplitter: () => node("split"),
    createStereoPanner: () => {
      const p = { ...node("pan"), pan: { value: 0, setTargetAtTime: vi.fn() } };
      panners.push(p);
      return p;
    },
    createAnalyser: () => {
      const a = { ...node("meter"), fftSize: 0, fill: 0, getFloatTimeDomainData: (into: Float32Array) => void into.fill(a.fill) };
      analysers.push(a);
      return a;
    },
    createMediaElementSource: vi.fn(() => node("source")),
  };
  return { ctx, log, gains, analysers, panners };
}
type Pretend = ReturnType<typeof pretendContext>;
const busOver = (p: Pretend | null) => createSoundBus(() => (p ? (p.ctx as unknown as AudioContext) : null));
const element = () => ({ volume: 0.4 });

describe("before the first press, and where there is no Web Audio", () => {
  it("leaves each element on its own volume, which stops at 1", () => {
    const p = pretendContext();
    const bus = busOver(p);
    const el = element();
    const line = bus.line(el);
    line.setGain(0.5);
    expect(el.volume).toBe(0.5);
    line.setGain(3);
    expect(el.volume).toBe(1);
    line.setGain(-1);
    expect(el.volume).toBe(0);
    expect(p.ctx.createMediaElementSource).not.toHaveBeenCalled();
    expect(bus.levels()).toBeNull();
  });

  it("stays that way in a browser without Web Audio, and asks only once", () => {
    const make = vi.fn(() => null);
    const bus = createSoundBus(make);
    const el = element();
    const line = bus.line(el);
    bus.unlock();
    bus.unlock();
    line.setGain(2);
    expect(el.volume).toBe(1);
    expect(make).toHaveBeenCalledTimes(1);
    expect(bus.levels()).toBeNull();
  });
});

describe("once the person has pressed something", () => {
  it("builds one mix: every line into a master that goes to the output and to a meter per side", () => {
    const p = pretendContext();
    const bus = busOver(p);
    const el = element();
    const line = bus.line(el);
    line.setGain(2.5); // asked for before the mix exists
    bus.unlock();
    // master, then the element's own gain
    expect(p.log).toEqual(["gain1>out", "gain1>split2", "split2>meter3:0", "split2>meter4:1", "source5>gain6", "gain6>gain1"]);
    expect(p.gains[0]).toMatchObject({ channelCount: 2, channelCountMode: "explicit" });
    expect(p.analysers.map((a) => a.fftSize)).toEqual([2048, 2048]);
    // The line starts at what was asked for, and the element's own volume steps aside.
    expect(p.gains[1].gain.value).toBe(2.5);
    expect(el.volume).toBe(1);
    void line;
  });

  it("eases each later gain in, and says nothing when it has not changed", () => {
    const p = pretendContext();
    const bus = busOver(p);
    bus.unlock();
    const el = element();
    const line = bus.line(el); // made after the mix: attached at once
    const { gain } = p.gains[1];
    line.setGain(1); // where it already is
    expect(gain.setTargetAtTime).not.toHaveBeenCalled();
    line.setGain(0.25);
    line.setGain(0.25);
    expect(gain.setTargetAtTime.mock.calls).toEqual([[0.25, 12, 0.015]]);
    line.setGain(4);
    expect(gain.setTargetAtTime).toHaveBeenLastCalledWith(4, 12, 0.015);
    expect(el.volume).toBe(1); // never the element's job again
  });

  it("wakes a sleeping mix on each press, and leaves a running one alone", () => {
    const p = pretendContext("suspended");
    const bus = busOver(p);
    bus.unlock();
    expect(p.ctx.resume).toHaveBeenCalledTimes(1);
    bus.unlock(); // running now
    expect(p.ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("reads each side's loudest sample, and nothing while the mix sleeps", () => {
    const p = pretendContext("suspended");
    const bus = busOver(p);
    bus.unlock();
    p.ctx.state = "suspended";
    p.analysers[0].fill = 0.5;
    expect(bus.levels()).toEqual({ left: 0, right: 0 });
    p.ctx.state = "running";
    p.analysers[1].fill = -1.5;
    expect(bus.levels()).toEqual({ left: 0.5, right: 1.5 });
  });

  it("takes a closed line out of the mix", () => {
    const p = pretendContext();
    const bus = busOver(p);
    bus.unlock();
    const line = bus.line(element());
    p.log.length = 0;
    line.close();
    expect(p.log).toEqual(["source5 off", "gain6 off"]);
  });

  it("gives an element to Web Audio once, however many lines it gets", () => {
    const p = pretendContext();
    const bus = busOver(p);
    bus.unlock();
    const el = element();
    bus.line(el).close();
    bus.line(el);
    expect(p.ctx.createMediaElementSource).toHaveBeenCalledTimes(1);
  });

  it("keeps an element the browser will not route on its own volume", () => {
    const p = pretendContext();
    p.ctx.createMediaElementSource.mockImplementation(() => {
      throw new DOMException("no", "InvalidStateError");
    });
    const bus = busOver(p);
    bus.unlock();
    const el = element();
    const line = bus.line(el);
    line.setGain(3);
    expect(el.volume).toBe(1);
  });

  it("lets go of the mix on close, and can be set up again", () => {
    const first = pretendContext();
    let current: Pretend = first;
    const bus = createSoundBus(() => current.ctx as unknown as AudioContext);
    const el = element();
    const line = bus.line(el);
    bus.unlock();
    bus.close();
    expect(first.ctx.close).toHaveBeenCalledTimes(1);
    expect(bus.levels()).toBeNull();
    line.setGain(0.3); // back on its own volume
    expect(el.volume).toBe(0.3);
    current = pretendContext();
    bus.unlock();
    expect(current.gains).toHaveLength(2); // a new master, and the line again
  });
});

describe("moving a sound left or right", () => {
  it("puts a panner between the line and the mix the first time it is moved, and only then", () => {
    const p = pretendContext();
    const bus = busOver(p);
    bus.unlock();
    const line = bus.line(element());
    line.setPan(0);
    expect(p.panners).toHaveLength(0); // a sound left where it was recorded needs none
    line.setPan(-0.5);
    expect(p.panners).toHaveLength(1);
    expect(p.panners[0].pan.setTargetAtTime).toHaveBeenLastCalledWith(-0.5, 12, expect.any(Number));
    // The line's gain now feeds the panner, and the panner the mix.
    expect(p.log.slice(-3)).toEqual([expect.stringMatching(/^gain\d+ off$/), expect.stringMatching(/^gain\d+>pan\d+$/), expect.stringMatching(/^pan\d+>gain\d+$/)]);
    line.setPan(1);
    line.setPan(1);
    expect(p.panners).toHaveLength(1);
    expect(p.panners[0].pan.setTargetAtTime).toHaveBeenCalledTimes(2);
    line.setPan(0); // back to the middle through the panner it has
    expect(p.panners[0].pan.setTargetAtTime).toHaveBeenLastCalledWith(0, 12, expect.any(Number));
  });

  it("asked for before the mix exists, is in place once it does; without a mix it does nothing", () => {
    const p = pretendContext();
    const bus = busOver(p);
    const line = bus.line(element());
    line.setPan(0.75);
    expect(p.panners).toHaveLength(0);
    bus.unlock();
    expect(p.panners).toHaveLength(1);
    expect(p.panners[0].pan.setTargetAtTime).toHaveBeenLastCalledWith(0.75, 12, expect.any(Number));
    const none = busOver(null);
    none.unlock();
    expect(() => none.line(element()).setPan(1)).not.toThrow();
  });
});
