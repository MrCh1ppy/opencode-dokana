import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { resolve } from "node:path"
import { applyPlan } from "./apply"
import { createInterruptSessionTool } from "./interrupt-session"
import { notify } from "./notify"
import { parseToml } from "./parse"
import { createPlan } from "./plan"
import { resolvePrompts } from "./prompts"
import { invalidFile, validateToml } from "./validate"

function getTomlPath(): string {
  return `${process.env.HOME ?? Bun.env.HOME ?? ""}/.config/opencode/opencode-dokana.toml`
}

function getDefaultTomlPath(): string {
  return resolve(import.meta.dir, "opencode-dokana.default.toml")
}

async function readToml(tomlPath: string): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  try {
    return { ok: true, text: await Bun.file(tomlPath).text() }
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export default async function dokanaPlugin(input: PluginInput): Promise<Hooks> {
  return {
    tool: {
      interrupt_session: createInterruptSessionTool(input),
    },
    config: async (cfg) => {
      const skillsDir = resolve(import.meta.dir, "skills")
      cfg.skills = cfg.skills ?? {}
      cfg.skills.paths = cfg.skills.paths ?? []
      if (!cfg.skills.paths.includes(skillsDir)) cfg.skills.paths.push(skillsDir)

      const userTomlPath = getTomlPath()
      const tomlPath = await Bun.file(userTomlPath).exists() ? userTomlPath : getDefaultTomlPath()
      const loaded = await readToml(tomlPath)
      const validation = !loaded.ok
        ? invalidFile(`TOML unavailable: ${loaded.message}`)
        : (() => {
            const parsed = parseToml(loaded.text)
            return parsed.ok ? validateToml(parsed.value) : invalidFile(`TOML parse failed: ${parsed.message}`)
          })()
      const plan = createPlan(validation)
      const resolved = await resolvePrompts(plan.agents, tomlPath)
      const applied = applyPlan(cfg, plan.agents, resolved.prompts)
      void notify(input, [...plan.issues, ...resolved.issues], applied).catch((error: unknown) => {
        console.error("[opencode-dokana] notify failed:", error)
      })
    },
  }
}
