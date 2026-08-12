// 日期导航条：day 模式 ◀ 8月11日 周二 ▶ [回到今天]；month 模式 ◀ 2026年8月 ▶
import { formatDate, formatMonth, todayStr, addDays, addMonths } from '../logic.js';

export function dateNav({ mode = 'day', value, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'date-nav';

  const label = document.createElement('button');
  label.className = 'date-nav-label';
  const picker = document.createElement('input');
  picker.type = 'date';
  picker.value = value;
  picker.style.display = 'none';
  picker.onchange = () => {
    if (!picker.value) return;
    value = picker.value;
    refresh();
    onChange(value);
  };
  label.onclick = () => {
    if (picker.showPicker) picker.showPicker(); else picker.click();
  };

  const btn = (txt, fn) => {
    const b = document.createElement('button');
    b.className = 'btn btn-plain btn-sm';
    b.textContent = txt;
    b.onclick = fn;
    return b;
  };

  const refresh = () => {
    label.textContent = mode === 'day' ? formatDate(value) : formatMonth(value);
    picker.value = value;
  };
  refresh();

  wrap.append(
    btn('◀', () => { value = mode === 'day' ? addDays(value, -1) : addMonths(value, -1); refresh(); onChange(value); }),
    label,
    picker,
    btn('▶', () => { value = mode === 'day' ? addDays(value, 1) : addMonths(value, 1); refresh(); onChange(value); })
  );
  if (mode === 'day' && value !== todayStr()) {
    wrap.append(btn('回到今天', () => { value = todayStr(); refresh(); onChange(value); }));
  }
  return wrap;
}
