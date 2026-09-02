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
| `@deepseek-harness-tui/dsh-tui`（实际运行的 TUI） | `~/.dsh/profiles/dsh-tui/node_modules/…` | `0.10.0-beta.4` |
| profile 目录名 | `~/.dsh/profiles/dsh-tui` | （旧版本叫 `tui`） |
| delegating 壳（`dsh-tui` 命令） | 全局 `@deepseek-harness-tui/dsh-tui` | `0.10.0-beta.4` |
| launcher / 生态 `@deepseek-ai/dsh` | 全局 | `0.1.1-rc.2` |
| 补丁构建基线 | `patches/patch-base-version` | `0.10.0-beta.4` |

**版本关系（重要，别再踩坑）：**
- dsh-tui `0.10.0-beta` 线与生态 `0.1.1-rc.2` 配套；peer 范围二者相同，可互换 minor。
- **不要混装 0.9.x**：0.9.x 需要更老的生态（rc.1），在 rc.2 上会因 cordis 服务
  `tuiThemes` 缺失而 boot 失败。
- delegating 壳只拦「profile 的 major/minor 比壳更旧」；同 minor 的 patch 错位只提示不拦。
  所以 `beta.3`（同 `0.10`）能跑，`0.9.3`（minor 9 < 10）会被拦。

### 1.2 用户级设置（升级后确认仍在）
| 文件 | 内容 | 作用 |
| --- | --- | --- |
| `~/.dsh/settings.yaml` | `dsh-tui: { diffLayout: unified }` | 强制 unified diff 布局（否则 `auto` 宽屏退 split，CC 样式看不到） |
| `~/.dsh-tui/theme.json` | `{ "theme": "claude-code" }` | 激活 CC diff 配色 |
| `~/.dsh-tui/themes/claude-code.json` / `-light.json` | — | CC diff 调色板（升级不动） |

---

## 2. 定制功能清单（升级后逐项要「回来」的东西）

### F1 — Edit/Write 的 diff 用 Claude Code 统一风格渲染
- **涉及文件（4 个）**：
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
      Ctrl+O（verbose）展开全部。
    - hover 工具卡不变底色（只有选中高亮）。
- **验证**：触发一次 Edit/Write，看是否 CC 统一式（行号 + 绿红底）；NEW 文件只出
  前 10 行（`… +N lines` 收起）、Ctrl+O 能展开；编辑/删除 diff 永远不出现折叠行。

### F2 — 会话列表标题不截断
- **文件**：`…/dsh-tui/lib/types/components/sessions/SessionListRow.js`
- **行为**：标题显示完整文本（去掉 `truncateWidth` 截断），单行不换行。
- **验证**：看一个长标题会话是否完整显示。

### F3 — resume / 会话浏览显示全部历史会话（去掉目录过滤）
- **文件**：`…/dsh-tui/lib/types/screens/SessionBrowser.js` + `…/lib/types/i18n.js`
- **行为**：去掉 stock 的 workspace rail / 当前目录分组过滤，resume 永远显示**全部**
  历史会话（扁平列表）；文案按此对齐（`全部项目`/`all projects`）。
- **验证**：打开 resume，应看到所有目录的历史会话，而非只有当前目录。

### F4 — vim 模式：默认开启，且 NORMAL 起手
- **文件**：`…/dsh-tui/lib/types/components/PromptInput.js`
- **行为**：启动即 vim ON、submode=NORMAL（键盘按 vim 键位走）；`/vim` 仍可切换；
  使能时停在 NORMAL（`i/a/o` 进 INSERT）。
- **验证**：新开输入框，按字母应是 vim 键位而非上屏，底部见 `-- NORMAL --`。

### F5 — vim 指示从输入框移到底部状态栏
- **文件**：`PromptInput.js`（上报）+ `…/lib/types/screens/Chat.js`（持状态/接线）+
  `…/lib/types/screens/StatusLine.js`（渲染）
- **行为**：输入框内不再显示 `INSERT/NORMAL` 字样；改为在状态栏 cwd 后渲染
  `-- INSERT --` / `-- NORMAL --`（INSERT 绿、NORMAL 橙黄），每次切换实时更新。
- **验证**：vim 内按 `i` / `Esc`，底部指示实时变化。

### F6 — ↑/↓ 跨会话历史 + 建议菜单边界落历史
- **文件**：`PromptInput.js`
- **行为**：↑/↓ 读取**持久化历史文件**（跨会话、跨进程可翻）；在命令建议菜单顶部/底部
  再按 ↑/↓ **落到历史**（而非 stock 的环绕）。
- **验证**：重启后 ↑/↓ 能翻到上次会话输过的命令；菜单在第 0 项按 ↑ 应进历史。

### F7 — channel.d.ts 类型补充
- **文件**：`…/dsh-tui/lib/types/dsh-adapter/channel.d.ts`
- **行为**：`ToolFileDiff` 增加可选 `oldStart`/`newStart`（配合 F1 的 hunk 行号）。

> 所有组件补丁都做了**语法校验门禁**：`apply-diff-patches.sh` 在写入前 `node --check`，
> 失败即中止，避免用旧补丁覆盖结构已变的上游文件。

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

### Step 3 — 逐文件判断「要不要重移植」
对每个目标：若「新装上游文件 == `patches/original/<x>`」，说明上游没变，**跳过**；
变了则要**重移植**。
```bash
TUI=~/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui
for rel in \
  lib/types/components/messages/AssistantToolUseMessage.js \
  lib/types/dsh-adapter/channel.d.ts \
  lib/types/components/sessions/SessionListRow.js \
  lib/types/components/PromptInput.js \
  lib/types/screens/SessionBrowser.js \
  lib/types/screens/Chat.js \
  lib/types/screens/StatusLine.js \
  lib/types/i18n.js ; do
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
「验证」逐项过 F1–F7。

---

## 4. 参考：历次版本迁移记录（帮助判断重移植量）
| 迁移 | 现象 | 备注 |
| --- | --- | --- |
| `profiles/tui` → `profiles/dsh-tui` | 目录改名，补丁 MISSING | 改 apply 脚本 `TUI_PKG` |
| 0.9.3 → 0.10.0-beta 线 | 生态变 rc.2；新增 vim/浏览器等 | 0.9.x 无法在 rc.2 跑 |
| beta.3 → beta.4 | 6/10 文件上游微变 | `SessionListRow.js`、`SessionBrowser.js` 字节不变 → 免移植；其余用 §3 方法 |
| tool 包 0.1.0-rc.8 → 0.1.1-rc.2 | 字节不变 | 免移植 |

备份目录语义：`original/`=纯净上游；`backup/`=已补丁（apply 恢复源）；
`diffs/*.patch`=original→backup 差异（供查看）。git 历史（`~/.dsh-tui` 仓库）保留每代
快照，可取回任意旧 `original/backup` 作为 §4 的 base/theirs。
