// 工作台页面外观（主题）模块
// - THEMES：预置配色定义（白色 / 黄色 / 蓝色 / 奶油色）
// - applyTheme()：将某主题的 CSS 变量应用到目标元素（默认 body）
// 模块为纯逻辑 + 对外暴露 applyTheme 的 DOM 调用，Node 下可独立测试 THEMES。
export const THEME_DEFAULT = 'white';

// 各主题下覆盖的 CSS 变量。未列出的变量沿用全局默认（白色主题即全局默认值）。
const VARIABLE_KEYS = ['--accent', '--accent-dark', '--border', '--bg', '--panel', '--text', '--text-soft', '--gray-light', '--nav-active'];

export const THEMES = {
  white: {
    label: '白色',
    swatch: '#ffffff',
    desc: '明亮清爽',
    vars: {
      '--accent': '#4a6cf7',
      '--accent-dark': '#3b5bdb',
      '--border': '#e5e7eb',
      '--bg': '#f7f8fa',
      '--panel': '#ffffff',
      '--text': '#1f2937',
      '--text-soft': '#6b7280',
      '--gray-light': '#f3f4f6',
      '--nav-active': '#eef1fe'
    }
  },
  yellow: {
    label: '黄色',
    swatch: '#f59e0b',
    desc: '温暖活力',
    vars: {
      '--accent': '#d97706',
      '--accent-dark': '#b45309',
      '--border': '#fde68a',
      '--bg': '#fffbeb',
      '--panel': '#fffdf5',
      '--text': '#422006',
      '--text-soft': '#92400e',
      '--gray-light': '#fef3c7',
      '--nav-active': '#fef3c7'
    }
  },
  blue: {
    label: '蓝色',
    swatch: '#2563eb',
    desc: '沉静专注',
    vars: {
      '--accent': '#1d4ed8',
      '--accent-dark': '#1e40af',
      '--border': '#bfdbfe',
      '--bg': '#eff6ff',
      '--panel': '#ffffff',
      '--text': '#172554',
      '--text-soft': '#3b5bdb',
      '--gray-light': '#dbeafe',
      '--nav-active': '#dbeafe'
    }
  },
  cream: {
    label: '奶油色',
    swatch: '#f5e6c8',
    desc: '柔和温馨',
    vars: {
      '--accent': '#b5852f',
      '--accent-dark': '#96701f',
      '--border': '#e8d8b5',
      '--bg': '#faf3e3',
      '--panel': '#fefbf3',
      '--text': '#4a3f2b',
      '--text-soft': '#8a7a5c',
      '--gray-light': '#f0e6cf',
      '--nav-active': '#f0e6cf'
    }
  }
};

// 供 tests 引用的变量键清单（保证四套主题键一致）
export const THEME_VARIABLE_KEYS = VARIABLE_KEYS;

// 主题键白名单（用于数据校验）
export function isThemeKey(key) {
  return Object.prototype.hasOwnProperty.call(THEMES, key);
}

// 规范化主题键：非法值回退到默认
export function normalizeTheme(key) {
  return isThemeKey(key) ? key : THEME_DEFAULT;
}

// 给定元素元素变量名，返回主题实际要写入的 CSS 变量映射（合并全局:root 默认）
export function themeVars(name) {
  const t = THEMES[normalizeTheme(name)];
  return t ? t.vars : {};
}

// 将主题应用到元素（默认 document.body）。el 为 null 时静默跳过（Node 测试环境无 DOM）。
export function applyTheme(el, name) {
  const normalized = normalizeTheme(name);
  const vars = themeVars(normalized);
  if (!el || typeof el.style === 'undefined') return normalized;
  // 清除旧主题变量，再写入目标主题，避免残留
  for (const k of VARIABLE_KEYS) el.style.removeProperty(k);
  for (const k of VARIABLE_KEYS) {
    if (vars[k]) el.style.setProperty(k, vars[k]);
  }
  if (el.dataset) el.dataset.theme = normalized;
  return normalized;
}
