/**
 * `sidebar_temp_view` 工具（按会话归属的临时视图管理）。
 *
 * 两个必须遵守的契约（都是实测踩出来的）：
 *   1) defineTool 必须提供 output.render，否则报
 *      "Cannot read properties of undefined (reading 'render')" —— 工具注册直接失败；
 *   2) output.schema 用**标量字段**最稳；列表类结果序列化成字符串返回（viewsText），
 *      避免 array/nested schema 在 0.2.1 上触发校验问题。
 */
import { FORMS } from './temp-views-store.js';

const S = (description) => ({ type: 'string', description });
const B = (description) => ({ type: 'boolean', description });
const N = (description) => ({ type: 'number', description });

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

export async function registerTempViewTool(ctx, store) {
  const defineTool = await loadDefineTool();
  const tool = defineTool({
    name: 'sidebar_temp_view',
    description:
      '临时视图：在当前会话里注册/修改/卸载/列出临时视图（重启后消失，仅当前会话可见）。'
      + `action=register|update|unregister|list；form 用逗号分隔，可选 ${FORMS.join('/')}；`
      + '标题会自动加【临时】前缀；内容为纯文本。',
    parameters: {
      action: S('register | update | unregister | list'),
      id: S('视图 id（update/unregister 需要；register 可省略，自动生成 tmp-*）'),
      title: S('纯文本标题（register 需要）'),
      text: S('纯文本内容'),
      form: S(`逗号分隔的形态：${FORMS.join('/')}（默认 mini）`),
      visible: B('是否显示（默认 true，仅 mini 有意义）'),
      scope: S('unregister 时可填 session，表示卸载本会话全部'),
    },
    output: {
      // 必须是**标准 JSON Schema**（带 type/properties），扁平映射会被拒：
      // "unsupported JSON schema: schema.type must be string/number/..."
      schema: {
        type: 'object',
        properties: {
          ok: B('是否成功'),
          id: S('受影响的视图 id'),
          version: N('宿主版本号'),
          removed: N('卸载数量'),
          scope: S('卸载范围'),
          error: S('错误信息'),
          viewsText: S('JSON 字符串形式的视图列表（list 时返回）'),
        },
        additionalProperties: false,
      },
      render: (r) => [{ type: 'text', text: JSON.stringify(r) }],
    },
    async execute(args, exec) {
      const sessionId = exec?.agent?.id;
      if (typeof sessionId !== 'string' || !sessionId) {
        return { ok: false, error: '无法确定当前会话（exec.agent.id 为空）' };
      }
      const a = args || {};
      const forms = typeof a.form === 'string'
        ? a.form.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      switch (a.action) {
        case 'register': return store.register(sessionId, { ...a, form: forms });
        case 'update': return store.update(sessionId, { ...a, form: forms });
        case 'unregister': return store.unregister(sessionId, a);
        case 'list':
          return { ok: true, version: store.state.version, viewsText: JSON.stringify(store.listFor(sessionId)) };
        default:
          return { ok: false, error: `未知 action：${a.action}` };
      }
    },
  });
  return ctx.tools.register(tool);
}