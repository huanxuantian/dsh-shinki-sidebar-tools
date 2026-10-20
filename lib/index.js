/**
 * dsh-shinki-sidebar-tools host half。
 *
 * 目前只做一件事：暴露 `sidebar_temp_view` 工具 + 一个只读路由，供客户端轮询
 * "本会话的临时视图"并动态注册。视图渲染全部在客户端（lib/client.js）。
 *
 * 0.2.1 注意：服务名是 `ctx.webServer`（`webRuntime` 已移除），必须在 inject 里声明，
 * 否则运行时访问 ctx 属性会抛 "cannot get property without inject"。
 */
import { createTempViews } from './temp-views-store.js';
import { registerTempViewTool } from './temp-views-tool.js';

export const name = 'dsh-shinki-sidebar-tools';

export const inject = ['webServer', 'tools'];

export function apply(ctx) {
  const store = createTempViews();

  ctx.effect(() => {
    const disposers = [];
    // 只读路由：客户端轮询用。GET /shinki-sidebar-temp/views?session=<id>&since=<ver>
    disposers.push(ctx.webServer.register({
      kind: 'prefix',
      path: '/shinki-sidebar-temp',
      handler: (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://x');
          if (!url.pathname.startsWith('/shinki-sidebar-temp/views')) {
            res.statusCode = 404;
            res.end('not found');
            return;
          }
          const session = url.searchParams.get('session') || '';
          // 注意：缺省 since 必须当作「未知」而不是 0 —— 否则与初始 version=0 相等，\n          // 首次拉取会错误地返回 views:null（实测踩到）。\n          const rawSince = url.searchParams.get('since');\n          const since = (rawSince === null || rawSince === '') ? NaN : Number(rawSince);
          if (!session) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, error: 'session required' }));
            return;
          }
          const snap = store.snapshot(session, since);
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.end(JSON.stringify({ ok: true, ...snap }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
        }
      },
    }));
    // 工具注册是异步的（需要动态 import defineTool）
    let disposed = false;
    registerTempViewTool(ctx, store).then((off) => {
      if (disposed) { try { off(); } catch { /* ignore */ } }
      else disposers.push(off);
    }).catch((e) => { console.warn('[dsh-shinki-sidebar-tools] 工具注册失败: ' + (e && e.message)); });
    return () => { disposed = true; for (const d of disposers) { try { d(); } catch { /* ignore */ } } };
  }, 'dsh-shinki-sidebar-tools: temp views');
}