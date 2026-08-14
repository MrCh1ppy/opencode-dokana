import { agentIds, type AgentId, type Issue, type ValidationResult } from "./validate"

export type AgentPlan = {
  id: AgentId
  model?: string
  variant?: string
  tomlPrompt?: string
}

export type OverridePlan = {
  agents: AgentPlan[]
  issues: Issue[]
}

export function createPlan(validation: ValidationResult): OverridePlan {
  return {
    agents: agentIds.map((id) => ({
      id,
      model: validation.agents[id]?.model,
      variant: validation.agents[id]?.variant,
      tomlPrompt: validation.agents[id]?.prompt,
    })),
    issues: validation.issues,
  }
}
