// PDF 转换工具：PDF → Word / 图片 / Excel / PPT / TXT / Markdown
// 本机 Node 服务通过子进程调用 Python（python/pdf_convert.py）转换为真实格式
// 浏览器端只做上传 / 下载 / 预览，不加载任何外部 CDN

import { parsePageSelection, describePageSelection } from './page-range.js';

export const FORMAT_OPTIONS = [
  {
    id: 'word',
    label: 'Word (.docx)',
    icon: '📄',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: '.docx',
  },
  { id: 'image', label: '图片 (.zip)', icon: '🖼️', mime: 'application/zip', ext: '.zip' },
  {
    id: 'excel',
    label: 'Excel (.xlsx)',
    icon: '📊',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: '.xlsx',
  },
  {
    id: 'ppt',
    label: 'PPT (.pptx)',
    icon: '📽️',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: '.pptx',
  },
  { id: 'txt', label: 'TXT (.txt)', icon: '📝', mime: 'text/plain;charset=utf-8', ext: '.txt' },
  { id: 'md', label: 'Markdown (.md)', icon: '📘', mime: 'text/markdown;charset=utf-8', ext: '.md' },
];

// ---------- 纯逻辑：文件校验（可单测） ----------

export const PDF_MAX_SIZE_MB = 200;

/**
 * 校验待转换的 PDF 文件（纯函数，Node 可直接测试）
 * @param {{ name?: string, size?: number }} file
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validatePdfFile(file) {
  if (!file) return { ok: false, message: '❌ 请先选择文件' };
  if (!file.name || !file.name.toLowerCase().endsWith('.pdf')) {
    return { ok: false, message: '❌ 请选择 PDF 文件' };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, message: '❌ 文件为空，请选择有效的 PDF 文件' };
  }
  if (file.size > PDF_MAX_SIZE_MB * 1024 * 1024) {
    return { ok: false, message: `❌ 文件过大（超过 ${PDF_MAX_SIZE_MB}MB），请压缩后再试` };
  }
  return { ok: true };
}

/**
 * 构造转换请求 URL（纯函数，Node 可单测）
 * 只有 Word / PPT 支持 layout=1；其它格式忽略该参数。
 * pages 传紧凑页码串（如 "2-3"），留空表示全部页。
 * @param {string} token
 * @param {string} format
 * @param {boolean} layout
 * @param {string} [pages]
 */
export function buildConvertUrl(token, format, layout = true, pages = '') {
  const params = new URLSearchParams({ token: token || '', format: format || '' });
  if (layout && (format === 'word' || format === 'ppt')) params.set('layout', '1');
  if (pages) params.set('pages', pages);
  return `/api/tools/pdf/convert?${params.toString()}`;
}

// ---------- 工具入口 ----------

export function createPdfConvertTool() {
  return {
    id: 'pdf-convert',
    name: 'PDF 转换',
    icon: '📑',
    render(container) {
      renderPdfConvert(container);
    },
  };
}

function renderPdfConvert(container) {
  container.innerHTML = '';
  // 标题
  const heading = document.createElement('h2');
  heading.style.cssText = 'font-size:16px;margin-bottom:12px;';
  heading.textContent = 'PDF 转换工具';
  container.append(heading);

  // 文件选择区域（支持拖拽上传，外观由 .pdf-dropzone 主题样式控制）
  const dropZone = document.createElement('div');
  dropZone.className = 'pdf-dropzone';
  dropZone.innerHTML =
    '<div style="font-size:14px;margin-bottom:8px;">📁 拖拽 PDF 文件到此处，或点击选择文件</div><div style="font-size:12px;color:var(--text-soft);">支持 .pdf 格式，最大 200MB</div>';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf';
  fileInput.style.cssText = 'display:none;';
  dropZone.append(fileInput);
  dropZone.onclick = () => fileInput.click();
  dropZone.ondragover = (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  };
  dropZone.ondragleave = () => {
    dropZone.classList.remove('dragover');
  };
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) {
      fileInput.files = e.dataTransfer.files;
      const event = new Event('change', { bubbles: true });
      fileInput.dispatchEvent(event);
    }
  };
  container.append(dropZone);

  // 状态区
  const status = document.createElement('div');
  status.style.cssText = 'font-size:13px;color:var(--text-soft);margin-bottom:12px;min-height:20px;';
  container.append(status);

  // 原版式开关（默认开启；仅 Word / PPT 生效）
  const layoutRow = document.createElement('label');
  layoutRow.className = 'pdf-layout-option';
  layoutRow.style.cssText =
    'display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--text-soft);margin-bottom:12px;cursor:pointer;user-select:none;';
  const layoutCheckbox = document.createElement('input');
  layoutCheckbox.type = 'checkbox';
  layoutCheckbox.checked = true;
  layoutCheckbox.style.cssText = 'margin-top:2px;accent-color:var(--accent);flex:0 0 auto;';
  const layoutText = document.createElement('span');
  layoutText.innerHTML =
    '<strong style="color:var(--text);">保留原版式（推荐）</strong><br>' +
    '<span style="font-size:12px;">Word / PPT 按 PDF 的页面尺寸、文字位置、字号、颜色和图片原样输出</span>';
  layoutRow.append(layoutCheckbox, layoutText);
  container.append(layoutRow);

  // 页码范围（留空 = 全部页；仅转换选中的页）
  const rangeRow = document.createElement('div');
  rangeRow.className = 'pdf-range-row';
  const rangeLabel = document.createElement('label');
  rangeLabel.className = 'pdf-range-label';
  rangeLabel.htmlFor = 'pdf-page-range';
  rangeLabel.textContent = '页码范围';
  const pageInput = document.createElement('input');
  pageInput.type = 'text';
  pageInput.id = 'pdf-page-range';
  pageInput.className = 'pdf-range-input';
  pageInput.placeholder = '留空 = 全部页，例如 1-3,5';
  pageInput.disabled = true;
  pageInput.setAttribute('aria-label', '页码范围');
  pageInput.autocomplete = 'off';
  const rangeHint = document.createElement('span');
  rangeHint.className = 'pdf-range-hint';
  rangeHint.textContent = '上传后填写';
  rangeRow.append(rangeLabel, pageInput, rangeHint);
  container.append(rangeRow);

  // 输入即校验：格式/越界立刻提示，避免点了转换才知道出错
  pageInput.oninput = () => {
    const raw = pageInput.value.trim();
    if (!raw) {
      rangeHint.textContent = currentNumPages ? `共 ${currentNumPages} 页 · 全部转换` : '上传后填写';
      pageInput.classList.remove('is-invalid');
      return;
    }
    const check = parsePageSelection(raw, currentNumPages);
    if (check.ok) {
      rangeHint.textContent = `已选 ${check.pages.length} 页`;
      pageInput.classList.remove('is-invalid');
    } else {
      rangeHint.textContent = check.message;
      pageInput.classList.add('is-invalid');
    }
  };

  // 转换按钮区
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;align-items:center;';
  container.append(btnRow);

  // 结果区
  const resultArea = document.createElement('div');
  container.append(resultArea);

  let currentFile = null;
  let currentToken = null;
  let currentNumPages = 0;

  // 重新选择按钮
  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn btn-sm';
  resetBtn.textContent = '🔄 重新选择';
  resetBtn.style.display = 'none';
  resetBtn.onclick = () => {
    currentFile = null;
    currentToken = null;
    currentNumPages = 0;
    fileInput.value = '';
    const dropDivs = dropZone.querySelectorAll('div');
    if (dropDivs[0]) dropDivs[0].textContent = '📁 拖拽 PDF 文件到此处，或点击选择文件';
    if (dropDivs[1]) dropDivs[1].textContent = '支持 .pdf 格式，最大 200MB';
    status.textContent = '';
    resultArea.innerHTML = '';
    pageInput.value = '';
    pageInput.disabled = true;
    pageInput.classList.remove('is-invalid');
    rangeHint.textContent = '上传后填写';
    fmtBtns.forEach((b) => {
      b.disabled = true;
    });
    resetBtn.style.display = 'none';
  };
  btnRow.append(resetBtn);

  const fmtBtns = FORMAT_OPTIONS.map((fmt) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.textContent = `${fmt.icon} ${fmt.label}`;
    btn.disabled = true;
    btn.onclick = () => doConvert(fmt);
    btnRow.append(btn);
    return btn;
  });

  const setFmtButtonsEnabled = (enabled) => {
    fmtBtns.forEach((b) => {
      b.disabled = !enabled;
    });
  };

  const handleFile = async (file) => {
    if (!file) return;
    const check = validatePdfFile(file);
    if (!check.ok) {
      status.textContent = check.message;
      return;
    }
    currentFile = file;
    currentToken = null;
    currentNumPages = 0;
    pageInput.value = '';
    pageInput.disabled = true;
    pageInput.classList.remove('is-invalid');
    rangeHint.textContent = '解析中...';
    status.textContent = '⏳ 正在上传并解析 PDF...';
    resultArea.innerHTML = '';
    const dropDivs = dropZone.querySelectorAll('div');
    if (dropDivs[0]) dropDivs[0].textContent = `📄 ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
    fmtBtns.forEach((b) => {
      b.disabled = true;
    });
    resetBtn.style.display = 'inline-block';

    try {
      const resp = await fetch(`/api/tools/pdf/parse?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: await file.arrayBuffer(),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        status.textContent =
          resp.status === 503
            ? '❌ Python 环境未就绪，请运行 start.bat 完成环境安装'
            : resp.status === 413
              ? '❌ 文件过大，超出上传上限'
              : `❌ 解析失败: ${data.error || `HTTP ${resp.status}`}`;
        return;
      }
      currentToken = data.token;
      currentNumPages = data.numPages || 0;
      pageInput.disabled = false;
      rangeHint.textContent = `共 ${currentNumPages} 页 · 全部转换`;
      status.textContent = `✅ 已加载「${file.name}」— 共 ${data.numPages} 页，可选择页码与转换格式`;
      fmtBtns.forEach((b) => {
        b.disabled = false;
      });
    } catch (e) {
      status.textContent = `❌ 解析失败: ${e.message}`;
    }
  };

  fileInput.onchange = async () => {
    await handleFile(fileInput.files[0]);
  };

  async function doConvert(fmt) {
    if (!currentToken) return;
    // 页码先校验：非法输入不发起请求，也不消耗会话
    const selection = parsePageSelection(pageInput.value, currentNumPages);
    if (!selection.ok) {
      status.textContent = `❌ ${selection.message}`;
      pageInput.classList.add('is-invalid');
      pageInput.focus();
      return;
    }
    const pageParam = selection.all ? '' : describePageSelection(selection.pages);
    const scopeText = pageParam ? `第 ${pageParam} 页` : `全部 ${currentNumPages} 页`;
    status.textContent = `⏳ 正在转换${scopeText}为 ${fmt.label}...`;
    resultArea.innerHTML = '';
    setFmtButtonsEnabled(false);

    const keepLayout = layoutCheckbox.checked && (fmt.id === 'word' || fmt.id === 'ppt');
    try {
      const resp = await fetch(buildConvertUrl(currentToken, fmt.id, keepLayout, pageParam));
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        status.textContent =
          resp.status === 404 ? '❌ 会话已过期，请重新选择文件' : `❌ 转换失败: ${data.error || `HTTP ${resp.status}`}`;
        return;
      }
      const blob = await resp.blob();
      const baseName = currentFile?.name?.replace(/\.pdf$/i, '') || 'output';
      const suffix = pageParam ? `-p${pageParam}` : '';
      const url = URL.createObjectURL(blob);
      const sizeMb =
        blob.size >= 1024 * 1024
          ? `${(blob.size / 1024 / 1024).toFixed(1)} MB`
          : `${Math.max(1, Math.round(blob.size / 1024))} KB`;
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseName}${suffix}${fmt.ext}`;
      link.className = 'btn btn-primary';
      link.textContent = `⬇ 下载 ${fmt.label}（${sizeMb}）`;
      link.style.cssText = 'display:inline-block;margin-top:8px;';
      resultArea.append(link);

      // 选页时明确提示本次转换范围，避免误以为导出了整份文档
      if (pageParam) {
        const scope = document.createElement('div');
        scope.className = 'pdf-result-scope';
        scope.textContent = `已转换 ${scopeText}（共 ${currentNumPages} 页）`;
        resultArea.append(scope);
      }

      // 图片：逐页预览（只预览本次转换的页）
      if (fmt.id === 'image') {
        const preview = document.createElement('div');
        preview.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;';
        const pagesToShow = selection.all ? Array.from({ length: currentNumPages }, (_, i) => i + 1) : selection.pages;
        for (const p of pagesToShow) {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:8px;';
          const imgEl = document.createElement('img');
          imgEl.src = `/api/tools/pdf/page?token=${encodeURIComponent(currentToken)}&page=${p}`;
          imgEl.style.cssText = 'width:100%;max-width:260px;border-radius:4px;';
          const cap = document.createElement('div');
          cap.style.cssText = 'font-size:12px;color:var(--text-soft);text-align:center;margin-top:4px;';
          cap.textContent = `第 ${p} 页`;
          wrap.append(imgEl, cap);
          preview.append(wrap);
        }
        resultArea.append(preview);
      }

      // TXT / Markdown：内联预览前 5000 字
      if (fmt.id === 'txt' || fmt.id === 'md') {
        const text = await blob.text();
        const preview = document.createElement('pre');
        preview.style.cssText =
          'background:var(--gray-light);padding:12px;border-radius:8px;font-size:12px;max-height:300px;overflow:auto;margin-top:10px;white-space:pre-wrap;';
        preview.textContent = text.slice(0, 5000) + (text.length > 5000 ? '\n...（已截断）' : '');
        resultArea.append(preview);
      }

      // Word / Excel / PPT：下载提示
      if (fmt.id === 'word' || fmt.id === 'excel' || fmt.id === 'ppt') {
        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:12px;color:var(--text-soft);margin-top:8px;';
        hint.textContent =
          keepLayout && (fmt.id === 'word' || fmt.id === 'ppt')
            ? '💡 已保留原版式：文字可编辑，表格线 / 图片 / 底纹保留在背景中'
            : '💡 下载后用 Word / Excel / PowerPoint 打开即可查看';
        resultArea.append(hint);
      }

      status.textContent = pageParam ? `✅ 转换完成 — ${fmt.label}（${scopeText}）` : `✅ 转换完成 — ${fmt.label}`;
    } catch (e) {
      status.textContent = `❌ 转换失败: ${e.message}`;
    } finally {
      // 转换结束后恢复格式按钮：同一文件可连续转换为多种格式（token 未过期即可复用）
      setFmtButtonsEnabled(true);
    }
  }
}
