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
server.registerTool(
  "get_issue",
  {
    description:
      "Get a single issue by ID. Returns id, title, status, and description.",
    inputSchema: z.object({ id: z.string() }),
    annotations: { readOnlyHint: true },
  },
  async ({ id }) => {
    const issue = store.get(id);
    if (!issue) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `No issue with id ${id}` }],
      };
    }
    return textResult(issue);
  },
);

// TODO: register a `create_issue` tool.
//   - Inputs: `title` (required string), `description` (optional string),
//     `status` (StatusSchema, default "backlog").
//   - Behavior: call store.create(...) and return the new issue.
server.registerTool(
  "create_issue",
  {
    description:
      "Create a new issue with a title, optional description, and status.",
    inputSchema: z.object({
      title: z.string(),
      description: z.string().optional(),
      status: StatusSchema.default("backlog"),
    }),
  },
  async ({ title, description, status }) => {
    const issue = store.create({ title, description, status });
    return textResult(issue);
  },
);

// TODO: register an `update_issue` tool.
//   - Inputs: `id` (required), plus optional `title`, `description`, `status`.
//   - Behavior: call store.update(id, patch). Return isError if the id is
//     unknown, otherwise return the updated issue.
server.registerTool(
  "update_issue",
  {
    description:
      "Update an existing issue's title, description, or status. Specify the issue by ID.",
    inputSchema: z.object({
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      status: StatusSchema.optional(),
    }),
  },
  async ({ id, title, description, status }) => {
    const patch = { title, description, status };
    const issue = store.update(id, patch);
    if (!issue) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `No issue with id ${id}` }],
      };
    }
    return textResult(issue);
  },
);

// TODO: register a `delete_issue` tool.
//   - Input: `id`.
//   - Behavior: call store.delete(id) and report success or isError.
//   - Mark it with annotations.destructiveHint so hosts confirm before running.
server.registerTool(
  "delete_issue",
  {
    description: "Delete an issue by ID. This action cannot be undone.",
    inputSchema: z.object({ id: z.string() }),
    annotations: { destructiveHint: true },
  },
  async ({ id }) => {
    const success = store.delete(id);
    if (!success) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `No issue with id ${id}` }],
      };
    }
    return textResult({ success: true });
  },
);
// ---------------------------------------------------------------------------
// 3. Expose the server over HTTP.
//    MCP's "streamable HTTP" transport is just JSON over a single POST
//    endpoint. We run it *stateless*: every request gets a fresh transport,
//    which keeps the code simple and scales horizontally behind a load
//    balancer when you deploy it.

/*
Recommended order:

Start the server — npm start (leave this running)
Try the Inspector first — npm run inspect in another terminal. It opens a browser UI where you can call each tool with custom arguments visually. Great for exploring.
Then wire up Claude Code — run the claude mcp add command above, then open claude in this directory and just talk to it: "Create an issue titled 'Fix login bug' with status todo"

Use claude mcp add -transport http -scope project issue-tracker http://localhost:3001/mcp
*/

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
