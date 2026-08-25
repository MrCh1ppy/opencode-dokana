import { expect, test } from "bun:test"
import type { Config } from "@opencode-ai/plugin"
import { applyPlan } from "./apply"
import { invalidFile, validateToml } from "./validate"
import { createPlan } from "./plan"
import { defaultPermissions, effectivePermission, type DefaultPermission } from "./permissions"
import { parseToml } from "./parse"

// @ts-expect-error Default permission keys must be known native permission keys.
void ({ unknown_permission: "allow" } satisfies DefaultPermission)

// @ts-expect-error Default task keys must be the wildcard or a supported agent ID.
void ({ task: { "unknown-agent": "allow" } } satisfies DefaultPermission)

// @ts-expect-error Default permission actions must be valid actions.
void ({ edit: "unexpected-action" } satisfies DefaultPermission)

test("the seven default permission matrices match the approved snapshot", () => {
  expect(defaultPermissions).toEqual({
    orchestrator: { edit: "deny", bash: "deny", external_directory: "ask", read: "allow", question: "allow", todowrite: "allow", grep: "deny", glob: "deny", list: "deny", webfetch: "deny", websearch: "deny", lsp: "deny", interrupt_session: "allow", task: { "*": "deny", dispatcher: "allow", oracle: "allow" } },
    dispatcher: { edit: "deny", bash: "allow", todowrite: "allow", read: "allow", webfetch: "allow", doom_loop: "allow", external_directory: "ask", interrupt_session: "deny", task: { "*": "deny", explorer: "allow", "low-fixer": "allow", "medium-fixer": "allow", "deep-fixer": "allow" } },
    explorer: { edit: "deny", bash: "allow", external_directory: "allow", task: "deny", glob: "allow", grep: "allow", list: "allow", webfetch: "allow", websearch: "allow", read: "allow", interrupt_session: "deny" },
    "low-fixer": { edit: "allow", bash: "allow", external_directory: "allow", task: "deny", interrupt_session: "deny" },
    "medium-fixer": { edit: "allow", bash: "allow", external_directory: "allow", task: "deny", interrupt_session: "deny" },
    "deep-fixer": { edit: "allow", bash: "allow", external_directory: "allow", task: "deny", interrupt_session: "deny" },
    oracle: { edit: "deny", bash: "deny", read: "allow", grep: "allow", glob: "allow", list: "allow", lsp: "allow", external_directory: "ask", task: "deny", interrupt_session: "deny" },
  })
})

test("no TOML and invalid TOML plans still apply default permissions", () => {
  const cfg = { agent: {} } as unknown as Config
  applyPlan(cfg, createPlan(invalidFile("TOML unavailable")).agents, [])
  expect((cfg.agent?.orchestrator as { permission: unknown }).permission).toEqual(defaultPermissions.orchestrator)

  const parsed = parseToml("[agents\n")
  expect(parsed.ok).toBe(false)
  const invalid = parsed.ok ? validateToml(parsed.value) : invalidFile(parsed.message)
  applyPlan(cfg, createPlan(invalid).agents, [])
  expect((cfg.agent?.oracle as { permission: unknown }).permission).toEqual(defaultPermissions.oracle)
})

test("permission overrides retain defaults and pass unknown keys and values through", () => {
  const validation = validateToml({
    agents: {
      explorer: { permission: { read: "deny", future_permission: "unexpected-value" } },
    },
  })
  expect(validation.issues).toEqual([])
  const permission = effectivePermission("explorer", validation.agents.explorer?.permission)
  const expected = { ...defaultPermissions.explorer, read: "deny", future_permission: "unexpected-value" }
  expect(permission).toEqual(expected)
})

test("interrupt_session overrides support allow, ask, and deny", () => {
  for (const action of ["allow", "ask", "deny"] as const) {
    const validation = validateToml({
      agents: { dispatcher: { permission: { interrupt_session: action } } },
    })
    expect(validation.issues).toEqual([])
    expect(effectivePermission("dispatcher", validation.agents.dispatcher?.permission).interrupt_session).toBe(action)
  }
})

test("invalid interrupt_session values pass through without plugin issues", () => {
  const validation = validateToml({
    agents: { dispatcher: { permission: { interrupt_session: "bad-value" } } },
  })
  expect(validation.issues).toEqual([])
  expect(effectivePermission("dispatcher", validation.agents.dispatcher?.permission).interrupt_session).toBe("bad-value")
})

test("interrupt_session merges independently for every agent", () => {
  for (const id of Object.keys(defaultPermissions) as Array<keyof typeof defaultPermissions>) {
    expect(effectivePermission(id, { interrupt_session: "ask" }).interrupt_session).toBe("ask")
  }
})

test("task tables merge by key with wildcard first", () => {
  const permission = effectivePermission("dispatcher", {
    task: { "medium-fixer": "deny", "*": "ask", oracle: "allow" },
  })
  expect(permission.task).toEqual({
    "*": "ask",
    explorer: "allow",
    "low-fixer": "allow",
    "medium-fixer": "deny",
    "deep-fixer": "allow",
    oracle: "allow",
  })
  expect(Object.keys(permission.task as object)).toEqual(["*", "explorer", "low-fixer", "medium-fixer", "deep-fixer", "oracle"])
})

test("a scalar task override replaces the complete task table", () => {
  expect(effectivePermission("dispatcher", { task: "deny" }).task).toBe("deny")
})

test("effective permission creation never mutates default constants", () => {
  const before = structuredClone(defaultPermissions)
  const permission = effectivePermission("dispatcher", { task: { "*": "allow" }, edit: "allow" })
  expect(permission).not.toBe(defaultPermissions.dispatcher)
  expect(defaultPermissions).toEqual(before)
})

test("model, variant, prompt, and permission validation remain isolated", () => {
  const permissionOnly = validateToml({ agents: { oracle: { permission: { read: "bad-value" } } } })
  expect(permissionOnly.issues).toEqual([])
  expect(permissionOnly.agents.oracle?.permission).toEqual({ read: "bad-value" })

  const mixed = validateToml({
    agents: {
      oracle: { model: "openai/model", prompt: "custom.md", permission: { read: "bad-value" } },
    },
  })
  expect(mixed.agents.oracle).toEqual({ prompt: "custom.md", permission: { read: "bad-value" } })
  expect(mixed.issues).toEqual([{ level: "warning", message: "Invalid model/variant for oracle; both fields fall back to agent defaults" }])
})
