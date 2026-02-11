# Supabase MCP (Cursor)

This repo uses Supabase via the hosted MCP server documented here:
[`https://supabase.com/docs/guides/getting-started/mcp`](https://supabase.com/docs/guides/getting-started/mcp)

## Workspace note
In this environment, creating `.cursor/mcp.json` inside the repo is blocked, so Supabase MCP is configured in the **global** Cursor config:

- `~/.cursor/mcp.json`

Example (global) config:

```json
{
  "mcpServers": {
    "supabase": {
      "url": "https://mcp.supabase.com/mcp"
    }
  }
}
```

After adding it, restart Cursor and complete the Supabase OAuth prompt.



