// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMemberAction,
  disconnectClaudeAction,
  removeMemberAction,
  setRoleAction,
} from "@/app/(dashboard)/admin/actions";
import { AddMemberButton } from "@/app/(dashboard)/admin/add-member-dialog";
import { MemberActions, RoleSelect } from "@/app/(dashboard)/admin/member-controls";
import { ConnectionStatus, MembersTable, type Member } from "@/app/(dashboard)/admin/members-table";
import AdminPage from "@/app/(dashboard)/admin/page";
import { ROLE_CHOICES } from "@/app/(dashboard)/admin/roles";
import type { DB } from "@/db";
import { allowlist } from "@/db/schema";
import { requireUser } from "@/lib/access";
import type { CurrentUser } from "@/lib/access-rules";
import { makeTestDb } from "../helpers/db";
import { act, fireEvent, render, screen, within } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, unstable_rethrow: () => {} }));

vi.mock("@/app/(dashboard)/admin/actions", () => ({
  addMemberAction: vi.fn(),
  setRoleAction: vi.fn(),
  removeMemberAction: vi.fn(),
  disconnectClaudeAction: vi.fn(),
}));

const signedIn = vi.hoisted(() => ({ user: null as CurrentUser | null, connected: new Set<string>() }));
vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => signedIn.user!),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
let testDb: DB;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => testDb }));
// Who has Claude connected comes from the sign-in tables; the page only needs the set of emails.
vi.mock("@/lib/connector/grants", async (orig) => ({
  ...(await orig<typeof import("@/lib/connector/grants")>()),
  connectedEmails: vi.fn(async () => new Set(signedIn.connected)),
}));

type Result = { error?: string };
const ACTIONS = [addMemberAction, setRoleAction, removeMemberAction, disconnectClaudeAction];

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
  router.refresh.mockClear();
  for (const action of ACTIONS) vi.mocked(action).mockReset().mockResolvedValue({});
  vi.mocked(requireUser).mockClear();
  signedIn.user = null;
  signedIn.connected = new Set();
});

afterEach(() => vi.restoreAllMocks());

const ME = "root@gmail.com";

const MEMBERS: Member[] = [
  { email: ME, role: "admin", invitedBy: null, createdAt: "2026-01-05T12:00:00.000Z", claudeConnected: true },
  { email: "ada@gmail.com", role: "editor", invitedBy: ME, createdAt: "2026-02-10T12:00:00.000Z", claudeConnected: true },
  { email: "vic@gmail.com", role: "viewer", invitedBy: "ada@gmail.com", createdAt: "2026-03-15T12:00:00.000Z", claudeConnected: false },
];

// Each member's row, found by the role picker the row holds.
const roleSelect = (email: string) => screen.getByRole("combobox", { name: `Role for ${email}` }) as HTMLSelectElement;
const row = (email: string) => roleSelect(email).closest("tr")!;
const cells = (email: string) => within(row(email)).getAllByRole("cell");
const actionsButton = (email: string) => screen.getByRole("button", { name: `Actions for ${email}` });
const menuItems = (email: string) =>
  within(screen.getByRole("menu", { name: `Actions for ${email}` }))
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
const dialog = (name: string) => screen.getByRole("dialog", { name });
const button = (inside: HTMLElement, name: string) => within(inside).getByRole("button", { name }) as HTMLButtonElement;
const sent = (fn: unknown, call = 0) =>
  Object.fromEntries((fn as { mock: { calls: [FormData][] } }).mock.calls[call][0].entries());
const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);
const optionPairs = (select: HTMLSelectElement) => [...select.options].map((o) => [o.value, o.textContent]);

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

// Opens a member's ⋯ menu and picks an item.
async function pick(email: string, label: string) {
  fireEvent.click(actionsButton(email));
  await click(screen.getByRole("menuitem", { name: label }));
}

// The confirm question: the dialog's body, without its title or buttons.
const question = (box: HTMLElement) => within(box).getByRole("heading").parentElement!.nextElementSibling!.textContent ?? "";
const JARGON = /\boauth\b|allowlist|\bgrants?\b|\btokens?\b/i;

describe("the members table", () => {
  it("lists one row per member under Member, Role, Claude, Added and an unnamed actions column", () => {
    render(<MembersTable members={MEMBERS} me={ME} />);
    const table = screen.getByRole("table");
    expect(classes(table)).toEqual(expect.arrayContaining(["w-full", "text-left", "text-[13px]"]));
    const panel = table.closest("[class*='bg-ed-panel']");
    expect(classes(panel)).toEqual(expect.arrayContaining(["rounded-md", "border", "border-ed-line", "bg-ed-panel", "overflow-x-auto"]));
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((th) => th.textContent)).toEqual(["Member", "Role", "Claude", "Added", "Actions"]);
    // The actions column is named for screen readers only.
    expect(classes(within(headers[4]).getByText("Actions"))).toContain("sr-only");
    // Added drops off on a phone.
    expect(classes(headers[3])).toEqual(expect.arrayContaining(["hidden", "sm:table-cell"]));
    expect(within(table).getAllByRole("row")).toHaveLength(1 + MEMBERS.length);
    expect(screen.getAllByRole("combobox", { name: /^Role for / }).map((s) => s.getAttribute("aria-label"))).toEqual(
      MEMBERS.map((m) => `Role for ${m.email}`),
    );
  });

  it("each row shows the email, its role by name, and who invited them", () => {
    render(<MembersTable members={MEMBERS} me={ME} />);
    for (const member of MEMBERS) {
      const email = within(row(member.email)).getByTitle(member.email);
      expect(email.textContent).toBe(member.email);
      expect(classes(email)).toContain("truncate");
    }
    expect(roleSelect(ME).value).toBe("admin");
    expect(roleSelect(ME).selectedOptions[0].textContent).toBe("Admin");
    expect(roleSelect("ada@gmail.com").selectedOptions[0].textContent).toBe("Editor");
    expect(roleSelect("vic@gmail.com").selectedOptions[0].textContent).toBe("Viewer");

    const invited = within(row("ada@gmail.com")).getByText(`Invited by ${ME}`);
    expect(classes(invited)).toEqual(expect.arrayContaining(["text-xs", "text-ed-muted"]));
    expect(within(row("vic@gmail.com")).getByText("Invited by ada@gmail.com")).toBeTruthy();
    expect(row(ME).textContent).not.toContain("Invited by");
  });

  it("only the signed-in admin's row is tagged You", () => {
    render(<MembersTable members={MEMBERS} me={ME} />);
    const you = within(row(ME)).getByText("You");
    expect(classes(you)).toEqual(expect.arrayContaining(["text-[11px]", "bg-ed-raised"]));
    expect(within(row("ada@gmail.com")).queryByText("You")).toBeNull();
    expect(within(row("vic@gmail.com")).queryByText("You")).toBeNull();
    expect(screen.getAllByText("You")).toHaveLength(1);
  });

  it("the Claude column says whether each member is connected, with no buttons in it", () => {
    render(<MembersTable members={MEMBERS} me={ME} />);
    expect(cells("ada@gmail.com")[2].textContent).toBe("Connected");
    expect(cells("vic@gmail.com")[2].textContent).toBe("Not connected");
    for (const member of MEMBERS) expect(within(cells(member.email)[2]).queryAllByRole("button")).toHaveLength(0);
  });

  it("the Added column shows the date it was added, muted, and hides on a phone like its header", () => {
    render(<MembersTable members={MEMBERS} me={ME} />);
    const time = row("ada@gmail.com").querySelector("time")!;
    expect(time.getAttribute("datetime")).toBe("2026-02-10T12:00:00.000Z");
    expect(time.textContent).toBe("Feb 10, 2026");
    expect(time.closest("[class*='text-ed-muted']")).not.toBeNull();
    expect(classes(time.closest("td"))).toEqual(expect.arrayContaining(["hidden", "sm:table-cell"]));
  });

  it("each row's actions menu offers only what applies to that member", () => {
    render(<MembersTable members={MEMBERS} me={ME} />);
    fireEvent.click(actionsButton("ada@gmail.com"));
    expect(menuItems("ada@gmail.com")).toEqual(["Disconnect Claude", "Remove member"]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    // You cannot remove yourself.
    fireEvent.click(actionsButton(ME));
    expect(menuItems(ME)).toEqual(["Disconnect Claude"]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    fireEvent.click(actionsButton("vic@gmail.com"));
    expect(menuItems("vic@gmail.com")).toEqual(["Remove member"]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    // The actions sit in the last column.
    expect(within(cells("ada@gmail.com").at(-1)!).getByRole("button", { name: "Actions for ada@gmail.com" })).toBeTruthy();
  });

  it("a signed-in admin without Claude has no actions menu at all", () => {
    render(<MembersTable members={[{ ...MEMBERS[0], claudeConnected: false }, MEMBERS[2]]} me={ME} />);
    expect(screen.queryByRole("button", { name: `Actions for ${ME}` })).toBeNull();
    expect(screen.getByRole("button", { name: "Actions for vic@gmail.com" })).toBeTruthy();
  });
});

describe("the connection status", () => {
  it("connected shows an accent dot beside Connected", () => {
    const { container } = render(<ConnectionStatus connected />);
    expect(container.textContent).toBe("Connected");
    const dot = container.querySelector("[aria-hidden]");
    expect(classes(dot)).toEqual(expect.arrayContaining(["rounded-full", "bg-ed-accent"]));
    expect(screen.getByText("Connected").closest("[class*='text-ed-text']")).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("not connected is muted text with no dot", () => {
    const { container } = render(<ConnectionStatus connected={false} />);
    expect(container.textContent).toBe("Not connected");
    expect(screen.getByText("Not connected").closest("[class*='text-ed-muted']")).not.toBeNull();
    expect(container.querySelector("[class*='bg-ed-accent']")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("a member's actions menu", () => {
  it("is a ⋯ button named for the member", () => {
    render(<MemberActions email="ada@gmail.com" claudeConnected isSelf={false} />);
    const trigger = actionsButton("ada@gmail.com");
    expect(trigger.querySelector("svg")?.getAttribute("class")).toContain("lucide-ellipsis");
    fireEvent.click(trigger);
    expect(menuItems("ada@gmail.com")).toEqual(["Disconnect Claude", "Remove member"]);
    const remove = screen.getByRole("menuitem", { name: "Remove member" });
    expect(remove.className).toContain("text-ed-danger");
    expect(remove.previousElementSibling?.getAttribute("role")).toBe("separator");
    expect(screen.getByRole("menuitem", { name: "Disconnect Claude" }).className).not.toContain("text-ed-danger");
  });

  it("offers Remove member alone, with no rule above it, when Claude is not connected", () => {
    render(<MemberActions email="vic@gmail.com" claudeConnected={false} isSelf={false} />);
    fireEvent.click(actionsButton("vic@gmail.com"));
    expect(menuItems("vic@gmail.com")).toEqual(["Remove member"]);
    expect(screen.getByRole("menuitem", { name: "Remove member" }).previousElementSibling).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("never offers Remove member on your own row", () => {
    render(<MemberActions email={ME} claudeConnected isSelf />);
    fireEvent.click(actionsButton(ME));
    expect(menuItems(ME)).toEqual(["Disconnect Claude"]);
  });

  it("renders nothing when there is nothing to offer", () => {
    const { container } = render(<MemberActions email={ME} claudeConnected={false} isSelf />);
    expect(container.childElementCount).toBe(0);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("removing a member", () => {
  it("asks first, in plain words, with focus on Cancel", async () => {
    render(<MemberActions email="ada@gmail.com" claudeConnected isSelf={false} />);
    await pick("ada@gmail.com", "Remove member");
    const asking = dialog("Remove member");
    expect(question(asking).trim()).not.toBe("");
    expect(question(asking)).not.toMatch(JARGON);
    expect(document.activeElement).toBe(button(asking, "Cancel"));
    expect(button(asking, "Remove").className).toContain("text-ed-danger");
    expect(within(asking).queryByRole("alert")).toBeNull();
    await click(button(asking, "Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(removeMemberAction).not.toHaveBeenCalled();
  });

  it("Remove sends the member's email and closes the dialog", async () => {
    render(<MemberActions email="ada@gmail.com" claudeConnected isSelf={false} />);
    await pick("ada@gmail.com", "Remove member");
    await click(button(dialog("Remove member"), "Remove"));
    expect(removeMemberAction).toHaveBeenCalledTimes(1);
    expect(sent(removeMemberAction)).toEqual({ email: "ada@gmail.com" });
    expect(disconnectClaudeAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a refused remove is explained in the dialog, which stays open, and asking again starts clean", async () => {
    vi.mocked(removeMemberAction).mockResolvedValue({ error: "There must always be at least one admin." });
    render(<MemberActions email="ada@gmail.com" claudeConnected isSelf={false} />);
    await pick("ada@gmail.com", "Remove member");
    await click(button(dialog("Remove member"), "Remove"));
    const alert = within(dialog("Remove member")).getByRole("alert");
    expect(alert.textContent).toBe("There must always be at least one admin.");
    expect(alert.className).toContain("text-ed-danger");
    expect(button(dialog("Remove member"), "Remove").disabled).toBe(false);
    await click(button(dialog("Remove member"), "Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await pick("ada@gmail.com", "Remove member");
    expect(within(dialog("Remove member")).queryByRole("alert")).toBeNull();
  });

  it("a remove that fails without an answer says so in the dialog", async () => {
    vi.mocked(removeMemberAction).mockRejectedValue(new TypeError("Failed to fetch"));
    render(<MemberActions email="ada@gmail.com" claudeConnected isSelf={false} />);
    await pick("ada@gmail.com", "Remove member");
    await click(button(dialog("Remove member"), "Remove"));
    expect(within(dialog("Remove member")).getByRole("alert").textContent).toBe("Something went wrong. Try again.");
  });

  it("Remove is held while removing", async () => {
    // Finished at the end: React holds later transitions until a running async action settles.
    let finish: (result: Result) => void = () => {};
    vi.mocked(removeMemberAction).mockImplementation(() => new Promise<Result>((resolve) => (finish = resolve)));
    render(<MemberActions email="ada@gmail.com" claudeConnected isSelf={false} />);
    await pick("ada@gmail.com", "Remove member");
    const remove = button(dialog("Remove member"), "Remove");
    await click(remove);
    expect(remove.disabled).toBe(true);
    await click(remove);
    expect(removeMemberAction).toHaveBeenCalledTimes(1);
    await act(async () => finish({}));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("disconnecting Claude", () => {
  it("asks first, in plain words", async () => {
    render(<MemberActions email="ada@gmail.com" claudeConnected isSelf={false} />);
    await pick("ada@gmail.com", "Disconnect Claude");
    const asking = dialog("Disconnect Claude");
    expect(question(asking).trim()).not.toBe("");
    expect(question(asking)).not.toMatch(JARGON);
    expect(document.activeElement).toBe(button(asking, "Cancel"));
    await click(button(asking, "Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(disconnectClaudeAction).not.toHaveBeenCalled();
  });

  it("Disconnect sends the member's email and closes the dialog", async () => {
    render(<MemberActions email="ada@gmail.com" claudeConnected isSelf={false} />);
    await pick("ada@gmail.com", "Disconnect Claude");
    await click(button(dialog("Disconnect Claude"), "Disconnect"));
    expect(disconnectClaudeAction).toHaveBeenCalledTimes(1);
    expect(sent(disconnectClaudeAction)).toEqual({ email: "ada@gmail.com" });
    expect(removeMemberAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("works on your own row too", async () => {
    render(<MemberActions email={ME} claudeConnected isSelf />);
    await pick(ME, "Disconnect Claude");
    await click(button(dialog("Disconnect Claude"), "Disconnect"));
    expect(sent(disconnectClaudeAction)).toEqual({ email: ME });
  });

  it("a refused disconnect is explained in the dialog, which stays open, and asking again starts clean", async () => {
    vi.mocked(disconnectClaudeAction).mockResolvedValue({ error: "Your role doesn't allow this." });
    render(<MemberActions email="ada@gmail.com" claudeConnected isSelf={false} />);
    await pick("ada@gmail.com", "Disconnect Claude");
    await click(button(dialog("Disconnect Claude"), "Disconnect"));
    const alert = within(dialog("Disconnect Claude")).getByRole("alert");
    expect(alert.textContent).toBe("Your role doesn't allow this.");
    expect(alert.className).toContain("text-ed-danger");
    expect(button(dialog("Disconnect Claude"), "Disconnect").disabled).toBe(false);
    await click(button(dialog("Disconnect Claude"), "Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await pick("ada@gmail.com", "Disconnect Claude");
    expect(within(dialog("Disconnect Claude")).queryByRole("alert")).toBeNull();
  });

  it("an error from one action does not show in the other's dialog", async () => {
    vi.mocked(disconnectClaudeAction).mockResolvedValue({ error: "Your role doesn't allow this." });
    render(<MemberActions email="ada@gmail.com" claudeConnected isSelf={false} />);
    await pick("ada@gmail.com", "Disconnect Claude");
    await click(button(dialog("Disconnect Claude"), "Disconnect"));
    await click(button(dialog("Disconnect Claude"), "Cancel"));
    await pick("ada@gmail.com", "Remove member");
    expect(within(dialog("Remove member")).queryByRole("alert")).toBeNull();
  });
});

describe("focus after an action", () => {
  const heading = () => (
    <h1 id="members-heading" tabIndex={-1}>
      Members
    </h1>
  );

  it("goes to the Members heading when a removed member's row goes away", async () => {
    const { rerender } = render(
      <>
        {heading()}
        <MemberActions email="ada@gmail.com" claudeConnected isSelf={false} />
      </>,
    );
    await pick("ada@gmail.com", "Remove member");
    await click(button(dialog("Remove member"), "Remove"));
    // The server sends the table back without the row.
    await act(async () => {
      rerender(<>{heading()}</>);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve)));
    expect(document.activeElement).toBe(document.getElementById("members-heading"));
  });

  it("goes to the Members heading when disconnecting your own Claude leaves no menu", async () => {
    const { rerender } = render(
      <>
        {heading()}
        <MemberActions email={ME} claudeConnected isSelf />
      </>,
    );
    await pick(ME, "Disconnect Claude");
    await click(button(dialog("Disconnect Claude"), "Disconnect"));
    await act(async () => {
      rerender(
        <>
          {heading()}
          <MemberActions email={ME} claudeConnected={false} isSelf />
        </>,
      );
    });
    expect(screen.queryByRole("button", { name: `Actions for ${ME}` })).toBeNull();
    expect(document.activeElement).toBe(document.getElementById("members-heading"));
  });
});

describe("the role picker", () => {
  it("is a quiet native select listing the roles by name", () => {
    render(<RoleSelect email="ada@gmail.com" role="editor" />);
    const select = roleSelect("ada@gmail.com");
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("editor");
    expect(optionPairs(select)).toEqual([
      ["admin", "Admin"],
      ["editor", "Editor"],
      ["viewer", "Viewer"],
    ]);
    expect(classes(select)).toEqual(expect.arrayContaining(["appearance-none", "border-transparent", "bg-transparent", "h-7", "text-[13px]"]));
    expect(select.parentElement!.querySelector("svg")?.getAttribute("class")).toContain("lucide-chevron-down");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a new role shows at once and is sent with the email", async () => {
    const errors = vi.spyOn(console, "error");
    render(<RoleSelect email="ada@gmail.com" role="editor" />);
    await act(async () => {
      fireEvent.change(roleSelect("ada@gmail.com"), { target: { value: "viewer" } });
    });
    expect(setRoleAction).toHaveBeenCalledTimes(1);
    expect(sent(setRoleAction)).toEqual({ email: "ada@gmail.com", role: "viewer" });
    expect(roleSelect("ada@gmail.com").value).toBe("viewer");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it("is held while the change is saving", async () => {
    let finish: (result: Result) => void = () => {};
    vi.mocked(setRoleAction).mockImplementation(() => new Promise<Result>((resolve) => (finish = resolve)));
    render(<RoleSelect email="ada@gmail.com" role="editor" />);
    await act(async () => {
      fireEvent.change(roleSelect("ada@gmail.com"), { target: { value: "admin" } });
    });
    expect(roleSelect("ada@gmail.com").value).toBe("admin");
    // Held, not disabled, so keyboard focus stays on it; a second change meanwhile is not sent.
    expect(roleSelect("ada@gmail.com").disabled).toBe(false);
    expect(roleSelect("ada@gmail.com").getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      fireEvent.change(roleSelect("ada@gmail.com"), { target: { value: "viewer" } });
    });
    expect(setRoleAction).toHaveBeenCalledTimes(1);
    expect(roleSelect("ada@gmail.com").value).toBe("admin");
    await act(async () => finish({}));
    expect(roleSelect("ada@gmail.com").hasAttribute("aria-disabled")).toBe(false);
    expect(roleSelect("ada@gmail.com").value).toBe("admin");
  });

  it("keeps focus while the change is saving", async () => {
    // Finished at the end: React holds later transitions until a running async action settles.
    let finish: (result: Result) => void = () => {};
    vi.mocked(setRoleAction).mockImplementation(() => new Promise<Result>((resolve) => (finish = resolve)));
    render(<RoleSelect email="ada@gmail.com" role="editor" />);
    roleSelect("ada@gmail.com").focus();
    await act(async () => {
      fireEvent.change(roleSelect("ada@gmail.com"), { target: { value: "viewer" } });
    });
    expect(document.activeElement).toBe(roleSelect("ada@gmail.com"));
    await act(async () => finish({}));
  });

  it("a refused change goes back to the saved role and says why, until a change goes through", async () => {
    vi.mocked(setRoleAction).mockResolvedValue({ error: "There must always be at least one admin." });
    render(<RoleSelect email="ada@gmail.com" role="editor" />);
    await act(async () => {
      fireEvent.change(roleSelect("ada@gmail.com"), { target: { value: "viewer" } });
    });
    expect(roleSelect("ada@gmail.com").value).toBe("editor");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("There must always be at least one admin.");
    expect(classes(alert)).toEqual(expect.arrayContaining(["text-xs", "text-ed-danger"]));
    vi.mocked(setRoleAction).mockResolvedValue({});
    await act(async () => {
      fireEvent.change(roleSelect("ada@gmail.com"), { target: { value: "admin" } });
    });
    expect(roleSelect("ada@gmail.com").value).toBe("admin");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("follows the saved role when it changes", () => {
    const { rerender } = render(<RoleSelect email="ada@gmail.com" role="editor" />);
    rerender(<RoleSelect email="ada@gmail.com" role="admin" />);
    expect(roleSelect("ada@gmail.com").value).toBe("admin");
  });
});

describe("adding a member", () => {
  const opener = () => screen.getAllByRole("button", { name: "Add member" })[0] as HTMLButtonElement;
  const email = () => within(dialog("Add member")).getByRole("textbox", { name: "Email" }) as HTMLInputElement;
  const role = () => within(dialog("Add member")).getByRole("combobox", { name: "Role" }) as HTMLSelectElement;
  const submit = () => button(dialog("Add member"), "Add member");
  const typeEmail = (value: string) => fireEvent.change(email(), { target: { value } });
  const hint = (value: string) => ROLE_CHOICES.find((choice) => choice.value === value)!.hint;

  it("is an accent button with a person icon, not a white one", () => {
    render(<AddMemberButton />);
    const open = screen.getByRole("button", { name: "Add member" });
    expect(classes(open)).toContain("bg-ed-accent");
    expect(open.className).not.toContain("bg-foreground");
    expect(open.className).not.toContain("bg-white");
    expect(open.querySelector("svg")?.getAttribute("class")).toContain("lucide-user-plus");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a dialog asking for an email and a role, Editor by default, with focus in the email", async () => {
    render(<AddMemberButton />);
    await click(opener());
    expect(dialog("Add member")).toBeTruthy();
    expect(email().type).toBe("email");
    expect(email().name).toBe("email");
    expect(email().required).toBe(true);
    expect(email().value).toBe("");
    expect(email().getAttribute("autocomplete")).toBe("off");
    expect(email().getAttribute("spellcheck")).toBe("false");
    expect(document.activeElement).toBe(email());
    expect(role().name).toBe("role");
    expect(role().value).toBe("editor");
    expect(optionPairs(role())).toEqual([
      ["admin", "Admin"],
      ["editor", "Editor"],
      ["viewer", "Viewer"],
    ]);
    expect(within(dialog("Add member")).getByText(hint("editor"))).toBeTruthy();
    expect(within(dialog("Add member")).queryByRole("alert")).toBeNull();
  });

  it("the hint follows the role chosen", async () => {
    render(<AddMemberButton />);
    await click(opener());
    fireEvent.change(role(), { target: { value: "viewer" } });
    expect(within(dialog("Add member")).getByText(hint("viewer"))).toBeTruthy();
    // Read out with the select, since it is the only text saying what the role can do.
    const describedBy = role().getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)?.textContent).toBe(hint("viewer"));
    expect(within(dialog("Add member")).queryByText(hint("editor"))).toBeNull();
    fireEvent.change(role(), { target: { value: "admin" } });
    expect(within(dialog("Add member")).getByText(hint("admin"))).toBeTruthy();
  });

  it("the footer's Add member submits the form", async () => {
    render(<AddMemberButton />);
    await click(opener());
    const form = email().form!;
    expect(form).not.toBeNull();
    expect(submit().type).toBe("submit");
    expect(submit().form).toBe(form);
    expect(form.contains(submit())).toBe(false);
    expect(classes(submit())).toContain("bg-ed-accent");
    expect(button(dialog("Add member"), "Cancel")).toBeTruthy();
  });

  it("sends the email and Editor, then closes", async () => {
    const errors = vi.spyOn(console, "error");
    render(<AddMemberButton />);
    await click(opener());
    typeEmail("lin@gmail.com");
    await click(submit());
    expect(addMemberAction).toHaveBeenCalledTimes(1);
    expect(sent(addMemberAction)).toEqual({ email: "lin@gmail.com", role: "editor" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it("sends the role chosen, and Enter in the email submits", async () => {
    render(<AddMemberButton />);
    await click(opener());
    typeEmail("lin@gmail.com");
    fireEvent.change(role(), { target: { value: "viewer" } });
    let submitted = true;
    await act(async () => {
      submitted = fireEvent.submit(email().form!);
    });
    expect(submitted).toBe(false); // the page itself is never submitted
    expect(addMemberAction).toHaveBeenCalledTimes(1);
    expect(sent(addMemberAction)).toEqual({ email: "lin@gmail.com", role: "viewer" });
  });

  it("a refused add is explained in the dialog, which stays open with what was typed", async () => {
    vi.mocked(addMemberAction).mockResolvedValue({ error: "That email is already a member. Change their role in the table." });
    render(<AddMemberButton />);
    await click(opener());
    typeEmail("ada@gmail.com");
    await click(submit());
    const alert = within(dialog("Add member")).getByRole("alert");
    expect(alert.textContent).toBe("That email is already a member. Change their role in the table.");
    expect(classes(alert)).toEqual(expect.arrayContaining(["text-xs", "text-ed-danger"]));
    expect(email().value).toBe("ada@gmail.com");
    expect(submit().disabled).toBe(false);
  });

  it("Add member is held while adding", async () => {
    let finish: (result: Result) => void = () => {};
    vi.mocked(addMemberAction).mockImplementation(() => new Promise<Result>((resolve) => (finish = resolve)));
    render(<AddMemberButton />);
    await click(opener());
    typeEmail("lin@gmail.com");
    await click(submit());
    expect(submit().disabled).toBe(true);
    await click(submit());
    expect(addMemberAction).toHaveBeenCalledTimes(1);
    await act(async () => finish({}));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cancel and Escape close it without adding anyone", async () => {
    render(<AddMemberButton />);
    await click(opener());
    typeEmail("lin@gmail.com");
    await click(button(dialog("Add member"), "Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await click(opener());
    await act(async () => {
      fireEvent.keyDown(dialog("Add member"), { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(addMemberAction).not.toHaveBeenCalled();
  });

  it("each opening starts with an empty form and no old error", async () => {
    vi.mocked(addMemberAction).mockResolvedValue({ error: "That doesn't look like an email address." });
    render(<AddMemberButton />);
    await click(opener());
    typeEmail("lin@gmail.com");
    fireEvent.change(role(), { target: { value: "admin" } });
    await click(submit());
    expect(within(dialog("Add member")).getByRole("alert")).toBeTruthy();
    await click(button(dialog("Add member"), "Cancel"));
    await click(opener());
    expect(email().value).toBe("");
    expect(role().value).toBe("editor");
    expect(within(dialog("Add member")).getByText(hint("editor"))).toBeTruthy();
    expect(within(dialog("Add member")).queryByRole("alert")).toBeNull();

    // And after an add that went through.
    vi.mocked(addMemberAction).mockResolvedValue({});
    typeEmail("lin@gmail.com");
    fireEvent.change(role(), { target: { value: "viewer" } });
    await click(submit());
    expect(screen.queryByRole("dialog")).toBeNull();
    await click(opener());
    expect(email().value).toBe("");
    expect(role().value).toBe("editor");
  });
});

describe("the admin page", () => {
  const root: CurrentUser = { id: "u1", email: ME, name: "Root", image: null, allowlistRole: "admin" };

  async function seed(rows: { email: string; role: "admin" | "editor" | "viewer"; invitedBy: string | null; createdAt: Date }[]) {
    testDb = await makeTestDb();
    await testDb.insert(allowlist).values(rows);
  }

  async function renderPage() {
    signedIn.user = root;
    return render(await AdminPage());
  }

  it("is for admins, and lists every member from the database in the order they were added", async () => {
    await seed([
      { email: "vic@gmail.com", role: "viewer", invitedBy: "ada@gmail.com", createdAt: new Date("2026-03-15T12:00:00.000Z") },
      { email: ME, role: "admin", invitedBy: null, createdAt: new Date("2026-01-05T12:00:00.000Z") },
      { email: "ada@gmail.com", role: "editor", invitedBy: ME, createdAt: new Date("2026-02-10T12:00:00.000Z") },
    ]);
    signedIn.connected = new Set([ME, "ada@gmail.com"]);
    await renderPage();
    expect(requireUser).toHaveBeenCalledWith("admin");

    expect(screen.getAllByRole("combobox", { name: /^Role for / }).map((s) => s.getAttribute("aria-label"))).toEqual([
      `Role for ${ME}`,
      "Role for ada@gmail.com",
      "Role for vic@gmail.com",
    ]);
    expect(roleSelect(ME).value).toBe("admin");
    expect(roleSelect("ada@gmail.com").value).toBe("editor");
    expect(roleSelect("vic@gmail.com").value).toBe("viewer");
    expect(cells(ME)[2].textContent).toBe("Connected");
    expect(cells("ada@gmail.com")[2].textContent).toBe("Connected");
    expect(cells("vic@gmail.com")[2].textContent).toBe("Not connected");
    expect(within(row("ada@gmail.com")).getByText(`Invited by ${ME}`)).toBeTruthy();
    expect(row(ME).textContent).not.toContain("Invited by");
    expect(row("vic@gmail.com").querySelector("time")?.getAttribute("datetime")).toBe("2026-03-15T12:00:00.000Z");
    expect(within(row(ME)).getByText("You")).toBeTruthy();
    expect(screen.getAllByText("You")).toHaveLength(1);
    // You cannot remove yourself from the page.
    fireEvent.click(actionsButton(ME));
    expect(menuItems(ME)).toEqual(["Disconnect Claude"]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    fireEvent.click(actionsButton("vic@gmail.com"));
    expect(menuItems("vic@gmail.com")).toEqual(["Remove member"]);
  });

  it("scrolls itself inside the dashboard frame, under a Members heading with a count and Add member", async () => {
    await seed([
      { email: ME, role: "admin", invitedBy: null, createdAt: new Date("2026-01-05T12:00:00.000Z") },
      { email: "ada@gmail.com", role: "editor", invitedBy: ME, createdAt: new Date("2026-02-10T12:00:00.000Z") },
      { email: "vic@gmail.com", role: "viewer", invitedBy: ME, createdAt: new Date("2026-03-15T12:00:00.000Z") },
    ]);
    signedIn.connected = new Set(["ada@gmail.com", "vic@gmail.com"]);
    await renderPage();
    const main = screen.getByRole("main");
    expect(classes(main)).toEqual(expect.arrayContaining(["min-h-0", "min-w-0", "flex-1", "overflow-y-auto"]));
    expect(main.querySelector("[class*='max-w-4xl']")).not.toBeNull();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Members");
    const summary = heading.nextElementSibling!;
    expect(summary.textContent).toMatch(/\b3 members\b/);
    expect(summary.textContent).toMatch(/\b2 connected\b/);
    expect(classes(summary)).toEqual(expect.arrayContaining(["text-xs", "text-ed-muted"]));
    expect(within(main).getByRole("button", { name: "Add member" })).toBeTruthy();
    // Nothing else: the add form lives in its dialog.
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Members"]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });

  it("counts one member as one member", async () => {
    await seed([{ email: ME, role: "admin", invitedBy: null, createdAt: new Date("2026-01-05T12:00:00.000Z") }]);
    await renderPage();
    const summary = screen.getByRole("heading", { level: 1 }).nextElementSibling!;
    expect(summary.textContent).toMatch(/\b1 member\b/);
    expect(summary.textContent).not.toMatch(/\b1 members\b/);
    expect(cells(ME)[2].textContent).toBe("Not connected");
    // Your own row without Claude has nothing to act on.
    expect(screen.queryByRole("button", { name: `Actions for ${ME}` })).toBeNull();
  });
});
