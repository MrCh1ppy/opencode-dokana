# opencode-dokana

opencode-dokana 是一个 OpenCode 插件，通过 `~/.config/opencode/opencode-dokana.toml` 集中管理八个 agent 的 `model`/`variant`/`prompt`/`permission` 覆盖。要求 opencode `>= 1.18.18`；这是面向 opencode Bun plugin loader 的 TypeScript source distribution。

当前版本：`0.4.0`。本版本将 `interrupt_session` 更新为面向子孙 task 的异步 v1 abort 请求，并明确 Orchestrator 与 Dispatcher 的后台/前台调度纪律。

## 背景

在类 OpenCode 的多 Agent Harness 中，几乎总会存在一个灵魂性的角色：**Orchestrator**。

Orchestrator 一方面需要直接与用户交互，理解并澄清用户需求，将复杂任务拆解成可执行的子任务，再根据不同子代理的能力进行路由与分配；另一方面，它还需要维护整个根任务的上下文，持续判断任务状态、评估执行结果，并决定下一步应该继续、重试、切换路径还是停止。

这些职责决定了 Orchestrator 往往必须使用具备较强推理、规划与上下文理解能力的模型。

问题也恰恰出现在这里。

传统多 Agent Harness 往往让 Orchestrator 同时承担两类性质完全不同的工作：

一类是高信息密度的决策工作，例如理解用户意图、任务拆解、架构判断、风险决策、结果验收和路径调整；

另一类则是高 Token 吞吐的执行工作，例如代码检索、文件阅读、工具调用、测试输出、失败重试、子代理往返以及大量中间状态维护。

后一类工作并不是无意义的浪费。它们通常是完成任务不可避免的成本。

真正的问题在于：**这些 Token 对执行过程是必要的，却没有必要全部由最昂贵、最聪明的模型来消费。**

于是便产生了一个很尴尬的矛盾：

Orchestrator 对模型智力的要求，使得它的单位 Token 成本通常较高；而它所承担的大量上下文维护和执行协调工作，又使它恰恰成为整个 Harness 中 Token 消耗最大的角色。

在实际的多 Agent 工作流中，超过一半的模型费用最终集中在 Orchestrator 身上，并不罕见。

而其中相当一部分成本，并不是用于真正需要高阶推理能力的决策，而是消耗在执行过程产生的大量低信息密度上下文之中。

**opencode-dokana（前身 opencode-photon）正是试图解决这个问题。**

它的核心思路很简单：

> 将 Orchestrator 与 Dispatcher 分离，让高智力模型负责决策，让高性价比模型负责执行。

Orchestrator 仍然作为整个 Harness 的唯一用户入口。

它负责理解用户需求、维护长期上下文、进行任务拆解、作出关键决策，并向 Dispatcher 下发一个边界明确的短期执行节点。

这个节点并不是一份细致到每一步操作的脚本，也不是一句笼统的"把这个问题解决掉"，而更接近一个 **bounded execution contract**：其中包含本阶段的目标、允许操作的范围、约束条件、验收标准以及必须返回的边界。

Dispatcher 则使用更高性价比的模型，在这个边界内部自主推进。

它负责组织具体的 Specialist 调用、恢复已有会话、进行代码检索和工具调用、执行检查、处理可逆重试、跟进有希望的分支，并从失败路径中回退。

换句话说，Dispatcher 负责吸收任务执行过程中不可避免的大量低信息密度 Token。

只要没有触及 Orchestrator 设定的边界，它就没有必要因为一次 Specialist 调用结束而立即返回。

只有当节点已经完成，或者继续推进需要新的权限、新的架构判断、更大的范围、用户输入，或者其他超出当前授权的决策时，Dispatcher 才会停止执行，并将本阶段的结果压缩成高信息密度的结论返回给 Orchestrator。

随后，Orchestrator 再根据这些经过压缩的证据作出下一阶段决策。

整个任务因此被转化为一系列不断循环的微型流程：

```text
Plan
  ↓
Bounded Build
  ↓
Compressed Evidence
  ↓
Re-plan
```

也可以更简单地理解为一系列微缩的：

```text
plan -> build -> plan -> build
```

在这个结构中，Orchestrator 不再需要亲自跟踪每一次工具调用、每一次代码搜索、每一次测试输出和每一次 Specialist 的中间过程。

它只需要处理那些真正需要其模型能力的部分。

Dokana 的目标并不是用廉价模型替代高智力模型，而是：

> **尽可能让高智力模型只处理那些必须足够聪明才能处理的问题。**

在目前的实际开发任务测试中，当 Orchestrator 使用 `kimi-for-coding/k3`，Dispatcher 使用 `DeepSeek V4 Flash` 时，相比由 K3 独立承担完整编排工作的传统 Orchestrator 架构，K3 的 Token 消耗可以降低超过 60%。

得益于 DeepSeek V4 Flash 较低的单位 Token 成本，在目前测试的任务样本中，整个 Harness 的综合模型费用可以降低约 50%，同时仍然保留高能力模型对用户意图、任务结构、关键决策和最终验收的控制权。

## 架构

```text
User <-> Orchestrator / GPT-5.6 Sol (high)
              |-- Oracle / GPT-5.6 Sol (xhigh)
              `-- Dispatcher / K3 (high)
                       |-- Explorer / DeepSeek V4 Flash (high)
                       |-- Low Fixer / DeepSeek V4 Flash (high)
                       |-- Medium Fixer / GPT-5.6 Terra (medium)
                       `-- Deep Fixer / GPT-5.6 Sol (medium)
```

- **Orchestrator** 是唯一的 primary agent，也是唯一直接与用户沟通的代理。它为 Dispatcher 定义有界执行节点，明确目标、范围、验收、约束和 mutation authority，评估结果并报告最终结果。
- **Dispatcher** 是有界的应用层协调器。在目标边界清楚后，它自主判断是否调查、选择或切换除 `deep-fixer` 外的 Specialist，决定调查与实施顺序，组织多次调用、恢复会话、执行获授权的检查、重试可逆操作、跟进分支和回退。它绝不与用户沟通，也不修改源文件。用户或 Orchestrator 明确指定 exact Specialist 时，该指定不可替代。
- **Oracle** 仅由 Orchestrator 调用，用于提供困难架构问题和根因分析方面的建议。
- **Explorer 和三个 Fixers** 是由 Dispatcher 调用的 Specialists。通常的回流路径是 `Specialist -> Dispatcher -> Orchestrator`；Dispatcher 可在同一节点内按证据和目标边界自主调查、实施、切换和重试。Dispatcher 不得自行选择 `deep-fixer`，必须获得用户或 Orchestrator 的明确授权。

`subagent_depth: 2` 允许调用链 `Orchestrator -> Dispatcher -> Specialist`，且不会更深。Dispatcher 可以在一个节点内多次调用或恢复所选的 Specialists。只有在任务确实需要逐步控制时，Orchestrator 才会要求每次调用后都返回。

## 代理

| 代理 | 推荐模式 | 模型 | 职责 |
| --- | --- | --- | --- |
| `orchestrator` | primary | `openai/gpt-5.6-sol` | 用户入口、战略决策、节点边界、验收和长期记忆。`edit: deny`、`bash: deny`。 |
| `dispatcher` | subagent | `kimi-for-coding/k3` | 执行获授权的节点：自主调用或恢复所选 Specialists，压缩结果，并在检查点返回。`edit: deny`、`bash: allow`（绝不用于修改源文件）。 |
| `sergeant` | primary | `openai/gpt-5.6-sol` | 与 `orchestrator` 并行的合并主代理：同时具备 Orchestrator 的用户入口/战略决策能力与 Dispatcher 的战术调度能力，直接调用所有 Specialists；调用 `deep-fixer` 为 `ask` 而非 `allow`。`edit: deny`、`bash: allow`。 |
| `oracle` | subagent | `code-mirror/gpt-5.6-sol` | 为不明确的架构、根因、安全性、兼容性或不可逆权衡提供高级建议。只读。 |
| `explorer` | subagent | `opencode-go/deepseek-v4-flash` | 只读代码库侦察和证据收集。 |
| `low-fixer` | subagent | `opencode-go/deepseek-v4-flash` | Mutating Specialist selected by Dispatcher according to the goal, evidence, approved method, and recovery needs. |
| `medium-fixer` | subagent | `code-mirror/gpt-5.6-terra` | Mutating Specialist selected by Dispatcher according to the goal, evidence, approved method, and recovery needs. |
| `deep-fixer` | subagent | `code-mirror/gpt-5.6-sol` | Explicitly authorized complex or high-risk work. |

以上为参考配置，实际 `model`/`variant` 由 `opencode-dokana.toml` 决定，可通过会话内 `ctrl+t` 临时覆盖。

## 路由循环

1. Orchestrator 解读用户请求，确定执行目标、范围和战略边界。
2. 它向 Dispatcher 下达一个节点指令，明确目标、范围、节点是否只读或允许变更、约束、验收标准和返回条件；mutation 必须显式授权其范围。
3. Dispatcher 自主判断是否调查，选择或恢复 Specialists，按需收集证据、实施、验证、重试或回退，并在检查点或边界处返回。
4. Orchestrator 决定是继续、重试节点、恢复同一个 Dispatcher 会话、咨询 Oracle、询问用户还是停止。
5. 当 Orchestrator 向用户报告最终结果时，循环结束。

Dispatcher advances autonomously within an authorized node and does not return merely because one Specialist call completed. It must return when the node is complete or an Orchestrator boundary is reached. Continuation, correction, validation, and retry work for the same deliverable reuses the original Dispatcher session (`task_id`) by default; create a new session only for an independent objective, when the user explicitly requests a clean context, or when the old context is confirmed stale or contaminated.

In mutation nodes, Dispatcher selects the appropriate mutating Specialist tactically after considering the goal, evidence, approved approach, and recovery needs. Mutation remains explicitly scoped and mutating Specialists remain sequential. Dispatcher may use `deep-fixer` only when the user or Orchestrator explicitly authorizes it. Only an exact Specialist actually explicitly required by the user or Orchestrator is binding and may not be replaced.

### 必须返回的边界

出现以下任一情况时，Dispatcher 必须返回：

- 节点已完成；
- 需要变更但未获授权；
- 已批准的范围必须扩大；
- 实现方法必须发生实质性变化；
- `deep-fixer` 未获用户或 Orchestrator 明确授权但又成为必要；
- 需要作出涉及架构、安全性、数据完整性、兼容性、公共 API、迁移或不可逆操作的决策；
- 需要用户输入；
- 重要证据仍然相互冲突；
- 获授权的方法失败，需要采用其他方法；
- 执行或重试预算已耗尽；或
- Orchestrator 设置了明确边界。

## 权限矩阵

| 权限 | orchestrator | dispatcher | oracle | explorer | fixers |
| --- | --- | --- | --- | --- | --- |
| mode | primary | subagent | subagent | subagent | subagent |
| edit | deny | deny | deny | deny | allow |
| bash | deny | allow (never to modify source files) | deny | allow (read-only by rule) | allow |
| read | allow | allow | allow | allow | 未设置 |
| lsp | deny | 未设置 | allow | 未设置 | 未设置 |
| grep/glob/list | deny | 未设置 | allow | allow | 未设置 |
| webfetch | deny | allow | 未设置 | allow | 未设置 |
| websearch | deny | 未设置 | 未设置 | allow | 未设置 |
| doom_loop | 未设置 | allow | 未设置 | 未设置 | 未设置 |
| todowrite | deny | allow | 未设置 | 未设置 | 未设置 |
| external_directory | ask | ask | ask | allow | allow |
| task -> dispatcher | allow | deny | deny | deny | deny |
| task -> oracle | allow | deny | deny | deny | deny |
| task -> explorer | deny | allow | deny | deny | deny |
| task -> fixers | deny | allow | deny | deny | deny |
| interrupt_session | allow | allow | deny | deny | deny |
| skill | `*: deny`, `customize-opencode: allow` | `*: deny`, `customize-opencode: allow` | `*: deny`, `customize-opencode: allow` | `*: deny`, `customize-opencode: allow` | `*: deny`, `customize-opencode: allow`, `ponytail: allow` |

Fixers 是唯一可以修改源文件的代理。尽管 Dispatcher 和 Explorer 具有 `bash: allow`，但它们的提示词规则将 Bash 限制为只读或验证用途。它们绝不能使用 Bash 绕过 `edit: deny` 来修改源文件。

## 中断子孙任务

插件提供 `interrupt_session` 自定义工具，用于请求取消当前 session 的子孙任务。签名为 `interrupt_session({ task_id: string, reason?: string })`，其中 `task_id` 必填且不能为空；目标不能是当前 session，必须沿目标 session 的 `parentID` 链最终直接连接到当前 session。工具先完成基本 `task_id` 校验，再经过 `interrupt_session` 权限询问，metadata 会包含当前 `sessionID`、目标 `task_id` 以及存在时的 `reason`。

默认权限为 `orchestrator: allow`、`dispatcher: allow`，`explorer`、`low-fixer`、`medium-fixer`、`deep-fixer` 与 `oracle` 均为 `deny`。TOML 可将该 permission 覆盖为 `allow`、`ask` 或 `deny`。

工具使用 v1 `client.session.get({ path: { id } })` 验证 parent 链，目标合法后严格调用 `client.session.abort({ path: { id: task_id } })`。该 abort 作用于目标 `BackgroundJob`，遵循递归取消语义；abort 异步生效，返回成功只表示已向目标发送 cancellation request，不等于已确认停止。错误、缺少 data 或 `false` 都会报告为失败，不会伪装成成功。TUI 的 Esc 中断路径独立，未被此插件改动。若设置 `OPENCODE_SERVER_PASSWORD`，插件会使用 `OPENCODE_SERVER_USERNAME`（默认 `opencode`）发送 HTTP Basic `Authorization`；未设置密码时不会发送该 header。

Orchestrator 调用 Dispatcher 必须无条件使用 `task` 工具的 `background=true`，并记录返回的 `task_id`；需要取消时调用 `interrupt_session(task_id)`，不能省略 `task_id`。Dispatcher 调用 Explorer、low-fixer、medium-fixer 或 deep-fixer 时必须无条件前台执行，不得使用 `background=true`。

## 安装

### npm 方式

在 `opencode.json` 的 `plugin` 数组中加入：

```json
{
  "plugin": ["@mrch1ppy/opencode-dokana"]
}
```

### 本地路径方式

将本仓库 clone 到 `~/.config/opencode/plugins/opencode-dokana`，然后在 `opencode.json` 的 `plugin` 数组中加入：

```json
{
  "plugin": ["./plugins/opencode-dokana"]
}
```

仓库内需执行一次 `bun install` 以解析 `toml`、`@opencode-ai/sdk` 和 `zod` runtime 依赖。

## 配置

插件在启动时优先读取用户的 `~/.config/opencode/opencode-dokana.toml`；该文件不存在时加载仓库内的 `opencode-dokana.default.toml`。两者不会逐键合并。完整示例：

```toml
[agents.orchestrator]
model="openai/gpt-5.6-sol"
variant="high"

[agents.dispatcher]
model="kimi-for-coding/k3"
variant="high"

[agents.oracle]
model="code-mirror/gpt-5.6-sol"
variant="xhigh"

[agents.explorer]
model="opencode-go/deepseek-v4-flash"
variant="high"

[agents.low-fixer]
model="opencode-go/deepseek-v4-flash"
variant="high"

[agents.medium-fixer]
model="code-mirror/gpt-5.6-terra"
variant="medium"

[agents.deep-fixer]
model="code-mirror/gpt-5.6-sol"
variant="medium"

[agents.dispatcher.permission]
edit="deny"
bash="allow"
external_directory="ask"
interrupt_session="allow"

[agents.dispatcher.permission.task]
"*"="deny"
explorer="allow"
"medium-fixer"="allow"
```

优先级：

- `model`/`variant`：会话内 `ctrl+t`（临时） > TOML > agent `.md` frontmatter。
- `prompt`：TOML `prompt` 路径 > 插件内置 `prompts/<agent>.md`。
- `permission`：TOML > 插件默认矩阵。插件会接管并替换所有 agent-level permission 来源，包括 agent frontmatter 和 `opencode.json`；TOML 未覆盖的 key 保留插件默认值。

`permission` 使用 OpenCode 原生 permission 对象形态。普通 key 直接写在 `[agents.<id>.permission]` 下；`task` 支持标量整体替换：

```toml
[agents.medium-fixer.permission]
edit="allow"
task="deny"
```

也支持 task 表逐 key 合并：

```toml
[agents.dispatcher.permission.task]
"*"="deny"
"medium-fixer"="allow"
```

`skill` 表不会逐 key 合并：自定义 TOML 中的 `permission.skill` 会整体替换默认 skill 表。使用白名单时必须先写 `"*"="deny"`，再写具体技能的 `allow`：

```toml
[agents.medium-fixer.permission.skill]
"*"="deny"
customize-opencode="allow"
ponytail="allow"
```

插件不枚举校验 permission key 或 permission value。未知 key 原样透传，非法值交给 OpenCode 自身 schema 在启动时校验。

插件内置默认权限矩阵：

| Agent | 默认 permission |
| --- | --- |
| `orchestrator` | `edit: deny`, `bash: deny`, `external_directory: ask`, `read: allow`, `question: allow`, `todowrite: deny`, `grep: deny`, `glob: deny`, `list: deny`, `webfetch: deny`, `websearch: deny`, `lsp: deny`, `interrupt_session: allow`, `task.*: deny`, `task.dispatcher: allow`, `task.oracle: allow`, `skill.*: deny`, `skill.customize-opencode: allow` |
| `dispatcher` | `edit: deny`, `bash: allow`, `todowrite: allow`, `read: allow`, `webfetch: allow`, `doom_loop: allow`, `external_directory: ask`, `interrupt_session: allow`, `task.*: deny`, `task.explorer/low-fixer/medium-fixer/deep-fixer: allow`, `skill.*: deny`, `skill.customize-opencode: allow` |
| `sergeant` | `edit: deny`, `bash: allow`, `external_directory: ask`, `read: allow`, `question: allow`, `todowrite: allow`, `grep: allow`, `glob: allow`, `list: allow`, `webfetch: allow`, `websearch: allow`, `lsp: allow`, `doom_loop: allow`, `interrupt_session: allow`, `task.*: deny`, `task.explorer/low-fixer/medium-fixer/oracle: allow`, `task.deep-fixer: ask`, `skill.*: deny`, `skill.customize-opencode: allow` |
| `explorer` | `edit: deny`, `bash: allow`, `external_directory: allow`, `task: deny`, `glob: allow`, `grep: allow`, `list: allow`, `webfetch: allow`, `websearch: allow`, `read: allow`, `interrupt_session: deny`, `skill.*: deny`, `skill.customize-opencode: allow` |
| `low-fixer` | `edit: allow`, `bash: allow`, `external_directory: allow`, `task: deny`, `interrupt_session: deny`, `skill.*: deny`, `skill.customize-opencode: allow`, `skill.ponytail: allow` |
| `medium-fixer` | `edit: allow`, `bash: allow`, `external_directory: allow`, `task: deny`, `interrupt_session: deny`, `skill.*: deny`, `skill.customize-opencode: allow`, `skill.ponytail: allow` |
| `deep-fixer` | `edit: allow`, `bash: allow`, `external_directory: allow`, `task: deny`, `interrupt_session: deny`, `skill.*: deny`, `skill.customize-opencode: allow`, `skill.ponytail: allow` |
| `oracle` | `edit: deny`, `bash: deny`, `read: allow`, `grep: allow`, `glob: allow`, `list: allow`, `lsp: allow`, `external_directory: ask`, `task: deny`, `interrupt_session: deny`, `skill.*: deny`, `skill.customize-opencode: allow` |

prompt 路径必须为 `.md` 文件，相对 TOML 所在目录解析，支持 `~/` 展开。

错误回退：

- 用户 TOML 不存在时加载仓库默认 TOML；所选 TOML 缺失或解析失败时，model/variant/prompt 不应用 TOML 覆盖，仍使用各自默认；插件默认 permission 矩阵仍然应用。
- 单个 agent 的 `model`/`variant` 非法时，该 agent 的这两个字段原子回退到 frontmatter 默认。
- `prompt` 路径非法或不可读时，回退到插件内置默认 `prompts/<agent>.md`。

## 许可证

MIT
