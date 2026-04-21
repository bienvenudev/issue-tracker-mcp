/**
 * Issue Tracker — MCP Server
 *
 * MCP (Model Context Protocol) is an open protocol that lets AI assistants
 * call tools you define. This file stands up a small HTTP server that speaks
 * MCP, so any MCP-compatible client (Claude, an IDE plugin, another agent)
 * can list, create, and update issues on our board.
 *
 * We use the *streamable HTTP* transport rather than stdio. That means the
 * server listens on a network port, so it works both for local development
 * (http://localhost:3001/mcp) and when deployed to a public URL for a whole
 * team to share — exactly the "PM wants everyone to use my tool" scenario.
 */

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

server.registerTool(
  "get_issue",
  {
    description: "Fetch a single issue by its id.",
    inputSchema: {
      id: z.string().describe("The issue id, e.g. '3'."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ id }) => {
    const issue = store.get(id);
    if (!issue) {
      // Returning isError (instead of throwing) lets the AI read the message
      // and recover — e.g. by calling list_issues to find a valid id.
      return {
        isError: true,
        content: [{ type: "text", text: `Issue ${id} not found. Use list_issues to see valid ids.` }],
      };
    }
    return textResult(issue);
  },
);

server.registerTool(
  "create_issue",
  {
    description: "Create a new issue. Returns the created issue including its new id.",
    inputSchema: {
      title: z.string().min(1).describe("Short summary of the work."),
      description: z.string().optional().describe("Longer details. Optional."),
      status: StatusSchema.default("backlog"),
    },
  },
  async ({ title, description, status }) =>
    textResult(store.create({ title, description, status: status as Status })),
);

server.registerTool(
  "update_issue",
  {
    description:
      "Update fields on an existing issue. Only the fields you provide are changed. " +
      "Use this to move an issue between columns by setting `status`.",
    inputSchema: {
      id: z.string().describe("Id of the issue to change."),
      title: z.string().optional(),
      description: z.string().optional(),
      status: StatusSchema.optional(),
    },
  },
  async ({ id, title, description, status }) => {
    const updated = store.update(id, { title, description, status: status as Status | undefined });
    if (!updated) {
      return {
        isError: true,
        content: [{ type: "text", text: `Issue ${id} not found.` }],
      };
    }
    return textResult(updated);
  },
);

server.registerTool(
  "delete_issue",
  {
    description: "Permanently delete an issue by id.",
    inputSchema: {
      id: z.string().describe("Id of the issue to delete."),
    },
    // destructiveHint asks the host to show a confirmation before running.
    annotations: { destructiveHint: true },
  },
  async ({ id }) => {
    const ok = store.delete(id);
    return ok
      ? textResult({ deleted: id })
      : { isError: true, content: [{ type: "text", text: `Issue ${id} not found.` }] };
  },
);

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
