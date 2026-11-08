// 页码范围解析（前端与 Node 服务端共用的纯函数，无 DOM 依赖）
//
// 支持的写法：
//   留空 / 纯空格   -> 全部页
//   "3"             -> 第 3 页
//   "2-5"           -> 第 2~5 页
//   "2-"            -> 第 2 页到末页
//   "-3"            -> 第 1~3 页
//   "1,4,6-8"       -> 组合，逗号分隔
//   全角符号（，、－～—–）与空格自动兼容
//
// 返回 pages 为升序去重的 1-based 页号数组；all=true 表示用户没限定页码。
// 解析失败返回 { ok: false, message }，message 为可直接展示的中文提示。

const SEPARATORS_RE = /[，、；]/g;
const DASHES_RE = /[－—–~～]/g;
const SPACES_RE = /[\s\u3000]/g;
const DIGITS_RE = /^\d+$/;

/**
 * 把页码范围字符串解析为页号数组
 * @param {string} spec 用户输入，如 "1-3,5"
 * @param {number} total PDF 总页数
 * @returns {{ ok: true, pages: number[], all: boolean } | { ok: false, message: string }}
 */
export function parsePageSelection(spec, total) {
  if (!Number.isInteger(total) || total < 1) {
    return { ok: false, message: '尚未获知 PDF 页数，请重新选择文件' };
  }
  const text = String(spec ?? '')
    .replace(SEPARATORS_RE, ',')
    .replace(DASHES_RE, '-')
    .replace(SPACES_RE, '');
  if (!text) return { ok: true, pages: [], all: true };

  const numbers = new Set();
  const tokens = text.split(',').filter(Boolean);
  if (tokens.length === 0) return { ok: false, message: `页码范围无效：${spec}` };

  for (const token of tokens) {
    if (token.includes('-')) {
      // 只允许一个连字符：'1-2-3' 属于手误，静默取前两段会转出错误页范围
      const parts = token.split('-');
      if (parts.length !== 2) return { ok: false, message: `页码范围格式不正确：${token}（示例：1-3,5）` };
      const [startText, endText] = parts;
      const start = toPageNumber(startText || '1', total);
      if (typeof start === 'string') return { ok: false, message: start };
      const end = toPageNumber(endText || String(total), total);
      if (typeof end === 'string') return { ok: false, message: end };
      if (start > end) return { ok: false, message: `起始页不能大于结束页：${token}` };
      for (let n = start; n <= end; n++) numbers.add(n);
    } else {
      const value = toPageNumber(token, total);
      if (typeof value === 'string') return { ok: false, message: value };
      numbers.add(value);
    }
  }
  if (numbers.size === 0) return { ok: false, message: `页码范围无效：${spec}` };
  return { ok: true, pages: [...numbers].sort((a, b) => a - b), all: false };
}

// 单个页码：合法返回数字，非法返回中文错误串（用类型区分，避免额外对象分配）
function toPageNumber(text, total) {
  if (!DIGITS_RE.test(text)) {
    return `页码范围格式不正确：${text}（示例：1-3,5）`;
  }
  const value = Number(text);
  if (value < 1 || value > total) {
    return `页码超出范围：${value}（共 ${total} 页）`;
  }
  return value;
}

/**
 * 把页号数组压缩成便于展示/回传的字符串，如 [1,2,3,5] -> "1-3,5"
 * @param {number[]} pages 升序页号
 * @returns {string}
 */
export function describePageSelection(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return '';
  const parts = [];
  let start = pages[0];
  let prev = pages[0];
  for (let i = 1; i < pages.length; i++) {
    const n = pages[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(',');
}
