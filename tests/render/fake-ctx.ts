import type { Ctx2D } from "@/lib/render/compositor";

export type Call = [name: string, ...args: unknown[]];

// Records every method call and every property write. Text measures half its font size per character.
export function fakeCtx(): { ctx: Ctx2D; calls: Call[] } {
  const calls: Call[] = [];
  const props: Record<string, unknown> = { font: "10px sans-serif" };
  const ctx = new Proxy({}, {
    get(_target, key: string) {
      if (key === "measureText") return (s: string) => ({ width: (s.length * parseFloat(/([\d.]+)px/.exec(String(props.font))![1])) / 2 });
      if (key === "getTransform") return () => ({ a: props.scale ?? 1, b: 0, c: 0, d: props.scale ?? 1, e: 0, f: 0 });
      // A gradient that takes its stops; the call itself is recorded like any other.
      if (key === "createRadialGradient") return (...args: unknown[]) => { calls.push([key, ...args]); return { addColorStop: () => {} }; };
      if (key in props) return props[key];
      return (...args: unknown[]) => { calls.push([key, ...args]); };
    },
    set(_target, key: string, value: unknown) {
      props[key] = value;
      calls.push([`set ${key}`, value]);
      return true;
    },
  });
  return { ctx: ctx as unknown as Ctx2D, calls };
}
