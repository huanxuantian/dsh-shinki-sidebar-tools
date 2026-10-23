/**
 * 授权请求采集（M1）：订阅会话事件里的 `approval/asked`，维护一个环形缓冲。
 *
 * 设计约束：
 *  - 只读：绝不代替用户批准/拒绝，只把请求暴露给前端浮层；
 *  - 内存态：重启即清空，不落盘（避免历史堆积）；
 *  - 容量：`max + 2` 条，前端按 `maxVisible` 截断，但保留少量余量便于"已处理"标记；
 *  - 事件源不确定时的兜底：`session/event` 拿不到就退化为空列表（浮层不显示，不影响宿主）。
 */

const DEFAULT_MAX = 3;

/** 从事件里抽出浮层需要的字段（对字段缺失保持宽容）。 */
function project(event, session) {
  const data = event && typeof event.data === 'object' && event.data !== null ? event.data : {};
  const sessionId = String(session?.id ?? data.sessionId ?? '');
  const requestId = String(data.id ?? data.requestId ?? '');
  const toolName = String(data.toolName ?? data.tool ?? '');
  const reason = String(data.reason ?? '').replace(/\s+/g, ' ').slice(0, 160);
  return {
    id: requestId || `${sessionId}:${Date.now()}`,
    sessionId,
    toolName,
    reason,
    at: Date.now(),
    resolved: false,
  };
}

/**
 * @param {import('cordis').Context} ctx
 * @param {{ max?: number, logger?: (m: string) => void }} [opts]
 */
export function createApprovalFeed(ctx, { max = DEFAULT_MAX, logger = () => {} } = {}) {
  const capacity = Math.max(1, Math.min(Number(max) || DEFAULT_MAX, 10)) + 2;
  const items = [];
  let seq = 0;

  const seen = new Set();

  const off = (() => {
    try {
      return ctx.on('session/event', (session, event) => {
        try {
          if (!event || event.type !== 'approval/asked') return;
          const item = project(event, session);
          const key = item.id;
          if (seen.has(key)) return;
          seen.add(key);
          seq += 1;
          items.push({ ...item, seq, display: seq });
          while (items.length > capacity) {
            const dropped = items.shift();
            if (dropped) seen.delete(dropped.id);
          }
        } catch (error) {
          logger(`[sidebar-tools] 采集审批事件失败：${error?.message ?? error}`);
        }
      });
    } catch (error) {
      logger(`[sidebar-tools] 订阅 session/event 失败（浮层将不可用）：${error?.message ?? error}`);
      return () => {};
    }
  })();

  return {
    /** 最近 items（新→旧按插入顺序，前端自行倒序）。 */
    list() { return items.slice(); },
    dispose() { try { off && off(); } catch { /* 忽略 */ } },
  };
}
