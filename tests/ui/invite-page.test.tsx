// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import InvitePage from "@/app/invite/[id]/page";
import type { CurrentUser } from "@/lib/access-rules";
import type { InviteStatus, InviteView } from "@/lib/spaces/invites";
import { render, screen } from "../helpers/dom";

const stub = vi.hoisted(() => ({ me: null as CurrentUser | null, invite: null as InviteView | null, member: false, findMySpace: vi.fn() }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/access", () => ({ getCurrentUser: async () => stub.me }));
vi.mock("@/lib/spaces/invites", () => ({ findInvite: async () => stub.invite }));
vi.mock("@/lib/spaces/service", () => ({
  findMySpace: async (...args: unknown[]) => {
    stub.findMySpace(...args);
    return stub.member ? { id: "team_robots" } : null;
  },
}));
vi.mock("@/app/invite/[id]/actions", () => ({ acceptInviteAction: vi.fn(), declineInviteAction: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: vi.fn(), signIn: { social: vi.fn() } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), unstable_rethrow: () => {} }));

const user = (email: string): CurrentUser => ({ id: "u1", email, name: "Ada", image: null, allowlistRole: null });
const invite = (status: InviteStatus): InviteView => ({ id: "inv1", email: "lin@example.com", role: "editor", status, teamName: "Robotics Club", teamSlug: "robotics-club", invitedBy: "Uma" });

async function show() {
  return render(await InvitePage({ params: Promise.resolve({ id: "inv1" }), searchParams: Promise.resolve({}) } as never));
}

beforeEach(() => {
  stub.me = null;
  stub.invite = invite("pending");
  stub.member = false;
  stub.findMySpace.mockClear();
});

describe("the invite page picks one state", () => {
  it("a signed-in member of the team sees 'already in', whatever became of the invite", async () => {
    stub.me = user("lin@example.com");
    stub.member = true;
    for (const status of ["pending", "accepted", "expired", "canceled", "declined"] as const) {
      stub.invite = invite(status);
      const page = await show();
      expect(screen.getByText("You're already in Robotics Club.")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Open Robotics Club" }).getAttribute("href")).toBe("/s/robotics-club");
      page.unmount();
    }
    expect(stub.findMySpace).toHaveBeenCalledWith({}, "u1", "robotics-club");
  });

  it("expired, used and unknown each get their own message", async () => {
    stub.me = user("lin@example.com");
    const message = async () => {
      const page = await show();
      const text = screen.getByRole("link", { name: "Go to EasyEdit" }).parentElement!.querySelector("p")!.textContent;
      page.unmount();
      return text;
    };
    stub.invite = invite("expired");
    expect(await message()).toBe("This invite has expired. Ask a team admin for a new one.");
    for (const status of ["accepted", "canceled", "declined"] as const) {
      stub.invite = invite(status);
      expect(await message()).toBe("This invite has already been used or cancelled.");
    }
    stub.invite = null;
    expect(await message()).toBe("This invite link doesn't work.");
  });

  it("a signed-in account with the invited email gets Join and Decline", async () => {
    stub.me = user("lin@example.com");
    await show();
    expect(screen.getByText("Uma invited you to join Robotics Club as Editor.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Join Robotics Club" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
  });

  it("a different account is told so and shown its own email", async () => {
    stub.me = user("bob@example.com");
    await show();
    expect(screen.getByText("This invite is for a different Google address. You're signed in as bob@example.com.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("signed out: the sentence and a sign-in, and the invited email is nowhere on the page", async () => {
    const page = await show();
    expect(screen.getByText("Uma invited you to join Robotics Club as Editor.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeTruthy();
    expect(page.container.textContent).not.toContain("lin@example.com");
    expect(stub.findMySpace).not.toHaveBeenCalled();
  });
});
