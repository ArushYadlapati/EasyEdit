// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MembersTable, type MemberRow } from "@/components/space-settings/members-table";
import type { Role } from "@/lib/allowlist/service";
import { act, fireEvent, render, screen, waitFor, within } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/s/robots/settings/members", unstable_rethrow: () => {} }));

type FormAction = (formData: FormData) => Promise<{ error?: string }>;
const actions = {
  add: vi.fn<FormAction>(async () => ({})),
  setRole: vi.fn<FormAction>(async () => ({})),
  remove: vi.fn<FormAction>(async () => ({})),
  leave: vi.fn<() => Promise<{ error?: string }>>(async () => ({})),
};

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset().mockResolvedValue({});
});

const UMA: MemberRow = { userId: "u1", name: "Uma", email: "u1@gmail.com", role: "admin", joinedAt: "2026-11-01T12:00:00.000Z", storageOwner: false };
const BEN: MemberRow = { userId: "u2", name: "Ben", email: "u2@gmail.com", role: "admin", joinedAt: "2026-11-02T12:00:00.000Z", storageOwner: true };
const CARA: MemberRow = { userId: "u3", name: "Cara", email: "u3@gmail.com", role: "viewer", joinedAt: "2026-11-03T12:00:00.000Z", storageOwner: false };
const ALL = [UMA, BEN, CARA];

function show(me: string, viewerRole: Role, members: MemberRow[] = ALL, extra: { managedElsewhere?: boolean; adminPageLink?: boolean } = {}) {
  return render(
    <MembersTable
      teamName="Robots"
      members={members}
      me={me}
      viewerRole={viewerRole}
      managedElsewhere={extra.managedElsewhere ?? false}
      adminPageLink={extra.adminPageLink ?? false}
      actions={actions}
    />,
  );
}

const row = (email: string) => screen.getByText(email).closest("tr")!;
const roleSelect = (email: string) => screen.queryByRole<HTMLSelectElement>("combobox", { name: `Role for ${email}` });
const menuButton = (email: string) => screen.queryByRole("button", { name: `Actions for ${email}` });
const dialog = (name: string) => screen.getByRole("dialog", { name });

describe("the members table", () => {
  it("the count line reads 1 member, or 3 members", () => {
    const one = show("u1", "admin", [UMA]);
    expect(screen.getByRole("heading", { name: "Members" })).toBeTruthy();
    expect(screen.getByText("1 member")).toBeTruthy();
    one.unmount();
    show("u1", "admin");
    expect(screen.getByText("3 members")).toBeTruthy();
  });

  it("shows each member's name, email, role and when they joined", () => {
    show("u3", "viewer");
    const cells = within(row("u2@gmail.com")).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells.slice(0, 4).join("|")).toMatch(/^Ben.*\|u2@gmail\.com\|Admin\|.*2026/);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Email", "Role", "Joined", "Actions"]);
  });

  it("an admin sees role selects, Remove on others, Leave on their own row, and no Remove on the storage owner", async () => {
    show("u1", "admin");
    expect(screen.getByRole("button", { name: "Add member" })).toBeTruthy();
    for (const m of ALL) expect(roleSelect(m.email)).toBeTruthy();
    expect(roleSelect("u3@gmail.com")!.value).toBe("viewer");
    expect(roleSelect("u3@gmail.com")!.disabled).toBe(false);

    // Their own row: You and Leave team, no Remove.
    expect(within(row("u1@gmail.com")).getByText("You")).toBeTruthy();
    expect(within(row("u1@gmail.com")).getByRole("button", { name: "Leave team" })).toBeTruthy();
    expect(menuButton("u1@gmail.com")).toBeNull();

    // Another member: Remove from team in the row's menu.
    expect(within(row("u3@gmail.com")).queryByRole("button", { name: "Leave team" })).toBeNull();
    await act(async () => fireEvent.click(menuButton("u3@gmail.com")!));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["Remove from team"]);

    // The storage owner: the Storage note, a role fixed at Admin, no Remove, no Leave.
    const owner = row("u2@gmail.com");
    const note = within(owner).getByText("Storage");
    expect(note.getAttribute("title")).toBe("This team's videos are stored in their Google Drive.");
    expect(roleSelect("u2@gmail.com")!.value).toBe("admin");
    expect(roleSelect("u2@gmail.com")!.disabled).toBe(true);
    expect(menuButton("u2@gmail.com")).toBeNull();
    expect(within(owner).queryByRole("button", { name: "Leave team" })).toBeNull();
  });

  it("the storage owner viewing has no Leave on their own row", () => {
    show("u2", "admin");
    expect(within(row("u2@gmail.com")).getByText("You")).toBeTruthy();
    expect(within(row("u2@gmail.com")).queryByRole("button", { name: "Leave team" })).toBeNull();
  });

  it("a viewer sees no controls except Leave team on their own row", () => {
    show("u3", "viewer");
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
    expect(screen.queryAllByRole("combobox")).toEqual([]);
    expect(screen.queryAllByRole("button", { name: /^Actions for/ })).toEqual([]);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Leave team"]);
    expect(within(row("u3@gmail.com")).getByRole("button", { name: "Leave team" })).toBeTruthy();
    expect(within(row("u3@gmail.com")).getByText("Viewer")).toBeTruthy();
  });

  it("changing a role sends the member and the role; a refusal shows and the select goes back", async () => {
    actions.setRole.mockResolvedValue({ error: "A team needs at least one admin. Make someone else an admin first." });
    show("u1", "admin");
    await act(async () => fireEvent.change(roleSelect("u3@gmail.com")!, { target: { value: "editor" } }));
    const sent = actions.setRole.mock.calls[0]![0];
    expect(Object.fromEntries(sent.entries())).toEqual({ userId: "u3", role: "editor" });
    await waitFor(() => expect(within(row("u3@gmail.com")).getByRole("alert").textContent).toBe("A team needs at least one admin. Make someone else an admin first."));
    expect(roleSelect("u3@gmail.com")!.value).toBe("viewer");
  });

  it("Remove from team asks first, then sends the member", async () => {
    show("u1", "admin");
    await act(async () => fireEvent.click(menuButton("u3@gmail.com")!));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Remove from team" })));
    const ask = dialog("Remove from team");
    expect(within(ask).getByText("Remove Cara from Robots? They'll lose access to its projects.")).toBeTruthy();
    await act(async () => fireEvent.click(within(ask).getByRole("button", { name: "Remove" })));
    expect(Object.fromEntries(actions.remove.mock.calls[0]![0].entries())).toEqual({ userId: "u3" });
  });

  it("Leave team asks first; a refusal shows in the dialog", async () => {
    actions.leave.mockResolvedValue({ error: "A team needs at least one admin. Make someone else an admin first." });
    show("u1", "admin");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Leave team" })));
    const ask = dialog("Leave Robots?");
    expect(within(ask).getByText("You'll lose access to its projects.")).toBeTruthy();
    await act(async () => fireEvent.click(within(ask).getByRole("button", { name: "Leave team" })));
    expect(actions.leave).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(dialog("Leave Robots?")).getByRole("alert").textContent).toBe("A team needs at least one admin. Make someone else an admin first."));
  });

  it("Seattle Solvers: the table without controls, and where its members are managed", () => {
    const plain = show("u1", "admin", ALL, { managedElsewhere: true, adminPageLink: false });
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("combobox")).toEqual([]);
    expect(screen.getByText("Seattle Solvers' members are managed on the Admin page.", { normalizer: (s) => s })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Admin page" })).toBeNull();
    plain.unmount();
    show("u1", "admin", ALL, { managedElsewhere: true, adminPageLink: true });
    expect(screen.getByRole("link", { name: "Admin page" }).getAttribute("href")).toBe("/admin");
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Seattle Solvers' members are managed on the Admin page.")).toBeTruthy();
  });
});

describe("the add member dialog", () => {
  it("asks for an email and a role, says they need an account, and shows a refusal", async () => {
    actions.add.mockResolvedValueOnce({ error: "No EasyEdit account uses that email yet. Ask them to sign in once, then add them." });
    show("u1", "admin");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add member" })));
    const add = dialog("Add member");
    expect(within(add).getByText("They need to have signed in to EasyEdit at least once.")).toBeTruthy();
    const role = within(add).getByRole<HTMLSelectElement>("combobox", { name: "Role" });
    expect([...role.options].map((o) => o.textContent)).toEqual(["Admin", "Editor", "Viewer"]);
    expect(role.value).toBe("editor");
    expect(within(add).getByText("Creates and edits projects.")).toBeTruthy();
    expect(within(add).getByRole("button", { name: "Cancel" })).toBeTruthy();

    fireEvent.change(within(add).getByRole("textbox", { name: "Email" }), { target: { value: "ada@example.com" } });
    fireEvent.change(role, { target: { value: "viewer" } });
    expect(within(add).getByText("Opens projects but can't change them.")).toBeTruthy();
    await act(async () => fireEvent.click(within(add).getByRole("button", { name: "Add" })));
    expect(Object.fromEntries(actions.add.mock.calls[0]![0].entries())).toEqual({ email: "ada@example.com", role: "viewer" });
    await waitFor(() =>
      expect(within(dialog("Add member")).getByRole("alert").textContent).toBe("No EasyEdit account uses that email yet. Ask them to sign in once, then add them."),
    );

    // Tried again, it goes through and the dialog closes.
    await act(async () => fireEvent.click(within(dialog("Add member")).getByRole("button", { name: "Add" })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add member" })).toBeNull());
    expect(actions.add).toHaveBeenCalledTimes(2);
  });
});
