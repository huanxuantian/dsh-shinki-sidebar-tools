/**
 * dsh-shinki-sidebar-tools host half：临时视图的工具 + 只读路由 + 诊断端点。
 *
 * 诊断端点（无需 agent 工具即可判断链路）：
 *   GET /shinki-sidebar-temp/diag
 *     → { ok, inject, services:{tools,webServer}, tool:{registered,error,at}, version }
 */
import { createTempViews } from './temp-views-store.js';
import { registerTempViewTool } from './temp-views-tool.js';

export const name = 'dsh-shinki-sidebar-tools';

export const inject = ['webServer', 'tools'];

export function apply(ctx) {
  const store = createTempViews();
  const diag = {
    lastPollSession: null,
    lastReport: null,
    logs: [],
    startedAt: new Date().toISOString(),
    toolRegistered: false,
    toolError: null,
    toolsService: (() => { try { return !!(ctx && ctx.tools); } catch { return false; } })(),
    webServerService: (() => { try { return !!(ctx && ctx.webServer); } catch { return false; } })(),
  };

  ctx.effect(() => {
    const disposers = [];

    // ── 诊断端点 + 视图快照 ────────────────────────────────────────────────
    disposers.push(ctx.webServer.register({
      kind: 'prefix',
      path: '/shinki-sidebar-temp',
      handler: (req, res) => {
        const isDebug = (u) => { try { return u.searchParams.get('debug') === '1'; } catch { return false; } };
        const send = (code, obj) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.end(JSON.stringify(obj));
        };
        try {
          const url = new URL(req.url ?? '/', 'http://x');
          if (url.pathname.startsWith('/shinki-sidebar-temp/report')) {
            // 诊断回传默认关闭：必须带 ?debug=1，避免成为常开写入面。
            if (!isDebug(url)) { send(403, { ok: false, error: 'debug required' }); return; }
            let raw = '';
            req.on('data', function (c) { raw += c; if (raw.length > 20000) req.destroy(); });
            req.on('end', function () {
              try {
                const body = JSON.parse(raw || '{}');
                if (body && body.log) { diag.logs.push({ t: new Date().toISOString(), log: String(body.log).slice(0, 400) }); if (diag.logs.length > 30) diag.logs.shift(); }
                else diag.lastReport = body;
              } catch { diag.logs.push({ t: new Date().toISOString(), log: 'parse-error: ' + String(raw).slice(0, 200) }); }
              send(200, { ok: true });
            });
            req.on('error', function () { try { send(400, { ok: false }); } catch { /* ignore */ } });
            return;
          }
          if (url.pathname.startsWith('/shinki-sidebar-temp/diag')) {
            const debug = isDebug(url);
            send(200, {
              ok: true,
              inject: ['webServer', 'tools'],
              services: { tools: diag.toolsService, webServer: diag.webServerService },
              tool: { registered: diag.toolRegistered, error: diag.toolError, startedAt: diag.startedAt },
              lastPollSession: diag.lastPollSession,
              lastReport: debug ? diag.lastReport : null,
              logs: debug ? diag.logs : [],
              sessionsWithViews: [...new Set([...store.state.views.values()].map(function (v) { return v.sessionId; }))],
              version: store.state.version,
            });
            return;
          }
          if (!url.pathname.startsWith('/shinki-sidebar-temp/views')) { send(404, { ok: false, error: 'not found' }); return; }
          const session = url.searchParams.get('session') || '';
          const rawSince = url.searchParams.get('since');
          const since = (rawSince === null || rawSince === '') ? NaN : Number(rawSince);
          if (!session) { send(400, { ok: false, error: 'session required' }); return; }
          diag.lastPollSession = session;
          send(200, { ok: true, ...store.snapshot(session, since) });
        } catch (e) {
          send(500, { ok: false, error: String((e && e.message) || e) });
        }
      },
    }));

    // ── 工具注册（记录成功/失败，供 /diag 读取）───────────────────────────
    let disposed = false;
    let toolsOff = null;
    registerTempViewTool(ctx, store).then((off) => {
      diag.toolRegistered = true;
      if (disposed) { try { off(); } catch { /* ignore */ } } else { toolsOff = off; }
    }).catch((e) => {
      diag.toolError = String((e && e.message) || e);
      try { ctx?.logger?.info?.('[sidebar-tools] 工具注册失败: ' + diag.toolError); } catch { /* ignore */ }
    });

    return () => {
      disposed = true;
      try { toolsOff && toolsOff(); } catch { /* ignore */ }
      for (const d of disposers) { try { d(); } catch { /* ignore */ } }
    };
  }, 'dsh-shinki-sidebar-tools: temp views');
}