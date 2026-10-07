# dsh-tui 定制说明 + 升级后一键重打指南

本文件是**唯一权威**的定制清单与升级手册。每次 `dsh` / dsh-tui 升级后，照着
[第 3 节](#3-升级后重打流程-runbook) 走一遍，即可把全部定制功能补回来。

组成三部分：
1. **用户级设置**（存在用户目录，升级一般不覆盖，但要确认还在）— 见 §1.2
2. **node_modules 内补丁**（升级会覆盖，需重打 / 重移植）— 见 §2
3. **apply 脚本 + 备份库** `~/.dsh-tui/patches/`（本身也是 git 快照仓库的一部分）

---

## 1. 当前基线（版本锁定关系）

### 1.1 版本
| 组件 | 位置 | 版本 |
| --- | --- | --- |
| `@deepseek-harness-tui/dsh-tui`（实际运行的 TUI） | `~/.dsh/profiles/dsh-tui/node_modules/…` | `0.12.0` |
| profile 目录名 | `~/.dsh/profiles/dsh-tui` | （旧版本叫 `tui`） |
| delegating 壳（`dsh-tui` 命令） | 全局 `@deepseek-harness-tui/dsh-tui` | `0.12.0` |
| launcher / 生态 `@deepseek-ai/dsh` | 全局 | `0.2.0-rc.2` |
| tool 包 `dsh-tool-fs` / `dsh-tool-str-replace-editor` | `~/.dsh/profiles/node_modules/@deepseek-ai/…` | `0.2.0-rc.2` |
| 补丁构建基线（dsh-tui，文档/检查脚本引用） | `patches/patch-base-version` | `0.12.0` |
| 补丁构建基线（逐包，apply 脚本据此**分目标**放行） | `patches/patch-base-versions.json` | dsh-tui `0.12.0`／tool 两包 `0.2.0-rc.2` |

**版本关系（重要，别再踩坑）：**
- dsh-tui `0.10.0-beta` 线与生态 `0.1.1-rc.2` 配套；peer 范围二者相同，可互换 minor。
- **不要混装 0.9.x**：0.9.x 需要更老的生态（rc.1），在 rc.2 上会因 cordis 服务
  `tuiThemes` 缺失而 boot 失败。
- delegating 壳只拦「profile 的 major/minor 比壳更旧」；同 minor 的 patch 错位只提示不拦。
  所以 `beta.3`（同 `0.10`）能跑，`0.9.3`（minor 9 < 10）会被拦。
- 壳与 profile 应保持同一版本（现均为 `0.12.0`）。曾有壳 `0.10.0` + profile `0.10.2` 的错位：
  同 minor 的 patch 错位壳只提示不拦（实测可跑），但建议对齐 —— profile 升级后上游会在
  退出提示里给出命令：`npm install -g --legacy-peer-deps @deepseek-harness-tui/dsh-tui@<profile>`
  （`--legacy-peer-deps` 绕过 npm 12 的 peer 解析崩溃；壳是瘦壳，跳过 peer 解析是安全的）。
- **profile 的 pin 才是权威**：`dsh` 每次启动按 `~/.dsh/profiles/dsh-tui/package.json`
  reconcile 它的 `node_modules`。应用内 update-restart 只换 `node_modules`、**不改 pin**，
  所以下一次 reconcile 会照 pin 把版本拉回去——2026-09-17 傍晚 profile 就是这样从
  0.10.2 掉回 0.10.1 的（补丁基线已按 0.10.2 走，于是 `dsh-patch` 全部跳过、9/9 目标
  一个没打上）。**要让版本持久就必须改 pin**：
  `env -u https_proxy -u http_proxy -u all_proxy pnpm add -C ~/.dsh/profiles/dsh-tui @deepseek-harness-tui/dsh-tui@<版本>`
  （本机 `https_proxy=127.0.0.1:7890` 已废，不绕开会 ETARGET / 退回缓存；pnpm 会自动把新版本
  加进 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`）。
- **tool 两包不在 profile 里**：它们由全局 launcher 树提供（`dsh` 升级 = 两包跟着换版本，
  补丁同时被覆盖）。补丁基线因此必须**逐包**记录，见 `patch-base-versions.json`。

### 1.2 用户级设置（升级后确认仍在）
| 文件 | 内容 | 作用 |
| --- | --- | --- |
| `~/.dsh/profiles/dsh-tui/cordis.patch.yml` | `- id: dsh-tui` + `config: { …, diffLayout: unified }` | 强制 unified diff 布局（否则 `auto` 宽屏退 split，CC 样式看不到）。**0.1.7 起 `~/.dsh/settings.yaml` 已不存在**：用户设置改为写进 profile 自己的 patch 行（`/settings` 改的就是它），且该行**整块替换** entry 的 `config` —— 所以行里必须重述 bundle 的全部键（`provider`/`fullscreen`/`terminalImages`/`effort`/`preset`/`workspace`/`sessionId`）。旧文档在 `~/.dsh/settings.yaml.imported` |
| `~/.dsh-tui/theme.json` | `{ "theme": "claude-code" }` | 激活 CC diff 配色 |
| `~/.dsh-tui/themes/claude-code.json` / `-light.json` | — | CC diff 调色板（升级不动） |

---

## 2. 定制功能清单（升级后逐项要「回来」的东西）

> **编号说明**：0.10.0 → 0.10.1 迁移时列表重排为 F1–F3：
> F1 diff 渲染、**F2 ↑/↓ 跨会话历史（同样只看当前目录）**、
> **F3 resume 只看当前目录（扁平、无 rail）**；2026-09-11 追加
> **F4 标题链路：按 Claude Code 的取名链**（最近一条 prompt 优先）+ **文件地址不当标题**
> + **dsh 自己写的兜底占位标题不算名字**（2026-10-07 补：见 §2 F4）。
> 迁移时曾去掉五项旧定制，其中**旧 F3 的部分行为已恢复进当前的 F3**
> （去掉 rail、列表扁平，但范围仍是当前工作目录）；
> 仍去掉的四项是：旧 F2 会话标题不截断、旧 F4 vim 默认开启/INSERT 起手、
> 旧 F5 vim 指示移到底部状态栏、旧 F7 `ToolFileDiff` 类型补充（后两项与运行时无关，
> 只影响 `tsc`）。找回办法见 §4 与 git 历史。
>
> **当前补丁集 = 11 个目标文件**（3 个 F1 + 3 个 F2 + 3 个 F3 + 2 个 F4；
> `node resolve-patch-targets.mjs` 可列出），`patch-base-version` = `0.12.0`，
> 逐包基线见 `patch-base-versions.json`（dsh-tui `0.12.0`／tool 两包 `0.2.0-rc.2`）。
> F5（`recapOnOpen`）**不在**这 11 个里：0.11.2 上游自己把它做成了 stock，补丁已退役
> （见下方「退役」与 §4 的状态表），别再把它加回 `TARGETS`。
>
> **0.12.0 迁移要点（2026-09-30）**：上游只动了 **3 个**目标文件（`Chat.js`、`PromptInput.js`、
> `i18n.js`），另外 **7 个（含 tool 两包）字节未变 → 免移植**；动过的 3 个按 §3 三方合并
> **0 冲突**（定制点原样还在：`loadHistory(channel.cwd)`、`historySeedCwd` 那一套、
> `supervisor-hint-list` 文案），上游新代码全部保留（鲸鱼券弹窗 `WhaleCouponPrompt`/`bonusNotices`、
> `channel.minimal` → `minimalUi` 改名、`cycleMode()` 补了 catch、`/resume` 一批新 key）。
> tool 两包虽从 `0.1.7-rc.2` 跳到 `0.2.0-rc.2`，`lib/index.js` **逐字节不变**。
>
> **0.12.0 起 apply 脚本能分辨「偏移」和「fuzz」**：GNU patch 的 hunk 报告走 **stdout**
> （stderr 只放硬错误），旧脚本只重定向 stderr、又带 `-s`，于是失败时 `NEEDS-REPORT`
> 下面**一行证据都打不出来**，成功时 patch 的啰嗦话反倒漏在报告里。现在两路都抓，落盘时
> 分开报：纯行号偏移 = `PATCHED`/`PATCHED-DRIFT`，**靠 fuzz 才贴上的 = `PATCHED-FUZZ`**（置 drift，
> 因为 fuzz 是上下文模糊匹配，hunk 可能贴到别的地方）；`--read-only=ignore` 顺手去掉
> `-o` 下毫无意义的 "file is read-only; trying to patch anyway" 警告。
>
> **0.11.2 迁移要点（2026-09-29）**：上游改动不大，`dsh-patch` 用 `diffs/*.patch` +
> `fuzz 3` 直接把 8 个 TUI 目标贴了回去，其中 7 个的落点经 3-way 复核与正规重移植
> **逐字节相同**（`git merge-file` 结果 == 已装文件，只差 `merge-file` 不写尾换行），
> 只有 `useSessionSupervisor.js` 有 1 处真冲突：上游给 rail 新增了「按 cwd 选目录」的
> 自动选中 effect，而 F3 的 fork 本来就把那个 effect 连同 `selectedPath` 状态整块替换成
> 自己的 `channel.cwd` 合成——**保留**上游新的 `snapshotSlot` 清理 effect、**删掉** rail
> 选择 effect 即正确解（已按此复核）。同时 **F5 退役**：上游自己声明了 `recapOnOpen`，
> volatility 改由 `SETTING_DEFINITIONS` 派生的 `EDITABLE_CONFIG_KEYS` 提供。`TARGETS`
> 因此从 11 条减到 **10** 条——F5 此前没登记进这份清单，§2 一直写「10 个目标文件」，
> 现在两边才对上。
>
> **0.11.1 迁移要点（2026-09-28）**：`/resume` 的浏览器被上游**整屏重写**——
> `screens/SessionBrowser.js` 已删除，改为 `screens/SessionSupervisor.js`
> （工作区 rail + 会话面板 + 多会话托管）。F3 因此从「整文件分叉」变成**薄补丁**：
> rail 不再渲染、面板钉死当前工作目录（见 F3 一节）。
>
> **`/resume` 不是 stock**（见 F3；0.11.1 起上游叫 `SessionSupervisor.js`）：2026-09-11 曾按「恢复全量会话」做了一版**薄补丁**
> （`SessionBrowser.js` + `view.js` + `i18n.js`，默认 `allProjects`、去掉 rail 与目录分组），
> 用户明确「只列当前工作目录的」→ **那版整版撤回**。随后重做了一版**整文件分叉**
> （沿用 `23086fc` 的删 rail / 去分组 / 去钻取页，范围固定当前目录），即当前的 F3，
> 那才是最终决定。被否掉的是「列全部项目」，**不是**「无 rail 扁平列表」，别搞混。

### F1 — Edit/Write 的 diff 用 Claude Code 统一风格渲染
- **涉及文件（3 个）**：
  - `profiles/node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js`
  - `profiles/node_modules/@deepseek-ai/dsh-tool-str-replace-editor/lib/index.js`
  - `…/dsh-tui/lib/types/components/messages/AssistantToolUseMessage.js`
- **基线版本（2026-09-17 重移植）**：tool 两包补丁是对着 **0.1.5-rc.2** 重做的。
  0.1.2-rc.1 时代的旧 `backup/` 里带着一段**已过时的上游回退**（去掉 scope-aware 提示语、
  把 `REMEDIES` 重构倒回内联 if/else），直接盖上去 = 把上游代码降级，**别用**。
- **三个文件必须成套**：只打 TUI 渲染器、tool 包没打 → 行号消失（渲染器
  `numbered = typeof diff.oldStart === 'number'` 兜底成纯 `+/-`）且 `str_replace`
  完全不出 diff 卡；只打 tool 包、渲染器没打 → 白打。
- **行为**：diff 以 **unified** 呈现——真实行号 gutter、上下文行、`+`/`-` 标记、
  绿/红**整行底色**（`diffAddedDimmed`/`diffRemovedDimmed`）、词级高亮（仅新增词绿底
  `diffAddedWord`）、`+N -M` 变更数汇总行、diff 正文永不折叠。
  - tool 包改动：hunk 携带 1-based `oldStart`/`newStart`（`computeHunkDiffs`/
    `presentationMeta`）；`str_replace` 返回 `{message,before,after}` + 结果期带行号
    hunk diff（`presentResult`，模型可见输出文本不变）。
  - **个人偏好**（以下 diff 行为是重移植时最容易弄丢的，务必保留）：
    - **diff 正文永不隐藏 / 不折叠**：`DIFF_BODY_MAX_LINES = Infinity` —— 编辑/删除
      diff 全量展示，正文不出现 `… +N lines` 折叠行。
    - **新建文件只预览前 10 行**：`NEW_FILE_DIFF_MAX_LINES = 11` —— write 建新文件时
      只显示 `+N` stat 行 + 前 10 行内容，其余以 `… +N lines (ctrl+o to expand)` 收起；
      Ctrl+O（verbose）展开全部。注意 0.10.1 上游新增了 `foldBodyLines`（长行裁剪），
      new-file 上限要与它同时作用于 `bodyLines`。
    - hover 工具卡不变底色（只有选中高亮）；0.10.1 上游的 `hoverTint` 分支已按此删除。
- **验证**：触发一次 Edit/Write，看是否 CC 统一式（行号 + 绿红底）；NEW 文件只出
  前 10 行（`… +N lines` 收起）、Ctrl+O 能展开；编辑/删除 diff 永远不出现折叠行。

### F2 — ↑/↓ 跨会话历史（**按当前工作目录过滤**）+ 建议菜单边界落历史
- **涉及文件（3 个）**：
  - `…/dsh-tui/lib/types/history.js` —— 写入时给条目打上提交目录（`cwd` 字段），
    读取时只返回该目录的条目。**0.11.x 上游新增 `loadHistoryOldestFirst()`**
    （composer 的 ↑/↓ 走它），所以过滤抽成一个 `scopeToCwd(entries, cwd)` 助手，
    `loadHistory(cwd)`（Ctrl+R，新→旧）与 `loadHistoryOldestFirst(cwd)`（↑/↓，旧→新）
    共用它——否则会出现「Ctrl+R 过滤了、↑/↓ 没过滤」的错位。两个函数都新增**可选**参数，
    不传即旧行为（返回全部）。`history.d.ts` **不补**，理由同旧 F7：
    安装后的包不做类型检查，声明只影响 `tsc`。
  - `…/dsh-tui/lib/types/components/PromptInput.js` —— ↑/↓ 播种改走
    `loadHistoryOldestFirst(channel.cwd)`（0.11.x 的播种函数 `seedHistory()` 以
    `historySeedCwd === channel.cwd` 为守卫，取代上游的 `historySeeded` 布尔：
    目录变了就重播种），提交时 `appendHistory(text, channel.cwd)` 打标。
  - `…/dsh-tui/lib/types/screens/Chat.js` —— Ctrl+R 历史搜索改读
    `loadHistory(channel.cwd)`，与 ↑/↓ 范围一致。
- **行为**：
  - ↑/↓ 读取**持久化历史文件**（跨会话、跨进程可翻），但**只列当前工作目录的条目**；
    Ctrl+R 同理（同一份 `loadHistory`）。
  - **播种按目录重播**：`historySeedCwd` 记住上次播种用的目录，目录变了
    （workspace picker 可以中途换工作区）就重新播种并结束进行中的历史游走。
    这顺带修掉旧补丁的一个竞态：旧版在**每次 render** 都重新播种，提交后若在落盘前
    重渲染，刚提交的命令会被从内存历史里抹掉；现在只在挂载/换目录时播种。
  - **旧条目兜底**（升级平滑的关键）：打标之前写入的条目没有 `cwd`。
    当**当前目录一条都没有**时，`loadHistory(cwd)` 返回这些无标记条目，所以刚改完
    ↑/↓ 不会突然变空；一旦该目录攒下自己的条目，兜底池立刻让位
    ——别的目录的命令不会永久泄漏进来。
  - **去重按目录分别算**：同一句话在另一个目录提交算**新条目**（`last.cwd === cwd`
    才算连续重复），否则合并会把条目留在错误的目录标签下。
  - 在命令建议菜单顶部/底部再按 ↑/↓ **落到历史**（而非 stock 的环绕）。
- **重移植注意**：只保留「按目录播种/打标 + 菜单边界落历史」；
  vim 相关（默认开启、`onVimChange` 上报、输入框内指示）已移除，重移植时不要带回。
  三个文件的改动都很薄（`history.js` 约 40 行、`Chat.js` 1 行、`PromptInput.js` 是
  播种块 + 两处传参），若上游大改，底线是「条目带目录 + 读取按目录过滤 + 旧条目兜底」。
- **验证**：
  1. 重启后 ↑/↓ 能翻到**本目录**以前输过的命令；换个目录启动应看不到这里的命令。
  2. 菜单在第 0 项按 ↑ 应进历史。
  3. 命令行无头测试（临时 `HOME`，绝不碰真实历史文件）：
     ```bash
     node ~/.dsh-tui/patches/test-history-cwd.mjs
     ```
     断言：条目带 `cwd` 落盘、按目录过滤、旧无标记条目兜底且在有本目录条目后让位、
     跨目录同名文本不合并、未过滤读取返回全部、真实 `history.jsonl` 未被改动。
  4. 过渡期快检——当前 200 条**全无 `cwd`**，所以过滤前后条数应相等：
     ```bash
     node -e "import('$HOME/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/history.js').then(m=>console.log(m.loadHistory().length, m.loadHistory(process.cwd()).length))"
     ```

### F3 — resume：只列**当前工作目录**的历史会话（无左侧工作区 rail）
- **涉及文件（3 个）**：
  - `…/dsh-tui/lib/types/screens/sessionSupervisor/useSessionSupervisor.js`（**主补丁**：rail
    不再渲染、键盘一开始就归会话列表、面板钉死 `channel.cwd`、行按目录匹配）
  - `…/dsh-tui/lib/types/screens/SessionSupervisor.js`（**1 处**：Ctrl+N 从「rail 光标所在
    工作区」改为「钉死的当前目录」）
  - `…/dsh-tui/lib/types/i18n.js`（**只改** `supervisor-hint-list` 一个 key：去掉
    `**←/→** 切换栏位`，因为面板已经不可切换）。其余 key 一律保持 stock。
- **0.11.x 上游变化（重移植前必读）**：`screens/SessionBrowser.js`（911 行 stock，旧 F3 的
  整文件分叉对象）**已被删除**。`/resume`、`/home`、`/agentview` 现在是同一个
  **`screens/SessionSupervisor.js`** 屏：左侧工作区 rail（`HomeWorkspaceRow`）+ 右侧会话面板
  + 多会话托管（Ctrl+N 新建 / Ctrl+X 停止，切换不中断）。上游 stock 已经默认选中
  「当前 cwd 所属工作区」（`channel.cwd` 命中 registry 时），但 **rail 还在、还能切到别的目录**，
  且 cwd 未注册时会退回 `railEntries[0]`（另一个项目）。F3 因此从「整文件分叉」变成
  3 处薄改动。
- **行为**（与旧 F3 的三条底线一一对应）：
  - **无 rail**：`railVisible = false`，两侧 rail JSX 都不渲染，会话面板占满宽度；
    `activePane` 初始即 `list`，`activateRail()` 置空（`←` 不再抢走键盘），
    栏位切换的 `←/→` 文案同步从 hint 里去掉。
  - **范围固定当前工作目录**：`selected` 不再来自 rail 行，而是由 `channel.cwd` 合成
    （cwd 若已注册则取其 registry 拼写，否则用原路径），`visibleSessions` 直接对
    `listedSessions` 按 `samePath(session.cwd, channel.cwd)` 过滤 —— 比 stock 的
    「rail 分组 key 精确相等」更稳：日志里带尾斜杠 / 大小写不同的同一目录仍算本目录。
    别的目录**没有任何入口**（registry 里那些工作区不再出现在屏幕上）。
  - **没有「全部目录」开关**：旧屏的 `mod+a`、`allProjects` 三元随 `SessionBrowser.js`
    一起消失；新屏本来就没有范围开关，所以不需要再置空任何键。
  - **保留**（与 stock 一致）：搜索 `/`、实时状态与占用、重命名、删除、固定 pin、
    Ctrl+N 新建、Ctrl+X 停止、Esc 返回；子 agent 运行仍不进列表。
  - **代价（与 stock 的差异，用户已接受）**：没有「切到别的工作区」的能力 ——
    想看别的目录的会话，请在那个目录下启动 dsh-tui。
- **历史**：0.10.1→0.10.2 时代 F3 是整文件分叉；0.11.1 上游整屏重写后，用户明确选择
  **等价移植（隐藏 rail + 锁死当前目录）**，而不是退回 stock 的 rail。**别再退回 rail**，
  也**不要**把范围改成「全部工作目录」。
- **重移植注意**：薄补丁，锚点是三个词——`railVisible`（钉 false）、`selected`
  （由 cwd 合成）、`visibleSessions`（按 `samePath` 过滤）。上游若再动这一屏，
  先保住「无 rail + 范围=当前目录 + 列表扁平」三条；`useSessionSupervisor.js` 里被删掉的
  `selectedPath` / `selectedUnregistered` / `selectionManual` 与「自动选中」effect
  是 stock 的 rail 选择状态，新结构里没有它们的位置。
- **验证**：
  1. `/resume` 只应看到**当前目录**的会话（别的目录的会话与 rail 都不出现）；
  2. `←` 不改变光标归属（`❯` 始终在会话面板），Ctrl+N 新建落在**当前目录**；
  3. 命令行无头渲染快检（不启动 TUI、不写文件）：
     ```bash
     node ~/.dsh-tui/patches/test-resume-flat.mjs
     ```
     12 条断言：当前目录会话列出 / 其他两个目录的会话与其路径都不出现 / 子运行不进列表 /
     恰好一行会话 / 无「工作区」分区头与 rail 行 / hint 不再出现「切换栏位」/
     没有「全部工作目录」范围 / hint 仍广告 Ctrl+N、Ctrl+X、Enter /
     **Ctrl+N 的 `onNewSession` 收到当前目录**（stock 上这条会收到 rail 行的工作区）。

### F4 — `/resume` 的标题按 Claude Code 的取名链，文件地址与 dsh 的兜底占位标题都不当标题
- **涉及文件（2 个）**：
  - `…/dsh-tui/lib/types/dsh-adapter/sessions/digest.js`（**薄改动**：新增 `LAST_PROMPT_TITLE_CHARS`
    / `isFileAddress()` / `normalizeLastPrompt()` / `lastPromptOf()` / `asTitle()`，`titleOf()` 给标题
    事件分「真名字 / 占位」强弱，`digestSession()`、`recoverLatestName()`（原 `recoverLatestTitle()`）
    与 `digestAppendedSuffix()` 各改几行）。
  - `…/dsh-tui/lib/types/dsh-adapter/sessions/store.js`（**一个常量**：`SCHEMA_VERSION` 4 → 5，
    让旧索引整份作废 —— 见下方「缓存 epoch」）。
- **0.10.2 的结构锚点（重移植时先看这条）**：上游把 `humanPrompt()` 改成返回
  `{ text }`（无文本消息如纯图片 = `{ text: undefined }`），空会话判据也从
  `prompt !== undefined || !head.whole` 换成 `hasHumanMessage || !completeHead`，
  并要求日志首行 `type === 'session'` 才算"读完"。F4 的过滤建立在这个形状上：
  标题候选一律读 `human?.text` / `found.text`，而"任何人类消息都算有对话"由
  `hasHumanMessage` 承担 —— 这正是 F4 要的解耦，所以**不要再按 0.10.1 的字符串形状回改**。
- **行为**：没有任何**真名字**的会话，按 Claude Code 的取名顺序取名
  （它的链条是 `customTitle || aiTitle || lastPrompt || summaryHint || firstPrompt`），
  两层 prompt 候选都必须是"**整串不是文件地址**"：
  1. 最后一条**真名字** `session/title` 事件（provider 自动标题 = `auto`；`/rename` 或 recap 点"应用"
     = `renamed`）—— 对应 Claude 的 `customTitle || aiTitle`。**这一层不受地址过滤影响**：
     人和模型写下的名字照用；
  2. 否则**最近一条非地址人类消息**（`lastPromptOf()`，倒序扫、跳过地址，命中即返回）——
     对应 Claude 的 `lastPrompt`，并按它的 `normalizeLastPrompt` 归一化：换行折成空格、trim、
     超 `LAST_PROMPT_TITLE_CHARS = 200` 截断加 `…`；
  3. 否则**第一条非地址人类消息** —— 对应 Claude 的 `firstPrompt`（上游逻辑 + 跳过地址）；
     **首条 prompt 也走第 2 层同一个 `normalizeLastPrompt`**（它以前原样上报，多行首句会把整行撑开）；
  4. 最后才是工作目录 basename（`source: 'fallback'`，上游原样、非空）。
     第 1 层有值时不做倒序扫描，已有标题的会话一个字节都不多读。
     增量缓存更新（`digestAppendedSuffix()`）与深度恢复反扫（`recoverLatestName()`，原
     `recoverLatestTitle()`）走同一条链：增量**只接受真名字**；恢复则一边反扫一边把"最近一条
     非地址 prompt"记下来，扫完仍没有真名字就用它 —— 否则深度扫描（首条 prompt）会和快速路径
     （最近一条 prompt）给出不同的名字，来回打架。
- **dsh 的兜底占位标题不算名字**（2026-10-07，用户报「resume 只显示文件地址，导致分不清」）：
  `dsh-session-title` 在没有 provider 标题时会把**首条人类消息截断**（`fallbackMaxWords` /
  `fallbackMaxBytes` 双上限）写成一个 `session/title` 事件，`source.kind: 'fallback'`，好让会话
  "永远有个名字"。它是一个 prompt，不是名字：多个会话只要首条都 `@` 同一个文件，行标题就长得
  一模一样（真实数据里是 `@modules/client/controllers/v1/auction/A`）；而且它**写在 provider
  标题之前**，上游"最后写入者胜"的规则又会反过来让占位标题压住后面的 AI 标题。所以 `titleOf()`
  给它 `strong: false`，三处扫描（head/tail 窗口、深度反扫、增量后缀）一律只接受 `strong` 标题；
  占位标题不参与 `titleComplete` 判断（tail 里只有一个占位，说明真名字可能藏在没读到的中间，
  必须留给深度扫描）。
- **缓存 epoch（`store.js`）**：`SCHEMA_VERSION` 4 → 5。标题的**语义**变了，而日志一个字节没变，
  revision 会照常命中 → 版本 4 的 `session-index.json` 里可能存着旧的占位标题（就是上面那个路径）
  并被无限复用。版本 4 因此**不在可读集合里**（`readIndex()` 只认 5 / 3 / 2）：整份丢弃，下一次
  列表按新链重算。这是唯一的缓存失效机制，**不需要手动删 `session-index.json`**；旧进程即使把
  索引写回版本 4，新代码照样不认。
- **"文件地址"判据**（只认"整串就是一个地址"，**绝不做子串匹配**）：
  `^[/\\]`、`^~[/\\]`、`^\.{1,2}[/\\]`、`^[A-Za-z]:[\\/]`、`^@\S+$`；以及"单 token、
  含分隔符、带字母（`\p{L}`，所以 `2024/09/11` 不算）、且带扩展名或至少两级"的相对路径
  （`src/views/Setting.vue`、`src/views/Setting`）。**不匹配**的仍是标题：
  `@src/views/Setting.vue 互转方向更改`、
  `在admin_frontend中，@src/views/setting/Setting.vue 互转方向更改。`、
  `工作/生活`、`2024/09/11`。
- **`hasPrompt` 与标题候选解耦（关键，别改回去）**：地址型首句**仍然算"有对话"**。
  `digestSession()` 里 `prompt` 收下**任何**人类输入（它决定 `hasPrompt`，表达式逐字保持上游），
  `opening` 才是第一个合资格的标题候选；`recoverFirstPrompt()` 同样分开返回
  `prompt`（首个非地址候选）与 `hasPrompt`（是否见过任何人类输入）。若把两者合并，
  一个"首句是路径、后面聊了一堆"的会话会被算成**空会话** —— 而"清理空会话"是**破坏性**动作
  （`mod+x` 确认后删除），绝不能误删。
- **与 Claude Code 2.1.201 的对应关系**：

  | Claude Code | 这里 |
  | --- | --- |
  | `customTitle \|\| aiTitle`（`/rename`、hook `sessionTitle`、模型写的 `ai-title`） | `session/title` 事件：`renamed` / `auto`（**不过滤**） |
  | `lastPrompt` + `normalizeLastPrompt`（折行、trim、200 字符 + `…`） | `lastPromptOf()` + `normalizeLastPrompt()`，额外跳过地址 |
  | `summaryHint` | dsh-tui 无对应字段，跳过 |
  | `firstPrompt` | 上游首条人类消息逻辑，额外跳过地址 |
  | 提示词生成 3–7 词标题（`qam = 10` 最小长度、1000 字符内容窗口、JSON `{title}`） | **不在 `digest.js` 做**：provider 标题事件与 recap 的"建议标题"已经是这一层 |
  | （Claude 无此层） | dsh 的 `source.kind: 'fallback'` 占位标题（首条 prompt 截断）**被跳过**：`titleOf()` 判 `strong: false`，见上 |
  | 无标题时的兜底（窗口标题退到 sessionId 前 8 位，picker 返回 null） | 目录 basename（上游原样、且非空，所以 `SessionListRow.js` 不用改） |

- **历史/被否方案**：需求原话是"取标题时，是文件地址不取"。一共做过四版：
  ① **纯地址过滤器**（过滤 + `hasPrompt` 解耦，但链条仍是上游的"首条 prompt"）；
  ② **只照 Claude 的链条、读取层不做内容判断**（`lastPrompt` 优先，但地址会原样上报）；
  ③ **= ① 的过滤 + ② 的链条**（用户选定）：Claude 的顺序 + 两层 prompt 都跳过地址；
  ④ **当前版 = ③ + 只认真名字的 `session/title`**（2026-10-07）：③ 只过滤了 digest 自己推导的
  prompt 候选，管不到 dsh 已经写进日志的 `fallback` 占位标题 —— 它优先级最高，于是
  `@modules/client/controllers/v1/auction/A` 这种截断路径又回到了行上（用户原话：
  "resume 会只显示文件地址，导致分不清"）。④ 在 `titleOf()` 一处把占位标题判为
  `strong: false`，三处扫描统一拒收，并顺手把首条 prompt 也纳入归一化。
  被否掉的是 ② 的"不过滤"（会把路径显示成标题）与 ① 的"只认首条 prompt"（不采用 Claude
  的 `lastPrompt` 优先）。
- **验证**：
  1. `/resume` 中：有真名字的会话显示该名字；没有的显示**最近一条真实消息**（不是第一条、
     也不是路径，更不是 dsh 写的截断占位）；只发过路径、之后再没说话的会话显示**目录名**
     （既不是路径，也不是空白行）；
  2. 无头行为测试（合成 zstd 会话日志，不启动 TUI、不写用户数据）：
     ```bash
     node ~/.dsh-tui/patches/test-resume-title-chain.mjs
     ```
     它断言：真名字 `session/title` 优先且 `auto`/`renamed` 溯源不变；最近消息胜过首句；
     两层 prompt 都折成一行、超 200 字符截断；**首句是地址 → 用后面那条真实消息**、
     **最近一条是地址 → 用更早的真实消息**；7 种地址写法单独出现时都回落到目录名且
     `hasPrompt=true`；提及路径的正常句子 / `2024/09/11` / `工作/生活` 仍是标题；空会话
     `hasPrompt=false` + 目录名；`>64KB` 日志从尾窗口取最近消息；`recoverSessionTitle` 跳过地址、
     对地址型会话保留 `hasPrompt`；**⑥（本轮新增）占位标题在四条路径上都不算名字**：被完整
     prompt 取代、不压过最近 prompt、不埋掉 provider 标题、不压过 `/rename`，只有地址时仍回落
     目录名；深度恢复与增量后缀同样拒收；尾部只有占位标题时 `titleComplete` 不再置真，
     深度扫描随后能从"中间"找回 provider 标题；
  3. 回归证据（③ 那版）：161 条真实会话日志改动前后 `digestSession()` 的
     `{title, source, hasPrompt, titleComplete}` 逐条相同 → 当时缓存无需作废、未动 `SCHEMA_VERSION`；
     ④ 不同：**语义变了、日志没变**，所以 231 条日志里有 **59 条**的标题按新链改写
     （其中 11 条露出本来被占位标题压住的 provider 标题，其余变成完整的首条/最近 prompt），
     没有任何一条退化成目录名 —— 正因如此才必须 bump `store.js` 的 `SCHEMA_VERSION` 让旧缓存作废。

> 说明：`history.jsonl` 现有条目**全都没有 `cwd` 字段**（早年那版过滤器的遗留早已随
> 200 条上限轮转出去），它们正是 F2 的「旧条目兜底池」：改完 ↑/↓ 立刻仍能看到全部老命令，
> 等各目录攒下带标记的新条目后自动按目录分化。**文件不需要迁移，保持原样**。

> 所有组件补丁都做了**语法校验门禁**：`apply-diff-patches.sh` 在写入前 `node --check`
> （仅 `.js`），失败即中止，避免用旧补丁覆盖结构已变的上游文件。

---

## 3. 升级后重打流程（Runbook）

> 何时需要：`dsh` 或 dsh-tui 升级、profile 被重建/目录改名、`dsh-patch` 报
> `MISSING`/`DIFFERS`/`dsh-tui installed ≠ patch built against`。

### Step 0 — 确认装了哪个版本
```bash
dsh-tui version                     # 壳 + profile 版本
node -p "require('$HOME/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/package.json').version"
grep dsh-tui ~/.dsh/profiles/dsh-tui/package.json   # pin —— reconcile 会照它装
cat ~/.dsh-tui/patches/patch-base-version           # dsh-tui 补丁基线
cat ~/.dsh-tui/patches/patch-base-versions.json     # 逐包基线（含 tool 两包）
node -p "require('$HOME/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-fs/package.json').version"
```
> **壳、profile、补丁基线三者对不上时先对齐版本再谈补丁**：0.10.1 与 0.10.2 混着的树上，
> 归档里的 `backup/` 只对其中一个版本成立（见 §1.1 的 pin 说明）。

### Step 1 — 检查缺失
```bash
dsh-patch check        # = bash ~/.dsh-tui/patches/apply-diff-patches.sh check
```
输出逐目标 `OK` / `DIFFERS` / `MISSING` / `NEEDS-REPORT`，并**按包比版本**
（`patch-base-versions.json`）。**0.11.1 起，版本漂移不再等于「打不上」**：脚本会拿
`diffs/<name>.patch` 直接往**已装文件**上打（`patch --fuzz=3`），全部 hunk 落地且
`node --check` 通过才写入，报 `PATCHED-DRIFT` 并在 `state/<name>.sha1` 记账
（下次重跑报 `OK-PATCHED`，不会二次打补丁）。只有「diff 也打不上 / 语法不过」的目标
才报 `NEEDS-REPORT`，那几条才必须先重移植。**0.12.0 起 hunk 是「偏移」还是「fuzz」分开报**：
行号漂移（offset）说明 diff 仍然严丝合缝，报 `PATCHED`/`PATCHED-DRIFT`；只有靠
**fuzz**（上下文模糊匹配）才贴上的报 **`PATCHED-FUZZ`** 并置 drift —— 那种落地可能把 hunk
贴到别的函数上，必须先读 diff 再按 §3 重移植，别当成已补好。`dsh-patch apply` 仍是显式强推
（拿 backup 整文件覆盖，可能在漂移版本上降级），只在确认上游没变时用。

### Step 2 — profile 目录 / 路径是否变
- profile 目录历史上 `tui` → `dsh-tui`。变了就把
  `~/.dsh-tui/patches/apply-diff-patches.sh` 里的 `TUI_PKG` 指向新目录。
- tool 包固定在 `profiles/node_modules/@deepseek-ai/…`（软链向全局 launcher 树）；
  确认路径仍在。
- TUI 内部路径也会搬家（例：0.10.1 的 `channel.d.ts` → `adapter/ports/channel-view.d.ts`）：
  以 `TARGETS` 里某条报 `MISSING` 为准，去新树里找同名/同 interface 文件再改路径。

### Step 3 — 逐文件判断「要不要重移植」
对每个目标：若「新装上游文件 == `patches/original/<x>`」，说明上游没变，**跳过**；
变了则要**重移植**。目标清单由脚本从 `TARGETS` 解析，别手抄：
```bash
cd ~/.dsh-tui/patches
while IFS='|' read -r target name; do
  cmp -s "$target" "original/$name" && echo "unchanged : $name" || echo "RE-PORT   : $name"
done < <(node resolve-patch-targets.mjs)
```
（`node resolve-patch-targets.mjs` 直接打印 `TARGETS` 解析后的 `绝对路径|备份名`；
加 `--paths` 只打印路径。tool 两包与 TUI 文件一视同仁。）

### Step 4 — 重移植（核心）
**先试快路**：`dsh-patch patch` 会用 `diffs/*.patch` + fuzz 3 自动落到新上游上，落得干净
的目标就不用动（报 `PATCHED`/`PATCHED-DRIFT`）。剩下的用 3-way 手工重移植：

把**旧补丁相对旧原版的改动**合并进**新上游文件**：
- `base`   = 旧 `patches/original/<备份名>`（旧原版）
- `theirs` = 旧 `patches/backup/<备份名>`（旧已补丁）
- `ours`   = 新装的上游文件（新版原版）

> 备份名不一定等于文件 basename：tool 两包叫 `dsh-tool-fs.index.js` /
> `dsh-tool-str-replace-editor.index.js`。用 §3 那条 `resolve-patch-targets.mjs`
> 输出里的第二列即可，不要靠猜。

```bash
cd ~/.dsh-tui/patches
P=~/.dsh-tui/patches        # 备份库
T=/tmp/port                 # 临时工作区
name=useSessionSupervisor.js  # ← 换成 §3 报 RE-PORT 的那个备份名
target=$(node resolve-patch-targets.mjs | awk -F'|' -v n="$name" '$2==n{print $1}')

rm -rf "$T/$name" && mkdir -p "$T/$name" && cd "$T/$name"
cp "$P/original/$name" base.js
cp "$P/backup/$name"   theirs.js
cp "$target"           ours.js            # 新装的上游原版
git merge-file -p ours.js base.js theirs.js > merged.js
node --check merged.js                    # 语法必须过（.d.ts 跳过）
grep -nE '^(<<<<<<<|=======|>>>>>>>)' merged.js   # 有冲突则按 §2 意图人工解
```
- **无冲突** → `merged.js` 即新版补丁文件。
- **自检**：`cmp -s ours.js base.js` —— 相等说明上游对这份文件**字节没变**，`merged.js`
  应当与 `backup/<name>` 完全一致（可用 `cmp` 确认），等于白捡一次"重移植成功"。
  （这套 3-way 是幂等的：即使 `ours` 已经是打过补丁的版本，合并结果也仍是打过补丁的版本。）
- **有冲突** → 打开看上下文，按 §2 每个功能的「行为」决定取舍（例如 F3 的三条底线是
  「无 rail + 范围=当前目录 + 扁平列表」；菜单边界是「落历史」而非环绕等）。
- 某个目标**上游没变**（§3 报 `unchanged`）：不需要合并，`ours` 就是 `original/<x>`，
  直接 `cp backup/<x>` 那套照旧即可。
- 只想去掉某项定制，可只抽出该功能的 hunk 重打，而不是整文件合并。
- 解完再 `node --check`。

### Step 5 — 落库 + 应用
```bash
cd ~/.dsh-tui/patches
name=useSessionSupervisor.js                 # 逐个 RE-PORT 的文件重复（备份名以
                                             # resolve-patch-targets.mjs 第二列为准）
cp /tmp/port/$name/ours.js   original/$name  # 新版原版入库
cp /tmp/port/$name/merged.js backup/$name    # 新版已补丁入库
diff -u original/$name backup/$name > diffs/$name.patch || true   # diff 非 0 是正常的

# 全部处理完后：
bash apply-diff-patches.sh apply     # 写入 + 语法门禁
rm -f state/*.sha1                   # 重移植后旧指纹作废（见下方注）
bash apply-diff-patches.sh check     # 期望全 OK
node resolve-patch-targets.mjs | wc -l   # 目标数应等于 original/ 里的文件数
echo "<新版 dsh-tui 版本>" > patch-base-version   # 上面两步都过了再写
# 逐包基线一起更新（脚本按它放行/拦每个目标）：
node -e "const f='patch-base-versions.json',j=require('./'+f);j['@deepseek-harness-tui/dsh-tui']='<新版>';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
# tool 两包换版本时同理改 j['@deepseek-ai/dsh-tool-fs'] / j['@deepseek-ai/dsh-tool-str-replace-editor']
```

> apply 脚本写文件用 `cp --remove-destination`：pnpm 的 `node_modules` 是到
> content-addressable store 的**硬链接**，普通 `cp` 会**写穿 store**（同一个 inode），
> 于是"重装同版本又把补丁带回来"、升级还原反而看不出来（2026-09-17 之前就是这样，
> 9 个目标里 5 个 `OK` 其实是 store 被写脏的假象）。断链后 store 保持纯净。

> **为何最后才写 `patch-base-version`**：它是自动重打的信任锚。先写的话，中途失败会留下
> "版本已对齐、文件其实没落库"的状态，下次升级 `dsh-patch` 会拿旧 backup 覆盖新上游。

> **`state/*.sha1` 什么时候要清**：它是「这套 diff 已经打在这些字节上」的指纹。重移植
> 之后 `diffs/` 变了，指纹里的 patch 哈希对不上会自动失效重打；但若你手工改过目标文件、
> 又想让它重新按 diff 走一遍，`rm -f state/*.sha1` 最直接。（该目录已在 `.gitignore` 里，
> 不入库。）

### Step 5.5 — 提交快照（`patches/` 是 git 仓库的一部分）
```bash
cd ~/.dsh-tui && git add patches && git commit -m "change: re-port patches onto dsh-tui <版本>"
```
升级前的快照留在 history 里，下次重移植的 `base`/`theirs` 随时可从旧提交取回
（`git show <旧提交>:patches/backup/<x>`）。


### Step 6 — 确认用户级设置还在（§1.2）
`~/.dsh/profiles/dsh-tui/cordis.patch.yml` 里有 `diffLayout: unified`（并重述了 bundle 的
其余键）；`theme.json` 是
`claude-code`。缺失则补回。

### Step 7 — 重启验证
完全退出并重开 `dsh-tui`（进程会缓存已加载模块，必须重启才吃新 JS），然后按 §2 的
「验证」逐项过 F1–F3：
- **F1**：触发一次 Edit/Write，看 CC 统一式 diff（行号 + 绿红底；NEW 文件只出前 10 行）。
- **F2**：↑/↓ 只翻到**当前目录**输过的命令（别的目录不出现；旧的**无**标记条目仍作兜底，
  所以刚改完看起来和以前一样）；菜单在第 0 项按 ↑ 进历史。命令行侧：
  `node ~/.dsh-tui/patches/test-history-cwd.mjs`。
- **F3**：`/resume` 应只列**当前目录**的会话（别的目录不出现），左侧**无工作区 rail**、
  无「工作区」分区头；`←` 不改变光标归属；Ctrl+N 新建落在**当前目录**；命令行侧：
  `node ~/.dsh-tui/patches/test-resume-flat.mjs`。

并顺手确认仍是 stock 的部分：会话标题按宽度截断；vim 默认关且 `/vim` 后指示仍在输入框内、
状态栏不再出现 `-- INSERT --`。**`/resume` 已不是 stock**（F3：无 rail、范围=当前目录）。

### Step 8 — 文档一致性核对
本文档是下次重移植的依据，所以**文档里过时的一句 = 一条错误指令**（每次升级都可能悄悄
漂移：0.10.1 那次就留下过「resume 浏览器 = stock」这种与代码相反的结论）。一条命令把
§1 的版本、§2 每条「行为」断言的代码事实、§3 引用的脚本全部核对一遍：

```bash
bash ~/.dsh-tui/patches/check-doc-consistency.sh    # 全过则 exit 0
```

覆盖面：§1.1 版本表（壳 / 生态 / tool 两包都按各自基线断言，含
`patch-base-versions.json` 可解析且与 `patch-base-version` 一致）/ §1.2 用户级设置 /
F1 的 `DIFF_BODY_MAX_LINES` 与 `NEW_FILE_DIFF_MAX_LINES` 与 `hoverTint` 已删 **与 tool 侧
4 个锚点（`oldStart`/`newStart` 产出、`presentationMeta` 转发、`computeHunkDiffs`、
`presentResult`）与「tool 补丁不含上游回退」** / F2 的 `loadHistory(cwd)`、
`loadHistoryOldestFirst(cwd)`、共用的 `scopeToCwd`、`historySeedCwd`、
`appendHistory(text, channel.cwd)` 与 Ctrl+R 走 `channel.cwd` /
F3 的 `railVisible = false`、按目录过滤的 `samePath(session.cwd, channel.cwd)`、
`useState('list')`、rail 选择状态已删、Ctrl+N 用钉死目录、i18n 补丁只动
`supervisor-hint-list` / F4 的 `isFileAddress`、`lastPromptOf`、`normalizeLastPrompt`、
`LAST_PROMPT_TITLE_CHARS = 200`、两层 prompt 都跳过地址、`hasPrompt` 仍取自非过滤候选、
**占位标题判 `strong: false`（3 处扫描按 grep 计数 + 增量 1 处）、`titleComplete` 不再跟着
占位走、首条 prompt 也归一化、`store.js` 的 `SCHEMA_VERSION = 5` 且版本 4 不可读、
`store.js` 在 TARGETS 里、行为测试覆盖占位标题** /
仍应 stock 的 vim、`ToolFileDiff.d.ts` 与 **F5 的 `recapOnOpen`**（`dsh-adapter/index.js`
不在目标里 + `test-recap-setting.mjs` 的上游契约通过）/
apply 脚本的断链拷贝（`cp --remove-destination`）、**diff 直打路径（`patch -p0 --fuzz=3`、
`PATCHED-DRIFT`、`OK-PATCHED` 指纹、写不进就 `ABORT`）**、**hunk 报告取自 stdout 且
「偏移 ≠ fuzz」（`patch.out`、`patch_was_fuzzy`、`PATCHED-FUZZ`、`--read-only=ignore`）**、
分目标守卫（`NEEDS-REPORT`）
与逐包基线读取 / `dsh-patch` 别名在 `~/.zshrc` 与 `~/.bashrc` 里都在 /
目标数 = `original/` = `diffs/` 且命名一致 / **每个 `diffs/*.patch` 都能在它自己的
`original/` 上 `--fuzz=0` 干净贴上且结果 == `backup/`**（只有真正重移植过的基线做得到；
要靠 fuzz 才贴得上就是漂移）/ 三个行为测试通过。
失败项会打印 `FAIL` 指出是哪条断言——对着它改代码或改文档，别放着。

---

## 4. 参考：历次版本迁移记录（帮助判断重移植量）
| 迁移 | 现象 | 备注 |
| --- | --- | --- |
| `profiles/tui` → `profiles/dsh-tui` | 目录改名，补丁 MISSING | 改 apply 脚本 `TUI_PKG` |
| 0.9.3 → 0.10.0-beta 线 | 生态变 rc.2；新增 vim/浏览器等 | 0.9.x 无法在 rc.2 跑 |
| beta.3 → beta.4 | 6/10 文件上游微变 | `SessionListRow.js`、`SessionBrowser.js` 字节不变 → 免移植；其余用 §3 方法 |
| beta.4 → beta.5 | 8/10 TUI 文件上游全变（tool 两包字节不变，已补丁在位） | 全量 §3 重移植：beta.5 新增 header 悬浮提示/PageInset 等已并入；`SessionBrowser` 右键菜单（beta.5 新上、beta.4 平铺视图已移除）继续不启用，但 beta.5 同行的 rename `width:"100%"`、`Divider bleed:true` 修复已并入；`Chat.js` 注释校正为「toggle 落回 insert」（与实际一致）|
| beta.5 → 0.10.0 | 10/10 全变；tool 两包 0.1.1-rc.2 → 0.1.2-rc.1（上游 68/36 行变更） | 全量 §3 重移植：`PromptInput` 上游大改（draft 图片绑定、`clearVimUndo()`、history 条目变 `{text, images}`、新增 fileOverlay），F4/F5/F6 手工重放（历史播种改为适配带 images 的条目结构）；`Chat` 新增 recap/BTW/statusEntries/图片预览等，vim 接线 3 处手工并入；`AssistantToolUseMessage` 上游 `addMargin`→`marginTopOnTurn` 改名 + hoverTint（沿用偏好：hover 不变底色，已删悬空定义）；`SessionBrowser` 仅 figures 路径 `cc/`→`terminal-utils/` 改名，等于旧已补丁 +1 行 import；`StatusLine`/`i18n` 微变自动并入；`SessionListRow` 字节不变 → 免移植；版本提示语已并入 |
| 0.10.0 → 0.10.1 | 3/5 目标上游变化：`AssistantToolUseMessage`（94 行，新增 `foldBodyLines` 长行裁剪）、`i18n`（11 行）、channel 类型大拆分；`PromptInput`/`SessionBrowser` **字节不变** → 免移植；tool 两包仍 0.1.2-rc.1 → 免移植 | 同时**删掉五项定制**：SessionListRow（旧 F2 标题不截断）、SessionBrowser + i18n（旧 F3 resume 全量会话）、Chat/StatusLine/PromptInput 的 vim 改动（旧 F4/F5）、ToolFileDiff 类型补充（旧 F7）——对应文件移出补丁集、恢复 stock；F1 的 new-file 上限与上游 `foldBodyLines` 手工合流（二者同作用于 `bodyLines`）；补丁集 10 → 4 个目标文件（10→7→6→4），`patch-base-version` = 0.10.1 |
| tool 包 0.1.0-rc.8 → 0.1.1-rc.2 | 字节不变 | 免移植 |
| tool 包 0.1.1-rc.2 → 0.1.2-rc.1 | 上游 68/36 行变更（随 0.10.0 迁移处理） | 已并入 |
| （非升级）**F3：resume 无 rail + 只看当前目录** | 整文件分叉：`SessionBrowser.js` 取 0.10.1 stock 与原分叉的 3-way 合并（上游两文件字节未变 → 0 冲突），`i18n.js` 只改 hint 文案 | 沿用 `23086fc` 那版分叉的"删 rail + 去目录分组 + 去钻取页"，但范围**固定当前目录**（`allProjects: false`，`mod+a` 置空）。中途被否掉的方案：薄补丁保留 rail 只去分组、rail 阈值 120→90、以及一度把默认设成 `allProjects: true`（列全部）——用户最终要的是**按当前目录过滤**。补丁集 4 → 6 个目标；新增 `test-resume-flat.mjs`。`patch-base-version` 仍 0.10.1 |
| （非升级）**F2：↑/↓ 历史按当前目录过滤** | `history.js` 加 `cwd` 读写（约 40 行）、`PromptInput.js` 播种/打标、`Chat.js` Ctrl+R 改读过滤版（1 行）；3 个文件都是薄改动 | 写入时给条目打上提交目录，`loadHistory(cwd)` 只返回该目录条目；**旧的无标记条目在当前目录为空时兜底**（升级平滑），有本目录条目后自动让位。`historySeedCwd` 让播种**按目录重播**（workspace picker 能中途换目录），顺带修掉旧补丁"每次 render 都重新播种、会在落盘前抹掉刚提交命令"的竞态。去重按目录分别算。0.10.1 迁移时曾撤回过一版 cwd 过滤（当时 resume 还打算做全量），F3 定为「只看当前目录」后按用户要求恢复。补丁集 6 → 8 个目标；新增 `test-history-cwd.mjs`。`patch-base-version` 仍 0.10.1 |
| （非升级）**文档/代码一致性核对** | 审计出 3 处漂移：①§2 开头「resume 浏览器 = stock…补丁集回到 4 个目标」与 F3 章节直接相反；②`README` 标题写 `all-projects`；③i18n 补丁把**死分支** `session-scope-all` 带成旧文案「全部项目」（stock 是「全部工作目录」） | ①②**改文档**（那句是上一轮加 F3 时的漏改）；③**改代码**——i18n 补丁现在只动 `session-hint-list*` 三个 key，不回带无关 hunk。新增 `check-doc-consistency.sh`（当时 31 项断言，见 §3 Step 8），把"文档描述的就是装着的代码"变成可重跑的检查——**每次升级后都该跑一遍**，因为漂移正是升级时留下的。`patch-base-version` 仍 0.10.1 |
| （非升级）**F4：/resume 标题 = Claude 取名链 + 地址过滤** | 只动 `digest.js` 一个文件（新增 `LAST_PROMPT_TITLE_CHARS` / `isFileAddress` / `normalizeLastPrompt` / `lastPromptOf`，`digestSession()` 的标题选择与 `recoverFirstPrompt()` 各改几行），UI 一行未碰 | 三版迭代：① 纯地址过滤器 → ② 只照 Claude 链条、读取层不过滤 → ③ **当前版**：Claude 的顺序（标题事件 → **最近一条** prompt → 首条 prompt → 目录名，`normalizeLastPrompt` 折行/trim/200 字符截断）+ 两层 prompt 都跳过文件地址。`hasPrompt` 与标题候选解耦（`digestSession` 用未过滤的 `prompt`，`recoverFirstPrompt` 返回 `hasPrompt`），否则地址型首句的会话会被当成空会话进 `mod+x` 的破坏性清理。回归：161 条真实日志改动前后逐条相同 → 未动 `store.js` 的 `SCHEMA_VERSION`。补丁集 8 → 9 个目标；新增 `test-resume-title-chain.mjs`。`patch-base-version` 仍 0.10.1 |
| **0.10.1 → 0.10.2**（2026-09-17，profile 由应用内 update-restart 升级） | 升级把 **7/9** 个 TUI 目标文件恢复成 stock；上游**真正变化**的只有 2 个：`Chat.js`（63 行：`/jobs` 面板自己接管 Esc/`k`（否则关面板的 Esc 会顺手取消进行中的回合）、`openJobsPanel` 用 `useCallback` 稳定 handler 身份、`LoadedContextPanel` 的折叠 reanchor 移进 `useLayoutEffect`）与 `digest.js`（149 行：`humanPrompt()` 改返回 `{ text }`、`completeHead` 取代 `head.whole` 且要求首行是 `session`、`hasPrompt = hasHumanMessage \|\| !completeHead`、`recoverFirstPrompt()` 开始回报 `hasPrompt`）；其余 7 个（`AssistantToolUseMessage`/`history`/`PromptInput`/`SessionBrowser`/`i18n` 等）**字节未变** → 直接 `cp backup/` 恢复；tool 两包仍 0.1.2-rc.1 且补丁未被覆盖 → 免移植 | `Chat.js` 0 冲突（就那 1 行 Ctrl+R）；`digest.js` 5 处冲突按 §2 F4 解：候选判断全部改走 `.text`（`lastPromptOf`/`opening`），`opening` 只收"有文本且非地址"的候选，而"任何人类消息都算有对话"交给上游的 `hasHumanMessage`，`recoverFirstPrompt()` 继续在 `.text` 上跳过地址并单独回报 `hasPrompt`。**上游收紧暴露的两个坑（已一并修）**：①0.10.2 会校验日志**首行 `type === 'session'`** 才算读完，而 `test-resume-title-chain.mjs` 的夹具从写下那天起就用 `session/header`（真实日志 171 条全是 `session`；0.10.1 不校验所以没暴露）→ 夹具改成真实首行，否则空会话会被误判成"有对话/没读完"，进而骗过 `mod+x` 的空会话清理；②`check-doc-consistency.sh` 里 3 条断言引用的是旧代码形状（`prompt !== undefined \|\| !head.whole` 等），随代码一起上新，并补 5 条锚点（`{ text }` 形状、recovery 跳地址、夹具首行、两份文档的版本号）。回归：**171 条真实会话日志上 patched vs pristine 0.10.2 的 `digestSession()` 逐条相同**（title/source/hasPrompt 全等；无异常、无地址标题）→ 缓存不作废，未动 `SCHEMA_VERSION`。补丁集仍 **9** 个目标，`patch-base-version` = `0.10.2` |
| （非升级）**全局壳 0.10.0 → 0.10.2 对齐** | 壳是瘦壳（`bin/dsh-tui.js` + `package.json`，逻辑永远来自 profile 副本），所以只按上游提示跑 `npm install -g --legacy-peer-deps @deepseek-harness-tui/dsh-tui@0.10.2`；结果 `dsh-tui version` 显示 launcher/profile 双双 0.10.2 | 踩到一个与包无关的坑：**本机 `https_proxy=127.0.0.1:7890` 已不可用**，npm 拿不到新 packument 就退回本地缓存 → 报 `ETARGET No matching version found for …@0.10.2`（而 0.10.2 其实 11:45 就发布了，profile 也是 14:26 用 pnpm 装上的）。直连（`curl --noproxy '*'`）正常，于是用 `env -u https_proxy -u http_proxy -u all_proxy npm install -g …` 绕开代理安装成功。**下次装包报 notarget 先怀疑代理+缓存，别怀疑版本号**。壳升级不动 profile 与 `~/.dsh/profiles/node_modules/@deepseek-ai/*`（tool 两包仍带补丁、9/9 目标 check 通过） |
| **profile 掉回 0.10.1 → 整套补丁打不上**（2026-09-17 晚） | `dsh` 启动按 profile 的 pin（`~/.dsh/profiles/dsh-tui/package.json` = `0.10.1`）reconcile `node_modules`，把当天上午应用内 update 装上的 0.10.2 **拉回 0.10.1**；而补丁基线已是 0.10.2 → 脚本的**全局**版本闸门直接 `Skipping auto re-apply`，**9/9 目标一个都没打**。同时生态升到 `dsh 0.1.5-rc.2` 把 tool 两包带到 **0.1.5-rc.2**，而 `original/` 还是 `0.1.2-rc.1` 的形状 → 那两条就算闸门放行也不能用。附带查出的隐患：pnpm 的 `node_modules` 是 store 硬链接，旧脚本 `cp "$backup" "$target"` **写穿 store**，于是「重装同版本又把补丁带回来」，`OK` 5/9 是假象 | ①先修版本关系：`env -u https_proxy -u http_proxy -u all_proxy pnpm add -C ~/.dsh/profiles/dsh-tui @deepseek-harness-tui/dsh-tui@0.10.2`（**改 pin 才持久**，pnpm 自动补 `minimumReleaseAgeExclude`）+ 全局壳同版本 `npm install -g --legacy-peer-deps …@0.10.2`；②**tool 两包按 0.1.5-rc.2 重做** `original/backup/diffs`——旧 hunk 能干净落上（`patch` 报 offset −6），同时把旧 backup 夹带的上游回退（去掉 scope-aware 提示语、`REMEDIES` 倒回内联）一并清掉；③`apply-diff-patches.sh` 改为**逐包基线 + 分目标守卫**（新增 `patch-base-versions.json`：dsh-tui/tool 两包各记版本，漂移的目标报 `NEEDS-REPORT` 只跳过自己，其余照打）+ `cp --remove-destination` 断链，`resolve-patch-targets.mjs` 补 `$TOOLS` 替换；④复验：7 个 TUI 目标逐个「`diff -u` 补丁打在 0.10.2 stock 上 == `backup/`」，2 个 tool 目标同法复验，脚本 9/9 `applied` 后 `check` 全 `OK` exit 0；⑤`check-doc-consistency.sh` 补 12 条断言（F1 tool 侧 5 条、基线一致 2 条、脚本守卫 3 条、`dsh-patch` 别名 2 条——顺带把"别名并不存在"的旧注释改成真断言）→ **58/58 通过**，三个行为测试通过。**结论：补丁基线必须等于 pin 指向的版本，壳/生态/tool 包各记各的。** |

| **0.11.1 迁移**（2026-09-28，生态 `dsh`/tool 两包 → `0.1.7-rc.2`，profile & 壳 → `0.11.1`） | 升级把 **9/9 旧目标全部还原成 stock**；`dsh-patch` 因逐包基线漂移把它们全报 `NEEDS-REPORT`（用户看到的「补丁没补」）。更根本的变化：**`/resume` 被上游整屏重写** —— `screens/SessionBrowser.js`（旧 F3 的整文件分叉对象）被删除，改为 `screens/SessionSupervisor.js`（工作区 rail + 会话面板 + 多会话托管）。其余上游变化：`tool-fs` 118 行（write 结果多了 `operation` 字段）、`str-replace` 仅 3 行、`PromptInput` 321 行（新增 `loadHistoryOldestFirst`，播种重构成 `seedHistory()`+`historySeeded` 布尔）、`AssistantToolUseMessage` 56 行、`i18n` 218 行（`session-hint-list*` 全部消失）、`Chat` 372 行；`digest.js` **字节未变** | ①逐目标 3-way（`base`=旧 original、`theirs`=旧 backup、`ours`=新 stock）：`history`/`Chat`/`digest`/`str-replace` 0 冲突；冲突 4 处按 §2 意图解——`tool-fs` 保留上游新的 `operation` 形状并补 `oldStart/newStart`、`AssistantToolUseMessage` 只留 hover 文案（`hoverTint` 分支仍不恢复）、`PromptInput` 的 import 走 `loadHistoryOldestFirst`、i18n 的旧 key 已死（改打 `supervisor-hint-list`）。②**F2 适配上游新 API**：过滤抽成 `scopeToCwd`，`loadHistory(cwd)` 与 `loadHistoryOldestFirst(cwd)` 共用，`seedHistory()` 的守卫由布尔改成 `historySeedCwd`。③**F3 改为薄补丁**（用户选定「等价移植」）：`railVisible = false`、`activePane` 起手 `list`、`activateRail` 置空、`selected` 由 `channel.cwd` 合成、`visibleSessions` 按 `samePath(session.cwd, channel.cwd)` 过滤并删掉 stock 的 rail 选择状态（`selectedPath`/`selectedUnregistered`/`selectionManual` 与自动选中 effect），`SessionSupervisor.js` 的 Ctrl+N 改用钉死目录，i18n 只改 `supervisor-hint-list`。④**`apply-diff-patches.sh` 升级为「能直接打补丁」**：漂移目标不再跳过，改用 `diffs/<name>.patch` + `patch --fuzz=3` 打在**已装文件**上，全部 hunk 落地且 `node --check` 通过才写入（`PATCHED-DRIFT`），并把结果指纹写进 `state/<name>.sha1` 使重跑幂等（`OK-PATCHED`）；写不进目标时 `ABORT`（旧的 `cp` 失败仍打印 applied 是假成功）。⑤复验：10/10 目标 `check` 全 `OK`、三个行为测试通过（`test-resume-flat.mjs` **重写**成新屏的 12 条断言，并在 stock 上验证过会失败 7 条）、`check-doc-consistency.sh` 全过。补丁集 9 → **10** 个目标，`patch-base-version` = `0.11.1` |

| **0.11.2 迁移**（2026-09-29，profile & 壳 → `0.11.2`；生态/tool 两包不变） | `dsh-patch check` 只报 **1 个 `NEEDS-REPORT`**：`dsh-adapter/index.js`（F5）——第 2 个 hunk 在 0.11.2 上失败（硬编码的可编辑键数组已被 `EDITABLE_CONFIG_KEYS` 取代）；其余 8 个 TUI 目标由 `diffs/*.patch` + `fuzz 3` 自动贴回（`history.js` 字节相同，7 个 `PATCHED-DRIFT`）。注意 F5 的**第 1 个 hunk 虽报 `succeeded with fuzz 3`，却是假落地**：它插在 `mathRendering` 之前，与上游自己后面那句 `recapOnOpen: Schema.boolean()` 重复，对象字面量里后者生效 → hunk 2 就算过了也等于白打，所以**不能**用 `dsh-patch apply` 强推 | ①先判 F5 留不留：上游 0.11.2 已自己修好（声明 `recapOnOpen`，volatility 由 `SETTING_DEFINITIONS` 派生的 `EDITABLE_CONFIG_KEYS` 提供），`test-recap-setting.mjs` 实测键在 / volatile / 显式 `false` 存得下 / `/settings` 行与读点都在 → **退役**（删三件套、`TARGETS` 11 → 10、测试改成守 stock 契约）。②其余 8 个目标按 §3 复核：`git merge-file`（`base`=0.11.1 `original`、`theirs`=0.11.1 `backup`、`ours`=0.11.2 stock）结果与已装文件**逐字节相同**（7 个 0 冲突，`merge-file` 只差不写尾换行）；`useSessionSupervisor.js` 1 处冲突＝上游新增的「rail 按 cwd 自动选目录」effect 撞上 F3 的整体替换——**保留**上游新的 `snapshotSlot` 清理 effect、**删掉** rail 选择 effect（fork 里 `selectedPath`/`selectionManual`/`selectedUnregistered` 已不存在），F3 行为测试通过。③`original/` 换成 npm 取回的 0.11.2 原版（tool 两包 `original/` 亦与 0.1.7-rc.2 上游逐字节核对通过），`backup/` 换成复核后的已补丁件，`diffs/` 重新生成（**每个都在 0.11.2 stock 上 `--fuzz=0` 干净贴上且结果 == `backup/`**），`state/` 清空。④基线 `patch-base-version` 与 `patch-base-versions.json` → `0.11.2`；`check` 10/10 `OK` exit 0，四个测试通过，`check-doc-consistency.sh` 仅剩 `dsh-patch` 别名那两条 FAIL（别名确实不在 `~/.zshrc`/`~/.bashrc`，与本次升级无关，用绝对路径仍可跑） |

| **0.12.0 迁移**（2026-09-30，profile & 壳 → `0.12.0`；生态 `dsh`/tool 两包 → `0.2.0-rc.2`） | `dsh-patch check` 报 **10/10 `DIFFERS`**（补丁全被升级还原），但**没有一条 `NEEDS-REPORT`**：其中 7 个目标（`AssistantToolUseMessage`/`history`/`useSessionSupervisor`/`SessionSupervisor`/`digest` 加 tool 两包）的新 stock 与 `original/` **逐字节相同** → 整文件恢复即可；上游真正动过的只有 `Chat.js`、`PromptInput.js`、`i18n.js`（鲸鱼券弹窗 `WhaleCouponPrompt`/`bonusNotices`、`channel.minimal` → `minimalUi`、`cycleMode()` 补 catch、`/resume` 一批新 key 等） | ①按 §3 对那 3 个做三方合并（`base`=0.11.2 `original`、`theirs`=0.11.2 `backup`、`ours`=0.12.0 stock）：**3/3 零冲突**，且结果与「旧 diff 直接贴在 0.12.0 上（`--fuzz=0`）」**逐字节相同** → 定制点一处没挪窝，上游改动全部保留（F2 的 `historySeedCwd` 三处、Ctrl+R 的 `loadHistory(channel.cwd)`、F3 的 `supervisor-hint-list` 文案）。②`original/` 换成 0.12.0 stock（= 已装原版）、`backup/` 换成合并结果、`diffs/` 重新生成，**10/10 都能在各自的 `original/` 上 `--fuzz=0` 干净贴上且结果 == `backup/`**；`state/` 保持空。③基线 `patch-base-version` = `0.12.0`、`patch-base-versions.json` = dsh-tui `0.12.0` + tool 两包 `0.2.0-rc.2`（两包 `lib/index.js` 与 0.1.7-rc.2 **逐字节相同**，所以旧补丁原样有效，只换版本号）。④**顺手修掉 `apply-diff-patches.sh` 的两个真 bug**：GNU patch 的 hunk 报告（含 `with fuzz N`）走 **stdout**，旧脚本只重定向 stderr、又带 `-s` → 失败时 `NEEDS-REPORT` 下一行证据都打不出来、成功时 patch 的啰嗦话反倒漏进报告（列 0 那些 `File … is read-only` 就是它）；现在 stdout/stderr 两路都抓，并把 **fuzz 与 offset 分开报**（`PATCHED-FUZZ` 置 drift：fuzz 是上下文模糊匹配，可能贴到错的函数上），另加 `--read-only=ignore` 去掉 `-o` 下毫无意义的只读警告。⑤`check-doc-consistency.sh` 的 launcher 断言由硬编码 `0.1.7-rc.2` 改成**从已装树读版本 + 断言文档记的就是它**（生态每次升级不必再手改这一条，且断言更强），并补 3 条脚本锚点。⑥复验：`apply` 10/10 `applied` → `check` 10/10 `OK` exit 0，四个行为测试全过。补丁集仍 **10** 个目标，`patch-base-version` = `0.12.0` |
| （非升级）**F4 ④：dsh 的兜底占位标题不算名字**（2026-10-07） | 用户报「resume 会只显示文件地址，导致分不清」。根因不在 Claude 链（③ 已经过滤 prompt 候选），而在 dsh 自己写进日志的 `session/title` 事件：`dsh-session-title` 的确定性兜底会把**首条 prompt 截断**后落盘（`source.kind: 'fallback'`），上游"最后写入者胜"让它排在 provider 标题之前、并整条压过 ③ 的 prompt 链 → mallphp 里 3 个会话的行标题都是 `@modules/client/controllers/v1/auction/A`（全库 232 条里 17 条有占位标题，8 条是地址形态） | ①`titleOf()` 一处判强弱：`provider`/`user`/无 source = `strong: true`，`fallback` = `false`；三处扫描（head/tail 窗口、深度反扫、增量后缀）只收 `strong`；`titleComplete` 不再跟着占位走（尾部只有占位 → 留给深度扫描，它能从"没读到的中间"取回 provider 标题）。②深度反扫顺路记下"最近一条非地址 prompt"（`recoverLatestTitle()` → `recoverLatestName()`），让深度扫描和快速路径给出同一个名字。③首条 prompt 也走 `normalizeLastPrompt()`（以前原样上报，多行首句会撑开整行）。④**`store.js` 的 `SCHEMA_VERSION` 4 → 5**：语义变了而日志一个字节没变，版本 4 索引里存着旧占位标题且会被无限命中 → 整份丢弃、自动重算（旧进程写回版本 4 也照样不认），**不需要手动删缓存**。⑤回归：231 条真实日志里 59 条标题改变（11 条露出本来被压住的 provider 标题，0 条退化成目录名）；`test-resume-title-chain.mjs` 新增 6b–6e 一节；补丁集 10 → **11** 个目标；与远端 0.12.0 迁移合并后，基线取 `0.12.0` |

**定制状态备忘（含已恢复 / 已去掉）**

> 编号复用提醒：下表是**旧编号**，其中「旧 F4 / 旧 F5」指 vim；2026-09-11 新增的
> **F4 标题链路**（§2）只是借用了 F4 这个号，与 vim 无关，别按旧 F4 的描述去找文件。

| 旧编号 | 内容 | 现状 |
| --- | --- | --- |
| 旧 F2 | `SessionListRow.js` 会话标题显示全文（去 `truncateWidth`） | stock：标题按宽度截断；补丁文件已删除 |
| 旧 F3 | resume 浏览器去掉 workspace rail / 当前目录过滤，永远平坦显示全部会话 | **部分恢复为 F3**：去掉 rail 与目录分组、保持扁平列表，**但保留当前目录过滤**（2026-09-11 用户最终确认："只显示当前工作目录的历史会话"，且不要左侧目录栏）。别再退回 stock 的 rail，也别再把范围改成全部目录 |
| 旧 F4 | vim 默认 ON、INSERT 起手（`PromptInput` + `Chat` 初始状态） | stock：vim 默认 OFF，`/vim` 开启 |
| 旧 F5 | `INSERT/NORMAL` 指示从输入框移到 `StatusLine` | stock：指示在输入框内；`Chat`/`StatusLine` 接线已移除 |
| 旧 F7 | `ToolFileDiff` 增加可选 `oldStart`/`newStart`（配合 F1 的 hunk 行号；0.10.1 迁移时曾短暂编号为 F4） | 不再打补丁；字段由 tool 包（JS）产出、渲染器（JS）动态读取，`.d.ts` 只影响 `tsc`，安装后的包不做类型检查，因此零运行时影响。需要类型时在自己工程里 `declare module` 增强 |
| （无编号） | ↑/↓ 历史按 `cwd` 过滤（`history.js` + `history.d.ts` + 回填脚本） | **已恢复为 F2 的一部分**：0.10.1 迁移时曾整版撤回（当时代价是 ↑/↓ 立刻变空），2026-09-11 F3 定为「只看当前目录」后按用户要求恢复，并加了**旧条目兜底**解决空窗。`history.d.ts` 仍不打补丁（同旧 F7 的理由） |
| 新 F5 | `recapOnOpen` 写回 adapter 的 Config schema（`dsh-adapter/index.js`），让 `/settings` 的 "Auto recap on open" 存得下去 | **已退役（0.11.2 起回归 stock）**：0.11.1 保留了 `/settings` 行与读取却把键从 schema 里删了，保存报 `Config field "recapOnOpen" is not volatile`，自动 recap 关不掉——当时的补丁声明该键并标 volatile。0.11.2 上游自己声明了 `recapOnOpen: Schema.boolean()`（**故意不给 `.default()`**：volatile 包装会吞掉默认值，而读点 `channel.js` 用 `!== false` 把 `undefined` 当开），volatility 改由 `SETTING_DEFINITIONS` 派生的 `EDITABLE_CONFIG_KEYS` 提供 → 补丁三件套（`backup`/`original`/`diffs`）已删，`TARGETS` 里也不再列它。`test-recap-setting.mjs` 保留但**改成守上游契约**（键在、volatile、显式 `false` 存得下、未设置不读成 `false`、行与读点仍在）——下次上游再把这键弄丢，它会响。 |

备份目录语义：`original/`=纯净上游；`backup/`=已补丁（apply 恢复源）；
`diffs/*.patch`=original→backup 差异（供查看）。git 历史（`~/.dsh-tui` 仓库）保留每代
快照，可取回任意旧 `original/backup` 作为 §3 的 base/theirs。
