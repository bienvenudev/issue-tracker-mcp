import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { store, type Status } from "./store.js";

// ---------------------------------------------------------------------------
// 1. Create the MCP server and describe it.
//    `instructions` is sent to the AI client at connection time — think of it
//    as a mini system prompt that travels with your tools.
// ---------------------------------------------------------------------------
const server = new McpServer(
  { name: "issue-tracker", version: "0.1.0" },
  {
    instructions:
      "Manage a kanban issue board. Call list_issues first to discover existing " +
      "issue IDs before updating or deleting.",
  },
);

// Reused enum schema for the four board columns. Defining it once keeps every
// tool's `status` parameter consistent.
const StatusSchema = z
  .enum(["backlog", "todo", "in_progress", "done"])
  .describe("Which board column the issue belongs to.");

// Helper: wrap any value as the text content block MCP expects tool results in.
function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

// ---------------------------------------------------------------------------
// 2. Register tools.
//    Each tool = name + description + input schema + handler.
//    The description and schema are what the AI reads to decide *when* and
//    *how* to call the tool, so keep them precise.
// ---------------------------------------------------------------------------

// --- Worked example -------------------------------------------------------
// `list_issues` is fully implemented so you can see the shape of a tool
// registration. Read it, run it in the Inspector, then use it as a template
// for the TODOs that follow.
server.registerTool(
  "list_issues",
  {
    description:
      "List issues on the board. Optionally filter to a single status column. " +
      "Returns id, title, status, and description for each issue.",
    inputSchema: {
      status: StatusSchema.optional(),
    },
    // readOnlyHint tells the host this tool has no side effects, so it can be
    // auto-approved without prompting the user.
    annotations: { readOnlyHint: true },
  },
  async ({ status }) => textResult(store.list(status as Status | undefined)),
);


// --- Your turn ------------------------------------------------------------

// TODO: register a `get_issue` tool.
//   - Input: an `id` string.
//   - Behavior: call store.get(id). If it returns undefined, respond with
//     `{ isError: true, content: [...] }` so the AI can recover. Otherwise
//     return the issue via textResult().
//   - Mark it read-only with annotations.readOnlyHint.

// TODO: register a `create_issue` tool.
//   - Inputs: `title` (required string), `description` (optional string),
//     `status` (StatusSchema, default "backlog").
//   - Behavior: call store.create(...) and return the new issue.

// TODO: register an `update_issue` tool.
//   - Inputs: `id` (required), plus optional `title`, `description`, `status`.
//   - Behavior: call store.update(id, patch). Return isError if the id is
//     unknown, otherwise return the updated issue.

// TODO: register a `delete_issue` tool.
//   - Input: `id`.
//   - Behavior: call store.delete(id) and report success or isError.
//   - Mark it with annotations.destructiveHint so hosts confirm before running.

// ---------------------------------------------------------------------------
// 3. Expose the server over HTTP.
//    MCP's "streamable HTTP" transport is just JSON over a single POST
//    endpoint. We run it *stateless*: every request gets a fresh transport,
//    which keeps the code simple and scales horizontally behind a load
//    balancer when you deploy it.
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // undefined = stateless mode
  });
  // Clean up the transport once the HTTP response closes.
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// A plain health check so hosting platforms (and curious students) can verify
// the process is up without speaking MCP.
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`Issue Tracker MCP server listening on http://localhost:${PORT}/mcp`);
});
