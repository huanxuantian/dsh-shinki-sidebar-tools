/**
 * 授权浮层（client）行为自检：真实加载 client bundle，用桩 DOM 观察右下角浮层。
 *
 * 锁定用户 2026-10-26 反馈的三条：
 *   1) 当前会话的审批不弹（聊天里已有审批 UI）；
 *   2) 页面加载前的历史条目不再弹；
 *   3) 同一 id 不重复弹，且已展示 id 落到 localStorage（刷新后不再弹）。
 *
 * 用法：node tools/verify-toast-client.mjs
 */
import fs from 'node:fs';

const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

let failed = 0;
const ok = (cond, name, extra) => {
  if (cond) { console.log('  ✅ ' + name); return; }
  failed += 1;
  console.log('  ❌ ' + name + (extra ? ' → ' + extra : ''));
};

function stubEl(tag = 'div') {
  const el = {
    tagName: tag, style: {}, dataset: {}, children: [], parentNode: null,
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    contains(n) { return n === el || el.children.includes(n); },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    focus() {}, click() {}, insertBefore() {},
  };
  return el;
}

const react = {
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {}, useLayoutEffect: () => {}, useRef: (v) => ({ current: v }),
  useMemo: (f) => (typeof f === 'function' ? f() : undefined), useCallback: (f) => f,
  Fragment: 'Fragment', createContext: () => ({ Provider: 'P', Consumer: 'C' }), forwardRef: (f) => f,
  Component: class { constructor(p) { this.props = p || {}; this.state = {}; } },
};

function loadBundle() {
  const win = {
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: { origin: 'http://127.0.0.1:0', search: '', hash: '' },
    innerWidth: 1200, innerHeight: 800,
    __ModuleLoader__: { load(def) { win.__loaded = def; } },
  };
  const body = stubEl('body');
  const doc = {
    createElement: (t) => stubEl(t), createTextNode: () => stubEl('#text'),
    documentElement: stubEl('html'), body, head: stubEl('head'),
    addEventListener() {}, removeEventListener() {}, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [], title: '',
  };
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const requireStub = (n) => {
    if (n === 'react') return react;
    if (n === 'react-dom') return { render: () => {}, createRoot: () => ({ render: () => {} }) };
    if (n === 'react-dom/client') return { createRoot: () => ({ render: () => {} }) };
    throw new Error('未桩化的模块: ' + n);
  };
  const fn = new Function('window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'location', 'localStorage', 'navigator', 'Audio', 'URL', 'Blob', 'MutationObserver', 'Event', 'Node', 'requestAnimationFrame',
    'require', code + '\nreturn window.__loaded;');
  const def = fn(win, doc, { warn() {}, log() {}, info() {}, error() {}, debug() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, win.location, localStorage,
    { language: 'zh-CN', userAgent: 'test' },
    function Audio() { return {}; }, URL, function Blob() {},
    function MutationObserver() { return { observe() {}, disconnect() {} }; },
    function Event() {}, function Node() {}, (cb) => setTimeout(cb, 0), requireStub);
  return { win, doc, body, store, mod: def.factory(requireStub) };
}

function ctxFor() {
  const services = new Map();
  services.set('uiSession', { current: { getSnapshot: () => ({ key: 'session-A' }) } });
  services.set('slots', { register: () => () => {}, inject: () => () => {} });
  services.set('locale', { register() {}, t: (k) => k, locale: 'zh-CN' });
  services.set('sidebarRightTabs', { register: () => () => {}, entries: () => [] });
  services.set('sidebarRight', { openTab() {}, openTabIn() {} });
  const ctx = {
    get: (n) => services.get(n), provide: (n, v) => { services.set(n, v); return v; },
    effect: (f) => { try { const d = f(); if (typeof d === 'function') d(); } catch { /* ignore */ } },
    logger: { info() {}, warn() {}, error() {} },
    slots: services.get('slots'),
    locale: { register() {}, t: (k) => k, locale: 'zh-CN' },
    on() {}, emit() {},
  };
  return { ctx, services };
}

const feed = { items: [] };
const answered = new Set();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/shinki-sidebar-tools/toast-config')) {
    return { ok: true, json: async () => ({ ok: true, config: { enabled: true, maxVisible: 3, dwellMs: 60000 } }) };
  }
  if (u.includes('/shinki-sidebar-tools/approvals')) {
    return { ok: true, json: async () => ({ ok: true, items: feed.items.slice() }) };
  }
  return { ok: false, json: async () => ({ ok: false }) };
};

const { body, store, mod } = loadBundle();
// 安装前就带一条"已展示"记录：刷新后不应再弹（模拟用户已点过查看）
store.set('dsh-shinki-toast:seen:v1', JSON.stringify(['seen-1']));
const { ctx } = ctxFor();
mod.apply(ctx);

const rootChildren = () => {
  const root = body.children.find((c) => c.id === 'shinki-toast-root');
  return root ? root.children.length : 0;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // 第一轮：当前会话 + 已展示 + 历史 + 一条其它会话
  const now = Date.now();
  feed.items = [
    { id: 'cur-1', sessionId: 'session-A', toolName: 'pwsh', reason: '当前会话', at: now },
    { id: 'seen-1', sessionId: 'session-B', toolName: 'pwsh', reason: '已看过', at: now },
    { id: 'old-1', sessionId: 'session-B', toolName: 'pwsh', reason: '历史', at: now - 60_000 },
    { id: 'other-1', sessionId: 'session-B', toolName: 'pwsh', reason: '其它会话', at: now },
  ];
  await wait(2300);
  ok(rootChildren() === 1, '当前会话/已展示/历史 都不弹，只弹其它会话 1 条', 'toasts=' + rootChildren());

  // 第二轮：同一条重复下发 + 新一条
  feed.items = feed.items.concat(feed.items.filter((x) => x.id === 'other-1'));
  await wait(2300);
  ok(rootChildren() === 1, '同一 id 重复下发不重复弹', 'toasts=' + rootChildren());

  // 第三轮：再来一条其它会话（上限 3）
  feed.items = feed.items.concat([{ id: 'other-2', sessionId: 'session-B', toolName: 'write', reason: '另一条', at: Date.now() }]);
  await wait(2300);
  ok(rootChildren() === 2, '另一条新审批正常弹（最多 maxVisible）', 'toasts=' + rootChildren());

  // 已展示 id 持久化
  const seenRaw = store.get('dsh-shinki-toast:seen:v1') || '[]';
  const seen = new Set(JSON.parse(seenRaw));
  for (const id of ['cur-1', 'seen-1', 'old-1', 'other-1', 'other-2']) {
    ok(seen.has(id), '已展示 id 写入 localStorage：' + id);
  }
  void answered;
} finally {
  globalThis.fetch = realFetch;
}

console.log(failed ? `\n❌ ${failed} 项失败` : '\n✅ 全部通过');
process.exit(failed ? 1 : 0);
