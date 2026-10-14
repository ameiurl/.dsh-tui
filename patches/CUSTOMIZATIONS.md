# dsh-tui 定制说明 + 升级后重打指南

本文件是**唯一权威**的定制清单与升级手册。升级后照 [第 3 节](#3-升级后重打流程) 走一遍即可。

- **补丁集 = 9 个目标文件**：F1（3）+ F2（4）+ F3（2），`node resolve-patch-targets.mjs` 可列出。
- 快速体检：`bash ~/.dsh-tui/patches/apply-diff-patches.sh check`（逐目标 `OK` / `DIFFERS` /
  `MISSING` / `NEEDS-REPORT` / `PATCHED-*`）。
- 已退役（别再往 `TARGETS` 里加）：**按目录的输入历史**（0.15.0 上游自带：
  `historyProjectKey`/`appendHistory(text, cwd)`/`loadHistory(cwd)`/`loadHistoryOldestFirst(cwd)`，
  磁盘字段 `project`）、**`recapOnOpen`**（0.11.2 上游自带）——上游契约由
  `test-history-cwd.mjs` / `test-recap-setting.mjs` 守着。

---

## 1. 基线

### 1.1 版本
| 组件 | 位置 | 版本 |
| --- | --- | --- |
| `@deepseek-harness-tui/dsh-tui`（实际运行的 TUI） | `~/.dsh/profiles/dsh-tui/node_modules/…` | `0.15.0` |
| delegating 壳（`dsh-tui` / `dst` 命令） | 全局 | `0.15.0` |
| launcher / 生态 `@deepseek-ai/dsh` | 全局 | `0.2.0-rc.2` |
| tool 包 `dsh-tool-fs` / `dsh-tool-str-replace-editor` | `~/.dsh/profiles/node_modules/@deepseek-ai/…`（软链向 launcher 树） | `0.2.0-rc.2` |
| 补丁基线 `patches/patch-base-version` | 文档/检查脚本引用 | `0.15.0` |
| 逐包基线 `patches/patch-base-versions.json` | apply 脚本据此**分目标**放行 | dsh-tui `0.15.0`／tool 两包 `0.2.0-rc.2` |

**版本关系（每次都要确认）：**
- 壳与 profile 应同版本；**profile 的 pin 才是权威**：`dsh` 每次启动按
  `~/.dsh/profiles/dsh-tui/package.json` reconcile `node_modules`。应用内 update 只换
  `node_modules` 不改 pin → 下次启动会被拉回 pin 的版本。
- 让版本持久必须改 pin：
  `env -u https_proxy -u http_proxy -u all_proxy pnpm add -C ~/.dsh/profiles/dsh-tui @deepseek-harness-tui/dsh-tui@<版本>`
- **tool 两包不在 profile 里**，由全局 launcher 树提供（`dsh` 升级会连带换版本并覆盖补丁），
  所以基线必须逐包记。
- 补丁基线必须等于 pin 指向的版本，否则 `dsh-patch` 只会报漂移。

### 1.2 用户级设置（升级后确认仍在）
| 文件 | 内容 | 作用 |
| --- | --- | --- |
| `~/.dsh/profiles/dsh-tui/cordis.patch.yml` | `- id: dsh-tui` + `config: { …, diffLayout: unified, … }` | 强制 unified diff 布局。该行**整块替换** entry 的 `config`，所以必须重述 bundle 的全部键（`provider`/`effort`/`preset`/`workspace`/`sessionId`/`fullscreen`/`terminalImages`/`lang`/`statusBar` 等）。`~/.dsh/settings.yaml` 自 0.1.7 起已不存在 |
| `~/.dsh-tui/theme.json` | `{ "theme": "claude-code" }` | 激活 CC diff 配色 |
| `~/.dsh-tui/themes/claude-code.json` / `-light.json` | — | CC diff 调色板（升级不动） |

> 主题键语义：`diffAddedDimmed`/`diffRemovedDimmed` 是**整行底色**，
> `diffAddedWord`/`diffRemovedWord` 是**词级底色**，`diffAdded`/`diffRemoved` 供分屏与预览用。
> （上游 PR #1269 `diffStyle: bars` 若合并，会改用强色当整行底色，届时主题键要重排。）

---

## 2. 定制清单（升级后要「回来」的东西）

### F1 — Edit/Write 的 diff 用 Claude Code 统一风格渲染
- **涉及文件（3 个）**：`@deepseek-ai/dsh-tool-fs/lib/index.js`、
  `@deepseek-ai/dsh-tool-str-replace-editor/lib/index.js`、
  `…/dsh-tui/lib/types/components/messages/AssistantToolUseMessage.js`
- **分工**：tool 两包把改动序列化成 **unified patch 文本**（`{path, patch}`，多个 hunk 合成一个
  diff；新建文件用 `@@ -0,0 +1,N @@`），**行号/统计/`⋯`/路径行交给上游**的
  `components/diffPatch.js`（`parseFilePatch`/`patchHeader`）；渲染器只补上游画不出来的部分。
- **行为**：
  - 真实行号 gutter（stock 解析 + 编号，宽度按最大行号右对齐）+ `(+N -M)` 统计行；
  - 绿/红**整行底色**（`diffAddedDimmed`/`diffRemovedDimmed`），行内文字用默认色；
  - **词级高亮**：删除段与新增段**等长**时逐行配对（`wordSegments`），**仅新增行**的变更词加
    `diffAddedWord` 底色；
  - **unified diff 正文永不折叠**（`cap = Infinity`；`DIFF_BODY_MAX_LINES = 8` 只留给分屏）；
  - **新建文件只预览前 10 行**：`NEW_FILE_DIFF_MAX_LINES = 11`（stat 行 + 前 10 行），
    其余 `… +N lines (ctrl+o to expand)`，Ctrl+O 展开；判据是"整段全是新增行"；
  - **hover 工具卡不变底色**（stock 的 `hoverTint` 分支已删，只有选中高亮）；
  - `str_replace` 的 diff 卡**整张是我们的**（stock 的 str-replace 工具没有 `presentationMeta`），
    返回 `{message,before,after}`，模型可见输出文本不变。
- **兼容旧形状**：`{oldText,newText,oldStart,newStart}`（老 host、历史记录）由
  `legacyDiffLines()` 自行对齐并编号，所以**换完渲染器后老卡片也有行号**；完全没有行号线索的
  payload 才退回 stock 的裸 `-`/`+`。
- **验证**：触发一次 Edit/Write 看行号 + 底色；NEW 文件只出前 10 行、Ctrl+O 能展开；
  命令行：`node ~/.dsh-tui/patches/test-f1-diff-rows.mjs`（31 条断言，含无头 ink 真渲染）。

### F2 — resume：只列本终端工作目录的历史会话（无 rail）
- **涉及文件（4 个）**：
  - `…/dsh-tui/lib/types/screens/sessionSupervisor/useSessionSupervisor.js`（主补丁）
  - `…/dsh-tui/lib/types/screens/SessionSupervisor.js`（删「＋ 新建会话」行；Ctrl+T 新建用钉死目录；
    Enter 只开光标行；Ctrl+P/N 移动；按绝对行号传 `striped`）
  - `…/dsh-tui/lib/types/components/sessions/SessionListRow.js`（删「当前」徽标；新增 `striped` 隔行底色）
  - `…/dsh-tui/lib/types/i18n.js`（两个 key：`supervisor-hint-list` 去掉 `←/→ 切换栏位`、
    改成 `Ctrl+P/N 移动 · Ctrl+T 新建`；删除 `supervisor-current`）
- **行为**（三条底线）：
  - **无 rail**：`railVisible = false`，两侧 rail JSX 不渲染，面板占满宽度；键盘一开始就归列表，
    `activateRail()` 置空（`←` 不抢键盘）。
  - **范围=本终端的工作目录**：`selected` 由 `channel.cwd` 合成（cwd 已注册则取 registry 的拼写），
    `visibleSessions` 对 `listedSessions` 用 `samePath(session.cwd, channel.cwd)` 过滤
    —— 比 stock 的"rail 分组 key 精确相等"更稳（尾斜杠/大小写不同仍算同目录）。
  - **列表只有会话行**：**没有**「＋ 新建会话」行（Ctrl+T 新建），光标空间因此只有会话
    （`sessionAt(index) = visibleSessions[index]`，`moveSession` 按真实长度钳制，`cardFocused` 删除）。
  - **Enter 落在第 0 行也开会话**：卡片没了，stock 的 `if (sessionIndex === 0) newSessionIn(selected)`
    分支却还在 —— 第一行通常正是最近用过的那个会话，于是"恢复"变成"新建"。整块删掉：
    Enter 只打开光标所在会话；列表为空（没有会话，或过滤后无匹配）时什么都不做，新建始终是 Ctrl+T。
  - **上下分得清**：`SessionListRow` 新增 `striped` prop，为 `true` 时整行（两行高、满面板宽）铺
    `toolCardBackground` 底色；`SessionSupervisor` 按**绝对行号** `(sessionTop + index) % 2 === 1`
    传入，所以条纹跟着会话走，滚动不会在静止的视线下重排。层次是 hover 蓝 > 隔行底色 > 面板底：
    hover 盖掉条纹，光标行始终是绿的（`❯` + 绿色粗体标题 + 非 dim 的元信息行）。想换强度只改
    这一个主题键（更淡 `toolCardBackgroundDim`，更明显 `messageActionsBackground`/`selectionBg`）。
  - **Ctrl+P 向上 / Ctrl+N 向下**（emacs 自己的 previous/next，方向与 vim 的 k/j 一致）：与方向键
    走同一个 `moveSession`，DSH 列表和外来后端列表都生效。判据集中在导出的 `listKeyStep(input, key)`：
    两者都是**普通控制字节**（0x10 / 0x0E），裸字节和 kitty/modifyOtherKeys 的拼写都解析成
    `p`/`n` + ctrl，所以没有 Ctrl+J 那种"LF 被 Ink 当成无修饰的 `enter`"的坑；`isMod` 保证
    普通输入的 p/n 仍旧只进过滤器。方向键仍是主键位。
  - **Ctrl+T 新建会话**：`Ctrl+N` 让给列表移动后，新建搬到这里（`newSessionIn(selected)` 不变），
    提示行也改成 `Ctrl+P/N 移动 · Ctrl+T 新建`。改回来/换键只需动 `isMod(key) && input === 't'`
    与 `listKeyStep` 两个返回值。
  - **不列「背后没有日志」的记录**：每次开终端都会在会话目录注册一条记录，而日志可能始终没落盘；
     它没有名字 → 标题回落到目录 basename，显示成 `☆ ∙ .dsh-tui` 这种“像目录”的行 —— **而且
     这条通常就是当前这个窗口自己的会话**，所以看起来像“当前目录”。判据是 `bytes === undefined`
     （适配器给的产物大小，日志不存在时为空）**且** `title.source === 'fallback'`（没有真名字）。
     挂载中不豁免：你已经在那个会话里，不需要一行来 resume 它。
     有日志的都在：刚开的会话（日志已写、还没有 prompt → `hasPrompt` 为 false，另由上游规则挡）、
     首句是文件地址的正常对话（有产物）、已命名的会话（`prompt`/`auto`/`renamed`）照常显示。
  - **打开即选中本目录最近使用的会话**：默认光标由 `recentSessionId` 给出，取自**面板自己那份
    列表**（`listedSessions` + `samePath`），不再查 rail 的分组表 —— 未登记目录在那里没有 key，
    旧写法会落空、光标退回排序后的第一行（于是常落在一个更旧的 live 会话上）。
  - **「当前」徽标整块删除**（不是"不传 prop"）：组件里 `current` prop、`currentText`、
    标题宽度预算里的那一项、JSX 分支，以及 i18n 的 `supervisor-current` 文案全部去掉 ——
    所以 `SessionListRow.js` 进了补丁集（标题截断等其余行为仍 stock）。
  - 搜索 `/`、实时状态与占用、重命名、删除、pin、Ctrl+X、Esc 都保留。
  - 代价（已接受）：**没有切换工作区的入口**；要看别的目录的会话，就在那个目录启动 dsh-tui。
- **重移植注意**：stock 的 rail 选择状态（`selectedPath`/`selectedUnregisteredId`/
  `selectionManual`）与「按 cwd 自动选 rail 行」的 effect 在新结构里没有位置，**整块删掉**；
  上游新增的 `mostRecentIn`/`recentSessionId`（默认聚焦最近会话）**保留**，它吃 `selected.path`。
- **验证**：`/resume` 只列本目录的会话、无 rail、无新建会话行与「当前」徽标、`←` 不改光标、
  Ctrl+T 落在本目录、隔行有底色而相邻两行分得开、Ctrl+P/N 上下移动光标、Enter 落在第一行也能打开；
  命令行：`node ~/.dsh-tui/patches/test-resume-flat.mjs`（36 条断言，真渲染该屏 + 单独渲染行组件
  验证 `current` prop 已被忽略且 `striped` 才铺底色 + 按 Enter 验证默认落在最近会话、首行可开、
  Ctrl+P/N 真的移动（裸字节与 kitty 拼写各一遍）、Ctrl+T 才是新建）。

### F3 — `/resume` 标题按 Claude Code 的取名链；文件地址与 dsh 兜底占位都不当标题
- **涉及文件（2 个）**：`…/dsh-tui/lib/types/dsh-adapter/sessions/digest.js`、
  `…/dsh-tui/lib/types/dsh-adapter/sessions/store.js`（只有 `SCHEMA_VERSION` 4 → 5）。
- **取名链**（对应 Claude 的 `customTitle || aiTitle || lastPrompt || firstPrompt`）：
  1. 最近一条**真名字** `session/title`（`provider`=auto／`user` 或旧式 rename=renamed）
     —— 人和模型写下的名字照用；
  2. 否则**最近一条非地址人类消息**（`lastPromptOf`，倒序扫、跳过地址），按
     `normalizeLastPrompt` 归一化：折行、trim、超 `LAST_PROMPT_TITLE_CHARS = 200` 截断加 `…`；
  3. 否则**第一条非地址人类消息**（同样归一化）；
  4. 最后才是工作目录 basename（`source: 'fallback'`）。
- **dsh 的兜底占位标题不算名字**：`dsh-session-title` 在没有 provider 标题时会把首条人类消息
  截断写成 `session/title`（`source.kind: 'fallback'`）。它**写在 provider 标题之前**，若当成
  名字就会压住真标题、让同首句的会话长得一样。所以 `titleOf()` 给它 `strong: false`，四处扫描
  （head 窗口、tail 窗口、深度反扫、增量后缀）一律只收 `strong`；`titleComplete` 也不再跟着
  占位走（尾部只有占位 → 留给深度扫描）。
- **"文件地址"判据**（只认整串就是地址，**绝不做子串匹配**）：`^[/\\]`、`^~[/\\]`、
  `^\.{1,2}[/\\]`、`^[A-Za-z]:[\\/]`、`^@\S+$`；以及"单 token、含分隔符、带字母（`\p{L}`，
  所以 `2024/09/11` 不算）、且带扩展名或至少两级"的相对路径。
  **不匹配**的仍是标题：`@src/views/Setting.vue 互转方向更改`、`工作/生活`、`2024/09/11`。
- **`hasPrompt` 与标题候选解耦（别改回去）**：地址型首句**仍然算"有对话"**。`digestSession`
  的 `prompt`/`hasHumanMessage` 收下**任何**人类输入，只有 `opening`（标题候选）跳过地址；
  `recoverFirstPrompt` 同样分开回报。合并两者会让"首句是路径、后面聊了一堆"的会话被当成
  **空会话**，而清理空会话是**破坏性**动作（`mod+x` 删除）。
- **缓存 epoch**：`store.js` 的 `SCHEMA_VERSION` 4 → 5，版本 4 索引整份丢弃（标题语义变了而
  日志一个字节没变，命中会无限复用旧占位标题）。**不需要手动删 `session-index.json`**。
- **验证**：`/resume` 里没有真名字的会话显示最近一条真实消息（不是首条、不是路径、不是占位）；
  只发过路径的会话显示目录名；命令行：`node ~/.dsh-tui/patches/test-resume-title-chain.mjs`
  （45 条断言，合成 zstd 会话日志）。

### 仍 stock（别再打补丁）
vim 默认关且指示在输入框内（`/vim` 开启）；
`ToolFileDiff.d.ts`（`oldStart`/`newStart` 由 JS 产出与读取，`.d.ts` 只影响 `tsc`——
需要类型时在自己工程里 `declare module` 增强）。

---

## 3. 升级后重打流程

> 触发条件：`dsh` 或 dsh-tui 升级、profile 重建/改名，或 `dsh-patch` 报
> `MISSING` / `DIFFERS` / `NEEDS-REPORT` / `dsh-tui installed ≠ patch built against`。
> 命令里的 `dsh-patch` 就是 `bash ~/.dsh-tui/patches/apply-diff-patches.sh`（想少打字可在
> `~/.zshrc` / `~/.bashrc` 里加这个别名）。

### Step 0 — 确认版本
```bash
dsh-tui version
node -p "require('$HOME/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/package.json').version"
grep dsh-tui ~/.dsh/profiles/dsh-tui/package.json      # pin：reconcile 会照它装
cat ~/.dsh-tui/patches/patch-base-version              # 补丁基线
cat ~/.dsh-tui/patches/patch-base-versions.json         # 逐包基线
node -p "require('$HOME/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-fs/package.json').version"
```
壳、profile、补丁基线三者对不上时**先对齐版本再谈补丁**。

### Step 0.5 — 升级 launcher / 壳 / profile
```bash
# 1) 全局 launcher —— 这里【不要】加 --legacy-peer-deps（会跳过 peer 自动安装，
#    缺 @deepseek-ai/cordis-plugin-group，dsh --version 直接 ERR_MODULE_NOT_FOUND）
env -u https_proxy -u http_proxy -u all_proxy \
  npm install -g @deepseek-ai/dsh@0.2.0-rc.2

# 2) 全局壳（瘦壳，逻辑永远来自 profile）
env -u https_proxy -u http_proxy -u all_proxy \
  npm install -g --legacy-peer-deps @deepseek-harness-tui/dsh-tui@0.15.0

# 3) profile 的 pin + node_modules（生态包会被一起带到同一版本）
env -u https_proxy -u http_proxy -u all_proxy \
  pnpm add -C ~/.dsh/profiles/dsh-tui @deepseek-harness-tui/dsh-tui@0.15.0
```
- 升级后**第一次**跑 `dsh` 会 reconcile profile 的 `node_modules`，把 tool 两包换回 stock
  （一次性）。先随便跑一次 `dsh --version` 让它 reconcile 完，**再**执行 Step 1。
- 本机 `https_proxy=127.0.0.1:7890` 已废：装包报 `ETARGET`/退回缓存时先怀疑代理，
  用 `env -u https_proxy -u http_proxy -u all_proxy` 绕开，别怀疑版本号。

### Step 1 — 检查缺失
```bash
bash ~/.dsh-tui/patches/apply-diff-patches.sh check
```
输出逐目标结论：`OK`（已是补丁态）；`DIFFERS`（可恢复：整文件或 diff 直打）；
`NEEDS-REPORT`（diff 也打不上/语法不过 → **必须重移植**）。
脚本会拿 `diffs/<name>.patch` + `--fuzz=3` 直接往**已装文件**上打，全部 hunk 落地且
`node --check` 通过才写入，并区分两种落地方式：
- **偏移**（上下文精确匹配，只是行号挪了）= `PATCHED`/`PATCHED-DRIFT`；
- **fuzz**（上下文模糊匹配，hunk 可能贴错地方）= `PATCHED-FUZZ` → 置 drift，**必须按 Step 4 重移植**。
`apply` 是显式强推（拿 `backup/` 整文件覆盖），只在确认上游没变时用。

### Step 2 — 路径是否变了
profile 目录历史上 `tui` → `dsh-tui`（变了就改脚本里的 `TUI_PKG`）；tool 两包固定在
`profiles/node_modules/@deepseek-ai/…`；TUI 内部文件也会搬家——以某个 `TARGETS` 条目报
`MISSING` 为准，去新树里找同名/同接口文件。

### Step 3 — 逐文件判断「要不要重移植」
```bash
cd ~/.dsh-tui/patches
while IFS='|' read -r target name; do
  cmp -s "$target" "original/$name" && echo "unchanged : $name" || echo "RE-PORT   : $name"
done < <(node resolve-patch-targets.mjs)
```

### Step 4 — 重移植（核心）
先试快路 `dsh-patch patch`（diff + fuzz 3 自动落地，见 Step 1）。剩下的用三方合并：

```bash
cd ~/.dsh-tui/patches
P=~/.dsh-tui/patches; T=/tmp/port
name=digest.js                                  # ← 换成 Step 3 报 RE-PORT 的备份名
target=$(node resolve-patch-targets.mjs | awk -F'|' -v n="$name" '$2==n{print $1}')
rm -rf "$T/$name" && mkdir -p "$T/$name" && cd "$T/$name"
cp "$P/original/$name" base.js      # 旧原版
cp "$P/backup/$name"   theirs.js    # 旧已补丁
cp "$target"           ours.js      # 新装的上游原版
git merge-file -p ours.js base.js theirs.js > merged.js
node --check merged.js                          # 语法必须过（.d.ts 跳过）
grep -nE '^(<<<<<<<|=======|>>>>>>>)' merged.js # 有冲突就按 §2 的「行为」人工解
```
- **无冲突** → `merged.js` 就是新版补丁文件。
- **自检**：`cmp -s ours.js base.js` 相等说明上游对这份文件字节没变，`merged.js` 应与
  `backup/<name>` 完全一致。
- **有冲突** → 按 §2 对应功能的「行为/底线」取舍：上游新代码尽量保留，与定制意图冲突的
  整块删（例：F2 删 rail 选择状态与自动选中 effect，F1 的旧自绘编号整块换成 patch 文本）。
- 只想去掉某项定制，就只抽该功能的 hunk 重打。

### Step 5 — 落库 + 应用
```bash
cd ~/.dsh-tui/patches
name=digest.js                                  # 逐个 RE-PORT 的文件重复
cp /tmp/port/$name/ours.js   original/$name     # 新版原版入库
cp /tmp/port/$name/merged.js backup/$name       # 新版已补丁入库
diff -u original/$name backup/$name > diffs/$name.patch || true

bash apply-diff-patches.sh apply                # 写入 + 语法门禁
rm -f state/*.sha1                              # 重移植后旧指纹作废
bash apply-diff-patches.sh check                # 期望全 OK（exit 0）
node resolve-patch-targets.mjs | wc -l          # = original/ 里的文件数
echo "0.15.0" > patch-base-version              # 上面都过了再写
node -e "const f='patch-base-versions.json',j=require('./'+f);j['@deepseek-harness-tui/dsh-tui']='0.15.0';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
# tool 两包换版本时同理改 j['@deepseek-ai/dsh-tool-fs'] / j['@deepseek-ai/dsh-tool-str-replace-editor']
```

> **两个必须记住的机制**：
> ① 写文件用 `cp --remove-destination`：pnpm 的 `node_modules` 是到内容寻址 store 的**硬链接**，
> 普通 `cp` 会**写穿 store**（重装同版本又把补丁带回来，升级还原反而看不出来）。
> ② `patch-base-version` **最后才写**：它是自动重打的信任锚，先写会在中途失败时留下
> "版本已对齐、文件其实没落库"的状态。`state/*.sha1` 是"这套 diff 已打在这些字节上"的指纹，
> 手工改过目标文件又想让它重走一遍 diff 时 `rm -f state/*.sha1`。

### Step 5.5 — 提交快照（`patches/` 是 git 仓库的一部分）
```bash
cd ~/.dsh-tui && git add patches && git commit -m "change: re-port patches onto dsh-tui <版本>"
```
旧快照留在 history 里，下次重移植的 `base`/`theirs` 随时可取回
（`git show <旧提交>:patches/backup/<x>`）。

### Step 6 — 用户级设置还在吗（§1.2）
`cordis.patch.yml` 里有 `diffLayout: unified` 且重述了 bundle 全部键；`theme.json` 是
`claude-code`。缺失则补回。

### Step 7 — 生效与验证
dsh-tui 是**两个进程**，补丁住在哪个进程决定了怎么重启：

| 补丁 | 进程 | 生效方式 |
| --- | --- | --- |
| 渲染器（F1 的 `AssistantToolUseMessage.js`）、i18n、F2/F3 的 TUI 文件 | TUI 客户端（`bin/dsh-tui.js`） | **重开 TUI** |
| tool 两包（F1 的 diff 形状） | 每会话一个的 host（`lib/types/dsh-adapter/host-entry.js`） | **新开会话**（host 跨 TUI 重启存活） |

判断当前会话用的是哪份代码：`ps -eo pid,lstart,cmd | grep host-entry`，host 启动时间要晚于
补丁落盘时间。另有两条**不是 bug**：补丁前产生的卡片永远保持旧形状（`tool/result` 里存的
`meta` 原样回放）；`edit` 的**调用期预览**（结果回来前的一瞬间）是 `-old/+new` 无行号——
那是片段，结果落地立刻换成带行号的卡。

逐项验证：
- **F1**：Edit/Write 有行号 + 绿红整行底色 + `(+N -M)`；NEW 文件只出前 10 行、Ctrl+O 展开；
  hover 不变底色。`node ~/.dsh-tui/patches/test-f1-diff-rows.mjs`
- **F2**：`/resume` 只列本目录、无 rail、无新建会话行与「当前」徽标、`←` 不改光标、Ctrl+T 落在本目录、
  相邻行底色隔开（上下分得清）、Ctrl+P/N 上下移动、Enter 在第一行也开会话。
  `node ~/.dsh-tui/patches/test-resume-flat.mjs`
- **F3**：`/resume` 行标题=最近一条真实消息／目录名，绝不是路径或占位。
  `node ~/.dsh-tui/patches/test-resume-title-chain.mjs`
- 仍是 stock：会话标题按宽度截断；vim 默认关、指示在输入框内。

### Step 8 — 文档一致性核对
本文档是下次重移植的依据，**文档里过时的一句 = 一条错误指令**：
```bash
bash ~/.dsh-tui/patches/check-doc-consistency.sh    # 全过则 exit 0
```
覆盖面：§1.1 版本表（壳/生态/tool 两包各按基线，含 `patch-base-versions.json` 可解析且与
`patch-base-version` 一致）/ §1.2 用户级设置 / F1 的渲染器锚点（不折叠、整行底色、词级
segments、编号来自解析、旧形状兼容、新文件判定、`hoverTint` 已删、测试缝）与 tool 侧
（`hunksPatch`、`newFileDiff`、校验器收 `patch`、`oldStart` 字段已删、`presentResult`）与
行为测试 / 已退役的历史（`historyProjectKey`、`appendHistory(cwd)`、
`loadHistoryOldestFirst(cwd)`、并集语义、三个文件不在补丁集里）/ F2 的 `railVisible = false`、
无新建会话行、徽标整块已删（prop/JSX/i18n）、默认选中最近会话、无日志记录不列、
`samePath(session.cwd, channel.cwd)` 过滤、rail 选择状态已删、Ctrl+T 用钉死目录、i18n 只动
`supervisor-hint-list`、`SessionListRow.js` 已无 `current`、`supervisor-current` 文案已删、
`listKeyStep` 就是 Ctrl+P/N（Ctrl+J/K 已退役）、`striped` 隔行底色按绝对行号传入、
Enter 的 `sessionIndex === 0` 新建分支已删 /
F3 的 `isFileAddress`、`lastPromptOf`、`normalizeLastPrompt`、
`LAST_PROMPT_TITLE_CHARS = 200`、两层 prompt 都跳过地址、`hasPrompt` 取自非过滤候选、
占位标题判 `strong: false`（四处扫描）、`titleComplete` 不跟占位走、`store.js` 的
`SCHEMA_VERSION = 5` 且版本 4 不可读 / 仍应 stock 的 vim、`ToolFileDiff.d.ts` 与 F5 的
`recapOnOpen`（`test-recap-setting.mjs` 的 stock 契约）/ apply 脚本的断链拷贝、diff 直打路径
（`patch -p0 --fuzz=3`、`PATCHED-DRIFT`、`OK-PATCHED` 指纹、写不进就 `ABORT`）、hunk 报告取自
stdout 且「偏移 ≠ fuzz」（`patch.out`、`patch_was_fuzzy`、`PATCHED-FUZZ`、`--read-only=ignore`）、
分目标守卫与逐包基线 / 目标数 = `original/` = `diffs/` 且命名一致 / 每个 `diffs/*.patch` 都能在
它自己的 `original/` 上 `--fuzz=0` 干净贴上且结果 == `backup/` / 五个测试通过。
失败项会打印 `FAIL` 指出是哪条断言——对着它改代码或改文档，别放着。
