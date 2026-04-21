# issue-tracker-mcp

A minimal [Model Context Protocol](https://modelcontextprotocol.io) server that
lets an AI assistant manage a kanban issue board.

It uses the **streamable HTTP** transport, so the same code works for local
development *and* for a hosted deployment that a whole team connects to.

## The exercise

`src/server.ts` has the server scaffolding and **one** finished tool
(`list_issues`) so you can see what a registration looks like. Four more tools
are left as `TODO` comments — your job is to implement them with
`server.registerTool(...)`:

- `get_issue`
- `create_issue`
- `update_issue`
- `delete_issue`

The data layer in `src/store.ts` is already complete; you only need to wire it
up. After each one, restart the server and try it in the Inspector.

> Stuck? The `solution` branch has a fully working version.

## Run it

```bash
npm install
npm start
# → Issue Tracker MCP server listening on http://localhost:3001/mcp
```

## Poke it manually

The MCP Inspector is a small web UI for calling tools by hand:

```bash
npm run inspect
# then choose "Streamable HTTP" and enter http://localhost:3001/mcp
```

## Connect a client

| Client | How |
| --- | --- |
| Claude Code | `claude mcp add --transport http issue-tracker http://localhost:3001/mcp` |
| Claude Desktop / Claude.ai | Settings → Connectors → Add custom connector → paste the URL |

## Deploy for your team

This is a plain Express app. Deploy `npm start` to any Node host (Render,
Railway, Fly.io, Cloudflare Workers, a VPS) and share the resulting
`https://…/mcp` URL — everyone who adds that URL talks to the same board.
