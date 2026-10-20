/**
 * dsh-shinki-sidebar-tools host half。
 *
 * 分步验证（Step 1）：只声明 `tools` 注入并注册一个**极简**工具，用来确认
 *   1) 插件在 0.2.1 上能正常激活（不阻塞会话创建）；
 *   2) 新注册的工具能否被**已有会话**看到（DSH 里有 toolsChanged / refreshTools）。
 * 这一步不碰 webServer、不注册路由，避免把"路由失败"和"工具失败"混在一起。
 */

let cachedDefineTool;
async function loadDefineTool() {
  if (cachedDefineTool !== undefined) return cachedDefineTool;
  try {
    const mod = await import('@deepseek-ai/dsh-tools');
    cachedDefineTool = mod.defineTool;
  } catch {
    cachedDefineTool = (o) => ({ ...o, parameters: { type: 'object', properties: (o && o.parameters) || {}, additionalProperties: false } });
  }
  return cachedDefineTool;
}

export const name = 'dsh-shinki-sidebar-tools';

export const inject = ['tools'];

export function apply(ctx) {
  ctx?.logger?.debug?.('[dsh-shinki-sidebar-tools] host: step1 (tools only)');

  ctx.effect(() => {
    let disposed = false;
    let off = null;
    (async () => {
      try {
        const defineTool = await loadDefineTool();
        const tool = defineTool({
          name: 'sidebar_temp_ping',
          description: '连通性自检：返回 pong 与当前会话 id（用于验证工具能否在已有会话中被刷新出来）。',
          parameters: {},
          output: {
            schema: { ok: { type: 'boolean' }, pong: { type: 'string' }, sessionId: { type: 'string' } },
            render: (r) => [{ type: 'text', text: JSON.stringify(r) }],
          },
          async execute(_args, exec) {
            const sid = exec?.agent?.id;
            return { ok: true, pong: 'pong', sessionId: typeof sid === 'string' ? sid : '' };
          },
        });
        off = ctx.tools.register(tool);
        if (disposed) { try { off(); } catch { /* ignore */ } off = null; }
        else ctx?.logger?.debug?.('[dsh-shinki-sidebar-tools] step1 tool registered');
      } catch (e) {
        console.warn('[dsh-shinki-sidebar-tools] step1 工具注册失败: ' + (e && e.message));
      }
    })();
    return () => { disposed = true; try { if (off) off(); } catch { /* ignore */ } };
  }, 'dsh-shinki-sidebar-tools: step1 tool');
}