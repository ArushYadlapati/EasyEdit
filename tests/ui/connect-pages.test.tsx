// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConsentPage from "@/app/(auth)/consent/page";
import LoginPage from "@/app/(auth)/login/page";
import { getCurrentUser, requireUser, type CurrentUser } from "@/lib/access";
import { readConsentRequest, type ConsentRequest, type ConsentView, type SearchParams } from "@/lib/connector/consent";
import { listMySpaces } from "@/lib/spaces/service";
import type { Role } from "@/lib/allowlist/service";
import type { MySpace } from "@/lib/spaces/types";
import { cleanup, render, screen } from "../helpers/dom";

afterEach(() => vi.unstubAllEnvs());

vi.mock("@/lib/access", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
vi.mock("@/lib/connector/consent", async (original) => ({
  ...(await original<typeof import("@/lib/connector/consent")>()),
  readConsentRequest: vi.fn(),
}));
vi.mock("@/lib/connector/consent-client", () => ({ decideConsent: vi.fn() }));
vi.mock("@/lib/env", () => ({ requiredEnv: () => "test-secret" }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/spaces/service", () => ({ listMySpaces: vi.fn() }));

const ada: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "editor" };
const signedRequest: SearchParams = { client_id: "c1", sig: "s", exp: "1" };

// What readConsentRequest makes of each kind of request, as the page receives it.
const views = {
  // claude.ai's metadata document, and the code goes back to claude.ai.
  claude: {
    clientName: "Claude", verifiedHost: "claude.ai", agent: "claude", nameVerified: true, agentName: "Claude",
    destination: { kind: "web", host: "claude.ai" },
  },
  // Claude Code's public metadata document on claude.ai, with a loopback address.
  claudeCode: {
    clientName: "Claude Code", verifiedHost: "claude.ai", agent: "claude-code", nameVerified: true, agentName: "Claude Code",
    destination: { kind: "this-computer", port: 5555 },
  },
  // Registered itself as "Claude Code", with a loopback address: nothing backs the name.
  selfNamedClaudeCode: {
    clientName: "Claude Code", verifiedHost: null, agent: "claude-code", nameVerified: false,
    agentName: "an app that calls itself “Claude Code”", destination: { kind: "this-computer", port: 5555 },
  },
  // Registered itself, with Cursor's own app address.
  cursor: {
    clientName: "Cursor", verifiedHost: null, agent: "cursor", nameVerified: true, agentName: "Cursor",
    destination: { kind: "app", name: "Cursor" },
  },
  // Registered itself, with ChatGPT's callback.
  chatgpt: {
    clientName: "ChatGPT", verifiedHost: null, agent: "chatgpt", nameVerified: true, agentName: "ChatGPT",
    destination: { kind: "web", host: "chatgpt.com" },
  },
  helper: {
    clientName: "Helper", verifiedHost: null, agent: "other", nameVerified: false, agentName: "an app that calls itself “Helper”",
    destination: { kind: "this-computer", port: 43117 },
  },
  unnamed: {
    clientName: null, verifiedHost: null, agent: "other", nameVerified: false, agentName: "an unnamed app",
    destination: { kind: "this-computer", port: 80 },
  },
} satisfies Record<string, ConsentView>;
const ok = (view: ConsentView): ConsentRequest => ({ ok: true, view });

// What the page sees for a request: the async component, awaited, then rendered.
type Page = (props: { params: Promise<object>; searchParams: Promise<SearchParams> }) => Promise<React.ReactNode>;
async function show(page: Page, searchParams: SearchParams) {
  render(await page({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }));
}

const space = (kind: "personal" | "team", role: Role): MySpace => ({ id: kind === "personal" ? "personal_u1" : "team_seattle_solvers", slug: "s", name: kind === "personal" ? "Personal" : "Seattle Solvers", kind, role });

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(requireUser).mockReset().mockResolvedValue(ada);
  vi.mocked(listMySpaces).mockReset().mockResolvedValue([space("personal", "admin"), space("team", "editor")]);
  vi.mocked(readConsentRequest).mockReset();
});

describe("the login page", () => {
  it("sends a signed-in member to the dashboard, and shows no Claude line", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(ada);
    await expect(show(LoginPage, {})).rejects.toMatchObject({ digest: expect.stringContaining("/dashboard") });
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await show(LoginPage, {});
    expect(screen.queryByText("Sign in to connect Claude.")).toBeNull();
  });

  it("keeps a signed-in member on the page while connecting Claude, and says so", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(ada);
    vi.mocked(readConsentRequest).mockResolvedValue(ok(views.claude));
    await show(LoginPage, signedRequest);
    expect(screen.getByText("Sign in to connect Claude.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(vi.mocked(readConsentRequest)).toHaveBeenCalledWith(expect.anything(), "test-secret", signedRequest);
  });

  it("says so when the connect request has expired or was changed", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(readConsentRequest).mockResolvedValue({ ok: false });
    await show(LoginPage, signedRequest);
    expect(screen.getByRole("alert").textContent).toBe("This connection request has expired. Go back to your AI agent and connect again.");
    // Said in the danger colour, with no pink box behind it.
    expect(screen.getByRole("alert").className.split(" ")).toContain("text-danger");
    expect(screen.getByRole("alert").className).not.toMatch(/\bbg-|\bborder\b/);
    expect(screen.queryByText("Sign in to connect Claude.")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeTruthy();
  });

  it("names the agent being connected", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(readConsentRequest).mockResolvedValue(ok(views.cursor));
    await show(LoginPage, signedRequest);
    expect(screen.getByText("Sign in to connect Cursor.")).toBeTruthy();
    expect(screen.queryByText("Sign in to connect Claude.")).toBeNull();
  });

  it("does not repeat a name an app gave itself", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    for (const view of [views.selfNamedClaudeCode, views.helper, views.unnamed]) {
      vi.mocked(readConsentRequest).mockResolvedValue(ok(view));
      await show(LoginPage, signedRequest);
      expect(screen.getByText(/^Sign in to connect/).textContent, view.agentName).toBe("Sign in to connect an AI agent.");
      cleanup();
    }
  });

  it("checks no connect request on a plain visit", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await show(LoginPage, {});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(vi.mocked(readConsentRequest)).not.toHaveBeenCalled();
  });
});

describe("the consent page", () => {
  const warning = () => screen.getByText(/^Only allow this if you just connected/).textContent;
  const THIS_COMPUTER = (port: number) =>
    `After you allow, you'll be sent back to a program on this computer (port ${port}). Only allow this if you just started connecting from an AI agent on this computer.`;

  it("tells an editor what Claude can do, names the host it trusts and says where the code goes", async () => {
    vi.mocked(readConsentRequest).mockResolvedValue(ok(views.claude));
    await show(ConsentPage, signedRequest);
    expect(screen.getByRole("heading").textContent).toBe("Connect Claude");
    expect(screen.getByText("Claude is asking to use EasyEdit as you.")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "It will be able to see the projects in your spaces.",
      "It will be able to create projects and change them. Each change is listed in the editor as “Claude (for Ada)” and can be undone there.",
    ]);
    expect(screen.getByText("Signed in as ada@gmail.com.")).toBeTruthy();
    expect(screen.getByText("The request comes from claude.ai.")).toBeTruthy();
    expect(screen.getByText("After you allow, you'll be sent back to claude.ai.")).toBeTruthy();
    expect(warning()).toBe(
      "Only allow this if you just connected EasyEdit in Claude yourself. If someone sent you a link to this page, choose Don't allow.",
    );
    expect(screen.getByText(/^Only allow this if you just connected/).className.split(" ")).toContain("text-danger");
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Don't allow" })).toBeTruthy();
    expect(vi.mocked(requireUser)).toHaveBeenCalledWith();
    expect(vi.mocked(readConsentRequest)).toHaveBeenCalledWith(expect.anything(), "test-secret", signedRequest);
  });

  it("offers the editor wording from a personal space alone, with no team role at all", async () => {
    vi.mocked(listMySpaces).mockResolvedValue([space("personal", "admin")]);
    vi.mocked(readConsentRequest).mockResolvedValue(ok(views.claude));
    await show(ConsentPage, signedRequest);
    expect(screen.getAllByRole("listitem")[1].textContent).toMatch(/^It will be able to create projects and change them/);
  });

  it("offers the editor wording to a team viewer, whose personal space is theirs to change", async () => {
    vi.mocked(listMySpaces).mockResolvedValue([space("personal", "admin"), space("team", "viewer")]);
    vi.mocked(readConsentRequest).mockResolvedValue(ok(views.claude));
    await show(ConsentPage, signedRequest);
    expect(screen.getAllByRole("listitem")[1].textContent).toMatch(/^It will be able to create projects and change them/);
  });

  it("tells someone in no team that the app cannot change anything, and does not vouch for a self-named app", async () => {
    vi.stubEnv("PERSONAL_SPACES", "");
    vi.mocked(listMySpaces).mockResolvedValue([space("personal", "admin")]);
    vi.mocked(readConsentRequest).mockResolvedValue(ok(views.helper));
    await show(ConsentPage, signedRequest);
    expect(screen.getByRole("heading").textContent).toBe("Connect an app");
    expect(screen.getByText("An app that calls itself “Helper” is asking to use EasyEdit as you.")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "It will be able to see the projects in your spaces.",
      "You're not in a team yet, so it will not be able to change anything.",
    ]);
    expect(screen.getByText("EasyEdit cannot confirm which app this is or who runs it.")).toBeTruthy();
    expect(screen.getByText(THIS_COMPUTER(43117))).toBeTruthy();
  });

  it("does not call an app Claude Code because it says so, and says the code stays on this computer", async () => {
    vi.mocked(readConsentRequest).mockResolvedValue(ok(views.selfNamedClaudeCode));
    await show(ConsentPage, signedRequest);
    expect(screen.getByRole("heading").textContent).toBe("Connect an app");
    expect(screen.getByText("An app that calls itself “Claude Code” is asking to use EasyEdit as you.")).toBeTruthy();
    expect(screen.getByText("EasyEdit cannot confirm which app this is or who runs it.")).toBeTruthy();
    expect(screen.getByText(THIS_COMPUTER(5555))).toBeTruthy();
    expect(warning()).toBe(
      "Only allow this if you just connected EasyEdit in an AI agent yourself. If someone sent you a link to this page, choose Don't allow.",
    );
    expect(document.body.textContent).not.toContain("Connect Claude Code");
    expect(document.body.textContent).not.toContain("in Claude Code yourself");
    // The editor lists its changes under the name it gave, and the page says so.
    expect(screen.getAllByRole("listitem")[1].textContent).toContain("listed in the editor as “Claude Code (for Ada)”");
  });

  it("names Claude Code from its metadata document, but does not let claude.ai vouch for a request on this computer", async () => {
    vi.mocked(readConsentRequest).mockResolvedValue(ok(views.claudeCode));
    await show(ConsentPage, signedRequest);
    expect(screen.getByRole("heading").textContent).toBe("Connect Claude Code");
    expect(screen.getByText("Claude Code is asking to use EasyEdit as you.")).toBeTruthy();
    expect(screen.getByText("The app's description is published on claude.ai, but any program on this computer can use it.")).toBeTruthy();
    expect(screen.queryByText(/comes from claude\.ai/)).toBeNull();
    expect(screen.getByText(THIS_COMPUTER(5555))).toBeTruthy();
    expect(warning()).toBe(
      "Only allow this if you just connected EasyEdit in Claude Code yourself. If someone sent you a link to this page, choose Don't allow.",
    );
  });

  it("names Cursor from its app address, sends the code to the Cursor app and lists changes under Cursor", async () => {
    vi.mocked(readConsentRequest).mockResolvedValue(ok(views.cursor));
    await show(ConsentPage, signedRequest);
    expect(screen.getByRole("heading").textContent).toBe("Connect Cursor");
    expect(screen.getByText("Cursor is asking to use EasyEdit as you.")).toBeTruthy();
    expect(screen.getAllByRole("listitem")[1].textContent).toBe(
      "It will be able to create projects and change them. Each change is listed in the editor as “Cursor (for Ada)” and can be undone there.",
    );
    expect(screen.getByText("After you allow, you'll be sent back to the Cursor app.")).toBeTruthy();
    expect(screen.queryByText(/cannot confirm/)).toBeNull();
    expect(screen.queryByText(/comes from/)).toBeNull();
    expect(warning()).toBe(
      "Only allow this if you just connected EasyEdit in Cursor yourself. If someone sent you a link to this page, choose Don't allow.",
    );
  });

  it("names ChatGPT from its callback and says the code goes back to chatgpt.com", async () => {
    vi.mocked(readConsentRequest).mockResolvedValue(ok(views.chatgpt));
    await show(ConsentPage, signedRequest);
    expect(screen.getByRole("heading").textContent).toBe("Connect ChatGPT");
    expect(screen.getByText("ChatGPT is asking to use EasyEdit as you.")).toBeTruthy();
    expect(screen.getByText("After you allow, you'll be sent back to chatgpt.com.")).toBeTruthy();
    expect(screen.getAllByRole("listitem")[1].textContent).toContain("listed in the editor as “ChatGPT (for Ada)”");
  });

  it("calls an app with no name an unnamed app, and lists its changes as AI agent", async () => {
    vi.mocked(readConsentRequest).mockResolvedValue(ok(views.unnamed));
    await show(ConsentPage, signedRequest);
    expect(screen.getByRole("heading").textContent).toBe("Connect an app");
    expect(screen.getByText("An unnamed app is asking to use EasyEdit as you.")).toBeTruthy();
    expect(screen.getAllByRole("listitem")[1].textContent).toContain("listed in the editor as “AI agent (for Ada)”");
    expect(screen.getByText(THIS_COMPUTER(80))).toBeTruthy();
    expect(warning()).toBe(
      "Only allow this if you just connected EasyEdit in an AI agent yourself. If someone sent you a link to this page, choose Don't allow.",
    );
  });

  it("shows only that the request has expired when it cannot be read", async () => {
    vi.mocked(readConsentRequest).mockResolvedValue({ ok: false });
    await show(ConsentPage, signedRequest);
    expect(document.body.textContent).toBe("This request has expired. Go back to your AI agent and connect again.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
