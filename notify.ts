import type { PluginInput } from "@opencode-ai/plugin"
import type { AppliedAgent } from "./apply"
import type { Issue } from "./validate"

const service = "opencode-photon"

async function appLog(input: PluginInput, level: "info" | "warn" | "error", message: string): Promise<void> {
  try {
    await input.client.app.log({ body: { service, level, message } })
  } catch (error: unknown) {
    console.error(`[${service}] log delivery failed:`, error)
  }
}

export async function notify(input: PluginInput, issues: Issue[], applied: AppliedAgent[]): Promise<void> {
  for (const issue of issues) await appLog(input, "warn", issue.message)
  for (const agent of applied) {
    await appLog(input, "info", `${agent.id}: model=${agent.model.source}:${agent.model.value}; variant=${agent.variant.source}:${agent.variant.value}; prompt=${agent.prompt.source}:${agent.prompt.value}`)
  }
  const message = issues.length === 0 ? "Photon agent overrides applied" : `Photon 配置完成，发现 ${issues.length} 个问题：${issues.map((issue) => issue.message).join("；")}`
  try {
    await input.client.tui.showToast({ body: { title: "Photon", message, variant: issues.length === 0 ? "success" : "warning" } })
  } catch (error: unknown) {
    await appLog(input, "error", `Toast delivery failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
