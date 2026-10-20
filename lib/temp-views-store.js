/**
 * 临时视图（sidebar_temp_view）的宿主侧实现：内存 store + agent 工具 + 只读路由。
 *
 * 设计约束（见 docs/temp-views-tool.md）：
 *  - 只在宿主进程内存里存在，重启即全部消失；
 *  - 严格按会话（exec.agent.id）归属，只有该会话能看到；
 *  - 只接受声明式数据，不执行任何来自参数的内容；
 *  - 标题统一由客户端加 `【临时】` 前缀。
 */

/** 支持的视图形态（与 client 的 VIEW_FORMS 对齐）。 */
export const FORMS = ['mini', 'right', 'bottom', 'popup', 'mainView'];

const MAX_VIEWS_PER_SESSION = 20;
const MAX_TEXT = 4000;

function clampText(v) {
  const s = typeof v === 'string' ? v : '';
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s;
}

function normalizeForm(form) {
  if (Array.isArray(form)) {
    const out = form.filter((f) => FORMS.includes(f));
    return out.length ? out : ['mini'];
  }
  return FORMS.includes(form) ? [form] : ['mini'];
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
    const view = {
      id,
      sessionId,
      title: clampText(args.title) || '未命名',
      text: clampText(args.text),
      form: normalizeForm(args.form),
      width: Number.isFinite(args.width) ? args.width : null,
      height: Number.isFinite(args.height) ? args.height : null,
      visible: args.visible !== false,
      createdAt: existing ? existing.createdAt : now(),
      updatedAt: now(),
    };
    state.views.set(id, view);
    return { ok: true, id, version: bump() };
  }

  function update(sessionId, args) {
    const id = args.id;
    const view = state.views.get(id);
    if (!view) return { ok: false, error: `没有这个临时视图：${id}` };
    if (view.sessionId !== sessionId) return { ok: false, error: '只能修改本会话的临时视图' };
    if (args.title !== undefined) view.title = clampText(args.title) || view.title;
    if (args.text !== undefined) view.text = clampText(args.text);
    if (args.form !== undefined) view.form = normalizeForm(args.form);
    if (args.width !== undefined) view.width = Number.isFinite(args.width) ? args.width : null;
    if (args.height !== undefined) view.height = Number.isFinite(args.height) ? args.height : null;
    if (args.visible !== undefined) view.visible = args.visible !== false;
    view.updatedAt = now();
    return { ok: true, id, version: bump() };
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

  return { state, listFor, register, update, unregister, snapshot };
}