// 工作台页面外观（主题）模块
// - THEMES：预置配色定义（桃夭 / 白色 / 黄色 / 蓝色 / 奶油色 / 国风系列）
// - applyTheme()：将某主题的 CSS 变量应用到目标元素（默认 body）
// 模块为纯逻辑 + 对外暴露 applyTheme 的 DOM 调用，Node 下可独立测试 THEMES。
export const THEME_DEFAULT = 'peach';

// 各主题下覆盖的 CSS 变量。未列出的变量沿用全局默认（桃夭即全局默认值）。
const VARIABLE_KEYS = [
  '--accent',
  '--accent-dark',
  '--border',
  '--bg',
  '--panel',
  '--text',
  '--text-soft',
  '--gray-light',
  '--nav-active',
];

export const THEMES = {
  peach: {
    label: '桃夭',
    swatch: '#e58aa0',
    desc: '桃之夭夭',
    vars: {
      '--accent': '#c25b72',
      '--accent-dark': '#a8455c',
      '--border': '#f0d8de',
      '--bg': '#fdf6f5',
      '--panel': '#fffcfc',
      '--text': '#3f2a31',
      '--text-soft': '#8a6a74',
      '--gray-light': '#f9edef',
      '--nav-active': '#fbe6eb',
    },
  },
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
      '--nav-active': '#eef1fe',
    },
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
      '--nav-active': '#fef3c7',
    },
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
      '--nav-active': '#dbeafe',
    },
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
      '--nav-active': '#f0e6cf',
    },
  },
  // ---------- 国风系列 ----------
  chineseRed: {
    label: '中国红',
    swatch: '#C41E3A',
    desc: '喜庆祥瑞',
    vars: {
      '--accent': '#C41E3A',
      '--accent-dark': '#A01830',
      '--border': '#F5D0D0',
      '--bg': '#FFF5F5',
      '--panel': '#FFFFFF',
      '--text': '#3C1018',
      '--text-soft': '#8B3A4A',
      '--gray-light': '#FDE8E8',
      '--nav-active': '#FDE8E8',
    },
  },
  celadon: {
    label: '青瓷',
    swatch: '#5F9EA0',
    desc: '温润如玉',
    vars: {
      '--accent': '#5F9EA0',
      '--accent-dark': '#4A7A7C',
      '--border': '#C8E6E8',
      '--bg': '#F0F8F8',
      '--panel': '#FFFFFF',
      '--text': '#1A3C3E',
      '--text-soft': '#5A8A8C',
      '--gray-light': '#E0F0F0',
      '--nav-active': '#E0F0F0',
    },
  },
  inkCharm: {
    label: '墨韵',
    swatch: '#4A4A4A',
    desc: '水墨丹青',
    vars: {
      '--accent': '#4A4A4A',
      '--accent-dark': '#2C2C2C',
      '--border': '#D8D8D0',
      '--bg': '#F5F5F0',
      '--panel': '#FEFEFE',
      '--text': '#1C1C1C',
      '--text-soft': '#6B6B6B',
      '--gray-light': '#EAEAE5',
      '--nav-active': '#EAEAE5',
    },
  },
  glazed: {
    label: '琉璃',
    swatch: '#2E5A88',
    desc: '宫殿华彩',
    vars: {
      '--accent': '#2E5A88',
      '--accent-dark': '#1E4A78',
      '--border': '#C8D8E8',
      '--bg': '#F0F4F8',
      '--panel': '#FFFFFF',
      '--text': '#1A2A3C',
      '--text-soft': '#4A6A8A',
      '--gray-light': '#E0E8F0',
      '--nav-active': '#E0E8F0',
    },
  },
  bamboo: {
    label: '竹青',
    swatch: '#6B8E23',
    desc: '清雅自然',
    vars: {
      '--accent': '#6B8E23',
      '--accent-dark': '#556B2F',
      '--border': '#D0E0C8',
      '--bg': '#F5F8F0',
      '--panel': '#FFFFFF',
      '--text': '#2A3C1A',
      '--text-soft': '#5A7A4A',
      '--gray-light': '#E8F0E0',
      '--nav-active': '#E8F0E0',
    },
  },
  lotus: {
    label: '藕荷',
    swatch: '#9E7B9E',
    desc: '淡雅脱俗',
    vars: {
      '--accent': '#9E7B9E',
      '--accent-dark': '#7A5A7A',
      '--border': '#E0D0E0',
      '--bg': '#F8F0F8',
      '--panel': '#FFFFFF',
      '--text': '#3C2A3C',
      '--text-soft': '#7A5A7A',
      '--gray-light': '#F0E8F0',
      '--nav-active': '#F0E8F0',
    },
  },
  jade: {
    label: '脂玉',
    swatch: '#D4A574',
    desc: '温柔如玉',
    vars: {
      '--accent': '#C4956A',
      '--accent-dark': '#A67D5A',
      '--border': '#E8D8C8',
      '--bg': '#FDF8F4',
      '--panel': '#FFFBF8',
      '--text': '#4A3828',
      '--text-soft': '#8A7458',
      '--gray-light': '#F5EDE4',
      '--nav-active': '#F5EDE4',
    },
  },
  skyBlue: {
    label: '天青',
    swatch: '#7EB8C9',
    desc: '清雅怡然',
    vars: {
      '--accent': '#6BA8B8',
      '--accent-dark': '#5890A0',
      '--border': '#C4E0E8',
      '--bg': '#F2F8FA',
      '--panel': '#FFFFFF',
      '--text': '#1A3840',
      '--text-soft': '#4A7888',
      '--gray-light': '#E0F0F4',
      '--nav-active': '#E0F0F4',
    },
  },
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

// 给定主题名，返回主题实际要写入的 CSS 变量映射（合并全局:root 默认）
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
