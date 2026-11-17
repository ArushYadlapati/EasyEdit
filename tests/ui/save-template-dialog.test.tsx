// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { NoticeBar } from "@/components/editor/notice-bar";
import { NOT_SAVED, SaveTemplateDialog } from "@/components/editor/save-template-dialog";
import { LIMITS } from "@/lib/limits";
import { makeStore } from "../editor/fixtures";
import { act, fireEvent, render, screen, waitFor } from "../helpers/dom";

let fetchMock: ReturnType<typeof vi.fn>;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function open(store = makeStore()) {
  const onClose = vi.fn();
  render(
    <EditorProvider store={store}>
      <SaveTemplateDialog open onClose={onClose} spaceId="sp1" spaceSlug="crew" />
      <NoticeBar />
    </EditorProvider>,
  );
  return { store, onClose };
}
const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string);
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));

it("starts from the project's name and posts what was typed", async () => {
  fetchMock.mockResolvedValue(reply(200, { id: "t1", replaced: false }));
  const { onClose, store } = open();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Qual recap");
  expect((screen.getByLabelText("Description") as HTMLInputElement).maxLength).toBe(LIMITS.templateDescriptionChars);
  expect((screen.getByLabelText("Notes for Claude") as HTMLTextAreaElement).maxLength).toBe(LIMITS.templateInstructionsChars);
  expect(screen.getByText("Claude reads these when it fills the template.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "weekly" } });
  fireEvent.change(screen.getByLabelText("Notes for Claude"), { target: { value: "keep it short" } });
  save();
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(fetchMock.mock.calls[0][0]).toBe("/api/templates?space=sp1");
  expect(bodyOf(0)).toEqual({ projectId: "p1", name: "Qual recap", description: "weekly", instructions: "keep it short" });
  expect(store.getState().notice).toMatchObject({ tone: "info", text: "Saved “Qual recap” as a template.", link: { label: "See templates", href: "/s/crew/settings/templates" } });
  expect(screen.getByRole("link", { name: "See templates" })).toBeTruthy();
});

it("a name clash shows the message and Replace it resends with replace: true", async () => {
  fetchMock
    .mockResolvedValueOnce(reply(409, { code: "CONFLICT", message: "A template called Qual recap already exists." }))
    .mockResolvedValueOnce(reply(200, { id: "t1", replaced: true }));
  const { onClose } = open();
  save();
  await screen.findByText("A template called Qual recap already exists.");
  fireEvent.click(screen.getByRole("button", { name: "Replace it" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(bodyOf(1)).toMatchObject({ name: "Qual recap", replace: true });
});

it("shows another refusal's message and offers no Replace it", async () => {
  fetchMock.mockResolvedValue(reply(400, { code: "INVALID", message: "Mark at least one clip as a slot first" }));
  const { onClose } = open();
  save();
  await screen.findByText("Mark at least one clip as a slot first");
  expect(screen.queryByRole("button", { name: "Replace it" })).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});

it("waits for the pending save before sending", async () => {
  fetchMock.mockResolvedValue(reply(200, { id: "t1", replaced: false }));
  const store = makeStore();
  store.getState().edit([{ op: "update_clip", clipId: "x1", patch: { text: "new" } }], "text edit");
  store.getState().setStatus("saving");
  const { onClose } = open(store);
  save();
  await act(async () => { await Promise.resolve(); });
  expect(fetchMock).not.toHaveBeenCalled();
  act(() => {
    store.setState({ queue: [] });
    store.getState().setStatus("saved");
  });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("says the changes are not saved when they cannot be", async () => {
  const store = makeStore();
  store.getState().edit([{ op: "update_clip", clipId: "x1", patch: { text: "new" } }], "text edit");
  store.getState().setStatus("offline");
  const { onClose } = open(store);
  save();
  await screen.findByText(NOT_SAVED);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it("Cancel during the pending-save wait stops the save: nothing is sent, no notice", async () => {
  const store = makeStore();
  store.getState().edit([{ op: "update_clip", clipId: "x1", patch: { text: "new" } }], "text edit");
  store.getState().setStatus("saving");
  const { onClose } = open(store);
  save();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  act(() => {
    store.setState({ queue: [] });
    store.getState().setStatus("saved");
  });
  await act(async () => { await Promise.resolve(); });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(store.getState().notice).toBeNull();
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("Cancel while the request is out shows no success notice", async () => {
  let finish!: (r: Response) => void;
  fetchMock.mockReturnValue(new Promise<Response>((resolve) => (finish = resolve)));
  const { onClose, store } = open();
  save();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => finish(reply(200, { id: "t1", replaced: false })));
  expect(store.getState().notice).toBeNull();
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("changing the name clears the clash and its message", async () => {
  fetchMock.mockResolvedValue(reply(409, { code: "CONFLICT", message: "A template called Qual recap already exists." }));
  open();
  save();
  await screen.findByText("A template called Qual recap already exists.");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Another" } });
  expect(screen.queryByText("A template called Qual recap already exists.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Replace it" })).toBeNull();
});
