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
function makeCtx(log, REG) {
  const services = new Map();
  // 预置桩服务：让插件的 waitService/waitFor 真正命中 ⇒ 走到注册路径（否则断言空转）
  services.set('shinkiViews', {
    CONTRACT_VERSION: 2,
    register: (spec) => { REG.push({ api: 'views', opts: spec || {} }); return { dispose() {} }; },
    openPopup: () => {}, openPopupWindow: () => {}, popupables: () => [], list: () => [], forms: () => ['bottom', 'popup', 'mainView'],
    lifecycle: { register: () => ({ dispose() {} }), dispatch: () => {}, policies: () => [], keys: () => [] },
  });
  services.set('betterSidebar', {
    registerTab: (opts) => { REG.push({ api: 'betterSidebar', opts: opts || {} }); return () => {}; },
    updateTab: () => {}, getSnapshot: () => ({ prefs: { pluginSettings: {} } }),
  });
  services.set('sidebarRightTabs', { register: (def) => { REG.push({ api: 'tabs', opts: def || {} }); return () => {}; }, entries: () => [] });
  services.set('sidebarRight', { openTab: () => {}, openTabIn: () => {} });
  services.set('locale', { register: () => {}, subscribe: () => () => {}, t: (k) => k, locale: 'zh-CN' });
  const ctx = {
    get: (n) => services.get(n),
    provide: (n, v) => { services.set(n, v); return v; },
    effect: (f) => { try { const d = (typeof f === 'function') ? f() : undefined; if (typeof d === 'function') d(); } catch (e) { log.push('effect 回调抛错: ' + (e && e.message)); } },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    locale: { register: () => {}, subscribe: () => () => {}, t: (k) => k, locale: 'zh-CN' },
    slots: {
      register: (opts, comp) => { REG.push({ api: 'slots', opts: opts || {}, comp }); return () => {}; },
      inject: (name, cb) => { try { cb(); } catch (e) { log.push('slots.inject 回调抛错: ' + (e && e.message)); } return () => {}; },
      entries: () => [], subscribe: () => () => {},
    },
    sidebarRightTabs: { register: (def) => { REG.push({ api: 'tabs', opts: def || {} }); return () => {}; } },
    sidebarRight: { openTab: () => {}, openTabIn: () => {} },
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
  const REG = [];
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
    const ctx = makeCtx(log, REG);
    exportsObj.apply(ctx);
    // ── 断言：契约检查（护栏升级）──
    const problems = [];
    for (const r of REG) {
      if (r.api === 'views') {
        if (!r.opts.id) problems.push('shinkiViews.register 缺 id');
        if (typeof r.opts.render !== 'function') problems.push('shinkiViews.register 缺 render 函数（' + (r.opts.id || '?') + '）');
        if (!Array.isArray(r.opts.targets) || !r.opts.targets.length) problems.push('shinkiViews.register 缺 targets（' + (r.opts.id || '?') + '）');
      }
      if (r.api === 'betterSidebar') {
        const o = r.opts;
        if (!o.id) problems.push('betterSidebar.registerTab 缺 id');
        if (o.title != null && typeof o.title !== 'function' && typeof o.title !== 'string') problems.push('registerTab 的 title 类型可疑（' + o.id + '）');
      }
      if (r.api === 'slots' && r.opts.name === 'sidebar.right.pane.tab') {
        if (typeof r.opts.title !== 'function') problems.push('sidebar.right.pane.tab 槽位条目缺少 title() 函数（官方渲染器会调用 entry.title()，缺则整个 pane 崩溃）');
      }
      if (r.api === 'tabs') {
        if (r.opts.title != null && typeof r.opts.title !== 'function' && typeof r.opts.title !== 'string') problems.push('sidebarRightTabs.register 的 title 既非函数也非字符串');
        if (r.opts.guide != null && !Array.isArray(r.opts.guide)) problems.push('sidebarRightTabs.register 的 guide 必须是数组');
        if (Array.isArray(r.opts.guide)) for (const g of r.opts.guide) {
          if (!g || typeof g !== 'object' || !g.id || g.title == null) problems.push('guide 条目缺 id/title');
        }
      }
    }
    if (problems.length) { failed++; console.log(`  ❌ ${name}: 契约断言失败 → ` + problems.join('；')); continue; }
    console.log(`  ✅ ${name}: 加载 + apply 成功 + 契约断言通过（注册 ${REG.length} 项）${log.length ? '（' + log.length + ' 条日志）' : ''}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e && e.message}`);
    if (log.length) console.log('     ' + log.slice(0, 3).join('\n     '));
  }
}
process.exit(failed ? 1 : 0);
