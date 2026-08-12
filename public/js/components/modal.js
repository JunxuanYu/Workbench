// 通用表单弹窗：fields 定义表单，onSubmit 返回 false 则不关闭（用于校验失败提示）
import { esc } from './util.js';

export function openForm({ title, fields, values = {}, onSubmit }) {
  return new Promise(resolve => {
    const root = document.getElementById('modal-root');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    let html = `<div class="modal"><div class="modal-title">${esc(title)}</div><div class="modal-body form-body">`;
    for (const f of fields) {
      const v = values[f.key] ?? f.default ?? '';
      html += `<div class="form-field"><label>${esc(f.label)}${f.required ? ' *' : ''}</label>`;
      if (f.type === 'textarea') {
        html += `<textarea data-k="${f.key}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
      } else if (f.type === 'select') {
        html += `<select data-k="${f.key}">`;
        for (const o of f.options || []) {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          html += `<option value="${esc(opt.value)}" ${String(v) === String(opt.value) ? 'selected' : ''}>${esc(opt.label)}</option>`;
        }
        html += '</select>';
      } else {
        html += `<input data-k="${f.key}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" step="any">`;
      }
      html += '</div>';
    }
    html += `<p class="form-error"></p></div>
      <div class="modal-actions">
        <button class="btn btn-plain" data-act="cancel">取消</button>
        <button class="btn btn-primary" data-act="ok">保存</button>
      </div></div>`;
    overlay.innerHTML = html;

    const errEl = overlay.querySelector('.form-error');
    const close = val => { overlay.remove(); resolve(val); };

    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    overlay.querySelector('[data-act="cancel"]').onclick = () => close(false);
    overlay.querySelector('[data-act="ok"]').onclick = async () => {
      const out = {};
      for (const f of fields) {
        const el = overlay.querySelector(`[data-k="${CSS.escape(f.key)}"]`);
        out[f.key] = f.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      }
      for (const f of fields) {
        if (f.required && !String(out[f.key] ?? '').trim()) {
          errEl.textContent = `请填写「${f.label}」`;
          return;
        }
        if (f.type === 'number' && out[f.key] !== '' && (isNaN(out[f.key]) || out[f.key] < 0)) {
          errEl.textContent = `「${f.label}」不是有效数字`;
          return;
        }
      }
      try {
        const result = await onSubmit(out);
        if (result === false) return;
        close(true);
      } catch (e) {
        errEl.textContent = e.message || '保存失败';
      }
    };

    root.appendChild(overlay);
    const first = overlay.querySelector('input, textarea, select');
    if (first) setTimeout(() => first.focus(), 0);
  });
}
