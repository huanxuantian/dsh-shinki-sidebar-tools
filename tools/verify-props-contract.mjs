/**
 * 行为验证（不是语法检查）：真实加载 client.js，在桩 DOM/React 里跑两条承载路径，
 * 断言 ① 两路径拿到的 props 形状包含同一组契约字段；② 首激活后面板不是 display:none；
 *      ③ close() 不再绕过 React 抽掉 root 容器；④ setTitle 真的改了标题。
 * 用法：node verify-props-contract.mjs [client.js]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = [
  process.argv[2],
  path.join(here, '..', 'lib', 'client.js'),      // 放在插件 tools/ 下
  path.join(here, 'lib', 'client.js'),            // 放在插件根下
  '/Users/huanxuantian/work/AI/dsh-plugin/dsh-shinki-sidebar-tools/lib/client.js',
].filter(Boolean).find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!FILE) { console.error('找不到 client.js；用法：node verify-props-contract.mjs [client.js]'); process.exit(2); }
console.log('被测文件：' + FILE);

let failed = 0;
const ok = (cond, msg, extra) => {
  if (cond) console.log('  ✅ ' + msg);
  else { failed++; console.log('  ❌ ' + msg + (extra ? ' → ' + JSON.stringify(extra) : '')); }
};

/* ── 桩 DOM ─────────────────────────────────────────────────────────────── */
function mkStyle() {
  const s = {
    setProperty(k, v) { s[k] = v; },
    getPropertyValue(k) { return s[k] || ''; },
  };
  return s;
}
function matchSel(el, sel) {
  const s = String(sel).trim();
  if (s === '*') return true;      // 通配（插件用它遍历宿主后代）
  let m = s.match(/^([a-zA-Z]*)(?:\[([^\]=]+)(?:="([^"]*)")?\])?$/);
  if (!m) return false;
  const [, tag, attr, val] = m;
  if (tag && (el.tagName || '').toLowerCase() !== tag.toLowerCase()) return false;
  if (attr) { const v = el.__attrs ? el.__attrs[attr] : undefined; if (v === undefined) return false; if (val !== undefined && String(v) !== val) return false; }
  return true;
}
function mkEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(), __tag: tag, children: [], parentElement: null,
    style: mkStyle(), dataset: {}, __attrs: {}, __listeners: {}, replaceChildrenCalls: 0,
    isConnected: true, scrollHeight: 0, clientHeight: 0, scrollLeft: 0,
    get scrollTop() { return this.__st || 0; },
    set scrollTop(v) { const max = Math.max(0, (this.scrollHeight || 0) - (this.clientHeight || 0)); this.__st = Math.max(0, Math.min(max, Number(v) || 0)); },
    appendChild(c) { this.children.push(c); if (c) c.parentElement = this; return c; },
    insertBefore(c, ref) { const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); if (c) c.parentElement = this; return c; },
    replaceChildren() { this.replaceChildrenCalls += 1; this.children = []; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() { if (this.parentElement) this.parentElement.removeChild(this); this.isConnected = false; },
    contains(n) { for (let x = n; x; x = x.parentElement) { if (x === this) return true; } return false; },
    setAttribute(k, v) { this.__attrs[k] = String(v); },
    getAttribute(k) { return this.__attrs[k] === undefined ? null : this.__attrs[k]; },
    removeAttribute(k) { delete this.__attrs[k]; },
    addEventListener(t, f) { (this.__listeners[t] = this.__listeners[t] || []).push(f); },
    removeEventListener() {}, dispatchEvent() {}, focus() {}, click() {}, closest: () => null,
    querySelector(sel) { const o = this._q(sel, false); return o; },
    querySelectorAll(sel) { return this._q(sel, true); },
    _q(sel, all) { const out = []; const m = (el) => { if (matchSel(el, sel)) out.push(el); for (const k of (el.children || [])) m(k); }; for (const k of (this.children || [])) m(k); return all ? out : (out[0] || null); },
    getBoundingClientRect: () => ({ left: 100, right: 900, top: 0, bottom: 700, width: 800, height: 700 }),
  };
  return el;
}
let columnAvailable = true;      // 置 false 模拟"列尚未出现/解析不到"
const gcs = (el) => ({
  display: (el && el.__display) || 'flex',
  flexDirection: (el && el.__flexDirection) || 'column',
  flexWrap: 'nowrap',
  overflowY: (el && el.__overflowY) || 'auto',
  overflowX: 'hidden',
});
/* 一个"真的在滚动"的容器：让位只应该加在它（和会话列）上，绝不该加给 body/<html>/#root */
const scroller = mkEl('div');
scroller.__overflowY = 'auto';
scroller.scrollHeight = 500;
scroller.clientHeight = 200;
const byId = new Map();
const column = mkEl('div');
const colParent = mkEl('div');
column.classList = { add() {}, remove() {}, contains: () => false };
colParent.appendChild(column);
const body = mkEl('body');
const docEl = mkEl('html');
const docListeners = {};
const doc = {
  createElement: (t) => mkEl(t), createTextNode: () => mkEl('#text'),
  documentElement: docEl, body, head: mkEl('head'),
  addEventListener(t, f, c) { (docListeners[t] = docListeners[t] || []).push({ f, c }); },
  removeEventListener(t, f) { if (docListeners[t]) docListeners[t] = docListeners[t].filter((x) => x.f !== f); },
  getElementById: (id) => byId.get(id) || null,
  querySelector: (sel) => ((columnAvailable && String(sel).includes('data-slot="main.conversation"')) ? column : null),
  querySelectorAll: (sel) => (String(sel).indexOf('div,section,main') >= 0 ? [scroller] : []),
  currentScript: null, title: '',
};
const winListeners = {};
const win = {
  addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
  removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  location: { origin: 'http://127.0.0.1:0', search: '', hash: '' },
  getComputedStyle: gcs,
  __ModuleLoader__: { load(def) { win.__loaded = def; } },
};

/* ── 桩 React / ReactDOM ────────────────────────────────────────────────── */
const ROOTS = [];
const react = {
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {}, useLayoutEffect: () => {}, useRef: (v) => ({ current: v }),
  useMemo: (f) => (typeof f === 'function' ? f() : undefined), useCallback: (f) => f,
  Fragment: 'Fragment', createContext: () => ({ Provider: 'P', Consumer: 'C' }), forwardRef: (f) => f,
  Component: class { constructor(props) { this.props = props || {}; this.state = {}; } setState(s) { this.state = Object.assign({}, this.state, s || {}); } },
};
/** 执行「被错误边界包住」的视图组件（跳过边界这一层，等价于 React 正常渲染它） */
function runView(el) {
  let target = el;
  // 桩 createElement 把子元素放在 kids 里（不是 props.children）
  while (target && target.kids && target.kids.length === 1 && target.kids[0] && target.kids[0].type) target = target.kids[0];
  if (!target || typeof target.type !== 'function') throw new Error('挂载树结构不符合预期');
  return target.type(target.props);
}
const reactDom = {
  createPortal: (child, node) => ({ __portal: true, child, node }),
  render: () => {},
  createRoot: (host) => { const r = { host, renders: [], render(n) { this.renders.push(n); this.node = n; }, unmount() { this.unmounted = (this.unmounted || 0) + 1; } }; ROOTS.push(r); return r; },
};
const requireStub = (n) => {
  if (n === 'react') return react;
  if (n === 'react-dom') return reactDom;
  if (n === 'react-dom/client') return { createRoot: reactDom.createRoot };
  throw new Error('未桩化的模块: ' + n);
};

const viewSpecsDump = {};   // 记录注册过的视图标题（供会话测试打印）
const fireDoc = (t, ev) => { (docListeners[t] || []).slice().forEach((x) => { try { x.f(ev); } catch (e) { /* 忽略 */ } }); };
/* ★ 假定时器：只手动 flush「到期时间 <= maxMs」的回调。
   以前这里把 setTimeout 传成了 no-op（`() => 0`）⇒ 插件里所有延迟逻辑（如下拉的"点外面收起"监听注册）
   根本没执行，相关断言是**虚过**的。 */
const timers = [];
let timerSeq = 0;
const fakeSetTimeout = (fn, ms) => { timers.push({ id: ++timerSeq, fn, ms: Number(ms) || 0 }); return timerSeq; };
const fakeClearTimeout = (id) => { for (let i = timers.length - 1; i >= 0; i--) if (timers[i].id === id) timers.splice(i, 1); };
const flushTimers = (maxMs = 0) => {
  const keep = [];
  for (let guard = 0; timers.length && guard < 500; guard++) {
    const t = timers.shift();
    if ((t.ms || 0) > maxMs) { keep.push(t); continue; }
    try { t.fn(); } catch (e) { /* 忽略 */ }
  }
  for (const t of keep) timers.push(t);
};
const tick = () => flushTimers(0);
const flushTimersAt = (ms) => { const keep = []; for (let i = 0, n = timers.length; i < n; i++) { const t = timers.shift(); if ((t.ms || 0) === ms) { try { t.fn(); } catch (e) { /* 忽略 */ } } else keep.push(t); } for (const t of keep) timers.push(t); };
const walkFind = (el, fn) => { if (!el) return null; if (fn(el)) return el; for (const k of (el.children || [])) { const h = walkFind(k, fn); if (h) return h; } return null; };

/* ── 桩 ctx ─────────────────────────────────────────────────────────────── */
const REG = { slots: [], tabs: [], views: [], better: [] };
/* 会话（uiSession）：可订阅的 binding source，key 可切换 —— 用来测"状态跟着会话走" */
const sessionSrc = {
  key: 'sess-A',
  subs: [],
  getSnapshot() { return { key: sessionSrc.key }; },
  subscribe(f) { sessionSrc.subs.push(f); return () => {}; },
};
const makeStore = () => ({ m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } });
const sessionStore = makeStore();
const localStore = makeStore();
const setSession = (k) => { sessionSrc.key = k; sessionSrc.subs.slice().forEach((f) => { try { f(); } catch (e) { /* 忽略 */ } }); };

const services = new Map();
services.set('uiSession', { adapter: { current: sessionSrc }, current: sessionSrc });
services.set('sidebarRightTabs', { register: (d) => { REG.tabs.push(d); return () => {}; }, entries: () => [] });
services.set('sidebarRight', { openTab: () => {}, openTabIn: () => {} });
services.set('slots', {
  register: (opts, comp) => { REG.slots.push({ opts: opts || {}, comp }); return () => {}; },
  inject: (name, cb) => { try { cb(); } catch (e) { console.log('  ⚠️ slots.inject 抛错：' + e.message); } return () => {}; },
  entries: () => [], subscribe: () => () => {},
});
services.set('locale', { register: () => {}, subscribe: () => () => {}, t: (k) => k, locale: 'zh-CN' });
const ctx = {
  get: (n) => services.get(n),
  provide: (n, v) => { services.set(n, v); return v; },
  effect: () => {}, on: () => {}, emit: () => {},
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  locale: services.get('locale'),
  slots: services.get('slots'),
};

/* ── 加载 bundle 并 apply ───────────────────────────────────────────────── */
const logs = [];
const code = fs.readFileSync(FILE, 'utf8');
const fn = new Function('window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'location', 'localStorage', 'sessionStorage', 'navigator', 'Audio', 'URL', 'Blob', 'MutationObserver', 'Event', 'Node',
  'requestAnimationFrame', 'getComputedStyle', 'require', code + '\nreturn window.__loaded;');
const def = fn(win, doc,
  { warn: (...a) => logs.push(a.join(' ')), log: () => {}, info: () => {}, error: (...a) => logs.push('ERR ' + a.join(' ')), debug: () => {} },
  fakeSetTimeout, fakeClearTimeout, () => 0, () => {}, win.location,
  localStore, sessionStore, { language: 'zh-CN', userAgent: 'verify' },
  function Audio() { return {}; }, URL, function Blob() {}, function MutationObserver() { return { observe() {}, disconnect() {} }; },
  function Event() {}, function Node() {}, () => 0, gcs, requireStub);
const mod = def.factory(requireStub);

/* 记录 panel 元素进 registry（createElement('div') 后设置 id 时无法拦截 ⇒ 用 replaceChildren 之外的办法：
   直接扫 body/列的子树找 id，兜底再从 appendChild 记录里找）*/const seen = [];
const origBodyAppend = body.appendChild.bind(body);
body.appendChild = (c) => { seen.push(c); if (c && c.id) byId.set(c.id, c); return origBodyAppend(c); };
const origAppend = colParent.appendChild.bind(colParent);
// 注意：面板是 el.id = '...' 直接赋属性（不是 setAttribute）⇒ 用 c.id 归档
colParent.appendChild = (c) => { seen.push(c); if (c && c.id) byId.set(c.id, c); return origAppend(c); };

console.log('=== 加载 + apply ===');
mod.apply(ctx);
const svc = ctx.get('shinkiViews');
ok(!!svc && typeof svc.register === 'function', 'ctx.shinkiViews 就绪');

/* ── 测试 A：底部栏承载 ─────────────────────────────────────────────────── */
console.log('\n=== A. 底部栏承载（svc.open(id,"bottom")）===');
let A = null;
svc.register({ id: 'vA', title: '视图A', targets: ['bottom'], background: 'pause', render: (props) => { A = props; return { type: 'div', props: {} }; } });
svc.open('vA', 'bottom');

function findIn(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  for (const k of (root.children || [])) { const hit = findIn(k, id); if (hit) return hit; }
  return null;
}
const panel = byId.get('shinki-tools-panel') || findIn(body, 'shinki-tools-panel') || seen.find((e) => e && e.id === 'shinki-tools-panel');
ok(!!panel, '面板元素已创建（#shinki-tools-panel）');
const rootA = ROOTS[ROOTS.length - 1];
const panelHost = rootA && rootA.host;
ok(!!rootA && typeof rootA.render === 'function' && rootA.renders.length > 0, '视图已交给 React root 渲染（不是直调组件）');
// 桩 React 只记录元素、不真正渲染 ⇒ 手动执行包装组件（等价于 React 调用它）
try { runView(rootA.renders[rootA.renders.length - 1]); } catch (e) { ok(false, '包装组件执行抛错：' + e.message); }
ok(!!A, '底部栏路径已调用 spec.render');
if (A) {
  ok(A.form === 'bottom', 'props.form === "bottom"', A.form);
  ok(A.isDetached === false, 'props.isDetached === false', A.isDetached);
  ok(typeof A.close === 'function', 'props.close 是函数');
  ok(typeof A.setTitle === 'function', 'props.setTitle 是函数');
  ok(!!A.container && typeof A.container.appendChild === 'function', 'props.container 是真实 DOM 节点');
  ok(A.background === 'pause', 'props.background === "pause"', A.background);
}
if (panel) {
  ok(panel.style.display !== 'none', '★ 首激活后面板不是 display:none（顺序 bug 已修）', panel.style.cssText || panel.style.display);
  ok(docEl.style['--dsh-shinki-bottom-height'] === '220px', '★ 让位变量已写 220px（有活动视图）', docEl.style['--dsh-shinki-bottom-height']);
}
console.log('\n--- 宿主与 CSS ---');
ok(panel && panel.parentElement === body, '★ 面板宿主是 <body>（fixed 相对视口，不被会话 DOM 的包含块劫持）', panel && panel.parentElement && panel.parentElement.tag);

console.log('\n--- 让位机制：会话列 margin-bottom（不是滚动容器 padding）---');
ok(column.style.marginBottom === 'var(--dsh-shinki-bottom-height)', '★ 会话列拿到 margin-bottom 让位（对齐参考实现 layout.css）', column.style.marginBottom);
ok(!scroller.style.paddingBottom, '★★ 消息列表(滚动容器)没有 padding-bottom —— 有它就会在会话末尾平白多一条空白，且内容能滚进那块区域', scroller.style.paddingBottom);
ok(!body.style.paddingBottom && !docEl.style.paddingBottom, '★ <body>/<html> 都没被让位（不再把文档撑高）');
const hostEl = rootA && rootA.host;
ok(A && A.container === hostEl, '★ props.container 就是 React root 的宿主（PANEL.host）');

/* ③ close() 不再绕过 React 抽 DOM */
console.log('\n--- close() ---');
const rcBefore = hostEl ? hostEl.replaceChildrenCalls : -1;
try { A.close(); } catch (e) { ok(false, 'close() 抛错：' + e.message); }
ok(hostEl ? hostEl.replaceChildrenCalls === rcBefore : false, '★ close() 没有 replaceChildren（不再抽掉 React root 的 DOM）', hostEl && hostEl.replaceChildrenCalls);
ok(panel && panel.style.display === 'none', 'close() = 收起面板（display:none，视图保持挂载）', panel && panel.style.display);
ok(column.style.marginBottom === '', '★ close() 后会话列 margin 已还原', column.style.marginBottom);
ok(!scroller.style.paddingBottom, '★ close() 后滚动容器依然没有 padding（空白不会留在会话末尾）', scroller.style.paddingBottom);
ok(docEl.style['--dsh-shinki-bottom-height'] === '0px', '★ close() 后让位变量归零', docEl.style['--dsh-shinki-bottom-height']);
ok(!body.style.paddingBottom && !docEl.style.paddingBottom, '★ 全程 body/<html> 都没有 padding 残留');

/* ④ setTitle 真的改标题（TAB 条标签） */
console.log('\n--- setTitle() ---');
svc.open('vA', 'bottom');
try { A.setTitle('改名后的A'); } catch (e) { ok(false, 'setTitle() 抛错：' + e.message); }
const flat = [];
(function walk(el) { if (!el) return; flat.push(el); (el.children || []).forEach(walk); })(panel);
ok(flat.some((e) => e && e.textContent === '改名后的A'), '★ TAB 条出现新标题「改名后的A」', flat.filter((e) => e && e.textContent).map((e) => e.textContent).slice(-6));

/* ── 测试 B：官方右栏槽位承载 ───────────────────────────────────────────── */
console.log('\n=== B. 官方右栏槽位承载（sidebar.right.pane.tab）===');
let B = null;
svc.register({ id: 'vB', title: () => '视图B', targets: ['bottom'], render: (props) => { B = props; return { type: 'div', props: {} }; } });
const seat = REG.slots.filter((s) => s.opts.name === 'sidebar.right.pane.tab').pop();
ok(!!seat && typeof seat.comp === 'function', '右栏槽位条目已注册（带组件）');
ok(!!seat && typeof seat.opts.title === 'function', '槽位条目 title 是函数（官方渲染器会调用）');
if (seat) {
  const kit = { sessionId: 's1', renderFactorySlot: () => {}, useTabInfo: () => ({}) };
  const wrapper = seat.comp(kit);
  ok(wrapper && wrapper.type === 'div' && wrapper.kids && wrapper.kids[0] && wrapper.kids[0].__portal === true,
    '★ 槽位承载层用 portal（container 目标节点真实存在）');
  const portal = wrapper.kids[0];
  const fakeOuter = mkEl('div');
  wrapper.props.ref(fakeOuter);
  ok(portal.node.parentElement === fakeOuter, 'portal 目标节点已挂进承载层（首帧即存在）');
  const inner = portal.child;
  inner.type(inner.props);   // 执行 ShinkiWrappedView → 调 spec.render
  ok(!!B, '官方槽位路径已调用 spec.render');
  if (B) {
    ok(B.container === portal.node, '★ props.container 就是 portal 目标节点（官方路径不再缺 container）', !!B.container);
    ok(B.form === 'bottom', 'props.form === "bottom"', B.form);
    ok(B.isDetached === false, 'props.isDetached === false（官方路径已补齐）', B.isDetached);
    ok(typeof B.close === 'function', 'props.close 是函数（官方路径已补齐）');
    ok(typeof B.setTitle === 'function', 'props.setTitle 是函数（官方路径已补齐）');
    ok(B.sessionId === 's1', '★ 官方 kit 原样透传（sessionId）', B.sessionId);
    ok(typeof B.useTabInfo === 'function', '★ 官方 kit 原样透传（useTabInfo）');
    ok(B.background === 'pause', 'props.background 已注入', B.background);
  }
  try { B.setTitle('右栏改名'); } catch (e) { ok(false, 'B.setTitle 抛错：' + e.message); }
  ok(seat.opts.title() === '右栏改名', '★ setTitle 影响官方槽位条目 title()', seat.opts.title());
  try { B.close(); } catch (e) { ok(false, 'B.close() 抛错：' + e.message); }
  ok(panel.style.display !== 'none', '官方槽位 close() 不影响底部面板显隐（底部栏仍可见）', panel.style.display);
}

/* ── 测试 D：视图渲染抛错时不得留空白（错误边界）──────────────────────────── */
console.log('\n=== D. 视图渲染抛错 ⇒ 就地报错，而不是空白 ===');
svc.register({ id: 'vD', title: '会抛错的视图', targets: ['bottom'], render: () => { throw new Error('故意抛错：拿不到 store/scope'); } });
svc.open('vD', 'bottom');
const dRoot = ROOTS[ROOTS.length - 1];
const dEl = dRoot && dRoot.renders[dRoot.renders.length - 1];
ok(!!dEl && typeof dEl.type === 'function', '抛错视图仍被挂载（createElement 正常）');
ok(!!dEl && dEl.type && dEl.type.getDerivedStateFromError !== undefined, '★ 挂载树里带了错误边界（getDerivedStateFromError）');
if (dEl && dEl.type && dEl.type.getDerivedStateFromError) {
  const B = dEl.type;
  const inst = new B({});
  inst.state = { err: null };
  const good = inst.render();
  ok(good === dEl.kids[0], '无错误时边界直接渲染子视图');
  const derived = B.getDerivedStateFromError(new Error('故意抛错：拿不到 store/scope'));
  inst.state = derived;
  const ph = inst.render();
  const text = JSON.stringify(ph);
  ok(text.includes('渲染失败'), '★ 抛错时就地显示「渲染失败」（不再是空白面板）');
  ok(text.includes('拿不到 store/scope'), '★ 错误原因写进了面板内容（可定位）');
  ok(text.includes('重试'), '★ 提供重试按钮');
}


/* ── 测试 E：注入的 CSS 必须是合法的（历史上有人把 JS 粘进了 CSS 模板字符串）──────── */
console.log('\n=== E. 注入 CSS 合法性 ===');
const cssEl = (function () { try { return (doc.head.children || []).find((e) => e && e.id === 'dsh-shinki-sidebar-tools-css') || byId.get('dsh-shinki-sidebar-tools-css'); } catch (e) { return null; } })();
ok(!!cssEl, '样式元素已注入 <head>');
if (cssEl) {
  const css = String(cssEl.textContent || '');
  ok(css.includes('margin-bottom: var(--dsh-shinki-bottom-height'), '★ 含会话列 margin-bottom 让位规则', css.slice(0, 80));
  ok(!css.includes('try {') && !css.includes('document.createElement'), '★ CSS 里没有混入 JS 语句（模板字符串未再被写坏）');
  ok(css.includes('::-webkit-scrollbar'), 'stripTabs 滚动条规则仍在');
}

/* ── 测试 F：右上角开关（用户实际动作）点开后面板可见且让位到位 ─────────────────── */
console.log('\n=== F. 右上角开关 toggleBottomPanel（用户的点击路径）===');
try { A.close(); } catch (e) { /* 忽略 */ }                       // 先关，保证接下来是"打开"
try {
  const hdr = REG.slots.filter((x) => x.opts && x.opts.name === 'conversation.session.header.utilities').pop();
  ok(!!hdr && typeof hdr.comp === 'function', '右上角开关已注册到官方槽位');
  if (hdr) {
    const btn = hdr.comp();                                       // Btn() → 返回按钮元素
    ok(!!btn && !!btn.props && typeof btn.props.onClick === 'function', '取到按钮 onClick');
    btn.props.onClick({ preventDefault() {}, stopPropagation() {} });   // ← 等价于用户点右上角开关
    ok(panel.style.display !== 'none', '★ 点开关后面板可见', panel.style.display);
    ok(column.style.marginBottom === 'var(--dsh-shinki-bottom-height)', '★★ 点开关后让位到位（会话列 margin-bottom）—— 不再压住输入框', column.style.marginBottom);
    ok(docEl.style['--dsh-shinki-bottom-height'] === '220px', '★ 让位变量 = 220px', docEl.style['--dsh-shinki-bottom-height']);
    ok(!scroller.style.paddingBottom, '★ 点开关后滚动容器依然没有 padding（会话末尾无空白）');
  }
} catch (e) { ok(false, '开关路径抛错：' + e.message); }


/* ── 测试 G：层次（z-index）与"确定盒子"兜底 ─────────────────────────────────── */
console.log('\n=== G. 层次设计（只比会话高，比其它视图低） ===');
const panelCss = String(panel.style.cssText || '');
const zPanel = Number((panelCss.match(/z-index:\s*(\d+)/) || [])[1] || -1);
ok(zPanel === 100, '★ 面板 z-index = 100（高于会话内容 0~10 与其浮动层 float 60）', zPanel);
ok(zPanel > 60, '★★ 高于会话内浮动层 float(60) —— 取 40 时会被它压住，表现为「内容被切一半还滚不动」', zPanel);
ok(zPanel < 1100, '★ 低于宿主菜单层 1100（菜单不会被面板挡）', zPanel);
ok(!/2147482\d\d/.test(panelCss), '★ 面板不再使用 2147482xxx 那种"压住一切"的层次', panelCss.match(/2147482\d\d/g));
if (cssEl) {
  const css = String(cssEl.textContent || '');
  const zMenu = Number((css.match(/z-index:\s*(\d+)/) || [])[1] || -1);
  ok(zMenu > zPanel, '★ 右下菜单层次高于面板（点开不会被面板里的控件挡住）', zMenu);
}
ok(String(body.style.cssText || '') === '', '（参考）body 未被本插件写样式');

console.log('\n=== H. 列解析不到时也要给确定盒子（避免窄条/内容浮空）===');
panel.style.left = ''; panel.style.right = ''; panel.style.width = '';
columnAvailable = false;                                  // 模拟"列尚未出现"
try { (winListeners['resize'] || []).forEach((f) => f()); } catch (e) { ok(false, 'resize 处理抛错：' + e.message); }
ok(panel.style.left === '0px' && panel.style.right === '0px', '★ 兜底为 left/right:0（确定的满宽盒子）', panel.style.left + ' / ' + panel.style.right);
columnAvailable = true;


/* ── 测试 I：「＋」下拉必须能选中视图（历史 bug：mousedown 先把菜单删了）──────────── */
console.log('\n=== I. 「＋」新增下拉：能选中并打开视图 ===');
const plus = walkFind(panel, (el) => el.dataset && el.dataset.addBtn === '1');
ok(!!plus, '面板里有「＋」按钮');
ok(!!plus && plus.textContent === '＋', "★ 按钮只有图标：textContent === '＋'（无文字）", plus && plus.textContent);
if (plus) {
  try { (plus.__listeners.click || []).forEach((f) => f({ stopPropagation() {} })); } catch (e) { ok(false, '点＋抛错：' + e.message); }
  tick();                                        // 让 dismiss 监听注册上
  const menu = findIn(body, 'shinki-bp-addmenu');
  ok(!!menu, '下拉菜单已出现在 <body> 下');
  const items = (menu && menu.children) ? menu.children.slice() : [];
  ok(items.length >= 2, '下拉里列出了可选的底部视图', items.map((i) => i.textContent));
  if (menu && items.length) {
    // 历史 bug：菜单项上的 mousedown 会把菜单从 DOM 删掉 ⇒ 随后的 click 落不到该项上
    fireDoc('mousedown', { target: items[0], clientX: 1, clientY: 1 });
    ok(findIn(body, 'shinki-bp-addmenu') === menu, '★ 在菜单项上按下鼠标时菜单**不**被收起（选中才可能生效）');
    const want = items[0].textContent;
    try { (items[0].__listeners.click || []).forEach((f) => f({ stopPropagation() {} })); } catch (e) { ok(false, '点菜单项抛错：' + e.message); }
    ok(findIn(body, 'shinki-bp-addmenu') === null, '选中后菜单已收起');
    ok(!!walkFind(panel, (el) => el.textContent === want), '★ 选中的视图已切到前台（TAB 条出现「' + want + '」）');
    // 点菜单外面应能收起
    try { (plus.__listeners.click || []).forEach((f) => f({ stopPropagation() {} })); } catch (e2) { ok(false, '点＋抛错：' + e2.message); }
    tick();
    ok(!!findIn(body, 'shinki-bp-addmenu'), '再次点开 ＋ 菜单出现');
    ok((docListeners['mousedown'] || []).length > 0, '收起监听到位（不是虚过：定时器真的跑了）');
    fireDoc('mousedown', { target: mkEl('div'), clientX: 5, clientY: 5 });
    ok(findIn(body, 'shinki-bp-addmenu') === null, '★ 点菜单外面时菜单正常收起');
  }
}


/* ── 测试 J：面板状态按会话隔离（跟着对话走 + 各自保留）────────────────────────── */
console.log('\n=== J. 状态跟着会话走（per-session） ===');
/* 开/关面板要用**右上角开关**（＋ 只是打开下拉，不开关面板） */
const hdrSlot = REG.slots.filter((x) => x.opts && x.opts.name === 'conversation.session.header.utilities').pop();
const clickHeaderToggle = () => { const b = hdrSlot.comp(); b.props.onClick({ preventDefault() {}, stopPropagation() {} }); };
const readSess = (k) => { try { return JSON.parse(localStore.getItem('dsh-shinki-tools:v1:' + k) || 'null'); } catch (e) { return null; } };
const saveAndRead = (k) => { flushTimersAt(200); return readSess(k); };
ok(sessionSrc.key === 'sess-A', '当前会话 = sess-A');
// 保证 A 会话面板是开着的（前面 F/I 已打开）
if (panel.style.display === 'none') { try { clickHeaderToggle(); } catch (e) { /* 忽略 */ } }
{
  const a = saveAndRead('sess-A');
  ok(!!a && a.open === true, '★ 会话 A 已记录"展开 = true"', a);
  ok(!!a && typeof a.active === 'string' && a.active.length > 0, '★ A 记录了它自己的当前视图', a && a.active);
  ok(!!a && Array.isArray(a.tabOrder) && a.tabOrder.length > 0, '★ A 记录了它打开的视图集合', a && a.tabOrder);
}
// 切到会话 B（无记录 ⇒ 默认收起 + 一次性迁移已用掉）
setSession('sess-B');
ok(panel.style.display === 'none', '★ 切到 B（从没开过）⇒ 面板收起，不继承 A 的状态', panel.style.display);
ok(docEl.style['--dsh-shinki-bottom-height'] === '0px', '★ 切到 B 后让位归零', docEl.style['--dsh-shinki-bottom-height']);
// 在 B 里打开面板并切一个视图
{
  try { clickHeaderToggle(); } catch (e) { ok(false, 'B 里点开关抛错：' + e.message); }
  ok(panel.style.display !== 'none', 'B 里点开关后面板打开', panel.style.display);
  const b = saveAndRead('sess-B');
  ok(!!b && b.open === true, '★ 会话 B 记录了自己的"展开 = true"', b);
}
// 切回 A：应恢复 A 自己的展开状态与视图
setSession('sess-A');
ok(panel.style.display !== 'none', '★ 切回 A ⇒ 面板按 A 的记录重新展开', panel.style.display);
{
  const a = saveAndRead('sess-A');
  const labels = { vA: '改名后的A', vB: '视图B', vD: '会抛错的视图' };
  const lbl = a && a.active ? labels[a.active] : null;
  ok(!!a && a.open === true && panel.style.display !== 'none', '★ A 的展开状态被保留（重启前不丢）');
  ok(!!lbl && !!walkFind(panel, (el) => el.textContent === lbl), '★ 切回 A 后 TAB 条恢复它自己的当前视图「' + lbl + '」', a && a.active);
  ok(!!saveAndRead('sess-B') && saveAndRead('sess-B').open === true, '★ B 的状态也各自保留（互不覆盖）');
  ok(!!a && a.height >= 120 && a.height <= Math.max(120, 800 - 280), '★ 高度按参考契约夹在 [120, 视口-280]', a && a.height);
}


/* ── 测试 K：?dsh-shinki-reset 逃生口 + 高度契约（对齐参考）───────────────────── */
console.log('\n=== K.?reset 逃生口与高度契约 ===');
localStore.setItem('dsh-shinki-tools:v1:sess-C', JSON.stringify({ open: true, height: 9999, tabOrder: ['vA'], active: 'vA' }));
win.location.search = '?dsh-shinki-reset';
setSession('sess-C');
ok(panel.style.display === 'none', '★ ?dsh-shinki-reset ⇒ 忽略已存状态、按默认收起');
ok(localStore.getItem('dsh-shinki-tools:v1:sess-C') === null, '★ 坏状态已被丢弃');
win.location.search = '';
// 高度上限：存 9999 ⇒ 载入时夹到 视口-280（桩视口 800 ⇒ 520）
localStore.setItem('dsh-shinki-tools:v1:sess-D', JSON.stringify({ open: true, height: 9999, tabOrder: ['vA'], active: 'vA' }));
setSession('sess-D');
ok(panel.style.height === '520px', '★ 载入时高度夹到上限（800-280=520），不会把会话挤成 0', panel.style.height);
ok(panel.style.display !== 'none', 'sess-D 按记录展开');
setSession('sess-A');


/* ── 测试 L：右下菜单项（按用户要求移除）─────────────────────────────────────── */
console.log('\n=== L. 右下菜单项 ===');
ok(!/几何诊断|dumpPanelDom|updateScrollHint|DEBUG_READOUT|dumpSlots|data-shinki-scroll-hint/.test(code), '★★ 调试脚手架已清除（读数/DOM 诊断/几何诊断/槽位诊断/构建号）');
ok(code.includes('attachWheelScroll'), '滚轮兜底保留（功能，非调试）');
ok(!code.includes("mk('📌 在右侧栏显示全部视图"), '★ 右下菜单已无「📌 在右侧栏显示全部视图」入口');
ok(code.includes("mk('📥 底部面板：'"), '底部面板开关项仍在');
ok(!code.includes("dsh-shinki-tools:sandbox") && !code.includes("'适配层自检'"), '★ 已移除自检视图（不会再在「独立弹窗」/「可创建」里多出一条）');
ok(!code.includes("mk('📥 立即显示底部栏"), '★ 已移除「立即显示底部栏」菜单项');


/* ── 测试 M：右下 ≡ 菜单必须整体在视口内（最后一项不许被切在界面外）────────────── */
console.log('\n=== M. ≡ 菜单整体在视口内 ===');
{
  const fab = byId.get('dsh-shinki-sidebar-tools-fab') || walkFind(body, (el) => el.id === 'dsh-shinki-sidebar-tools-fab');
  ok(!!fab, '右下 ≡ 悬浮按钮存在');
  if (fab) {
    try { (fab.__listeners.click || []).forEach((f) => f({ target: fab, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} })); } catch (e) { ok(false, '点 ≡ 抛错：' + e.message); }
    const menu = walkFind(body, (el) => el.className === 'shst-menu');
    ok(!!menu, '≡ 菜单已挂到 <body>');
    if (menu) {
      const vh = 768, M = 8;
      const top = Number(String(menu.style.top || '').replace('px', ''));
      const maxH = Number(String(menu.style.maxHeight || '').replace('px', ''));
      ok(isFinite(top) && top >= M, '★ 菜单 top 已夹进视口上边界', menu.style.top);
      ok(isFinite(maxH) && maxH > 0, '★ 菜单 maxHeight 由"可用空间"决定（旧代码写死 vh-16）', menu.style.maxHeight);
      const h = Math.min(menu.offsetHeight || maxH, maxH);
      ok(top + h <= vh - M + 0.5, '★★ 菜单底边在视口内（最后一项滚动可见，不再被切在界面外）', { top: top, h: h, 视口: vh, 底边: top + h });
      ok(String(menu.style.overflowY) === 'auto', '菜单可滚动', menu.style.overflowY);
      const texts = [];
      (function walk(el) { if (el.textContent) texts.push(el.textContent); (el.children || []).forEach(walk); })(menu);
      ok(!texts.some((t) => String(t).includes('立即显示底部栏')), '★ 渲染出来的菜单里已无「立即显示底部栏」项', texts.slice(0, 6));
      ok(!texts.some((t) => String(t).includes('在右侧栏显示全部视图')), '★ 渲染出来的菜单里已无「在右侧栏显示全部视图」项');
      ok(!texts.some((t) => String(t).includes('适配层自检')), '★ 渲染出来的菜单里已无自检视图');
    }
  }
}


/* ── 测试 N：底部栏内部视图必须能滚（宿主是可滚动的确定高度容器）────────────────── */
console.log('\n=== N. 内部视图滚动支持 ===');
{
  const host = panel && walkFind(panel, (el) => el.__attrs && el.__attrs['data-shinki-view-body'] === '1') || walkFind(panel, (el) => el.__attrs && el.__attrs['data-shinki-view-body']);
  ok(!!host, '内容宿主带 data-shinki-view-body 标记');
  if (host) {
    const css = String(host.style.cssText || '');
    ok(/overflow:\s*auto/.test(css), '★ 宿主 overflow:auto（视图溢出时可滚）', css);
    ok(!/display:\s*flex/.test(css), '★★ 宿主**不是** flex 容器（"自己滚"的视图根如 [data-shinki-js-ota] 行为与改动前一致）', css);
    ok(/min-height:\s*0/.test(css) && /flex:\s*1 1 auto/.test(css), '★ 宿主 flex:1 1 auto + min-height:0（高度确定，不被内容撑破）', css);
    ok(/position:\s*relative/.test(css), '★ 宿主 position:relative（absolute 根节点相对宿主定位，不会跑到面板外被裁）', css);
    ok(/overscroll-behavior:\s*contain/.test(css), '宿主 overscroll-behavior:contain（滚轮不穿透到页面）', css);
  }
  const cssRaw = cssEl ? String(cssEl.textContent || '') : '';
  const cssText = cssRaw.replace(/\/\*[\s\S]*?\*\//g, ' ');   // 剥掉注释再断言（注释里提到旧做法不算规则）
  ok(cssText.includes('data-shinki-view-body'), '★ 注入 CSS 覆盖视图宿主');
  ok(!/data-shinki-view-body\]\s*\{[^}]*height:\s*max\(/.test(cssText), '★★ 宿主高度**不写死**（不写死才能按面板实际高度自动分配，手动拖高自动跟随）', cssText.match(/data-shinki-view-body\][^}]*\}/));
  ok(!code.includes("PANEL.el.style.display = ''"), '★★ 不再用「style.display 置空」来显示面板（那会清掉内联 display:flex ⇒ 面板变 block ⇒ 宿主不收缩、高度=内容高度 ⇒ 被面板裁掉且不滚）');
  ok(/scrollbar-width:\s*thin/.test(cssText), '★ 细滚动条（QtWebEngine 默认不画滚动条 ⇒ 用户看不到可滚）', /scrollbar-width:\s*thin/.test(cssText));
  ok(!/flex-shrink:\s*0/.test(cssText), '★★ 不再给视图根强制 flex-shrink:0（它会把含 padding 的根节点撑出宿主 ⇒ 双层滚动/滚不动）');
  ok(/> \*\s*\{[^}]*min-height:\s*100%/.test(cssText.replace(/\n/g, ' ')), '★ 视图根 min-height:100%（内容少时铺满面板）');
  ok(/> \*\s*\{[^}]*height:\s*auto\s*!important/.test(cssText.replace(/\n/g, ' ')), '★★ 视图根 height:auto !important —— 内容多高就多高，滚动与否**由浏览器按实际内容高度决定**（纯 CSS，无需 JS 判断）');
  ok(/> \*\s*\{[^}]*overflow:\s*visible\s*!important/.test(cssText.replace(/\n/g, ' ')), '★ 视图根不再自己裁剪（否则外层 auto 看不到溢出）');
  ok(!/min-width:\s*0/.test(cssText), '不再给视图根 min-width:0（宽内容会被压扁；改由宿主横向滚动）');
  ok(cssText.includes('::-webkit-scrollbar-thumb'), '★ 滚动条滑块样式（可见性）');
}


/* ── 测试 O：底部栏 ↔ 会话区的边界与拖拽把手（拖动时知道拖哪里）──────────────── */
console.log('\n=== O. 边界与拖拽把手 ===');
{
  const pcss = String(panel.style.cssText || '');
  ok(/background:\s*var\(--dsw-alias-bg-layer-1/.test(pcss), '★★ 面板背景色真的生效（历史 bug：cssText 被分号截断 ⇒ 面板透明、与会话区糊在一起）', pcss.slice(0, 120));
  ok(/border-top:\s*1px solid/.test(pcss), '★★ 面板顶边框真的生效（明确的上下边界）', pcss.match(/border-top:[^;]*/));
  ok(/box-shadow:\s*0 -10px/.test(pcss), '★ 面板顶部有投影 ⇒ 与会话区分层', pcss.match(/box-shadow:[^;]*/));
  ok(!/';\s*\n\s*\+ /.test(code), '（源码）无"字符串赋值后被分号截断、后续 + 拼接变死代码"的写法');
  const rz = walkFind(panel, (el) => el.__attrs && el.__attrs['data-shinki-rz'] === '1');
  ok(!!rz, '拖高条带 data-shinki-rz 标记');
  if (rz) {
    const zc = String(rz.style.cssText || '');
    ok(/height:\s*10px/.test(zc), '拖高条高度 10px（比原来 8px 更好点中）', zc);
    ok(/cursor:\s*row-resize/.test(zc), 'cursor:row-resize（提示可上下拖）', zc);
    ok(!!walkFind(rz, (el) => el.className === 'shst-grip'), '★ 拖高条里有可见"握把"胶囊（不再是一条看不见的透明区）');
    ok(typeof rz.__attrs['aria-label'] === 'string' && /拖动/.test(rz.__attrs['aria-label']), '拖高条带 aria-label');
    const hud = walkFind(panel, (el) => el.className === 'shst-hud');
    ok(!!hud, '拖动高度 HUD 已建（拖动时显示当前 px）');
    // 模拟拖动：mousedown → mousemove → 断言高度/HUD/拖动态
    try { (rz.__listeners.mousedown || []).forEach((f) => f({ clientY: 300, preventDefault() {}, stopPropagation() {} })); } catch (e) { ok(false, 'mousedown 抛错：' + e.message); }
    ok(panel.dataset.dragging === '1', '★ 拖动中面板带 data-dragging（顶边变主题色）', panel.dataset.dragging);
    ok(!!hud && /px$/.test(String(hud.textContent)), '★ 拖动时 HUD 显示当前高度', hud && hud.textContent);
    const h0 = Number(String(panel.style.height || '').replace('px', ''));
    try { fireDoc('mousemove', { clientY: 250, preventDefault() {}, stopPropagation() {} }); } catch (e) { /* 忽略 */ }
    const h1 = Number(String(panel.style.height || '').replace('px', ''));
    ok(isFinite(h1) && h1 !== h0, '★ 拖动改变面板高度（' + h0 + ' → ' + h1 + '）');
    ok(h1 >= 120 && h1 <= 800 - 280, '★ 高度仍被契约夹住 [120, 视口-280]', h1);
    try { fireDoc('mouseup', {}); } catch (e) { /* 忽略 */ }
    ok(panel.dataset.dragging === undefined || panel.dataset.dragging === '', '拖动结束清除拖动态', panel.dataset.dragging);
    ok(docEl.style['--dsh-shinki-bottom-height'] === h1 + 'px', '★ 拖动同步让位变量', docEl.style['--dsh-shinki-bottom-height']);
  }
  const cssText2 = cssEl ? String(cssEl.textContent || '') : '';   // O 组用原文即可（这些选择器不在注释里）
  ok(cssText2.includes('shst-grip'), '注入 CSS 含握把样式');
  ok(cssText2.includes('data-dragging="1"'), '注入 CSS 含拖动态样式（顶边主题色 + HUD 显示）');
  ok(/\.shst-hud\s*\{[^}]*display:\s*none/.test(cssText2.replace(/\n/g, ' ')), 'HUD 默认隐藏');
}


/* ── 测试 P：滚轮兜底（不依赖 webview 原生滚动）+ 溢出提示 ────────────────────── */
console.log('\n=== P. 滚轮兜底滚动 ===');
{
  const host2 = walkFind(panel, (el) => el.__attrs && el.__attrs['data-shinki-view-body'] === '1');
  ok(!!host2, '内容宿主就位');
  if (host2) {
    // 造一个"视图内部滚动区"（模拟 JS OTA：height:100% + overflow:auto）
    const inner = mkEl('div');
    inner.scrollHeight = 1000; inner.clientHeight = 200; inner.scrollTop = 0;
    host2.appendChild(inner);
    host2.scrollHeight = 2000; host2.clientHeight = 200; host2.scrollTop = 0;
    const wheel = (target, dy) => { const ev = { target: target, deltaY: dy, deltaMode: 0, prevented: false, preventDefault() { this.prevented = true; } }; (host2.__listeners.wheel || []).forEach((f) => f(ev)); return ev; };
    // ① 最内层能滚 ⇒ 滚它，并 preventDefault（不叠加原生滚动）
    let ev = wheel(inner, 48);
    ok(inner.scrollTop === 48, '★ 滚轮滚动"视图内部"滚动区（最内层优先）', inner.scrollTop);
    ok(ev.prevented === true, '★ 手动滚过后 preventDefault（避免与原生滚动叠加）', ev.prevented);
    // ② 内层到底 ⇒ 接力滚宿主
    inner.scrollTop = inner.scrollHeight - inner.clientHeight;
    ev = wheel(inner, 48);
    ok(host2.scrollTop === 48, '★ 内层到底后接力滚动宿主（内容仍可达）', host2.scrollTop);
    // ③ 都到底 ⇒ 不拦截（页面照常滚）
    host2.scrollTop = host2.scrollHeight - host2.clientHeight;
    ev = wheel(inner, 48);
    ok(ev.prevented === false, '★ 都滚不动时不拦截（让页面自己滚）', ev.prevented);
    // ④ 反向：从底部往回滚
    const ev2 = wheel(inner, -48);
    ok(host2.scrollTop < host2.scrollHeight - host2.clientHeight || inner.scrollTop < inner.scrollHeight - inner.clientHeight, '★ 反向滚动也生效', { host: host2.scrollTop, inner: inner.scrollTop });
    // ④b 关键：overflow:hidden 的"裁切型"容器（内容被裁）也必须能被兜底滚到
    const clippedEl = mkEl('div');
    clippedEl.__overflowY = 'hidden';       // 模拟 JS OTA 那类 height:100% + overflow:hidden
    clippedEl.scrollHeight = 900; clippedEl.clientHeight = 150; clippedEl.scrollTop = 0;
    host2.appendChild(clippedEl);
    const evC = wheel(clippedEl, 60);
    ok(clippedEl.scrollTop === 60, '★★ overflow:hidden 被裁内容也能被兜底滚动（不再只看 CSS 的 auto/scroll）', clippedEl.scrollTop);
    ok(evC.prevented === true, '★ 裁切容器滚动后也 preventDefault');
    // 横向兜底：overflow:hidden 的宽内容也能被 deltaX / Shift+滚轮 滚到（功能断言；读数已移除）
    const wide = mkEl('div');
    wide.__overflowX = 'hidden'; wide.scrollWidth = 1200; wide.clientWidth = 400;
    host2.appendChild(wide);
    wide.scrollLeft = 0;
    const evH = { target: wide, deltaY: 0, deltaX: 60, deltaMode: 0, shiftKey: false, prevented: false, preventDefault() { this.prevented = true; } };
    (host2.__listeners.wheel || []).forEach((f) => f(evH));
    ok(wide.scrollLeft === 60, '★★ 横向兜底：overflow:hidden 的宽内容也能滚（deltaX）', wide.scrollLeft);
    const evS = { target: wide, deltaY: 60, deltaX: 0, deltaMode: 0, shiftKey: true, prevented: false, preventDefault() { this.prevented = true; } };
    wide.scrollLeft = 0;
    (host2.__listeners.wheel || []).forEach((f) => f(evS));
    ok(wide.scrollLeft === 60, '★ Shift+滚轮按横向处理', wide.scrollLeft);
  }
}


/* ── 测试 Q：better-sidebar 口径 props（visible/scope/tab/store）───────────────── */
console.log('\n=== Q. 消费方要的 better-sidebar props ===');
{
  // 用一个"按 better-sidebar 口径"的视图，看我们到底给了什么
  let got = null;
  const activateAndRun = (id) => { svc.open(id, 'bottom'); const r = ROOTS[ROOTS.length - 1]; const el = r && r.renders[r.renders.length - 1]; if (el) runView(el); };
  svc.register({ id: 'vQ', title: '兼容性视图', targets: ['bottom'], render: (props) => { got = props; return { type: 'div', props: {} }; } });
  activateAndRun('vQ');
  ok(!!got, '视图已渲染');
  if (got) {
    ok(got.visible === true, '★★ visible === true（消费方靠它开轮询；undefined 会让记录/状态永不刷新）', got.visible);
    ok(!!got.scope && typeof got.scope.sessionId === 'string' && got.scope.sessionId.length > 0, '★ scope.sessionId 有值', got.scope);
    ok(!!got.scope && typeof got.scope.cwd === 'string', '★ scope.cwd 存在', got.scope && got.scope.cwd);
    ok(!!got.tab && typeof got.tab.id === 'string' && got.tab.id.length > 0, '★ tab.id 有值（store.updateTab 用它）', got.tab && got.tab.id);
    ok(!!got.tab && got.tab.meta && typeof got.tab.meta === 'object', '★ tab.meta 是对象', got.tab && got.tab.meta);
    ok(!!got.store && ['get', 'set', 'getPrefs', 'setPrefs', 'update', 'updateTab', 'subscribe', 'getSnapshot'].every((k) => typeof got.store[k] === 'function'), '★★ store 具备消费方要用的方法', got.store && Object.keys(got.store));
    // tab.meta 往返：updateTab 写入 → 重新激活后应读回（且按会话存）
    got.store.updateTab(got.tab.id, { meta: { port: 'COM9', baud: 115200 } });
    flushTimersAt(200);
    activateAndRun('vQ');
    ok(!!got.tab.meta && got.tab.meta.port === 'COM9', '★★ tab.meta 能存能读（消费方的每视图设置不丢）', got.tab && got.tab.meta);
    // store.get/set 往返
    got.store.set('viewState', { k: 1 });
    activateAndRun('vQ');
    ok(JSON.stringify(got.store.get('viewState')) === JSON.stringify({ k: 1 }), '★ store.get/set 往返正常', got.store.get('viewState'));
    // prefs 全局往返
    const before = got.store.getPrefs() || {};
    got.store.setPrefs({ pluginSettings: Object.assign({}, (before.pluginSettings || {}), { vQ: { a: 1 } }) });
    activateAndRun('vQ');
    ok(!!(got.store.getPrefs().pluginSettings || {}).vQ, '★ store.getPrefs/setPrefs 往返正常');
    // subscribe 可订阅可退订
    let hits = 0; const off = got.store.subscribe(() => { hits += 1; });
    got.store.set('x', 1);
    ok(hits > 0, '★ store.subscribe 会收到变更通知', hits);
    try { off(); } catch (e) { /* 忽略 */ }
    // 会话隔离：切到 B 后 tab.meta 应该是 B 自己的（空）
    setSession('sess-B');
    try { const b = { get: null }; activateAndRun('vQ'); b.get = got.tab.meta; ok(!!b.get && b.get.port === undefined, '★★ tab.meta 按会话隔离（B 看不到 A 的 port）', b.get); } catch (e) { ok(false, '会话切换后读 meta 抛错：' + e.message); }
    setSession('sess-A');
    activateAndRun('vQ');
    ok(!!got.tab.meta && got.tab.meta.port === 'COM9', '★ 切回 A 后 A 的设置还在');
  }
}

console.log('\n' + (failed ? `❌ 失败 ${failed} 项` : '✅ 全部通过'));
console.log('—— 几何诊断日志（用于确认新代码真的执行到了）——');
const diag = logs.filter((l) => /dbg|挤压高度写入|几何诊断|抛错|is not defined/.test(l));
console.log(diag.length ? diag.join('\n') : '  （一条都没有 ⇒ writeGeometry 的新分支没跑到，可能抛错被吞）');
process.exit(failed ? 1 : 0);
