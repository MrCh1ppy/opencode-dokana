import type { AgentId } from "./validate"

export type PermissionScalar = "ask" | "allow" | "deny"
export type PermissionValue = PermissionScalar | Readonly<Record<string, PermissionScalar>>
export type PermissionObject = Readonly<Record<string, unknown>>
export type PermissionOverride = Readonly<Record<string, unknown>>

type DefaultPermission = Readonly<Record<string, PermissionValue>>

export const defaultPermissions = {
  // Primary user-facing planner: no direct mutation or shell access.
  orchestrator: {
    edit: "deny",
    bash: "deny",
    external_directory: "ask",
    read: "allow",
    question: "allow",
    todowrite: "allow",
    task: {
      "*": "deny",
      dispatcher: "allow",
      oracle: "allow",
    },
  },
  // Bounded coordinator: can run checks and route only to approved specialists.
  dispatcher: {
    edit: "deny",
    bash: "allow",
    todowrite: "allow",
    read: "allow",
    webfetch: "allow",
    doom_loop: "allow",
    external_directory: "ask",
    task: {
      "*": "deny",
      explorer: "allow",
      "low-fixer": "allow",
      "medium-fixer": "allow",
      "deep-fixer": "allow",
    },
  },
  // Read-only repository scout.
  explorer: {
    edit: "deny",
    bash: "allow",
    external_directory: "allow",
    task: "deny",
    glob: "allow",
    grep: "allow",
    list: "allow",
    webfetch: "allow",
    websearch: "allow",
    read: "allow",
  },
  // Low-risk reversible implementer.
  "low-fixer": {
    edit: "allow",
    bash: "allow",
    external_directory: "allow",
    task: "deny",
  },
  // Standard multi-file implementer.
  "medium-fixer": {
    edit: "allow",
    bash: "allow",
    external_directory: "allow",
    task: "deny",
  },
  // High-risk implementer for approved complex changes.
  "deep-fixer": {
    edit: "allow",
    bash: "allow",
    external_directory: "allow",
    task: "deny",
  },
  // Read-only architecture and root-cause advisor.
  oracle: {
    edit: "deny",
    bash: "deny",
    read: "allow",
    grep: "allow",
    glob: "allow",
    list: "allow",
    lsp: "allow",
    external_directory: "ask",
    task: "deny",
  },
} as const satisfies Readonly<Record<AgentId, DefaultPermission>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function clonePermissionValue(value: PermissionValue): PermissionValue {
  return isRecord(value) ? { ...value } as Readonly<Record<string, PermissionScalar>> : value
}

function mergeTask(defaultTask: PermissionValue | undefined, overrideTask: unknown): unknown {
  if (!isRecord(overrideTask)) return overrideTask
  const defaults = isRecord(defaultTask) ? defaultTask : {}
  const merged: Record<string, unknown> = {}
  if ("*" in defaults) merged["*"] = defaults["*"]
  if ("*" in overrideTask) merged["*"] = overrideTask["*"]
  for (const [key, value] of Object.entries(defaults)) {
    if (key !== "*") merged[key] = value
  }
  for (const [key, value] of Object.entries(overrideTask)) {
    if (key !== "*") merged[key] = value
  }
  return merged
}

export function effectivePermission(id: AgentId, override?: PermissionOverride): PermissionObject {
  const defaults = defaultPermissions[id]
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(defaults)) result[key] = clonePermissionValue(value)
  if (override === undefined) return result
  for (const [key, value] of Object.entries(override)) {
    result[key] = key === "task" ? mergeTask(defaults.task, value) : value
  }
  return result
}
