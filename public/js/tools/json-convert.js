// JSON 转换工具：格式化 / 压缩 / 校验 / CSV / YAML

// ---------- 纯逻辑函数（Node 可测试） ----------

/** 解析 JSON，返回 { ok, data, error } */
export function parseJsonSafe(text) {
  try {
    return { ok: true, data: JSON.parse(text), error: null };
  } catch (e) {
    return { ok: false, data: null, error: e.message };
  }
}

/** 格式化 JSON（美化输出） */
export function formatJson(text, indent = 2) {
  const r = parseJsonSafe(text);
  if (!r.ok) throw new Error(`JSON 解析失败: ${r.error}`);
  return JSON.stringify(r.data, null, indent);
}

/** 压缩 JSON（单行） */
export function minifyJson(text) {
  const r = parseJsonSafe(text);
  if (!r.ok) throw new Error(`JSON 解析失败: ${r.error}`);
  return JSON.stringify(r.data);
}

/** 校验 JSON，返回 { valid, error, line, column } */
export function validateJson(text) {
  const r = parseJsonSafe(text);
  if (r.ok) return { valid: true, error: null, line: null, column: null };
  // 尝试从错误消息提取行列
  const m = r.error.match(/position\s+(\d+)/i);
  let line = null, column = null;
  if (m) {
    const pos = parseInt(m[1], 10);
    const upTo = text.slice(0, pos);
    line = (upTo.match(/\n/g) || []).length + 1;
    column = pos - upTo.lastIndexOf('\n');
  }
  return { valid: false, error: r.error, line, column };
}

/** JSON 数组 → CSV 字符串 */
export function jsonToCsv(text) {
  const r = parseJsonSafe(text);
  if (!r.ok) throw new Error(`JSON 解析失败: ${r.error}`);
  const arr = Array.isArray(r.data) ? r.data : [r.data];
  if (arr.length === 0) return '';
  // 收集所有键
  const keys = [...new Set(arr.flatMap(obj => Object.keys(obj || {})))];
  if (keys.length === 0) return '';
  // 表头
  const rows = [keys.map(k => csvEscape(k)).join(',')];
  // 数据行
  for (const obj of arr) {
    rows.push(keys.map(k => csvEscape(obj?.[k])).join(','));
  }
  return rows.join('\n');
}

function csvEscape(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** JSON → YAML（简单转换） */
export function jsonToYaml(text, indent = 2) {
  const r = parseJsonSafe(text);
  if (!r.ok) throw new Error(`JSON 解析失败: ${r.error}`);
  return valueToYaml(r.data, 0, indent);
}

function valueToYaml(val, depth, ind) {
  const pad = ' '.repeat(depth * ind);
  if (val === null) return 'null';
  if (val === undefined) return 'null';
  if (typeof val === 'boolean') return String(val);
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') {
    // 多行字符串或含特殊字符时用 | 或引号
    if (val.includes('\n')) {
      const lines = val.split('\n');
      const head = lines[0];
      const rest = lines.slice(1).map(l => ' '.repeat((depth + 1) * ind) + l).join('\n');
      return `${yamlQuote(head)} |\n${rest}`;
    }
    if (needsQuote(val)) return yamlQuote(val);
    return val;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    return val.map(item => {
      const inner = valueToYaml(item, depth + 1, ind);
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        // 对象项：第一行带 "- "，后续缩进
        const lines = inner.split('\n');
        return `${pad}- ${lines[0].trimStart()}\n${lines.slice(1).join('\n')}`;
      }
      return `${pad}- ${inner}`;
    }).join('\n');
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val);
    if (keys.length === 0) return '{}';
    return keys.map(k => {
      const v = val[k];
      const inner = valueToYaml(v, depth + 1, ind);
      if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length > 0) {
        return `${pad}${yamlKey(k)}:\n${inner}`;
      }
      if (Array.isArray(v) && v.length > 0) {
        return `${pad}${yamlKey(k)}:\n${inner}`;
      }
      return `${pad}${yamlKey(k)}: ${inner}`;
    }).join('\n');
  }
  return String(val);
}

function yamlKey(k) {
  if (/[:\s#\[\]{},&*?|>!'"%@`]/.test(k) || k === '') return `"${k.replace(/"/g, '\\"')}"`;
  return k;
}

function yamlQuote(s) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function needsQuote(s) {
  if (s === '') return true;
  if (/^(true|false|null|\d)/.test(s)) return true;
  if (/[:\s#\[\]{},&*?|>!'"%@`]/.test(s)) return true;
  return false;
}

// ---------- 操作定义 ----------
export const OPERATIONS = [
  { id: 'format', label: '格式化',   icon: '✨', description: '美化 JSON 缩进' },
  { id: 'minify', label: '压缩',     icon: '📦', description: '压缩为单行' },
  { id: 'validate', label: '校验',   icon: '🔍', description: '检查 JSON 语法' },
  { id: 'csv',    label: '→ CSV',    icon: '📊', description: 'JSON 数组转 CSV 表格' },
  { id: 'yaml',   label: '→ YAML',   icon: '📝', description: 'JSON 转 YAML 格式' }
];

// ---------- 操作执行 ----------
const OPERATORS = {
  format: (text) => formatJson(text),
  minify: (text) => minifyJson(text),
  validate: (text) => {
    const r = validateJson(text);
    if (r.valid) return { success: true, message: '✅ JSON 格式正确' };
    let msg = `❌ JSON 解析错误: ${r.error}`;
    if (r.line != null) msg += `\n📍 位置: 第 ${r.line} 行，第 ${r.column} 列`;
    return { success: false, message: msg };
  },
  csv: (text) => jsonToCsv(text),
  yaml: (text) => jsonToYaml(text)
};

export function executeOperation(opId, text) {
  const fn = OPERATORS[opId];
  if (!fn) throw new Error(`未知操作: ${opId}`);
  return fn(text);
}

// ---------- 工具入口 ----------
export function createJsonConvertTool() {
  return {
    id: 'json-convert',
    name: 'JSON 转换',
    icon: '🔧',
    render(container) {
      renderJsonConvert(container);
    }
  };
}

function renderJsonConvert(container) {
  container.innerHTML = '';

  // 标题
  const heading = document.createElement('h2');
  heading.style.cssText = 'font-size:16px;margin-bottom:12px;';
  heading.textContent = 'JSON 转换工具';
  container.append(heading);

  // 输入区
  const inputLabel = document.createElement('div');
  inputLabel.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-soft);';
  inputLabel.textContent = '输入 JSON：';
  const inputArea = document.createElement('textarea');
  inputArea.placeholder = '在此粘贴 JSON...\n示例: [{"name":"张三","age":25},{"name":"李四","age":30}]';
  inputArea.style.cssText = 'width:100%;height:180px;font-family:Consolas,Monaco,monospace;font-size:13px;padding:10px;border:1px solid var(--border);border-radius:8px;resize:vertical;tab-size:2;';
  container.append(inputLabel, inputArea);

  // 操作按钮区
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;';
  for (const op of OPERATIONS) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.textContent = `${op.icon} ${op.label}`;
    btn.title = op.description;
    btn.onclick = () => doOperation(op.id);
    btnRow.append(btn);
  }
  container.append(btnRow);

  // 状态区
  const status = document.createElement('div');
  status.style.cssText = 'font-size:13px;min-height:20px;margin-bottom:8px;';
  container.append(status);

  // 输出区
  const outputLabel = document.createElement('div');
  outputLabel.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-soft);display:none;';
  outputLabel.textContent = '输出结果：';
  const outputArea = document.createElement('textarea');
  outputArea.readOnly = true;
  outputArea.style.cssText = 'width:100%;height:220px;font-family:Consolas,Monaco,monospace;font-size:13px;padding:10px;border:1px solid var(--border);border-radius:8px;resize:vertical;background:var(--gray-light);tab-size:2;display:none;';
  container.append(outputLabel, outputArea);

  // 下载按钮
  const dlBtn = document.createElement('button');
  dlBtn.className = 'btn btn-sm btn-primary';
  dlBtn.textContent = '⬇ 下载结果';
  dlBtn.style.cssText = 'display:none;margin-top:8px;';
  dlBtn.onclick = () => downloadResult();
  container.append(dlBtn);

  let lastResult = '';
  let lastFormat = 'txt';

  function doOperation(opId) {
    const text = inputArea.value.trim();
    if (!text) {
      status.textContent = '⚠️ 请先输入 JSON';
      status.style.color = 'var(--orange)';
      return;
    }

    try {
      const result = executeOperation(opId, text);

      if (opId === 'validate') {
        // 校验：只显示状态，不输出结果
        status.textContent = result.message;
        status.style.color = result.success ? 'var(--green)' : 'var(--red)';
        outputLabel.style.display = 'none';
        outputArea.style.display = 'none';
        dlBtn.style.display = 'none';
        return;
      }

      lastResult = typeof result === 'string' ? result : '';
      lastFormat = opId === 'csv' ? 'csv' : opId === 'yaml' ? 'yaml' : 'json';

      outputLabel.style.display = '';
      outputArea.style.display = '';
      outputArea.value = lastResult;
      dlBtn.style.display = '';
      status.textContent = `✅ 转换完成 — ${OPERATIONS.find(o => o.id === opId).label}`;
      status.style.color = 'var(--green)';
    } catch (e) {
      status.textContent = `❌ ${e.message}`;
      status.style.color = 'var(--red)';
      outputLabel.style.display = 'none';
      outputArea.style.display = 'none';
      dlBtn.style.display = 'none';
    }
  }

  function downloadResult() {
    if (!lastResult) return;
    const ext = { json: '.json', csv: '.csv', yaml: '.yaml' }[lastFormat] || '.txt';
    const mime = { json: 'application/json', csv: 'text/csv', yaml: 'text/yaml' }[lastFormat] || 'text/plain';
    const blob = new Blob(['\ufeff' + lastResult], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `output${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
