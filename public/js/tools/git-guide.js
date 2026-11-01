// Git 使用指南工具：按场景分类的命令速查 + 关键字搜索 + 一键复制
// 纯数据与本机 DOM，无外部请求、无 CDN；查询逻辑为可单测的纯函数。

// ---------- 分类 ----------
export const GIT_CATEGORIES = [
  { id: 'basic', label: '基础操作', icon: '🌱' },
  { id: 'commit', label: '提交修改', icon: '📝' },
  { id: 'branch', label: '分支合并', icon: '🌿' },
  { id: 'remote', label: '远程协作', icon: '🌐' },
  { id: 'undo', label: '撤销回滚', icon: '↩️' },
  { id: 'history', label: '查看历史', icon: '🔍' },
  { id: 'stash', label: '储藏清理', icon: '📦' },
  { id: 'tag', label: '标签发布', icon: '🏷️' },
  { id: 'advanced', label: '配置进阶', icon: '⚙️' },
];

export const ALL_CATEGORY = 'all';

// ---------- 命令数据 ----------
// 字段：id（唯一）、category、title（场景化中文标题）、command、example（可选）、note（可选）、tags（检索词）
export const GIT_COMMANDS = [
  // 基础操作
  {
    id: 'init',
    category: 'basic',
    title: '把当前文件夹变成 Git 仓库',
    command: 'git init',
    note: '会创建 .git 目录；已存在时不会覆盖历史',
    tags: ['初始化', '新建仓库', '新项目'],
  },
  {
    id: 'clone',
    category: 'basic',
    title: '克隆远程仓库到本地',
    command: 'git clone <仓库地址> [目标目录]',
    example: 'git clone https://github.com/user/repo.git my-app',
    tags: ['下载', '拉取项目', '检出'],
  },
  {
    id: 'status',
    category: 'basic',
    title: '查看当前工作区状态（最常用）',
    command: 'git status',
    example: 'git status -sb   # 短格式 + 分支名',
    note: '不确定该做什么时，先跑它',
    tags: ['状态', '改了什么', '未提交'],
  },
  {
    id: 'add-all',
    category: 'basic',
    title: '把所有改动加入暂存区',
    command: 'git add -A',
    example: 'git add src/  # 只暂存某个目录',
    note: '等价于 git add --all；会包含删除操作',
    tags: ['暂存', '全部添加', 'staging'],
  },
  {
    id: 'add-patch',
    category: 'basic',
    title: '按代码块选择性暂存',
    command: 'git add -p',
    note: 'y 暂存 / n 跳过 / s 拆分 / q 退出，适合只提交部分改动',
    tags: ['部分提交', '挑选', 'patch', '分块'],
  },
  {
    id: 'diff',
    category: 'basic',
    title: '查看未暂存的改动',
    command: 'git diff',
    example: 'git diff --staged   # 看已暂存将提交的内容',
    tags: ['差异', '对比', '改了什么'],
  },

  // 提交修改
  {
    id: 'commit',
    category: 'commit',
    title: '提交暂存区内容',
    command: 'git commit -m "说明"',
    example: 'git commit -m "fix: 修复登录跳转异常"',
    tags: ['提交', 'commit', '保存'],
  },
  {
    id: 'commit-all',
    category: 'commit',
    title: '跳过暂存直接提交已跟踪文件',
    command: 'git commit -am "说明"',
    note: '只包含已跟踪文件，新增文件仍需 git add',
    tags: ['跳过暂存', '快速提交'],
  },
  {
    id: 'amend',
    category: 'commit',
    title: '修改上一条提交（补文件 / 改说明）',
    command: 'git commit --amend --no-edit',
    example: 'git add 漏掉的文件 && git commit --amend --no-edit',
    note: '已推送到共享分支时慎用，会改写历史',
    tags: ['改提交信息', '补提交', 'amend'],
  },
  {
    id: 'commit-empty',
    category: 'commit',
    title: '空提交（触发 CI / 记录节点）',
    command: 'git commit --allow-empty -m "chore: 触发构建"',
    tags: ['空提交', 'ci'],
  },

  // 分支合并
  {
    id: 'branch-list',
    category: 'branch',
    title: '列出本地分支（当前分支带 *）',
    command: 'git branch -vv',
    example: 'git branch -a   # 含远程分支',
    tags: ['查看分支', '列表'],
  },
  {
    id: 'switch-c',
    category: 'branch',
    title: '新建并切换分支',
    command: 'git switch -c <分支名>',
    example: 'git switch -c feature/login',
    note: '等价旧写法 git checkout -b',
    tags: ['新建分支', '切换', 'checkout'],
  },
  {
    id: 'switch',
    category: 'branch',
    title: '切换到已有分支',
    command: 'git switch <分支名>',
    example: 'git switch main',
    tags: ['切换分支', 'checkout'],
  },
  {
    id: 'branch-delete',
    category: 'branch',
    title: '删除已合并的分支',
    command: 'git branch -d <分支名>',
    note: '未合并需强制删除：git branch -D <分支名>',
    tags: ['删除分支', '清理'],
  },
  {
    id: 'merge',
    category: 'branch',
    title: '把某分支合并进当前分支',
    command: 'git merge <分支名>',
    example: 'git switch main && git merge feature/login',
    note: '保留分叉历史；想线性历史用 rebase',
    tags: ['合并', 'merge', '集成'],
  },
  {
    id: 'rebase',
    category: 'branch',
    title: '变基：把当前分支接到目标分支最新提交之后',
    command: 'git rebase <目标分支>',
    example: 'git switch feature/login && git rebase main',
    note: '历史更整洁，但会改写提交；共享分支避免使用',
    tags: ['变基', 'rebase', '同步主干'],
  },
  {
    id: 'rebase-i',
    category: 'branch',
    title: '交互式整理最近 N 条提交',
    command: 'git rebase -i HEAD~<N>',
    example: 'git rebase -i HEAD~3',
    note: 'pick 保留 / reword 改说明 / squash 合并 / drop 删除',
    tags: ['整理提交', '压缩提交', 'squash', '改写历史'],
  },
  {
    id: 'cherry-pick',
    category: 'branch',
    title: '把指定提交摘到当前分支',
    command: 'git cherry-pick <提交哈希>',
    example: 'git cherry-pick a1b2c3d',
    tags: ['摘取提交', '移植', 'hotfix'],
  },
  {
    id: 'conflict',
    category: 'branch',
    title: '解决冲突后继续合并 / 变基',
    command: 'git add <冲突文件> && git rebase --continue',
    example: 'git merge --abort   # 放弃本次合并，回到操作前',
    note: '冲突标记 <<<<<<< ======= >>>>>>> 需手工编辑',
    tags: ['冲突', 'conflict', '合并失败', '继续'],
  },

  // 远程协作
  {
    id: 'remote-v',
    category: 'remote',
    title: '查看已配置的远程地址',
    command: 'git remote -v',
    tags: ['远程', '地址', 'origin'],
  },
  {
    id: 'remote-add',
    category: 'remote',
    title: '添加远程仓库',
    command: 'git remote add origin <仓库地址>',
    tags: ['添加远程', 'origin'],
  },
  {
    id: 'fetch',
    category: 'remote',
    title: '拉取远程更新（不改工作区）',
    command: 'git fetch --all --prune',
    note: '只更新远程跟踪分支，安全；之后再决定 merge 或 rebase',
    tags: ['获取', '更新', 'fetch'],
  },
  {
    id: 'pull',
    category: 'remote',
    title: '拉取并合并远程更新',
    command: 'git pull',
    example: 'git pull --rebase   # 用变基代替合并，历史更干净',
    tags: ['拉取', 'pull', '同步'],
  },
  {
    id: 'push',
    category: 'remote',
    title: '推送当前分支到远程',
    command: 'git push',
    example: 'git push -u origin feature/login   # 首次推送并建立跟踪',
    tags: ['推送', 'push', '上传'],
  },
  {
    id: 'push-lease',
    category: 'remote',
    title: '安全强推（覆盖远程但防止他人提交被吞）',
    command: 'git push --force-with-lease',
    note: '改写历史（rebase/amend）后使用；比 --force 安全',
    tags: ['强推', 'force', '改写历史'],
    danger: true,
  },

  // 撤销回滚
  {
    id: 'restore-file',
    category: 'undo',
    title: '丢弃某个文件的未提交改动',
    command: 'git restore <文件路径>',
    example: 'git restore src/app.js',
    note: '改动不可恢复；旧写法 git checkout -- <文件>',
    tags: ['丢弃改动', '还原', '还原文件'],
    danger: true,
  },
  {
    id: 'restore-staged',
    category: 'undo',
    title: '把文件移出暂存区（保留改动）',
    command: 'git restore --staged <文件路径>',
    note: '等价旧写法 git reset HEAD <文件>',
    tags: ['取消暂存', 'unstage'],
  },
  {
    id: 'reset-soft',
    category: 'undo',
    title: '撤销提交但保留改动在暂存区',
    command: 'git reset --soft HEAD~1',
    note: '常用于"提交早了/说明写错"，之后可直接重新 commit',
    tags: ['撤销提交', '撤回commit', 'reset'],
  },
  {
    id: 'reset-hard',
    category: 'undo',
    title: '彻底回退到某次提交（丢弃改动）',
    command: 'git reset --hard <提交哈希>',
    example: 'git reset --hard HEAD~1',
    note: '未提交改动与提交一起丢失；确认后再执行',
    tags: ['强制回退', '丢弃', 'reset'],
    danger: true,
  },
  {
    id: 'revert',
    category: 'undo',
    title: '用一个新提交抵消某次提交（安全）',
    command: 'git revert <提交哈希>',
    note: '已推送共享分支时，用它代替 reset',
    tags: ['反向提交', '撤销已推送', 'revert'],
  },
  {
    id: 'reflog',
    category: 'undo',
    title: '查看所有 HEAD 移动记录（找回误删提交）',
    command: 'git reflog',
    example: 'git reset --hard HEAD@{3}   # 回到 reflog 里的某个状态',
    note: 'reset/变基丢掉的提交通常能在这里找回',
    tags: ['找回', '误删', '恢复提交', 'reflog'],
  },
  {
    id: 'clean',
    category: 'undo',
    title: '删除未跟踪的文件 / 目录',
    command: 'git clean -nd   # 先预览要删什么',
    example: 'git clean -fd   # 真正删除（不可恢复）',
    note: '先加 -n 预览，确认后再去掉 -n',
    tags: ['清理', '未跟踪', '删除文件'],
    danger: true,
  },

  // 查看历史
  {
    id: 'log-graph',
    category: 'history',
    title: '图形化查看提交历史',
    command: 'git log --oneline --graph --decorate --all',
    tags: ['历史', '日志', 'log', '图形'],
  },
  {
    id: 'log-file',
    category: 'history',
    title: '查看某个文件的修改历史',
    command: 'git log -p --follow <文件路径>',
    tags: ['文件历史', '改动记录', 'log'],
  },
  {
    id: 'show',
    category: 'history',
    title: '查看某次提交的具体改动',
    command: 'git show <提交哈希>',
    example: 'git show --stat HEAD   # 只看改了哪些文件',
    tags: ['查看提交', 'show', '改动'],
  },
  {
    id: 'blame',
    category: 'history',
    title: '逐行查看谁改的、哪次提交改的',
    command: 'git blame <文件路径>',
    example: 'git blame -L 10,30 src/app.js   # 只看第 10-30 行',
    tags: ['溯源', 'blame', '谁改的'],
  },
  {
    id: 'log-search',
    category: 'history',
    title: '搜索引入 / 删除某段代码的提交',
    command: 'git log -S"关键字" --oneline',
    tags: ['搜索代码', '查找提交', 'pickaxe'],
  },
  {
    id: 'diff-branch',
    category: 'history',
    title: '对比两个分支的差异',
    command: 'git diff main..feature/login --stat',
    note: '去掉 --stat 看具体代码差异',
    tags: ['分支对比', '差异', 'diff'],
  },

  // 储藏清理
  {
    id: 'stash-push',
    category: 'stash',
    title: '临时存放当前改动（切分支前常用）',
    command: 'git stash push -m "说明"',
    example: 'git stash push -u -m "半成品"   # -u 连未跟踪文件一起存',
    tags: ['暂存改动', 'stash', '临时保存'],
  },
  {
    id: 'stash-list',
    category: 'stash',
    title: '查看储藏列表',
    command: 'git stash list',
    tags: ['stash', '列表'],
  },
  {
    id: 'stash-pop',
    category: 'stash',
    title: '恢复最近一次储藏并删除记录',
    command: 'git stash pop',
    example: 'git stash apply stash@{2}   # 恢复指定储藏但保留记录',
    tags: ['恢复储藏', 'stash', 'pop'],
  },
  {
    id: 'stash-drop',
    category: 'stash',
    title: '删除储藏记录',
    command: 'git stash drop stash@{0}',
    example: 'git stash clear   # 清空全部储藏（不可恢复）',
    note: '删除后无法恢复；先 git stash list 确认目标，误删只能靠 git fsck --lost-found 碰运气',
    tags: ['删除储藏', '清理'],
    danger: true,
  },

  // 标签发布
  {
    id: 'tag-list',
    category: 'tag',
    title: '列出标签',
    command: 'git tag -l "v1.*"',
    tags: ['标签', 'tag', '版本'],
  },
  {
    id: 'tag-create',
    category: 'tag',
    title: '创建附注标签（推荐发版用）',
    command: 'git tag -a v1.2.0 -m "v1.2.0 发布说明"',
    tags: ['打标签', '版本号', 'release'],
  },
  {
    id: 'tag-push',
    category: 'tag',
    title: '推送标签到远程',
    command: 'git push origin --tags',
    note: 'git push 默认不推标签，需显式推送',
    tags: ['推送标签', '发布'],
  },
  {
    id: 'tag-delete',
    category: 'tag',
    title: '删除本地与远程标签',
    command: 'git tag -d v1.2.0 && git push origin :refs/tags/v1.2.0',
    tags: ['删除标签'],
  },

  // 配置进阶
  {
    id: 'config-user',
    category: 'advanced',
    title: '配置提交身份（首次使用必做）',
    command: 'git config --global user.name "你的名字" && git config --global user.email "you@example.com"',
    tags: ['配置', '用户名', '邮箱', '首次'],
  },
  {
    id: 'config-alias',
    category: 'advanced',
    title: '配置命令别名，少打字',
    command: 'git config --global alias.st "status -sb"',
    example: 'git config --global alias.lg "log --oneline --graph --all"',
    tags: ['别名', 'alias', '快捷'],
  },
  {
    id: 'worktree',
    category: 'advanced',
    title: '同一仓库并行开多个工作目录',
    command: 'git worktree add ../hotfix hotfix',
    note: '修紧急 bug 不必 stash 当前改动',
    tags: ['多目录', '并行', 'worktree'],
  },
  {
    id: 'bisect',
    category: 'advanced',
    title: '二分定位引入 bug 的提交',
    command: 'git bisect start && git bisect bad && git bisect good <正常提交>',
    note: '按提示标记 good/bad，最后 git bisect reset 收尾',
    tags: ['二分', '定位bug', 'bisect'],
  },
  {
    id: 'ignore-check',
    category: 'advanced',
    title: '检查文件为何被忽略',
    command: 'git check-ignore -v <文件路径>',
    tags: ['gitignore', '忽略', '排查'],
  },
  {
    id: 'fsck-gc',
    category: 'advanced',
    title: '仓库体检与垃圾回收',
    command: 'git gc --prune=now',
    example: 'git fsck --lost-found   # 找回丢失对象',
    note: '仓库体积异常大时再考虑',
    tags: ['优化', '体积', 'gc'],
  },
];

// ---------- 查询逻辑（纯函数，Node 可测） ----------

/** 分类 id → 中文名 */
export function categoryLabel(id) {
  return GIT_CATEGORIES.find((c) => c.id === id)?.label || id;
}

/** 复制到剪贴板用的命令文本：去掉可能存在的 `$ ` 前缀与首尾空白 */
export function formatCommandText(command) {
  return String(command || '')
    .replace(/^\s*\$\s+/, '')
    .trim();
}

function haystackOf(item) {
  return [
    item.title,
    item.command,
    item.example || '',
    item.note || '',
    (item.tags || []).join(' '),
    categoryLabel(item.category),
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * 搜索命令：空白分词，多个词需同时命中（AND）；匹配标题/命令/示例/提示/标签/分类
 * @param {string} query
 * @param {string} categoryId  'all' 表示全部分类
 * @param {Array} list  默认 GIT_COMMANDS（便于测试注入）
 * @returns {Array}
 */
export function searchCommands(query, categoryId = ALL_CATEGORY, list = GIT_COMMANDS) {
  const tokens = String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const byCategory =
    categoryId && categoryId !== ALL_CATEGORY ? list.filter((item) => item.category === categoryId) : list.slice();
  if (tokens.length === 0) return byCategory;
  return byCategory.filter((item) => {
    const hay = haystackOf(item);
    return tokens.every((t) => hay.includes(t));
  });
}

/** 各分类命令数量统计（用于标签页角标） */
export function countByCategory(list = GIT_COMMANDS) {
  const counts = { [ALL_CATEGORY]: list.length };
  for (const c of GIT_CATEGORIES) counts[c.id] = 0;
  for (const item of list) {
    if (counts[item.category] === undefined) continue;
    counts[item.category] += 1;
  }
  return counts;
}

// ---------- 工具入口 ----------
export function createGitGuideTool() {
  return {
    id: 'git-guide',
    name: 'Git 指南',
    icon: '🌿',
    render(container) {
      renderGitGuide(container);
    },
  };
}

function renderGitGuide(container) {
  container.innerHTML = '';

  // 标题
  const heading = document.createElement('h2');
  heading.style.cssText = 'font-size:16px;margin-bottom:4px;';
  heading.textContent = 'Git 使用指南';
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:12px;color:var(--text-soft);margin-bottom:12px;';
  hint.textContent = '按场景查命令：支持搜索（如「撤销 提交」「rebase」），点「复制」直接粘贴到终端。';
  container.append(heading, hint);

  // 搜索框
  const searchWrap = document.createElement('div');
  searchWrap.className = 'git-search';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = '搜索命令或场景，例如：冲突 / 撤回提交 / force / tag';
  searchInput.setAttribute('aria-label', '搜索 Git 命令');
  searchInput.oninput = () => sync();
  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn btn-sm';
  clearBtn.textContent = '清空';
  clearBtn.onclick = () => {
    searchInput.value = '';
    sync();
    searchInput.focus();
  };
  searchWrap.append(searchInput, clearBtn);
  container.append(searchWrap);

  // 分类标签页
  const tabs = document.createElement('div');
  tabs.className = 'tabs git-tabs';
  const counts = countByCategory();
  const tabItems = [{ id: ALL_CATEGORY, label: '全部', icon: '📚' }, ...GIT_CATEGORIES];
  const tabButtons = new Map();
  for (const c of tabItems) {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.category = c.id;
    btn.textContent = `${c.icon} ${c.label} ${counts[c.id] || 0}`;
    btn.onclick = () => {
      activeCategory = c.id;
      sync();
    };
    tabButtons.set(c.id, btn);
    tabs.append(btn);
  }
  container.append(tabs);

  // 结果统计
  const meta = document.createElement('div');
  meta.style.cssText = 'font-size:12px;color:var(--text-soft);margin-bottom:10px;';
  container.append(meta);

  // 结果列表
  const listEl = document.createElement('div');
  listEl.className = 'git-list';
  container.append(listEl);

  let activeCategory = ALL_CATEGORY;

  const sync = () => {
    for (const [id, btn] of tabButtons) btn.classList.toggle('active', id === activeCategory);
    const items = searchCommands(searchInput.value, activeCategory);
    meta.textContent = items.length
      ? `共 ${items.length} 条命令${activeCategory === ALL_CATEGORY ? '' : ` · ${categoryLabel(activeCategory)}`}`
      : '没有匹配的命令，换个关键词或切回「全部」试试';
    listEl.textContent = '';
    for (const item of items) listEl.append(renderEntry(item));
  };

  sync();
  searchInput.focus();
}

function renderEntry(item) {
  const entry = document.createElement('div');
  entry.className = 'git-entry';

  const head = document.createElement('div');
  head.className = 'git-entry-head';
  const title = document.createElement('div');
  title.className = 'git-entry-title';
  title.textContent = item.title;
  const badge = document.createElement('span');
  if (item.danger) {
    badge.className = 'badge badge-red';
    badge.textContent = '⚠ 不可逆';
  } else {
    badge.className = 'badge badge-gray';
    badge.textContent = categoryLabel(item.category);
  }
  head.append(title, badge);

  const cmdRow = document.createElement('div');
  cmdRow.className = 'git-cmd';
  const code = document.createElement('code');
  code.textContent = formatCommandText(item.command);
  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-sm git-copy';
  copyBtn.textContent = '复制';
  copyBtn.onclick = async () => {
    const text = formatCommandText(item.command);
    const ok = await copyToClipboard(text);
    copyBtn.textContent = ok ? '✓ 已复制' : '复制失败';
    setTimeout(() => {
      copyBtn.textContent = '复制';
    }, 1200);
  };
  cmdRow.append(code, copyBtn);

  entry.append(head, cmdRow);

  if (item.example) {
    const ex = document.createElement('div');
    ex.className = 'git-entry-extra';
    ex.textContent = `示例：${formatCommandText(item.example)}`;
    entry.append(ex);
  }
  if (item.note) {
    const note = document.createElement('div');
    note.className = 'git-entry-note';
    note.textContent = `💡 ${item.note}`;
    entry.append(note);
  }
  return entry;
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的兜底方案
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
