import { expect, test } from "bun:test"
import type { PluginInput, ToolContext } from "@opencode-ai/plugin"
import { createInterruptSessionTool } from "./interrupt-session"

const sessions = new Map<string, { id: string; parentID?: string }>()
const getSessionIDs: string[] = []
const abortedSessionIDs: string[] = []
let abortResult: { data?: boolean; error?: unknown } = { data: true }

const connectedClient = {
  session: {
    get: async ({ path }: { path: { id: string } }) => {
      getSessionIDs.push(path.id)
      const data = sessions.get(path.id)
      return data === undefined ? { data: undefined, error: { name: "NotFoundError", data: { message: "not found" } } } : { data, error: undefined }
    },
    abort: async ({ path }: { path: { id: string } }) => {
      abortedSessionIDs.push(path.id)
      return abortResult
    },
  },
} as unknown as PluginInput["client"]

function pluginInput(client: PluginInput["client"] = connectedClient): PluginInput {
  return {
    client,
    directory: "/workspace",
    serverUrl: new URL("http://127.0.0.1:1"),
  } as unknown as PluginInput
}

function toolContext(sessionID: string, ask: ToolContext["ask"]): ToolContext {
  return {
    sessionID,
    messageID: "message-1",
    agent: "orchestrator",
    directory: "/workspace",
    worktree: "/workspace",
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask,
  }
}

function preAllowedContext(sessionID: string): ToolContext {
  return toolContext(sessionID, async () => undefined)
}

test("interrupt_session does not call the SDK when permission is denied", async () => {
  getSessionIDs.length = 0
  abortedSessionIDs.length = 0
  const tool = createInterruptSessionTool(pluginInput())
  const context = toolContext("session-denied", async () => {
    throw new Error("permission denied")
  })

  await expect(tool.execute({ task_id: "target-denied" }, context)).rejects.toThrow("permission denied")
  expect(getSessionIDs).toEqual([])
  expect(abortedSessionIDs).toEqual([])
})

test("interrupt_session requires task_id before asking or calling the SDK", async () => {
  getSessionIDs.length = 0
  abortedSessionIDs.length = 0
  const asks: Parameters<ToolContext["ask"]>[0][] = []
  const tool = createInterruptSessionTool(pluginInput())
  const context = toolContext("session-missing-task", async (input) => {
    asks.push(input)
  })

  await expect(tool.execute({} as never, context)).rejects.toThrow("task_id must be provided")
  expect(asks).toEqual([])
  expect(getSessionIDs).toEqual([])
  expect(abortedSessionIDs).toEqual([])
})

test("interrupt_session aborts a direct child through v1 after ask approval", async () => {
  sessions.clear()
  getSessionIDs.length = 0
  abortedSessionIDs.length = 0
  abortResult = { data: true }
  sessions.set("target-child", { id: "target-child", parentID: "session-allowed" })
  const asks: Parameters<ToolContext["ask"]>[0][] = []
  const tool = createInterruptSessionTool(pluginInput())
  const context = toolContext("session-allowed", async (input) => {
    asks.push(input)
  })

  const result = await tool.execute({ task_id: "target-child", reason: "stop now" }, context)
  expect(result).toContain("Cancellation requested")
  expect(result).toContain("asynchronous")
  expect(result).toContain("does not confirm")
  expect(asks).toEqual([{
    permission: "interrupt_session",
    patterns: ["*"],
    always: [],
    metadata: { sessionID: "session-allowed", task_id: "target-child", reason: "stop now" },
  }])
  expect(getSessionIDs).toEqual(["target-child"])
  expect(abortedSessionIDs).toEqual(["target-child"])
})

test("interrupt_session uses the connected v1 client supplied by the plugin", async () => {
  const calls: string[] = []
  const client = {
    session: {
      get: async ({ path }: { path: { id: string } }) => {
        calls.push(`get:${path.id}`)
        return { data: { id: path.id, parentID: "session-current" }, error: undefined }
      },
      abort: async ({ path }: { path: { id: string } }) => {
        calls.push(`abort:${path.id}`)
        return { data: true, error: undefined }
      },
    },
  } as unknown as PluginInput["client"]
  const tool = createInterruptSessionTool(pluginInput(client))

  await expect(tool.execute({ task_id: "connected-child" }, preAllowedContext("session-current"))).resolves.toContain("asynchronous")
  expect(calls).toEqual(["get:connected-child", "abort:connected-child"])
})

test("interrupt_session aborts a deeper descendant without a reason", async () => {
  sessions.clear()
  getSessionIDs.length = 0
  abortedSessionIDs.length = 0
  abortResult = { data: true }
  sessions.set("target-grandchild", { id: "target-grandchild", parentID: "child-session" })
  sessions.set("child-session", { id: "child-session", parentID: "session-pre-allowed" })
  const tool = createInterruptSessionTool(pluginInput())

  await expect(tool.execute({ task_id: "target-grandchild" }, preAllowedContext("session-pre-allowed"))).resolves.toContain("v1 client.session.abort")
  expect(getSessionIDs).toEqual(["target-grandchild", "child-session"])
  expect(abortedSessionIDs).toEqual(["target-grandchild"])
})

test("interrupt_session rejects a non-descendant without aborting it", async () => {
  sessions.clear()
  getSessionIDs.length = 0
  abortedSessionIDs.length = 0
  sessions.set("unrelated", { id: "unrelated", parentID: "other-session" })
  sessions.set("other-session", { id: "other-session" })
  const tool = createInterruptSessionTool(pluginInput())

  await expect(tool.execute({ task_id: "unrelated" }, preAllowedContext("session-current"))).rejects.toThrow("not a descendant")
  expect(getSessionIDs).toEqual(["unrelated", "other-session"])
  expect(abortedSessionIDs).toEqual([])
})

test("interrupt_session rejects a missing target without aborting it", async () => {
  sessions.clear()
  getSessionIDs.length = 0
  abortedSessionIDs.length = 0
  const tool = createInterruptSessionTool(pluginInput())

  await expect(tool.execute({ task_id: "missing-target" }, preAllowedContext("session-current"))).rejects.toThrow("missing-target")
  expect(getSessionIDs).toEqual(["missing-target"])
  expect(abortedSessionIDs).toEqual([])
})

test("interrupt_session does not report success when v1 abort returns false", async () => {
  sessions.clear()
  getSessionIDs.length = 0
  abortedSessionIDs.length = 0
  abortResult = { data: false }
  sessions.set("target-false", { id: "target-false", parentID: "session-current" })
  const tool = createInterruptSessionTool(pluginInput())

  await expect(tool.execute({ task_id: "target-false" }, preAllowedContext("session-current"))).rejects.toThrow("target-false")
  expect(abortedSessionIDs).toEqual(["target-false"])
  abortResult = { data: true }
})
