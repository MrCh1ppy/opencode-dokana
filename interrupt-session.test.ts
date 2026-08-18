import { expect, mock, test } from "bun:test"
import type { PluginInput, ToolContext } from "@opencode-ai/plugin"

const interruptedSessionIDs: string[] = []

await mock.module("@opencode-ai/sdk/v2/client", () => ({
  createOpencodeClient: () => ({
    v2: {
      session: {
        interrupt: async ({ sessionID }: { sessionID: string }) => {
          interruptedSessionIDs.push(sessionID)
        },
      },
    },
  }),
}))

const { createInterruptSessionTool } = await import("./interrupt-session")

function pluginInput(): PluginInput {
  return {
    directory: "/workspace",
    serverUrl: new URL("http://127.0.0.1:4096"),
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
  interruptedSessionIDs.length = 0
  const tool = createInterruptSessionTool(pluginInput())
  const context = toolContext("session-denied", async () => {
    throw new Error("permission denied")
  })

  await expect(tool.execute({}, context)).rejects.toThrow("permission denied")
  expect(interruptedSessionIDs).toEqual([])
})

test("interrupt_session calls the v2 SDK after ask approval", async () => {
  interruptedSessionIDs.length = 0
  const asks: Parameters<ToolContext["ask"]>[0][] = []
  const tool = createInterruptSessionTool(pluginInput())
  const context = toolContext("session-allowed", async (input) => {
    asks.push(input)
  })

  await expect(tool.execute({ reason: "stop now" }, context)).resolves.toBe("Current session interrupted.")
  expect(asks).toEqual([{
    permission: "interrupt_session",
    patterns: ["*"],
    always: [],
    metadata: { sessionID: "session-allowed", reason: "stop now" },
  }])
  expect(interruptedSessionIDs).toEqual(["session-allowed"])
})

test("interrupt_session calls the v2 SDK when permission is pre-allowed without a reason", async () => {
  interruptedSessionIDs.length = 0
  const tool = createInterruptSessionTool(pluginInput())

  await expect(tool.execute({}, preAllowedContext("session-pre-allowed"))).resolves.toBe("Current session interrupted.")
  expect(interruptedSessionIDs).toEqual(["session-pre-allowed"])
})
