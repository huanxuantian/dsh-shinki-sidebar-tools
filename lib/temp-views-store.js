/**
 * 临时视图（sidebar_temp_view）的宿主侧实现：内存 store + agent 工具 + 只读路由。
 *
 * 设计约束（见 docs/temp-views-tool.md）：
 *  - 只在宿主进程内存里存在，重启即全部消失；
 *  - 严格按会话（exec.agent.id）归属，只有该会话能看到；
 *  - 只接受声明式数据，不执行任何来自参数的内容；
 *  - 标题统一由客户端加 `【临时】` 前缀。
 *
 * 内容形态（kind）：
 *  - text      ：纯文本（默认，等宽多行，\n 分行）；
 *  - html      ：HTML 字符串，客户端放进 **sandbox="allow-scripts"** 的 iframe（无 allow-same-origin
 *                ⇒ 独立源，调不到插件路由、读不到宿主 storage —— 只适合纯展示/演示）；
 *  - component ：已注册的客户端组件，`{ pluginId, componentId, props }`；
 *                插件在浏览器半边调用 window.__shinkiTempComponents.register({...}) 注册，
 *                是本机调试（可直接 fetch 插件路由）的推荐形态。
 * 无论哪种形态，宿主只做**长度/结构校验**，不解析、不执行。
 */

/** 支持的视图形态（与 client 的 VIEW_FORMS 对齐）；是「停靠位置」，与 kind（内容形态）无关。 */
export const FORMS = ['mini', 'right', 'bottom', 'popup', 'mainView'];

/** 支持的内容形态。 */
export const KINDS = ['text', 'html', 'component'];

const MAX_VIEWS_PER_SESSION = 20;
const MAX_TEXT = 4000;
const MAX_HTML = 64 * 1024;          // 64KB：够放一整页交互组件，又不至于把快照撑爆
const MAX_PROPS_BYTES = 8192;        // props 只是传给组件的配置，不该塞大对象
const MAX_ID_LEN = 200;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function clampText(v) {
  const s = typeof v === 'string' ? v : '';
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s;
}

function clampHtml(v) {
  const s = typeof v === 'string' ? v : '';
  return s.length > MAX_HTML ? s.slice(0, MAX_HTML) : s;
}

function normalizeForm(form) {
  if (Array.isArray(form)) {
    const out = form.filter((f) => FORMS.includes(f));
    return out.length ? out : ['mini'];
  }
  return FORMS.includes(form) ? [form] : ['mini'];
}

/** `{pluginId, componentId, props?}` 结构校验（不解析组件内容）。 */
function normalizeComponent(input) {
  if (!isPlainObject(input)) return { ok: false, error: 'component 需为对象：{ pluginId, componentId, props? }' };
  const pluginId = typeof input.pluginId === 'string' ? input.pluginId.trim() : '';
  const componentId = typeof input.componentId === 'string' ? input.componentId.trim() : '';
  if (!pluginId || !componentId) return { ok: false, error: 'component.pluginId / component.componentId 必须是非空字符串' };
  if (pluginId.length > MAX_ID_LEN || componentId.length > MAX_ID_LEN) {
    return { ok: false, error: `component 标识过长（上限 ${MAX_ID_LEN} 字符）` };
  }
  if (!/^[A-Za-z0-9._@/-]+$/.test(pluginId) || !/^[A-Za-z0-9._@/-]+$/.test(componentId)) {
    return { ok: false, error: 'component.pluginId / componentId 只能包含字母、数字与 . _ @ / -' };
  }
  let props = null;
  if (input.props !== undefined && input.props !== null) {
    if (!isPlainObject(input.props)) return { ok: false, error: 'component.props 必须是对象（不能是数组/字符串）' };
    let size = 0;
    try { size = JSON.stringify(input.props).length; } catch { return { ok: false, error: 'component.props 含循环引用，无法序列化' }; }
    if (size > MAX_PROPS_BYTES) return { ok: false, error: `component.props 过大（${size}B，上限 ${MAX_PROPS_BYTES}B）` };
    props = input.props;
  }
  return { ok: true, value: { pluginId, componentId, props } };
}

/** 由参数推断目标 kind：显式 kind 优先，其次看这次给了哪种内容，最后沿用原 kind。 */
function resolveKind(args, prevKind) {
  const explicit = typeof args.kind === 'string' ? args.kind.trim().toLowerCase() : '';
  if (explicit) return KINDS.includes(explicit) ? explicit : null;
  if (args.component !== undefined && args.component !== null) return 'component';
  if (args.html !== undefined) return 'html';
  return prevKind || 'text';
}

/**
 * 合并出本次要写入的内容字段（text/html/component 三选一，但允许改 kind 时保留旧内容，
 * 便于 update 来回切换形态而不必重传）。
 */
function buildContent(args, prev) {
  const kind = resolveKind(args, prev ? prev.kind : 'text');
  if (!kind) return { ok: false, error: `kind 只能是 ${KINDS.join(' / ')}` };

  const text = args.text !== undefined ? clampText(args.text) : (prev ? prev.text : '');
  const html = args.html !== undefined ? clampHtml(args.html) : (prev ? prev.html : '');
  let component = prev ? prev.component : null;
  if (args.component !== undefined) {
    if (args.component === null) { component = null; }
    else {
      const n = normalizeComponent(args.component);
      if (!n.ok) return n;
      component = n.value;
    }
  }

  if (kind === 'html' && !html) return { ok: false, error: 'kind="html" 需要非空 html 内容' };
  if (kind === 'component' && !component) return { ok: false, error: 'kind="component" 需要 component:{pluginId,componentId}' };
  return { ok: true, kind, text, html, component };
}

/**
 * @param {{ now?: () => number }} [opts]
 */
export function createTempViews(opts = {}) {
  const now = opts.now || (() => Date.now());
  const state = { version: 0, views: new Map() };   // id -> view

  const bump = () => { state.version += 1; return state.version; };

  function listFor(sessionId) {
    return [...state.views.values()]
      .filter((v) => v.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  function register(sessionId, args) {
    const mine = listFor(sessionId);
    if (mine.length >= MAX_VIEWS_PER_SESSION) {
      return { ok: false, error: `该会话的临时视图已达上限 ${MAX_VIEWS_PER_SESSION}` };
    }
    const id = typeof args.id === 'string' && args.id ? args.id : `tmp-${now()}-${state.views.size + 1}`;
    if (!id.startsWith('tmp-')) return { ok: false, error: '临时视图 id 必须以 tmp- 前缀' };
    const existing = state.views.get(id);
    if (existing && existing.sessionId !== sessionId) {
      return { ok: false, error: `id 已被其它会话占用：${id}` };
    }
    const content = buildContent(args, existing);
    if (!content.ok) return { ok: false, error: content.error };
    const view = {
      id,
      sessionId,
      title: clampText(args.title) || '未命名',
      kind: content.kind,
      text: content.text,
      html: content.html,
      component: content.component,
      form: normalizeForm(args.form),
      x: Number.isFinite(args.x) ? args.x : null,
      y: Number.isFinite(args.y) ? args.y : null,
      width: Number.isFinite(args.width) ? args.width : null,
      height: Number.isFinite(args.height) ? args.height : null,
      visible: args.visible !== false,
      createdAt: existing ? existing.createdAt : now(),
      updatedAt: now(),
    };
    state.views.set(id, view);
    return { ok: true, id, kind: view.kind, version: bump() };
  }

  function update(sessionId, args) {
    const id = args.id;
    const view = state.views.get(id);
    if (!view) return { ok: false, error: `没有这个临时视图：${id}` };
    if (view.sessionId !== sessionId) return { ok: false, error: '只能修改本会话的临时视图' };
    const content = buildContent(args, view);
    if (!content.ok) return { ok: false, error: content.error };
    if (args.title !== undefined) view.title = clampText(args.title) || view.title;
    if (args.kind !== undefined || args.text !== undefined || args.html !== undefined || args.component !== undefined) {
      view.kind = content.kind;
      view.text = content.text;
      view.html = content.html;
      view.component = content.component;
    }
    if (args.form !== undefined) view.form = normalizeForm(args.form);
    if (args.x !== undefined) view.x = Number.isFinite(args.x) ? args.x : null;
    if (args.y !== undefined) view.y = Number.isFinite(args.y) ? args.y : null;
    if (args.width !== undefined) view.width = Number.isFinite(args.width) ? args.width : null;
    if (args.height !== undefined) view.height = Number.isFinite(args.height) ? args.height : null;
    if (args.visible !== undefined) view.visible = args.visible !== false;
    view.updatedAt = now();
    return { ok: true, id, kind: view.kind, version: bump() };
  }

  function unregister(sessionId, args) {
    if (args.scope === 'session') {
      let n = 0;
      for (const [id, v] of [...state.views]) {
        if (v.sessionId === sessionId) { state.views.delete(id); n += 1; }
      }
      return { ok: true, scope: 'session', removed: n, version: bump() };
    }
    const id = args.id;
    if (!id) return { ok: false, error: 'unregister 需要 id，或传 scope:"session" 卸载本会话全部' };
    const view = state.views.get(id);
    if (!view) return { ok: false, error: `没有这个临时视图：${id}` };
    if (view.sessionId !== sessionId) return { ok: false, error: '只能卸载本会话的临时视图' };
    state.views.delete(id);
    return { ok: true, id, removed: 1, version: bump() };
  }

  function snapshot(sessionId, since) {
    if (Number.isFinite(since) && since === state.version) {
      return { version: state.version, views: null };   // 未变化：客户端零成本
    }
    return { version: state.version, views: listFor(sessionId) };
  }

  return { state, listFor, register, update, unregister, snapshot, limits: { MAX_TEXT, MAX_HTML, MAX_PROPS_BYTES } };
}
