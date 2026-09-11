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

> **编号说明**：0.10.0 → 0.10.1 迁移时列表重排为连续的 F1–F2，并**去掉**五项旧定制：
> 旧 F2 会话标题不截断、旧 F3 resume 全量会话、旧 F4 vim 默认开启/INSERT 起手、
> 旧 F5 vim 指示移到底部状态栏、旧 F7 `ToolFileDiff` 类型补充。对应文件都已恢复 stock
> （类型补充本就与运行时无关，只影响 `tsc`）。找回办法见 §4 与 git 历史。

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

### F2 — ↑/↓ 跨会话历史 + 建议菜单边界落历史
- **文件**：`…/dsh-tui/lib/types/components/PromptInput.js`
- **行为**：↑/↓ 读取**持久化历史文件**（跨会话、跨进程可翻）；在命令建议菜单顶部/底部
  再按 ↑/↓ **落到历史**（而非 stock 的环绕）。
- **重移植注意**：本文件只保留这两组改动（`loadHistory` 播种 + 菜单边界落历史）。
  vim 相关（默认开启、`onVimChange` 上报、输入框内指示）已移除，重移植时不要带回。
- **验证**：重启后 ↑/↓ 能翻到上次会话输过的命令；菜单在第 0 项按 ↑ 应进历史。

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
变了则要**重移植**。
```bash
TUI=~/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui
for rel in \
  lib/types/components/messages/AssistantToolUseMessage.js \
  lib/types/components/PromptInput.js ; do
  name=$(basename "$rel")
  cmp -s "$TUI/$rel" "original/$name" && echo "unchanged : $name" || echo "RE-PORT   : $name"
done
```
（tool 两包若字节变同样需重移植，判断同上。）

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
「验证」逐项过 F1–F2，并顺手确认已去掉的五项仍是 stock（会话标题会截断；resume 默认
只列当前目录的会话、rail/右键菜单/pin 都在、`mod+a` 才看全部；vim 默认关且 `/vim` 后
指示仍在输入框内、状态栏不再出现 `-- INSERT --`）。

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

**已去掉的定制（勿在重移植时带回）**
| 旧编号 | 内容 | 现状 |
| --- | --- | --- |
| 旧 F2 | `SessionListRow.js` 会话标题显示全文（去 `truncateWidth`） | stock：标题按宽度截断；补丁文件已删除 |
| 旧 F3 | resume 浏览器去掉 workspace rail / 当前目录过滤，永远平坦显示全部会话（`SessionBrowser.js` + `i18n.js` 文案；0.10.1 迁移中曾短暂编号为 F2） | stock：默认只列当前工作目录那组会话（`selectedWorkspaceId='current'` + `DEFAULT_FILTERS.allProjects=false`），rail / 右键菜单 / pin 都在；按 `mod+a` 或点 rail 的「全部工作目录」才看全部。该默认**没有** settings/env/CLI 开关，也不会记忆，每次打开都回到当前目录 |
| 旧 F4 | vim 默认 ON、INSERT 起手（`PromptInput` + `Chat` 初始状态） | stock：vim 默认 OFF，`/vim` 开启 |
| 旧 F5 | `INSERT/NORMAL` 指示从输入框移到 `StatusLine` | stock：指示在输入框内；`Chat`/`StatusLine` 接线已移除 |
| 旧 F7 | `ToolFileDiff` 增加可选 `oldStart`/`newStart`（配合 F1 的 hunk 行号；0.10.1 迁移时曾短暂编号为 F4） | 不再打补丁；字段由 tool 包（JS）产出、渲染器（JS）动态读取，`.d.ts` 只影响 `tsc`，安装后的包不做类型检查，因此零运行时影响。需要类型时在自己工程里 `declare module` 增强 |

备份目录语义：`original/`=纯净上游；`backup/`=已补丁（apply 恢复源）；
`diffs/*.patch`=original→backup 差异（供查看）。git 历史（`~/.dsh-tui` 仓库）保留每代
快照，可取回任意旧 `original/backup` 作为 §3 的 base/theirs。
