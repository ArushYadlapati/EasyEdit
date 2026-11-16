import { expect, it } from "vitest";
import { saveStatusLabel } from "@/lib/editor/messages";

it("labels the save status", () => {
  expect(saveStatusLabel("saved", 0, true)).toBe("Saved");
  expect(saveStatusLabel("saved", 0, false)).toBe("Up to date");
  expect(saveStatusLabel("saving", 2, true)).toBe("Saving…");
  expect(saveStatusLabel("offline", 2, true)).toBe("Offline. Changes will save when you reconnect.");
  expect(saveStatusLabel("offline", 0, true)).toBe("Offline");
  expect(saveStatusLabel("signed-out", 1, true)).toBe("Signed out");
  expect(saveStatusLabel("deleted", 0, true)).toBe("Deleted");
  expect(saveStatusLabel("limited", 1, true, "Too many changes at once. Wait a minute, then keep going.")).toBe("Too many changes at once. Wait a minute, then keep going.");
});

it("the limit sentence is whole in the label the top bar puts in its title", () => {
  const text = "Today's limit for saved changes is used up (20 MB a day). It frees up over the next 24 hours.";
  expect(saveStatusLabel("limited", 3, true, text)).toBe(text);
});
