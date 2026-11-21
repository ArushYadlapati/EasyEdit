import { describe, expect, it, vi } from "vitest";
import { DEFAULT_KEYMAP, setOff } from "@/lib/editor/keymap";
import {
  DEFAULT_PREFS, clampPercent, clampSeconds, createSettingsStore, formatPrefs, parsePrefs, type Prefs, type SettingsSave,
} from "@/lib/editor/settings";
import { fromUnit, showUnit, toEvenPixels, toUnit } from "@/lib/editor/units";

const saver = () => ({ prefs: vi.fn<SettingsSave["prefs"]>(), keymap: vi.fn<SettingsSave["keymap"]>() });

describe("the preferences cookie", () => {
  it("formats and reads the preferences", () => {
    // the safe area starts hidden, guides and the audio meter start shown
    expect(formatPrefs(DEFAULT_PREFS)).toBe("u:px.sz:0.sn:1.z:fill.st:30.tx:30.gd:1.am:1");
    const chosen: Prefs = { units: "cm", safeZones: false, snapping: false, boardZoom: 150, stillSeconds: 5, textSeconds: 2.5, guides: false, meter: false };
    expect(formatPrefs(chosen)).toBe("u:cm.sz:0.sn:0.z:150.st:50.tx:25.gd:0.am:0");
    expect(parsePrefs("u:cm.sz:0.sn:0.z:150.st:50.tx:25.gd:0.am:0")).toEqual(chosen);
    // A cookie from before guides shows them, and one from before the audio meter shows it.
    expect(parsePrefs("u:cm.sz:0.sn:0.z:150.st:50.tx:25").guides).toBe(true);
    expect(parsePrefs("u:cm.sz:0.sn:0.z:150.st:50.tx:25.gd:0").meter).toBe(true);
    // An old field such as the aspect lock is ignored.
    expect(parsePrefs("u:in.lk:0")).toEqual({ ...DEFAULT_PREFS, units: "in" });
  });

  it("one bad field keeps the others", () => {
    expect(parsePrefs("u:mm.sz:1")).toEqual({ ...DEFAULT_PREFS, units: "px", safeZones: true });
    expect(parsePrefs("sn:yes.st:45")).toEqual({ ...DEFAULT_PREFS, stillSeconds: 4.5 });
    expect(parsePrefs("sz:0:1.tx:-5.z:-5.u:")).toEqual(DEFAULT_PREFS);
  });

  it("garbage gives the defaults", () => {
    for (const text of ["", undefined, null, "%%%"]) expect(parsePrefs(text), String(text)).toEqual(DEFAULT_PREFS);
  });

  it("values stay in bounds", () => {
    expect(parsePrefs("z:5").boardZoom).toBe(10);
    expect(parsePrefs("z:1000").boardZoom).toBe(400);
    expect(parsePrefs("z:abc").boardZoom).toBe("fill");
    expect(parsePrefs("st:1").stillSeconds).toBe(0.5);
    expect(parsePrefs("st:9999").stillSeconds).toBe(60);
    expect(parsePrefs("tx:7").textSeconds).toBe(0.7);
    expect([clampPercent(149.6), clampPercent(9.4), clampPercent(401)]).toEqual([150, 10, 400]);
    expect([clampSeconds(2.46), clampSeconds(0.2), clampSeconds(61)]).toEqual([2.5, 0.5, 60]);
    // What is written stays plain text that reads back the same.
    const odd: Prefs = { ...DEFAULT_PREFS, boardZoom: 150.4, stillSeconds: 2.46, textSeconds: 100 };
    expect(formatPrefs(odd)).toBe("u:px.sz:0.sn:1.z:150.st:25.tx:600.gd:1.am:1");
    expect(formatPrefs(odd)).toMatch(/^[a-z0-9:.]+$/);
  });

  it("the defaults are frozen", () => {
    expect(Object.isFrozen(DEFAULT_PREFS)).toBe(true);
    expect(DEFAULT_PREFS).toEqual({ units: "px", safeZones: false, snapping: true, boardZoom: "fill", stillSeconds: 3, textSeconds: 3, guides: true, meter: true });
  });
});

describe("the settings store", () => {
  it("the store saves on set and setKeymap, not on loadKeymap", () => {
    const save = saver();
    const settings = createSettingsStore({ prefs: DEFAULT_PREFS }, save);
    expect(settings.getState()).toMatchObject({ units: "px", boardZoom: "fill", stillSeconds: 3, textSeconds: 3, keymap: DEFAULT_KEYMAP });
    settings.getState().set({ units: "in" });
    expect(save.prefs).toHaveBeenCalledTimes(1);
    expect(save.prefs).toHaveBeenCalledWith({ units: "in", boardZoom: "fill", stillSeconds: 3, textSeconds: 3 });
    expect(settings.getState().units).toBe("in");

    const km = setOff(DEFAULT_KEYMAP, "split", true);
    settings.getState().setKeymap(km);
    expect(save.keymap).toHaveBeenCalledTimes(1);
    expect(save.keymap).toHaveBeenCalledWith(km);
    expect(settings.getState().keymap).toBe(km);

    const loaded = setOff(DEFAULT_KEYMAP, "delete", true);
    settings.getState().loadKeymap(loaded);
    expect(settings.getState().keymap).toBe(loaded);
    expect(save.prefs).toHaveBeenCalledTimes(1);
    expect(save.keymap).toHaveBeenCalledTimes(1);
  });

  it("a set that changes no saved value saves nothing", () => {
    const save = saver();
    const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, units: "cm" } }, save);
    settings.getState().set({ units: "cm", stillSeconds: 3 });
    expect(save.prefs).not.toHaveBeenCalled();
    settings.getState().set({ stillSeconds: 4, textSeconds: 2 });
    expect(save.prefs).toHaveBeenCalledTimes(1);
    expect(save.prefs).toHaveBeenCalledWith({ units: "cm", boardZoom: "fill", stillSeconds: 4, textSeconds: 2 });
  });

  it("the lock is not saved", () => {
    const save = saver();
    const settings = createSettingsStore({ prefs: DEFAULT_PREFS }, save);
    expect(settings.getState().lockAspect).toBe(true);
    settings.getState().set({ lockAspect: false });
    expect(settings.getState().lockAspect).toBe(false);
    expect(save.prefs).not.toHaveBeenCalled();
    expect(save.keymap).not.toHaveBeenCalled();
    // A new store starts locked again.
    expect(createSettingsStore({ prefs: DEFAULT_PREFS }, save).getState().lockAspect).toBe(true);
  });

  it("starts from the keymap given, and without a saver keeps everything in memory", () => {
    const km = setOff(DEFAULT_KEYMAP, "split", true);
    const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, boardZoom: 50 }, keymap: km });
    expect(settings.getState()).toMatchObject({ boardZoom: 50, keymap: km });
    expect(() => {
      settings.getState().set({ boardZoom: 75 });
      settings.getState().setKeymap(DEFAULT_KEYMAP);
    }).not.toThrow();
    expect(settings.getState()).toMatchObject({ boardZoom: 75, keymap: DEFAULT_KEYMAP });
  });
});

describe("units", () => {
  it("units convert at 96 px per inch", () => {
    expect(toUnit(1080, "in")).toBeCloseTo(11.25, 6);
    expect(toUnit(1920, "cm")).toBeCloseTo(50.8, 6);
    expect(toUnit(1920, "px")).toBeCloseTo(1920, 6);
    expect(fromUnit(1, "in")).toBeCloseTo(96, 6);
    expect(fromUnit(2.54, "cm")).toBeCloseTo(96, 6);
    expect(fromUnit(12, "px")).toBeCloseTo(12, 6);
    expect(showUnit(960, "in")).toBe("10");
    expect(showUnit(540, "cm")).toBe("14.29");
    expect(showUnit(76.8, "px")).toBe("77");
    expect(showUnit(100, "in")).toBe("1.04");
    expect(showUnit(48, "in")).toBe("0.5");
    expect(toEvenPixels(8.5, "in")).toBe(816);
    expect(toEvenPixels(4.01, "in")).toBe(384);
    expect(toEvenPixels(10, "cm")).toBe(378);
    expect(toEvenPixels(1081, "px")).toBe(1082);
    expect(toEvenPixels(1079, "px")).toBe(1080);
  });
});
