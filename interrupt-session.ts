import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { z } from "zod"

function getAuthorizationHeader(): string | undefined {
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (password === undefined) return undefined

  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

export function createInterruptSessionTool(input: PluginInput): ToolDefinition {
  const authorization = getAuthorizationHeader()
  const client = createOpencodeClient({
    baseUrl: input.serverUrl.toString(),
    directory: input.directory,
    ...(authorization === undefined ? {} : { headers: { Authorization: authorization } }),
  })

  return {
    description: "Interrupt the current session's active execution.",
    args: {
      reason: z.string().optional(),
    },
    execute: async (args, context) => {
      await context.ask({
        permission: "interrupt_session",
        patterns: ["*"],
        always: [],
        metadata: {
          sessionID: context.sessionID,
          ...(args.reason === undefined ? {} : { reason: args.reason }),
        },
      })

      await client.v2.session.interrupt({ sessionID: context.sessionID })
      return "Current session interrupted."
    },
  }
}
