// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MoveSpaceDialog } from "@/components/dashboard/move-space-dialog";
import type { MoveOutcome, MoveRunInput } from "@/lib/projects/move-runner";
import type { MySpace } from "@/lib/spaces/types";
import { act, fireEvent, render, screen } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, unstable_rethrow: () => {} }));

const FROM: MySpace = { id: "s1", slug: "seattle-solvers", name: "Seattle Solvers", kind: "team", role: "editor" };
const PERSONAL: MySpace = { id: "personal_u1", slug: "personal_u1", name: "Personal", kind: "personal", role: "admin" };
const TEAM_ADMIN: MySpace = { id: "s2", slug: "robo-club", name: "Robo Club", kind: "team", role: "admin" };
const TEAM_EDITOR: MySpace = { id: "s3", slug: "film-crew", name: "Film Crew", kind: "team", role: "editor" };
const PROJECT = { id: "p1", name: "Qual recap" };

beforeEach(() => router.push.mockClear());
afterEach(() => vi.restoreAllMocks());

type Run = (input: MoveRunInput) => Promise<MoveOutcome>;

// A run the test finishes by hand.
function pendingRun() {
  let finish!: (outcome: MoveOutcome) => void;
  let input!: MoveRunInput;
  const run = vi.fn<Run>((given) => {
    input = given;
    return new Promise<MoveOutcome>((resolve) => (finish = resolve));
  });
  return { run, finish: (outcome: MoveOutcome) => act(async () => finish(outcome)), input: () => input };
}

function open(run: Run, targets = [PERSONAL, TEAM_ADMIN, TEAM_EDITOR], onClose = vi.fn()) {
  render(<MoveSpaceDialog project={PROJECT} fromSpace={FROM} targets={targets} onClose={onClose} run={run as never} />);
  return onClose;
}
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const choose = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));
async function start(name = "Robo Club") {
  choose(name);
  await act(async () => {
    fireEvent.click(button("Move"));
  });
}

describe("the Move to… dialog", () => {
  it("lists the targets as a radio group, and Move waits for a choice", () => {
    open(vi.fn<Run>());
    const group = screen.getByRole("radiogroup", { name: "Space" });
    expect(Array.from(group.querySelectorAll("label")).map((label) => label.textContent)).toEqual(["Personal", "Robo Club", "Film Crew"]);
    expect(button("Move").disabled).toBe(true);
    expect(screen.getByText("Its media is copied to the new space. Keep this tab open until it's done.")).toBeTruthy();
    choose("Film Crew");
    expect(button("Move").disabled).toBe(false);
  });

  it("starts the run for the chosen space and shows its progress", async () => {
    const { run, input } = pendingRun();
    open(run);
    await start();
    expect(run).toHaveBeenCalledOnce();
    expect(input()).toMatchObject({ projectId: "p1", toSpaceId: "s2", fromSpaceId: "s1" });
    await act(async () => input().onProgress({ filesDone: 1, filesTotal: 3, bytesDone: 40, bytesTotal: 100 }));
    expect(screen.getByText("Copying 1 of 3 files")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  it("Cancel aborts the run; Escape and Close do not close it while it runs", async () => {
    const { run, input, finish } = pendingRun();
    const onClose = open(run);
    await start();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(button("Close").disabled).toBe(true);
    fireEvent.click(button("Close"));
    expect(onClose).not.toHaveBeenCalled();
    expect(input().signal.aborted).toBe(false);
    fireEvent.click(button("Cancel"));
    expect(input().signal.aborted).toBe(true);
    await finish({ ok: false, message: "The move was canceled.", canceled: true });
    expect(onClose).not.toHaveBeenCalled();
    expect(button("Move").disabled).toBe(false); // back to choosing
    expect(button("Close").disabled).toBe(false);
  });

  it("asks the browser to confirm leaving only while running", async () => {
    const { run, finish } = pendingRun();
    open(run);
    const leaves = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leaves()).toBe(false);
    await start();
    expect(leaves()).toBe(true);
    await finish({ ok: false, message: "Nope." });
    expect(leaves()).toBe(false);
  });

  it("on success goes to the new space and closes", async () => {
    const { run, finish } = pendingRun();
    const onClose = open(run);
    await start("Personal");
    await finish({ ok: true, moved: { projectId: "p1", spaceId: "personal_u1", slug: "personal_u1", version: 2 } });
    expect(router.push).toHaveBeenCalledWith("/s/personal");
    expect(onClose).toHaveBeenCalled();
  });

  it("no storage in a personal or admin target says so and links to set it up", async () => {
    for (const [name, slug] of [["Personal", "personal"], ["Robo Club", "robo-club"]]) {
      const { run, finish } = pendingRun();
      const view = render(<MoveSpaceDialog project={PROJECT} fromSpace={FROM} targets={[PERSONAL, TEAM_ADMIN]} onClose={vi.fn()} run={run as never} />);
      choose(name);
      await act(async () => void fireEvent.click(button("Move")));
      await finish({ ok: false, message: `${name} has no storage yet. Set it up, then move the project.`, code: "NO_STORAGE" });
      expect(screen.getByText(`${name} has no storage yet. Set it up, then move the project.`)).toBeTruthy();
      expect(screen.getByRole("link", { name: "Set up storage" }).getAttribute("href")).toBe(`/s/${slug}/settings/storage`);
      view.unmount();
    }
  });

  it("no storage in a team the person only edits has no link", async () => {
    const { run, finish } = pendingRun();
    open(run);
    await start("Film Crew");
    await finish({ ok: false, message: "Film Crew has no storage yet. Ask an admin of Film Crew to set it up.", code: "NO_STORAGE" });
    expect(screen.getByText(/Ask an admin of Film Crew/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Set up storage" })).toBeNull();
  });

  it("another failure shows its message and Try again runs it again", async () => {
    const first = pendingRun();
    open(first.run);
    await start();
    await first.finish({ ok: false, message: "Copying stopped.", code: "NETWORK" });
    expect(screen.getByText("Copying stopped.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Set up storage" })).toBeNull();
    await act(async () => void fireEvent.click(button("Try again")));
    expect(first.run).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Copying stopped.")).toBeNull();
    expect(first.input().toSpaceId).toBe("s2");
  });
});
