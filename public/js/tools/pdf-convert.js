// PDF 转换工具：PDF → Word / 图片 / Excel / PPT / TXT / Markdown
// 本机 Node 服务通过子进程调用 Python（python/pdf_convert.py）转换为真实格式
// 浏览器端只做上传 / 下载 / 预览，不加载任何外部 CDN

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

  // 文件选择区域（支持拖拽上传）
  const dropZone = document.createElement('div');
  dropZone.style.cssText =
    'border:2px dashed var(--border);border-radius:8px;padding:20px;text-align:center;margin-bottom:16px;cursor:pointer;transition:all 0.2s;background:var(--card-bg);';
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
    dropZone.style.borderColor = 'var(--primary)';
    dropZone.style.background = 'var(--primary-light, rgba(59,130,246,0.05))';
  };
  dropZone.ondragleave = () => {
    dropZone.style.borderColor = 'var(--border)';
    dropZone.style.background = 'var(--card-bg)';
  };
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border)';
    dropZone.style.background = 'var(--card-bg)';
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

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      status.textContent = '❌ 请选择 PDF 文件';
      return;
    }
    if (file.size === 0) {
      status.textContent = '❌ 文件为空，请选择有效的 PDF 文件';
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      status.textContent = '❌ 文件过大（超过 200MB），请压缩后再试';
      return;
    }
    currentFile = file;
    currentToken = null;
    currentNumPages = 0;
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
      status.textContent = `✅ 已加载「${file.name}」— 共 ${data.numPages} 页，可选择转换格式`;
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
    status.textContent = `⏳ 正在转换为 ${fmt.label}...`;
    resultArea.innerHTML = '';
    fmtBtns.forEach((b) => {
      b.disabled = true;
    });

    try {
      const resp = await fetch(
        `/api/tools/pdf/convert?token=${encodeURIComponent(currentToken)}&format=${encodeURIComponent(fmt.id)}`,
      );
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        status.textContent =
          resp.status === 404 ? '❌ 会话已过期，请重新选择文件' : `❌ 转换失败: ${data.error || `HTTP ${resp.status}`}`;
        return;
      }
      const blob = await resp.blob();
      const baseName = currentFile?.name?.replace(/\.pdf$/i, '') || 'output';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseName}${fmt.ext}`;
      link.className = 'btn btn-primary';
      link.textContent = `⬇ 下载 ${fmt.label}`;
      link.style.cssText = 'display:inline-block;margin-top:8px;';
      resultArea.append(link);

      // 图片：逐页预览（复用本机转换好的 PNG）
      if (fmt.id === 'image') {
        const preview = document.createElement('div');
        preview.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;';
        for (let i = 1; i <= currentNumPages; i++) {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:8px;';
          const imgEl = document.createElement('img');
          imgEl.src = `/api/tools/pdf/page?token=${encodeURIComponent(currentToken)}&page=${i}`;
          imgEl.style.cssText = 'width:100%;max-width:260px;border-radius:4px;';
          const cap = document.createElement('div');
          cap.style.cssText = 'font-size:12px;color:var(--text-soft);text-align:center;margin-top:4px;';
          cap.textContent = `第 ${i} 页`;
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
        hint.textContent = '💡 下载后用 Word / Excel / PowerPoint 打开即可查看';
        resultArea.append(hint);
      }

      status.textContent = `✅ 转换完成 — ${fmt.label}`;
    } catch (e) {
      status.textContent = `❌ 转换失败: ${e.message}`;
    }
  }
}
