# 技能面板

一个用于 Harness Web UI 的侧边栏面板，列出当前会话可见的所有技能，并允许
用户逐个禁用或启用。

## 安装

需要 dsh `>= 0.2.2-rc.1`。插件以 bundle 形式分发，从 GitHub 安装：

```bash
dsh plugin --profile web add git+https://github.com/GnepNus/dsh-skills-panel-toggle.git
```

也可以在 Web UI 中打开 **Plugins → Add plugin**，填入上面的 Git 地址（同样
支持 tarball 和本地路径），安装完成后点击 **Enable now**。插件管理器会把
`dsh-skills-panel-toggle` 加入该 profile 的 bundle 列表并实时生效。

安装后，Web UI 左侧边栏会出现技能图标；点击图标即可打开面板。

## 用法

从左侧边栏的技能图标打开面板。每一行显示技能名称、其发现来源（`project · .dsh`、
`user · .agents`、`bundled` 等）、路由描述、技能说明文件的绝对路径（位于描述下方的
等宽小字，悬停标题为完整路径）、当技能仅限单一界面时显示的 `用户/模型` 标记，
以及一个开关。没有对应文件的技能——虚拟或运行时条目——不显示路径行。
搜索框可按名称和描述过滤。

禁用某个技能会把它从两个消费技能注册表的界面中移除：

- 由 `@deepseek-ai/dsh-tool-skill` 发布、面向模型的技能目录，因此 agent 既看不到
  它，也无法通过 `skill` 工具加载它；
- `/` 菜单与字面量 `/name` 调用，因此用户也无法调用它。

重新启用会在下一次目录刷新时恢复原技能。磁盘上不会修改任何内容；被禁用的名称
记录在插件自己的状态文件中。

## 工作原理

- 一个键为 `skills-panel` 的 `main` 槽位条目负责渲染页面，与之匹配的
  `sidebar.panellist` 条目提供侧边栏图标；shell 在点击时选中该面板。
- Host 半部分为同源页面提供 `GET /skills-panel/api/state` 与
  `POST /skills-panel/api/toggle`，并拒绝连接服务不认可的对端请求。
- 列表从活跃会话所见的 scope 读取：活跃根 agent 的 scope，否则使用默认预设的
  常驻 scope。技能 provider 挂载在 agent 预设 scope 的*内部*，因此 Host 全局
  provider 会读到空目录，也永远无法遮蔽某个名称。
- 被禁用的名称以 `skills-panel/state.json` 持久化在 profile 目录内，同时保存
  渲染隐藏条目所需的描述与调用标志。
- 对于每个活跃 agent——包括激活后新建的——插件都通过该 agent 自己的 context
  注册一个技能提供者，候选排序为 `0`，且两个调用策略均关闭。注册表由最近的一层
  决定名称归属，因此该遮蔽层胜过 agent 预设 provider；随后目录消费者会过滤掉
  不可调用的条目。agent 或插件卸载时，注册会被释放。

## 要求

profile 必须挂载技能注册表（`ctx.skills`，来自 `@deepseek-ai/dsh-skill`）与
Web 服务器。没有 profile 目录时面板仍会列出技能，但无法持久化开关状态。

## 已知限制

- 面板列出的是某一种会话组合的目录（活跃根 agent，或没有活跃会话时的默认预设）；
  仅由其他预设挂载的技能，要等到该预设成为活动会话的预设之后才会出现。
- 开关作用于运行中会话的下一次目录刷新，而不影响某一步已经组装好的目录。
- 直接重新启用或修改状态文件时，需要插件重新加载后其 provider 才能感知变更；
  通过 API 路径则立即生效。

## 测试

`node test/host.test.mjs` 用真实的 `@deepseek-ai/dsh-skill` 注册表和 scope 原语
构建部署的 scope 形状，然后驱动两个 HTTP 处理器：目录列举、按 agent 的遮蔽优先级、
持久化、agent 创建/销毁、鉴权与错误路径。`node test/client.test.mjs` 检查侧边栏
图标与面板注册以及语言字典。两者都需要由 profile 启动的 shell，以便
`DSH_PROFILE_DIR` 能解析出部署包；它们不渲染任何内容。

## 许可证

[MIT](LICENSE)
