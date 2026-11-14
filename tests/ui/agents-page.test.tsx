// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import AgentsPage, { metadata } from "@/app/(dashboard)/agents/page";
import { AgentsView, type AgentsViewProps } from "@/app/(dashboard)/agents/agents-view";
import type { AgentActions, AgentConnection, AgentTokenSummary, CreateTokenResult } from "@/app/(dashboard)/agents/types";
import { AccountMenu } from "@/components/dashboard/account-menu";
import type { CurrentUser } from "@/lib/access-rules";
import { AGENT_KINDS, AGENTS, fillTemplate } from "@/lib/connector/agents";
import { act, fireEvent, render, screen, within } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, unstable_rethrow: () => {} }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: vi.fn() } }));

// The page's server side, for the page test: who is signed in and what they have connected.
const server = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  connections: [] as AgentConnection[],
  tokens: [] as AgentTokenSummary[],
}));
vi.mock("@/lib/access", async () => ({
  requireUser: vi.fn(async () => server.user!),
  meetsRole: (await import("@/lib/access-rules")).meetsRole,
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/connector/connections", () => ({ listAgentConnections: vi.fn(async () => server.connections) }));
vi.mock("@/lib/connector/tokens", () => ({ MAX_TOKEN_NAME: 60, listAgentTokens: vi.fn(async () => server.tokens) }));
vi.mock("@/app/(dashboard)/agents/actions", () => ({
  disconnectAgentAction: vi.fn(),
  createTokenAction: vi.fn(),
  revokeTokenAction: vi.fn(),
}));

const URL_ = "https://easyedit.test/api/mcp";
const NOW = new Date("2026-11-13T12:00:00Z");

const CONNECTIONS: AgentConnection[] = [
  { clientId: "https://claude.ai/oauth/c.json", clientName: "Claude", agent: "claude", connectedAt: new Date("2026-11-05T12:00:00Z") },
  { clientId: "cursor-1", clientName: "Cursor Desktop", agent: "cursor", connectedAt: new Date("2026-11-03T12:00:00Z") },
];
const TOKENS: AgentTokenSummary[] = [
  {
    id: "t1", name: "Laptop script", agent: "openai-api", preview: "x9Qa",
    createdAt: new Date("2026-11-01T12:00:00Z"), lastUsedAt: null, expiresAt: null,
  },
  {
    id: "t2", name: "Codex at home", agent: "codex", preview: "ab12",
    createdAt: new Date("2026-10-20T12:00:00Z"), lastUsedAt: new Date("2026-11-10T12:00:00Z"), expiresAt: null,
  },
];

type MockActions = { [K in keyof AgentActions]: Mock<AgentActions[K]> };

function makeActions(): MockActions {
  return {
    disconnect: vi.fn(async () => ({})),
    createToken: vi.fn(async (): Promise<CreateTokenResult> => ({ token: "ee_at_SECRET123" })),
    revokeToken: vi.fn(async () => ({})),
  };
}

function renderView(over: Partial<AgentsViewProps> = {}) {
  const actions = makeActions();
  const props: AgentsViewProps = {
    serverUrl: URL_, connections: CONNECTIONS, tokens: TOKENS, nameLimit: 60, now: NOW, actions, ...over,
  };
  return { actions, ...render(<AgentsView {...props} />) };
}

const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
beforeEach(() => {
  router.push.mockClear();
  writeText.mockClear();
  writeText.mockImplementation(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
});

const tab = (name: string | RegExp) => screen.getByRole("tab", { name });
const panel = () => screen.getByRole("tabpanel");
const region = (name: string) => screen.getByRole("region", { name });
const button = (name: string, inside: HTMLElement = document.body) => within(inside).getByRole("button", { name }) as HTMLButtonElement;
const dialog = (name: string) => screen.getByRole("dialog", { name });

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function makeToken(name: string) {
  const form = screen.getByRole("form", { name: "Make an access token" });
  fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: name } });
  await act(async () => {
    fireEvent.submit(form);
  });
}

describe("setting up an agent", () => {
  it("lists every agent in order, with Claude first, picked and marked Recommended", () => {
    renderView();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(AGENT_KINDS.map((k) => (k === "claude" ? "Claude Recommended" : AGENTS[k].name)));
    expect(tab("Claude Recommended").getAttribute("aria-selected")).toBe("true");
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(panel().getAttribute("aria-labelledby")).toBe(tab("Claude Recommended").id);
    expect(within(panel()).getByRole("heading", { name: "Claude" })).toBeTruthy();
    const steps = within(panel()).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual(AGENTS.claude.steps.map((s) => s.replace("{url}", URL_)));
    // Claude only signs in, so there is no snippet and no token hint.
    expect(within(panel()).queryByRole("figure")).toBeNull();
    expect(within(panel()).queryByRole("link")).toBeNull();
  });

  it("ChatGPT shows its own steps with the server address filled in", async () => {
    renderView();
    await click(tab("ChatGPT"));
    expect(tab("ChatGPT").getAttribute("aria-selected")).toBe("true");
    expect(tab("Claude Recommended").getAttribute("aria-selected")).toBe("false");
    const steps = within(panel()).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual(AGENTS.chatgpt.steps.map((step) => fillTemplate(step, { url: URL_ })));
    expect(steps.some((step) => step?.includes(URL_))).toBe(true);
    expect(steps.join(" ")).not.toContain("{url}");
  });

  it("the arrow keys move between agents", async () => {
    renderView();
    await act(async () => {
      fireEvent.keyDown(tab("Claude Recommended"), { key: "ArrowDown" });
    });
    expect(tab("ChatGPT").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("ChatGPT"));
    await act(async () => {
      fireEvent.keyDown(tab("ChatGPT"), { key: "End" });
    });
    expect(tab("Another agent").getAttribute("aria-selected")).toBe("true");
  });

  it("Cursor shows its snippet, which copies, and points to access tokens", async () => {
    renderView();
    await click(tab("Cursor"));
    const code = within(panel()).getByText(/mcpServers/);
    expect(code.textContent).toBe(fillTemplate(AGENTS.cursor.snippet!.code, { url: URL_ }));
    expect(code.textContent).toContain(URL_);
    expect(within(panel()).getByText(AGENTS.cursor.snippet!.label)).toBeTruthy();
    const copy = button("Copy setup snippet", panel());
    await click(copy);
    expect(writeText).toHaveBeenCalledWith(code.textContent);
    expect(copy.textContent).toBe("Copied");
    const hint = within(panel()).getByRole("link", { name: "make one under Access tokens" });
    expect(hint.getAttribute("href")).toBe("#access-tokens");
    expect(region("Access tokens").id).toBe("access-tokens");
  });

  it("the OpenAI API needs a token, and its snippet waits for one", async () => {
    renderView();
    await click(tab("OpenAI API"));
    expect(within(panel()).getByText(/This agent needs an access token/)).toBeTruthy();
    expect(within(panel()).getByText(/"authorization": "<your access token>"/)).toBeTruthy();
  });
});

describe("the server address", () => {
  it("is shown read-only and copies, saying Copied for a moment", async () => {
    vi.useFakeTimers();
    renderView();
    const field = screen.getByRole("textbox", { name: "Server address" }) as HTMLInputElement;
    expect(field.value).toBe(URL_);
    expect(field.readOnly).toBe(true);
    const copy = button("Copy server address");
    await click(copy);
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(copy.textContent).toBe("Copied");
    expect(within(region("Server address")).getByRole("status").textContent).toBe("Copied");
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(copy.textContent).toBe("Copy");
  });

  it("says so when the browser will not copy", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    renderView();
    const copy = button("Copy server address");
    await click(copy);
    expect(copy.textContent).toBe("Couldn't copy");
  });
});

describe("connected agents", () => {
  it("lists each signed-in agent and each token, with their dates", () => {
    renderView();
    const list = screen.getByRole("list", { name: "Connected agents" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain("Claude");
    expect(rows[0].textContent).toContain("Connected Nov 5, 2026");
    // The client's own name shows only when it says more than the agent's.
    expect(rows[0].textContent).not.toContain("ClaudeClaude");
    expect(rows[1].textContent).toContain("Cursor Desktop");
    expect(rows[2].textContent).toContain("Laptop script");
    expect(rows[2].textContent).toContain("OpenAI API");
    expect(rows[2].textContent).toContain("…x9Qa");
    expect(rows[2].textContent).toContain("Created Nov 1, 2026");
    expect(rows[2].textContent).toContain("Never used");
    expect(rows[3].textContent).toContain("Last used Nov 10, 2026");
    expect(button("Disconnect Claude")).toBeTruthy();
    expect(button("Disconnect Cursor (Cursor Desktop)")).toBeTruthy();
    expect(button("Revoke Laptop script")).toBeTruthy();
  });

  it("says when nothing is connected", () => {
    renderView({ connections: [], tokens: [] });
    expect(within(region("Connected agents")).getByText("No agents connected yet.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Connected agents" })).toBeNull();
  });

  it("Disconnect asks first, and Cancel leaves the agent connected", async () => {
    const { actions } = renderView();
    await click(button("Disconnect Cursor (Cursor Desktop)"));
    const asking = dialog("Disconnect agent");
    expect(asking.textContent).toContain("Disconnect Cursor (Cursor Desktop)?");
    expect(actions.disconnect).not.toHaveBeenCalled();
    await click(button("Cancel", asking));
    expect(actions.disconnect).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Disconnect agent" })).toBeNull();
  });

  it("Disconnect sends the client after the confirm, and closes", async () => {
    const { actions } = renderView();
    await click(button("Disconnect Cursor (Cursor Desktop)"));
    await click(button("Disconnect", dialog("Disconnect agent")));
    expect(actions.disconnect).toHaveBeenCalledTimes(1);
    expect(actions.disconnect).toHaveBeenCalledWith("cursor-1");
    expect(screen.queryByRole("dialog", { name: "Disconnect agent" })).toBeNull();
  });

  it("Revoke sends the token's id after the confirm; a refusal stays in the dialog", async () => {
    const { actions } = renderView();
    actions.revokeToken.mockResolvedValueOnce({ error: "Try again later." });
    await click(button("Revoke Laptop script"));
    const asking = dialog("Revoke token");
    expect(asking.textContent).toContain('Revoke the token "Laptop script"?');
    await click(button("Revoke", asking));
    expect(actions.revokeToken).toHaveBeenCalledWith("t1");
    expect(within(dialog("Revoke token")).getByRole("alert").textContent).toBe("Try again later.");
    await click(button("Revoke", dialog("Revoke token")));
    expect(actions.revokeToken).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog", { name: "Revoke token" })).toBeNull();
  });
});

describe("access tokens", () => {
  const agentSelect = () => within(region("Access tokens")).getByRole("combobox", { name: "Agent" }) as HTMLSelectElement;

  it("offers only agents that take a token, and follows the agent picked above", async () => {
    renderView();
    const options = [...agentSelect().options].map((o) => o.textContent);
    expect(options).toEqual(AGENT_KINDS.filter((k) => AGENTS[k].methods.includes("token")).map((k) => AGENTS[k].name));
    expect(options).not.toContain("Claude");
    expect(options).toContain("OpenAI API");
    // Claude signs in, so the form starts on the OpenAI API.
    expect(agentSelect().value).toBe("openai-api");
    await click(tab("Cursor"));
    expect(agentSelect().value).toBe("cursor");
    await click(tab("ChatGPT"));
    expect(agentSelect().value).toBe("openai-api");
    const name = within(region("Access tokens")).getByRole("textbox", { name: "Name" }) as HTMLInputElement;
    expect(name.maxLength).toBe(60);
  });

  it("makes tokens that last 90 days unless the member picks another length", async () => {
    const { actions } = renderView();
    const tokens = region("Access tokens");
    const lasts = within(tokens).getByRole("combobox", { name: "Lasts" }) as HTMLSelectElement;
    expect(lasts.value).toBe("90");
    expect([...lasts.options].map((o) => o.textContent)).toEqual(["30 days", "90 days", "1 year", "No end date"]);
    fireEvent.change(lasts, { target: { value: "never" } });
    await makeToken("Forever bot");
    expect(actions.createToken).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Forever bot", expiresInDays: null }));
  });

  it("shows a made token once, with the warning and the agent's snippet filled in", async () => {
    const { actions } = renderView();
    await click(tab("OpenAI API"));
    await makeToken("Responses bot");
    expect(actions.createToken).toHaveBeenCalledWith({ name: "Responses bot", agent: "openai-api", expiresInDays: 90 });
    const tokens = region("Access tokens");
    expect(within(tokens).getByText("Copy it now — you won't see it again.")).toBeTruthy();
    const field = within(tokens).getByRole("textbox", { name: "Access token for OpenAI API" }) as HTMLInputElement;
    expect(field.value).toBe("ee_at_SECRET123");
    expect(field.readOnly).toBe(true);
    expect(within(tokens).getByText(/"authorization": "ee_at_SECRET123"/).textContent).toContain(`"server_url": "${URL_}"`);
    // The name field is cleared for the next one.
    expect((within(tokens).getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("");
    await click(button("Copy token", tokens));
    expect(writeText).toHaveBeenCalledWith("ee_at_SECRET123");
    await click(button("Done", tokens));
    expect(screen.queryByDisplayValue("ee_at_SECRET123")).toBeNull();
    expect(document.body.textContent).not.toContain("ee_at_SECRET123");
  });

  it("for an agent with a token setup, puts the token in that agent's own config", async () => {
    renderView();
    await click(tab("Cursor"));
    await makeToken("Cursor on my laptop");
    const tokens = region("Access tokens");
    const config = within(tokens).getByText(/mcpServers/).textContent ?? "";
    expect(config).toContain('"Authorization": "Bearer ee_at_SECRET123"');
    expect(config).toContain(`"url": "${URL_}"`);
    // No separate header block: the config already sends it.
    expect(within(tokens).queryByText("Authorization: Bearer ee_at_SECRET123")).toBeNull();
  });

  it("for an agent with no token setup, gives the header to send", async () => {
    renderView();
    await click(tab("Another agent"));
    await makeToken("My script");
    const tokens = region("Access tokens");
    expect(within(tokens).getByText("Authorization: Bearer ee_at_SECRET123")).toBeTruthy();
  });

  it("a refused token says why and shows no token", async () => {
    const { actions } = renderView();
    actions.createToken.mockResolvedValueOnce({ error: "Give the token a name, so you can tell it apart later." });
    await makeToken("");
    const tokens = region("Access tokens");
    expect(within(tokens).getByRole("alert").textContent).toBe("Give the token a name, so you can tell it apart later.");
    expect(within(tokens).queryByText("Copy it now — you won't see it again.")).toBeNull();
  });

  it("a failed request says to try again", async () => {
    const { actions } = renderView();
    actions.createToken.mockRejectedValueOnce(new Error("network"));
    await makeToken("Script");
    expect(within(region("Access tokens")).getByRole("alert").textContent).toBe("Something went wrong. Try again.");
  });
});

describe("the AI agents page", () => {
  const editor: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, role: "editor" };
  const viewer: CurrentUser = { ...editor, id: "u2", role: "viewer" };

  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_URL", "https://easyedit.test/");
    server.connections = CONNECTIONS;
    server.tokens = TOKENS;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is titled AI agents and shows the member's own server address and connections", async () => {
    expect(metadata.title).toBe("AI agents");
    server.user = editor;
    render(await AgentsPage());
    expect(screen.getByRole("heading", { level: 1, name: "AI agents" })).toBeTruthy();
    expect(screen.getByText(/each one acts as you and its changes are labeled with its name/)).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Server address" }) as HTMLInputElement).value).toBe(URL_);
    expect(within(screen.getByRole("list", { name: "Connected agents" })).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByRole("link", { name: "Projects" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByText(/You're a viewer/)).toBeNull();
    const { listAgentConnections } = await import("@/lib/connector/connections");
    expect(listAgentConnections).toHaveBeenCalledWith(expect.anything(), "u1");
  });

  it("tells a viewer their agents are read-only", async () => {
    server.user = viewer;
    render(await AgentsPage());
    expect(screen.getByText("You're a viewer, so your agents can read projects but not change them.")).toBeTruthy();
  });
});

describe("the account menu", () => {
  it("AI agents opens the AI agents page, above Sign out", async () => {
    render(<AccountMenu name="Ada" image={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Passkeys", "AI agents", "Sign out"]);
    await click(screen.getByRole("menuitem", { name: "AI agents" }));
    expect(router.push).toHaveBeenCalledWith("/agents");
  });
});
