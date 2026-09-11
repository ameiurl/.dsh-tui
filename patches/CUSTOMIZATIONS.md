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
| `@deepseek-harness-tui/dsh-tui`（实际运行的 TUI） | `~/.dsh/profiles/dsh-tui/node_modules/…` | `0.10.1` |
| profile 目录名 | `~/.dsh/profiles/dsh-tui` | （旧版本叫 `tui`） |
| delegating 壳（`dsh-tui` 命令） | 全局 `@deepseek-harness-tui/dsh-tui` | `0.10.0` |
| launcher / 生态 `@deepseek-ai/dsh` | 全局 | `0.1.2-rc.1` |
| tool 包 `dsh-tool-fs` / `dsh-tool-str-replace-editor` | `~/.dsh/profiles/node_modules/@deepseek-ai/…` | `0.1.2-rc.1` |
| 补丁构建基线 | `patches/patch-base-version` | `0.10.1` |

**版本关系（重要，别再踩坑）：**
- dsh-tui `0.10.0-beta` 线与生态 `0.1.1-rc.2` 配套；peer 范围二者相同，可互换 minor。
- **不要混装 0.9.x**：0.9.x 需要更老的生态（rc.1），在 rc.2 上会因 cordis 服务
  `tuiThemes` 缺失而 boot 失败。
- delegating 壳只拦「profile 的 major/minor 比壳更旧」；同 minor 的 patch 错位只提示不拦。
  所以 `beta.3`（同 `0.10`）能跑，`0.9.3`（minor 9 < 10）会被拦。
- 壳 `0.10.0` + profile `0.10.1` 属同 minor patch 错位，壳只提示不拦（实测可跑）。

### 1.2 用户级设置（升级后确认仍在）
| 文件 | 内容 | 作用 |
| --- | --- | --- |
| `~/.dsh/settings.yaml` | `dsh-tui: { diffLayout: unified }` | 强制 unified diff 布局（否则 `auto` 宽屏退 split，CC 样式看不到） |
| `~/.dsh-tui/theme.json` | `{ "theme": "claude-code" }` | 激活 CC diff 配色 |
| `~/.dsh-tui/themes/claude-code.json` / `-light.json` | — | CC diff 调色板（升级不动） |

---

## 2. 定制功能清单（升级后逐项要「回来」的东西）

> **编号说明**：0.10.0 → 0.10.1 迁移时列表曾重排为 F1–F2（去掉了五项旧定制）；此后
> **旧 F2「resume 全量会话」已按用户要求恢复**，因此现在编号为 F1–F3：
> F1 diff 渲染、F2 resume 扁平全量会话、F3 ↑/↓ 历史。
> 仍然**去掉**的四项：旧 F2 会话标题不截断、旧 F4 vim 默认开启/INSERT 起手、
> 旧 F5 vim 指示移到底部状态栏、旧 F7 `ToolFileDiff` 类型补充（后两项与运行时无关，
> 只影响 `tsc`）。找回办法见 §4 与 git 历史。
>
> **当前补丁集 = 7 个目标文件**（F1 三个 + F2 三个 + F3 一个；
> `node resolve-patch-targets.mjs` 可列出），`patch-base-version` = `0.10.1`。

### F1 — Edit/Write 的 diff 用 Claude Code 统一风格渲染
- **涉及文件（3 个）**：
  - `profiles/node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js`
  - `profiles/node_modules/@deepseek-ai/dsh-tool-str-replace-editor/lib/index.js`
  - `…/dsh-tui/lib/types/components/messages/AssistantToolUseMessage.js`
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

### F2 — resume / 会话浏览显示全部历史会话（去掉目录过滤）
- **涉及文件（3 个）**：
  - `…/dsh-tui/lib/types/screens/SessionBrowser.js`（默认 `allProjects`、永驻 sessions 层、无 rail）
  - `…/dsh-tui/lib/types/sessions/view.js`（不再产出 `▣ <path>` 项目分组头）
  - `…/dsh-tui/lib/types/i18n.js`（`session-hint-list*` 去掉 rail / 右键菜单字样）
- **行为**：resume 打开即**全部项目**的历史会话，**扁平一列**（按项目分组排序：当前目录在前，
  其余按最近使用），不再有 workspace rail、不再能钻进目录页；`mod+a` 变成无操作
  （没有「当前目录」态可切）；列表提示不再宣传 `← 工作目录` / `右键菜单`。
  - 这是**薄补丁**，不是 beta.4 起的那种整文件分叉：stock 的右键菜单、pin（`mod+p`）、
    重命名/删除/清空壳、Tab 预览、`mod+s` 子运行折叠**全部保留**；被去掉的只有 rail 与
    目录分组。旧分叉之所以 45KB，是因为它把这些一起删了 —— 别再走那条路。
  - 实现要点：`useState(() => ({ ...DEFAULT_FILTERS, allProjects: true }))` + `const level = 'sessions'`
    （配 `const setLevel = () => {}`，任何残留调用都进不了已不渲染的 workspace 页）+
    `const workspaceRail = false`；`view.js` 里删掉推 `kind:'project'` 行的整段循环体。
  - 与 F3 无关：这里说的是 **resume 列表**；↑/↓ 的输入历史另见 F3。
- **验证**：
  1. 打开 resume（`/resume`），应看到所有目录的历史会话，且**没有** `▣ /path` 分组行、
     没有左侧目录栏；
  2. `mod+p` 仍能 pin、右键仍出菜单、`Tab` 仍能预览、`mod+s` 仍能展开子运行；
  3. 命令行无头渲染快检（不启动 TUI、不写文件）：
     ```bash
     node ~/.dsh-tui/patches/test-resume-flat.mjs
     ```
     需要指向别的安装位置时用 `DSH_TUI_PKG=/path/to/dsh-tui` 覆盖。

### F3 — ↑/↓ 跨会话历史 + 建议菜单边界落历史
- **涉及文件（1 个）**：`…/dsh-tui/lib/types/components/PromptInput.js`
- **行为**：
  - ↑/↓ 读取**持久化历史文件**（跨会话、跨进程可翻，**全部目录共用一份**，
    `loadHistory()` 原样返回 `~/.dsh-tui/history.jsonl` 的内容；Ctrl+R 历史搜索同理）。
  - 在命令建议菜单顶部/底部再按 ↑/↓ **落到历史**（而非 stock 的环绕）。
- **重移植注意**：只保留这两组改动（`loadHistory` 播种 + 菜单边界落历史）；
  vim 相关（默认开启、`onVimChange` 上报、输入框内指示）已移除，重移植时不要带回。
  **不要**给 `history.js` 加按目录过滤：曾经加过一版（写入记 `cwd` + 读取按 `cwd` 过滤），
  已按用户要求撤回，`original/backup` 里也不再保留 `history.js`。
- **验证**：重启后 ↑/↓ 能翻到上次会话（任何目录）输过的命令；菜单在第 0 项按 ↑ 应进历史。
  命令行快检：`node -e "import('.../lib/types/history.js').then(m=>console.log(m.loadHistory().length))"`
  应等于 `history.jsonl` 的行数（不再过滤）。

> 说明：`history.jsonl` 里部分条目还留着一个已废弃的 `cwd` 字段（那版过滤器的遗留）。
> stock 的 `parseRaw` 只读 `text`/`ts`，多余字段被忽略、不影响显示；文件因此保持原样不动。

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
cat ~/.dsh-tui/patches/patch-base-version
```

### Step 1 — 检查缺失
```bash
dsh-patch check        # = bash ~/.dsh-tui/patches/apply-diff-patches.sh check
```

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

### Step 4 — 3-way 重移植（核心）
把**旧补丁相对旧原版的改动**合并进**新上游文件**：
- `base`   = 旧 `patches/original/<x>`（旧原版）
- `theirs` = 旧 `patches/backup/<x>`（旧已补丁）
- `ours`   = 新装的上游文件（新版原版）
```bash
mkdir -p /tmp/port/<x> && cd /tmp/port/<x>
cp "$TUI/<rel>" ours.js
git merge-file -p ours.js base.js theirs.js > merged.js
node --check merged.js        # 语法必须过
grep -nE '^(<<<<<<<|=======|>>>>>>>)' merged.js   # 有冲突则按 §2 意图人工解
```
- **无冲突** → `merged.js` 即新版补丁文件。
- **有冲突** → 打开看上下文，按 §2 每个功能的「行为」决定取舍（例如菜单边界是
  「落历史」而非环绕；beta 新增 props 保留并**追加**我们的回调等）。
- 只想去掉某项定制（如 vim），可只抽出该功能的 hunk 重打，而不是整文件合并。
- 解完再 `node --check`。

### Step 5 — 落库 + 应用
```bash
cp 新版上游文件(ours) original/<x>
cp merged.js              backup/<x>
diff -u original/<x> backup/<x> > diffs/<x>.patch || true
# 全部处理完后：
echo "<新版 dsh-tui 版本>" > patch-base-version
bash apply-diff-patches.sh apply     # 写入 + 语法门禁
bash apply-diff-patches.sh check     # 期望全 OK
```

### Step 6 — 确认用户级设置还在（§1.2）
`~/.dsh/settings.yaml` 有 `dsh-tui: { diffLayout: unified }`；`theme.json` 是
`claude-code`。缺失则补回。

### Step 7 — 重启验证
完全退出并重开 `dsh-tui`（进程会缓存已加载模块，必须重启才吃新 JS），然后按 §2 的
「验证」逐项过 F1–F3：
- **F1**：触发一次 Edit/Write，看 CC 统一式 diff（行号 + 绿红底；NEW 文件只出前 10 行）。
- **F2**：`/resume` 应列出**所有目录**的会话、扁平无 `▣ 目录` 分组行、无左侧目录栏；
  右键菜单 / `mod+p` pin / Tab 预览仍在。命令行侧：`node ~/.dsh-tui/patches/test-resume-flat.mjs`。
- **F3**：↑/↓ 能翻到以前任何目录输过的命令（历史全局共用）；菜单在第 0 项按 ↑ 进历史。

并顺手确认仍然去掉的四项是 stock（会话标题按宽度截断；vim 默认关且 `/vim` 后指示仍在
输入框内、状态栏不再出现 `-- INSERT --`）。

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
| （非升级）**恢复** resume 全量扁平会话 | 不是重移植：`SessionBrowser.js` / `view.js` / `i18n.js` 三个目标都是 0.10.1 stock，重移植用 §3 方法 | 补丁集 4 → 7 个目标文件。用**薄补丁**而非恢复 `0b9e7d0` 之前那个 45KB 整文件分叉（那版连右键菜单/pin 一起删了）：本版只去 rail 与目录分组，其余 stock 功能保留。曾短暂加过「↑/↓ 历史按目录过滤」（`history.js` + `history.d.ts` + 回填脚本），已按用户要求**撤回**，这两个目标与两个脚本均已从补丁集/仓库删除。`patch-base-version` 仍 0.10.1，无需升级触发重打 |

**已去掉的定制（勿在重移植时带回）**
| 旧编号 | 内容 | 现状 |
| --- | --- | --- |
| 旧 F2 | `SessionListRow.js` 会话标题显示全文（去 `truncateWidth`） | stock：标题按宽度截断；补丁文件已删除 |
| （已恢复）旧 F3 | resume 浏览器去掉 workspace rail / 当前目录过滤，永远平坦显示全部会话 | **不在本表**：用户要求恢复，即现在的 **F2**，但改用薄补丁实现（不删右键菜单 / pin）。`0b9e7d0` 那次删除的决定已被推翻，见上表最后一行 |
| 旧 F4 | vim 默认 ON、INSERT 起手（`PromptInput` + `Chat` 初始状态） | stock：vim 默认 OFF，`/vim` 开启 |
| 旧 F5 | `INSERT/NORMAL` 指示从输入框移到 `StatusLine` | stock：指示在输入框内；`Chat`/`StatusLine` 接线已移除 |
| 旧 F7 | `ToolFileDiff` 增加可选 `oldStart`/`newStart`（配合 F1 的 hunk 行号；0.10.1 迁移时曾短暂编号为 F4） | 不再打补丁；字段由 tool 包（JS）产出、渲染器（JS）动态读取，`.d.ts` 只影响 `tsc`，安装后的包不做类型检查，因此零运行时影响。需要类型时在自己工程里 `declare module` 增强 |

备份目录语义：`original/`=纯净上游；`backup/`=已补丁（apply 恢复源）；
`diffs/*.patch`=original→backup 差异（供查看）。git 历史（`~/.dsh-tui` 仓库）保留每代
快照，可取回任意旧 `original/backup` 作为 §3 的 base/theirs。
