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

it("a held edit is not called saved", () => {
  expect(saveStatusLabel("saved", 1, true, null, true)).toBe("Not saved yet");
  expect(saveStatusLabel("saving", 2, true, null, true)).toBe("Saving…");
  expect(saveStatusLabel("offline", 1, true, null, true)).toBe("Offline. Changes will save when you reconnect.");
});

it("a save that fails while the browser is online is EasyEdit not answering, not the person's connection", () => {
  expect(saveStatusLabel("offline", 2, true, null, false, true)).toBe("Can't reach EasyEdit. Your changes are kept here and will save when it answers.");
  expect(saveStatusLabel("offline", 0, true, null, false, true)).toBe("Can't reach EasyEdit");
  expect(saveStatusLabel("offline", 2, true, null, false, false)).toBe("Offline. Changes will save when you reconnect.");
});
