/*!
 * dsh-shinki-sidebar-tools client bundle.
 *
 * ① 滚动：给 tab 条（dockkit 的 _stripTabs_）加可见细滚动条、放开触摸平移；
 * ② 创建视图：在 strip 控件区（含「+」）右键弹出菜单，列出「已注册视图」与内置视图，
 *    点击即 ctx.sidebarRight.openTab(kind) 创建；同时往「+」打开的指南注入创建入口。
 *
 * 设计原则（吸取上一插件教训）：零注入（exports.inject = []）、服务一律 ctx.get 容错获取、
 * 任何一步失败只告警不影响宿主启动。
 */
window.__ModuleLoader__.load({
  id: 'dsh-shinki-sidebar-tools',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    let react = null;
    try { react = require('react'); } catch { /* 无 react 也能跑：菜单是纯 DOM */ }


    /* ═════════ 适配层：多形态视图（CONTRACT_VERSION 1）═════════
       消费方只声明一次：ctx.shinkiViews.register({ id, title, render, targets })
       由本层负责落到 bottom / mainView / popup 等形态；官方或第三方变化时只改本层。
       原则：能力探测 + 逐形态降级，任一形态失败只 warn 并跳过，绝不抛错、绝不阻塞宿主。 */
    const CONTRACT_VERSION = 3;   // v3: 新增 mini 形态（悬停/迷你窗口）；缺省等价 v2/v1
    let adapterCtx = null;   // 供 popup 保底路径（面板内全屏承载）使用
    let viewsSvcCache = null;   // provide 出来的服务句柄（本插件内部读取用；cordis 禁止未 inject 直接读属性）

    /** 安全取回适配层服务：ctx.get() 优先 → 缓存 → 属性（带 try），避免 "cannot get property … without inject"。 */
    function cacheViews(ctx) {
      if (viewsSvcCache) return viewsSvcCache;
      try { const v = ctx && ctx.get ? ctx.get('shinkiViews') : undefined; if (v) { viewsSvcCache = v; return v; } } catch { /* 忽略 */ }
      try { const v = ctx ? ctx.shinkiViews : undefined; if (v) { viewsSvcCache = v; return v; } } catch { /* cordis 属性陷阱 */ }
      return null;
    }
    const viewSpecs = new Map();     // id -> spec
    const viewHandles = new Map();   // id -> handle

    /** 安全取 react（弹窗与过渡桥需要；取不到则走纯 DOM 路径）。 */
    function safeRequire(name) { try { const m = require(name); return m && (m.default || m); } catch { return null; } }

    /** 打开 popup 形态视图 —— **默认在面板内全屏承载**（不调用 window.open，避免宿主把当前页跳转掉）。 */
    function openPopupView(id) {
      const spec = viewSpecs.get(id);
      try { PANEL.tabs = PANEL.tabs || new Set(); PANEL.tabs.add(id);
          PANEL.tabOrder = Array.isArray(PANEL.tabOrder) ? PANEL.tabOrder : []; if (!PANEL.tabOrder.includes(id)) PANEL.tabOrder.push(id);
          try { bpRenderTabs(); } catch { /* 忽略 */ } } catch { /* 忽略 */ }
      if (!spec) { console.warn('[dsh-shinki-sidebar-tools] 打开失败：未注册的视图 ' + id); return null; }
      try {
        mountDetached(adapterCtx, id, { inPanel: true });
        console.warn('[dsh-shinki-sidebar-tools] 已打开视图（面板内全屏承载）：' + id);
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 打开失败：' + (e && e.message)); }
      return null;
    }

    /** 可选：尝试真·独立窗口（window.open + postMessage 握手）。
     *  注意：QtWebEngine 未接管 createWindow 时会把该调用当成本视图跳转（表现为"闪一下刷新主页面"），
     *  故 **不作为默认路径**；默认请用 openPopupView（面板内全屏承载）。 */
    function openPopupWindow(id) {
      const spec = viewSpecs.get(id);
      try { PANEL.tabs = PANEL.tabs || new Set(); PANEL.tabs.add(id); } catch { /* 忽略 */ }
      if (!spec) { console.warn('[dsh-shinki-sidebar-tools] 弹窗失败：未注册的视图 ' + id); return null; }
      try {
        // 需要 opener 引用以便 postMessage ⇒ 不能用 noopener（同为本站同源，风险可接受）
        const w = window.open(location.origin + '/', '_blank', 'width=1000,height=720');
        // 该宿主（QtWebEngine）里 window.open 常常"闪一下就消失"：无论句柄是否存在，
        // 都在 1.2s 后确认窗口是否真的存活；不存活 ⇒ 自动降级为「面板内全屏承载」。
        const fallbackBg = spec.background || 'pause';
        console.warn('[dsh-shinki-sidebar-tools] popup 承载后台策略：' + id + ' → ' + fallbackBg);
        const fallback = () => {
          let alive = false;
          try { alive = !!(w && !w.closed && w.document !== undefined); } catch { alive = false; }
          if (!alive) {
            console.warn('[dsh-shinki-sidebar-tools] 独立窗口不可用（被拦截或立即关闭），改为面板内全屏承载：' + id);
            try { mountDetached(adapterCtx, id, { inPanel: true }); } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 面板内承载失败：' + (e && e.message)); }
          }
        };
        if (!w) { console.warn('[dsh-shinki-sidebar-tools] 弹窗被浏览器拦截（将改由面板内承载）'); setTimeout(fallback, 60); return null; }
        setTimeout(fallback, 1200);
        const send = () => { try { w.postMessage({ type: 'shinki-tools:mount', id, origin: location.origin }, location.origin); } catch { /* 忽略 */ } };
        setTimeout(send, 800); setTimeout(send, 2000); setTimeout(send, 4000);   // 页面加载时机不定，多次握手
        console.warn('[dsh-shinki-sidebar-tools] 已打开独立弹窗视图：' + id);
        return w;
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 弹窗打开失败：' + (e && e.message)); return null; }
    }

    /** 在独立窗口内全屏承载某个视图（由 postMessage 握手或 URL 参数触发）。 */
    function mountDetached(ctx, id, opts) {
      const spec = viewSpecs.get(id);
      try { PANEL.tabs = PANEL.tabs || new Set(); PANEL.tabs.add(id); } catch { /* 忽略 */ }
      if (!spec) { console.warn('[dsh-shinki-sidebar-tools] 弹窗收到未注册视图：' + id); return; }
      if (document.getElementById('shinki-tools-detached')) return;
      const inPanel = !!(opts && opts.inPanel);
      const closeSelf = () => { try { host.remove(); } catch { /* 忽略 */ } try { document.removeEventListener('keydown', onEsc, true); } catch { /* 忽略 */ } };
      const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeSelf(); } };
      const host = document.createElement('div');
      host.id = 'shinki-tools-detached';
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;'
        + 'background:var(--dsw-alias-bg-base,#14161a);color:var(--dsw-alias-label-primary,#e6edf3);overflow:hidden';
      document.body.appendChild(host);
      document.title = spec.title || id;
      let node = null;
      try {
        const wrapProps = Object.assign({ container: host, isDetached: !inPanel, close: () => (inPanel ? closeSelf() : window.close()), setTitle: (t) => { document.title = t || id; } }, (function () { try { return bsViewProps(sessionKeyNow, spec); } catch (e) { return {}; } })());
        node = (react && typeof react.createElement === 'function')
          ? react.createElement(wrapView(spec, 'popup'), wrapProps)
          : spec.render({ ...wrapProps, form: 'popup', background: spec.background || 'pause' });
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 弹窗渲染失败：' + (e && e.message)); }
      if (!node) return;
      if (inPanel) {
        // 面板内承载：适配层自绘关闭按钮 + Esc，避免视图没有出口
        const bar = document.createElement('div');
        bar.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:3px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12))';
        // 中段可滚动（视图按钮多时不挤压）；✕ 固定在最右 ⇒ 永远看得见
        const mid = document.createElement('div');
        try { PANEL.mid = mid; } catch { /* 忽略 */ }   // 记到 PANEL 上，后续只用属性（避免任何裸变量引用）
        mid.style.cssText = 'flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;overflow-x:auto';
        const lab = document.createElement('span'); lab.textContent = '工具面板'; lab.style.cssText = 'opacity:.65;flex:none'; mid.appendChild(lab);
        try {
          const addBtn = document.createElement('button');
          addBtn.textContent = '＋'; addBtn.title = '新增：打开一个已注册到底部的视图'; addBtn.setAttribute('aria-label', '新增视图'); addBtn.dataset.addBtn = '1';
          addBtn.style.cssText = 'flex:none;cursor:pointer;background:transparent;color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.22));border-radius:4px;padding:1px 8px';
          addBtn.addEventListener('click', (ev) => {
            try { ev.stopPropagation(); } catch { /* 忽略 */ }
            const list = bpList();
            if (!list.length) { console.warn('[dsh-shinki-sidebar-tools] 暂无注册到底部的视图'); return; }
            if (list.length === 1) { bpActivate(list[0].id); return; }
            // 简易下拉：列出所有 bottom 视图，点选即切换
            const old = document.getElementById('shinki-bp-addmenu'); if (old) old.remove();
            const menu = document.createElement('div'); menu.id = 'shinki-bp-addmenu';
            menu.style.cssText = 'position:absolute;z-index:99999;margin-top:4px;min-width:160px;background:var(--dsw-alias-bg-layer-2,#23262d);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.35);padding:4px';
            const rect = addBtn.getBoundingClientRect();
            menu.style.left = Math.max(8, rect.left) + 'px'; menu.style.top = (rect.bottom + 2) + 'px'; menu.style.position = 'fixed';
            // ★ 收起只在"点菜单/按钮以外"时发生：原来用 {once:true} 的 document mousedown 无差别移除，
            //   点菜单项时 mousedown 先把菜单从 DOM 删掉 ⇒ 随后的 click 落不到该项上 ⇒ 永远选不中视图。
            const dismiss = (e2) => {
              try {
                const t = e2 && e2.target;
                if (t && ((menu.contains && menu.contains(t)) || (addBtn.contains && addBtn.contains(t)))) return;
              } catch { /* 忽略 */ }
              try { menu.remove(); } catch { /* 忽略 */ }
              try { document.removeEventListener('mousedown', dismiss, true); } catch { /* 忽略 */ }
            };
            for (const v of list) {
              const it = document.createElement('button'); const _t = titleOf(v) || v.id;
              it.textContent = _t; it.style.cssText = 'display:block;width:100%;text-align:left;padding:5px 8px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer';
              it.addEventListener('click', (e2) => { try { e2.stopPropagation(); } catch { /* 忽略 */ } try { document.removeEventListener('mousedown', dismiss, true); } catch { /* 忽略 */ } menu.remove(); bpActivate(v.id); });
              menu.appendChild(it);
            }
            // ★ 迷你 / 悬停视图（若有注册）：点选即开/关
            try {
              const minis = miniList();
              if (minis.length) {
                const sep = document.createElement('div');
                sep.style.cssText = 'height:1px;margin:4px 2px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.12))';
                menu.appendChild(sep);
                const head2 = document.createElement('div');
                head2.textContent = '迷你 / 悬停视图';
                head2.style.cssText = 'padding:3px 8px;font-size:10px;opacity:.6';
                menu.appendChild(head2);
                for (const v of minis) {
                  const it2 = document.createElement('button');
                  const on2 = MINI.el && MINI.el.style.display !== 'none' && MINI.renderedId === v.id;
                  it2.textContent = (on2 ? '✓ 显示中：' : '🪟 已隐藏：') + (titleOf(v) || v.id);
                  it2.title = on2 ? '点击隐藏该悬停视图' : '点击显示该悬停视图';
                  it2.style.cssText = 'display:block;width:100%;text-align:left;padding:5px 8px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer';
                  it2.addEventListener('click', (e3) => { try { e3.stopPropagation(); } catch { /* 忽略 */ } try { document.removeEventListener('mousedown', dismiss, true); } catch { /* 忽略 */ } menu.remove(); miniToggle(v.id); });
                  menu.appendChild(it2);
                }
              }
            } catch { /* 忽略 */ }
            document.body.appendChild(menu);
            setTimeout(() => { try { document.addEventListener('mousedown', dismiss, true); } catch { /* 忽略 */ } }, 0);
          });
          mid.appendChild(addBtn);
        } catch { /* 忽略 */ }
        bar.appendChild(mid);
        const t = document.createElement('div');
        t.textContent = (spec.title || id) + '（面板内承载 · Esc 或 ✕ 关闭）';
        t.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        const x = document.createElement('button');
        x.textContent = '✕';
        x.title = '关闭（Esc）';
        x.style.cssText = 'cursor:pointer;background:transparent;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));color:inherit;border-radius:4px;padding:1px 8px';
        x.addEventListener('click', closeSelf);
        bar.appendChild(t); bar.appendChild(x); host.appendChild(bar);
        const body = document.createElement('div');
        body.setAttribute('data-shinki-view-body', '1');
        body.style.cssText = 'flex:1;min-height:0;overflow:auto';
        host.appendChild(body);
        document.addEventListener('keydown', onEsc, true);
        console.warn('[dsh-shinki-sidebar-tools] 已在面板内承载视图（✕/Esc 可关闭）：' + id);
      }
      const ReactDOM = safeRequire('react-dom/client') || safeRequire('react-dom');
      try {
        const mountInto = host.querySelector('[data-shinki-view-body]') || host;
        try { attachWheelScroll(mountInto); } catch { /* 忽略 */ }   // 同一套滚轮兜底
        if (ReactDOM && typeof ReactDOM.createRoot === 'function') ReactDOM.createRoot(mountInto).render(node);
        else if (ReactDOM && typeof ReactDOM.render === 'function') ReactDOM.render(node, mountInto);
        else if (node instanceof Node) mountInto.appendChild(node);
        else console.warn('[dsh-shinki-sidebar-tools] 弹窗：render 返回非 DOM 且无 react-dom，无法挂载');
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 弹窗挂载异常：' + (e && e.message)); }
    }

    /** 形态实现表：每项独立能力探测；不可用只 warn 并跳过。 */
    /* ══ 迷你 / 悬停窗口（形态 'mini'） ═══════════════════════════════════════════
     * 消费方提供**独立的**迷你视图实现（`spec.mini.render`，不是主视图复用）；
     * 三档规格（最大 240×240 / 400×400 / 500×500），**默认 240×80 紧凑条、右下角**；
     * 可悬停（控件条 hover 才出现）、可拖动、可调透明度、可关闭；
     * 位置 / 透明度 / 规格 / 可见性按「会话 + 视图」持久化（落在会话状态的 values.mini）。
     * ══════════════════════════════════════════════════════════════════════════ */
    const MINI_TIERS = {
      s: { max: [240, 240], compact: [240, 80], label: '240×240' },
      m: { max: [400, 400], compact: [400, 88], label: '400×400' },
      l: { max: [500, 500], compact: [500, 96], label: '500×500' },
    };
    const MINI_DEFAULT = { tier: 's', compact: true, x: null, y: null, opacity: 1, visible: false };
    /** 默认锚点（未拖动时）：右下角，且**避开本插件 FAB**（FAB 在 right:8/bottom:8、26×26）。 */
    const MINI_ANCHOR = { right: 12, bottom: 44 };
    const MINI_MIN_OPACITY = 0.25;
    const MINI_Z = 9000;                      // 高于会话/浮层(60)与本插件底部栏(100)，低于菜单(99998+)/FAB
    const MINI = { el: null, bar: null, body: null, spec: null, root: null, renderedId: null, css: false };

    /** mini 形态的规格：spec.mini 可以是 render 函数，也可以是 {render, defaultVisible, only}。 */
    function miniSpecOf(spec) {
      try {
        const m = spec && spec.mini;
        if (typeof m === 'function') return { render: m };
        if (m && typeof m.render === 'function') return m;
      } catch { /* 忽略 */ }
      return null;
    }
    function miniList() {
      try { return [...viewSpecs.values()].filter((v) => miniSpecOf(v)); } catch { return []; }
    }
    function miniStateAll() {
      try {
        const st = sessionStateGet(sessionKeyNow);
        const m = ((st || {}).values || {}).mini || {};
        return { active: m.active || null, byView: (m.byView && typeof m.byView === 'object') ? m.byView : {} };
      } catch { return { active: null, byView: {} }; }
    }
    /** 当前正在显示的 mini 视图 id（没有则 null）。 */
    function miniActiveId() { try { return miniStateAll().active; } catch { return null; } }
    function miniStateOf(viewId) {
      const all = miniStateAll();
      const one = all.byView[viewId] || {};
      return Object.assign({}, MINI_DEFAULT, one);
    }
    function miniWrite(viewId, patch, opts) {
      try {
        const st = sessionStateGet(sessionKeyNow);
        if (!st.values || typeof st.values !== 'object') st.values = {};
        if (!st.values.mini || typeof st.values.mini !== 'object') st.values.mini = { active: null, byView: {} };
        const m = st.values.mini;
        if (!m.byView || typeof m.byView !== 'object') m.byView = {};
        if (viewId) m.byView[viewId] = Object.assign(miniStateOf(viewId), patch || {});
        if (opts && 'active' in opts) m.active = opts.active;
        sessionSchedulePersist(sessionKeyNow, st);
        return m.byView[viewId] || null;
      } catch { return null; }
    }
    /** 当前尺寸：紧凑条 or 该档最大（规格即"最大 WxH"）。 */
    function miniSizeOf(st) {
      const tier = MINI_TIERS[st.tier] ? st.tier : 's';
      const t = MINI_TIERS[tier];
      const wh = st.compact ? t.compact : t.max;
      return { tier, compact: !!st.compact, w: wh[0], h: wh[1], max: t.max };
    }
    function miniClampXY(x, y, w, h) {
      let vw = 1200, vh = 800;
      try { vw = window.innerWidth || vw; vh = visibleViewportH() || vh; } catch { /* 忽略 */ }
      const nx = (x === null || x === undefined) ? null : Math.max(4, Math.min(Math.max(4, vw - w - 4), Math.round(x)));
      const ny = (y === null || y === undefined) ? null : Math.max(4, Math.min(Math.max(4, vh - h - 4), Math.round(y)));
      return { x: nx, y: ny };
    }
    function miniApplyGeometry(st) {
      try {
        if (!MINI.el) return;
        const sz = miniSizeOf(st);
        const pos = miniClampXY(st.x, st.y, sz.w, sz.h);
        MINI.el.style.width = sz.w + 'px';
        MINI.el.style.height = sz.h + 'px';
        MINI.el.style.opacity = String(Math.max(MINI_MIN_OPACITY, Math.min(1, Number(st.opacity) || 1)));
        if (pos.x === null || pos.y === null) {          // 未拖过 ⇒ 锚右下角（窗口缩放时自动跟随）
          MINI.el.style.left = 'auto'; MINI.el.style.top = 'auto';
          MINI.el.style.right = MINI_ANCHOR.right + 'px'; MINI.el.style.bottom = MINI_ANCHOR.bottom + 'px';
        } else {
          MINI.el.style.left = pos.x + 'px'; MINI.el.style.top = pos.y + 'px';
          MINI.el.style.right = 'auto'; MINI.el.style.bottom = 'auto';
        }
        MINI.el.setAttribute('data-shinki-mini-tier', sz.tier);
        MINI.el.setAttribute('data-shinki-mini-compact', sz.compact ? '1' : '0');
        try { const sl = MINI.bar && MINI.bar.querySelector('[data-shinki-mini-opacity]'); if (sl) sl.value = String(Math.round(Math.max(MINI_MIN_OPACITY, Math.min(1, Number(st.opacity) || 1)) * 100)); } catch { /* 忽略 */ }
        try { const lb = MINI.bar && MINI.bar.querySelector('[data-shinki-mini-size]'); if (lb) lb.textContent = sz.w + '×' + sz.h; } catch { /* 忽略 */ }
        return sz;
      } catch { return null; }
    }
    function injectMiniCss() {
      if (MINI.css || typeof document === 'undefined') return;
      MINI.css = true;
      try {
        const el = document.createElement('style');
        el.id = KIND + '-mini-css';
        el.textContent = `
          #shinki-tools-mini {
            position: fixed; z-index: ${MINI_Z}; box-sizing: border-box;
            display: flex; flex-direction: column; overflow: hidden;
            border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16));
            background: var(--dsw-alias-bg-layer-1, #1b1d22);
            box-shadow: 0 10px 26px -12px rgba(0,0,0,.6), 0 2px 8px rgba(0,0,0,.28);
            color: var(--dsw-alias-label-primary, #e6e8ee);
            font-size: 12px; touch-action: none;
            transition: box-shadow .12s ease, border-color .12s ease;
          }
          #shinki-tools-mini:hover { border-color: var(--dsw-alias-brand-primary, #4d6bfe); }
          #shinki-tools-mini[data-shinki-mini-dragging="1"] { box-shadow: 0 16px 34px -12px rgba(0,0,0,.7); border-color: var(--dsw-alias-brand-primary, #4d6bfe); }
          #shinki-tools-mini > [data-shinki-mini-body] { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; }
          #shinki-tools-mini > [data-shinki-mini-body] > * { flex: 1 1 auto; min-width: 0; min-height: 0; }
          #shinki-tools-mini .shst-mini-bar {
            position: absolute; left: 0; right: 0; top: 0; height: 22px; z-index: 3;
            display: flex; align-items: center; gap: 4px; padding: 0 4px;
            background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #1b1d22) 88%, transparent);
            border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));
            opacity: 0; pointer-events: none; transition: opacity .12s ease;
          }
          #shinki-tools-mini:hover .shst-mini-bar,
          #shinki-tools-mini[data-shinki-mini-dragging="1"] .shst-mini-bar,
          #shinki-tools-mini[data-shinki-mini-bar="pinned"] .shst-mini-bar { opacity: 1; pointer-events: auto; }
          #shinki-tools-mini .shst-mini-grip { cursor: move; flex: none; padding: 0 3px; opacity: .75; letter-spacing: -1px; }
          #shinki-tools-mini .shst-mini-bar button {
            flex: none; cursor: pointer; border: none; background: 0 0; color: inherit;
            font-size: 10px; line-height: 18px; height: 18px; padding: 0 4px; border-radius: 4px; opacity: .8;
          }
          #shinki-tools-mini .shst-mini-bar button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); opacity: 1; }
          #shinki-tools-mini .shst-mini-bar button[data-on="1"] { color: var(--dsw-alias-brand-primary, #4d6bfe); opacity: 1; font-weight: 600; }
          #shinki-tools-mini .shst-mini-bar input[type=range] { flex: none; width: 54px; height: 14px; margin: 0 2px; opacity: .85; }
          #shinki-tools-mini .shst-mini-size { flex: none; font-size: 10px; opacity: .55; padding: 0 2px; white-space: nowrap; }
          #shinki-tools-mini .shst-mini-sp { flex: 1 1 auto; }
        `;
        (document.head || document.body).appendChild(el);
      } catch { /* 忽略 */ }
    }
    function miniEnsureDom() {
      if (MINI.el && MINI.el.isConnected !== false) return MINI.el;
      try {
        injectMiniCss();
        const el = document.createElement('div');
        el.id = 'shinki-tools-mini';
        el.setAttribute('data-shinki-mini', '1');
        el.style.display = 'none';
        const body = document.createElement('div');
        body.setAttribute('data-shinki-mini-body', '1');
        const bar = document.createElement('div');
        bar.className = 'shst-mini-bar';
        bar.setAttribute('data-shinki-mini-bar', '1');
        // 拖动握把
        const grip = document.createElement('span');
        grip.className = 'shst-mini-grip'; grip.textContent = '⠿'; grip.title = '按住拖动';
        bar.appendChild(grip);
        // 三档规格（即"最大 WxH"）+ 紧凑条
        for (const tier of ['s', 'm', 'l']) {
          const b = document.createElement('button');
          b.setAttribute('data-shinki-mini-tier-btn', tier);
          b.textContent = MINI_TIERS[tier].label;
          b.title = '规格（最大 ' + MINI_TIERS[tier].label + '）';
          b.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch { /* 忽略 */ } miniSetTier(tier); });
          bar.appendChild(b);
        }
        const cp = document.createElement('button');
        cp.setAttribute('data-shinki-mini-compact-btn', '1'); cp.textContent = '▭ 紧凑'; cp.title = '回到紧凑条（默认 240×80）';
        cp.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch { /* 忽略 */ } miniSetCompact(true); });
        bar.appendChild(cp);
        bar.appendChild((function () { const s = document.createElement('span'); s.className = 'shst-mini-size'; s.setAttribute('data-shinki-mini-size', '1'); return s; })());
        bar.appendChild((function () { const s = document.createElement('span'); s.className = 'shst-mini-sp'; return s; })());
        // 透明度
        const op = document.createElement('input');
        op.type = 'range'; op.min = String(Math.round(MINI_MIN_OPACITY * 100)); op.max = '100'; op.step = '5';
        op.setAttribute('data-shinki-mini-opacity', '1'); op.title = '透明度';
        op.addEventListener('input', () => { try { const v = Math.max(MINI_MIN_OPACITY, Math.min(1, Number(op.value) / 100)); if (MINI.el) MINI.el.style.opacity = String(v); miniWrite(MINI.renderedId, { opacity: v }); } catch { /* 忽略 */ } });
        op.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch { /* 忽略 */ } });
        bar.appendChild(op);
        // 切换（多个 mini 时）
        const sw = document.createElement('button');
        sw.setAttribute('data-shinki-mini-switch', '1'); sw.textContent = '⇄'; sw.title = '切换迷你视图';
        sw.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch { /* 忽略 */ } miniCycle(); });
        bar.appendChild(sw);
        // 关闭
        const cl = document.createElement('button');
        cl.setAttribute('data-shinki-mini-close', '1'); cl.textContent = '✕'; cl.title = '隐藏该悬停视图（位置/透明度等保留，可从 ≡ 菜单再打开）';
        cl.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch { /* 忽略 */ } miniHide(); });
        bar.appendChild(cl);
        el.appendChild(bar);
        el.appendChild(body);
        // 拖动：整个窗口可拖（按钮/滑块等交互元素除外）
        el.addEventListener('mousedown', miniDragStart);
        (document.body || document.documentElement).appendChild(el);
        MINI.el = el; MINI.bar = bar; MINI.body = body;
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 迷你窗口创建失败：' + (e && e.message)); }
      return MINI.el;
    }
    function miniDragStart(ev) {
      try {
        if (!ev || ev.button === 2) return;
        const t = ev.target;
        if (t && t.closest && t.closest('button,input,select,textarea,a,[data-shinki-mini-nodrag]')) return;
        if (!MINI.el) return;
        ev.preventDefault();
        const r = MINI.el.getBoundingClientRect ? MINI.el.getBoundingClientRect() : { left: 0, top: 0, width: 240, height: 80 };
        const dx = (ev.clientX || 0) - r.left, dy = (ev.clientY || 0) - r.top;
        const w = r.width || 240, h = r.height || 80;
        try { MINI.el.setAttribute('data-shinki-mini-dragging', '1'); } catch { /* 忽略 */ }
        const mv = (e2) => {
          const p = miniClampXY((e2.clientX || 0) - dx, (e2.clientY || 0) - dy, w, h);
          try {
            MINI.el.style.left = p.x + 'px'; MINI.el.style.top = p.y + 'px';
            MINI.el.style.right = 'auto'; MINI.el.style.bottom = 'auto';
          } catch { /* 忽略 */ }
        };
        const up = (e2) => {
          try { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); } catch { /* 忽略 */ }
          try { MINI.el.removeAttribute('data-shinki-mini-dragging'); } catch { /* 忽略 */ }
          const p = miniClampXY((e2 && e2.clientX !== undefined ? e2.clientX : 0) - dx, (e2 && e2.clientY !== undefined ? e2.clientY : 0) - dy, w, h);
          if (p.x !== null && p.y !== null) miniWrite(MINI.renderedId, { x: p.x, y: p.y });
        };
        document.addEventListener('mousemove', mv);
        document.addEventListener('mouseup', up);
      } catch { /* 忽略 */ }
    }
    function miniRenderInto(spec, st) {
      try {
        const sz = miniSizeOf(st);
        const m = miniSpecOf(spec);
        if (!m) return;
        const node = (function () {
          try { return wrapMiniView(spec, m, sz); } catch (e) { return react.createElement('div', { style: { padding: '6px', fontSize: '11px', opacity: .8 } }, '迷你视图渲染失败：' + (e && e.message)); }
        })();
        const RD = safeRequire('react-dom');
        const guarded = makeViewBoundary(react, spec, node);
        if (RD && typeof RD.createRoot === 'function') {
          if (!MINI.root) MINI.root = RD.createRoot(MINI.body);
          MINI.root.render(guarded);
        } else if (RD && typeof RD.render === 'function') {
          RD.render(guarded, MINI.body);
        }
        MINI.renderedId = spec.id;
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 迷你视图渲染异常：' + (e && e.message)); }
    }
    /** 迷你视图的 props：适配层字段 + 规格信息 + better-sidebar 口径 props（消费方两种写法都能用）。 */
    function wrapMiniView(spec, m, sz) {
      const st = miniStateOf(spec.id);
      const props = Object.assign({
        form: 'mini',
        container: MINI.body,
        tier: sz.tier, compact: sz.compact, width: sz.w, height: sz.h, maxWidth: sz.max[0], maxHeight: sz.max[1],
        setTier: (t) => miniSetTier(t),
        setCompact: (c) => miniSetCompact(!!c),
        setOpacity: (o) => miniSetOpacity(o),
        close: () => { try { miniHide(); } catch { /* 忽略 */ } },
        setTitle: (t) => { try { setViewTitle(spec, t); } catch { /* 忽略 */ } },
        isDetached: false,
      }, (function () { try { return bsViewProps(sessionKeyNow, spec); } catch (e) { return {}; } })(), { visible: true });
      try { return react.createElement(m.render, props); } catch (e) { return react.createElement('div', { style: { padding: '6px' } }, '迷你视图构造失败：' + (e && e.message)); }
    }
    function miniShow(viewId) {
      try {
        const spec = viewSpecs.get(viewId);
        if (!spec || !miniSpecOf(spec)) { console.warn('[dsh-shinki-sidebar-tools] 迷你视图不存在：' + viewId); return false; }
        miniEnsureDom();
        if (!MINI.el) return false;
        const st = Object.assign(miniStateOf(viewId), { visible: true });
        MINI.spec = spec;
        miniWrite(viewId, { visible: true }, { active: viewId });
        MINI.el.style.display = 'flex';
        miniApplyGeometry(st);
        if (MINI.renderedId !== viewId) miniRenderInto(spec, st);
        else { try { MINI.root && MINI.root.render(makeViewBoundary(react, spec, wrapMiniView(spec, miniSpecOf(spec), miniSizeOf(st)))); } catch { /* 忽略 */ } }
        const sw = MINI.bar && MINI.bar.querySelector('[data-shinki-mini-switch]');
        if (sw) sw.style.display = miniList().length > 1 ? '' : 'none';
        return true;
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 迷你视图显示失败：' + (e && e.message)); return false; }
    }
    function miniHide() {
      try {
        if (MINI.renderedId) miniWrite(MINI.renderedId, { visible: false }, { active: null });
        if (MINI.el) MINI.el.style.display = 'none';
        return true;
      } catch { return false; }
    }
    function miniToggle(viewId) {
      const cur = MINI.el && MINI.el.style.display !== 'none' && MINI.renderedId === viewId;
      return cur ? miniHide() : miniShow(viewId);
    }
    function miniCycle() {
      try {
        const list = miniList();
        if (list.length < 2) return;
        const i = list.findIndex((v) => v.id === MINI.renderedId);
        const next = list[(i + 1 + list.length) % list.length];
        if (next) miniShow(next.id);
      } catch { /* 忽略 */ }
    }
    function miniSetTier(tier) {
      try {
        if (!MINI_TIERS[tier] || !MINI.renderedId) return;
        const st = miniWrite(MINI.renderedId, { tier, compact: false });
        miniApplyGeometry(st || Object.assign(miniStateOf(MINI.renderedId), { tier, compact: false }));
        const spec = viewSpecs.get(MINI.renderedId);
        if (spec) miniRenderInto(spec, miniStateOf(MINI.renderedId));
        console.warn('[dsh-shinki-sidebar-tools] 迷你视图规格：' + MINI.renderedId + ' → 最大 ' + MINI_TIERS[tier].label);
      } catch { /* 忽略 */ }
    }
    function miniSetCompact(compact) {
      try {
        if (!MINI.renderedId) return;
        const st = miniWrite(MINI.renderedId, { compact: !!compact });
        miniApplyGeometry(st || Object.assign(miniStateOf(MINI.renderedId), { compact: !!compact }));
        const spec = viewSpecs.get(MINI.renderedId);
        if (spec) miniRenderInto(spec, miniStateOf(MINI.renderedId));
      } catch { /* 忽略 */ }
    }
    function miniSetOpacity(o) {
      try {
        const v = Math.max(MINI_MIN_OPACITY, Math.min(1, Number(o) || 1));
        if (MINI.el) MINI.el.style.opacity = String(v);
        if (MINI.renderedId) miniWrite(MINI.renderedId, { opacity: v });
      } catch { /* 忽略 */ }
    }
    /** 注册后按记录/默认决定是否显示：**缺省不显示**，只有 provider 显式 mini.defaultVisible === true 才启动即显示。 */
    function miniMaybeAutoShow(spec) {
      try {
        const m = miniSpecOf(spec);
        const st = miniStateOf(spec.id);
        const has = !!(miniStateAll().byView[spec.id]);
        // ★ 默认**不显示**：仅当 provider 显式声明 mini.defaultVisible === true 时启动即显示（用户 2026-10-09 要求）
        const want = has ? st.visible : (m && m.defaultVisible === true);
        if (!want) return;
        const active = miniActiveId();
        if (active && active !== spec.id && (MINI.el && MINI.el.style.display !== 'none')) return;   // 已在显示别的 mini 就不抢
        miniShow(spec.id);
      } catch { /* 忽略 */ }
    }
    /** 会话切换：重算当前 mini（可见性/位置/规格都跟着会话走）。 */
    function miniApplySession() {
      try {
        const active = miniActiveId();   // ← 曾经在清理调试时被误删 ⇒ 引用未定义 ⇒ 静默抛错、切会话不生效
        if (active && viewSpecs.has(active)) { miniShow(active); return; }
        const list = miniList();
        for (const v of list) { if (miniStateOf(v.id).visible) { miniShow(v.id); return; } }
        if (MINI.el) MINI.el.style.display = 'none';
        MINI.renderedId = null;
      } catch { /* 忽略 */ }
    }
    function miniOnViewportChange() {
      try { if (MINI.el && MINI.el.style.display !== 'none' && MINI.renderedId) miniApplyGeometry(miniStateOf(MINI.renderedId)); } catch { /* 忽略 */ }
    }
    /** 官方右栏入口注册（`sidebarRightTabs` + `sidebar.right.pane.tab`）—— `bottom` 与 `right` 两个形态共用。
     *  同一 id 只注册一次：消费方常规写法 `targets:['bottom','right']` 不能因此出现两个 tab。 */
    const RAIL_REGISTERED = new Set();
    function registerRightRail(ctx, spec, tag) {
      try {
        if (!spec || !spec.id) return;
        if (RAIL_REGISTERED.has(spec.id)) return;
        RAIL_REGISTERED.add(spec.id);
      } catch { /* 忽略 */ }
      waitFor(ctx, ['sidebarRightTabs', 'slots', 'sidebarRight'], () => {
        try {
          const reg = svc(ctx, 'sidebarRightTabs');
          const slots = svc(ctx, 'slots');
          if (!reg || typeof reg.register !== 'function' || !slots || typeof slots.inject !== 'function') return;
          try {
            reg.register({ id: spec.id, kind: spec.id, priority: 'extension', title: () => titleOf(spec) });
          } catch (e) {
            if (!/already registered/i.test(e && e.message)) throw e;
          }
          // 注意：右栏承载的视图沿用 form:'bottom'（与历史行为一致，消费方可能按 form 分支）
          const Body = slotHostView(spec, 'bottom');
          slots.inject('sidebar.right.pane.tab', () => slots.register({
            name: 'sidebar.right.pane.tab', key: spec.id, title: () => titleOf(spec),
          }, Body));
          console.warn('[dsh-shinki-sidebar-tools] 已注册视图入口（官方右栏 + ≡→可创建）：' + spec.id);
        } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 入口注册失败：' + (e && e.message)); }
      }, tag || ('dsh-shinki-sidebar-tools: rail-entry ' + (spec && spec.id)));
    }

    const VIEW_FORMS = {
      popup(ctx, spec) { /* 登记即可，按需 openPopupView(spec.id) */ },
      bottom(ctx, spec) {
        // ① 官方右栏注册（**入口**：≡ → 可创建 读的就是这个注册表；右侧栏也用它）
        registerRightRail(ctx, spec, 'dsh-shinki-sidebar-tools: bottom-entry ' + spec.id);
      },
      /** `right`：只注册官方右栏入口（与 bottom 共用同一段注册 ⇒ 同 id 不会重复出 tab）。
       *  消费方写 `targets:['bottom','right']` 时不再出现「未知形态已跳过：right」噪音。 */
      right(ctx, spec) {
        registerRightRail(ctx, spec, 'dsh-shinki-sidebar-tools: right-entry ' + spec.id);
      },
      mainView(ctx, spec) {
        // 与「对话 / 轨迹」同级的主视图：官方 slots 的 conversation.view 槽位
        // （依据：官方 registerTrajectoryConversationView 内部即 ctx.uiConversation.views.register，
        //   而轨迹 tab 本身由 slots.inject("conversation.view") 注册）
        waitFor(ctx, ['slots'], () => {
          try {
            const slots = svc(ctx, 'slots');
            if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
              console.warn('[dsh-shinki-sidebar-tools] mainView 不可用（slots 缺 inject/register）：' + spec.id);
              return;
            }
            const order = spec.order == null ? 50 : spec.order;
            const label = () => titleOf(spec);
            const viewProps = (extra) => ({
              container: null, form: 'mainView', isDetached: false,
              background: spec.background || normalizeBackground(spec.background),
              close: () => {}, setTitle: () => {}, ...(extra || {}),
            });

            // 视图区渲染方式（官方 conversation 包源码）：renderSlot("conversation.view", …, { only: viewId })
            // 只渲染「该条目自己的组件」，且官方注册组件用的是 slots.register(options, Component) 的**第二个参数**。
            const Body = slotHostView(spec, 'mainView');
            const off1 = slots.inject('conversation.view', () => slots.register({
              name: 'conversation.view',
              id: spec.id,
              order: order,
              label: label,
              inject: () => ({}),
            }, Body));

            console.warn('[dsh-shinki-sidebar-tools] mainView 形态已注册：' + spec.id
              + '（conversation.view 条目 + 组件作为 register 第二参数；order=' + order + '）');
          } catch (e) {
            console.warn('[dsh-shinki-sidebar-tools] mainView 注册失败（已跳过该形态）：' + (e && e.message));
          }
        }, 'dsh-shinki-sidebar-tools');
      },
      /** 迷你 / 悬停窗口：消费方给**单独的** spec.mini.render；此处只登记 + 按记录决定是否显示。 */
      mini(ctx, spec) {
        try {
          const m = miniSpecOf(spec);
          if (!m) { console.warn('[dsh-shinki-sidebar-tools] mini 形态需要 spec.mini.render（单独的迷你视图实现）：' + spec.id); return; }
          injectMiniCss();
          console.warn('[dsh-shinki-sidebar-tools] 迷你视图已注册：' + spec.id
            + '（' + (m.defaultVisible === true ? '启动即显示：240×80 右下角' : '默认不显示（从 ≡ 菜单 / ＋ 下拉打开）') + '；规格可选 240×240 / 400×400 / 500×500）');
          miniMaybeAutoShow(spec);
        } catch (e) { console.warn('[dsh-shinki-sidebar-tools] mini 形态注册失败（已跳过）：' + (e && e.message)); }
      },
    };

    /**
     * 后台策略（background）：声明"组件卸载（切视图/收起）时播放器怎么办"。
     *   'pause'（默认）  暂停，保留队列与进度
     *   'remember'       暂停并记住进度，切回恢复（不自动播）
     *   'stop'           停止并清空队列、释放资源
     *   'force'（true）  强制后台：切视图不中断播放（消费方需自行把播放核心提到组件之外）
     * 适配层负责校验并把它作为 props.background 透传给 render，由消费方按此行事。
     */
    const BG_POLICIES = ['pause', 'remember', 'stop', 'force'];

    /* ───── 下方面板（按 docs/reference-bottom-panel.md 的约束实现）─────
       约束（来自参考实现研究与实测教训）：
       ① 作为会话中间列的**在流子节点**（flex:0 0 auto + 明确高度）⇒ 占位、把内容顶上去、宽度随列
          （不做 rect 计算、不用绝对定位 ⇒ 不会跑偏/遮挡 ✅）
       ② 挂载**轮询等待列出现**（启动时列还没渲染）
       ③ 内容**交给 React 渲染**（直接调用组件函数 ⇒ Invalid hook call #321）
       ④ **不写死 min-height**（否则折叠收不下去）；折叠时**隐藏内容**
       ⑤ 顶部 6px 拖高条；✕/▾ 折叠为 26px 细条（永远找得回） */
    const PANEL = { el: null, bar: null, host: null, active: null, height: 220, root: null, tries: 0 };

    function bpCol() {
        // 参考 dsh-better-sidebar@0.24.1 的 center-column.ts：
        // 会话槽宿主是 display:contents（不渲染盒子，rect 全 0）⇒ 必须向上跳过它，
        // 取第一个"计算 display !== contents"的祖先 = 真正的中央列。
        try {
          const hosts = ['[data-slot="main.conversation"]', '[data-slot="conversation"]',
                         '[data-slot="conversation.session"]'];
          let host = null;
          for (const sel of hosts) { const el = document.querySelector(sel); if (el) { host = el; break; } }
          if (!host) return null;
          let node = host;
          while (node && node !== document.body && getComputedStyle(node).display === 'contents') node = node.parentElement;
          if (node && node !== document.body) { try { node.setAttribute('data-shinki-center-col', ''); } catch (e) {} }
          try { const _r = (node && node !== document.body ? node : host.parentElement).getBoundingClientRect(); console.warn('[dsh-shinki-sidebar-tools] 中央列解析：tag=' + (node ? node.tagName : '-') + ' slot=' + ((node && node.getAttribute && node.getAttribute('data-slot')) || '-') + ' display=' + (node ? getComputedStyle(node).display : '-') + ' rect=' + Math.round(_r.left) + ',' + Math.round(_r.right) + ' w=' + Math.round(_r.width)); } catch (e) {}
          return (node && node !== document.body) ? node : host.parentElement;
        } catch (e) { return null; }
      }
    function bpOverlayHost() {
        try {
          let h = document.getElementById('shinki-bp-overlay');
          if (!h) {
            h = document.createElement('div');
            h.id = 'shinki-bp-overlay';
            h.setAttribute('data-shinki-bp-host', '1');
            // 层次：只比会话内容高，低于 float(60)/菜单(1100)/本插件菜单(99998+)/全屏承载(2147483000)
            // ★ 横向范围只认"会话列"槽位，**不再回退到 main**（main 是整屏，会做出通栏面板）
            const _colSel = '[data-slot="main.conversation"], [data-slot="conversation"], [data-slot="conversation.session"]';
            h.style.cssText = 'position:fixed;bottom:0;z-index:100;display:flex;flex-direction:column;'
              + 'left:' + (function(){ try { const c = document.querySelector(_colSel); const r = c && c.getBoundingClientRect(); return Math.max(0, (r ? r.left : 0)) + 'px'; } catch { return '0px'; } })() + ';'
              + 'width:' + (function(){ try { const c = document.querySelector(_colSel); const r = c && c.getBoundingClientRect(); return (r && r.width > 200 ? r.width : Math.min(900, (window.innerWidth||900))) + 'px'; } catch { return 'min(900px,100vw)'; } })() + ';'
              + 'height:' + PANEL.height + 'px;background:var(--dsw-alias-bg-layer-1,#1b1d22);'
              + 'border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));box-shadow:0 -6px 20px rgba(0,0,0,.28)';
            document.body.appendChild(h);
          }
          return h;
        } catch { return null; }
      }
      /** 找到真正滚动的容器（body/root 常常不滚动，paddingBottom 加它们等于没加）。 */
      function bpScrollHosts() {
        const out = [];
        try {
          document.querySelectorAll('div,section,main').forEach((el) => {
            try {
              const st = getComputedStyle(el);
              if (/(auto|scroll|overlay)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 4) out.push(el);
            } catch { /* 忽略 */ }
          });
          // ★ 不再无条件把 body / <html> / #root 塞进来：给它们加 padding-bottom 不会让任何东西能滚动，
          //   只会把文档整体撑高 ⇒ 页尾多出一条「大片空白」（往下滚就能看到）。只认真正在滚动的容器。
          if (!out.length) { const r0 = document.getElementById('root'); if (r0 && r0.scrollHeight > r0.clientHeight + 4) out.push(r0); }
        } catch { /* 忽略 */ }
        return out.filter(Boolean);
      }
      /** 给滚动容器预留/还原底部空间（内容不被底部栏盖住，可完整滚到底）。 */
      /** 照 better-sidebar 的 writeGeometry：把底部栏高度写成 **CSS 变量**，
       *  面板高度与"内容让位"都由它驱动 ⇒ 关闭时置 0 ⇒ 让位空间自动为 0（不可能残留空白）。 */
      /** 把固定面板锚定到**会话列**的横向范围（否则整屏通栏会盖住左右侧栏）。 */
      function positionPanel() {
        // 参考 use-center-column.ts：bottom.style.left = rect.left; right = innerWidth - rect.right
        try {
          if (!PANEL.el) return;
          const col = bpCol();
          const r = col && col.getBoundingClientRect ? col.getBoundingClientRect() : null;
          if (!col || !r || r.width < 120) {
            // ★ 量不到会话列时**绝不退回"整屏通栏"**——那正是用户看到的"面板占满整个视图"的成因。
            //   做法：先隐藏，然后按帧/定时重测；列出现并定位成功后才显示。最多重试 ~15s。
            try { PANEL.el.style.visibility = 'hidden'; } catch (e1) { /* 忽略 */ }
            if (!PANEL.__posRetry) {
              PANEL.__posRetry = 1;
              let tries = 0;
              const retry = () => {
                tries += 1;
                try { positionPanel(); } catch (e2) { /* 忽略 */ }
                const stillHidden = (() => { try { return PANEL.el && PANEL.el.style.visibility === 'hidden'; } catch (e3) { return false; } })();
                if (tries < 60 && stillHidden) { try { setTimeout(retry, 250); } catch (e4) { /* 忽略 */ } }
                else { try { delete PANEL.__posRetry; } catch (e5) { /* 忽略 */ } }
              };
              try { requestAnimationFrame(retry); } catch (e6) { try { setTimeout(retry, 250); } catch (e7) { /* 忽略 */ } }
            }
            return;
          }
          try { PANEL.el.style.visibility = 'visible'; } catch (e8) { /* 忽略 */ }
          PANEL.el.style.left = Math.round(r.left) + 'px';
          PANEL.el.style.right = Math.round((window.innerWidth || 1200) - r.right) + 'px';
          PANEL.el.style.width = 'auto';
          // ★ 布局视口比可见视口高时，bottom:0 会把面板底部一截放到看不见的地方（滚动范围也不含它）⇒ 抬高
          const gap = viewportBottomGap();
          try { PANEL.el.style.bottom = gap + 'px'; } catch (e0) { /* 忽略 */ }
        } catch (e) {}
      }

            try { if (!window.__shinkiPanelResize) { window.__shinkiPanelResize = 1; window.addEventListener('resize', function () { try { positionPanel(); } catch (e) {} try { miniOnViewportChange(); } catch (e) {} }); } } catch (e) {}

      /** 所有被本层加过「让位」padding 的元素。关闭/收起时按这个集合回收 ——
       *  只遍历当前可滚动元素是不够的：元素可能已不再滚动或已脱离 DOM，那样 padding 会永久残留。 */
      const PADDED = new Set();
      function clearLetThrough() {
        for (const el of [...PADDED]) {
          try {
            PADDED.delete(el);
            // 新机制：列的 margin-bottom
            if (el.dataset && el.dataset.shinkiColPad !== undefined) { el.style.marginBottom = el.dataset.shinkiColPad || ''; delete el.dataset.shinkiColPad; }
            // 旧机制残留：滚动容器的 padding-bottom（会造成"会话末尾一条空白"）——必须一并清掉
            if (el.dataset && el.dataset.shinkiPadVar !== undefined) { el.style.paddingBottom = el.dataset.shinkiPadVar || ''; delete el.dataset.shinkiPadVar; }
            el.style.scrollPaddingBottom = '';
          } catch { /* 忽略 */ }
        }
      }

function writeGeometry(h) {
        try {
          // no active view yet (e.g. just refreshed with remembered-open) => push 0, else the column lifts with no panel (blank)
          // ★ 例外：调用方显式要求"空面板"（force）时按给定高度显示 —— 用于"本会话还没有打开的视图"的空态，
          //   否则「展开」会变成一个按了没反应的按钮（用户必须先有办法用 TAB 条的 ＋ 添加视图）。
          const _forceShow = !!(arguments.length > 1 && arguments[1] && arguments[1].force);
          const _hasView = _forceShow || !!(PANEL.active && PANEL.tabOrder && PANEL.tabOrder.length);
          const v = _hasView ? Math.max(0, Math.round(Number(h) || 0)) : 0;
          // 隐藏的两种情形必须都覆盖，否则会留一条空固定条（或残留 1px 上边框）：
          //   ① 无活动视图（刷新后记住的开启状态还没激活视图）② 高度归零（✕ 彻底隐藏 / close() 收起）
          const _hide = v <= 0;
          // ★ 显示时必须写 'flex'：写 '' 会清掉内联 display:flex ⇒ 面板变 block ⇒ 宿主不再按 flex 收缩
          try { if (PANEL.el) PANEL.el.style.display = _hide ? 'none' : 'flex'; } catch (e) {}
          PANEL.pushHeight = v;
          try { positionPanel(); } catch (e) {}
          try { requestAnimationFrame(function () { try { positionPanel(); } catch (e) {} }); } catch (e) {}
          try { positionPanel(); } catch { /* 忽略 */ }
          
          document.documentElement.style.setProperty('--dsh-shinki-bottom-height', v + 'px');
          // 让位：只给真正的滚动容器加"变量驱动的"底部内边距（关闭时变量=0 ⇒ 自动为 0）
          // ★ 让位必须加在**会话列本身**（它同时包含消息滚动区与输入框），否则输入框不会被顶起 ⇒ 被面板压住
          // ★ 让位只在面板**真的可见**时施加：display:none / 未挂载 / 高度 0 都绝不留让位空间。
          // ★ 让位机制 = **会话列 margin-bottom**（对齐参考实现 layout.css 的
          //   `#root [data-dsh-center-col]{margin-bottom:var(--dsh-sidebar-height,0px)}`）。
          //   绝不使用滚动容器的 padding-bottom：那是"可滚动内容的一部分" ⇒ 会话末尾平白多一条空白，
          //   一滚到底就看见、往上滚内容还会滚进那块区域（用户实测到的就是这个）。
          const _letThrough = !_hide && !!(PANEL.el && PANEL.el.parentElement);
          try {
            const col = bpCol();
            if (col) {
              if (_letThrough) {
                if (col.dataset.shinkiColPad === undefined) { col.dataset.shinkiColPad = col.style.marginBottom || ''; }
                col.style.marginBottom = 'var(--dsh-shinki-bottom-height)';
                PADDED.add(col);
              } else if (col.dataset.shinkiColPad !== undefined) {
                col.style.marginBottom = col.dataset.shinkiColPad || '';
                delete col.dataset.shinkiColPad;
                PADDED.delete(col);
              } else { col.style.marginBottom = ''; }
            }
          } catch { /* 忽略 */ }
          if (_letThrough) {
            // 只清不填：把旧版本可能留在滚动容器上的底 padding 清掉（否则那条空白永远滚在会话末尾）
            for (const el of bpScrollHosts()) {
              try {
                if (el.dataset && el.dataset.shinkiPadVar !== undefined) { el.style.paddingBottom = el.dataset.shinkiPadVar || ''; delete el.dataset.shinkiPadVar; el.style.scrollPaddingBottom = ''; PADDED.delete(el); }
              } catch { /* 忽略 */ }
            }
          } else {
            clearLetThrough();   // 隐藏/收起/无视图 ⇒ 连"已不再滚动/已脱离 DOM"的也一并清干净
          }
        } catch { /* 忽略 */ }
      }

      /** 兼容旧调用点：本层已不用 padding 让位（加在滚动容器上 = 会话末尾一条能滚进去的空白）。
       *  ★ 这里**只回收旧版本留在滚动容器的 padding 残留**，绝不碰 writeGeometry 维护的
       *    「会话列 margin-bottom」让位 —— 否则右上角开关 / 菜单「显示底部栏」这条 bpReserve 分支
       *    会在让位刚写好后立刻把它清掉，面板就压到输入框上了（实测现象）。 */
      function bpReserve(h) {
        for (const el of bpScrollHosts()) {
          try {
            if (el.dataset && el.dataset.shinkiPadVar !== undefined) { el.style.paddingBottom = el.dataset.shinkiPadVar || ''; delete el.dataset.shinkiPadVar; }
            if (el.dataset && el.dataset.shinkiPad !== undefined) { el.style.scrollPaddingBottom = ''; delete el.dataset.shinkiPad; }
          } catch { /* 忽略 */ }
        }
      }

      function bpList() { return [...viewSpecs.values()].filter((v) => (v.targets || []).includes('bottom')); }

    function bpFold(want) {
      try {
        const el = PANEL.el; if (!el) return;
        const folded = want == null ? el.dataset.folded !== '1' : !!want;
        el.dataset.folded = folded ? '1' : '0';
        el.style.height = folded ? '26px' : (PANEL.height + 'px');
        // ★ 折叠/展开同步「让位」变量：否则内容仍按展开高度预留（或被折叠高度顶起）
        try { document.documentElement.style.setProperty('--dsh-shinki-bottom-height', (folded ? 0 : (PANEL.height || 220)) + 'px'); } catch { /* 忽略 */ }
        if (PANEL.host) PANEL.host.style.display = folded ? 'none' : '';
        const f = el.querySelector('button[data-fold]');
        if (f) f.textContent = folded ? '▴ 展开' : '▾ 收起';
        // （已移除 pfold 自动隐藏逻辑：它会在面板创建后立即把底部栏关掉）
      } catch { /* 忽略 */ }
    }

    /** 确保底部栏可见（关闭只是 display:none ⇒ 打开视图时必须显式恢复，否则"以为已挂载"却看不到）。 */
    /** 确保面板**真的在 DOM 里**（否则不要预留空间 ⇒ 否则会空出一片）。返回是否成功。 */
    function bpEnsureMounted(ctx, spec) {
      try { bpPanelMount(ctx, spec); } catch (e) { console.warn('[dsh-shinki-sidebar-tools] bpPanelMount 异常：' + (e && e.message)); }
      try {
        if (!PANEL.el) return false;
        if (!PANEL.el.parentElement) {
          try { /* 非悬浮宿主即视为在流内（自带高度 ⇒ 不再额外预留空间）*/ PANEL.mode = (PANEL.el.parentElement && PANEL.el.parentElement.id !== 'shinki-bp-overlay') ? 'flow' : 'overlay'; } catch { PANEL.mode = 'overlay'; }
          const ov = bpOverlayHost();
          if (ov) { try { if (getComputedStyle(ov).flexDirection === 'column-reverse') ov.insertBefore(PANEL.el, ov.firstChild); else ov.appendChild(PANEL.el); } catch { ov.appendChild(PANEL.el); } }
        }
        PANEL.el.style.display = 'flex';
        return (PANEL.mode === 'flow');   // flow ⇒ 面板自带高度，不要再预留空间（否则中间空一片）
      } catch { return false; }
    }

    /** 清空底部栏内容：**必须走 React**。直接 replaceChildren 会把 React root 管理的 DOM 抽掉，
     *  下次 root.render() 会抛 NotFoundError（或渲染成空白）。 */
    function bpClearHost() {
      try {
        if (PANEL.root && typeof PANEL.root.render === 'function') { PANEL.root.render(null); return; }
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 清空底部栏视图失败（root.render(null)）：' + (e && e.message)); }
      try { if (PANEL.host) PANEL.host.replaceChildren(); } catch { /* 忽略 */ }
    }

    /** 底部栏的 close()：收起面板（**保持视图挂载**，重开原样回来）—— 与右上角 ✕ 同源语义。 */
    function bpCloseCurrent() {
      try { if (adapterCtx) { toggleBottomPanel(adapterCtx, false); return; } } catch { /* 忽略 */ }
      try { if (PANEL.el) PANEL.el.style.display = 'none'; } catch { /* 忽略 */ }
      try { writeGeometry(0); } catch { /* 忽略 */ }
    }

    function bpShow() {
      // ★ 先判「是否真有活动视图」：writeGeometry 用同一判据决定要不要把面板 display:none
      //   （无视图时留一条空固定条 = 视觉空白且压住输入框）。有视图时 bpShow 必须保证可见。
      let hasView = false;
      try { hasView = !!(PANEL.active && PANEL.tabOrder && PANEL.tabOrder.length); } catch { hasView = false; }
      try { writeGeometry(PANEL.height || 220); } catch (e) { /* 忽略 */ }   // 统一为变量方案（与出错路径同源）
      try {
        if (PANEL && PANEL.el && hasView) {
          PANEL.el.style.display = 'flex'; PANEL.el.style.visibility = 'visible';
          PANEL.el.style.height = (PANEL.height || 220) + 'px';
        }
        const ov = document.getElementById('shinki-bp-overlay');
        if (ov && hasView) { ov.style.display = 'flex'; ov.style.visibility = 'visible'; }
      } catch { /* 忽略 */ }
      try { BOTTOM.enabled = true; emitBottom(); } catch { /* 忽略 */ }
    }

    /** 依据数据重建 TAB 条（不做增量插入 ⇒ 不会"显示上一个、缺当前"）；每个 TAB 带独立 ✕ 可单独关闭。 */
    // TAB 的关闭只接受用户真实点击（isTrusted）——先挂一个记录钩子，拒绝框架合成事件
    try { if (!window.__shinkiTrustHook) { window.__shinkiTrustHook = 1; document.addEventListener('click', function (ev) { try { window.__shinkiLastTrusted = ev.isTrusted; } catch (e) {} }, true); } } catch (e) {}

    function bpRenderTabs() {
      try {
        /* 宿主自愈：mid 可能已脱离 DOM（面板重建过）⇒ 回退到 bar 或重建一个中段，保证 TAB 画在看得见的地方 */
        let host = PANEL.mid;
        if (!host || !host.isConnected) {
          try {
            host = document.createElement('div');
            host.style.cssText = 'flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;overflow-x:auto';
            const labEl = document.createElement('span'); labEl.textContent = '工具面板'; labEl.style.cssText = 'opacity:.65;flex:none';
            host.appendChild(labEl);
            if (PANEL.bar) { PANEL.bar.insertBefore(host, PANEL.bar.firstChild); }
            PANEL.mid = host;
          } catch { /* 忽略 */ }
        }
        if (!host) return;
        PANEL.mid = host;
        PANEL.tabOrder = Array.isArray(PANEL.tabOrder) ? PANEL.tabOrder : [];
        Array.from(host.querySelectorAll('button[data-id]')).forEach((b) => { try { try { const w = b.parentElement; if (w && w.childElementCount <= 2 && w.tagName === 'SPAN') { if (w.parentElement) w.remove(); } else if (b.parentElement) b.remove(); } catch { /* 忽略 */ } } catch { /* 忽略 */ } });
        for (const id of PANEL.tabOrder) {
          const sp = viewSpecs.get(id) || {};
          const label = titleOf(sp) || id;
          const wrap = document.createElement('span');
          wrap.style.cssText = 'flex:none;display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.22));border-radius:4px;padding:1px 6px;'
            + (PANEL.active === id ? 'background:var(--dsw-alias-bg-hover,rgba(255,255,255,.10));' : '');
          const tb = document.createElement('button');
          tb.dataset.id = id; tb.textContent = label; tb.title = id;
          tb.style.cssText = 'border:0;background:transparent;color:inherit;cursor:pointer;padding:0;font-size:12px';
          tb.addEventListener('click', (e) => { try { e.stopPropagation(); } catch { /* 忽略 */ } bpActivate(id); });
          const cb = document.createElement('button');
          cb.dataset.closeId = id; cb.textContent = '✕'; cb.title = '关闭该视图（从 TAB 条移除）';
          cb.style.cssText = 'border:0;background:transparent;color:inherit;cursor:pointer;padding:0;font-size:10px;opacity:.7';
          cb.addEventListener('click', (e) => {
                  try { if (window.__shinkiLastTrusted === false) { console.warn('[dsh-shinki-sidebar-tools] 忽略非用户点击的 TAB 关闭'); return; } } catch (e) {}
            try { e.stopPropagation(); } catch { /* 忽略 */ }
            try {
              PANEL.tabOrder = (PANEL.tabOrder || []).filter((x) => x !== id);
              if (PANEL.active === id) PANEL.active = PANEL.tabOrder[0] || null;
              bpRenderTabs();
              if (PANEL.active) bpActivate(PANEL.active);
              else { try { bpClearHost(); } catch { /* 忽略 */ } }
              console.warn('[dsh-shinki-sidebar-tools] 已从 TAB 条移除：' + id);
              try { bpSessionSave(); } catch { /* 忽略 */ }
            } catch { /* 忽略 */ }
          });
          wrap.appendChild(tb); wrap.appendChild(cb);
          host.appendChild(wrap);
        }
      /* （旧诊断行已移除）*/
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] TAB 条重建失败：' + (e && e.message)); }
    }

    /** 视图渲染错误边界：消费方组件抛错时 React 会把**整棵树卸载** ⇒ 面板内容变空白，而
     *  bpActivate 外层 try/catch 抓不到（createRoot().render() 对渲染期错误不抛）。
     *  包一层后：就地显示错误原因 + 重试按钮，绝不留空白，也不影响宿主与其它视图。 */
    function makeViewBoundary(R, spec, child) {
      try {
        if (!R || typeof R.Component !== 'function') return child;    // 取不到 React.Component ⇒ 不包（保持旧行为）
        class ShinkiViewBoundary extends R.Component {
          constructor(props) { super(props); this.state = { err: null }; }
          static getDerivedStateFromError(err) { return { err: err }; }
          componentDidCatch(err) {
            try { console.error('[dsh-shinki-sidebar-tools] 视图 ' + spec.id + ' 渲染抛错（已隔离，未影响宿主）：', err); } catch { /* 忽略 */ }
          }
          render() {
            if (!this.state || !this.state.err) return child;
            const msg = String((this.state.err && this.state.err.message) || this.state.err || '未知错误');
            return R.createElement('div', { style: { padding: '10px 12px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary,#8b949e)' } },
              R.createElement('div', { style: { fontWeight: 600, marginBottom: '4px', color: 'var(--dsw-alias-label-primary,#e6edf3)' } },
                '视图「' + titleOf(spec) + '」渲染失败（已隔离，未影响宿主）'),
              R.createElement('div', { style: { wordBreak: 'break-word' } }, msg),
              R.createElement('button', {
                onClick: () => { try { this.setState({ err: null }); } catch { /* 忽略 */ } },
                style: { marginTop: '6px', cursor: 'pointer', background: 'transparent', color: 'inherit', border: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.22))', borderRadius: '4px', padding: '2px 8px' },
              }, '重试'));
          }
        }
        return R.createElement(ShinkiViewBoundary, { key: spec.id }, child);
      } catch (e) { return child; }
    }


    /* ───── 按会话隔离的面板状态（follow the conversation）─────
       需求：① 底部栏展开状态跟着对话走；② 每个会话"打开过哪些视图 / 当前是哪个 / 高度"各自保留。
       实现**对齐 dsh-better-sidebar@0.24.1 的 state.ts**（它的卖点就是"separate for every conversation"）：
         · localStorage 按会话存：`dsh-shinki-tools:v1:<sessionId>`（重启也保留；与参考同构，前缀不同命名空间）
         · 新会话默认 = 收起 + 高度 220（参考 makeDefaultState: bottomOpen=false / BOTTOM_DEFAULT=220）
         · 高度上限 = 视口 − CONVERSATION_MIN(280)，下限 BOTTOM_MIN(120)（参考 setBottomHeight 的契约，
           防止面板吞掉整个视口把会话挤成 0）
         · 读盘时 sanitize：字段缺失/类型不对补默认值（不整条丢弃），高度再夹一次
         · 写盘 200ms 防抖，**每会话一个定时器**（互不取消）
         · `?dsh-shinki-reset` 逃生口：丢弃该会话已存状态，从默认开始（参考 #369 的 ?dsh-sidebar-reset）
       会话 key：ctx.get('uiSession').adapter.current（可订阅 binding source）→ getSnapshot().key；
                 取不到用 'default'（退化为旧全局行为，不会更差）。 */
    const STORAGE_PREFIX = 'dsh-shinki-tools:v1';
    const BOTTOM_MIN = 120;          // 参考 state.ts
    const EMPTY_PANEL_H = 96;        // "本会话还没有打开的视图"时空面板的显示高度（够放 TAB 条 + 提示）
    const BOTTOM_DEFAULT = 220;      // 参考 state.ts
    const CONVERSATION_MIN = 280;    // 参考 state.ts：会话列至少留这么高
    const RESET_PARAM = 'dsh-shinki-reset';
    const SESSION_STATE = new Map();      // key -> { open, height, tabOrder, active }
    const persistTimers = new Map();      // key -> 防抖定时器（每会话一个）
    let sessionKeyNow = null;

    /** 当前会话 key；**取不到会话时返回 null**（不再退化成 'default' 桶）。
     *  语义（用户 2026-10-11 要求）：面板状态**全部按会话绑定**；没有会话 ⇒ 不显示开关按钮、也不允许展开。 */
    function sessionKeyOf(ctx) {
      try {
        const sv = svc(ctx, 'uiSession');
        const cur = sv && ((sv.adapter && sv.adapter.current) || sv.current);
        const snap = cur && typeof cur.getSnapshot === 'function' ? cur.getSnapshot() : null;
        const k = snap && (snap.key || snap.sessionId || snap.id);
        if (k != null && String(k)) return String(k);
      } catch { /* 忽略 */ }
      return null;
    }

    /** 是否有会话：底部栏一切行为（显示开关 / 展开 / 落盘）的前提。 */
    function hasSession() { return !!(sessionKeyNow && String(sessionKeyNow)); }

    /** 参考 sanitizeState：旧记录字段缺失/类型不对 ⇒ 补默认值（不整条丢弃），高度再夹一次。 */
    function sessionSanitize(parsed) {
      try {
        if (parsed === null || typeof parsed !== 'object') return undefined;
        const rec = parsed;
        const cap = Math.max(BOTTOM_MIN, ((typeof visibleViewportH === 'function' ? visibleViewportH() : ((typeof window !== 'undefined' && window.innerHeight) || 800))) - CONVERSATION_MIN);
        const rawH = (typeof rec.height === 'number' && isFinite(rec.height)) ? rec.height : BOTTOM_DEFAULT;
        return {
          open: rec.open === true,                                     // 缺失/非法 ⇒ 收起（参考 bottomOpen === true）
          height: Math.min(cap, Math.max(BOTTOM_MIN, Math.round(rawH))),
          tabOrder: Array.isArray(rec.tabOrder) ? rec.tabOrder.filter((x) => typeof x === 'string') : [],
          active: (typeof rec.active === 'string' && rec.active) ? rec.active : null,
          // ★ 消费方（better-sidebar 口径）的设置存在这里：store.get/set 与 tab.meta
          //   必须在 sanitize 里保住，否则每次存取都会被抹掉。
          values: (rec.values && typeof rec.values === 'object') ? rec.values : {},
        };
      } catch { return undefined; }
    }

    /** 新会话（或本会话首次使用）默认：**收起** + 高度 220（对齐参考 makeDefaultState）。
     *  ★ 不再有"继承旧全局展开状态/高度"的一次性迁移 —— 全局开关已按用户要求整体移除
     *    （2026-10-11：面板状态全部按会话绑定；每次重启都以会话自己的记录为准，没记录就是收起）。 */
    function sessionDefaultState() {
      return sessionSanitize({ open: false, height: BOTTOM_DEFAULT, tabOrder: [], active: null })
        || { open: false, height: BOTTOM_DEFAULT, tabOrder: [], active: null, values: {} };
    }

    /** 参考的 ?dsh-sidebar-reset 逃生口：置位时丢弃该会话已存状态（坏状态导致反复出问题时用）。 */
    function sessionResetRequested() {
      try { return new URLSearchParams(window.location.search).has(RESET_PARAM); } catch { return false; }
    }

    /** 参考 setSession(id)：bySession 缓存命中直接用，否则 loadState(id)。 */
    function sessionStateGet(key) {
      const k = key || null;
      if (!k) return undefined;              // ★ 无会话 ⇒ 没有面板状态（调用方按"强制收起 + 不允许展开"处理）
      try {
        if (SESSION_STATE.has(k)) return SESSION_STATE.get(k);
        const reset = sessionResetRequested();
        let st;
        if (reset) {
          try { localStorage.removeItem(STORAGE_PREFIX + ':' + k); } catch { /* 忽略 */ }
          console.warn('[dsh-shinki-sidebar-tools] 检测到 ?' + RESET_PARAM + ' ⇒ 丢弃会话 ' + k + ' 的面板状态，从默认开始');
        } else {
          try {
            const raw = localStorage.getItem(STORAGE_PREFIX + ':' + k);
            if (raw !== null) st = sessionSanitize(JSON.parse(raw));
          } catch { st = undefined; }
        }
        if (!st) st = sessionDefaultState();
        SESSION_STATE.set(k, st);
        return st;
      } catch { return sessionDefaultState(); }
    }

    /** 参考 schedulePersist：200ms 防抖，**每会话一个定时器**（一个会话的待写不能取消另一个的）。 */
    function sessionPersistNow(key, st) {
      try { localStorage.setItem(STORAGE_PREFIX + ':' + key, JSON.stringify(st)); } catch { /* 忽略 */ }
    }
    function sessionSchedulePersist(key, st) {
      try {
        const prev = persistTimers.get(key);
        if (prev !== undefined) { try { clearTimeout(prev); } catch { /* 忽略 */ } }
        const t = setTimeout(() => { persistTimers.delete(key); sessionPersistNow(key, st); }, 200);
        persistTimers.set(key, t);
      } catch { sessionPersistNow(key, st); }
    }

    /** 保存"当前会话"的面板状态（变更即存；写入 200ms 防抖）。 */
    function bpSessionSave() {
      try {
        const k = sessionKeyNow;
        if (!k) return;                       // ★ 无会话 ⇒ 不落盘（全局开关已移除，没有别的地方可写）
        const prev = SESSION_STATE.get(k) || {};
        const st = sessionSanitize({
          open: !!BOTTOM.enabled,
          height: PANEL.height,
          tabOrder: (PANEL.tabOrder || []).slice(),
          active: PANEL.active || null,
          values: prev.values,                                          // ★ 保住消费方设置（store.get/set、tab.meta）
        }) || { open: !!BOTTOM.enabled, height: BOTTOM_DEFAULT, tabOrder: [], active: null, values: {} };
        SESSION_STATE.set(k, st);
        sessionSchedulePersist(k, st);
      } catch { /* 忽略 */ }
    }

    /** 把某个会话的状态落到面板上（切会话时调用；面板还没建就只落状态变量，等 registerView 自动挂载）。 */
    function bpSessionApply(ctx, key) {
      const st = sessionStateGet(key);
      if (!st) {
        // ★ 没有会话：一律收起 + 隐藏面板 + 让位归零（开关按钮也不渲染）
        try { BOTTOM.enabled = false; emitBottom(); } catch { /* 忽略 */ }
        try { if (PANEL.el) PANEL.el.style.display = 'none'; } catch { /* 忽略 */ }
        try { writeGeometry(0); } catch { /* 忽略 */ }
        try { bpRenderTabs(); } catch { /* 忽略 */ }
        try { miniApplySession(); } catch { /* 忽略 */ }
        return;
      }
      try { BOTTOM.enabled = !!st.open; emitBottom(); } catch { /* 忽略 */ }
      try { if (Number(st.height) >= 26) { PANEL.height = Number(st.height); if (PANEL.el) PANEL.el.style.height = PANEL.height + 'px'; } } catch { /* 忽略 */ }
      try {
        PANEL.tabOrder = (st.tabOrder || []).filter((id) => viewSpecs.has(id));
        PANEL.active = (st.active && viewSpecs.has(st.active)) ? st.active : (PANEL.tabOrder[0] || null);
      } catch { /* 忽略 */ }
      try {
        if (BOTTOM.enabled && PANEL.active && viewSpecs.get(PANEL.active)) {
          bpPanelMount(ctx, viewSpecs.get(PANEL.active));     // 末尾会 bpActivate(PANEL.active) ⇒ 挂载它自己的视图
        } else if (BOTTOM.enabled) {
          bpRenderTabs();
        } else {
          try { if (PANEL.el) PANEL.el.style.display = 'none'; } catch { /* 忽略 */ }
          try { writeGeometry(0); } catch { /* 忽略 */ }
          try { bpRenderTabs(); } catch { /* 忽略 */ }
        }
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 会话状态落地失败：' + (e && e.message)); }
      // ★ 迷你窗的显示配置同样按会话：必须**无条件**在末尾执行（曾误插进上面的 else 分支 ⇒ 面板开着时永不执行）
      try { miniApplySession(); } catch { /* 忽略 */ }
    }

    /** 检测会话是否切走/切来：切走先存，切来再恢复。 */
    function bpSessionCheck(ctx) {
      try {
        const k = sessionKeyOf(ctx || adapterCtx);
        if (sessionKeyNow === null || sessionKeyNow === undefined) {
          // 启动早期还没解析出会话：一旦解析出来，就按该会话自己的记录落定（没有"沿用旧全局状态"这回事）
          if (k) { sessionKeyNow = k; bpSessionApply(ctx || adapterCtx, k); }
          return;
        }
        if (k === sessionKeyNow) return;
        const prev = sessionKeyNow;
        bpSessionSave();                       // 把面板当前状态存回旧会话
        sessionKeyNow = k;                     // k 可能为 null（会话被关闭 / 未选中）
        if (!k) {
          console.warn('[dsh-shinki-sidebar-tools] 会话已失去 ⇒ 底部栏强制收起（状态完全按会话绑定，无全局状态）');
          bpSessionApply(ctx || adapterCtx, null);
          return;
        }
        console.warn('[dsh-shinki-sidebar-tools] 会话切换：' + prev + ' → ' + k);
        bpSessionApply(ctx || adapterCtx, k);
      } catch { /* 忽略 */ }
    }

    function bpSessionInit(ctx) {
      try {
        sessionKeyNow = sessionKeyOf(ctx);
        bpSessionApply(ctx, sessionKeyNow);
        // 订阅（即时）＋ 轮询（兜底）
        try {
          const sv = svc(ctx, 'uiSession');
          const cur = sv && ((sv.adapter && sv.adapter.current) || sv.current);
          if (cur && typeof cur.subscribe === 'function') { cur.subscribe(() => { try { bpSessionCheck(ctx); } catch { /* 忽略 */ } }); console.warn('[dsh-shinki-sidebar-tools] 已订阅会话切换（uiSession.adapter.current）'); }
        } catch { /* 忽略 */ }
        const iv = setInterval(() => { try { bpSessionCheck(ctx); } catch { /* 忽略 */ } }, 1000);
        try { ctx.effect(() => () => { try { clearInterval(iv); } catch { /* 忽略 */ } }, 'sidebar-tools session-state'); } catch { /* 忽略 */ }
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 会话状态初始化失败（按全局处理）：' + (e && e.message)); }
    }

    /** 滚轮兜底：webview 的原生滚轮在嵌套结构里不可靠（本插件为 tab 条也做过同样的兜底）。
     *  从光标下最内层往外找"能朝该方向滚动"的容器，手动滚动并 preventDefault；都滚不动就不拦截。 */
    function attachWheelScroll(root) {
      try {
        if (!root || root.__shinkiWheel) return;
        root.__shinkiWheel = 1;
        root.addEventListener('wheel', (ev) => {
          try {
            const unit = ev.deltaMode === 1 ? 16 : (ev.deltaMode === 2 ? (root.clientHeight || 100) : 1);
            let dy = (ev.deltaY || 0) * unit;
            let dx = (ev.deltaX || 0) * unit;
            if (ev.shiftKey && !dx && dy) { dx = dy; dy = 0; }   // Shift+滚轮 = 横向（浏览器惯例）
            if (!dy && !dx) return;
            const chain = [];
            let n = ev.target;
            while (n && n !== root.parentElement) { chain.push(n); if (n === root) break; n = n.parentElement; }
            if (!chain.length || chain[chain.length - 1] !== root) chain.push(root);
            let moved = false;
            for (const el of chain) {
              try {
                // ★ 不看 CSS 的 overflow：overflow:hidden 的"裁切型"容器照样能被**程序化**滚动，
                //   视图若把内容裁掉（JS OTA 那类 height:100% + overflow:hidden），这样才救得回来。
                //   只以"实际能不能动"为准；纵向优先，纵向到头再试横向。
                let ok = false;
                if (dy) {
                  const max = (el.scrollHeight || 0) - (el.clientHeight || 0);
                  const before = el.scrollTop || 0;
                  if (max > 1 && ((dy > 0 && before < max - 1) || (dy < 0 && before > 0))) {
                    el.scrollTop = before + dy;
                    if (el.scrollTop !== before) ok = true;
                  }
                }
                if (!ok && dx) {
                  const maxW = (el.scrollWidth || 0) - (el.clientWidth || 0);
                  const beforeL = el.scrollLeft || 0;
                  if (maxW > 1 && ((dx > 0 && beforeL < maxW - 1) || (dx < 0 && beforeL > 0))) {
                    el.scrollLeft = beforeL + dx;
                    if (el.scrollLeft !== beforeL) ok = true;
                  }
                }
                if (ok) { moved = true; break; }
              } catch { /* 忽略 */ }
            }
            if (moved) { try { ev.preventDefault(); } catch { /* 忽略 */ } }
          } catch { /* 忽略 */ }
        }, { passive: false, capture: true });
      } catch { /* 忽略 */ }
    }


    /* ───── 兼容 better-sidebar 口径的 props（消费方都是按这套写的）─────
       串口监控 / svn / git-graph / js-ota 这些视图从 better-sidebar 那边迁过来，读的是：
         visible（可见才轮询）、scope.sessionId/cwd、tab.id/meta（配合 store.update(tab.id,{meta}) 存设置）、
         store.getPrefs/setPrefs/get/set/update/subscribe。
       本层把它们合出来：每会话的设置进"按会话状态"，prefs 全局存（与参考实现一致：prefs 跨会话）。
       任何一步失败都只退化（少一个能力），绝不抛错影响宿主。 */
    const PREFS_KEY = 'dsh-shinki-tools.prefs.v1';
    const bsListeners = new Set();
    function bsPrefsGet() {
      try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') return v; }
      } catch { /* 忽略 */ }
      return { pluginSettings: {} };
    }
    function bsPrefsSet(patch) {
      try {
        const next = Object.assign({}, bsPrefsGet(), patch || {});
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
        for (const f of [...bsListeners]) { try { f(); } catch { /* 忽略 */ } }
        return next;
      } catch { return bsPrefsGet(); }
    }
    function bsValues(key) {
      const st = sessionStateGet(key);
      if (!st) return {};                    // ★ 无会话 ⇒ 不落盘、也不假装有设置（消费方退化成默认值即可）
      if (!st.values || typeof st.values !== 'object') st.values = {};
      return st.values;
    }
    function bsViewId(spec) { return 'shinki:' + ((spec && spec.id) || 'view'); }
    function bsTabMeta(key, viewId) {
      const v = bsValues(key);
      const m = (v.meta && typeof v.meta === 'object') ? v.meta[viewId] : null;
      return (m && typeof m === 'object') ? m : {};
    }
    function bsStore(key, viewId) {
      return {
        get: (k, dflt) => { const v = bsValues(key); return (v[k] === undefined) ? dflt : v[k]; },
        set: (k, val) => { const v = bsValues(key); v[k] = val; try { bpSessionSave(); } catch { /* 忽略 */ } for (const f of [...bsListeners]) { try { f(); } catch { /* 忽略 */ } } },
        getPrefs: () => bsPrefsGet(),
        setPrefs: (patch) => bsPrefsSet(patch),
        updateTab: (id, patch) => { try { const p = patch || {}; if (p.meta !== undefined) { const v = bsValues(key); if (!v.meta || typeof v.meta !== 'object') v.meta = {}; v.meta[viewId] = Object.assign({}, v.meta[viewId] || {}, p.meta || {}); bpSessionSave(); } } catch { /* 忽略 */ } },
        update: (fn) => { try { const v = bsValues(key); fn(v); bpSessionSave(); for (const f of [...bsListeners]) { try { f(); } catch { /* 忽略 */ } } } catch { /* 忽略 */ } },
        subscribe: (fn) => { try { bsListeners.add(fn); } catch { /* 忽略 */ } return () => { try { bsListeners.delete(fn); } catch { /* 忽略 */ } }; },
        getSnapshot: () => ({ sessionId: key, prefs: bsPrefsGet(), values: bsValues(key) }),
      };
    }
    /** 给某个视图合成 better-sidebar 口径的 props（bottom / 右栏 / 弹窗三条路径共用）。 */
    function bsViewProps(key, spec) {
      const k = key || '';                   // ★ 无会话时不再伪造一个叫 'default' 的假会话
      const vid = bsViewId(spec);
      return {
        visible: true,                                   // 我们只在可见容器里渲染它（undefined 会让消费方永不轮询）
        scope: { sessionId: k, cwd: '' },
        tab: { id: vid, type: (spec && spec.id) || vid, title: titleOf(spec), meta: bsTabMeta(k, (spec && spec.id) || vid) },
        store: bsStore(k, (spec && spec.id) || vid),
      };
    }

    /** 可见视口高度：布局视口（innerHeight）可能比真正可见区域高（底部被裁），
     *  取三者中最小的非零值 —— 面板的高度上限与"抬起来多少"都以它为准。 */
    function visibleViewportH() {
      let v = 0;
      try { v = window.innerHeight || 0; } catch { /* 忽略 */ }
      try { const vv = window.visualViewport; if (vv && vv.height) v = v ? Math.min(v, vv.height) : vv.height; } catch { /* 忽略 */ }
      try { const de = document.documentElement; if (de && de.clientHeight) v = v ? Math.min(v, de.clientHeight) : de.clientHeight; } catch { /* 忽略 */ }
      return v || 800;
    }
    /** 布局视口比可见视口高出的部分 ⇒ 面板要**抬高**这么多，否则底部一截落在看不见的地方。 */
    function viewportBottomGap() {
      try { const h = window.innerHeight || 0; const v = visibleViewportH(); return Math.max(0, Math.round(h - v)); } catch { return 0; }
    }

    function bpActivate(id) {
      const spec = viewSpecs.get(id);
      // ★ 先把 id 登记为「当前视图」，再 bpShow：bpShow→writeGeometry 用 active/tabOrder 判 _hasView，
      //   登记晚一步就会把面板写回 display:none —— 刚挂上的视图活在 0×0 的隐藏子树里
      //   （做 measure/fit 的视图全按 0 尺寸布局，且用户看不到面板）。
      try { PANEL.tabs = PANEL.tabs || new Set(); PANEL.tabs.add(id); } catch { /* 忽略 */ }
      if (spec) {
        try { PANEL.tabOrder = Array.isArray(PANEL.tabOrder) ? PANEL.tabOrder : []; if (!PANEL.tabOrder.includes(id)) PANEL.tabOrder.push(id); } catch { /* 忽略 */ }   // ★ TAB 条读的是 tabOrder，必须在这里登记
        if (PANEL.host) PANEL.active = id;
      }
      try { bpShow(); } catch { /* 忽略 */ }   // ★ 激活前确保可见（关闭只是 display:none）
      try { bpRenderTabs(); } catch { /* 忽略 */ }   // ★ 激活后重建 TAB 条（此前漏了这一步 ⇒ TAB 从不显示）
      if (!spec || !PANEL.host) return;
      if (PANEL.bar) for (const b of Array.from(PANEL.bar.querySelectorAll('button[data-id]'))) b.style.opacity = (b.dataset.id === id ? '1' : '.6');
      try {
        const R = safeRequire('react');
        const RD = safeRequire('react-dom/client') || safeRequire('react-dom');
        if (!R || !RD) throw new Error('react/react-dom 不可用');
        const Comp = wrapView(spec, 'bottom');
        const node = R.createElement(Comp, Object.assign({
          container: PANEL.host, form: 'bottom', isDetached: false,
          close: () => { try { bpCloseCurrent(); } catch { /* 忽略 */ } },
          setTitle: (t) => { try { setViewTitle(spec, t); } catch { /* 忽略 */ } },
        }, (function () { try { return bsViewProps(sessionKeyNow, spec); } catch (e) { return {}; } })()));
        const guarded = makeViewBoundary(R, spec, node);
        if (typeof RD.createRoot === 'function') { try { if (!PANEL.root) PANEL.root = RD.createRoot(PANEL.host); PANEL.root.render(guarded); } catch (e) { console.warn('[dsh-shinki-sidebar-tools] render 异常：' + (e && e.message)); } }
        else if (typeof RD.render === 'function') RD.render(node, PANEL.host);
        else throw new Error('无可用渲染器');
        // ★ 空面板守卫：视图渲染后如果内容容器里**一个子节点都没有**（消费方 return null，或它按
        //   better-sidebar 口径要 store/scope/tab/visible 而这些不在本契约里 ⇒ 什么都不画），
        //   就绝不留一条 220px+ 的空条 + 让位空白（用户看到的就是"下方大片空白"）。
        try { setTimeout(function () { try {
          if (PANEL.active !== id || !PANEL.host) return;              // 期间切走了 / 面板没了
          const kids = PANEL.host.childElementCount;
          if (kids == null) return;                                    // 非真实 DOM（测试桩）⇒ 不判断
          if (kids > 0 || String(PANEL.host.textContent || '').trim()) return;
          console.warn('[dsh-shinki-sidebar-tools] 视图 ' + id + ' 在底部栏渲染结果为空（无任何子节点）⇒ 自动收起面板，避免下方留大片空白；'
            + '若该插件是按 better-sidebar 口径（store/scope/tab/visible）写的，它拿不到这些 props（见 README 字段覆盖矩阵）。');
          try { toggleBottomPanel(adapterCtx, false); } catch { /* 忽略 */ }
        } catch { /* 忽略 */ } }, 1200); } catch { /* 忽略 */ }
        try { console.warn('[dsh-shinki-sidebar-tools] 底部视图清单(' + bpList().length + ')：' + bpList().map((v) => v.id + '/' + (v.title || '')).join(' | ')); } catch { /* 忽略 */ }
        console.warn('[dsh-shinki-sidebar-tools] 下方面板已承载视图：' + id);
        try { bpSessionSave(); } catch { /* 忽略 */ }
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 下方面板渲染失败（已隔离）：' + (e && e.message)); }
    }

    function bpPanelMount(ctx, spec) {
      if (!PANEL.el) {
        const col0 = (function () { try { const c = bpCol(); const p = c && c.parentElement; return (p && p !== document.body && p !== document.documentElement) ? p : (c || bpOverlayHost()); } catch { return bpOverlayHost(); } })();   // ★ 挂到会话区**父级**（与整个会话区平级 ⇒ 输入框与面板紧贴、无空白）
        if (!col0) {
          PANEL.tries += 1;
          if (PANEL.tries <= 60) { setTimeout(() => { try { bpPanelMount(ctx, spec); } catch { /* 忽略 */ } }, 600); }
          else if (PANEL.tries === 61) console.warn('[dsh-shinki-sidebar-tools] 未找到会话中间列，下方面板未创建');
          return;
        }
        PANEL.tries = 0;
        const el = document.createElement('div');
        el.id = 'shinki-tools-panel';
        // ★ 层次（z-index:100）：高于会话窗口本身与其浮动层 float(60)，仍低于其它视图/菜单 ——（40 会被 float 压住）
        //   宿主自带：会话内容 0~10、dock 10、fullscreen dock 40、float 60、菜单 1100；
        //   本插件：FAB/menus 99998~99999、面板内全屏承载 2147483000。
        //   旧值 2147482100 比所有菜单都高 ⇒ 右下菜单打开后被面板里的控件挡住。
        // ★ 一条赋值语句写成——旧代码在第一个字符串后就写了 `;`，后面 `+ '...'` 全成了死表达式（NaN），
        //   导致 background / border-top 从未生效 ⇒ 面板透明、与会话区没有边界（用户反馈"不知道拖哪里"）。
        el.style.cssText = 'position:fixed;bottom:0;z-index:100;height:var(--dsh-shinki-bottom-height,0px);display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box'
          + ';min-height:0;background:var(--dsw-alias-bg-layer-1,#1b1d22)'
          + ';border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14))'
          + ';box-shadow:0 -10px 18px -14px rgba(0,0,0,.55)'
          + ';color:var(--dsw-alias-label-primary,#e6edf3);font-size:12px';
        // ★ 拖高条：从"8px 全透明"改成**看得见的握把**（居中胶囊，hover/拖动加亮加宽）
        const rz = document.createElement('div');
        rz.title = '拖动调整底部栏高度';
        rz.setAttribute('data-shinki-rz', '1');
        rz.setAttribute('role', 'separator');
        rz.setAttribute('aria-orientation', 'horizontal');
        rz.setAttribute('aria-label', '拖动调整底部栏高度');
        rz.style.cssText = 'cursor:row-resize;z-index:2;touch-action:none;height:10px;flex:0 0 auto;position:relative;display:flex;align-items:center;justify-content:center';
        try { const grip = document.createElement('span'); grip.className = 'shst-grip'; rz.appendChild(grip); } catch (e) { /* 忽略 */ }
        // 拖动时右上角显示当前高度（HUD）
        let hud = null;
        try { hud = document.createElement('div'); hud.className = 'shst-hud'; el.appendChild(hud); } catch (e) { /* 忽略 */ }
        rz.addEventListener('mousedown', (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          const y0 = ev.clientY, h0 = PANEL.height;
          try { el.dataset.dragging = '1'; if (hud) hud.textContent = Math.round(h0) + 'px'; } catch (e) { /* 忽略 */ }
          const mv = (e2) => {
            // 高度契约对齐参考 setBottomHeight：下限 BOTTOM_MIN，上限 视口 − CONVERSATION_MIN（会话列至少留 280）
            const cap = Math.max(BOTTOM_MIN, visibleViewportH() - CONVERSATION_MIN);
            const hh = Math.max(BOTTOM_MIN, Math.min(cap, h0 + (y0 - e2.clientY)));
            PANEL.height = hh; el.style.height = hh + 'px'; el.dataset.folded = '0';
            try { document.documentElement.style.setProperty('--dsh-shinki-bottom-height', hh + 'px'); } catch { /* 忽略 */ }
            try { if (hud) hud.textContent = Math.round(hh) + 'px'; } catch (e3) { /* 忽略 */ }
            const f = el.querySelector('button[data-fold]'); if (f) f.textContent = '▾ 收起';
          };
          const up = () => {
            document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
            try { delete el.dataset.dragging; } catch (e4) { /* 忽略 */ }
            try { bpSessionSave(); } catch { /* 忽略 */ }   // ★ 高度也只按会话存（全局 ph 已移除）
          };
          document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        });
        const bar = document.createElement('div');
        bar.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:3px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12))';
        // 中段可滚动（视图按钮多时不挤压）；✕ 固定在最右 ⇒ 永远看得见
        const mid = document.createElement('div');
        try { PANEL.mid = mid; } catch { /* 忽略 */ }   // 记到 PANEL 上，后续只用属性（避免任何裸变量引用）
        mid.style.cssText = 'flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;overflow-x:auto';
        const lab = document.createElement('span'); lab.textContent = '工具面板'; lab.style.cssText = 'opacity:.65;flex:none'; mid.appendChild(lab);
        try {
          const addBtn = document.createElement('button');
          addBtn.textContent = '＋'; addBtn.title = '新增：打开一个已注册到底部的视图'; addBtn.setAttribute('aria-label', '新增视图'); addBtn.dataset.addBtn = '1';
          addBtn.style.cssText = 'flex:none;cursor:pointer;background:transparent;color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.22));border-radius:4px;padding:1px 8px';
          addBtn.addEventListener('click', (ev) => {
            try { ev.stopPropagation(); } catch { /* 忽略 */ }
            const list = bpList();
            if (!list.length) { console.warn('[dsh-shinki-sidebar-tools] 暂无注册到底部的视图'); return; }
            if (list.length === 1) { bpActivate(list[0].id); return; }
            // 简易下拉：列出所有 bottom 视图，点选即切换
            const old = document.getElementById('shinki-bp-addmenu'); if (old) old.remove();
            const menu = document.createElement('div'); menu.id = 'shinki-bp-addmenu';
            menu.style.cssText = 'position:absolute;z-index:99999;margin-top:4px;min-width:160px;background:var(--dsw-alias-bg-layer-2,#23262d);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.35);padding:4px';
            const rect = addBtn.getBoundingClientRect();
            menu.style.left = Math.max(8, rect.left) + 'px'; menu.style.top = (rect.bottom + 2) + 'px'; menu.style.position = 'fixed';
            // ★ 收起只在"点菜单/按钮以外"时发生：原来用 {once:true} 的 document mousedown 无差别移除，
            //   点菜单项时 mousedown 先把菜单从 DOM 删掉 ⇒ 随后的 click 落不到该项上 ⇒ 永远选不中视图。
            const dismiss = (e2) => {
              try {
                const t = e2 && e2.target;
                if (t && ((menu.contains && menu.contains(t)) || (addBtn.contains && addBtn.contains(t)))) return;
              } catch { /* 忽略 */ }
              try { menu.remove(); } catch { /* 忽略 */ }
              try { document.removeEventListener('mousedown', dismiss, true); } catch { /* 忽略 */ }
            };
            for (const v of list) {
              const it = document.createElement('button'); const _t = titleOf(v) || v.id;
              it.textContent = _t; it.style.cssText = 'display:block;width:100%;text-align:left;padding:5px 8px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer';
              it.addEventListener('click', (e2) => { try { e2.stopPropagation(); } catch { /* 忽略 */ } try { document.removeEventListener('mousedown', dismiss, true); } catch { /* 忽略 */ } menu.remove(); bpActivate(v.id); });
              menu.appendChild(it);
            }
            // ★ 迷你 / 悬停视图（若有注册）：点选即开/关
            try {
              const minis = miniList();
              if (minis.length) {
                const sep = document.createElement('div');
                sep.style.cssText = 'height:1px;margin:4px 2px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.12))';
                menu.appendChild(sep);
                const head2 = document.createElement('div');
                head2.textContent = '迷你 / 悬停视图';
                head2.style.cssText = 'padding:3px 8px;font-size:10px;opacity:.6';
                menu.appendChild(head2);
                for (const v of minis) {
                  const it2 = document.createElement('button');
                  const on2 = MINI.el && MINI.el.style.display !== 'none' && MINI.renderedId === v.id;
                  it2.textContent = (on2 ? '✓ 显示中：' : '🪟 已隐藏：') + (titleOf(v) || v.id);
                  it2.title = on2 ? '点击隐藏该悬停视图' : '点击显示该悬停视图';
                  it2.style.cssText = 'display:block;width:100%;text-align:left;padding:5px 8px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer';
                  it2.addEventListener('click', (e3) => { try { e3.stopPropagation(); } catch { /* 忽略 */ } try { document.removeEventListener('mousedown', dismiss, true); } catch { /* 忽略 */ } menu.remove(); miniToggle(v.id); });
                  menu.appendChild(it2);
                }
              }
            } catch { /* 忽略 */ }
            document.body.appendChild(menu);
            setTimeout(() => { try { document.addEventListener('mousedown', dismiss, true); } catch { /* 忽略 */ } }, 0);
          });
          mid.appendChild(addBtn);
        } catch { /* 忽略 */ }
        bar.appendChild(mid);
        /* 「▾ 收起」按钮已移除：原 fold.style.cssText 语句一并删除（它是 fold is not defined 的根源）*/
        const close = document.createElement('button'); close.textContent = '✕'; close.title = '彻底隐藏底部栏（右上角「▤ 底部栏」可重新打开）';
        close.style.cssText = 'z-index:4;width:28px;height:28px;flex:none;cursor:pointer;background:0 0;border:none;border-radius:50%;color:var(--dsw-alias-label-secondary,#8b949e);display:inline-flex;justify-content:center;align-items:center;padding:0';
        close.addEventListener('click', () => toggleBottomPanel(ctx, false));   // 彻底移除（不留残条）
        bar.appendChild(close);
        const host = document.createElement('div');
        // ★ 宿主 = "高度确定的普通块级滚动容器"：视图**自己滚**（height:100% + overflow:auto）时行为与改动前完全一致；
        //   视图靠 flex:1 / 不带 height 时，由注入的 `> * { min-height:100% }` 给它确定高度（其内部滚动区才滚得动）。
        //   position:relative 让 absolute 根节点相对宿主定位。注意**不要**把宿主设成 flex 容器、
        //   也**不要**给子元素强制 flex-shrink:0 —— 那会把"自己滚"的根节点（含 padding）撑出宿主，形成双层滚动。
        host.setAttribute('data-shinki-view-body', '1');
        host.style.cssText = 'flex:1 1 auto;min-height:0;overflow:auto;position:relative;overscroll-behavior:contain';
        el.appendChild(rz); el.appendChild(bar); el.appendChild(host);
        PANEL.el = el; PANEL.bar = bar; PANEL.host = host; PANEL.mid = mid;
        try { attachWheelScroll(host); } catch { /* 忽略 */ }   // ★ 滚轮兜底（不依赖 webview 原生滚动）
        /* （已移除：这里曾把 PANEL.mid 置 null，导致视图按钮落到 ✕ 之后）*/
        try { const capH = Math.max(BOTTOM_MIN, visibleViewportH() - CONVERSATION_MIN); const h0 = Math.min(capH, Math.max(BOTTOM_MIN, Number(PANEL.height) || BOTTOM_DEFAULT)); PANEL.height = h0; el.style.height = h0 + 'px'; } catch { /* 忽略 */ }
        console.warn('[dsh-shinki-sidebar-tools] 下方面板已创建（在流子节点，占位不遮挡）');
      }
      // ★ 面板宿主 = <body>（viewport 级 fixed）。
      //   历史实现把面板 appendChild 到"会话列父级"里 ⇒ 一旦链路上某个祖先是 transform / contain /
      //   filter / will-change / perspective，它就成了 position:fixed 的**包含块**，「bottom:0」于是变成
      //   "那个祖先的底部"（会话输出区底部）⇒ 面板贴到输入框上方/与之重叠（实测现象）。
      //   挂到 <body> 后 fixed 恒以视口为参照；面板位置只由 left/right/bottom 决定，与会话 DOM 结构解耦。
      const hostParent = (function () { try { return document.body || null; } catch (e) { return null; } })();
      if (!hostParent) return;
      if (PANEL.el.parentElement !== hostParent) {
        try { hostParent.appendChild(PANEL.el); } catch (e) { return; }
      }
      PANEL.mode = 'overlay';   // 明确：面板不在会话列的在流布局里（让位由会话列 margin-bottom 负责）
        try { bpRenderTabs(); } catch { /* 忽略 */ }   // TAB 条统一由数据重建
        // （已移除 pfold 自动隐藏逻辑：它会在面板创建后立即把底部栏关掉）
      // ★ spec 为空 = 只建**外壳**（"本会话还没有打开的视图"的空面板）：
      //   不激活任何视图；是否显示由调用方用 writeGeometry(EMPTY_PANEL_H, {force:true}) 决定。
      if (!spec) return true;
      bpActivate(PANEL.active || spec.id);
    }

    /** 底部面板开关：**完全按会话**（用户 2026-10-11 要求，全局开关整体移除）。
     *  初值一律收起；当前会话的真实展开状态由 bpSessionApply(sessionStateGet) 落定；
     *  没有会话时既不允许展开（toggleBottomPanel 会拒绝），也不渲染开关按钮。 */
    const BOTTOM = { enabled: false };
    /** 底部栏状态订阅（会话右上角按钮据此实时同步） */
    const bottomListeners = new Set();
    function emitBottom() { for (const f of [...bottomListeners]) { try { f(BOTTOM.enabled); } catch { /* 忽略 */ } } }
    function subscribeBottom(fn) { bottomListeners.add(fn); return () => bottomListeners.delete(fn); }   // 面板可用（默认开），但**仅在打开 bottom 视图时才挂载**（避免注册时就被挤到下方）

    /* ───── 可复用的后台生命周期（供任意插件声明"暂停 / 继续 / 停止"行为）─────
       消费方只提供钩子，**策略派发由适配层实现**：
         ctx.shinkiViews.lifecycle.register('my-key', {
           onSuspend(policy),   // 视图卸载：适配层按 policy 决定调用语义
           onResume(),          // 视图重新挂载
           onStop(),            // policy === 'stop' 时的清理
         })
       同时把 register({ …, onSuspend, onResume, onStop }) 写在视图声明里也可以（自动登记）。 */
    const lifecycles = new Map();   // key -> handlers

    function registerLifecycle(key, handlers) {
      if (!key || !handlers || typeof handlers !== 'object') return { dispose() {} };
      lifecycles.set(key, handlers);
      console.warn('[dsh-shinki-sidebar-tools] 生命周期已登记：' + key);
      return { dispose() { lifecycles.delete(key); } };
    }

    /** 按策略派发一次挂载/卸载（这是"暂停/继续/停止"行为的统一实现）。 */
    function dispatchLifecycle(key, phase, policy) {
      const h = lifecycles.get(key);
      if (!h) { console.warn('[dsh-shinki-sidebar-tools] 生命周期派发跳过（未登记）：' + key + ' / ' + phase + ' / ' + policy); return; }
      try {
        if (phase === 'resume') {
          console.warn('[dsh-shinki-sidebar-tools] 生命周期派发：' + key + ' → resume（策略 ' + policy + '）');
          if (typeof h.onResume === 'function') h.onResume({ policy });
          return;
        }
        if (policy === 'force') {   // 强制后台：不动作（明确留痕，便于确认"中间件确实处理了"）
          console.warn('[dsh-shinki-sidebar-tools] 生命周期派发：' + key + ' → suspend，策略 force ⇒ 不动作（继续后台运行）');
          return;
        }
        if (policy === 'stop') {
          console.warn('[dsh-shinki-sidebar-tools] 生命周期派发：' + key + ' → stop（策略 stop）');
          if (typeof h.onStop === 'function') h.onStop({ policy });
          else if (typeof h.onSuspend === 'function') h.onSuspend({ policy });
          return;
        }
        console.warn('[dsh-shinki-sidebar-tools] 生命周期派发：' + key + ' → suspend（策略 ' + policy + '）');
        if (typeof h.onSuspend === 'function') h.onSuspend({ policy });    // pause / remember
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 生命周期派发失败（' + key + '/' + phase + '）：' + (e && e.message)); }
    }

    /** 视图展示名：setTitle 覆盖 > spec.title（可为函数）> spec.id。
     *  一律读 viewSpecs 里的同一份 spec（registerView 存的是副本，覆盖也写在它上面）。 */
    function titleOf(spec) {
      if (!spec) return '';
      if (spec.__titleOverride != null) return spec.__titleOverride;
      try { return (typeof spec.title === 'function') ? (spec.title() || spec.id) : (spec.title || spec.id); } catch { return spec.id; }
    }

    /** setTitle 的真实实现：记录覆盖标题 ⇒ 底部栏 TAB 条 / ≡ 菜单 / 之后新开的右栏 tab 都用它。
     *  （已打开的官方右栏 tab 标题由宿主在 openTab 时捕获，本层改不动 —— 如实告知，不假装成功。） */
    function setViewTitle(spec, t) {
      try {
        if (!spec || t == null || String(t) === '') return;
        spec.__titleOverride = String(t);
        try { if (PANEL.active === spec.id) bpRenderTabs(); } catch { /* 忽略 */ }
        console.warn('[dsh-shinki-sidebar-tools] setTitle：' + spec.id + ' → ' + spec.__titleOverride
          + '（底部栏 TAB/菜单即时生效；右侧栏已打开的 tab 标题由宿主捕获，需重开该 tab）');
      } catch { /* 忽略 */ }
    }

    /** 官方槽位（右栏 tab / mainView）里的 close()：开关由宿主掌管，本层不代关 ⇒ 如实告警。
     *  底部栏承载时 close() 才有真实语义（收起面板）——见 bpCloseCurrent。 */
    function slotViewClose(spec) {
      console.warn('[dsh-shinki-sidebar-tools] close()：' + (spec && spec.id)
        + ' 正由官方槽位承载，关闭由宿主的 tab/视图开关掌管，本层不代关（底部栏承载时 close() 会收起面板）。');
    }

    /** 包装消费方 render：统一注入 background、并在挂载/卸载时派发生命周期钩子。
     *  hostProps：本层额外补进 props 的适配层字段（container / close / setTitle / isDetached）。
     *  官方槽位（右栏 / mainView）的 renderSlot **只给 kit**（sessionId / useTabInfo / …），没有这四个
     *  字段；底部栏与弹窗由本层直接给。不补齐 ⇒ 同一条 render 在「点视图打开」与「底部栏打开」两条
     *  路径上拿到的 props 形状不同，README 的「稳定 props 契约」无法兑现。 */
    function wrapView(spec, form, hostProps) {
      const bgOf = (props) => (props && props.background) || spec.background || normalizeBackground(spec.background);
      const extraOf = (props) => {
        try { return (typeof hostProps === 'function' ? hostProps(props) : hostProps) || {}; } catch { return {}; }
      };
      if (!react || typeof react.useEffect !== 'function') {
        return (props) => spec.render({ ...(props || {}), ...extraOf(props), form, background: bgOf(props) });
      }
      return function ShinkiWrappedView(props) {
        const policy = bgOf(props);
        const extra = extraOf(props);
        react.useEffect(() => {
          dispatchLifecycle(spec.id, 'resume', policy);
          return () => { dispatchLifecycle(spec.id, 'suspend', policy); };
        }, []);
        return spec.render({ ...(props || {}), ...extra, form, background: policy });
      };
    }

    /** 官方槽位的承载层：给消费方一个**真实、首帧就存在**的 container（portal 目标节点），并把
     *  close / setTitle / isDetached 一并补进 props —— 与底部栏、弹窗两条路径形状对齐。
     *  取不到 createPortal 时退回「只透传官方 kit」的旧行为（只 warn，不抛错、不影响宿主）。 */
    function slotHostView(spec, form) {
      const Inner = wrapView(spec, form, (props) => Object.assign({
        container: (props && props.__shinkiContainer) || null,
        isDetached: false,
        close: () => { try { slotViewClose(spec); } catch { /* 忽略 */ } },
        setTitle: (t) => { try { setViewTitle(spec, t); } catch { /* 忽略 */ } },
      }, (function () { try { return bsViewProps(sessionKeyNow, spec); } catch (e) { return {}; } })()));
      return function ShinkiSlotHost(props) {
        const node = (react && typeof react.useState === 'function')
          ? react.useState(() => { try { return document.createElement('div'); } catch { return null; } })[0]
          : null;
        const inner = react.createElement(Inner, { ...(props || {}), __shinkiContainer: node });
        const RD = node ? safeRequire('react-dom') : null;
        if (!RD || typeof RD.createPortal !== 'function') {
          if (node) console.warn('[dsh-shinki-sidebar-tools] 官方槽位承载：react-dom 无 createPortal ⇒ 不提供 props.container（' + spec.id + '）');
          return inner;
        }
        return react.createElement('div', {
          'data-shinki-slot-host': spec.id,
          ref: (el) => {
            try { if (el && node && node.parentElement !== el) el.appendChild(node); } catch { /* 忽略 */ }
            try { attachWheelScroll(el); } catch { /* 忽略 */ }   // 右侧栏承载路径也挂滚轮兜底
          },
          // overflow:auto（不是 hidden）⇒ 视图自己滚不动时由这层承接
          style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0, minHeight: 0, overflow: 'auto' },
        }, RD.createPortal(inner, node));
      };
    }
    function normalizeBackground(v) {
      if (v === true) return 'force';
      if (v === false || v == null) return 'pause';
      return BG_POLICIES.includes(v) ? v : 'pause';
    }

    /** 消费方唯一入口：注册视图到若干形态。返回句柄（dispose 可卸载）。 */
    function registerView(ctx, spec) {
      if (!spec || !spec.id || typeof spec.render !== 'function') {
        console.warn('[dsh-shinki-sidebar-tools] register 参数不合法（需 id + render）');
        return { dispose() {} };
      }
      if (viewSpecs.has(spec.id)) {
        console.warn('[dsh-shinki-sidebar-tools] 视图 id 已存在，先注册者生效：' + spec.id);
        return viewHandles.get(spec.id) || { dispose() {} };
      }
      const targets = Array.isArray(spec.targets) && spec.targets.length ? spec.targets : ['bottom'];
      try { if (spec && spec.mini && !targets.includes('mini')) targets.push('mini'); } catch { /* 忽略 */ }   // 声明了 mini 即自动纳入（无需写 targets）
      const background = normalizeBackground(spec.background);
      viewSpecs.set(spec.id, { ...spec, targets, background });
      // 动态清单：注册即出现（菜单/指南据此列出"可创建"），注销即消失
      if (!BUILTIN_VIEWS.some((v) => v.kind === spec.id)) BUILTIN_VIEWS.push({ kind: spec.id, title: spec.title || spec.id });
      if (spec.onSuspend || spec.onResume || spec.onStop) registerLifecycle(spec.id, spec);
      if (spec.background != null) console.warn('[dsh-shinki-sidebar-tools] 视图后台策略：' + spec.id + ' → ' + background);
      for (const form of targets) {
        const impl = VIEW_FORMS[form];
        if (typeof impl !== 'function') { console.warn('[dsh-shinki-sidebar-tools] 未知形态已跳过：' + form + '（' + spec.id + '）'); continue; }
        try { impl(ctx, spec); } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 形态挂载异常已跳过：' + form + ' → ' + (e && e.message)); }
      }
      // （已按要求移除 better-sidebar 的 registerTab 接入：它只在自身激活时才提供 tab，
      //   本插件改为**自带底部栏**，不依赖它。）

      // ★ 注册了 bottom 的视图 ⇒ 底部栏开启时**立即挂面板**（启动即出现，不必先点视图）
      try {
        if (targets.includes('bottom') && BOTTOM.enabled) {
          setTimeout(() => { try { bpPanelMount(ctx, spec); } catch { /* 忽略 */ } }, 300);
        }
      } catch { /* 忽略 */ }

      const handle = {
        id: spec.id,
        dispose() {
          viewSpecs.delete(spec.id); viewHandles.delete(spec.id);
          try { RAIL_REGISTERED.delete(spec.id); } catch { /* 忽略 */ }   // 注销后允许同 id 再次注册（否则右栏入口会被去重表挡住）
          const i = BUILTIN_VIEWS.findIndex((v) => v.kind === spec.id);
          if (i >= 0) BUILTIN_VIEWS.splice(i, 1);      // 动态清单同步移除
          console.warn('[dsh-shinki-sidebar-tools] 视图已卸载：' + spec.id);
        },
      };
      viewHandles.set(spec.id, handle);
      console.warn('[dsh-shinki-sidebar-tools] 适配层已注册视图：' + spec.id + ' → [' + targets.join(', ') + '] (v' + CONTRACT_VERSION + ')');
      return handle;
    }

    const KIND = 'dsh-shinki-sidebar-tools';

    /** 内置视图清单（注册表枚举不到时的兜底）。 */
    // 动态清单：仅包含**真正通过中间件注册**的视图（由 registerView 实时增删）。
    // 之前这里是硬编码兜底，会列出不存在/未注册的视图 —— 已按"按注册加载"的原则移除。
    const BUILTIN_VIEWS = [];

    /** 容错取客户端服务：ctx.get(name) → ctx[name] → undefined。 */
    function svc(ctx, name) {
      try {
        const v = ctx && ctx.get ? ctx.get(name) : undefined;
        return v !== undefined ? v : (ctx ? ctx[name] : undefined);
      } catch { return undefined; }
    }

    /** 尝试从注册表枚举已注册视图；拿不到就只用内置清单。 */
    function viewList(ctx) {
      const seen = new Set();
      const out = [];
      const push = (kind, title) => {
        if (!kind || seen.has(kind)) return;
        seen.add(kind);
        out.push({ kind, title: title || kind });
      };
      for (const v of BUILTIN_VIEWS) push(v.kind, v.title);
      try {
        const reg = svc(ctx, 'sidebarRightTabs');
        const bag = reg && (reg.items || reg.defs || reg.types || reg.registry);
        if (bag && typeof bag.forEach === 'function') {
          bag.forEach((def, key) => {
            if (!def) return;
            const kind = typeof def === 'string' ? def : (def.kind || def.id || key);
            let title = kind;
            try { title = typeof def.title === 'function' ? def.title() : (def.title || kind); } catch {}
            push(kind, title);
          });
        }
      } catch { /* 枚举失败：忽略 */ }
      return out;
    }

    function injectCss() {
      if (typeof document === 'undefined') return;
      const id = KIND + '-css';
      if (document.getElementById(id)) return;
      const el = document.createElement('style');
      el.id = id;
      // 只做**不改变布局**的增强：不动 chip 的 flex、不强制溢出。
      // 曾经加过「禁止 chip 压缩 + overflow-x:scroll」，导致 QtWebEngine 下
      // 溢出的 tab 被裁掉且无可用滚动条 → 右侧部分视图点不到（已撤销）。
      el.textContent = `
        /* 仅在"本来就有溢出"时提供细滚动条与手势支持，不制造溢出 */
        [class*="_stripTabs_"] { scrollbar-width: thin !important; touch-action: auto !important; }
        [class*="_stripTabs_"]::-webkit-scrollbar { height: 6px; }
        /* 底部栏让位：**只动会话列的 margin-bottom**（对齐参考实现 layout.css 的
           #root [data-dsh-center-col]{margin-bottom:var(--dsh-sidebar-height,0px)}）。
           变量由 writeGeometry 写：面板隐藏/收起 = 0px ⇒ 让位自动归零；
           绝不用 padding —— padding 会话列会挤扁 flex 列，padding 滚动容器会在会话末尾留一条能滚进去的空白。
           这条 CSS 同时是 JS 让位的安全网（JS 内联样式优先，值相同）。 */
        #root [data-shinki-center-col] { margin-bottom: var(--dsh-shinki-bottom-height, 0px); min-height: 0; }
        [class*="_stripTabs_"]::-webkit-scrollbar-thumb {
          background: var(--dsw-alias-border-l2, rgba(255,255,255,.28)); border-radius: 3px;
        }
        /* 底部栏 ↔ 会话区：边界与拖拽把手的可视反馈（拖动时才知道拖哪里） */
        #shinki-tools-panel .shst-grip {
          width: 44px; height: 4px; border-radius: 2px; pointer-events: none;
          background: var(--dsw-alias-border-l3, rgba(255,255,255,.30));
          transition: width .12s ease, background-color .12s ease;
        }
        #shinki-tools-panel [data-shinki-rz]:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.06)); }
        #shinki-tools-panel [data-shinki-rz]:hover .shst-grip,
        #shinki-tools-panel[data-dragging="1"] .shst-grip {
          width: 72px; background: var(--dsw-alias-brand-primary, #4d6bfe);
        }
        #shinki-tools-panel[data-dragging="1"] { border-top-color: var(--dsw-alias-brand-primary, #4d6bfe); }
        #shinki-tools-panel .shst-hud {
          position: absolute; top: -24px; right: 10px; display: none; pointer-events: none;
          padding: 1px 6px; border-radius: 4px; font-size: 11px; line-height: 16px;
          background: var(--dsw-alias-bg-layer-2, #23262d); color: var(--dsw-alias-label-primary, #e6edf3);
          border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.18));
        }
        #shinki-tools-panel[data-dragging="1"] .shst-hud { display: block; }
        /* 底部栏 / 弹窗里的"内部视图"：宿主是可滚动容器（块级，**不是** flex —— 免得打坏"视图自己滚"那类根节点）
           + 细滚动条（QtWebEngine 默认常不画滚动条，用户看不到可滚）。 */
        #shinki-tools-panel [data-shinki-view-body], #shinki-tools-detached [data-shinki-view-body] {
          overflow: auto; overscroll-behavior: contain; scrollbar-width: thin;
        }
        /* 宿主尺寸**不写死**：面板是 flex 列容器，宿主 flex:1 1 auto + min-height:0，
           由浏览器按「面板实际高度 − 拖拽条 − 工具栏」自动分配 ⇒ 手动拖高/字体/工具栏变化都自动跟随。
           注意：面板的 display 必须**始终**是 flex（见 display:'flex' 的写法）——
           曾经用 style.display='' 来"显示"面板，把内联 display:flex 清掉 ⇒ 面板变 block ⇒ 宿主不再收缩
           ⇒ 宿主高度=内容高度、被面板裁掉、且自身不溢出 ⇒ 判定"不用滚动条"，内容就够不着了。 */
        /* ★ 默认滚动完全交给 CSS：宿主是 overflow:auto，**由实际内容高度决定**是否出滚动条。
           为此视图根一律"按内容撑高、不裁剪"：它若固定 height:100%（消费方按 better-sidebar .tabBody 约定写的），
           内容会在它内部被裁掉 ⇒ 外层的 auto 看到的内容正好等于 100%，于是"正确地"不显示滚动条（就是滚不动的原因）。
           只作用于视图根；视图内部自己的滚动区（如 .jsota-pre{max-height:200px;overflow:auto}）不受影响。 */
        #shinki-tools-panel [data-shinki-view-body] > *, #shinki-tools-detached [data-shinki-view-body] > * {
          height: auto !important;
          min-height: 100%;
          overflow: visible !important;
        }
        #shinki-tools-panel [data-shinki-view-body]::-webkit-scrollbar,
        #shinki-tools-detached [data-shinki-view-body]::-webkit-scrollbar { width: 8px; height: 8px; }
        #shinki-tools-panel [data-shinki-view-body]::-webkit-scrollbar-thumb,
        #shinki-tools-detached [data-shinki-view-body]::-webkit-scrollbar-thumb {
          background: var(--dsw-alias-border-l2, rgba(255,255,255,.28)); border-radius: 4px;
        }
        #shinki-tools-panel [data-shinki-view-body]::-webkit-scrollbar-track,
        #shinki-tools-detached [data-shinki-view-body]::-webkit-scrollbar-track { background: transparent; }
        /* 创建视图菜单（纯浮层，不影响任何布局） */
        .shst-mask { position: fixed; inset: 0; z-index: 99998; }
        .shst-menu {
          position: fixed; z-index: 99999; min-width: 168px; max-height: 60vh; overflow-y: auto;
          background: var(--dsw-alias-bg-layer-2, #23262d); color: var(--dsw-alias-label-primary, #e6edf3);
          border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14)); border-radius: 6px;
          box-shadow: 0 8px 24px rgba(0,0,0,.35); padding: 4px; font-size: 12px;
        }
        .shst-head { padding: 4px 8px 6px; color: var(--dsw-alias-label-tertiary, #8b949e); font-size: 11px; }
        .shst-item {
          display: block; width: 100%; text-align: left; padding: 5px 8px; border: 0; border-radius: 4px;
          background: transparent; color: inherit; cursor: pointer; font-size: 12px;
        }
        .shst-item:hover { background: var(--dsw-alias-bg-hover, rgba(255,255,255,.08)); }
        .shst-kind { color: var(--dsw-alias-label-tertiary, #8b949e); font-size: 10px; margin-left: 6px; }
      `;
      document.head.appendChild(el);
    }

    /**
     * 统一浮层定位：优先向上展开，**上下左右都夹进视口**，并限制 max-height。
     * （此前只算了 left/top 且用 offsetHeight 在挂载前取值，菜单会被底部遮挡。）
     */
    function positionMenu(el, anchorEl) {
      let rr = null;
      try { if (anchorEl && anchorEl.getBoundingClientRect) rr = anchorEl.getBoundingClientRect(); } catch { rr = null; }
      const vw = window.innerWidth || 1024;
      const vh = window.innerHeight || 768;
      const M = 8;        // 视口四周留白
      const GAP = 6;      // 与锚点的间距
      const anchorLeft = rr ? rr.left : 20;
      const anchorTop = rr ? rr.top : vh - 40;
      const anchorW = rr ? (rr.width || 0) : 26;
      const anchorBottom = rr ? ((rr.bottom != null) ? rr.bottom : (rr.top + (rr.height || 0))) : anchorTop;

      // ① 先定"能用多高"：比较锚点上方/下方的可用空间，取较大的一侧
      const spaceAbove = Math.max(0, anchorTop - GAP - M);
      const spaceBelow = Math.max(0, vh - anchorBottom - GAP - M);
      const useAbove = spaceAbove >= spaceBelow;
      const avail = Math.max(120, useAbove ? spaceAbove : spaceBelow);
      // ★ 关键：max-height 必须由"可用空间"决定（旧代码写死 vh-16，无视 top ⇒ 菜单会伸出视口，
      //   滚到底也看不到最后一项）。先限死高度，后面算 top 才有意义。
      const maxH = Math.min(avail, Math.max(120, vh - 2 * M));
      el.style.maxHeight = Math.round(maxH) + 'px';
      el.style.overflowY = 'auto';

      // ② 实际渲染高度不会超过 maxH（此时可能还没布局 ⇒ 用 maxH 保守估算）
      const natural = el.offsetHeight || 0;
      const h = Math.min(natural > 0 ? natural : maxH, maxH);

      // ③ 水平：贴锚点右缘向左展开，再夹进视口
      const w = el.offsetWidth || 220;
      const left = Math.max(M, Math.min(anchorLeft - w + anchorW, vw - w - M));

      // ④ 垂直：按选择的一侧放，并把 top 夹进 [M, vh-M-h] ⇒ top + h ≤ vh-M，整体必在视口内
      let top = useAbove ? (anchorTop - GAP - h) : (anchorBottom + GAP);
      top = Math.max(M, Math.min(top, vh - M - h));

      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(top) + 'px';
    }

    let menuEl = null;
    let maskEl = null;

    function closeMenu() {
      try { menuEl && menuEl.remove(); } catch {}
      try { maskEl && maskEl.remove(); } catch {}
      menuEl = null; maskEl = null;
    }

    /** 会话视图**右上角**开关：点击打开"全部视图"菜单（与 ≡ 同一个 showMenu）。 */
    let headerToggleRegistered = false;
    function registerHeaderToggle(ctx) {
      if (headerToggleRegistered) return;
      waitFor(ctx, ['slots'], () => {
        try {
          const slots = svc(ctx, 'slots');
          if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
            console.warn('[dsh-shinki-sidebar-tools] 头部开关注册：slots 不可用（inject/register 缺失）'); return;
          }
          // React 多路获取（此前只用 safeRequire ⇒ 拿不到就静默 return，导致右上角永远没按钮）
          let R = null;
          // ★ 优先用本文件里已在使用的 react 变量（第 113 行 wrapView 就在用它 ⇒ 证明可用）
          try { if (typeof react !== 'undefined' && react && typeof react.createElement === 'function') R = react; } catch { /* 忽略 */ }
          if (!R) { try { R = safeRequire('react'); } catch { /* 忽略 */ } }
          if (!R || typeof R.createElement !== 'function') {
            try { const m = require('react'); R = m && (m.default || m); } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 头部开关注册：require(react) 失败：' + (e && e.message)); }
          }
          if (!R || typeof R.createElement !== 'function') {
            try { R = (ctx && (ctx.react || (ctx.ui && ctx.ui.react))) || null; } catch { R = null; }
          }
          if (!R || typeof R.createElement !== 'function') {
            console.warn('[dsh-shinki-sidebar-tools] 头部开关注册：拿不到 React ⇒ 跳过原生槽位（已用固定右上角按钮兜底）'); return;
          }
          console.warn('[dsh-shinki-sidebar-tools] 头部开关注册：React 就绪，开始注册槽位');          /* 照 better-sidebar 的 BottomDockToggle 风格：官方图标 + Tooltip + 28×28 圆形按钮 + data-active */
          const prim = (() => { try { return safeRequire('@deepseek-ai/dsh-client-ui-primitives') || {}; } catch { return {}; } })();
          const BottomIcon = prim.IconPanelBottomOutline16 || null;
          const ViewsIcon = prim.IconLayoutGridOutline16 || prim.IconGridOutline16 || prim.IconMenuOutline16 || prim.IconListOutline16 || null;
          try { console.warn('[dsh-shinki-sidebar-tools] 可用图标：' + Object.keys(prim).filter(function (k) { return /^Icon/.test(k); }).join(',')); } catch (e) {}
          const Tip = prim.Tooltip || null;
          const dockLabel = () => (BOTTOM.enabled ? '收起底部栏' : '展开底部栏');
          const mkToggle = (what) => {
            const btn = R.createElement('button', {
              type: 'button',
              'data-dsh-bottom-toggle': true,
              'data-active': BOTTOM.enabled ? 'true' : undefined,
              'aria-label': dockLabel(), 'aria-pressed': BOTTOM.enabled,
              title: dockLabel(),
              onClick: (e) => { try { e.preventDefault(); e.stopPropagation(); } catch { /* 忽略 */ } toggleBottomPanel(ctx); },
              style: what === 'bottom'
                ? { width: 28, height: 28, borderRadius: '50%', background: 'transparent', border: 'none',
                    color: BOTTOM.enabled ? 'var(--dsw-alias-brand-primary,#4d6bfe)' : 'var(--dsw-alias-label-secondary,#8b949e)',
                    cursor: 'pointer', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', padding: 0 }
                : { cursor: 'pointer', background: 'transparent', color: 'inherit', fontSize: '12px', lineHeight: '18px',
                    border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.18))', borderRadius: 4, padding: '2px 8px' },
            }, what === 'bottom'
              ? (BottomIcon ? R.createElement(BottomIcon, {}) : '▤')
              : (ViewsIcon ? R.createElement(ViewsIcon, {}) : '☰'));   // 只图标，无文字
            return Tip ? R.createElement(Tip, { label: dockLabel(), side: 'bottom', delayMs: 500 }, btn) : btn;
          };
          // ★ 无会话 ⇒ 返回 null（按钮根本不渲染）；并订阅底部栏状态，让图标/aria 实时同步
          const mkToggleGated = (what) => () => {
            const [, bump] = R.useState(0);
            R.useEffect(() => subscribeBottom(() => { try { bump((x) => x + 1); } catch { /* 忽略 */ } }), []);
            if (!hasSession()) return null;
            return mkToggle(what);
          };
          const Btn = mkToggleGated('views');
          const BBtn = mkToggleGated('bottom');
          slots.inject('conversation.session.header.utilities', () => slots.register({
            name: 'conversation.session.header.utilities',
            id: 'dsh-shinki-sidebar-tools:views-toggle',
            order: 10,
            registrant: 'dsh-shinki-sidebar-tools',   // 对齐参考 bottom-toggle.tsx
          }, Btn));
          headerToggleRegistered = true;
          console.warn('[dsh-shinki-sidebar-tools] 已在会话视图右上角注册「🧩 视图」开关');

          // ── 保底位置：输入区右侧（该槽位确有其它插件在用 ⇒ 一定能挂上）──
          try {
            const reg2 = (id, order, Comp) => slots.inject('conversation.input.right', () => slots.register({
              name: 'conversation.input.right', id: id, order: order,
            }, Comp));
            // reg2('dsh-shinki-sidebar-tools:views-toggle-input', 88, Btn);   // 按用户要求移除：对话框下方的冗余入口
            // reg2('dsh-shinki-sidebar-tools:bottom-toggle-input', 89, BBtn);   // 按用户要求移除：对话框下方的冗余入口
            console.warn('[dsh-shinki-sidebar-tools] 已在输入区右侧注册保底开关（🧩 视图 / ▤ 底部栏）');
          } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 保底槽位注册失败（已忽略）：' + (e && e.message)); }
        } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 右上角开关注册失败（已忽略）：' + (e && e.message)); }
      }, 'dsh-shinki-sidebar-tools: header-toggle');
    }

    function openView(ctx, kind, forceTarget) {
      if (forceTarget === 'right') {   // 显式右侧栏：已存在该 tab 时官方会切换显示，不会重复创建
        const nav0 = svc(ctx, 'sidebarRight');
        if (nav0 && typeof nav0.openTab === 'function') {
          try { nav0.openTab(kind, { params: {} }); console.warn('[dsh-shinki-sidebar-tools] 按要求在【右侧栏】打开（已存在则切换）：' + kind); return; }
          catch (e) { console.warn('[dsh-shinki-sidebar-tools] 右侧栏打开失败：' + (e && e.message)); }
        }
      }
      const tried = [];
      // ★ 按注册信息路由：bottom 视图且"底部面板已开启"⇒ 底部栏；否则一律官方右侧栏
      let wantsBottom = false;
      try {
        const spec = viewSpecs.get(kind);
        wantsBottom = (forceTarget === 'bottom') ? true : !!(spec && (spec.targets || []).includes('bottom'));   // ★ 显式目标优先
      } catch { wantsBottom = false; }
      if (wantsBottom && BOTTOM.enabled) {
        try {
          bpPanelMount(ctx, viewSpecs.get(kind));
          try { bpShow(); } catch { /* 忽略 */ }   // 先确保可见再判定
            const ok = !!(PANEL && PANEL.el && PANEL.el.parentElement);
          if (ok) {
            bpActivate(kind);
            console.warn('[dsh-shinki-sidebar-tools] 已按注册信息在【底部栏】打开：' + kind);
            return;
          }
          console.warn('[dsh-shinki-sidebar-tools] 底部栏挂载未成功 ⇒ 回退【右侧栏】：' + kind);
        } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 底部栏打开异常 ⇒ 回退【右侧栏】：' + (e && e.message)); }
      } else if (wantsBottom && hasSession()) {
        // ★ 面板没开启时**自动开启并显示**（用户不必先去找开关）；但**没有会话时不允许展开** ⇒ 落到右侧栏
        BOTTOM.enabled = true; emitBottom();
        try {
          const sp = viewSpecs.get(kind);
          bpPanelMount(ctx, sp);
          if (PANEL && PANEL.el && PANEL.el.parentElement) {
            bpActivate(kind);
            console.warn('[dsh-shinki-sidebar-tools] 已自动开启底部栏并在其中打开：' + kind);
            return;
          }
          console.warn('[dsh-shinki-sidebar-tools] 自动开启后仍挂载失败 ⇒ 回退【右侧栏】：' + kind);
        } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 自动开启底部栏异常 ⇒ 回退【右侧栏】：' + (e && e.message)); }
      }
      // ① 官方 sidebarRight.openTab（实测该服务在本环境存在）
      const nav = svc(ctx, 'sidebarRight');
      if (nav && typeof nav.openTab === 'function') {
        const spec0 = (() => { try { return viewSpecs.get(kind) || {}; } catch { return {}; } })();
        for (const call of [
          () => nav.openTab(kind, { params: {}, activate: false }),
          () => nav.openTab(kind, { params: {}, focus: false }),
          () => nav.openTab(kind, { params: {} }),
          () => nav.openTab({ kind, id: kind, title: spec0.title || kind, params: {} }),
          () => nav.openTab(kind),
        ]) {
          try { call(); console.warn('[dsh-shinki-sidebar-tools] 已用 sidebarRight.openTab 打开：' + kind); return; }
          catch (e) { tried.push('openTab:' + (e && e.message)); }
        }
      } else { tried.push('sidebarRight.openTab:不可用'); }
      // ② 第三方 betterSidebar 的常见方法名兜底
      const sb = svc(ctx, 'betterSidebar');
      for (const m of ['openTab', 'addTab', 'createTab', 'newTab', 'open']) {
        if (sb && typeof sb[m] === 'function') {
          try { sb[m](kind); console.warn('[dsh-shinki-sidebar-tools] 已用 betterSidebar.' + m + ' 打开：' + kind); return; }
          catch (e) { tried.push('betterSidebar.' + m + ':' + e.message); }
        }
      }
      tried.push('betterSidebar:' + (sb ? Object.keys(sb).slice(0, 20).join(',') : '不可用'));
      console.warn('[dsh-shinki-sidebar-tools] 打开视图失败 kind=' + kind + ' | 尝试过：' + tried.join(' / '));
    }

    /** 往菜单容器追加「独立弹窗」分区（右键菜单与 ≡ 菜单共用）。取不到适配层就静默跳过。 */
    function appendPopupSection(ctx, el) {
      if (!ctx || !el) return 0;
      try {
        const sv = cacheViews(ctx);
        const pops = (sv && typeof sv.popupables === 'function') ? sv.popupables() : [];
        if (!pops.length) return 0;
        const sep = document.createElement('div');
        sep.className = 'shst-head';
        sep.textContent = '独立弹窗（' + pops.length + '）— 点击在独立窗口打开';
        el.appendChild(sep);
        for (const id of pops) {
          const b = document.createElement('button');
          b.className = 'shst-item';
          b.textContent = '⧉ ' + id;
          const k = document.createElement('span');
          k.className = 'shst-kind';
          k.textContent = 'popup';
          b.appendChild(k);
          b.addEventListener('click', (ev) => {
            ev.stopPropagation(); closeMenu();
            try { sv.openPopup(id); } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 弹窗触发失败：' + (e && e.message)); }
          });
          el.appendChild(b);
        }
        console.warn('[dsh-shinki-sidebar-tools] 菜单弹窗分区：' + pops.join(', '));
        return pops.length;
      } catch (e) {
        console.warn('[dsh-shinki-sidebar-tools] 菜单弹窗分区失败：' + (e && e.message));
        return 0;
      }
    }

    /** 底部面板开关：**按会话**（无全局开关）。没有会话时不允许展开。 */
    function toggleBottomPanel(ctx, on) {
      const _want = (on === undefined) ? !BOTTOM.enabled : !!on;
      if (_want && !hasSession()) {
        console.warn('[dsh-shinki-sidebar-tools] 当前没有会话 ⇒ 底部栏不允许展开（状态完全按会话绑定）');
        return false;
      }
      BOTTOM.enabled = _want;
      try {
        if (BOTTOM.enabled) {
          // ★ 展开 = **恢复该会话上次的 TAB 集合与当前视图**（与会话切换路径 bpSessionApply 同源）。
          //   旧实现是"挂载全部 bottom 视图 + 激活注册顺序里的第一个"，而注册顺序第一个正是 dsh-can-tool
          //   ⇒ 用户用 ✕ 关掉的视图每次展开都会复活，且完全无视会话记录里的 tabOrder/active。
          try { PANEL.tabOrder = (Array.isArray(PANEL.tabOrder) ? PANEL.tabOrder : []).filter((id) => viewSpecs.has(id)); } catch { PANEL.tabOrder = []; }
          const _saved = (PANEL.active && viewSpecs.has(PANEL.active) && (PANEL.tabOrder || []).includes(PANEL.active))
            ? PANEL.active
            : ((PANEL.tabOrder || [])[0] || null);
          if (!_saved) {
            // 本会话没有已打开的视图 ⇒ 展开一个**空面板**（TAB 条 + 空态提示）：
            //   既不复活任何被关掉的视图（旧实现会塞回注册顺序里的第一个 = dsh-can-tool），
            //   也不让「展开」变成按了没反应的按钮（用户仍可用 TAB 条的 ＋ 添加视图）。
            // ★ 关键前提：面板外壳只在"挂载过视图"时才被创建。本会话从未打开过任何视图时
            //   PANEL.el 仍是 null ⇒ 必须先建外壳，否则这里的"显示空面板"什么都不显示
            //   （用户实测：切换按钮与右下菜单点了都没反应）。
            try { if (!PANEL.el) bpPanelMount(ctx, null); } catch { /* 忽略 */ }
            try { bpClearHost(); } catch { /* 忽略 */ }
            try {
              if (PANEL.root && typeof PANEL.root.render === 'function' && react && typeof react.createElement === 'function') {
                PANEL.root.render(react.createElement('div', { style: { padding: '10px 12px', opacity: .72, fontSize: 12, lineHeight: 1.7 } },
                  '本会话还没有打开的视图 —— 点上方的「＋」，或用右下角「≡」菜单里的「＋ 视图 → 📥 底部栏」添加。'));
              }
            } catch { /* 忽略 */ }
            // ★ 必须把**内联高度/可见性**一并写回：收起（toggleBottomPanel(false)）会把
            //   el.style.height 写成 '0px'，而空面板路径不经过 bpShow()（只有它会写回内联高度）
            //   ⇒ 面板 0px 高、看不见，但让位变量已是 96px —— 用户看到的就是"会话视图底部多一块空白"。
            try {
              if (PANEL && PANEL.el) {
                PANEL.el.style.display = 'flex';
                PANEL.el.style.visibility = 'visible';
                PANEL.el.style.height = EMPTY_PANEL_H + 'px';
              }
            } catch { /* 忽略 */ }
            try { const _ov2 = document.getElementById('shinki-bp-overlay'); if (_ov2) _ov2.style.display = 'flex'; } catch { /* 忽略 */ }
            try { writeGeometry(EMPTY_PANEL_H, { force: true }); } catch { /* 忽略 */ }
            try { bpRenderTabs(); } catch { /* 忽略 */ }
            console.warn('[dsh-shinki-sidebar-tools] 本会话没有已打开的视图 ⇒ 显示空面板（不复活任何被关掉的视图）');
          } else {
            PANEL.active = _saved;
            try { bpPanelMount(ctx, viewSpecs.get(_saved)); } catch { /* 忽略 */ }
            try { bpActivate(_saved); } catch { /* 忽略 */ }
            try { if (PANEL && PANEL.el) PANEL.el.style.display = 'flex'; } catch { /* 忽略 */ }   // ★ 必须写 flex（'' 会清掉 display:flex）
            try { const _ov2 = document.getElementById('shinki-bp-overlay'); if (_ov2) _ov2.style.display = 'flex'; } catch { /* 忽略 */ }
            // ★ 面板固定挂在 <body>（视口级 fixed）⇒ 只要它可见，就一定要写让位（会话列 margin-bottom）
            if (PANEL.el && PANEL.active) { try { writeGeometry(PANEL.height); } catch { /* 忽略 */ } }
            else { try { bpReserve(0); } catch { /* 忽略 */ } }
            try { bpRenderTabs(); } catch { /* 忽略 */ }   // 打开时重建 TAB 条
            console.warn('[dsh-shinki-sidebar-tools] 底部面板：已开启（恢复本会话视图：' + _saved + '）');
          }
        } else {
          /* ★ 只隐藏，不销毁：视图保持挂载（状态保留，重开原样回来）*/
          try { if (PANEL && PANEL.el) PANEL.el.style.display = 'none'; } catch { /* 忽略 */ }
          /* 额外：把面板自身与**所有祖先**的底部内边距清干净（任何来源的残留都会消失）*/
          try { const _c = bpCol(); if (_c) { _c.style.paddingBottom = ''; delete _c.dataset.shinkiColPad; } } catch (e) {}
            try { let _n = PANEL.el; while (_n && _n !== document.body) { _n.style.paddingBottom = ''; _n.style.scrollPaddingBottom = ''; _n.style.marginBottom = ''; _n = _n.parentElement; } } catch (e) {}
          try { if (PANEL && PANEL.el) { PANEL.el.style.height = '0px'; } } catch { /* 忽略 */ }
          /* （不再重置 PANEL：视图继续挂载）*/
          try { const _ov = document.getElementById('shinki-bp-overlay'); if (_ov) _ov.style.display = 'none'; } catch { /* 忽略 */ }
          try { document.querySelectorAll('[data-shinki-bp-host]').forEach((h) => { h.style.display = 'none'; }); } catch { /* 忽略 */ }
          try { writeGeometry(0); } catch { /* 忽略 */ }   // ★ 变量置 0 ⇒ 让位空间自动归零，不可能残留
          console.warn('[dsh-shinki-sidebar-tools] 底部面板：已关闭（彻底隐藏）');
        }
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 底部面板切换失败：' + (e && e.message)); }
      try { bpSessionSave(); } catch { /* 忽略 */ }   // ★ 展开状态只按会话保存（全局 bottomOpen 已移除）
      emitBottom();
      return BOTTOM.enabled;
    }

    /** 在右侧栏"显示全部视图"（创建标签页，尽量不抢焦点）。
     *  注：已按用户要求**从右下菜单移除入口**（菜单项「📌 在右侧栏显示全部视图」已删除）；
     *  函数保留为内部工具，便于将来从别处（如指南）调用。 */
    function showAllInRightSidebar(ctx) {
      const nav = svc(ctx, 'sidebarRight');
      let done = 0;
      for (const [kind] of viewSpecs.entries()) {
        try {
          if (nav && typeof nav.openTab === 'function') {
            try { nav.openTab(kind, { params: {}, activate: false }); done++; continue; } catch { /* 换签名 */ }
            try { nav.openTab(kind, { params: {} }); done++; continue; } catch { /* 忽略 */ }
          }
        } catch { /* 忽略 */ }
      }
      console.warn('[dsh-shinki-sidebar-tools] 已在右侧栏创建视图 ' + done + ' 个');
      return done;
    }

    function showMenu(ctx, x, y) {
      if (typeof document === 'undefined') return;
      closeMenu();
      const mask = document.createElement('div');
      mask.className = 'shst-mask';
      mask.addEventListener('mousedown', closeMenu);
      document.body.appendChild(mask);
      maskEl = mask;

      const el = document.createElement('div');
      el.className = 'shst-menu';
      const head = document.createElement('div');
      head.className = 'shst-head';
      head.textContent = '创建视图';
      el.appendChild(head);
      appendPopupSection(ctx, el);   // 放在最前：菜单可滚动，避免被挤到可视区外
      // ★ 迷你 / 悬停视图（若有注册）：与"创建视图"并列，点选即开/关
      try {
        const minis = miniList();
        if (minis.length) {
          const h2 = document.createElement('div');
          h2.className = 'shst-head'; h2.textContent = '迷你 / 悬停视图';
          el.appendChild(h2);
          for (const v of minis) {
            const it = document.createElement('button');
            it.className = 'shst-item';
            const on = MINI.el && MINI.el.style.display !== 'none' && MINI.renderedId === v.id;
            const known = !!(miniStateAll().byView[v.id]);
            const vis = known ? !!miniStateOf(v.id).visible : true;   // 无记录时按 defaultVisible（缺省 true）
            it.textContent = (on ? '✓ 显示中：' : (vis ? '🪟 显示中(未开)：' : '🙈 已隐藏：')) + (titleOf(v) || v.id);
            it.title = (on || vis) ? '点击隐藏该悬停视图（隐藏后仍可从本菜单再打开）' : '点击显示该悬停视图';
            it.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); miniToggle(v.id); });
            el.appendChild(it);
          }
          // 显式"隐藏当前悬停视图"（用户要求：可直接隐藏，隐藏后只需菜单再打开）
          try {
            if (MINI.el && MINI.el.style.display !== 'none') {
              const hid = document.createElement('button');
              hid.className = 'shst-item';
              hid.textContent = '🙈 隐藏当前悬停视图';
              hid.title = '只隐藏显示（位置/尺寸/透明度都保留，稍后从本菜单再打开）';
              hid.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); miniHide(); });
              el.appendChild(hid);
            }
          } catch { /* 忽略 */ }
        }
      } catch { /* 忽略 */ }

      const views = viewList(ctx);
      console.warn('[dsh-shinki-sidebar-tools] 菜单已打开，可创建视图 ' + views.length + ' 个：' + views.map((v) => v.kind).join(', '));
      if (!views.length) {
        const none = document.createElement('div');
        none.className = 'shst-head';
        none.textContent = '（没有可用视图）';
        el.appendChild(none);
      }
      for (const v of views) {
        const it = document.createElement('button');
        it.className = 'shst-item';
        it.textContent = v.title;
        const k = document.createElement('span');
        k.className = 'shst-kind';
        k.textContent = v.kind;
        it.appendChild(k);
        it.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); openView(ctx, v.kind); });
        el.appendChild(it);
      }
      document.body.appendChild(el);
      positionMenu(el, { getBoundingClientRect: () => ({ left: x, top: y, width: 0 }) });
      menuEl = el;
    }

    /**
     * 等待服务就绪后再执行注册（解决加载顺序：侧边栏服务可能晚于本插件 apply）。
     * 超时会打印 ctx 上可见的服务键，便于诊断真正的服务名。
     */
    function waitFor(ctx, names, cb, tag) {
      let tries = 0;
      const missing = () => names.filter((n) => { const s = svc(ctx, n); return s === undefined || s === null; });
      const tick = () => {
        tries += 1;
        const miss = missing();
        if (!miss.length) { try { cb(); } catch (e) { console.warn("[" + tag + "] 注册失败：", e); } return true; }
        if (tries >= 40) {
          let keys = "无";
          try { keys = Object.keys(ctx || {}).slice(0, 40).join(","); } catch {}
          console.warn("[" + tag + "] 等待服务超时：" + miss.join(", ") + "；ctx 可见键：" + keys);
          return true;
        }
        return false;
      };
      if (tick()) return;
      const iv = setInterval(() => { if (tick()) clearInterval(iv); }, 250);
      try { ctx.effect(() => () => clearInterval(iv), tag + " cleanup"); } catch {}
    }

    /** 指南里的「创建视图」入口（「+」打开的就是指南）。 */
    function GuideEntry(props) {
      if (!react) return null;
      const { ctx } = props || {};
      const views = viewList(ctx);
      return react.createElement('div', { style: { padding: '6px 2px' } },
        react.createElement('div', { style: { fontSize: 11, opacity: .7, marginBottom: 6 } }, '创建视图'),
        views.map((v) => react.createElement('button', {
          key: v.kind,
          className: 'shst-item',
          style: { border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14))', marginBottom: 4 },
          onClick: () => openView(ctx, v.kind),
        }, v.title)),
        (() => {
          const sv = cacheViews(ctx);
          let pops = [];
          try { pops = (sv && typeof sv.popupables === 'function') ? sv.popupables() : []; } catch { pops = []; }
          if (!pops.length) return null;
          return react.createElement('div', { style: { marginTop: 8 } },
            react.createElement('div', { style: { fontSize: 11, opacity: .7, marginBottom: 6 } }, '独立弹窗（新窗口打开）'),
            pops.map((id) => react.createElement('button', {
              key: id,
              className: 'shst-item',
              style: { border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14))', marginBottom: 4, width: '100%', textAlign: 'left' },
              onClick: () => { try { sv.openPopup(id); } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 指南弹窗触发失败：' + (e && e.message)); } },
            }, '⧉ ' + id)),
          );
        })(),
      );
    }

    function onContextMenu(ev) {
      const t = ev.target;
      const hit = t && t.closest ? t.closest('[class*="stripChrome"], [class*="_stripTabs_"], [class*="strip"]') : null;
      if (!hit) return;                          // 接管整个 tab 条/控件区（含「+」）
      ev.preventDefault();
      ev.stopPropagation();
      showMenu(ev.__ctx, ev.clientX, ev.clientY);
    }

    function apply(ctx) {
      // 适配层对外入口（消费方：ctx.shinkiViews.register(...)；与 betterSidebar 同款的 ctx[name] 取用方式）
      try {
        adapterCtx = ctx;
        const svcViews = {
          CONTRACT_VERSION,
          register: (spec) => registerView(ctx, spec),
          /** 通用打开：open(id) / open(id, 'bottom') / open(id, 'right')
           *  - 'bottom' ⇒ 底部栏打开并**切到该视图**；'right' ⇒ 官方右侧栏（已存在则切换显示）*/
          open: (id, target) => { try { openView(ctx, id, target); } catch (e) { console.warn('[dsh-shinki-sidebar-tools] open 失败：' + (e && e.message)); } },
          openPopup: (id) => openPopupView(id),
          openPopupWindow: (id) => openPopupWindow(id),
          popupables: () => [...viewSpecs.values()].filter((v) => (v.targets || []).includes('popup')).map((v) => v.id),
          /** 迷你 / 悬停窗口：openMini(id) 显示、toggleMini(id) 切换、closeMini() 关闭 */
          openMini: (id) => miniShow(id),
          showMini: (id) => miniShow(id),
          hideMini: (id) => { MINI.renderedId = id || MINI.renderedId; return miniHide(); },
          toggleMini: (id) => miniToggle(id),
          closeMini: () => miniHide(),
          miniables: () => miniList().map((v) => v.id),
          miniState: (id) => (id ? miniStateOf(id) : miniStateAll()),
          list: () => [...viewSpecs.keys()],
          /** 可复用的后台生命周期：register(key, {onSuspend,onResume,onStop}) / dispatch(key, phase, policy) */
          lifecycle: {
            register: (key, handlers) => registerLifecycle(key, handlers),
            dispatch: (key, phase, policy) => dispatchLifecycle(key, phase, normalizeBackground(policy)),
            policies: () => BG_POLICIES.slice(),
            keys: () => [...lifecycles.keys()],
          },
          forms: () => Object.keys(VIEW_FORMS),
        };
        // cordis 要求用 provide 声明服务（直接赋值会报 "without provide"）
        viewsSvcCache = svcViews;
        if (typeof ctx.provide === 'function') ctx.provide('shinkiViews', svcViews);
        else ctx.shinkiViews = svcViews;
        console.warn('[dsh-shinki-sidebar-tools] 适配层就绪：ctx.shinkiViews (v' + CONTRACT_VERSION + ')');
        // ★ 面板状态按会话隔离：先按"当前会话"恢复（必须在任何 registerView 之前，自动挂载才看得到 BOTTOM.enabled）
        try { bpSessionInit(ctx); } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 会话状态初始化异常：' + (e && e.message)); }
        // ── 任务1：注册会话头部（右上角）显隐开关 —— 参考 bottom-toggle.tsx（此前只定义未调用 ⇒ 按钮不出现）
        try { registerHeaderToggle(ctx); } catch (e) { console.warn('[dsh-shinki-sidebar-tools] registerHeaderToggle 调用异常：' + (e && e.message)); }
      } catch (e) {
        console.warn('[dsh-shinki-sidebar-tools] 适配层 provide 失败，尝试回退赋值：' + (e && e.message));
        try { ctx.shinkiViews = ctx.shinkiViews || { CONTRACT_VERSION, register: (sp) => registerView(ctx, sp), openPopup: (id) => openPopupView(id), openPopupWindow: (id) => openPopupWindow(id), popupables: () => [...viewSpecs.values()].filter((v) => (v.targets || []).includes('popup')).map((v) => v.id), openMini: (id) => miniShow(id), showMini: (id) => miniShow(id), hideMini: (id) => { MINI.renderedId = id || MINI.renderedId; return miniHide(); }, toggleMini: (id) => miniToggle(id), closeMini: () => miniHide(), miniables: () => miniList().map((v) => v.id), list: () => [...viewSpecs.keys()], forms: () => Object.keys(VIEW_FORMS) }; } catch (e2) { console.warn('[dsh-shinki-sidebar-tools] 回退赋值亦失败：' + (e2 && e2.message)); }
      }
      // 独立弹窗握手：接收 view id 后全窗口承载；同时支持 URL 参数兜底
      try {
        window.addEventListener('message', (ev) => {
          if (ev.origin !== location.origin) return;
          const d = ev.data || {};
          if (d.type === 'shinki-tools:mount' && d.id) mountDetached(ctx, d.id);
        }, false);
        const q = new URLSearchParams(location.search || '');
        const want = q.get('shinkiView');
        if (want) mountDetached(ctx, want);
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 弹窗握手初始化失败：' + (e && e.message)); }
      // （已按用户要求移除「适配层自检」视图：它会在右下菜单「独立弹窗」/「可创建」里多出一条。
      //   适配层通路仍可从消费方视图 + console 日志（适配层就绪 / 各视图注册日志）确认。）

      injectCss();
      if (typeof document === 'undefined') return;

      // ── 自诊断：打印"所有 tab 条"的标题与布局实况（定位音乐视图落到哪了）──
      setTimeout(() => {
        try {
          const strips = Array.from(document.querySelectorAll('[class*="_stripTabs_"]'));
          const cssOn = !!document.getElementById(KIND + '-css');
          const dump = strips.map((st, i) => {
            const tabs = Array.from(st.querySelectorAll('[class*="_tab_"]')).map((el) => {
              const t = (el.textContent || '').trim().slice(0, 16);
              const active = /Active/.test(el.className) ? '*' : '';
              return active + (t || '(无文字)');
            });
            return '#' + i + ' 宽' + st.clientWidth + '/内容' + st.scrollWidth
              + ' 溢' + (st.scrollWidth > st.clientWidth ? 'YES' : 'no')
              + ' tabs[' + tabs.join(' | ') + ']';
          });
          const musicEls = Array.from(document.querySelectorAll('[class*="_tab_"]'))
            .filter((el) => /音乐/.test(el.textContent || '')).length;
          console.warn('[dsh-shinki-sidebar-tools] 诊断2 | CSS:' + cssOn
            + ' | tab条数:' + strips.length + ' | 含"音乐"字样的tab:' + musicEls
            + ' | ' + (dump.join(' ; ') || '无 tab 条'));
        } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 诊断2 失败：', e); }
      }, 2500);
      // 已移除 DOM hack（拦截 contextmenu）：官方为"创建视图"提供了 guide 入口与
      // sidebar.right.tab.menu.item 座位，不应改写页面行为。此处不再挂任何右键监听。

      // ── 浮动「≡ 全部视图」按钮：列出 tab 条里所有 tab，点击即滚到它并激活 ──
      // 不依赖滚轮事件、不依赖滚动条渲染、不改变任何布局（position:fixed 浮层）。
      const buildAllViews = () => {
        const strips = Array.from(document.querySelectorAll('[class*="_stripTabs_"]'));
        const out = [];
        strips.forEach((st, si) => {
          Array.from(st.querySelectorAll('[class*="_tab_"]')).forEach((el, ti) => {
            out.push({ label: ((el.textContent || '').trim() || '(无标题)'), el, si, ti, active: /Active/.test(el.className) });
          });
        });
        return out;
      };
      const jumpTo = (item) => {
        try { item.el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); } catch {}
        // 先滚入视野，再模拟点击激活（React 事件是冒泡委托，bubbles:true 即可）
        setTimeout(() => {
          try { item.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } catch {}
        }, 180);
      };
      const openAllViews = (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (menuEl) { closeMenu(); return; }
        const items = buildAllViews();
        const mask = document.createElement('div'); mask.className = 'shst-mask';
        mask.addEventListener('mousedown', closeMenu); document.body.appendChild(mask); maskEl = mask;
        const el = document.createElement('div'); el.className = 'shst-menu';
        const head = document.createElement('div'); head.className = 'shst-head';
        head.textContent = '全部视图（共 ' + items.length + '）— 点击直达'; el.appendChild(head);
        appendPopupSection(ctx, el);   // 放在最前（菜单可滚动）
      // ★ 迷你 / 悬停视图（若有注册）：与"创建视图"并列，点选即开/关
      try {
        const minis = miniList();
        if (minis.length) {
          const h2 = document.createElement('div');
          h2.className = 'shst-head'; h2.textContent = '迷你 / 悬停视图';
          el.appendChild(h2);
          for (const v of minis) {
            const it = document.createElement('button');
            it.className = 'shst-item';
            const on = MINI.el && MINI.el.style.display !== 'none' && MINI.renderedId === v.id;
            const known = !!(miniStateAll().byView[v.id]);
            const vis = known ? !!miniStateOf(v.id).visible : true;   // 无记录时按 defaultVisible（缺省 true）
            it.textContent = (on ? '✓ 显示中：' : (vis ? '🪟 显示中(未开)：' : '🙈 已隐藏：')) + (titleOf(v) || v.id);
            it.title = (on || vis) ? '点击隐藏该悬停视图（隐藏后仍可从本菜单再打开）' : '点击显示该悬停视图';
            it.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); miniToggle(v.id); });
            el.appendChild(it);
          }
          // 显式"隐藏当前悬停视图"（用户要求：可直接隐藏，隐藏后只需菜单再打开）
          try {
            if (MINI.el && MINI.el.style.display !== 'none') {
              const hid = document.createElement('button');
              hid.className = 'shst-item';
              hid.textContent = '🙈 隐藏当前悬停视图';
              hid.title = '只隐藏显示（位置/尺寸/透明度都保留，稍后从本菜单再打开）';
              hid.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); miniHide(); });
              el.appendChild(hid);
            }
          } catch { /* 忽略 */ }
        }
      } catch { /* 忽略 */ }
        items.forEach((it) => {
          const b = document.createElement('button'); b.className = 'shst-item';
          b.textContent = (it.active ? '● ' : '') + it.label;
          const k = document.createElement('span'); k.className = 'shst-kind'; k.textContent = '#' + it.si;
          b.appendChild(k);
          b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); jumpTo(it); });
          el.appendChild(b);
        });
        // ── 追加"可创建的视图"（来自官方注册表 entries()，点即创建）──
        // 可创建清单：**以插件注册信息为准**（viewSpecs 里有 id/title/targets），逐视图列出；
        // 同一插件注册多个视图时**分别显示**，并标出各自登记的目标（右侧栏/底部栏/弹窗/主视图）。
        const targetsBadge = (tg) => {
          const t = Array.isArray(tg) ? tg : [];
          const out = [];
          if (t.includes('right')) out.push('🚪 右侧栏');
          if (t.includes('bottom')) out.push('📥 底部栏');   // 点它即自动开启显示
          if (t.includes('popup')) out.push('🪟 弹窗');
          if (t.includes('mainView')) out.push('📄 主视图');
          return out.length ? out.join(' · ') : '🚪 右侧栏';
        };
        const pluginOf = (kind) => {
          const k = String(kind || '');
          const i = k.indexOf(':');
          return i > 0 ? k.slice(0, i) : k;
        };
        let creates = [];
        try {
          const seen = new Set();
          // ① 我自己的注册表（最准确：含 targets）
          for (const [kind, sp] of viewSpecs.entries()) {
            if (seen.has(kind)) continue;
            seen.add(kind);
            let _t = kind; try { _t = (typeof sp.title === 'function') ? sp.title() : (sp.title || kind); } catch { /* 忽略 */ }
            creates.push({ kind, title: _t || kind, targets: sp.targets || [], from: 'registry' });
          }
          // ② **不再**把官方注册表里的 kind 放进可点击清单 —— 实测两类问题：
          //    · page 类（如官方「文件」）在官方 placeTab 里被强制 `revealIfOpened:false`，已打开时点了不跳前台；
          //    · 服务层 `openTab(kind)` 不绑定可见 pane ⇒ 会新建/落到不可见 pane：表现为"右侧挤压 + 一片空白"。
          //    官方视图请从官方右栏自己的「＋」/指南打开（官方支持的路径，能正确落位与露出）。
          let officialCount = 0;
          try {
            const reg = svc(ctx, 'sidebarRightTabs');
            const types = (reg && typeof reg.entries === 'function') ? reg.entries() : [];
            for (const t of types) { if (t && t.kind && !seen.has(t.kind) && !viewSpecs.has(t.kind)) officialCount += 1; }
          } catch { /* 忽略 */ }
          if (officialCount) console.warn('[dsh-shinki-sidebar-tools] 菜单未列出 ' + officialCount + ' 个官方视图（请用官方右栏「＋」打开）');
          // ③ 兜底：内置清单里还没出现的
          for (const v of BUILTIN_VIEWS) {
            if (seen.has(v.kind)) continue;
            seen.add(v.kind);
            const sp = viewSpecs.get(v.kind);
            creates.push({ kind: v.kind, title: v.title, targets: (sp && sp.targets) || [], from: 'builtin' });
          }
        } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 枚举可创建视图失败：' + (e && e.message)); }
        if (creates.length) {
          const h2 = document.createElement('div');
          h2.className = 'shst-head';
          /* ── 侧栏 / 底部面板 开关（用户要求：默认彻底隐藏，提供开关）── */
          try {
            const sec = document.createElement('div');
            sec.textContent = '侧栏 / 底部面板';
            sec.style.cssText = 'font-size:11px;opacity:.7;margin:8px 0 4px';
            el.appendChild(sec);
            const mk = (label, fn) => {
            try { if (/(^|-)topright-/.test(String(id))) { return; } } catch (e) {}   // 按用户要求：不再创建固定悬浮入口
              const b = document.createElement('button');
              b.textContent = label;
              b.style.cssText = 'display:block;width:100%;text-align:left;margin:2px 0;padding:6px 8px;border-radius:6px;cursor:pointer;background:transparent;color:inherit;border:1px solid rgba(127,127,127,.25)';
              b.onclick = (ev) => { try { ev.stopPropagation(); } catch { /* 忽略 */ } fn(); };
              el.appendChild(b);
            };
            if (hasSession()) mk('📥 底部面板：' + (BOTTOM.enabled ? '关闭（彻底隐藏）' : '开启'), () => { toggleBottomPanel(ctx); closeMenu(); });
            else console.warn('[dsh-shinki-sidebar-tools] 当前没有会话 ⇒ 菜单不提供「底部面板」入口');
            // （已按用户要求移除「📥 立即显示底部栏（挂载 bottom 视图）」—— 与上一项功能重复）
          } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 侧栏开关分区构建失败：' + (e && e.message)); }

          h2.textContent = '可创建（' + creates.length + '）— 点击新建视图（🚪=右侧栏 / 📥=底部栏）';
          el.appendChild(h2);
          // 按**注册它的插件**分组，逐视图列出（同一插件多个视图分别显示）
          const groups = new Map();
          for (const c of creates) {
            const g = pluginOf(c.kind);
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g).push(c);
          }
          for (const [plugin, items] of groups) {
            const gh = document.createElement('div');
            gh.className = 'shst-head';
            // 可折叠分组：分组头点击折叠/展开（项目多时更好用）
            const box = document.createElement('div');
            box.style.cssText = 'display:flex;flex-direction:column'
            let folded = false;   // 默认展开
            gh.textContent = (folded ? '▸ ' : '▾ ') + plugin + (items.length > 1 ? '（' + items.length + ' 个视图）' : '');
            gh.style.cursor = 'pointer';
            gh.title = '点击折叠 / 展开该插件的视图';
            gh.addEventListener('click', (ev0) => { try { ev0.stopPropagation(); } catch { /* 忽略 */ } folded = !folded; gh.textContent = (folded ? '▸ ' : '▾ ') + plugin + (items.length > 1 ? '（' + items.length + ' 个视图）' : ''); box.style.display = folded ? 'none' : 'flex'; });
            el.appendChild(gh); el.appendChild(box);
            el.appendChild(gh);
            for (const c of items) {
              let _tgs = Array.isArray(c.targets) ? c.targets.filter((x) => x === 'bottom' || x === 'right') : [];
              if (!hasSession()) _tgs = _tgs.filter((x) => x !== 'bottom');   // ★ 无会话 ⇒ 不提供「📥 底部栏」入口
              if (!_tgs.length) _tgs = ['right'];
              for (const _tg of _tgs) {
              const b = document.createElement('button');
              b.className = 'shst-item';
              b.textContent = '＋ ' + c.title + (_tg === 'bottom' ? '   → 📥 底部栏' : '   → 🚪 右侧栏');
              const k = document.createElement('span');
              k.className = 'shst-kind';
              k.textContent = targetsBadge([_tg]);      // ★ 按注册信息显示的归属徽标
              k.style.cssText = 'opacity:.8;margin-left:6px';
              b.appendChild(k);
              b.title = c.kind + ' ｜ 注册信息 targets=' + JSON.stringify(c.targets || []);
              b.addEventListener('click', (e2) => { e2.stopPropagation(); closeMenu(); openView(ctx, c.kind, _tg); });
              box.appendChild(b);
              }   // for _tg
            }
          }
        } else {
          const none = document.createElement('div');
          none.className = 'shst-head';
          none.textContent = '（未枚举到可创建视图 —— 见控制台）';
          el.appendChild(none);
        }

        document.body.appendChild(el);
        positionMenu(el, ev.target);
        menuEl = el;
      };
      /** 底部栏开关悬浮按钮（▤）：与 ≡ 同一套 DOM 机制（已证明可见）⇒ 一定看得到。 */
      /** 固定右上角按钮：视觉上等同"会话视图右上角"，不依赖未知槽位 ⇒ 一定可见可用。 */
      const mountTopRight = (ctx2) => {
        try {
          if (document.getElementById('shinki-topright')) return;
          const wrap = document.createElement('div');
          wrap.id = 'shinki-topright';
          wrap.style.cssText = 'position:fixed;top:8px;right:12px;z-index:2147482300;display:flex;gap:4px;align-items:center';
          const mk = (id, label, title, fn2) => {
          try { if (/(^|-)topright-/.test(String(id))) { return; } } catch (e) {}   // 按用户要求：不再创建固定悬浮入口
            const b = document.createElement('button');
            b.id = id; b.textContent = label; b.title = title;
            b.style.cssText = 'cursor:pointer;font-size:12px;line-height:18px;padding:2px 8px;border-radius:4px;'
              + 'background:rgba(127,127,127,.18);color:inherit;border:1px solid rgba(127,127,127,.35)';
            b.onclick = (ev) => { try { ev.stopPropagation(); } catch { /* 忽略 */ } fn2(); };
            wrap.appendChild(b); return b;
          };
          const bBottom = mk('shinki-topright-bottom', '▤ 底部栏', '开 / 关底部栏', () => toggleBottomPanel(ctx2));
          const paint = () => { bBottom.style.opacity = BOTTOM.enabled ? '1' : '.55'; };
          paint(); try { subscribeBottom(paint); } catch { /* 忽略 */ }
          mk('shinki-topright-views', '🧩 视图', '全部视图（与右下角 ≡ 同一菜单）', () => {
            try { showMenu(ctx2, Math.max(8, window.innerWidth - 340), 44); } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 打开菜单失败：' + (e && e.message)); }
          });
          document.body.appendChild(wrap);
          console.warn('[dsh-shinki-sidebar-tools] 已挂载固定右上角开关（▤ 底部栏 / 🧩 视图）');
        } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 右上角开关挂载失败：' + (e && e.message)); }
      };

            /* 右下角 ▤ 悬浮图标已移除：底部栏开关只保留在菜单里（≡ / 🧩 → 📥 底部面板）*/

      const mountFab = () => {
        if (document.getElementById(KIND + '-fab')) return;
        const fab = document.createElement('button');
        fab.id = KIND + '-fab';
        fab.title = '全部视图（滚动/直达）';
        fab.textContent = '≡';
        fab.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147482200;width:26px;height:26px;border-radius:6px;'
          + 'border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.18));'
          + 'background:var(--dsw-alias-bg-layer-2, #23262d);color:var(--dsw-alias-label-primary,#e6edf3);'
          + 'font-size:13px;line-height:1;cursor:pointer;opacity:.75;';
        fab.addEventListener('click', openAllViews);
        document.body.appendChild(fab);
      };

      mountFab();
      // ★ 不再挂"固定右上角"悬浮按钮：它会盖住官方会话头部（用户反馈重叠）。
      //   改为注册到官方槽位 conversation.session.header.utilities（真实存在）。
      // 右下角不再挂多余的 ▤ 悬浮图标（用户要求：只保留菜单里的开关）

      // 滚轮/触控板横滚：**不依赖滚动条渲染**（QtWebEngine 下 ::-webkit-scrollbar 常不显示，
      // 这正是"官方右侧边栏滚不动"的原因）。悬停在 tab 条上滚轮即横向滚动。
      const onWheel = (ev) => {
        const t = ev.target;
        const strip = t && t.closest ? t.closest('[class*="_stripTabs_"]') : null;
        if (!strip) return;
        const d = Math.abs(ev.deltaY) >= Math.abs(ev.deltaX) ? ev.deltaY : ev.deltaX;
        if (!d) return;
        const before = strip.scrollLeft;
        strip.scrollLeft = before + d;
        if (strip.scrollLeft !== before) ev.preventDefault();
      };
      document.addEventListener('wheel', onWheel, { capture: true, passive: false });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); }, true);
      try {
        ctx.effect(() => () => {
          document.removeEventListener('contextmenu', onContextMenu, true);
          closeMenu();
          // ★ 迷你 / 悬停窗口与它的样式：卸载/热重载时必须清掉；否则会残留一份浮窗，
          //   重新加载后再创建就变成"两个迷你窗"（HMR 下很容易踩）。
          try { if (MINI.root && typeof MINI.root.unmount === 'function') MINI.root.unmount(); } catch { /* 忽略 */ }
          try { if (MINI.el && MINI.el.remove) MINI.el.remove(); } catch { /* 忽略 */ }
          MINI.el = null; MINI.bar = null; MINI.body = null; MINI.root = null; MINI.renderedId = null;
          try { const st = document.getElementById(KIND + '-mini-css'); if (st && st.remove) st.remove(); } catch { /* 忽略 */ }
          MINI.css = false;
        }, 'sidebar-tools cleanup');
      } catch {}

      // 指南入口插槽：等 slots 就绪再注册
      waitFor(ctx, ['slots'], () => {
        const slots = svc(ctx, 'slots');
        if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') { console.warn('[dsh-shinki-sidebar-tools] slots 服务缺 inject/register'); return; }
        ctx.effect(
          () => slots.inject('sidebar.right.tab.guide.entry', () => slots.register(
            { name: 'sidebar.right.tab.guide.entry', key: KIND },
            () => (react ? react.createElement(GuideEntry, { ctx }) : null),
          )),
          'sidebar-tools guide entry',
        );
        console.info('[dsh-shinki-sidebar-tools] 指南入口已注册');
      }, 'dsh-shinki-sidebar-tools');
    }

    exports.name = KIND;
    exports.inject = [];                 // 零注入：不给宿主启动添风险
    exports.apply = apply;
    exports.__viewList = viewList;       // 供测试
    return module.exports;
  },
});
