import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin"
import { z } from "zod"

const MAX_PARENT_CHAIN_DEPTH = 1_000

function describeSdkError(error: unknown): string {
  if (typeof error === "string") return error
  if (typeof error !== "object" || error === null) return "unknown SDK error"

  const record = error as Record<string, unknown>
  if (typeof record.message === "string") return record.message
  if (typeof record.data === "object" && record.data !== null) {
    const data = record.data as Record<string, unknown>
    if (typeof data.message === "string") return data.message
  }
  if (typeof record.name === "string") return record.name
  return "unknown SDK error"
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const record = error as Record<string, unknown>
  return record.name === "NotFoundError"
}

export function createInterruptSessionTool(input: PluginInput): ToolDefinition {
  const client = input.client

  return {
    description: "Request asynchronous cancellation of a descendant task.",
    args: {
      task_id: z.string({ error: "必须提供目标任务的 task_id" }).trim().min(1, "必须提供目标任务的 task_id"),
      reason: z.string().optional(),
    },
    execute: async (args, context) => {
      const taskID = typeof args?.task_id === "string" ? args.task_id.trim() : ""
      if (taskID.length === 0) {
        throw new Error("A target task's task_id must be provided to interrupt it.")
      }

      await context.ask({
        permission: "interrupt_session",
        patterns: ["*"],
        always: [],
        metadata: {
          sessionID: context.sessionID,
          task_id: taskID,
          ...(args.reason === undefined ? {} : { reason: args.reason }),
        },
      })

      if (taskID === context.sessionID) {
        throw new Error(`Task "${taskID}" is the current session, not a descendant task.`)
      }

      const visited = new Set<string>()
      let currentID = taskID
      let depth = 0

      while (depth < MAX_PARENT_CHAIN_DEPTH) {
        if (visited.has(currentID)) {
          throw new Error(`Unable to verify task "${taskID}": the parent session chain contains a cycle.`)
        }
        visited.add(currentID)

        let result
        try {
          result = await client.session.get({ path: { id: currentID } })
        } catch (error) {
          throw new Error(`Unable to verify task "${taskID}": reading session "${currentID}" failed: ${describeSdkError(error)}.`)
        }

        if (result.error !== undefined) {
          if (currentID === taskID && isNotFoundError(result.error)) {
            throw new Error(`Target task "${taskID}" does not exist.`)
          }
          throw new Error(`Unable to verify task "${taskID}": reading parent session "${currentID}" failed: ${describeSdkError(result.error)}.`)
        }
        if (result.data === undefined) {
          if (currentID === taskID) {
            throw new Error(`Target task "${taskID}" does not exist: session.get returned no data.`)
          }
          throw new Error(`Unable to verify task "${taskID}": parent session "${currentID}" returned no data.`)
        }

        const parentID = result.data.parentID
        if (parentID === context.sessionID) break
        if (typeof parentID !== "string" || parentID.trim().length === 0) {
          throw new Error(`Task "${taskID}" is not a descendant of the current session.`)
        }

        currentID = parentID
        depth += 1
      }

      if (depth >= MAX_PARENT_CHAIN_DEPTH) {
        throw new Error(`Unable to verify task "${taskID}": the parent session chain is too deep or cyclic.`)
      }

      let abortResult
      try {
        abortResult = await client.session.abort({ path: { id: taskID } })
      } catch (error) {
        throw new Error(`Failed to request cancellation for task "${taskID}": ${describeSdkError(error)}.`)
      }
      if (abortResult.error !== undefined) {
        throw new Error(`Failed to request cancellation for task "${taskID}": ${describeSdkError(abortResult.error)}.`)
      }
      if (abortResult.data !== true) {
        throw new Error(`Failed to request cancellation for task "${taskID}": v1 session.abort returned no successful cancellation request.`)
      }

      return `Cancellation requested for task "${taskID}" via v1 client.session.abort. Cancellation is asynchronous; this response does not confirm that the task has stopped.`
    },
  }
}
