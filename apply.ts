import type { Config } from "@opencode-ai/plugin"
import type { AgentPlan } from "./plan"
import type { ResolvedPrompt } from "./prompts"

export type AppliedAgent = {
  id: AgentPlan["id"]
  model: { source: "default" | "toml-override"; value: string }
  variant: { source: "default" | "toml-override"; value: string }
  prompt: { source: ResolvedPrompt["source"]; value: string }
}

function existingString(value: unknown): string {
  return typeof value === "string" ? value : "(not set)"
}

export function applyPlan(cfg: Config, plans: AgentPlan[], prompts: ResolvedPrompt[]): AppliedAgent[] {
  const promptById = new Map(prompts.map((prompt) => [prompt.id, prompt]))
  const agent = { ...cfg.agent }
  const applied: AppliedAgent[] = []
  for (const plan of plans) {
    const current = agent[plan.id] ?? {}
    const prompt = promptById.get(plan.id)
    const update: { model?: string; variant?: string; prompt?: string } = {}
    if (plan.model !== undefined && plan.variant !== undefined) {
      update.model = plan.model
      update.variant = plan.variant
    }
    if (prompt?.content !== undefined) update.prompt = prompt.content
    agent[plan.id] = { ...current, ...update }
    applied.push({
      id: plan.id,
      model: { source: update.model === undefined ? "default" : "toml-override", value: update.model ?? existingString(current.model) },
      variant: { source: update.variant === undefined ? "default" : "toml-override", value: update.variant ?? existingString(current.variant) },
      prompt: { source: prompt?.source ?? "not-applied", value: prompt?.content === undefined ? "(not applied)" : prompt.path },
    })
  }
  cfg.agent = agent
  return applied
}
