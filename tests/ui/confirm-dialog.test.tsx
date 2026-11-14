// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { fireEvent, render, screen, within } from "../helpers/dom";

const props = {
  title: "Remove passkey",
  question: "Remove it?",
  confirmLabel: "Remove",
  open: true,
  pending: false,
  error: null,
  onConfirm: () => {},
  onClose: () => {},
};

describe("the confirm dialog", () => {
  it("asks the question, with focus on Cancel", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog {...props} onConfirm={onConfirm} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Remove passkey" });
    expect(within(dialog).getByText("Remove it?").tagName).toBe("P");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows anything it is given after the question", () => {
    render(
      <ConfirmDialog {...props}>
        <label>
          <input type="checkbox" /> Also do this
        </label>
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Remove passkey" });
    const question = within(dialog).getByText("Remove it?");
    const box = within(dialog).getByRole("checkbox", { name: "Also do this" });
    expect(question.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Focus still starts on Cancel, not on what was added.
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
  });

  it("pending turns the confirm button off, and a refusal shows in the dialog", () => {
    render(<ConfirmDialog {...props} pending error="It didn't go through." />);
    const dialog = screen.getByRole("dialog", { name: "Remove passkey" });
    expect((within(dialog).getByRole("button", { name: "Remove" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByRole("alert").textContent).toBe("It didn't go through.");
  });
});
