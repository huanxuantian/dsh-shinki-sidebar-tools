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
    const CONTRACT_VERSION = 2;   // v2: 新增 background 后台策略（缺省等价 v1）
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
        const wrapProps = { container: host, isDetached: !inPanel, close: () => (inPanel ? closeSelf() : window.close()), setTitle: (t) => { document.title = t || id; } };
        node = (react && typeof react.createElement === 'function')
          ? react.createElement(wrapView(spec, 'popup'), wrapProps)
          : spec.render({ ...wrapProps, form: 'popup', background: spec.background || 'pause' });
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 弹窗渲染失败：' + (e && e.message)); }
      if (!node) return;
      if (inPanel) {
        // 面板内承载：适配层自绘关闭按钮 + Esc，避免视图没有出口
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));font:12px system-ui,sans-serif;opacity:.9';
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
        if (ReactDOM && typeof ReactDOM.createRoot === 'function') ReactDOM.createRoot(mountInto).render(node);
        else if (ReactDOM && typeof ReactDOM.render === 'function') ReactDOM.render(node, mountInto);
        else if (node instanceof Node) mountInto.appendChild(node);
        else console.warn('[dsh-shinki-sidebar-tools] 弹窗：render 返回非 DOM 且无 react-dom，无法挂载');
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 弹窗挂载异常：' + (e && e.message)); }
    }

    /** 形态实现表：每项独立能力探测；不可用只 warn 并跳过。 */
    const VIEW_FORMS = {
      popup(ctx, spec) { /* 登记即可，按需 openPopupView(spec.id) */ },
      bottom(ctx, spec) {
        let viaOfficial = false;   // 官方右栏是否已注册（成功则跳过 better-sidebar 桥，避免重复入口）
        // ① 官方路径（零第三方）：注册进官方右侧栏 —— sidebarRightTabs 提供类型 + slots 提供内容。
        //    （官方布局只有 左/中/右 pane 与浮动，没有"底部停靠"；下方面板是 better-sidebar 自有 UI。）
        waitFor(ctx, ['sidebarRightTabs', 'slots', 'sidebarRight'], () => {
          try {
            const reg = svc(ctx, 'sidebarRightTabs');
            const slots = svc(ctx, 'slots');
            const nav = svc(ctx, 'sidebarRight');
            if (!reg || typeof reg.register !== 'function' || !slots || typeof slots.inject !== 'function') {
              console.warn('[dsh-shinki-sidebar-tools] 官方右栏不可用，回退 better-sidebar 桥：' + spec.id);
              return;
            }
            try {
              reg.register({
                id: spec.id,
                kind: spec.id,
                priority: 'extension',
                title: () => spec.title || spec.id,
                });
            } catch (e) {
              // 消费方自己已注册同 kind（或 better-sidebar 已原生注册）⇒ 视为成功，不再重复，也不报错
              if (/already registered/i.test(e && e.message)) console.warn('[dsh-shinki-sidebar-tools] 官方右栏该 kind 已存在，跳过重复注册：' + spec.id);
              else throw e;
            }
            // 自绘面板已停用（改用官方会话下方 dock）
            const Body = wrapView(spec, 'bottom');
                        // 纳入下方工具面板（参考 better-sidebar：挂进官方会话容器）
            try { bpEnsure(); } catch { /* 忽略 */ }
            // ★ 面板开关：注册到**会话主视图右上角**（会话头部工具位），与参考插件一致
            if (!bpToggleRegistered) {
              try {
                const Btn = () => h('button', {
                  type: 'button',
                  title: '显示/隐藏工具面板',
                  onClick: (e) => { try { e.preventDefault(); e.stopPropagation(); } catch { /* 忽略 */ } bpShow(); },
                  style: { cursor: 'pointer', background: 'transparent', color: 'inherit', fontSize: '12px', lineHeight: '18px',
                           border: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18))', borderRadius: '4px', padding: '2px 8px' },
                }, '工具面板');
                slots.inject('conversation.session.header.utilities', () => slots.register({
                  name: 'conversation.session.header.utilities',
                  id: 'dsh-shinki-tools:panel-toggle',
                  order: 90,
                }, Btn));
                bpToggleRegistered = true;
                console.warn('[dsh-shinki-sidebar-tools] 面板开关已注册到会话右上角（conversation.session.header.utilities）');
              } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 右上角开关注册失败（已忽略）：' + (e && e.message)); }
            }

            // 槽位条目必须自带 title()（官方渲染器会调用 entry.title()；缺了会抛
            // TypeError: entry.title is not a function ⇒ 整个 pane 渲染崩溃、视图全部消失）
            slots.inject('sidebar.right.pane.tab', () => slots.register({
              name: 'sidebar.right.pane.tab',
              key: spec.id,
              title: () => spec.title || spec.id,
            }, Body));
            // 不自动打开：默认只注册类型（视图出现在右栏 tab 条/≡ 菜单，由用户点击打开）。
            // 需要开机即开者，显式声明 autoOpen: true。
            if (spec.autoOpen) {
              try { if (nav && typeof nav.openTab === 'function') setTimeout(() => { try { nav.openTab(spec.id, { params: {} }); } catch { /* 忽略 */ } }, 400); } catch { /* 忽略 */ }
            }
            viaOfficial = true;
            console.warn('[dsh-shinki-sidebar-tools] bottom 形态已用**官方右栏**注册（零第三方）：' + spec.id);
          } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 官方右栏注册失败（将回退 better-sidebar）：' + (e && e.message)); }
        }, 'dsh-shinki-sidebar-tools: bottom(official) ' + spec.id);

        // ② 过渡桥回落：延迟 1.5s，若官方路径已注册则跳过（避免同一视图两个入口）
        waitFor(ctx, ['betterSidebar'], () => {
        setTimeout(() => {
        if (viaOfficial) { console.warn('[dsh-shinki-sidebar-tools] 官方右栏已注册，跳过 better-sidebar 桥：' + spec.id); return; }
        const sb = svc(ctx, 'betterSidebar');
        if (!sb || typeof sb.registerTab !== 'function') {
          console.warn('[dsh-shinki-sidebar-tools] bottom 形态暂不可用（官方槽位未接、过渡桥 betterSidebar 亦不可用）：' + spec.id);
          return;
        }
        try {
          sb.registerTab({
            id: spec.id, title: spec.title || spec.id, order: spec.order == null ? 50 : spec.order,
            single: spec.single == null ? true : !!spec.single,   // 透传 multi-tab 语义（串口监控/占用为 false）
            settings: spec.settings,   // 透传插件自有设置行（v2 契约可选字段）
            icon: spec.icon,           // 透传图标（否则原生注册进右侧栏时缺图标/可能被跳过）
            // 建 Tab 后**统一标记为底部停靠**（targets 含 'bottom' 即语义上属于下方面板）。
            // 消费方自带 createTab 时优先用它的（多 Tab、按端口去重等），只补 meta.dockedBottom。
            createTab: ((baseCreate) => (st) => {
              const r = (typeof baseCreate === 'function')
                ? baseCreate(st)
                : { tab: { id: spec.id + ':' + ((st && st.nextTerminal) || 0), type: spec.id, title: spec.title || spec.id, meta: {} }, patch: {} };
              try { r.tab.meta = { ...(r.tab.meta || {}), dockedBottom: true }; } catch { /* 忽略 */ }
              return r;
            })(spec.createTab),
            dedupeKey: spec.dedupeKey,
            component: (() => {
              const Wrapped = wrapView(spec, 'bottom');
              return (props) => (react && typeof react.createElement === 'function')
                ? react.createElement(Wrapped, { ...(props || {}), container: null, isDetached: false, close: () => {}, setTitle: () => {} })
                : spec.render({ container: null, form: 'bottom', isDetached: false, close: () => {}, setTitle: () => {}, ...(props || {}) });
            })(),
          });
          console.warn('[dsh-shinki-sidebar-tools] bottom 形态已用过渡桥挂载：' + spec.id);
        } catch (e) { console.warn('[dsh-shinki-sidebar-tools] bottom 过渡桥失败：' + (e && e.message)); }
        }, 1500);
        }, 'dsh-shinki-sidebar-tools: bottom ' + spec.id);
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
            const label = () => spec.title || spec.id;
            const viewProps = (extra) => ({
              container: null, form: 'mainView', isDetached: false,
              background: spec.background || normalizeBackground(spec.background),
              close: () => {}, setTitle: () => {}, ...(extra || {}),
            });

            // 视图区渲染方式（官方 conversation 包源码）：renderSlot("conversation.view", …, { only: viewId })
            // 只渲染「该条目自己的组件」，且官方注册组件用的是 slots.register(options, Component) 的**第二个参数**。
            const Body = wrapView(spec, 'mainView');
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

    /* ═════════ 下方工具面板（参考 better-sidebar 的做法）═════════
       关键差异：**挂进官方会话容器**（#root [data-slot="conversation"]）而非 document.body，
       因而与应用布局同层、不会盖住其它视图；样式与交互照搬 its bottomPanel：
       position:absolute; bottom:0; z-index:40; 收起用 translateY(102%)+visibility:hidden;
       顶边 8px row-resize 可拖高；tab 条 + 单视图（一次只渲染一个，避免堆叠）。
       全部包在 try/catch 里：取不到容器或渲染出错都不影响应用。 */
    const BP = { el: null, bar: null, host: null, active: null, height: 220, anchor: null };
    let bpToggleRegistered = false;

    function bpAnchor() {
      try {
        return document.querySelector('#root [data-slot="conversation"]')
          || document.querySelector('[data-slot="conversation"]')
          || document.querySelector('[data-dsh-panel-host]');
      } catch { return null; }
    }
    function bpViews() { return [...viewSpecs.values()].filter((v) => (v.targets || []).includes('bottom')); }

    function bpShow(show) {
      try {
        bpEnsure();
        if (!BP.el) return;
        const want = show == null ? BP.el.style.visibility !== 'visible' : !!show;
        BP.el.style.visibility = want ? 'visible' : 'hidden';
        BP.el.style.transform = want ? 'translateY(0)' : 'translateY(102%)';
        BP.el.style.pointerEvents = want ? 'auto' : 'none';
        for (const c of Array.from(BP.el.querySelectorAll('*'))) { try { c.style.pointerEvents = want ? 'auto' : 'none'; } catch { /* 忽略 */ } }
        if (want) bpActivate(BP.active || (bpViews()[0] && bpViews()[0].id));
        try { localStorage.setItem('dsh-shinki-tools.bp', want ? '1' : '0'); } catch { /* 忽略 */ }
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 下方工具面板切换失败：' + (e && e.message)); }
    }

    function bpActivate(id) {
      const spec = viewSpecs.get(id);
      if (!spec || !BP.host) return;
      BP.active = id;
      try { localStorage.setItem('dsh-shinki-tools.bp.active', id); } catch { /* 忽略 */ }
      if (BP.bar) for (const b of Array.from(BP.bar.querySelectorAll('button'))) b.style.opacity = (b.dataset.id === id ? '1' : '.55');
      BP.host.textContent = '';
      try {
        const node = wrapView(spec, 'bottom')({ container: BP.host, form: 'bottom', isDetached: false, close: () => bpShow(false), setTitle: () => {} });
        const RD = safeRequire('react-dom/client') || safeRequire('react-dom');
        if (RD && typeof RD.createRoot === 'function') RD.createRoot(BP.host).render(node);
        else if (RD && typeof RD.render === 'function') RD.render(node, BP.host);
        console.warn('[dsh-shinki-sidebar-tools] 下方工具面板已承载视图：' + id);
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 下方工具面板渲染失败（已隔离，不影响应用）：' + (e && e.message)); }
    }

    function bpEnsure() {
      if (BP.el || typeof document === 'undefined') return;
      const parent = bpAnchor();
      if (!parent) return;                       // 取不到官方会话容器 ⇒ 静默不启用（绝不破坏应用）
      try {
        BP.anchor = parent;
        try { const cs = getComputedStyle(parent); if (cs && cs.position === 'static') parent.style.position = 'relative'; } catch { /* 忽略 */ }
        const el = document.createElement('div');
        el.id = 'shinki-bp';
        el.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:' + BP.height + 'px;z-index:90;'
          + 'display:flex;flex-direction:column;visibility:hidden;transform:translateY(102%);'
          + 'pointer-events:none;transition:transform .18s ease,visibility 0s linear .18s;'
          + 'background:var(--dsw-alias-bg-layer-1,#1b1d22);border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));'
          + 'color:var(--dsw-alias-label-primary,#e6edf3);font-size:12px;padding-bottom:env(safe-area-inset-bottom)';
        const rz = document.createElement('div');
        rz.style.cssText = 'position:absolute;left:0;right:0;top:-4px;height:8px;cursor:row-resize;z-index:2;touch-action:none';
        rz.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          const y0 = ev.clientY, h0 = BP.height;
          const mv = (e2) => { const hh = Math.max(100, Math.min(Math.round((window.innerHeight || 800) * 0.8), h0 + (y0 - e2.clientY))); BP.height = hh; el.style.height = hh + 'px'; };
          const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); try { localStorage.setItem('dsh-shinki-tools.bp.h', String(BP.height)); } catch { /* 忽略 */ } };
          document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        });
        el.appendChild(rz);
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));flex:none;overflow-x:auto';
        const lab = document.createElement('span'); lab.textContent = '工具面板'; lab.style.cssText = 'opacity:.65;flex:none'; bar.appendChild(lab);
        for (const v of bpViews()) {
          const b = document.createElement('button');
          b.textContent = v.title || v.id; b.dataset.id = v.id;
          b.style.cssText = 'cursor:pointer;background:transparent;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));color:inherit;border-radius:4px;padding:2px 8px;flex:none;opacity:.55';
          b.addEventListener('click', () => bpActivate(v.id)); bar.appendChild(b);
        }
        const x = document.createElement('button'); x.textContent = '✕'; x.title = '收起（Esc）';
        x.style.cssText = 'margin-left:auto;cursor:pointer;background:transparent;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));color:inherit;border-radius:4px;padding:1px 8px;flex:none';
        x.addEventListener('click', () => bpShow(false)); bar.appendChild(x);
        const host = document.createElement('div');
        host.style.cssText = 'position:relative;flex:1;min-height:0;overflow:auto';
        el.appendChild(bar); el.appendChild(host);
        parent.appendChild(el);
        BP.el = el; BP.bar = bar; BP.host = host;
        // 面板开关改到「会话主视图右上角」（conversation.session.header.utilities，与参考插件一致）
        try { const h0 = Number(localStorage.getItem('dsh-shinki-tools.bp.h')); if (h0 >= 100) { BP.height = h0; el.style.height = h0 + 'px'; } } catch { /* 忽略 */ }
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && BP.el && BP.el.style.visibility === 'visible') bpShow(false); }, true);
        console.warn('[dsh-shinki-sidebar-tools] 下方工具面板已注入官方会话容器（better-sidebar 同法）：' + (parent.getAttribute && parent.getAttribute('data-slot') || 'host'));
        try { if (localStorage.getItem('dsh-shinki-tools.bp') === '1') setTimeout(() => bpShow(true), 800); } catch { /* 忽略 */ }
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 下方工具面板注入失败（已忽略）：' + (e && e.message)); }
    }

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

    /** 包装消费方 render：统一注入 background、并在挂载/卸载时派发生命周期钩子。 */
    function wrapView(spec, form) {
      const bgOf = (props) => (props && props.background) || spec.background || normalizeBackground(spec.background);
      if (!react || typeof react.useEffect !== 'function') {
        return (props) => spec.render({ ...(props || {}), form, background: bgOf(props) });
      }
      return function ShinkiWrappedView(props) {
        const policy = bgOf(props);
        react.useEffect(() => {
          dispatchLifecycle(spec.id, 'resume', policy);
          return () => { dispatchLifecycle(spec.id, 'suspend', policy); };
        }, []);
        return spec.render({ ...(props || {}), form, background: policy });
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
      const handle = {
        id: spec.id,
        dispose() {
          viewSpecs.delete(spec.id); viewHandles.delete(spec.id);
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
        [class*="_stripTabs_"]::-webkit-scrollbar-thumb {
          background: var(--dsw-alias-border-l2, rgba(255,255,255,.28)); border-radius: 3px;
        }
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
      let r = { left: 20, top: (window.innerHeight || 768) - 40, width: 26 };
      try { if (anchorEl && anchorEl.getBoundingClientRect) r = anchorEl.getBoundingClientRect(); } catch {}
      const vw = window.innerWidth || 1024;
      const vh = window.innerHeight || 768;
      const w = el.offsetWidth || 220;
      const h = el.offsetHeight || 260;
      let left = r.left - w + (r.width || 26);
      let top = r.top - h - 8;                       // 优先放按钮上方
      if (top < 8) top = vh - h - 8;                 // 上方不够 → 贴底
      left = Math.max(8, Math.min(left, vw - w - 8));
      top = Math.max(8, Math.min(top, vh - h - 8));  // ★ 同时夹住下边界
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.maxHeight = Math.max(140, vh - 16) + 'px';
      el.style.overflowY = 'auto';
    }

    let menuEl = null;
    let maskEl = null;

    function closeMenu() {
      try { menuEl && menuEl.remove(); } catch {}
      try { maskEl && maskEl.remove(); } catch {}
      menuEl = null; maskEl = null;
    }

    function openView(ctx, kind) {
      const tried = [];
      // ① 官方 sidebarRight.openTab（实测该服务在本环境存在）
      const nav = svc(ctx, 'sidebarRight');
      if (nav && typeof nav.openTab === 'function') {
        try { nav.openTab(kind, { params: {} }); console.warn('[dsh-shinki-sidebar-tools] 已用 sidebarRight.openTab 打开：' + kind); return; }
        catch (e) { tried.push('sidebarRight.openTab:' + e.message); }
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
          openPopup: (id) => openPopupView(id),
          openPopupWindow: (id) => openPopupWindow(id),
          popupables: () => [...viewSpecs.values()].filter((v) => (v.targets || []).includes('popup')).map((v) => v.id),
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
      } catch (e) {
        console.warn('[dsh-shinki-sidebar-tools] 适配层 provide 失败，尝试回退赋值：' + (e && e.message));
        try { ctx.shinkiViews = ctx.shinkiViews || { CONTRACT_VERSION, register: (sp) => registerView(ctx, sp), openPopup: (id) => openPopupView(id), openPopupWindow: (id) => openPopupWindow(id), popupables: () => [...viewSpecs.values()].filter((v) => (v.targets || []).includes('popup')).map((v) => v.id), list: () => [...viewSpecs.keys()], forms: () => Object.keys(VIEW_FORMS) }; } catch (e2) { console.warn('[dsh-shinki-sidebar-tools] 回退赋值亦失败：' + (e2 && e2.message)); }
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
      // 自检视图：验证适配层通路（纯 DOM，无 React 依赖）
      try {
        registerView(ctx, {
          id: 'dsh-shinki-tools:sandbox', title: '适配层自检', targets: ['popup'],
          background: 'pause',   // 自检用非 force 策略：便于在日志里确认策略分支生效
          render: () => {
            const d = document.createElement('div');
            d.style.cssText = 'padding:16px;font:13px/1.7 system-ui,sans-serif';
            d.innerHTML = '<b>适配层自检（popup 形态）</b><br>契约版本 v' + CONTRACT_VERSION
              + '<br>已注册视图：' + [...viewSpecs.keys()].join(', ')
              + '<br>形态：' + Object.keys(VIEW_FORMS).join(', ')
              + '<br><br><span style="opacity:.7">窗口尺寸跟随浏览器；本视图由 shinki-sidebar-tools 适配层承载。</span>';
            return d;
          },
        });
      } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 自检视图注册失败：' + (e && e.message)); }

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
        items.forEach((it) => {
          const b = document.createElement('button'); b.className = 'shst-item';
          b.textContent = (it.active ? '● ' : '') + it.label;
          const k = document.createElement('span'); k.className = 'shst-kind'; k.textContent = '#' + it.si;
          b.appendChild(k);
          b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); jumpTo(it); });
          el.appendChild(b);
        });
        // ── 追加"可创建的视图"（来自官方注册表 entries()，点即创建）──
        let creates = [];
        try {
          const reg = svc(ctx, 'sidebarRightTabs');
          const types = (reg && typeof reg.entries === 'function') ? reg.entries() : [];
          const seen = new Set();
          // 先放内置兜底（保证一定出现），再并入注册表枚举
          for (const v of BUILTIN_VIEWS) { seen.add(v.kind); creates.push({ kind: v.kind, title: v.title }); }
          for (const t of types) {
            if (!t || !t.kind || seen.has(t.kind)) continue;
            seen.add(t.kind);
            let title = t.kind;
            try { title = (typeof t.title === 'function') ? t.title('') : (t.title || t.kind); } catch {}
            creates.push({ kind: t.kind, title: title || t.kind });
          }
        } catch (e) { console.warn('[dsh-shinki-sidebar-tools] 枚举可创建视图失败：' + (e && e.message)); }
        if (creates.length) {
          const h2 = document.createElement('div');
          h2.className = 'shst-head';
          h2.textContent = '可创建（' + creates.length + '）— 点击新建视图';
          el.appendChild(h2);
          creates.forEach((c) => {
            const b = document.createElement('button');
            b.className = 'shst-item';
            b.textContent = '＋ ' + c.title;
            const k = document.createElement('span');
            k.className = 'shst-kind';
            k.textContent = c.kind;
            b.appendChild(k);
            b.addEventListener('click', (e2) => { e2.stopPropagation(); closeMenu(); openView(ctx, c.kind); });
            el.appendChild(b);
          });
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
      try { ctx.effect(() => () => { document.removeEventListener('contextmenu', handler, true); closeMenu(); }, 'sidebar-tools cleanup'); } catch {}

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
