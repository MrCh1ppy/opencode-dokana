import { dirname, join, resolve } from "node:path"
import type { AgentPlan } from "./plan"
import type { Issue } from "./validate"

export type ResolvedPrompt = {
  id: AgentPlan["id"]
  content?: string
  source: "default" | "toml-override" | "not-applied"
  path: string
}

function expandHome(path: string): string {
  if (!path.startsWith("~/")) return path
  const home = Bun.env.HOME
  return home === undefined ? path : join(home, path.slice(2))
}

function tomlPromptPath(tomlPath: string, prompt: string): string {
  const expanded = expandHome(prompt)
  return expanded.startsWith("/") ? expanded : resolve(dirname(tomlPath), expanded)
}

async function readPrompt(path: string): Promise<{ content: string } | { error: string }> {
  try {
    return { content: await Bun.file(path).text() }
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function resolvePrompts(plans: AgentPlan[], tomlPath: string): Promise<{ prompts: ResolvedPrompt[]; issues: Issue[] }> {
  const issues: Issue[] = []
  const prompts: ResolvedPrompt[] = []
  for (const plan of plans) {
    const defaultPath = join(import.meta.dir, "prompts", `${plan.id}.md`)
    if (plan.tomlPrompt !== undefined) {
      const overridePath = tomlPromptPath(tomlPath, plan.tomlPrompt)
      const override = await readPrompt(overridePath)
      if ("content" in override) {
        prompts.push({ id: plan.id, content: override.content, source: "toml-override", path: overridePath })
        continue
      }
      issues.push({ level: "warning", message: `Prompt path unreadable for ${plan.id}: ${overridePath} (${override.error}); plugin default will be used` })
    }
    const fallback = await readPrompt(defaultPath)
    if ("content" in fallback) {
      prompts.push({ id: plan.id, content: fallback.content, source: "default", path: defaultPath })
    } else {
      issues.push({ level: "warning", message: `Default prompt missing for ${plan.id}: ${defaultPath} (${fallback.error})` })
      prompts.push({ id: plan.id, source: "not-applied", path: defaultPath })
    }
  }
  return { prompts, issues }
}
