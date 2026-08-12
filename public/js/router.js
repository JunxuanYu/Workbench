// hash 路由：切换页面 + 导航高亮
import { render as home } from './pages/home.js';
import { render as today } from './pages/today.js';
import { render as dev } from './pages/dev.js';
import { render as consult } from './pages/consult.js';
import { render as diet } from './pages/diet.js';
import { render as money } from './pages/money.js';
import { render as settings } from './pages/settings.js';

const routes = { home, today, dev, consult, diet, money, settings };
let currentKey = null;

export function initRouter() {
  window.addEventListener('hashchange', render);
  render();
}

export function navigate(hash) {
  if (window.location.hash === `#${hash}`) render();
  else window.location.hash = hash;
}

export function currentRoute() { return currentKey; }

export async function render() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const key = routes[hash] ? hash : 'home';
  currentKey = key;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.route === key);
  });
  const app = document.getElementById('app');
  app.innerHTML = '';
  await routes[key](app);
}
