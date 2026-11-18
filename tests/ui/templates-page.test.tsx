// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { TemplatesPage } from "@/components/dashboard/templates-page";
import { TAG } from "@/components/ui/cx";
import { TemplateApiError } from "@/lib/templates/client";
import type { Template, TemplateSummary } from "@/lib/templates/types";
import { act, fireEvent, render, screen, waitFor, within } from "../helpers/dom";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
const client = vi.hoisted(() => ({
  getTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/templates/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/templates/client")>()),
  ...client,
}));

const slot = (name: string, kind: "text" | "visual" | "audio") => ({
  name,
  kind,
  filled: false,
  clipIds: [],
});
const STARTER: TemplateSummary = {
  id: "starter_1",
  name: "Quick promo",
  description: "A short promo.",
  format: "short_9x16",
  width: 1080,
  height: 1920,
  builtIn: true,
  slots: [slot("hero_clip", "visual"), slot("title_text", "text"), slot("music", "audio")],
  updatedAt: null,
};
const SAVED: TemplateSummary = {
  ...STARTER,
  id: "t1",
  name: "Match recap",
  description: "Our recap.",
  builtIn: false,
  slots: [slot("score", "text")],
  updatedAt: "2026-11-16T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  client.getTemplate.mockResolvedValue({
    ...SAVED,
    instructions: "Keep it short.",
    doc: {},
  } as unknown as Template);
  client.updateTemplate.mockResolvedValue(undefined);
  client.deleteTemplate.mockResolvedValue(undefined);
});

const page = (canEdit: boolean, templates = [SAVED, STARTER]) => render(<TemplatesPage spaceId="sp1" canEdit={canEdit} templates={templates} />);

it("lists starters first, then saved templates, with the Starter tag and slots", () => {
  page(true);
  const names = screen.getAllByRole("listitem").map((li) => li.querySelector("span")!.textContent);
  expect(names).toEqual(["Quick promo", "Match recap"]);
  expect(screen.getAllByText("Starter")).toHaveLength(1);
  expect(screen.getByText("Slots: hero_clip, title_text, music")).toBeTruthy();
  expect(screen.getAllByText("Vertical 9:16 · 1080×1920")).toHaveLength(2);
  expect(screen.getByText("Our recap.")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
  expect(screen.queryByText(/Open a project, mark clips/)).toBeNull();
});

it("sets the Starter tag at 11 px, no smaller than any other label, in the shared tag look", () => {
  page(true);
  expect(screen.getByText("Starter").className.split(" ")).toEqual(expect.arrayContaining(["text-[11px]", "leading-4", "font-medium"]));
  expect(screen.getByText("Starter").className).toBe(TAG);
});

it("shows how to make a template when none is saved", () => {
  page(true, [STARTER]);
  expect(screen.getByText(/Open a project, mark clips as slots in the inspector, then choose Save as template\./)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
});

it("a viewer is not told to save a template, only that there are none", () => {
  page(false, [STARTER]);
  expect(screen.queryByText(/mark clips as slots/)).toBeNull();
  expect(screen.getByText("No saved templates yet.")).toBeTruthy();
});

it("a viewer sees no actions", () => {
  page(false);
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
});

it("Edit loads the notes and saves through updateTemplate", async () => {
  page(true);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = screen.getByRole("dialog", { name: "Edit template" });
  await waitFor(() => expect((within(dialog).getByLabelText("Notes for Claude") as HTMLTextAreaElement).value).toBe("Keep it short."));
  expect(within(dialog).getByText("Claude reads these when it fills the template.")).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText("Name"), {
    target: { value: "Recap v2" },
  });
  fireEvent.change(within(dialog).getByLabelText("Notes for Claude"), { target: { value: "Keep it very short." } });
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Save" })));
  expect(client.updateTemplate).toHaveBeenCalledWith("sp1", "t1", {
    name: "Recap v2",
    description: "Our recap.",
    instructions: "Keep it very short.",
  });
  expect(router.refresh).toHaveBeenCalled();
});

it("shows the server's message inline when a save is refused", async () => {
  client.updateTemplate.mockRejectedValue(new TemplateApiError("CONFLICT", "A template with that name already exists.", 409));
  page(true);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = screen.getByRole("dialog", { name: "Edit template" });
  await waitFor(() => expect((within(dialog).getByLabelText("Notes for Claude") as HTMLTextAreaElement).value).toBe("Keep it short."));
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Save" })));
  expect(within(dialog).getByRole("alert").textContent).toBe("A template with that name already exists.");
  expect(router.refresh).not.toHaveBeenCalled();
});

it("Delete asks first, then deletes and refreshes", async () => {
  page(true);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("dialog", { name: "Delete Match recap?" });
  expect(within(dialog).getByText("Projects made from it stay as they are.")).toBeTruthy();
  expect(client.deleteTemplate).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Delete" })));
  expect(client.deleteTemplate).toHaveBeenCalledWith("sp1", "t1");
  expect(router.refresh).toHaveBeenCalled();
});

it("when the notes fail to load, saving leaves them out of the update", async () => {
  client.getTemplate.mockRejectedValue(new TemplateApiError("UNKNOWN", "nope", 500));
  page(true);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = screen.getByRole("dialog", { name: "Edit template" });
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe("Couldn't load the notes for Claude. Try again."));
  expect((within(dialog).getByLabelText("Notes for Claude") as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Recap v2" } });
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Save" })));
  expect(client.updateTemplate).toHaveBeenCalledWith("sp1", "t1", { name: "Recap v2", description: "Our recap." });
  expect(Object.keys(client.updateTemplate.mock.calls[0][2])).not.toContain("instructions");
});
