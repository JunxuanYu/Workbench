// WorkLift ESLint flat config（ESLint 9+）
// - server.js / test/**：Node ESM 环境
// - public/**：浏览器 ESM 环境（原生模块，无构建器）
// - 规则与 Prettier 兼容（eslint-config-prettier 关闭冲突的格式规则）
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/**', '.venv/**', '*.log', 'docs/**', 'doc/**'] },
  js.configs.recommended,
  prettier,
  {
    files: ['server.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
    },
  },
];
