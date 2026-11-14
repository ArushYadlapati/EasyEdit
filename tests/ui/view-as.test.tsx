// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EditorScreen } from "@/components/editor/editor-screen";
import { makeStore, sampleDoc } from "../editor/fixtures";
import { fireEvent, render, screen } from "../helpers/dom";

afterEach(() => localStorage.clear());

function show(size?: { width: number; height: number; format: "short_9x16" | "long_16x9" }) {
  const store = makeStore(size ? { doc: { ...sampleDoc(), ...size } } : {});
  render(
    <EditorProvider store={store}>
      <EditorScreen />
    </EditorProvider>,
  );
  return store;
}

const button = () => screen.getByRole("button", { name: /^View as:/ });
const choices = () => screen.getAllByRole("menuitemradio").map((el) => el.textContent);
function pick(name: string) {
  fireEvent.click(button());
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
}
const overlay = () => document.querySelector("[data-platform-view]");

it("a vertical project offers every short-form app and the feeds", () => {
  show({ width: 1080, height: 1920, format: "short_9x16" });
  expect(button().textContent).toBe("View as: Off");
  fireEvent.click(button());
  expect(choices()).toEqual([
    "Off",
    "Safe area",
    "Instagram Reels",
    "Instagram feed",
    "Instagram profile grid",
    "YouTube Shorts",
    "TikTok",
    "Facebook Reels",
    "Facebook feed",
    "LinkedIn feed",
  ]);
});

it("picking a platform draws it over the frame, and the safe area replaces it", () => {
  const store = show({ width: 1080, height: 1920, format: "short_9x16" });
  pick("YouTube Shorts");
  expect(button().textContent).toBe("View as: YouTube Shorts");
  expect(overlay()?.getAttribute("data-platform-view")).toBe("youtube-shorts");
  expect(localStorage.getItem("easyedit.viewAs")).toBe("youtube-shorts");
  expect(store.getState().queue).toHaveLength(0); // only a view, never an edit

  pick("Safe area");
  expect(overlay()).toBeNull();
  expect(store.getState().showSafeZones).toBe(true);
  expect(button().textContent).toBe("View as: Safe area");

  pick("Off");
  expect(store.getState().showSafeZones).toBe(false);
  expect(button().textContent).toBe("View as: Off");
});

it("a feed crop dims what the feed leaves out", () => {
  show({ width: 1080, height: 1920, format: "short_9x16" });
  pick("Facebook feed");
  const crop = overlay()!.querySelector<HTMLElement>("[data-crop]")!;
  expect(crop.style.width).toBe("100%");
  expect(parseFloat(crop.style.height)).toBeCloseTo(70.3, 1);
});

it("a landscape project offers YouTube, and a saved choice it lacks is not used", () => {
  localStorage.setItem("easyedit.viewAs", "tiktok");
  show({ width: 1920, height: 1080, format: "long_16x9" });
  expect(button().textContent).toBe("View as: Off");
  fireEvent.click(button());
  expect(choices()).toEqual(["Off", "Safe area", "YouTube video"]);
});

it("the last platform comes back next time", () => {
  localStorage.setItem("easyedit.viewAs", "tiktok");
  show({ width: 1080, height: 1920, format: "short_9x16" });
  expect(button().textContent).toBe("View as: TikTok");
  expect(overlay()?.getAttribute("data-platform-view")).toBe("tiktok");
});
