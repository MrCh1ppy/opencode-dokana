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
  skill: "skill",
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
export type DefaultSkill = Readonly<Record<string, Action>>
type DefaultTaskValue = Action | DefaultTask
type DefaultPermissionValue = Action | DefaultTask | DefaultSkill

export type PermissionValue = DefaultPermissionValue
export type PermissionObject = Readonly<Record<string, unknown>>
export type PermissionOverride = Readonly<Record<string, unknown>>

export type DefaultPermission = Readonly<Partial<Record<Exclude<DefaultPermissionKey, typeof PERMISSION_KEYS.task | typeof PERMISSION_KEYS.skill>, Action>>> &
  Readonly<{ [PERMISSION_KEYS.task]?: DefaultTaskValue; [PERMISSION_KEYS.skill]?: DefaultSkill }>

export const defaultPermissions = {
  // Primary coordinator; deep-fixer requires approval.
  sergeant: {
    edit: "deny",
    bash: "allow",
    external_directory: "ask",
    read: "allow",
    question: "allow",
    todowrite: "allow",
    grep: "allow",
    glob: "allow",
    list: "allow",
    webfetch: "allow",
    websearch: "allow",
    lsp: "allow",
    doom_loop: "allow",
    interrupt_session: "allow",
    task: {
      "*": "deny",
      explorer: "allow",
      "low-fixer": "allow",
      "medium-fixer": "allow",
      oracle: "allow",
      "deep-fixer": "ask",
    },
    skill: {
      "*": "deny",
      "customize-opencode": "allow",
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
    skill: {
      "*": "deny",
      "customize-opencode": "allow",
    },
  },
  // Low-risk reversible implementer.
  "low-fixer": {
    edit: "allow",
    bash: "allow",
    external_directory: "allow",
    task: "deny",
    interrupt_session: "deny",
    skill: {
      "*": "deny",
      "customize-opencode": "allow",
      ponytail: "allow",
    },
  },
  // Standard multi-file implementer.
  "medium-fixer": {
    edit: "allow",
    bash: "allow",
    external_directory: "allow",
    task: "deny",
    interrupt_session: "deny",
    skill: {
      "*": "deny",
      "customize-opencode": "allow",
      ponytail: "allow",
    },
  },
  // High-risk implementer for approved complex changes.
  "deep-fixer": {
    edit: "allow",
    bash: "allow",
    external_directory: "allow",
    task: "deny",
    interrupt_session: "deny",
    skill: {
      "*": "deny",
      "customize-opencode": "allow",
      ponytail: "allow",
    },
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
    skill: {
      "*": "deny",
      "customize-opencode": "allow",
    },
  },
} as const satisfies Readonly<Record<AgentId, DefaultPermission>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function clonePermissionValue(value: PermissionValue): PermissionValue {
  return isRecord(value) ? { ...value } as DefaultTask | DefaultSkill : value
}

function mergeTask(defaultTask: DefaultTaskValue | undefined, overrideTask: unknown): unknown {
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
