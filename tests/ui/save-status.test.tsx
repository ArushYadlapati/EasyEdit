// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { SaveStatus } from "@/components/editor/save-status";
import { makeFakeServer } from "../editor/fake-server";
import { makeStore, sampleDoc } from "../editor/fixtures";
import { act, render, screen } from "../helpers/dom";

it("a limited save shows the server's sentence, whole in the title", () => {
  const text = "Today's limit for saved changes is used up (20 MB a day). It frees up over the next 24 hours.";
  const store = makeStore();
  const server = makeFakeServer(sampleDoc(), 5);
  render(
    <EditorProvider store={store} api={server.api}>
      <SaveStatus />
    </EditorProvider>,
  );
  act(() => store.getState().setStatus("limited", text));
  const status = screen.getByRole("status");
  expect(status.textContent).toBe(text);
  expect(status.getAttribute("title")).toBe(text);
});
