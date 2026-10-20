/**
 * dsh-shinki-sidebar-tools host half（占位）。
 * 全部能力在浏览器半边：tab 条滚动样式 + 「创建视图」菜单。故不访问任何 host 服务。
 */
export const name = 'dsh-shinki-sidebar-tools';
export const inject = [];
export function apply(ctx) {
  ctx?.logger?.debug?.('[dsh-shinki-sidebar-tools] host half ready (client-only)');
}
