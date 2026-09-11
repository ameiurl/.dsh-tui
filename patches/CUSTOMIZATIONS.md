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

> **编号说明**：0.10.0 → 0.10.1 迁移时列表重排为 F1–F3：
> F1 diff 渲染、**F2 ↑/↓ 跨会话历史（同样只看当前目录）**、
> **F3 resume 只看当前目录（扁平、无 rail）**。
> 迁移时曾去掉五项旧定制，其中**旧 F3 的部分行为已恢复进当前的 F3**
> （去掉 rail、列表扁平，但范围仍是当前工作目录）；
> 仍去掉的四项是：旧 F2 会话标题不截断、旧 F4 vim 默认开启/INSERT 起手、
> 旧 F5 vim 指示移到底部状态栏、旧 F7 `ToolFileDiff` 类型补充（后两项与运行时无关，
> 只影响 `tsc`）。找回办法见 §4 与 git 历史。
>
> **当前补丁集 = 8 个目标文件**（3 个 F1 + 3 个 F2 + 2 个 F3；`node resolve-patch-targets.mjs`
> 可列出），`patch-base-version` = `0.10.1`。
>
> **resume 浏览器不是 stock**（见 F3）：2026-09-11 曾按「恢复全量会话」做了一版**薄补丁**
> （`SessionBrowser.js` + `view.js` + `i18n.js`，默认 `allProjects`、去掉 rail 与目录分组），
> 用户明确「只列当前工作目录的」→ **那版整版撤回**。随后重做了一版**整文件分叉**
> （沿用 `23086fc` 的删 rail / 去分组 / 去钻取页，范围固定当前目录），即当前的 F3，
> 那才是最终决定。被否掉的是「列全部项目」，**不是**「无 rail 扁平列表」，别搞混。

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

### F2 — ↑/↓ 跨会话历史（**按当前工作目录过滤**）+ 建议菜单边界落历史
- **涉及文件（3 个）**：
  - `…/dsh-tui/lib/types/history.js` —— 写入时给条目打上提交目录（`cwd` 字段），
    读取时 `loadHistory(cwd)` 只返回该目录的条目。`loadHistory` 新增**可选**参数，
    不传即旧行为（返回全部）。`history.d.ts` **不补**，理由同旧 F7：
    安装后的包不做类型检查，声明只影响 `tsc`。
  - `…/dsh-tui/lib/types/components/PromptInput.js` —— ↑/↓ 播种改走
    `loadHistory(channel.cwd)`，提交时 `appendHistory(text, channel.cwd)` 打标。
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

### F3 — resume：只列**当前工作目录**的历史会话（扁平、无左侧目录栏）
- **涉及文件（2 个）**：
  - `…/dsh-tui/lib/types/screens/SessionBrowser.js`（**整文件分叉**：删掉 rail / 目录分组 /
    目录钻取页，列表保持扁平；保留搜索、MRU 排序、预览、重命名、删除、清空壳、子运行折叠）
  - `…/dsh-tui/lib/types/i18n.js`（**只改** `session-hint-list` / `-mid` / `-short`
    这三个 key，去掉 rail / 右键菜单 / 范围开关字样）。其余 key 一律保持 stock：
    `session-scope-all` 是 `allProjects` 三元里的**死分支**（`SessionBrowser.js` 把它
    钉成 `false` 且从不修改），补丁曾一度把它带成旧文案「全部项目」——2026-09-11 已改回
    stock 的「全部工作目录」。**别再带回来**：既不可达，又让补丁面变大、与本节描述不符。
- **行为**：`/resume` 打开即列出**当前工作目录**的历史会话，一列扁平：
  - 左侧**没有**目录栏、没有 `▣ <path>` 目录分组行、没有目录钻取页（`←` 不生效）；
  - 范围**固定在 `channel.cwd`**：`{ ...DEFAULT_FILTERS, allProjects: false }`；
    `mod+a` 已改为**空操作**（rail 没了，没有可见入口能切回"全部"，留个能切出去的键
    只会让人卡在全量列表里），提示文案里也不再出现 `{{mod}}a 全部项目`；
  - scope 行读作 `▣ 工作目录 <当前目录>`（不再是"全部项目"）。
  - **代价（与 stock 的差异，用户已接受）**：这个分叉没有 pin（`mod+p`）与右键菜单；
    也没有"看全部目录"的入口 —— 想看别的目录请在那个目录下启动 dsh-tui。
- **历史**：曾把默认设成 `allProjects: true`（列全部），用户最终确认**要按当前目录过滤**，
  于是改回 `false` 并把 `mod+a` 置空。**别再翻回去**。
- **重移植注意**：这是**整文件分叉**（约 510 行 vs stock 911 行），不是小补丁。升级时按 §3
  走 3-way：`base` = 旧 stock、`theirs` = 本目录 `backup/SessionBrowser.js`、
  `ours` = 新 stock。实测 0.10.0 → 0.10.1 上游两文件**字节未变**，因此合并 0 冲突、
  结果等于旧分叉原样；真遇到上游大改时优先保住「无 rail + 固定当前目录 + 扁平列表」三条。
- **验证**：
  1. `/resume` 只应看到**当前目录**的历史会话（别的目录的会话不出现），左侧无目录栏；
  2. `mod+a` 按下去不应把范围切成"全部"；
  3. 命令行无头渲染快检（不启动 TUI、不写文件）：
     ```bash
     node ~/.dsh-tui/patches/test-resume-flat.mjs
     ```
     它断言：当前目录的会话列出、其他目录的会话**不**列出、恰好一行会话、无分组头 /
     无 rail / 无钻取页、scope 不是"全部项目"、子运行仍折叠。

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
name=SessionBrowser.js      # ← 换成 §3 报 RE-PORT 的那个备份名
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
name=SessionBrowser.js                       # 逐个 RE-PORT 的文件重复
cp /tmp/port/$name/ours.js   original/$name  # 新版原版入库
cp /tmp/port/$name/merged.js backup/$name    # 新版已补丁入库
diff -u original/$name backup/$name > diffs/$name.patch || true   # diff 非 0 是正常的

# 全部处理完后：
bash apply-diff-patches.sh apply     # 写入 + 语法门禁
bash apply-diff-patches.sh check     # 期望全 OK
node resolve-patch-targets.mjs | wc -l   # 目标数应等于 original/ 里的文件数
echo "<新版 dsh-tui 版本>" > patch-base-version   # 上面两步都过了再写
```

> **为何最后才写 `patch-base-version`**：它是自动重打的信任锚。先写的话，中途失败会留下
> "版本已对齐、文件其实没落库"的状态，下次升级 `dsh-patch` 会拿旧 backup 覆盖新上游。

### Step 5.5 — 提交快照（`patches/` 是 git 仓库的一部分）
```bash
cd ~/.dsh-tui && git add patches && git commit -m "change: re-port patches onto dsh-tui <版本>"
```
升级前的快照留在 history 里，下次重移植的 `base`/`theirs` 随时可从旧提交取回
（`git show <旧提交>:patches/backup/<x>`）。


### Step 6 — 确认用户级设置还在（§1.2）
`~/.dsh/settings.yaml` 有 `dsh-tui: { diffLayout: unified }`；`theme.json` 是
`claude-code`。缺失则补回。

### Step 7 — 重启验证
完全退出并重开 `dsh-tui`（进程会缓存已加载模块，必须重启才吃新 JS），然后按 §2 的
「验证」逐项过 F1–F3：
- **F1**：触发一次 Edit/Write，看 CC 统一式 diff（行号 + 绿红底；NEW 文件只出前 10 行）。
- **F2**：↑/↓ 只翻到**当前目录**输过的命令（别的目录不出现；旧的**无**标记条目仍作兜底，
  所以刚改完看起来和以前一样）；菜单在第 0 项按 ↑ 进历史。命令行侧：
  `node ~/.dsh-tui/patches/test-history-cwd.mjs`。
- **F3**：`/resume` 应只列**当前目录**的会话（别的目录不出现）、左侧**无目录栏**、
  无 `▣ 目录` 分组行；`mod+a` 不再切换范围；命令行侧：
  `node ~/.dsh-tui/patches/test-resume-flat.mjs`。

并顺手确认仍是 stock 的部分：会话标题按宽度截断；vim 默认关且 `/vim` 后指示仍在输入框内、
状态栏不再出现 `-- INSERT --`。**resume 浏览器已不是 stock**（F3 分叉：无 rail、扁平列表，但范围仍是当前目录）。

### Step 8 — 文档一致性核对
本文档是下次重移植的依据，所以**文档里过时的一句 = 一条错误指令**（每次升级都可能悄悄
漂移：0.10.1 那次就留下过「resume 浏览器 = stock」这种与代码相反的结论）。一条命令把
§1 的版本、§2 每条「行为」断言的代码事实、§3 引用的脚本全部核对一遍：

```bash
bash ~/.dsh-tui/patches/check-doc-consistency.sh    # 全过则 exit 0
```

覆盖面：§1.1 版本表 / §1.2 用户级设置 / F1 的 `DIFF_BODY_MAX_LINES` 与
`NEW_FILE_DIFF_MAX_LINES` 与 `hoverTint` 已删 / F2 的 `loadHistory(cwd)` 与
`historySeedCwd` 与 Ctrl+R 走 `channel.cwd` / F3 的无 rail 与 `allProjects: false` 与
i18n 补丁只动 `session-hint-list*` / 仍应 stock 的 vim 与 `ToolFileDiff.d.ts` /
目标数 = `original/` = `diffs/` 且命名一致 / 两个行为测试通过。
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
| （非升级）**文档/代码一致性核对** | 审计出 3 处漂移：①§2 开头「resume 浏览器 = stock…补丁集回到 4 个目标」与 F3 章节直接相反；②`README` 标题写 `all-projects`；③i18n 补丁把**死分支** `session-scope-all` 带成旧文案「全部项目」（stock 是「全部工作目录」） | ①②**改文档**（那句是上一轮加 F3 时的漏改）；③**改代码**——i18n 补丁现在只动 `session-hint-list*` 三个 key，不回带无关 hunk。新增 `check-doc-consistency.sh`（31 项断言，见 §3 Step 8），把"文档描述的就是装着的代码"变成可重跑的检查——**每次升级后都该跑一遍**，因为漂移正是升级时留下的。`patch-base-version` 仍 0.10.1 |

**定制状态备忘（含已恢复 / 已去掉）**
| 旧编号 | 内容 | 现状 |
| --- | --- | --- |
| 旧 F2 | `SessionListRow.js` 会话标题显示全文（去 `truncateWidth`） | stock：标题按宽度截断；补丁文件已删除 |
| 旧 F3 | resume 浏览器去掉 workspace rail / 当前目录过滤，永远平坦显示全部会话 | **部分恢复为 F3**：去掉 rail 与目录分组、保持扁平列表，**但保留当前目录过滤**（2026-09-11 用户最终确认："只显示当前工作目录的历史会话"，且不要左侧目录栏）。别再退回 stock 的 rail，也别再把范围改成全部目录 |
| 旧 F4 | vim 默认 ON、INSERT 起手（`PromptInput` + `Chat` 初始状态） | stock：vim 默认 OFF，`/vim` 开启 |
| 旧 F5 | `INSERT/NORMAL` 指示从输入框移到 `StatusLine` | stock：指示在输入框内；`Chat`/`StatusLine` 接线已移除 |
| 旧 F7 | `ToolFileDiff` 增加可选 `oldStart`/`newStart`（配合 F1 的 hunk 行号；0.10.1 迁移时曾短暂编号为 F4） | 不再打补丁；字段由 tool 包（JS）产出、渲染器（JS）动态读取，`.d.ts` 只影响 `tsc`，安装后的包不做类型检查，因此零运行时影响。需要类型时在自己工程里 `declare module` 增强 |
| （无编号） | ↑/↓ 历史按 `cwd` 过滤（`history.js` + `history.d.ts` + 回填脚本） | **已恢复为 F2 的一部分**：0.10.1 迁移时曾整版撤回（当时代价是 ↑/↓ 立刻变空），2026-09-11 F3 定为「只看当前目录」后按用户要求恢复，并加了**旧条目兜底**解决空窗。`history.d.ts` 仍不打补丁（同旧 F7 的理由） |

备份目录语义：`original/`=纯净上游；`backup/`=已补丁（apply 恢复源）；
`diffs/*.patch`=original→backup 差异（供查看）。git 历史（`~/.dsh-tui` 仓库）保留每代
快照，可取回任意旧 `original/backup` 作为 §3 的 base/theirs。
