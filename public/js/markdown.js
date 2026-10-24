// 轻量 Markdown 渲染器（纯逻辑，无 DOM，Node 可直接测试）
// 设计目标：完全离线、零依赖、安全优先。
// - 所有用户文本先转义，再拼接受控标签；Markdown 中的原始 HTML 永远只作为文字显示
// - 链接只允许 http(s)/mailto/页内锚点，拒绝 javascript:、data:text/html 等危险协议
// - 不渲染 Markdown 图片语法为 <img>，避免远程资源与 onerror 之类注入面
// - 额外提供标题提取（含 H1），供笔记侧边栏目录使用

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

// 标题锚点：保留中英文/数字，空白转连字符，去掉标点
export function slugifyHeading(text) {
  const base = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base;
}

function stripInlineMarkup(text) {
  return String(text ?? '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .trim();
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([\w#+.-]*)\s*$/;
const ATX_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const UL_RE = /^\s{0,3}[-*+]\s+(.*)$/;
const OL_RE = /^\s{0,3}\d+[.)]\s+(.*)$/;
const BQ_RE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function isTableStart(lines, index) {
  return (
    index + 1 < lines.length &&
    /\|/.test(lines[index]) &&
    TABLE_SEP_RE.test(lines[index + 1]) &&
    !FENCE_RE.test(lines[index])
  );
}

function splitTableRow(line) {
  let row = String(line).trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((cell) => cell.trim());
}

// 解析为中间 token；标题 id 在 allocateHeadingIds 中统一分配，保证唯一
function parseBlocks(markdown) {
  const lines = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const tokens = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    tokens.push({ type: 'paragraph', lines: paragraph });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const fence = line.match(FENCE_RE);
    if (fence) {
      flushParagraph();
      const marker = fence[1][0];
      const minLen = fence[1].length;
      const lang = fence[2] || '';
      const code = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const close = lines[j].match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
        if (close && close[1][0] === marker && close[1].length >= minLen) break;
        code.push(lines[j]);
      }
      tokens.push({ type: 'code', lang, text: code.join('\n') });
      i = j;
      continue;
    }

    const heading = line.match(ATX_RE);
    if (heading) {
      flushParagraph();
      const raw = heading[2];
      tokens.push({
        type: 'heading',
        level: heading[1].length,
        text: raw,
        plain: stripInlineMarkup(raw),
      });
      continue;
    }

    if (HR_RE.test(line)) {
      flushParagraph();
      tokens.push({ type: 'hr' });
      continue;
    }

    const quote = line.match(BQ_RE);
    if (quote) {
      flushParagraph();
      const parts = [quote[1]];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j].match(BQ_RE);
        if (!next) break;
        parts.push(next[1]);
        j += 1;
      }
      tokens.push({ type: 'blockquote', lines: parts });
      i = j - 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      flushParagraph();
      const header = splitTableRow(line);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim()) {
        rows.push(splitTableRow(lines[j]));
        j += 1;
      }
      tokens.push({ type: 'table', header, rows });
      i = j - 1;
      continue;
    }

    const ul = line.match(UL_RE);
    const ol = line.match(OL_RE);
    if (ul || ol) {
      flushParagraph();
      const ordered = !!ol;
      const items = [];
      let j = i;
      while (j < lines.length) {
        const m = ordered ? lines[j].match(OL_RE) : lines[j].match(UL_RE);
        if (!m) {
          // 缩进续行并入上一项
          if (items.length && /^\s{2,}\S/.test(lines[j])) {
            items[items.length - 1] += `<br>${lines[j].trim()}`;
            j += 1;
            continue;
          }
          break;
        }
        items.push(m[1]);
        j += 1;
      }
      tokens.push({ type: 'list', ordered, items });
      i = j - 1;
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return tokens;
}

function allocateHeadingIds(tokens) {
  const used = new Map();
  let fallback = 0;
  for (const token of tokens) {
    if (token.type !== 'heading') continue;
    fallback += 1;
    const base = slugifyHeading(token.plain) || `section-${fallback}`;
    const seen = used.get(base) || 0;
    used.set(base, seen + 1);
    token.id = seen === 0 ? base : `${base}-${seen + 1}`;
  }
  return tokens;
}

// 安全链接：仅 http/https/mailto/页内锚点；返回可供 href 使用的字符串或 null
export function safeUrl(raw) {
  const url = String(raw ?? '').trim();
  if (!url) return null;
  if (url.startsWith('#')) return url;
  if (/^(https?:|mailto:)/i.test(url)) {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return url;
    } catch {
      return null;
    }
  }
  return null;
}

const CODE_TOKEN_START = '\uE000';
const CODE_TOKEN_END = '\uE001';

function renderInline(text, { allowLinks = true } = {}) {
  const codes = [];
  const links = [];

  // 1) 先摘出行内代码，避免其中的 * _ [ ] 被当作格式
  let source = String(text ?? '').replace(/`([^`]+)`/g, (_, code) => {
    codes.push(escapeHtml(code));
    return `${CODE_TOKEN_START}${codes.length - 1}${CODE_TOKEN_END}`;
  });

  // 2) 链接/图片：先生成安全的受控 HTML，再用占位符保护
  if (allowLinks) {
    source = source.replace(/!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, label, rawUrl) => {
      const href = safeUrl(rawUrl);
      if (!href) return label; // 危险协议：只保留文字
      const inner = renderInline(label, { allowLinks: false });
      const external = href.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"';
      links.push(`<a href="${escapeAttr(href)}"${external}>${inner || escapeHtml(label)}</a>`);
      return `${CODE_TOKEN_START}L${links.length - 1}${CODE_TOKEN_END}`;
    });
  }

  // 3) 转义所有剩余文本（原始 HTML 在此失效）
  source = escapeHtml(source);

  // 4) 受控的强调语法
  source = source
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');

  // 5) 恢复代码与链接
  source = source.replace(new RegExp(`${CODE_TOKEN_START}(L?)(\\d+)${CODE_TOKEN_END}`, 'g'), (_, kind, n) => {
    const idx = Number(n);
    return kind === 'L' ? links[idx] : codes[idx];
  });

  return source;
}

function renderToken(token) {
  switch (token.type) {
    case 'heading':
      return `<h${token.level} id="${escapeAttr(token.id)}">${renderInline(token.text)}</h${token.level}>`;
    case 'paragraph': {
      const body = token.lines.map((line) => renderInline(line.replace(/\\$/, ''))).join('<br>');
      return `<p>${body}</p>`;
    }
    case 'code': {
      const cls = token.lang ? ` class="language-${escapeAttr(token.lang)}"` : '';
      return `<pre><code${cls}>${escapeHtml(token.text)}</code></pre>`;
    }
    case 'hr':
      return '<hr>';
    case 'blockquote':
      return `<blockquote><p>${token.lines.map((line) => renderInline(line)).join('<br>')}</p></blockquote>`;
    case 'list': {
      const tag = token.ordered ? 'ol' : 'ul';
      const items = token.items
        .map(
          (item) =>
            `<li>${String(item)
              .split('<br>')
              .map((part) => renderInline(part))
              .join('<br>')}</li>`,
        )
        .join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'table': {
      const head = token.header.map((cell) => `<th>${renderInline(cell)}</th>`).join('');
      const body = token.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
        .join('');
      return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    default:
      return '';
  }
}

export function extractHeadings(markdown) {
  const tokens = allocateHeadingIds(parseBlocks(markdown));
  return tokens
    .filter((token) => token.type === 'heading')
    .map((token) => ({ level: token.level, text: token.plain, id: token.id }));
}

export function extractH1(markdown) {
  return extractHeadings(markdown).filter((heading) => heading.level === 1);
}

export function renderMarkdown(markdown) {
  const tokens = allocateHeadingIds(parseBlocks(markdown));
  const headings = tokens
    .filter((token) => token.type === 'heading')
    .map((token) => ({ level: token.level, text: token.plain, id: token.id }));
  return { html: tokens.map(renderToken).join('\n'), headings };
}
