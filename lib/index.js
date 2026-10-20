/**
 * dsh-shinki-sidebar-tools host half（占位）。
 *
 * 全部能力在浏览器半边：tab 条滚动样式 + 「创建视图」菜单 + 视图注册与布局。
 *
 * ⚠ 实测结论（2026-10-20）：本插件的 host 半边**只要做任何服务访问/注册就整体失效**
 * （侧边栏与底部面板都会消失），已试过并全部失败的写法：
 *   1) inject = ['webServer'] + ctx.webServer.register(...)
 *   2) inject = ['tools'] + ctx.tools.register(...)
 *   3) inject = [] + ctx.effect 里定时 ctx.get('webServer') 后再注册
 *   4) inject = [] + ctx.inject(['webServer'], cb) 作用域注入
 * 因此 host 半边保持占位、不碰任何服务。临时视图等需要宿主的特性，须先查清
 * 上述失效原因（怀疑与 package.json 缺少 dsh.host 声明、或宿主半边被当作异常的
 * 客户端模块处理有关），再决定方案。
 */

export const name = 'dsh-shinki-sidebar-tools';

export const inject = [];

export function apply(ctx) {
  ctx?.logger?.debug?.('[dsh-shinki-sidebar-tools] host half ready (client-only, placeholder)');
}