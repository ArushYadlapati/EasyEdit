// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import AgentsPage, { metadata } from "@/app/(dashboard)/agents/page";
import { AgentsView, type AgentsViewProps } from "@/app/(dashboard)/agents/agents-view";
import type { AgentActions, AgentConnection, AgentTokenSummary, CreateTokenResult } from "@/app/(dashboard)/agents/types";
import { AccountMenu } from "@/components/dashboard/account-menu";
import type { CurrentUser } from "@/lib/access-rules";
import type { Role } from "@/lib/allowlist/service";
import type { MySpace } from "@/lib/spaces/types";
import { AGENT_WORDS } from "@/lib/connector/agent-words";
import { AGENT_KINDS, AGENTS, OTHER_AGENTS, fillTemplate } from "@/lib/connector/agents";
import { SKILL_WORDS } from "@/lib/skills/words";
import { act, fireEvent, render, screen, within } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
// The account menu here is the one on the AI agents page, which has no Settings (that is on the space pages).
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/agents", unstable_rethrow: () => {} }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: vi.fn() } }));

// The page's server side, for the page test: who is signed in and what they have connected.
const server = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  spaces: [] as MySpace[], // the spaces they are in
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
vi.mock("@/lib/spaces/service", () => ({ listMySpaces: vi.fn(async () => server.spaces) }));
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
const panel = () => within(region("Connect an agent")).getByRole("tabpanel");
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

// The step's words as a person reads them, without the Copy button that sits beside the address.
const stepText = (li: HTMLElement) => {
  const copy = li.cloneNode(true) as HTMLElement;
  for (const b of copy.querySelectorAll("button, [role=status], a")) b.remove();
  return copy.textContent?.replace(/\s+/g, " ").trim();
};
const said = (step: string) => fillTemplate(step, { url: URL_ }).replace(/\s+/g, " ").replace(` ${URL_} `, ` ${URL_}`).replace(`: ${URL_}`, `:${URL_}`);

describe("connecting Claude or ChatGPT", () => {
  const choices = () => within(screen.getByRole("tablist", { name: "Agent to connect" })).getAllByRole("tab");
  const choice = (name: RegExp) => within(screen.getByRole("tablist", { name: "Agent to connect" })).getByRole("tab", { name });
  const steps = () => within(panel()).getAllByRole("listitem").filter((li) => li.parentElement?.tagName === "OL");

  it("offers the two as large choices, Claude picked first", () => {
    renderView({ connections: [], tokens: [] });
    expect(choices().map((t) => t.textContent)).toEqual(["ClaudeAnthropic", "ChatGPTOpenAI"]);
    expect(choice(/Claude/).getAttribute("aria-selected")).toBe("true");
    expect(panel().getAttribute("aria-labelledby")).toBe(choice(/Claude/).id);
  });

  it("Claude's steps link to its connector settings, put the address with its own Copy in the step, and end with what to ask", async () => {
    renderView({ connections: [], tokens: [] });
    const items = steps();
    expect(items).toHaveLength(AGENTS.claude.steps.length + 1);
    const settings = within(items[0]).getByRole("link", { name: /Open Claude's connector settings/ });
    expect(settings.getAttribute("href")).toBe("https://claude.ai/customize/connectors");
    expect(settings.getAttribute("target")).toBe("_blank");
    expect(settings.getAttribute("rel")).toContain("noopener");
    const address = within(items[1]).getByRole("group", { name: "EasyEdit's address" });
    expect(address.querySelector("code")?.textContent).toBe(URL_);
    await click(within(address).getByRole("button", { name: "Copy EasyEdit's address" }));
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(stepText(items[2])).toContain("Sign in with the Google account you use for EasyEdit");
    const last = items[items.length - 1];
    expect(last.textContent).toContain("Then ask it, for example:");
    const asks = within(last).getAllByRole("listitem");
    expect(asks.map((li) => li.querySelector("q")?.textContent)).toEqual([...AGENT_WORDS.asks]);
    await click(within(last).getByRole("button", { name: "Copy example 1" }));
    expect(writeText).toHaveBeenLastCalledWith(AGENT_WORDS.asks[0]);
  });

  it("ChatGPT shows its own steps, with its plugins page and the address filled in", async () => {
    renderView({ connections: [], tokens: [] });
    await click(choice(/ChatGPT/));
    expect(choice(/ChatGPT/).getAttribute("aria-selected")).toBe("true");
    const items = steps();
    expect(within(items[0]).getByRole("link", { name: /Open ChatGPT's plugins page/ }).getAttribute("href")).toBe("https://chatgpt.com/plugins");
    expect(within(items[1]).getByRole("group", { name: "EasyEdit's address" }).textContent).toContain(URL_);
    expect(panel().textContent).not.toContain("{url}");
    expect(panel().textContent).toContain("Developer mode");
  });

  it("the arrow keys move between the two", async () => {
    renderView();
    await act(async () => {
      fireEvent.keyDown(choice(/Claude/), { key: "ArrowRight" });
    });
    expect(choice(/ChatGPT/).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(choice(/ChatGPT/));
    await act(async () => {
      fireEvent.keyDown(choice(/ChatGPT/), { key: "ArrowRight" });
    });
    expect(choice(/Claude/).getAttribute("aria-selected")).toBe("true");
  });

  it("marks an agent that is already connected", () => {
    renderView();
    expect(choice(/Claude/).textContent).toContain("Connected");
    expect(choice(/ChatGPT/).textContent).not.toContain("Connected");
  });

  it("says what an agent can and can't do here", () => {
    renderView();
    const box = region("What an agent can do here");
    const lines = within(box).getAllByRole("listitem").map((li) => li.textContent);
    expect(lines).toEqual([...AGENT_WORDS.canDo]);
    expect(lines.join(" ")).toContain("Activity");
    expect(lines.join(" ")).toContain("can't delete projects");
  });

  it("no agent's steps name a team Google account", () => {
    for (const kind of AGENT_KINDS) expect(AGENTS[kind].steps.join(" ")).not.toMatch(/team Google/);
  });
});

describe("setting up another agent", () => {
  it("lists every other agent behind the disclosure, without Claude and ChatGPT", () => {
    renderView();
    const summary = screen.getByText("Other agents and developer tools");
    expect(summary.closest("details")).toBeTruthy();
    const tabs = within(region("Set up another agent")).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(OTHER_AGENTS.map((k) => AGENTS[k].name));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("Claude Code shows its steps with the address in place", () => {
    renderView();
    const setup = region("Set up another agent");
    const items = within(within(setup).getByRole("tabpanel")).getAllByRole("listitem");
    expect(items.map(stepText)).toEqual(AGENTS["claude-code"].steps.map(said));
  });

  it("the arrow keys move between agents", async () => {
    renderView();
    await act(async () => {
      fireEvent.keyDown(tab("Claude Code"), { key: "ArrowDown" });
    });
    expect(tab("Cursor").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Cursor"));
    await act(async () => {
      fireEvent.keyDown(tab("Cursor"), { key: "End" });
    });
    expect(tab("Another agent").getAttribute("aria-selected")).toBe("true");
  });

  it("Cursor shows its snippet, which copies, and points to access tokens", async () => {
    renderView();
    await click(tab("Cursor"));
    const setupPanel = within(region("Set up another agent")).getByRole("tabpanel");
    const code = within(setupPanel).getByText(/mcpServers/);
    expect(code.textContent).toBe(fillTemplate(AGENTS.cursor.snippet!.code, { url: URL_ }));
    expect(within(setupPanel).getByText(AGENTS.cursor.snippet!.label)).toBeTruthy();
    const copy = button("Copy setup snippet", setupPanel);
    await click(copy);
    expect(writeText).toHaveBeenCalledWith(code.textContent);
    expect(copy.textContent).toBe("Copied");
    const hint = within(setupPanel).getByRole("link", { name: "make one under Access tokens" });
    expect(hint.getAttribute("href")).toBe("#access-tokens");
    expect(region("Access tokens").id).toBe("access-tokens");
  });

  it("the OpenAI API needs a token, and its snippet waits for one", async () => {
    renderView();
    await click(tab("OpenAI API"));
    const setupPanel = within(region("Set up another agent")).getByRole("tabpanel");
    expect(within(setupPanel).getByText(/This agent needs an access token/)).toBeTruthy();
    expect(within(setupPanel).getByText(/"authorization": "<your access token>"/)).toBeTruthy();
  });
});

describe("video skills", () => {
  it("come after the other agents' steps, say connected agents already have them, and give three other ways in", () => {
    renderView();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Connect an agent", "What an agent can do here", "Connected agents", "Server address", "Set up another agent", "Video skills", "Access tokens"]);
    const section = region("Video skills");
    expect(within(section).getByText(SKILL_WORDS.intro)).toBeTruthy();
    expect(within(section).getByText("Agents you connect here already have them. You can also add them yourself:")).toBeTruthy();
    const ways = within(section).getByRole("list", { name: "Other ways to add them" });
    expect(within(ways).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Claude Code",
      "Codex, Cursor, Gemini CLI and Copilot",
      "Claude on the web",
    ]);
    expect(within(ways).getByText("Upload the same file under Settings → Capabilities → Skills.")).toBeTruthy();
    // No words an agent's maker would use and a person wouldn't, outside the commands people type.
    const words = section.cloneNode(true) as HTMLElement;
    for (const code of words.querySelectorAll("code")) code.remove();
    expect(words.textContent).not.toMatch(/\b(MCP|oEmbed|JSON|token)\b/i);
  });

  it("Claude Code gets the two plugin commands, each shown whole and copied on its own", async () => {
    renderView();
    const section = region("Video skills");
    // Shown as text that wraps, not in a one-line box that a phone cuts off.
    const command = (name: string) => within(section).getByRole("group", { name }).querySelector("code");
    expect([command("First command")?.textContent, command("Second command")?.textContent]).toEqual([
      "/plugin marketplace add ArushYadlapati/EasyEdit",
      "/plugin install easyedit@easyedit",
    ]);
    expect(within(section).queryByRole("textbox")).toBeNull();
    await click(button("Copy the first command", section));
    expect(writeText).toHaveBeenLastCalledWith("/plugin marketplace add ArushYadlapati/EasyEdit");
    await click(button("Copy the second command", section));
    expect(writeText).toHaveBeenLastCalledWith("/plugin install easyedit@easyedit");
    expect(button("Copy the second command", section).textContent).toBe("Copied");
  });

  it("Claude Code is told to sign in after the commands, and to skip them when it is already connected", () => {
    renderView();
    const section = region("Video skills");
    const paragraph = (text: string) => within(section).getByText((_, el) => el?.tagName === "P" && el.textContent === text);
    expect(within(section).queryByText(/in one go/)).toBeNull();
    // The plugin's connection has no tools until it is signed in.
    const signIn = paragraph("Then run /mcp in Claude Code, pick easyedit, choose Authenticate and sign in.");
    expect(signIn.querySelector("code")?.textContent).toBe("/mcp");
    // Someone set up with claude mcp add would otherwise get EasyEdit twice, with every tool listed twice.
    const already = paragraph(
      "Already connected Claude Code with the steps above? Then it has the skills, so you can skip this. To use the plugin instead, first run claude mcp remove easyedit in a terminal.",
    );
    expect(already.querySelector("code")?.textContent).toBe("claude mcp remove easyedit");
    // Both come after the two commands.
    const second = within(section).getByRole("group", { name: "Second command" });
    expect(second.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(signIn.compareDocumentPosition(already) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("other agents download the zip and unzip it into their skills folder", () => {
    renderView();
    const section = region("Video skills");
    expect(within(section).getByText((_, el) => el?.tagName === "P" && el.textContent === "Download the skill and unzip it into ~/.agents/skills.")).toBeTruthy();
    const download = within(section).getByRole("link", { name: "Download easyedit-video.zip" });
    expect(download.getAttribute("href")).toBe("/skills/easyedit-video.zip");
    expect(download.getAttribute("download")).toBe("easyedit-video.zip");
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
  it("lists each signed-in agent and each token something has used, with their dates", () => {
    renderView();
    const list = screen.getByRole("list", { name: "Connected agents" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Claude");
    expect(rows[0].textContent).toContain("Connected Nov 5, 2026");
    // The client's own name shows only when it says more than the agent's.
    expect(rows[0].textContent).not.toContain("ClaudeClaude");
    expect(rows[1].textContent).toContain("Cursor Desktop");
    expect(rows[2].textContent).toContain("Codex at home");
    expect(rows[2].textContent).toContain("Last used Nov 10, 2026");
    expect(list.textContent).not.toContain("Laptop script");
    expect(button("Disconnect Claude")).toBeTruthy();
    expect(button("Disconnect Cursor (Cursor Desktop)")).toBeTruthy();
  });

  it("lists a token nothing has used yet with the access tokens, not as a connected agent", () => {
    renderView();
    const unused = within(region("Access tokens")).getByRole("list", { name: "Not used yet" });
    const rows = within(unused).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Laptop script");
    expect(rows[0].textContent).toContain("OpenAI API");
    expect(rows[0].textContent).toContain("…x9Qa");
    expect(rows[0].textContent).toContain("Created Nov 1, 2026");
    expect(rows[0].textContent).toContain("Never used");
    expect(button("Revoke Laptop script")).toBeTruthy();
  });

  it("says so when an agent connects while the page is open", () => {
    const { rerender, actions } = renderView({ connections: [] });
    expect(screen.queryByText(/is connected\. Go back/)).toBeNull();
    rerender(<AgentsView serverUrl={URL_} connections={CONNECTIONS.slice(0, 1)} tokens={TOKENS} nameLimit={60} now={NOW} actions={actions} />);
    expect(screen.getByText("Claude is connected. Go back to Claude and ask it to make something.").getAttribute("role")).toBe("status");
  });

  it("reads the page again when the person comes back to the tab", async () => {
    router.refresh.mockClear();
    renderView();
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Both fire on coming back; one refresh is enough.
    expect(router.refresh).toHaveBeenCalledTimes(1);
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
    // The first of the other agents, Claude Code, takes a token, so the form starts on it.
    expect(agentSelect().value).toBe("claude-code");
    await click(tab("Cursor"));
    expect(agentSelect().value).toBe("cursor");
    await click(tab("OpenAI API"));
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
  const space = (kind: "personal" | "team", role: Role): MySpace => ({ id: kind === "personal" ? "personal_u1" : "team_seattle_solvers", slug: "s", name: kind === "personal" ? "Personal" : "Seattle Solvers", kind, role });
  const editor: CurrentUser = { id: "u1", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "editor" };

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
    server.spaces = [space("personal", "admin"), space("team", "editor")];
    render(await AgentsPage());
    expect(screen.getByRole("heading", { level: 1, name: "AI agents" })).toBeTruthy();
    expect(screen.getByText(AGENT_WORDS.intro)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/speaks MCP/);
    expect((screen.getByRole("textbox", { name: "Server address" }) as HTMLInputElement).value).toBe(URL_);
    expect(within(screen.getByRole("list", { name: "Connected agents" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Projects" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByText(/not in a team yet/)).toBeNull();
    const { listAgentConnections } = await import("@/lib/connector/connections");
    expect(listAgentConnections).toHaveBeenCalledWith(expect.anything(), "u1");
  });

  it("tells someone in no team, while personal spaces are closed, that their agents can't change anything", async () => {
    vi.stubEnv("PERSONAL_SPACES", "");
    server.spaces = [space("personal", "admin")];
    render(await AgentsPage());
    expect(screen.getByText("You're not in a team yet, so your agents can't create or change anything.")).toBeTruthy();
    expect(screen.queryByText(/viewer/)).toBeNull();
  });

  it("says nothing of the kind once personal spaces are offered", async () => {
    server.spaces = [space("personal", "admin")];
    render(await AgentsPage());
    expect(screen.queryByText(/not in a team yet/)).toBeNull();
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
