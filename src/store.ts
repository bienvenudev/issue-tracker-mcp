/**
 * A tiny in-memory issue database.
 *
 * In a real product this module would be replaced by calls to your actual
 * backend (a REST API, Postgres, etc). We keep it in-memory here so the MCP
 * server is self-contained and students can run it with zero setup.
 */

// The four kanban columns an issue can live in.
export type Status = "backlog" | "todo" | "in_progress" | "done";

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: Status;
  createdAt: string;
}

// All issues live in this Map, keyed by id. Because the server process owns
// this Map, every connected client (local or remote) sees the same data.
const issues = new Map<string, Issue>();

// A simple incrementing id so issue references are short and human-readable
// (easier for an LLM to quote back than a UUID).
let nextId = 1;

export const store = {
  list(status?: Status): Issue[] {
    const all = [...issues.values()];
    return status ? all.filter((i) => i.status === status) : all;
  },

  get(id: string): Issue | undefined {
    return issues.get(id);
  },

  create(input: { title: string; description?: string; status?: Status }): Issue {
    const issue: Issue = {
      id: String(nextId++),
      title: input.title,
      description: input.description ?? "",
      status: input.status ?? "backlog",
      createdAt: new Date().toISOString(),
    };
    issues.set(issue.id, issue);
    return issue;
  },

  update(
    id: string,
    patch: Partial<Pick<Issue, "title" | "description" | "status">>,
  ): Issue | undefined {
    const issue = issues.get(id);
    if (!issue) return undefined;
    Object.assign(issue, patch);
    return issue;
  },

  delete(id: string): boolean {
    return issues.delete(id);
  },
};

// Seed a few rows so the board isn't empty on first run.
store.create({ title: "Set up project skeleton", status: "done" });
store.create({ title: "Design board layout", status: "in_progress" });
store.create({ title: "Write API routes", status: "todo" });
