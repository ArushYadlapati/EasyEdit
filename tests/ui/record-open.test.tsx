// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordOpen } from "@/components/record-open";
import { act, render } from "../helpers/dom";

const init = { method: "POST", credentials: "same-origin", keepalive: true };

afterEach(() => vi.unstubAllGlobals());

describe("RecordOpen", () => {
  it("posts once when the editor opens, and again for another project", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, rerender } = render(<RecordOpen projectId="p1" />);
    expect(container.innerHTML).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/opened", init);
    rerender(<RecordOpen projectId="p1" />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender(<RecordOpen projectId="p2" />);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/projects/p2/opened", init);
    await act(async () => {});
  });

  it("the project id is escaped in the address", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RecordOpen projectId="a/b?c" />);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/a%2Fb%3Fc/opened", init);
    await act(async () => {});
  });

  it("a failed post is ignored", async () => {
    // A plain function, not vi.fn: a mock watches the promise it returns, which would hide an unhandled rejection.
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(url);
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      render(<RecordOpen projectId="p1" />);
      await act(async () => {});
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", unhandled);
    }
    expect(calls).toEqual(["/api/projects/p1/opened"]);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
