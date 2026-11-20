import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Config, PluginInput } from "@opencode-ai/plugin"
import dokanaPlugin from "./index"
import { parseToml } from "./parse"
import { createPlan } from "./plan"
import { validateToml } from "./validate"

type ConfigWithSkills = Config & { skills?: { paths?: string[] } }

test("the config hook replaces existing permission while preserving other agent fields", async () => {
  const home = await mkdtemp(join(tmpdir(), "opencode-dokana-test-"))
  const previousHome = process.env.HOME
  try {
    await mkdir(join(home, ".config", "opencode"), { recursive: true })
    await writeFile(join(home, ".config", "opencode", "opencode-dokana.toml"), [
      "[agents.sergeant.permission]",
      "read = \"deny\"",
      "custom_permission = \"not-an-opencode-enum\"",
      "",
      "[agents.sergeant.permission.task]",
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
        sergeant: {
          model: "existing/model",
          description: "existing description",
          mode: "subagent",
          maxSteps: 3,
          permission: { edit: "ask" },
        },
      },
    } as unknown as ConfigWithSkills

    await hooks.config?.(cfg)

    const skillsPaths = cfg.skills?.paths ?? []
    expect(skillsPaths.some((path) => path.endsWith("skills") && path.startsWith("/"))).toBe(true)
    const skillsPathCount = skillsPaths.length
    await hooks.config?.(cfg)
    expect(cfg.skills?.paths).toHaveLength(skillsPathCount)

    const sergeant = cfg.agent?.sergeant as unknown as Record<string, unknown>
    expect(sergeant.model).toBe("existing/model")
    expect(sergeant.description).toBe("existing description")
    expect(sergeant.mode).toBe("subagent")
    expect(sergeant.maxSteps).toBe(3)
    expect(sergeant.permission).toEqual({
      edit: "allow",
      bash: "allow",
      todowrite: "allow",
      read: "deny",
      webfetch: "allow",
      doom_loop: "allow",
      external_directory: "ask",
      interrupt_session: "allow",
      question: "allow",
      grep: "allow",
      glob: "allow",
      list: "allow",
      websearch: "allow",
      lsp: "allow",
      task: { "*": "ask", explorer: "allow", "low-worker": "allow", "medium-worker": "allow", "frontend-worker": "allow", oracle: "allow", "deep-worker": "ask" },
      skill: { "*": "deny", "customize-opencode": "allow" },
      custom_permission: "not-an-opencode-enum",
    })
  } finally {
    process.env.HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})

test("legacy TOML agents warn and are not injected", () => {
  const legacyIds = ["orchestrator", "dispatcher", "low-fixer", "medium-fixer", "deep-fixer"]
  const parsed = parseToml(legacyIds.map((id) => `[agents.${id}]\nmodel="openai/model"\nvariant="high"`).join("\n\n"))
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return

  const validation = validateToml(parsed.value)
  expect(validation.issues).toEqual(legacyIds.map((id) => ({ level: "warning", message: `Unknown agent ignored: ${id}` })))
  expect(validation.agents).toEqual({})
  expect(createPlan(validation).agents.map((plan) => plan.id)).toEqual([
    "sergeant",
    "explorer",
    "low-worker",
    "medium-worker",
    "deep-worker",
    "frontend-worker",
    "oracle",
  ])
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
    const cfg = { agent: {} } as unknown as ConfigWithSkills

    await hooks.config?.(cfg)

    expect(Object.fromEntries(Object.entries(cfg.agent ?? {}).map(([id, agent]) => [id, { model: agent?.model, variant: agent?.variant }]))).toEqual({
      sergeant: { model: "openai/gpt-5.6-sol", variant: "high" },
      oracle: { model: "code-mirror/gpt-5.6-sol", variant: "xhigh" },
      explorer: { model: "opencode-go/deepseek-v4-flash", variant: "high" },
      "low-worker": { model: "opencode-go/deepseek-v4-flash", variant: "high" },
      "medium-worker": { model: "code-mirror/gpt-5.6-terra", variant: "medium" },
      "deep-worker": { model: "code-mirror/gpt-5.6-sol", variant: "medium" },
      "frontend-worker": { model: "code-mirror/gpt-5.6-terra", variant: "medium" },
    })
    for (const [id, agent] of Object.entries(cfg.agent ?? {})) {
      expect(agent?.prompt).toBe(await readFile(join(import.meta.dir, "prompts", `${id}.md`), "utf8"))
    }
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
