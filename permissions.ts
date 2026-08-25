import type { AgentId } from "./validate"

export type Action = "allow" | "deny" | "ask"
export type PermissionScalar = Action

export const PERMISSION_KEYS = {
  edit: "edit",
  bash: "bash",
  externalDirectory: "external_directory",
  read: "read",
  question: "question",
  todowrite: "todowrite",
  task: "task",
  webfetch: "webfetch",
  doomLoop: "doom_loop",
  glob: "glob",
  grep: "grep",
  list: "list",
  websearch: "websearch",
  lsp: "lsp",
  interruptSession: "interrupt_session",
} as const

export const TASK_KEYS = {
  wildcard: "*",
} as const

type DefaultPermissionKey = (typeof PERMISSION_KEYS)[keyof typeof PERMISSION_KEYS]
type DefaultTaskKey = (typeof TASK_KEYS)[keyof typeof TASK_KEYS] | AgentId
type DefaultTask = Readonly<Partial<Record<DefaultTaskKey, Action>>>
type DefaultPermissionValue = Action | DefaultTask

export type PermissionValue = DefaultPermissionValue
export type PermissionObject = Readonly<Record<string, unknown>>
export type PermissionOverride = Readonly<Record<string, unknown>>

export type DefaultPermission = Readonly<Partial<Record<Exclude<DefaultPermissionKey, typeof PERMISSION_KEYS.task>, Action>>> &
  Readonly<{ [PERMISSION_KEYS.task]?: DefaultPermissionValue }>

export const defaultPermissions = {
  // Primary user-facing planner: no direct mutation or shell access.
  orchestrator: {
    edit: "deny",
    bash: "deny",
    external_directory: "ask",
    read: "allow",
    question: "allow",
    todowrite: "allow",
    grep: "deny",
    glob: "deny",
    list: "deny",
    webfetch: "deny",
    websearch: "deny",
    lsp: "deny",
    interrupt_session: "allow",
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
    interrupt_session: "allow",
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
    interrupt_session: "deny",
  },
  // Low-risk reversible implementer.
  "low-fixer": {
    edit: "allow",
    bash: "allow",
    external_directory: "allow",
    task: "deny",
    interrupt_session: "deny",
  },
  // Standard multi-file implementer.
  "medium-fixer": {
    edit: "allow",
    bash: "allow",
    external_directory: "allow",
    task: "deny",
    interrupt_session: "deny",
  },
  // High-risk implementer for approved complex changes.
  "deep-fixer": {
    edit: "allow",
    bash: "allow",
    external_directory: "allow",
    task: "deny",
    interrupt_session: "deny",
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
    interrupt_session: "deny",
  },
} as const satisfies Readonly<Record<AgentId, DefaultPermission>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function clonePermissionValue(value: PermissionValue): PermissionValue {
  return isRecord(value) ? { ...value } as DefaultTask : value
}

function mergeTask(defaultTask: PermissionValue | undefined, overrideTask: unknown): unknown {
  if (!isRecord(overrideTask)) return overrideTask
  const defaults = isRecord(defaultTask) ? defaultTask : {}
  const merged: Record<string, unknown> = {}
  if (TASK_KEYS.wildcard in defaults) merged[TASK_KEYS.wildcard] = defaults[TASK_KEYS.wildcard]
  if (TASK_KEYS.wildcard in overrideTask) merged[TASK_KEYS.wildcard] = overrideTask[TASK_KEYS.wildcard]
  for (const [key, value] of Object.entries(defaults)) {
    if (key !== TASK_KEYS.wildcard) merged[key] = value
  }
  for (const [key, value] of Object.entries(overrideTask)) {
    if (key !== TASK_KEYS.wildcard) merged[key] = value
  }
  return merged
}

export function effectivePermission(id: AgentId, override?: PermissionOverride): PermissionObject {
  const defaults = defaultPermissions[id]
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(defaults)) result[key] = clonePermissionValue(value)
  if (override === undefined) return result
  for (const [key, value] of Object.entries(override)) {
    result[key] = key === PERMISSION_KEYS.task ? mergeTask(defaults[PERMISSION_KEYS.task], value) : value
  }
  return result
}
