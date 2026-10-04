/**
 * 插件客户端 bundle 冒烟测试（护栏）：
 * 用桩环境（window/ModuleLoader/react/document/ctx）**真实加载** bundle 并调用 apply，
 * 捕获 node --check 查不到的**运行时**错误（作用域、时序、TDZ、未定义变量…）。
 * 用法：node smoke-client.mjs <client.js> [<client.js> ...]
 */
import fs from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) { console.error('用法: node smoke-client.mjs <client.js> ...'); process.exit(2); }

function stubEl() {
  const el = {
    style: {}, dataset: {}, children: [], classList: { add() {}, remove() {}, contains: () => false },
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, remove() {},
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    focus() {}, click() {}, insertBefore() {},
  };
  return el;
}
function makeReact() {
  const createElement = (type, props, ...kids) => ({ type, props: props || {}, kids });
  return { createElement, useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {}, useLayoutEffect: () => {}, useRef: (v) => ({ current: v }),
    useMemo: (f) => (typeof f === 'function' ? f() : undefined), useCallback: (f) => f,
    Fragment: 'Fragment', createContext: () => ({ Provider: 'P', Consumer: 'C' }), forwardRef: (f) => f };
}
function makeCtx(log) {
  const services = new Map();
  const ctx = {
    get: (n) => services.get(n),
    provide: (n, v) => { services.set(n, v); return v; },
    effect: (f) => { try { const d = (typeof f === 'function') ? f() : undefined; if (typeof d === 'function') d(); } catch (e) { log.push('effect 回调抛错: ' + (e && e.message)); } },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    locale: { register: () => {}, subscribe: () => () => {}, t: (k) => k, locale: 'zh-CN' },
    slots: { register: () => () => {}, inject: () => () => {}, entries: () => [], subscribe: () => () => {} },
    on: () => {}, emit: () => {},
  };
  return ctx;
}

let failed = 0;
const win = {
  addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  location: { origin: 'http://127.0.0.1:0', search: '', hash: '' },
  __ModuleLoader__: { load(def) { win.__loaded = def; } },
};
const doc = {
  createElement: () => stubEl(), createTextNode: () => stubEl(),
  documentElement: stubEl(), body: stubEl(), head: stubEl(),
  addEventListener() {}, removeEventListener() {}, getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [],
  currentScript: null, title: '',
};

for (const file of files) {
  const log = [];
  const name = file.split('/').slice(-3, -2)[0] || file;
  try {
    const code = fs.readFileSync(file, 'utf8');
    delete win.__loaded;
    const requireStub = (n) => {
      if (n === 'react') return makeReact();
      if (n === 'react-dom') return { render: () => {}, createRoot: () => ({ render: () => {} }) };
      if (n === 'react-dom/client') return { createRoot: () => ({ render: () => {} }) };
      throw new Error('未桩化的模块: ' + n);
    };
    const fn = new Function('window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'location', 'localStorage', 'navigator', 'Audio', 'URL', 'Blob', 'MutationObserver', 'Event', 'Node', 'requestAnimationFrame',
      'require', code + '\nreturn window.__loaded;');
    const def = fn(win, doc, { warn: (...a) => log.push(a.join(' ')), log: () => {}, info: () => {}, error: (...a) => log.push('ERR ' + a.join(' ')), debug: () => {} },
      setTimeout, clearTimeout, setInterval, clearInterval, win.location,
      { getItem: () => null, setItem: () => {}, removeItem: () => {} }, { language: 'zh-CN', userAgent: 'smoke' },
      function Audio() { return { play: () => Promise.resolve(), pause() {}, addEventListener() {}, removeEventListener() {}, load() {}, currentTime: 0, duration: 0, paused: true, volume: 1, src: '' }; },
      URL, function Blob() {}, function MutationObserver() { return { observe() {}, disconnect() {} }; }, function Event() {}, function Node() {},
      (cb) => setTimeout(cb, 0), requireStub);
    if (!def || typeof def.factory !== 'function') throw new Error('未捕获到 ModuleLoader.load 定义');
    const exportsObj = def.factory(requireStub);
    if (typeof exportsObj.apply !== 'function') { console.log(`  ⚠️ ${name}: 无 apply（跳过调用）`); continue; }
    const ctx = makeCtx(log);
    exportsObj.apply(ctx);
    console.log(`  ✅ ${name}: 加载 + apply 成功${log.length ? '（' + log.length + ' 条日志）' : ''}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e && e.message}`);
    if (log.length) console.log('     ' + log.slice(0, 3).join('\n     '));
  }
}
process.exit(failed ? 1 : 0);
