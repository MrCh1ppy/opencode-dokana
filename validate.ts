export const agentIds = [
  "orchestrator",
  "dispatcher",
  "explorer",
  "low-fixer",
  "medium-fixer",
  "deep-fixer",
  "oracle",
] as const

export type AgentId = (typeof agentIds)[number]

export type Issue = {
  level: "warning"
  message: string
}

type AgentOverride = {
  model?: string
  variant?: string
  prompt?: string
}

export type ValidationResult = {
  agents: Partial<Record<AgentId, AgentOverride>>
  issues: Issue[]
  fileValid: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isAgentId(value: string): value is AgentId {
  return agentIds.includes(value as AgentId)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

export function invalidFile(message: string): ValidationResult {
  return { agents: {}, issues: [{ level: "warning", message }], fileValid: false }
}

export function validateToml(value: unknown): ValidationResult {
  if (!isRecord(value)) return invalidFile("TOML root must be a table")

  const issues: Issue[] = []
  for (const key of Object.keys(value)) {
    if (key !== "agents") issues.push({ level: "warning", message: `Unknown top-level key ignored: ${key}` })
  }

  const rawAgents = value.agents
  if (!isRecord(rawAgents)) {
    issues.push({ level: "warning", message: "Missing or invalid [agents] table" })
    return { agents: {}, issues, fileValid: false }
  }

  const agents: Partial<Record<AgentId, AgentOverride>> = {}
  for (const [id, rawAgent] of Object.entries(rawAgents)) {
    if (!isAgentId(id)) {
      issues.push({ level: "warning", message: `Unknown agent ignored: ${id}` })
      continue
    }
    if (!isRecord(rawAgent)) {
      issues.push({ level: "warning", message: `Invalid agent table: ${id}` })
      continue
    }

    const override: AgentOverride = {}
    const model = rawAgent.model
    const variant = rawAgent.variant
    const modelValid = nonEmptyString(model) && model.includes("/") && !model.startsWith("/") && !model.endsWith("/")
    const variantValid = nonEmptyString(variant)
    if (modelValid && variantValid) {
      override.model = model
      override.variant = variant
    } else {
      issues.push({ level: "warning", message: `Invalid model/variant for ${id}; both fields fall back to agent defaults` })
    }

    const prompt = rawAgent.prompt
    if (prompt !== undefined) {
      if (nonEmptyString(prompt) && prompt.endsWith(".md")) {
        override.prompt = prompt
      } else {
        issues.push({ level: "warning", message: `Invalid prompt path for ${id}; plugin default will be used` })
      }
    }
    agents[id] = override
  }
  return { agents, issues, fileValid: true }
}
