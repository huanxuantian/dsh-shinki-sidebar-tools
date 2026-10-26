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
  // 没有 requestId 时**不能用时间戳**：同一条审批被重复派发会变成多条不同 id 的浮层。
  // 用「会话 + 工具 + 理由」做稳定指纹，重复事件自然去重。
  const fallbackId = `${sessionId}|${toolName}|${reason}`;
  return {
    id: requestId || fallbackId,
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
  const seenOrder = [];   // 与 seen 同步；超过 200 条丢最旧（防止无界增长，也避免旧 id 被重新收录）
  const rememberSeen = (key) => {
    seen.add(key);
    seenOrder.push(key);
    if (seenOrder.length > 200) {
      const old = seenOrder.shift();
      if (old) seen.delete(old);
    }
  };

  const off = (() => {
    try {
      return ctx.on('session/event', (session, event) => {
        try {
          if (!event || event.type !== 'approval/asked') return;
          const item = project(event, session);
          const key = item.id;
          if (seen.has(key)) return;
          rememberSeen(key);
          seq += 1;
          items.push({ ...item, seq, display: seq });
          while (items.length > capacity) {
            items.shift();   // 移出环形缓冲时**不做 seen.delete**：否则同一请求重发会再次入列
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

  function pushSynthetic(over = {}) {
    seq += 1;
    const item = {
      id: 'test-' + seq + '-' + Date.now(),
      sessionId: String(over.sessionId || 'test-session'),
      toolName: String(over.toolName || 'pwsh'),
      reason: String(over.reason || '这是一条测试提醒（来自设置页）'),
      at: Date.now(), resolved: false, seq, display: seq,
    };
    items.push(item);
    while (items.length > capacity) items.shift();
    return item;
  }

  return {
    pushSynthetic,
    /** 最近 items（新→旧按插入顺序，前端自行倒序）。 */
    list() { return items.slice(); },
    dispose() { try { off && off(); } catch { /* 忽略 */ } },
  };
}

/* ── 浮层配置持久化（M4）：<plugin-data>/sidebar-tools/toast.json ────────── */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TOAST_DEFAULTS = Object.freeze({ enabled: false, maxVisible: 3, dwellMs: 8000 });

function toastFile() {
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || os.homedir() || '.', '.dsh');
  const dir = path.join(home, 'plugin-data', 'dsh-shinki-sidebar-tools');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 忽略 */ }
  return path.join(dir, 'toast.json');
}

export function readToastConfig() {
  try {
    const raw = fs.readFileSync(toastFile(), 'utf8');
    const j = raw ? JSON.parse(raw) : {};
    return {
      enabled: j.enabled === true,
      maxVisible: Math.max(1, Math.min(10, Math.round(Number(j.maxVisible) || TOAST_DEFAULTS.maxVisible))),
      dwellMs: Math.max(3000, Math.min(60000, Math.round(Number(j.dwellMs) || TOAST_DEFAULTS.dwellMs))),
    };
  } catch { return { ...TOAST_DEFAULTS }; }
}

export function writeToastConfig(patch = {}) {
  const cur = readToastConfig();
  const next = {
    enabled: patch.enabled === undefined ? cur.enabled : patch.enabled === true,
    maxVisible: patch.maxVisible === undefined ? cur.maxVisible : Math.max(1, Math.min(10, Math.round(Number(patch.maxVisible) || cur.maxVisible))),
    dwellMs: patch.dwellMs === undefined ? cur.dwellMs : Math.max(3000, Math.min(60000, Math.round(Number(patch.dwellMs) || cur.dwellMs))),
  };
  try { fs.writeFileSync(toastFile(), JSON.stringify(next, null, 2) + '\n'); } catch { /* 忽略 */ }
  return next;
}