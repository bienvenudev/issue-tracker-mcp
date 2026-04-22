# MCP Explained — For Someone Who Knows APIs

---

## 1. What is an MCP server, explained in API terms?

If you already know REST APIs, an MCP server is conceptually the same thing: it exposes endpoints that a client can call to perform operations. The difference is *who* the client is.

With a REST API, the client is usually a frontend app or another backend service — written by a human, with hardcoded calls like `POST /issues`.

With an MCP server, the client is an AI (like Claude). Instead of hardcoded calls, the AI reads the list of available tools and *decides at runtime* which one to call based on what the user asked.

So instead of your React app calling `POST /issues`, Claude reads your natural language message ("create a bug report for the login page") and calls `create_issue` for you.

---

## 2. What is the MCP Inspector and where does its UI come from?

The Inspector is a separate developer tool built by Anthropic — it has nothing to do with your code. When you run `npm run inspect`, it downloads and runs `@modelcontextprotocol/inspector` (an npm package), which spins up its own web server and opens a browser UI.

Think of it like Postman or Swagger UI: you didn't write Postman, but you use it to test your API. The Inspector does the same for your MCP server — it connects to your server, lists the available tools, and lets you call them manually with custom inputs.

---

## 3. Which packages in package.json actually matter and why?

```json
"@modelcontextprotocol/sdk"   — the MCP protocol itself
"express"                      — the HTTP server that hosts your /mcp endpoint
"zod"                          — defines and validates the shape of tool inputs
```

- **`@modelcontextprotocol/sdk`** gives you `McpServer` and `StreamableHTTPServerTransport`. Without it you'd have to implement the MCP protocol wire format yourself.
- **`express`** is just a regular HTTP server. Your MCP endpoint is literally a single `POST /mcp` route — nothing exotic.
- **`zod`** is how you describe what inputs each tool accepts. When you write `z.string()` or `z.enum([...])`, that schema is what Claude reads to know what arguments to pass.

---

## 4. How does Claude know what to do — how to delete an issue, create one, etc.?

Claude never sees your TypeScript code. What it sees is the **tool registration**: a name, a description, and a schema. For example, your delete tool registers as:

```
name: "delete_issue"
description: "Delete an issue by ID. This action cannot be undone."
inputSchema: { id: string }
```

When Claude receives "delete issue 3", it:
1. Scans the list of registered tools
2. Matches "delete" in the description to `delete_issue`
3. Extracts `id: "3"` from your message using the schema
4. Calls your server with `{ name: "delete_issue", arguments: { id: "3" } }`
5. Your handler runs `store.delete("3")` and returns the result
6. Claude reads the result and replies to you in plain language

The descriptions and schemas are literally the API contract between your server and the AI. Vague descriptions = wrong tool calls.

---

## 5. What would the steps be to deploy this?

The server is a plain Node.js HTTP app, so deployment is the same as any Express app:

1. **Choose a host** — Railway, Render, Fly.io, or any VPS. They all support Node.
2. **Set the PORT environment variable** — the server already reads `process.env.PORT`.
3. **Run `npm start`** — it builds TypeScript and starts the server.
4. **Point Claude at the public URL** — instead of `http://localhost:3001/mcp`, use `https://your-app.railway.app/mcp`.

One important caveat: this server uses an **in-memory store** (`store.ts` is just a JavaScript `Map`). Every restart wipes all issues. For a real deployment you'd replace the store with a real database (Postgres, SQLite, etc.) before going live.

---

## 6. How would this be useful to a real company?

The value is that your existing backend systems become directly usable by AI assistants — without rebuilding them.

A few real-world examples:

- **Internal tooling**: your DevOps team's AI assistant can check deployment status, restart services, or create incidents — by calling your existing internal APIs through an MCP layer.
- **Customer support**: a support AI can look up orders, issue refunds, or escalate tickets — by calling your CRM's MCP server — without a human needing to do it manually.
- **Developer tools**: a coding assistant can create GitHub issues, run CI checks, or query your observability platform mid-conversation.

The key insight: instead of training the AI on your business logic, you give it tools that already *contain* your business logic. You keep control; the AI just drives.

---

## 7. How would this potentially scale?

Your server is already designed for horizontal scaling — this line in `server.ts` is the reason:

```ts
sessionIdGenerator: undefined, // undefined = stateless mode
```

Stateless means each request carries everything needed to process it. No session is stored on the server. So you can run 10 identical copies behind a load balancer and any copy can handle any request.

For the data layer, the in-memory `Map` in `store.ts` would need to be replaced with a shared database (Postgres, Redis, etc.) so all server instances see the same data. Beyond that, the architecture scales like any standard REST API.

---

## BONUS 1: Why does the server send `instructions` to Claude at connect time?

```ts
instructions: "Manage a kanban issue board. Call list_issues first to discover existing issue IDs before updating or deleting."
```

This is a mini system prompt that travels with your tools. Claude reads it when the connection is established and uses it to guide its behavior — in this case, reminding it to always fetch existing IDs before trying to update or delete something. Without this, Claude might try to delete an issue with a made-up ID and get an error. It's a reliability hint, not a security measure.

---

## BONUS 2: What is the difference between `readOnlyHint` and `destructiveHint` on the tools?

```ts
annotations: { readOnlyHint: true }    // on list_issues, get_issue
annotations: { destructiveHint: true } // on delete_issue
```

These are signals to the AI client about what the tool does. `readOnlyHint: true` tells Claude (and tools like the Inspector) "this tool has no side effects, you can call it freely without asking the user." `destructiveHint: true` means "this cannot be undone — ask the user before running it." They don't enforce anything in your code; they're metadata that well-behaved clients respect to avoid accidental data loss.

---

## BONUS 3: Who pays when someone uses a deployed MCP server?

The user pays — not the server owner. Each user connects their own Claude account (subscription or API key) to your server's URL. Claude runs on their account and bills them. You only pay for hosting the Node process itself (the server on Railway, Render, etc.).

How a user connects to your deployed server:

```bash
# Claude Code CLI
claude mcp add --transport http --scope user my-issue-tracker https://your-app.railway.app/mcp
```

Or via the Claude desktop app: Settings → MCP Servers → add the URL. Their Claude account handles the AI; your server just responds to whoever calls it.

---

## BONUS 4: Why is the data wiped every time the server restarts?

The store is a plain JavaScript `Map` in memory — it only exists while the Node process is running. When `npm start` runs again, a fresh process starts with a fresh `Map`, seeded with 3 hardcoded issues from the bottom of `store.ts`. For this workshop that's fine. In production you'd persist data to a database so it survives restarts and scales across multiple server instances.
