# Client Compatibility Matrix

> Hard rule: direct consumer-app support is **UNKNOWN unless verified**.
> Code enforces this: unknown/consumer profiles get the safest ceiling.

| Client / Platform | Confirmed path | Likely path | Unknowns | Risk | Recommended adapter |
|---|---|---|---|---|---|
| Claude Code | MCP stdio (today) | MCP HTTP (`/mcp`, PR-3) | remote config UX | low | native MCP |
| Claude Desktop / Cloud Cowork | MCP stdio (today) | — | — | low | native MCP |
| OpenAI Agents SDK | — | MCP Streamable HTTP | version specifics | med | native MCP after PR-3 |
| ChatGPT Android app | — | — | **direct custom MCP: UNKNOWN** | high | Android PWA → REST |
| Gemini CLI | — | MCP via settings (`httpUrl`) | header auth details | med | native MCP after PR-3 |
| Gemini Android app | — | — | **direct custom MCP: UNKNOWN** | high | Android PWA → REST |
| Gemini API | — | function-calling adapter | — | med | REST adapter (PR-4) |
| Cursor | — | MCP config | product drift | med | MCP or REST |
| GitHub Copilot / agents | — | extension/MCP path | product drift | med | adapter |
| Codex-style agents | — | MCP Streamable HTTP | varies | med | MCP after PR-3 |
| DeepSeek/Qwen local agents | — | REST/function-calling | MCP support unverified | med | REST adapter |
| Oria HQ | internal (future adapter) | — | — | low | first-class internal |
| Hermes Agent | internal (future adapter) | — | — | low | first-class internal |
| Android PWA | — | REST (PR-4) | token storage on device | med | REST + short-lived tokens |

**In-code enforcement:** `resolveClientProfile()` gives `chatgpt_android` / `gemini_android`
`mcpDirectSupport: 'unknown'` and a `read_only` ceiling; `unknown` clients get `none`.
