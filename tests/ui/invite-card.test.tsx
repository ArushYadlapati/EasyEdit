// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { InviteCard } from "@/components/invite/invite-card";
import { PLAIN_ERROR } from "@/components/ui/cx";
import { fireEvent, render, screen, waitFor } from "../helpers/dom";

const signOut = vi.hoisted(() => vi.fn(async () => ({})));
const signInSocial = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut, signIn: { social: signInSocial } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), unstable_rethrow: () => {} }));

const base = { inviteId: "inv1", invitedBy: "Uma", teamName: "Robotics Club", roleLabel: "Editor" };

describe("InviteCard", () => {
  it("signed out: the sentence and a Google button that returns to the invite, with no email", () => {
    render(<InviteCard state={{ kind: "signed-out", ...base }} accept={async () => ({})} decline={async () => ({})} />);
    expect(screen.getByText("EasyEdit is a free video editor in your browser. Sign in with the Google address this invite was sent to.")).toBeTruthy();
    expect(screen.getByText("Uma invited you to join Robotics Club as Editor.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(signInSocial).toHaveBeenCalledWith({ provider: "google", callbackURL: "/invite/inv1", errorCallbackURL: "/invite/inv1" });
  });

  it("signed out after a refused sign-in: shows the notice above the button", () => {
    render(<InviteCard state={{ kind: "signed-out", ...base }} notice="Sign-in didn't finish. Try again." accept={async () => ({})} decline={async () => ({})} />);
    expect(screen.getByRole("alert").textContent).toBe("Sign-in didn't finish. Try again.");
    // The plain pages' one error look: the danger colour, which follows the page's light or dark, and no box.
    expect(screen.getByRole("alert").className).toBe(PLAIN_ERROR);
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeTruthy();
  });

  it("matching email: Join and Decline call the actions", async () => {
    const accept = vi.fn(async () => ({}));
    const decline = vi.fn(async () => ({ error: "This invite has already been used or cancelled." }));
    render(<InviteCard state={{ kind: "join", ...base }} accept={accept} decline={decline} />);
    expect(screen.getByText("Uma invited you to join Robotics Club as Editor.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Join Robotics Club" }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith("inv1"));
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("This invite has already been used or cancelled."));
  });

  it("other email: says so, names the account, and signs out", async () => {
    render(<InviteCard state={{ kind: "wrong-account", ...base, signedInEmail: "bob@example.com" }} accept={async () => ({})} decline={async () => ({})} />);
    expect(screen.getByText("This invite is for a different Google address. You're signed in as bob@example.com.")).toBeTruthy();
    expect(screen.getByText("Sign out, then sign in with the address Uma invited, or ask them for a new invite.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });

  it("already a member: a link into the team", () => {
    render(<InviteCard state={{ kind: "member", teamName: "Robotics Club", teamSlug: "robotics-club" }} accept={async () => ({})} decline={async () => ({})} />);
    expect(screen.getByText("You're already in Robotics Club.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Robotics Club" }).getAttribute("href")).toBe("/s/robotics-club");
  });

  it("expired, used or unknown: the message and a link to /", () => {
    render(<InviteCard state={{ kind: "unusable", message: "This invite link doesn't work." }} accept={async () => ({})} decline={async () => ({})} />);
    expect(screen.getByText("This invite link doesn't work.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to EasyEdit" }).getAttribute("href")).toBe("/");
  });
});
