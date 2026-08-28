import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Config, PluginInput } from "@opencode-ai/plugin"
import dokanaPlugin from "./index"
import { parseToml } from "./parse"

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
      directory: home,
      serverUrl: new URL("http://127.0.0.1:4096"),
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

    const skillsPaths = cfg.skills?.paths ?? []
    expect(skillsPaths.some((path) => path.endsWith("skills") && path.startsWith("/"))).toBe(true)
    const skillsPathCount = skillsPaths.length
    await hooks.config?.(cfg)
    expect(cfg.skills?.paths).toHaveLength(skillsPathCount)

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
      interrupt_session: "allow",
      task: { "*": "ask", explorer: "allow", "low-fixer": "allow", "medium-fixer": "allow", "deep-fixer": "allow", oracle: "allow" },
      skill: { "*": "deny", "customize-opencode": "allow" },
      custom_permission: "not-an-opencode-enum",
    })
  } finally {
    process.env.HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})

test("the config hook loads the repository default TOML when the user TOML is absent", async () => {
  const home = await mkdtemp(join(tmpdir(), "opencode-dokana-default-test-"))
  const previousHome = process.env.HOME
  try {
    process.env.HOME = home
    const input = {
      directory: home,
      serverUrl: new URL("http://127.0.0.1:4096"),
      client: {
        app: { log: async () => undefined },
        tui: { showToast: async () => undefined },
      },
    } as unknown as PluginInput
    const hooks = await dokanaPlugin(input)
    const cfg = { agent: {} } as unknown as Config

    await hooks.config?.(cfg)

    expect(Object.fromEntries(Object.entries(cfg.agent ?? {}).map(([id, agent]) => [id, { model: agent.model, variant: agent.variant }]))).toEqual({
      orchestrator: { model: "openai/gpt-5.6-sol", variant: "high" },
      dispatcher: { model: "kimi-for-coding/k3", variant: "high" },
      oracle: { model: "code-mirror/gpt-5.6-sol", variant: "xhigh" },
      explorer: { model: "opencode-go/deepseek-v4-flash", variant: "high" },
      "low-fixer": { model: "opencode-go/deepseek-v4-flash", variant: "high" },
      "medium-fixer": { model: "code-mirror/gpt-5.6-terra", variant: "medium" },
      "deep-fixer": { model: "code-mirror/gpt-5.6-sol", variant: "medium" },
    })
  } finally {
    process.env.HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})

test("the repository default TOML parses without permission tables", async () => {
  const parsed = parseToml(await readFile(join(import.meta.dir, "opencode-dokana.default.toml"), "utf8"))
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  const agents = (parsed.value as { agents: Record<string, Record<string, unknown>> }).agents
  for (const agent of Object.values(agents)) expect(agent.permission).toBeUndefined()
})
