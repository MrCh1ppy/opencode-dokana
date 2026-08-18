# opencode-dokana

opencode-dokana 是一个 OpenCode 插件，通过 `~/.config/opencode/opencode-dokana.toml` 集中管理七个 agent 的 `model`/`variant`/`prompt`/`permission` 覆盖。要求 opencode `>= 1.18.18`；这是面向 opencode Bun plugin loader 的 TypeScript source distribution。

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

这个节点并不是一份细致到每一步操作的脚本，也不是一句笼统的"把这个问题解决掉"，而更接近一个 **bounded execution contract**：其中包含本阶段的目标、允许操作的范围、可调用的 Specialist、约束条件、验收标准以及必须返回的边界。

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

> 注意！其中的 Orchestrator 可以替换为 GPT 5.6 Terra 或任何同等智力水平的模型，也就是说有 GPT 的订阅 + DeepSeek 的 API 也可以使用。K3 不是必备项，但仍然强烈建议使用 K3，因为其主动性更强，更加胜任编排。

```text
User <-> Orchestrator / K3 (max)
             |-- Oracle / GPT-5.6 Sol (xhigh)
             `-- Dispatcher / GPT-5.6 Terra (medium)
                       |-- Explorer / DeepSeek V4 Flash (high)
                       |-- Low Fixer / DeepSeek V4 Flash (high)
                       |-- Medium Fixer / GPT-5.6 Terra (medium)
                       `-- Deep Fixer / GPT-5.6 Sol (medium)
```

- **Orchestrator** 是唯一的 primary agent，也是唯一直接与用户沟通的代理。它为 Dispatcher 定义有界执行节点，授权 Specialists，评估结果并报告最终结果。
- **Dispatcher** 是有界的应用层协调器。在获得授权的节点内，它可以组织多次 Specialist 调用、恢复已有的 Specialist 会话、收集证据、执行获授权的检查、重试可逆操作、跟进有前景的分支，以及从无成果的分支回退。只有在节点完成或继续执行将越过 Orchestrator 边界时，它才会返回。它绝不与用户沟通，也不修改源文件。Orchestrator 可以指定必须使用的确切 Specialist，此时 Dispatcher 必须使用该 Specialist，不得替换；也可以授权一个有界 Specialist 集合，由 Dispatcher 在其中进行战术选择。
- **Oracle** 仅由 Orchestrator 调用，用于提供困难架构问题和根因分析方面的建议。
- **Explorer 和三个 Fixers** 是由 Dispatcher 调用的 Specialists。升级路径始终是 `Specialist -> Dispatcher -> Orchestrator`。

`subagent_depth: 2` 允许调用链 `Orchestrator -> Dispatcher -> Specialist`，且不会更深。Dispatcher 可以在一个节点内多次调用或恢复已授权的 Specialists。只有在任务确实需要逐步控制时，Orchestrator 才会要求每次调用后都返回。

## 代理

| 代理 | 推荐模式 | 模型 | 职责 |
| --- | --- | --- | --- |
| `orchestrator` | primary | `kimi-for-coding/k3` | 用户入口、决策、Specialist 选择、验收和长期记忆。`edit: deny`、`bash: deny`。 |
| `dispatcher` | subagent | `openai/gpt-5.6-terra` | 执行获授权的节点：调用或恢复已授权的 Specialists，压缩结果，并在检查点返回。`edit: deny`、`bash: allow`（绝不用于修改源文件）。 |
| `oracle` | subagent | `openai/gpt-5.6-sol` | 为不明确的架构、根因、安全性、兼容性或不可逆权衡提供高级建议。只读。 |
| `explorer` | subagent | `deepseek/deepseek-v4-flash` | 只读代码库侦察和证据收集。 |
| `low-fixer` | subagent | `deepseek/deepseek-v4-flash` | 简单、机械、低风险且可逆的变更。 |
| `medium-fixer` | subagent | `openai/gpt-5.6-terra` | 有界的多文件实现、标准重构和测试更新。 |
| `deep-fixer` | subagent | `openai/gpt-5.6-sol` | 对已批准架构进行复杂、高风险的实现，并提供 Rollback Plan。 |

以上为参考配置，实际 `model`/`variant` 由 `opencode-dokana.toml` 决定，可通过会话内 `ctrl+t` 临时覆盖。

## 路由循环

1. Orchestrator 解读用户请求并选择 Specialist 路径。
2. 它向 Dispatcher 下达一个节点指令，明确目标、范围、节点是否只读或允许变更、确切的 Specialist 或有界的授权集合、约束、验收标准和返回条件。
3. Dispatcher 通过调用或恢复已授权的 Specialists、收集证据，并在适当情况下重试或回退来执行节点；它在检查点或边界处返回。
4. Orchestrator 决定是继续、重试、切换 Specialist、恢复同一个 Dispatcher 会话、咨询 Oracle、询问用户还是停止。
5. 当 Orchestrator 向用户报告最终结果时，循环结束。

Dispatcher 会在获授权的节点内自主推进，不会仅因一次 Specialist 调用完成就返回。节点完成或到达 Orchestrator 边界时，它必须返回。一个根任务复用一个 Dispatcher 会话（`task_id`）。

### 必须返回的边界

出现以下任一情况时，Dispatcher 必须返回：

- 节点已完成；
- 调查已准备好转入实现；
- 需要变更但未获授权；
- 已批准的范围必须扩大；
- 实现方法必须发生实质性变化；
- 需要新的或未获授权的 Fixer；
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
| read/grep/glob/list/lsp | allow | allow | allow | allow | allow |
| external_directory | ask | ask | ask | ask | ask |
| task -> dispatcher | allow | deny | deny | deny | deny |
| task -> oracle | allow | deny | deny | deny | deny |
| task -> explorer | deny | allow | deny | deny | deny |
| task -> fixers | deny | allow | deny | deny | deny |
| interrupt_session | allow | deny | deny | deny | deny |

Fixers 是唯一可以修改源文件的代理。尽管 Dispatcher 和 Explorer 具有 `bash: allow`，但它们的提示词规则将 Bash 限制为只读或验证用途。它们绝不能使用 Bash 绕过 `edit: deny` 来修改源文件。

## 中断当前会话

插件提供 `interrupt_session` 自定义工具，用于中断当前会话的 active execution。参数可为空对象，也可传入可选的 `reason` 字符串；工具始终使用 tool context 的当前 `sessionID`，并先经过 `interrupt_session` 权限询问。

默认权限为 `orchestrator: allow`，`dispatcher`、`explorer`、`low-fixer`、`medium-fixer`、`deep-fixer` 与 `oracle` 均为 `deny`。TOML 可将该 permission 覆盖为 `allow`、`ask` 或 `deny`。

工具仅调用 SDK v2 的 `client.v2.session.interrupt({ sessionID })`，不调用 v1 abort。TUI 的 Esc 中断路径独立，未被此插件改动。若设置 `OPENCODE_SERVER_PASSWORD`，插件会使用 `OPENCODE_SERVER_USERNAME`（默认 `opencode`）发送 HTTP Basic `Authorization`；未设置密码时不会发送该 header。

该操作只针对当前 OpenCode process 所拥有的当前 session active execution；idle 或已完成的 session 为 no-op。它不能承诺 detached 或 background task 的中断语义。真实 ask UI 与 active interrupt 的端到端行为尚未完全验证。

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

插件在启动时读取 `~/.config/opencode/opencode-dokana.toml`。完整示例：

```toml
[agents.orchestrator]
model="kimi-for-coding/k3"
variant="high"

[agents.dispatcher]
model="openai/gpt-5.6-luna"
variant="max"

[agents.oracle]
model="openai/gpt-5.6-sol"
variant="xhigh"

[agents.explorer]
model="deepseek/deepseek-v4-flash"
variant="high"

[agents.low-fixer]
model="deepseek/deepseek-v4-flash"
variant="high"

[agents.medium-fixer]
model="openai/gpt-5.6-terra"
variant="medium"

[agents.deep-fixer]
model="openai/gpt-5.6-sol"
variant="medium"

[agents.dispatcher.permission]
edit="deny"
bash="allow"
external_directory="ask"
interrupt_session="ask"

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

插件不枚举校验 permission key 或 permission value。未知 key 原样透传，非法值交给 OpenCode 自身 schema 在启动时校验。

插件内置默认权限矩阵：

| Agent | 默认 permission |
| --- | --- |
| `orchestrator` | `edit: deny`, `bash: deny`, `external_directory: ask`, `read: allow`, `question: allow`, `todowrite: allow`, `interrupt_session: allow`, `task.*: deny`, `task.dispatcher: allow`, `task.oracle: allow` |
| `dispatcher` | `edit: deny`, `bash: allow`, `todowrite: allow`, `read: allow`, `webfetch: allow`, `doom_loop: allow`, `external_directory: ask`, `interrupt_session: deny`, `task.*: deny`, `task.explorer/low-fixer/medium-fixer/deep-fixer: allow` |
| `explorer` | `edit: deny`, `bash: allow`, `external_directory: allow`, `task: deny`, `glob: allow`, `grep: allow`, `list: allow`, `webfetch: allow`, `websearch: allow`, `read: allow`, `interrupt_session: deny` |
| `low-fixer` | `edit: allow`, `bash: allow`, `external_directory: allow`, `task: deny`, `interrupt_session: deny` |
| `medium-fixer` | `edit: allow`, `bash: allow`, `external_directory: allow`, `task: deny`, `interrupt_session: deny` |
| `deep-fixer` | `edit: allow`, `bash: allow`, `external_directory: allow`, `task: deny`, `interrupt_session: deny` |
| `oracle` | `edit: deny`, `bash: deny`, `read: allow`, `grep: allow`, `glob: allow`, `list: allow`, `lsp: allow`, `external_directory: ask`, `task: deny`, `interrupt_session: deny` |

prompt 路径必须为 `.md` 文件，相对 TOML 所在目录解析，支持 `~/` 展开。

错误回退：

- TOML 缺失或解析失败时，model/variant/prompt 不应用 TOML 覆盖，仍使用各自默认；插件默认 permission 矩阵仍然应用。
- 单个 agent 的 `model`/`variant` 非法时，该 agent 的这两个字段原子回退到 frontmatter 默认。
- `prompt` 路径非法或不可读时，回退到插件内置默认 `prompts/<agent>.md`。

## 许可证

MIT
