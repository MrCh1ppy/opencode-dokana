import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Config, PluginInput } from "@opencode-ai/plugin"
import dokanaPlugin from "./index"

test("the config hook replaces existing permission while preserving other agent fields", async () => {
  const home = await mkdtemp(join(tmpdir(), "opencode-dokana-test-"))
  const previousHome = process.env.HOME
  try {
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await writeFile(join(home, ".config", "opencode", "opencode-dokana.toml"), [
      "[agents.dispatcher.permission]",
      "read = \"deny\"",
      "custom_permission = \"not-an-opencode-enum\"",
      "",
      "[agents.dispatcher.permission.task]",
      "\"*\" = \"ask\"",
      "oracle = \"allow\"",
    ].join("\n"))
    process.env.HOME = home

    const input = {
      client: {
        app: { log: async () => undefined },
        tui: { showToast: async () => undefined },
      },
    } as unknown as PluginInput
    const hooks = await dokanaPlugin(input)
    const cfg = {
      agent: {
        dispatcher: {
          model: "existing/model",
          description: "existing description",
          mode: "subagent",
          maxSteps: 3,
          permission: { edit: "ask" },
        },
      },
    } as unknown as Config

    await hooks.config?.(cfg)

    const dispatcher = cfg.agent?.dispatcher as unknown as Record<string, unknown>
    expect(dispatcher.model).toBe("existing/model")
    expect(dispatcher.description).toBe("existing description")
    expect(dispatcher.mode).toBe("subagent")
    expect(dispatcher.maxSteps).toBe(3)
    expect(dispatcher.permission).toEqual({
      edit: "deny",
      bash: "allow",
      todowrite: "allow",
      read: "deny",
      webfetch: "allow",
      doom_loop: "allow",
      external_directory: "ask",
      task: { "*": "ask", explorer: "allow", "low-fixer": "allow", "medium-fixer": "allow", "deep-fixer": "allow", oracle: "allow" },
      custom_permission: "not-an-opencode-enum",
    })
  } finally {
    process.env.HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
