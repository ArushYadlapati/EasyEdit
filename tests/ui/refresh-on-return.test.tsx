// @vitest-environment happy-dom
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRefreshOnReturn } from "@/components/dashboard/use-refresh-on-return";
import { act, render } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, unstable_rethrow: () => {} }));

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
  router.refresh.mockClear();
  router.bfcacheId = "b0";
});

function Page({ label = "" }: { label?: string }) {
  useRefreshOnReturn();
  return <p>{label}</p>;
}

const pageshow = (persisted: boolean) =>
  act(() => {
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
  });

// Each test uses its own bfcacheId, so the ids the module remembers never carry over between tests.
describe("coming back to the dashboard fetches fresh data once", () => {
  it("a first load does not refresh, and coming back with the same id does, once", () => {
    router.bfcacheId = "b-back";
    const first = render(<Page />);
    first.unmount();
    expect(router.refresh).not.toHaveBeenCalled();
    render(<Page />);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("StrictMode's second effect run does not refresh", () => {
    router.bfcacheId = "b-strict";
    render(
      <StrictMode>
        <Page />
      </StrictMode>,
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("a rerender that keeps the id, as a folder click does, does not refresh", () => {
    router.bfcacheId = "b-same";
    const { rerender } = render(<Page label="Projects" />);
    rerender(<Page label="Season 2026" />);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("a page restored from the back-forward cache refreshes, until it is gone", () => {
    router.bfcacheId = "b-pageshow";
    const { unmount } = render(<Page />);
    expect(router.refresh).not.toHaveBeenCalled();
    pageshow(true);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    pageshow(false);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    unmount();
    pageshow(true);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
