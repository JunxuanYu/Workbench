// Markdown 转换工具：Markdown → PDF
// 本机 Node 服务通过子进程调用 Python（python/md_convert.py）渲染为真实 PDF
// 浏览器端只做输入 / 下载，不加载任何外部 CDN

const MAX_CHARS = 500000; // 输入文本上限（与后端 10mb body 上限对齐，字符级更直观）

// ---------- 工具入口 ----------

export function createMdConvertTool() {
  return {
    id: 'md-convert',
    name: 'Markdown 转换',
    icon: '📝',
    render(container) {
      renderMdConvert(container);
    },
  };
}

function renderMdConvert(container) {
  container.innerHTML = '';
  // 标题
  const heading = document.createElement('h3');
  heading.style.cssText = 'font-size:16px;margin-bottom:12px;';
  heading.textContent = 'Markdown → PDF 转换工具';
  container.append(heading);

  // 说明
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:13px;color:var(--text-soft);margin-bottom:12px;line-height:1.6;';
  hint.textContent =
    '支持标题 / 加粗 / 斜体 / 行内代码 / 链接 / 引用 / 列表 / 代码块 / 表格 / 分割线 / 图片（本机路径或 data URI）。中文排版正常，离线可用。';
  container.append(hint);

  // 文件选择 + 字数信息
  const fileRow = document.createElement('div');
  fileRow.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap;';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.md,.markdown,.txt';
  fileInput.style.cssText = 'font-size:14px;';
  const fileInfo = document.createElement('span');
  fileInfo.style.cssText = 'font-size:12px;color:var(--text-soft);';
  fileRow.append(fileInput, fileInfo);
  container.append(fileRow);

  // 文本输入区
  const textarea = document.createElement('textarea');
  textarea.placeholder = '在此粘贴 Markdown 文本，或选择上方 .md 文件导入…';
  textarea.style.cssText =
    'width:100%;box-sizing:border-box;height:220px;font-size:13px;line-height:1.6;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--card-bg);color:var(--text);resize:vertical;font-family:inherit;';
  container.append(textarea);

  // 状态区
  const status = document.createElement('div');
  status.style.cssText = 'font-size:13px;color:var(--text-soft);margin-top:10px;min-height:20px;';
  container.append(status);

  // 按钮区
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;';
  const convertBtn = document.createElement('button');
  convertBtn.className = 'btn btn-primary';
  convertBtn.textContent = '📄 转换为 PDF';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn btn-sm';
  clearBtn.textContent = '清空';
  btnRow.append(convertBtn, clearBtn);
  container.append(btnRow);

  // 结果区
  const resultArea = document.createElement('div');
  resultArea.style.cssText = 'margin-top:12px;';
  container.append(resultArea);

  fileInput.onchange = () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInfo.textContent = `「${file.name}」${(file.size / 1024).toFixed(1)} KB`;
    const reader = new FileReader();
    reader.onload = () => {
      textarea.value = String(reader.result || '');
      status.textContent = `✅ 已导入 ${file.name}（${textarea.value.length.toLocaleString()} 字符）`;
    };
    reader.onerror = () => {
      status.textContent = '❌ 读取文件失败';
    };
    reader.readAsText(file, 'utf-8');
  };

  clearBtn.onclick = () => {
    textarea.value = '';
    fileInput.value = '';
    fileInfo.textContent = '';
    status.textContent = '';
    resultArea.innerHTML = '';
  };

  // 转换：直接把文本作为 raw body 上传
  convertBtn.onclick = async () => {
    const text = textarea.value;
    if (!text.trim()) {
      status.textContent = '⚠️ 请先输入或导入 Markdown 内容';
      return;
    }
    if (text.length > MAX_CHARS) {
      status.textContent = `❌ 内容过长（${text.length.toLocaleString()} 字符），上限 ${MAX_CHARS.toLocaleString()} 字符`;
      return;
    }
    const fileName = fileInput.files[0]?.name || '文档.md';
    const baseName = fileName.replace(/\.(md|markdown|txt)$/i, '') || '文档';
    convertBtn.disabled = true;
    status.textContent = '⏳ 正在渲染 PDF...';
    resultArea.innerHTML = '';

    try {
      const resp = await fetch(`/api/tools/md/convert?name=${encodeURIComponent(fileName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        body: new TextEncoder().encode(text),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        status.textContent =
          resp.status === 503
            ? '❌ Python 环境未就绪，请运行 start.bat 完成环境安装'
            : `❌ 转换失败: ${data.error || `HTTP ${resp.status}`}`;
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseName}.pdf`;
      link.className = 'btn btn-primary';
      link.textContent = '⬇ 下载 PDF';
      link.style.cssText = 'display:inline-block;';
      resultArea.append(link);
      status.textContent = `✅ 转换完成 — ${link.download}`;
    } catch (e) {
      status.textContent = `❌ 转换失败: ${e.message}`;
    } finally {
      convertBtn.disabled = false;
    }
  };
}
