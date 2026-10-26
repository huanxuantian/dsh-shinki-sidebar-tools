/**
 * 授权浮层采集端自检（不需要 DSH 实例）。
 *
 * 锁死三个曾导致"莫名多个气泡"的行为：
 *   1) 同一 approval/asked 事件重复派发 ⇒ 只入列一次；
 *   2) 事件没有 requestId（旧实现用 Date.now() 当 id）⇒ 必须用稳定指纹去重；
 *   3) 环形缓冲淘汰旧条目时不能把 id 从 seen 里删掉，否则旧请求重发会再次入列。
 *
 * 用法：node tools/verify-approvals.mjs
 */
import { createApprovalFeed } from '../lib/approvals.js';

let failed = 0;
const ok = (cond, name, extra) => {
  if (cond) { console.log('  ✅ ' + name); return; }
  failed += 1;
  console.log('  ❌ ' + name + (extra ? ' → ' + extra : ''));
};

function harness(max = 3) {
  const handlers = new Set();
  const ctx = {
    on(event, cb) {
      if (event === 'session/event') handlers.add(cb);
      return () => handlers.delete(cb);
    },
  };
  const feed = createApprovalFeed(ctx, { max, logger: () => {} });
  const emit = (session, data) => {
    for (const cb of [...handlers]) cb(session, { type: 'approval/asked', data });
  };
  return { feed, emit, handlers };
}

const A = { id: 'session-A' };
const B = { id: 'session-B' };

// 1) 同 id 重复派发
{
  const { feed, emit } = harness();
  const ev = { id: 'req-1', toolName: 'pwsh', reason: '需要写工作区外' };
  emit(A, ev);
  emit(A, ev);
  emit(A, ev);
  const items = feed.list();
  ok(items.length === 1 && items[0].id === 'req-1', '同一 request id 重复派发 ⇒ 只有 1 条', 'count=' + items.length);
}

// 2) 缺 requestId ⇒ 稳定指纹去重（旧实现会得到多条不同 id）
{
  const { feed, emit } = harness();
  const ev = { toolName: 'pwsh', reason: 'escalate sandbox' };
  emit(A, ev);
  emit(A, ev);
  const items = feed.list();
  ok(items.length === 1, '缺 id 的重复事件 ⇒ 只有 1 条（稳定指纹）', 'count=' + items.length);
  ok(items[0].id === 'session-A|pwsh|escalate sandbox', '缺 id 时用「会话|工具|理由」作 id', items[0] && items[0].id);
}

// 3) 不同理由 / 不同会话 / 不同工具 ⇒ 各自独立
{
  const { feed, emit } = harness();
  emit(A, { toolName: 'pwsh', reason: 'r1' });
  emit(A, { toolName: 'pwsh', reason: 'r2' });
  emit(B, { toolName: 'pwsh', reason: 'r1' });
  emit(A, { toolName: 'write', reason: 'r1' });
  ok(feed.list().length === 4, '不同理由/会话/工具 ⇒ 分别入列', 'count=' + feed.list().length);
}

// 4) 环形缓冲淘汰后，旧 id 重发不得再次入列
{
  const { feed, emit } = harness(2);   // capacity = 2 + 2 = 4
  for (let i = 0; i < 8; i += 1) emit(A, { id: 'req-' + i, toolName: 'pwsh', reason: 'r' + i });
  const before = feed.list();
  ok(before.length === 4, '环形缓冲上限 = max + 2', 'count=' + before.length);
  emit(A, { id: 'req-0', toolName: 'pwsh', reason: 'r0' });   // 已被淘汰的旧请求重发
  const after = feed.list();
  ok(after.length === 4 && !after.some((x) => x.id === 'req-0'), '淘汰后旧 id 重发不会重新入列', 'count=' + after.length);
}

// 5) 合成测试条目
{
  const { feed } = harness();
  const item = feed.pushSynthetic({ reason: '测试' });
  ok(item && item.id.startsWith('test-') && feed.list().length === 1, 'pushSynthetic 可用');
}

// 6) dispose 取消订阅
{
  const { feed, emit, handlers } = harness();
  feed.dispose();
  ok(handlers.size === 0, 'dispose 后不再有 session/event 监听');
  emit(A, { id: 'x', toolName: 'pwsh', reason: 'r' });
  ok(feed.list().length === 0, 'dispose 后事件不再入列');
}

console.log(failed ? `\n❌ ${failed} 项失败` : '\n✅ 全部通过');
process.exit(failed ? 1 : 0);
