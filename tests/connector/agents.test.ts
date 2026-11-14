import { describe, expect, it } from "vitest";
import {
  AGENT_KINDS, AGENTS, PRIMARY_AGENT, agentForRedirect, agentName, fillTemplate, guessAgentKind, isAgentKind,
  isAllowedClientDocument, isAllowedRedirect, isLoopbackRedirect,
} from "@/lib/connector/agents";
import { actorUserId, agentActorId, displayActor, isAgentActor, parseAgentActor } from "@/lib/projects/display-actor";

describe("the agent registry", () => {
  it("lists Claude first and makes it the primary agent", () => {
    expect(AGENT_KINDS[0]).toBe("claude");
    expect(PRIMARY_AGENT).toBe("claude");
    for (const kind of AGENT_KINDS) expect(AGENTS[kind].kind).toBe(kind);
    expect(agentName("claude")).toBe("Claude");
    expect(agentName("chatgpt")).toBe("ChatGPT");
  });

  it("knows its own kinds and nothing else", () => {
    expect(isAgentKind("cursor")).toBe(true);
    for (const value of ["Cursor", "", "agent", 7, null, undefined]) expect(isAgentKind(value), String(value)).toBe(false);
  });

  it("fills the server address and token into steps and snippets", () => {
    expect(fillTemplate("{url} {url} {token}", { url: "https://e.test/api/mcp", token: "t" })).toBe("https://e.test/api/mcp https://e.test/api/mcp t");
    expect(fillTemplate("{token}", { url: "u" })).toBe("<your access token>");
  });
});

describe("redirect addresses", () => {
  it("allows each known agent's exact callback", () => {
    for (const uri of [
      "https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback",
      "https://chatgpt.com/connector_platform_oauth_redirect", "https://platform.openai.com/apps-manage/oauth",
      "https://vscode.dev/redirect", "https://insiders.vscode.dev/redirect",
    ]) expect(isAllowedRedirect(uri), uri).toBe(true);
    expect(agentForRedirect("https://claude.ai/api/mcp/auth_callback")).toBe("claude");
    expect(agentForRedirect("https://chatgpt.com/connector_platform_oauth_redirect")).toBe("chatgpt");
    expect(agentForRedirect("https://vscode.dev/redirect")).toBe("vscode");
  });

  it("refuses anything but the exact callback", () => {
    for (const uri of [
      "https://claude.ai/api/mcp/auth_callback/", "https://claude.ai/api/mcp/auth_callback?x=1", "http://claude.ai/api/mcp/auth_callback",
      "https://claude.ai.evil.example/api/mcp/auth_callback", "https://evil.com/cb", "https://evil.example/api/mcp/auth_callback",
      "HTTPS://claude.ai/api/mcp/auth_callback", "https://chatgpt.com/connector_platform_oauth_redirect/../evil",
    ]) expect(isAllowedRedirect(uri), uri).toBe(false);
    expect(agentForRedirect("https://evil.com/cb")).toBeNull();
  });

  it("allows http loopback addresses on any port and path, without a query", () => {
    for (const uri of [
      "http://127.0.0.1:5555/callback", "http://localhost:33418", "http://localhost", "http://127.0.0.1", "http://[::1]:8080/cb",
      "http://localhost:6274/oauth/callback", "http://127.0.0.1:1455/callback/abc123def456", "http://127.0.0.1:33418/",
    ]) {
      expect(isLoopbackRedirect(uri), uri).toBe(true);
      expect(isAllowedRedirect(uri), uri).toBe(true);
    }
    // Loopback addresses belong to no single agent.
    expect(agentForRedirect("http://127.0.0.1:5555/callback")).toBeNull();
  });

  it("refuses look-alike and non-http loopback addresses", () => {
    for (const uri of [
      "https://127.0.0.1/cb", "https://localhost:3000/cb", "http://127.0.0.1.evil.com/cb", "http://localhost.evil.com/cb",
      "http://localhost./cb", "http://evil.com@127.0.0.1/cb", "http://user:pw@localhost/cb", "http://127.0.0.1/cb#frag",
      "http://127.0.0.1:5555/cb?next=https://evil.example/", "http://localhost/cb?x=1",
      "http://127.0.0.2/cb", "http://0.0.0.0/cb", "ws://localhost/cb", "not a url", "",
    ]) expect(isAllowedRedirect(uri), uri).toBe(false);
  });

  it("allows Cursor's own callbacks and ChatGPT's per-connection ones", () => {
    for (const [uri, kind] of [
      ["cursor://anysphere.cursor-mcp/oauth/callback", "cursor"],
      ["https://www.cursor.com/agents/mcp/oauth/callback", "cursor"],
      ["https://chatgpt.com/connector/oauth/abc123", "chatgpt"],
    ] as const) {
      expect(isAllowedRedirect(uri), uri).toBe(true);
      expect(agentForRedirect(uri), uri).toBe(kind);
    }
  });

  it("refuses script schemes, and app schemes beyond the exact callbacks", () => {
    for (const uri of [
      "javascript:alert(1)", "javascript://anysphere.x/%0aalert(1)", "data:text/html,hi", "cursor://evil.example/cb",
      "cursor://anysphere.cursor-retrieval/oauth/x/callback", "cursor://anysphere.cursor-mcp/oauth/callback/",
      "vscode://vscode.github-authentication/did-authenticate", "vscode-insiders://anything/cb", "vscode:/no-authority",
      "myapp://callback", "https://chatgpt.com.evil.example/connector/oauth/abc123", "http://chatgpt.com/connector/oauth/abc123",
      "https://chatgpt.com/connector/oauth/", "https://chatgpt.com/connector/oauth/abc/def", "https://chatgpt.com/connector/oauth/abc?x=1",
      "https://chatgpt.com/connector/oauth/a.b", `https://chatgpt.com/connector/oauth/${"a".repeat(129)}`,
    ]) expect(isAllowedRedirect(uri), uri).toBe(false);
    expect(isAllowedRedirect(`https://chatgpt.com/connector/oauth/${"a".repeat(128)}`)).toBe(true);
  });
});

describe("client metadata documents", () => {
  it("are read only over https from a known host, with no port or credentials", () => {
    for (const url of [
      "https://claude.ai/oauth/client.json", "https://CLAUDE.com/x", "https://chatgpt.com/oauth/client.json",
      "https://chatgpt.com/oauth/codex/client.json", "https://vscode.dev/oauth/client-metadata.json", "https://zed.dev/x",
      "https://goose-docs.ai/x",
    ]) expect(isAllowedClientDocument(url), url).toBe(true);
    for (const url of [
      "http://claude.ai/x", "https://claude.ai:8443/x", "https://claude.ai:443x/x", "https://claude.ai@evil.example/x",
      "https://user:pw@claude.ai/x", "https://claude.ai.evil.example/x", "https://sub.claude.ai/x", "https://evil.com/client.json",
      "https://evil.example/claude.ai", "https://openai.com/x", "https://platform.openai.com/x", "https://cursor.com/x", "not a url", "",
    ]) expect(isAllowedClientDocument(url), url).toBe(false);
  });
});

describe("guessAgentKind", () => {
  it("goes by a known redirect address first", () => {
    expect(guessAgentKind({ redirectUris: ["https://claude.ai/api/mcp/auth_callback"], name: "Cursor" })).toBe("claude");
    expect(guessAgentKind({ redirectUris: ["http://127.0.0.1:33418", "https://vscode.dev/redirect"] })).toBe("vscode");
    expect(guessAgentKind({ redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"] })).toBe("chatgpt");
    expect(guessAgentKind({ redirectUris: ["cursor://anysphere.cursor-mcp/oauth/callback"] })).toBe("cursor");
  });

  it("then by the address of its metadata document, before the name it gave", () => {
    expect(guessAgentKind({ clientId: "https://chatgpt.com/oauth/codex/client.json", name: "ChatGPT" })).toBe("codex");
    expect(guessAgentKind({ clientId: "https://chatgpt.com/oauth/client.json", name: "Cursor" })).toBe("chatgpt");
    expect(guessAgentKind({ clientId: "https://claude.ai/oauth/claude-code-client-metadata", name: "Claude" })).toBe("claude-code");
    expect(guessAgentKind({ clientId: "https://claude.ai/oauth/client.json", name: "Claude Code" })).toBe("claude");
    expect(guessAgentKind({ clientId: "https://vscode.dev/oauth/client-metadata.json" })).toBe("vscode");
    expect(guessAgentKind({ clientId: "https://zed.dev/x", name: "Zed" })).toBe("other");
  });

  it("then by the name the app gave itself", () => {
    const loopback = ["http://localhost:5555/callback"];
    for (const [name, kind] of [
      ["Claude Code (easyedit)", "claude-code"], ["claude-code", "claude-code"], ["Claude", "claude"], ["Anthropic connector", "claude"],
      ["ChatGPT", "chatgpt"], ["OpenAI", "chatgpt"], ["Codex", "codex"], ["OpenAI Codex", "codex"], ["codex-mcp-client", "codex"],
      ["Cursor", "cursor"], ["Visual Studio Code", "vscode"], ["Visual Studio Code - Insiders", "vscode"], ["GitHub Copilot", "vscode"],
      ["Gemini CLI MCP Client", "gemini-cli"], ["MCP Inspector", "other"], ["", "other"],
    ] as const) expect(guessAgentKind({ name, redirectUris: loopback }), name).toBe(kind);
  });

  it("otherwise says other", () => {
    expect(guessAgentKind({ clientId: "https://claude.ai/oauth/client.json" })).toBe("claude");
    expect(guessAgentKind({ clientId: "https://chatgpt.com/oauth/client.json" })).toBe("chatgpt");
    expect(guessAgentKind({ clientId: "https://evil.example/client.json" })).toBe("other");
    expect(guessAgentKind({ clientId: "aBc123", name: null, redirectUris: null })).toBe("other");
    expect(guessAgentKind({})).toBe("other");
  });
});

describe("agent actor ids", () => {
  const names = new Map([["u1", "Ada Lovelace"]]);

  it("keeps Claude's own form and gives every other agent its kind", () => {
    expect(agentActorId("claude", "u1")).toBe("claude:u1");
    expect(agentActorId("chatgpt", "u1")).toBe("agent:chatgpt:u1");
    expect(agentActorId("claude-code", "u1")).toBe("agent:claude-code:u1");
  });

  it("round-trips every kind to its member and a name for the change list", () => {
    for (const kind of AGENT_KINDS) {
      const actor = agentActorId(kind, "u1");
      expect(parseAgentActor(actor), actor).toEqual({ kind, userId: "u1" });
      expect(isAgentActor(actor), actor).toBe(true);
      expect(actorUserId(actor), actor).toBe("u1");
      const label = kind === "other" ? "AI agent" : AGENTS[kind].name;
      expect(displayActor(actor, names), actor).toBe(`${label} (for Ada Lovelace)`);
      expect(displayActor(agentActorId(kind, "u9"), names), actor).toBe(label);
    }
  });

  it("names an agent this version does not know AI agent", () => {
    expect(parseAgentActor("agent:robot-9000:u1")).toEqual({ kind: null, userId: "u1" });
    expect(actorUserId("agent:robot-9000:u1")).toBe("u1");
    expect(displayActor("agent:robot-9000:u1", names)).toBe("AI agent (for Ada Lovelace)");
    expect(displayActor("agent:robot-9000:u9", names)).toBe("AI agent");
  });

  it("leaves a person's id alone", () => {
    expect(parseAgentActor("u1")).toBeNull();
    expect(isAgentActor("u1")).toBe(false);
    expect(actorUserId("u1")).toBe("u1");
    expect(displayActor("u1", names)).toBe("Ada Lovelace");
  });
});
