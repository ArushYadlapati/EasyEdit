// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EditorScreen } from "@/components/editor/editor-screen";
import { makeStore, sampleDoc } from "../editor/fixtures";
import { render, screen } from "../helpers/dom";

it("a custom-size project opens in the editor with its size named", () => {
  const store = makeStore({ doc: { ...sampleDoc(), format: "custom", width: 816, height: 1056 } });
  expect(() =>
    render(
      <EditorProvider store={store}>
        <EditorScreen />
      </EditorProvider>,
    ),
  ).not.toThrow();
  expect(screen.getByText("Custom 816 × 1056")).toBeTruthy();
  expect(screen.getByText("Safe area")).toBeTruthy();
});
