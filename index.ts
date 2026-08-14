import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { applyPlan } from "./apply"
import { notify } from "./notify"
import { parseToml } from "./parse"
import { createPlan } from "./plan"
import { resolvePrompts } from "./prompts"
import { invalidFile, validateToml } from "./validate"

const tomlPath = `${Bun.env.HOME ?? ""}/.config/opencode/opencode-photon.toml`

async function readToml(): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  try {
    return { ok: true, text: await Bun.file(tomlPath).text() }
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export default async function photonPlugin(input: PluginInput): Promise<Hooks> {
  return {
    config: async (cfg) => {
      const loaded = await readToml()
      const validation = !loaded.ok
        ? invalidFile(`TOML unavailable: ${loaded.message}`)
        : (() => {
            const parsed = parseToml(loaded.text)
            return parsed.ok ? validateToml(parsed.value) : invalidFile(`TOML parse failed: ${parsed.message}`)
          })()
      const plan = createPlan(validation)
      const resolved = await resolvePrompts(plan.agents, tomlPath)
      const applied = applyPlan(cfg, plan.agents, resolved.prompts)
      await notify(input, [...plan.issues, ...resolved.issues], applied)
    },
  }
}
