// Every kind of AI agent EasyEdit knows how to connect, and the facts the sign-in server and the setup page need about
// each. Claude is the primary agent: it is listed first and is the default everywhere a kind is unknown.
//
// Redirect addresses and metadata hosts were checked against each vendor's docs and client source on 2026-11-13.
// The sign-in server answers with `iss` (RFC 9207), so ChatGPT and Codex use their fixed callbacks; ChatGPT's
// per-connection callback is still allowed in case it falls back to it.

export const AGENT_KINDS = [
  "claude",
  "chatgpt",
  "claude-code",
  "cursor",
  "vscode",
  "codex",
  "gemini-cli",
  "openai-api",
  "other",
] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

export const PRIMARY_AGENT: AgentKind = "claude";

// The two agents most people already use in a browser or an app: the AI agents page offers them first, as two large
// choices, and the rest (developer tools, the OpenAI API, any other MCP client) behind a disclosure.
export const CONSUMER_AGENTS = ["claude", "chatgpt"] as const satisfies readonly AgentKind[];
export type ConsumerAgent = (typeof CONSUMER_AGENTS)[number];
export const OTHER_AGENTS: readonly AgentKind[] = AGENT_KINDS.filter((kind) => !(CONSUMER_AGENTS as readonly string[]).includes(kind));

// How a member connects the agent: by signing in through the agent's own connector screen (OAuth), or by pasting an
// access token the member makes on the AI agents page.
export type ConnectMethod = "oauth" | "token";

export type AgentInfo = {
  kind: AgentKind;
  // Shown in the editor's change list as "<name> (for <member>)", on the consent page and on the AI agents page.
  name: string;
  vendor: string;
  methods: readonly ConnectMethod[];
  // Exact redirect addresses the agent's OAuth client uses, https or the agent's own app scheme (RFC 8252 §7.1).
  // Matched exactly: no trailing slash, query or other scheme.
  redirectUris: readonly string[];
  // Whole-address patterns for callbacks that carry a per-connection id on a host only the vendor controls.
  redirectPatterns: readonly RegExp[];
  // Hosts whose OAuth client metadata documents the sign-in server reads (Client ID Metadata Documents).
  clientDocumentHosts: readonly string[];
  // Whether the agent signs in through a loopback address on the member's own computer (RFC 8252 §7.3).
  usesLoopback: boolean;
  // Steps for the AI agents page. "{url}" is replaced with the MCP server address, which the page shows with its own
  // Copy button.
  steps: readonly string[];
  // The agent's own page for adding a connector, linked from the first step, where the vendor documents a stable one.
  settings?: { href: string; label: string };
  // A command or config file snippet. "{url}" and "{token}" are replaced.
  snippet?: { label: string; code: string };
  // The same setup with an access token in place of signing in, shown once right after a token is made.
  tokenSnippet?: { label: string; code: string };
};

export const AGENTS: Readonly<Record<AgentKind, AgentInfo>> = {
  claude: {
    kind: "claude",
    name: "Claude",
    vendor: "Anthropic",
    methods: ["oauth"],
    redirectUris: ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"],
    redirectPatterns: [],
    clientDocumentHosts: ["claude.ai", "claude.com"],
    usesLoopback: false,
    steps: [
      "In Claude, open Customize, then Connectors. In the desktop or phone app it's the same place.",
      "Choose + Add, then Add custom connector. Name it EasyEdit and paste this address as the URL: {url}",
      "Choose Continue, then Add, then Connect. Sign in with the Google account you use for EasyEdit and choose Allow.",
    ],
    // From Anthropic's help article on custom connectors (checked 2026-11-26).
    settings: { href: "https://claude.ai/customize/connectors", label: "Open Claude's connector settings" },
  },
  chatgpt: {
    kind: "chatgpt",
    name: "ChatGPT",
    vendor: "OpenAI",
    methods: ["oauth"],
    redirectUris: [
      "https://chatgpt.com/connector_platform_oauth_redirect",
      "https://platform.openai.com/apps-manage/oauth",
    ],
    redirectPatterns: [/^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/],
    clientDocumentHosts: ["chatgpt.com"],
    usesLoopback: false,
    steps: [
      "In ChatGPT on the web, open Plugins, then choose + and Add custom MCP server. If you don't see it, turn on Developer mode in Settings, Apps, Advanced settings: it's ChatGPT's switch for adding your own connectors.",
      "Name it EasyEdit and paste this address as the Server URL: {url} Then choose OAuth for Authentication.",
      "Choose I understand and want to continue, then Create as a plugin. Install it, sign in with the Google account you use for EasyEdit and choose Allow.",
    ],
    // From OpenAI's developer mode guide (checked 2026-11-26).
    settings: { href: "https://chatgpt.com/plugins", label: "Open ChatGPT's plugins page" },
  },
  "claude-code": {
    kind: "claude-code",
    name: "Claude Code",
    vendor: "Anthropic",
    methods: ["oauth", "token"],
    redirectUris: [],
    redirectPatterns: [],
    clientDocumentHosts: ["claude.ai"],
    usesLoopback: true,
    steps: [
      "Run the command below in a terminal.",
      "In Claude Code, run /mcp, pick easyedit and choose Authenticate (or run claude mcp login easyedit). Sign in with the Google account you use for EasyEdit and choose Allow.",
    ],
    snippet: { label: "Terminal", code: "claude mcp add --transport http easyedit {url}" },
    tokenSnippet: { label: "Terminal", code: 'claude mcp add --transport http easyedit {url} --header "Authorization: Bearer {token}"' },
  },
  cursor: {
    kind: "cursor",
    name: "Cursor",
    vendor: "Anysphere",
    methods: ["oauth", "token"],
    redirectUris: ["https://www.cursor.com/agents/mcp/oauth/callback", "cursor://anysphere.cursor-mcp/oauth/callback"],
    redirectPatterns: [],
    clientDocumentHosts: [],
    usesLoopback: true,
    steps: [
      "In Cursor, open Settings → Tools & MCP → New MCP server, or edit ~/.cursor/mcp.json.",
      "Add the server below and save.",
      "Choose Connect (or Needs login) next to easyedit, sign in with the Google account you use for EasyEdit and choose Allow.",
    ],
    snippet: { label: "~/.cursor/mcp.json", code: '{\n  "mcpServers": {\n    "easyedit": { "url": "{url}" }\n  }\n}' },
    tokenSnippet: {
      label: "~/.cursor/mcp.json",
      code: '{\n  "mcpServers": {\n    "easyedit": {\n      "url": "{url}",\n      "headers": { "Authorization": "Bearer {token}" }\n    }\n  }\n}',
    },
  },
  vscode: {
    kind: "vscode",
    name: "VS Code (Copilot)",
    vendor: "Microsoft",
    methods: ["oauth", "token"],
    redirectUris: ["https://vscode.dev/redirect", "https://insiders.vscode.dev/redirect"],
    redirectPatterns: [],
    clientDocumentHosts: ["vscode.dev"],
    usesLoopback: true,
    steps: [
      "In VS Code, run MCP: Add Server from the Command Palette and pick HTTP, or add the server below to mcp.json.",
      "Name it easyedit and paste this address: {url}",
      "When VS Code asks, sign in with the Google account you use for EasyEdit and choose Allow. Use Copilot Chat in Agent mode.",
    ],
    snippet: { label: "mcp.json", code: '{\n  "servers": {\n    "easyedit": { "type": "http", "url": "{url}" }\n  }\n}' },
    tokenSnippet: {
      label: "mcp.json",
      code: '{\n  "servers": {\n    "easyedit": {\n      "type": "http",\n      "url": "{url}",\n      "headers": { "Authorization": "Bearer {token}" }\n    }\n  }\n}',
    },
  },
  codex: {
    kind: "codex",
    name: "Codex",
    vendor: "OpenAI",
    methods: ["oauth", "token"],
    redirectUris: [],
    redirectPatterns: [],
    // Codex's metadata document lives under chatgpt.com/oauth/codex/, which the ChatGPT entry already allows.
    clientDocumentHosts: ["chatgpt.com"],
    usesLoopback: true,
    steps: [
      "Run the commands below in a terminal.",
      "codex mcp login opens the browser: sign in with the Google account you use for EasyEdit and choose Allow.",
    ],
    snippet: { label: "Terminal", code: "codex mcp add easyedit --url {url}\ncodex mcp login easyedit" },
    tokenSnippet: {
      label: "~/.codex/config.toml",
      code: '[mcp_servers.easyedit]\nurl = "{url}"\nhttp_headers = { "Authorization" = "Bearer {token}" }',
    },
  },
  "gemini-cli": {
    kind: "gemini-cli",
    name: "Gemini CLI",
    vendor: "Google",
    methods: ["oauth", "token"],
    redirectUris: [],
    redirectPatterns: [],
    clientDocumentHosts: [],
    usesLoopback: true,
    steps: [
      "Run the command below in a terminal.",
      "In Gemini CLI, run /mcp auth easyedit, sign in with the Google account you use for EasyEdit and choose Allow.",
    ],
    snippet: { label: "Terminal", code: "gemini mcp add -t http easyedit {url}" },
    tokenSnippet: { label: "Terminal", code: 'gemini mcp add -t http -H "Authorization: Bearer {token}" easyedit {url}' },
  },
  "openai-api": {
    kind: "openai-api",
    name: "OpenAI API",
    vendor: "OpenAI",
    methods: ["token"],
    redirectUris: [],
    redirectPatterns: [],
    clientDocumentHosts: [],
    usesLoopback: false,
    steps: [
      "Make an access token below and keep it secret, like a password.",
      "Pass EasyEdit as a remote MCP tool in the Responses API, with the token as its authorization. In the Agents SDK, send it as an Authorization: Bearer header.",
      "OpenAI asks your code to approve each call by default. Turn that off (require_approval: \"never\") only for prompts you trust: text in team projects reaches the model too.",
    ],
    snippet: {
      label: "Responses API tool",
      code: '{\n  "type": "mcp",\n  "server_label": "easyedit",\n  "server_url": "{url}",\n  "authorization": "{token}"\n}',
    },
  },
  other: {
    kind: "other",
    name: "Another agent",
    vendor: "Zed, Goose, Windsurf, MCP Inspector or any MCP client",
    methods: ["oauth", "token"],
    redirectUris: [],
    redirectPatterns: [],
    clientDocumentHosts: ["zed.dev", "goose-docs.ai"],
    usesLoopback: true,
    steps: [
      "Point the agent at this address as a Streamable HTTP MCP server: {url}",
      "If it supports OAuth, it opens a sign-in page: sign in with the Google account you use for EasyEdit and choose Allow.",
      "If it only takes a header, make an access token below and send it as Authorization: Bearer <token>.",
    ],
  },
};

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === "string" && (AGENT_KINDS as readonly string[]).includes(value);
}

export function agentName(kind: AgentKind): string {
  return AGENTS[kind].name;
}

// A loopback redirect on the member's own computer: http on 127.0.0.1, [::1] or localhost, any port and path.
// A sign-in code sent there never leaves that computer, so no outside app can catch it.
export function isLoopbackRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  // No query either: no agent puts one on its loopback callback, and a query is how a local page could be told to pass
  // the code on.
  return url.protocol === "http:"
    && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
    && url.username === ""
    && url.password === ""
    && url.search === ""
    && url.hash === "";
}

// The agent a redirect address belongs to, or null when no known agent uses it. Loopback addresses belong to no single
// agent, so they return null here and are allowed separately.
export function agentForRedirect(uri: string): AgentKind | null {
  for (const kind of AGENT_KINDS) {
    const info = AGENTS[kind];
    if (info.redirectUris.includes(uri)) return kind;
    if (info.redirectPatterns.some((pattern) => pattern.test(uri))) return kind;
  }
  return null;
}

// Whether the sign-in server may send a code to this address: a known agent's address, or a loopback one.
export function isAllowedRedirect(uri: string): boolean {
  return agentForRedirect(uri) !== null || isLoopbackRedirect(uri);
}

// Whether the sign-in server may read an OAuth client metadata document from this address: https on a known host,
// with no port or credentials.
export function isAllowedClientDocument(clientIdUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(clientIdUrl);
  } catch {
    return false;
  }
  return url.protocol === "https:"
    && url.port === ""
    && url.username === ""
    && url.password === ""
    && AGENT_KINDS.some((k) => AGENTS[k].clientDocumentHosts.includes(url.hostname));
}

// The agent a metadata document address names, including on hosts several agents share. A document on a host tied to
// no single agent (zed.dev, goose-docs.ai) names "other". Null for an address that is not an allowed document.
export function agentForClientDocument(clientIdUrl: string): AgentKind | null {
  if (!isAllowedClientDocument(clientIdUrl)) return null;
  let url: URL;
  try {
    url = new URL(clientIdUrl);
  } catch {
    return null;
  }
  if (url.hostname === "chatgpt.com") return url.pathname.startsWith("/oauth/codex/") ? "codex" : "chatgpt";
  if (url.hostname === "claude.ai" && url.pathname.includes("claude-code")) return "claude-code";
  for (const kind of AGENT_KINDS) if (AGENTS[kind].clientDocumentHosts.includes(url.hostname)) return kind;
  return null;
}

// Best guess at which agent an OAuth client is, from what it told the sign-in server about itself. Used for the
// change list and the AI agents page; never for an access decision.
export function guessAgentKind(client: { clientId?: string | null; name?: string | null; redirectUris?: readonly string[] | null }): AgentKind {
  for (const uri of client.redirectUris ?? []) {
    const kind = agentForRedirect(uri);
    if (kind !== null) return kind;
  }
  if (client.clientId) {
    const kind = agentForClientDocument(client.clientId);
    if (kind !== null) return kind;
  }
  const name = (client.name ?? "").toLowerCase();
  // More specific names first: "OpenAI Codex" is Codex, "Claude Code" is not Claude.
  const byName: [RegExp, AgentKind][] = [
    [/claude[\s-]?code/, "claude-code"],
    [/codex/, "codex"],
    [/chatgpt|openai/, "chatgpt"],
    [/cursor/, "cursor"],
    [/visual studio code|vs ?code|copilot/, "vscode"],
    [/gemini/, "gemini-cli"],
    [/claude|anthropic/, "claude"],
  ];
  for (const [pattern, kind] of byName) if (pattern.test(name)) return kind;
  return "other";
}

// Fills "{url}" and "{token}" in a step or snippet.
export function fillTemplate(text: string, values: { url: string; token?: string }): string {
  return text.replaceAll("{url}", values.url).replaceAll("{token}", values.token ?? "<your access token>");
}
