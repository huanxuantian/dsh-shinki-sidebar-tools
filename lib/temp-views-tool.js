/** `sidebar_temp_view` 工具定义（按会话归属的临时视图管理）。 */
import { FORMS } from './temp-views-store.js';

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

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });

export async function registerTempViewTool(ctx, store) {
  const defineTool = await loadDefineTool();
  const tool = defineTool({
    name: 'sidebar_temp_view',
    description:
      '临时视图管理：在**当前会话**里注册/修改/卸载一个临时视图（重启或关闭会话后消失）。'
      + 'id 以 tmp- 开头；标题会自动加【临时】前缀；内容为纯文本。',
    parameters: {
      action: { ...str('register | update | unregister | list'), enum: ['register', 'update', 'unregister', 'list'] },
      id: str('临时视图 id（update/unregister 必填；register 可省略自动生成 tmp-*）'),
      title: str('纯文本标题（register 必填；显示时会加【临时】前缀）'),
      text: str('纯文本内容（多行）'),
      form: {
        type: 'array',
        description: `视图形态，可多选：${FORMS.join(' / ')}（默认 mini）`,
        items: { type: 'string', enum: FORMS },
      },
      width: num('仅 mini：宽度 px'),
      height: num('仅 mini：高度 px'),
      visible: bool('仅 mini：是否显示（默认 true）'),
      scope: { ...str('unregister 时可传 session 卸载本会话全部'), enum: ['session'] },
    },
    output: {
      schema: {
        ok: bool('是否成功'),
        id: str('受影响的视图 id'),
        version: num('宿主版本号'),
        removed: num('卸载数量'),
        scope: str('卸载范围'),
        error: str('错误信息'),
      },
      render: (r) => [{ type: 'text', text: JSON.stringify(r) }],
    },
    async execute(args, exec) {
      // exec.agent.id 就是发起这次调用的会话（与串口工具同一做法）
      const sessionId = exec?.agent?.id;
      if (typeof sessionId !== 'string' || !sessionId) {
        return { ok: false, error: '无法确定当前会话（exec.agent.id 为空）' };
      }
      const a = args || {};
      switch (a.action) {
        case 'register': return store.register(sessionId, a);
        case 'update': return store.update(sessionId, a);
        case 'unregister': return store.unregister(sessionId, a);
        case 'list': return { ok: true, version: store.state.version, views: store.listFor(sessionId) };
        default: return { ok: false, error: `未知 action：${a.action}` };
      }
    },
  });
  return ctx.tools.register(tool);
}