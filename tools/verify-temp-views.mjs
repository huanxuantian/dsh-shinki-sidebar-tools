/**
 * 临时视图 store / 工具契约自检（不需要 DSH 实例）。
 *
 * 覆盖：内容三种形态（text/html/component）、kind 推断与切换、参数三选一、
 * 组件结构校验、长度截断、会话隔离、版本号短路。
 *
 * 用法：node tools/verify-temp-views.mjs
 */
import { createTempViews, FORMS, KINDS } from '../lib/temp-views-store.js';
import { registerTempViewTool } from '../lib/temp-views-tool.js';

let failed = 0;
const ok = (cond, name, extra) => {
  if (cond) { console.log('  ✅ ' + name); return; }
  failed += 1;
  console.log('  ❌ ' + name + (extra ? ' → ' + extra : ''));
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function makeHarness() {
  const store = createTempViews({ now: () => 1_700_000_000_000 });
  const toolRef = { current: null };
  const ctx = { tools: { register: (t) => { toolRef.current = t; return () => {}; } } };
  return { store, toolRef, ctx };
}
const exec = { agent: { id: 'session-A' } };

async function main() {
  console.log('常量：FORMS=' + FORMS.join('/') + '  KINDS=' + KINDS.join('/'));
  ok(FORMS.length === 5 && KINDS.length === 3, 'FORMS / KINDS 数量');

  const { store, toolRef, ctx } = makeHarness();
  await registerTempViewTool(ctx, store);
  ok(!!toolRef.current, '工具注册到 ctx.tools');
  const tool = toolRef.current;
  const run = (args, e = exec) => tool.execute(args, e);

  // ── render 契约：签名是 (args, value)，只写一个参数会回显 args（线上踩过）──
  const rendered = tool.output.render({ action: 'list' }, { ok: true, version: 7, viewsText: '[]' });
  ok(rendered.length === 1 && rendered[0].type === 'text', 'output.render 返回 text 项');
  ok(JSON.parse(rendered[0].text).version === 7, 'output.render 渲染的是 value 而不是 args', rendered[0].text);

  // ── text（默认）──
  let r = await run({ action: 'register', title: '文本', text: 'a\nb' });
  ok(r.ok === true && r.kind === 'text', 'register 默认 kind=text', JSON.stringify(r));

  // ── 几何参数（x/y/width/height 必须能透过工具进入 store）──
  r = await run({ action: 'register', title: '带尺寸', text: 'x', form: 'mini', x: 120, y: 80, width: 420, height: 260 });
  const sized = store.state.views.get(r.id);
  ok(sized.x === 120 && sized.y === 80 && sized.width === 420 && sized.height === 260,
    'x/y/width/height 存入视图（工具参数不丢）', JSON.stringify({ x: sized.x, y: sized.y, w: sized.width, h: sized.height }));
  r = await run({ action: 'update', id: r.id, width: 500, height: 300 });
  ok(store.state.views.get(r.id).width === 500 && store.state.views.get(r.id).height === 300, 'update 可改尺寸');

  // ── html 推断 + 截断 ──
  const big = '<b>x</b>'.repeat(20000);   // 140000 字符 > 64KB
  r = await run({ action: 'register', title: 'html', html: big });
  ok(r.ok === true && r.kind === 'html', 'register 给了 html ⇒ kind=html', JSON.stringify(r));
  const htmlView = store.state.views.get(r.id);
  ok(htmlView.html.length === 64 * 1024, 'html 截断到 64KB', String(htmlView.html.length));

  // ── component（JSON 字符串）──
  r = await run({
    action: 'register', title: '组件',
    component: JSON.stringify({ pluginId: 'dsh-shinki-ble-tool', componentId: 'findmy-scan', props: { seconds: 10 } }),
  });
  ok(r.ok === true && r.kind === 'component', 'register component ⇒ kind=component', JSON.stringify(r));
  const compView = store.state.views.get(r.id);
  ok(eq(compView.component, { pluginId: 'dsh-shinki-ble-tool', componentId: 'findmy-scan', props: { seconds: 10 } }), 'component 结构原样保存');

  // ── 参数互斥 ──
  r = await run({ action: 'register', title: 'x', text: 'a', html: '<i>b</i>' });
  ok(r.ok === false && /三选一/.test(r.error), 'text+html 同时给 ⇒ 拒绝', JSON.stringify(r));

  // ── 组件结构校验 ──
  r = await run({ action: 'register', title: 'bad', component: JSON.stringify({ pluginId: 'p' }) });
  ok(r.ok === false && /componentId/.test(r.error), '缺 componentId ⇒ 拒绝', JSON.stringify(r));
  r = await run({ action: 'register', title: 'bad', component: '{not json' });
  ok(r.ok === false && /JSON/.test(r.error), 'component 非法 JSON ⇒ 拒绝', JSON.stringify(r));
  r = await run({ action: 'register', title: 'bad', component: JSON.stringify({ pluginId: 'p', componentId: 'c', props: [] }) });
  ok(r.ok === false && /props/.test(r.error), 'props 不是对象 ⇒ 拒绝', JSON.stringify(r));

  // ── update：kind 切换（不重传旧内容）──
  r = await run({ action: 'register', title: '切换', text: 'old' });
  const id = r.id;
  r = await run({ action: 'update', id, html: '<p>new</p>' });
  ok(r.ok === true && r.kind === 'html', 'update 给 html ⇒ 切到 html', JSON.stringify(r));
  ok(store.state.views.get(id).text === 'old', 'update 切形态时保留旧 text');
  r = await run({ action: 'update', id, component: { pluginId: 'p', componentId: 'c' } });
  ok(r.ok === true && r.kind === 'component', 'update 可再切到 component', JSON.stringify(r));
  r = await run({ action: 'update', id });
  ok(r.ok === true && store.state.views.get(id).kind === 'component', '仅改标题不影响 kind');

  // ── 会话隔离 ──
  r = await run({ action: 'register', title: 'B 的视图' }, { agent: { id: 'session-B' } });
  const bId = r.id;
  r = await run({ action: 'update', id: bId });
  ok(r.ok === false && /本会话/.test(r.error), '跨会话 update ⇒ 拒绝', JSON.stringify(r));
  r = await run({ action: 'register', title: '抢 id', id: bId });
  ok(r.ok === false && /占用/.test(r.error), '跨会话抢 id ⇒ 拒绝', JSON.stringify(r));

  // ── 快照版本短路 ──
  const s1 = store.snapshot('session-A', undefined);
  ok(Array.isArray(s1.views) && s1.views.length >= 4, 'snapshot 返回本会话视图');
  const s2 = store.snapshot('session-A', s1.version);
  ok(s2.views === null, 'since=当前版本 ⇒ views=null（零成本）');
  const s3 = store.snapshot('session-B');
  ok(Array.isArray(s3.views) && s3.views.length === 1, '其它会话只看到自己的视图');

  // ── list 序列化 ──
  r = await run({ action: 'list' });
  const listed = JSON.parse(r.viewsText);
  ok(Array.isArray(listed) && listed.every((v) => v.sessionId === 'session-A'), 'list 只列本会话');

  console.log(failed ? `\n❌ ${failed} 项失败` : '\n✅ 全部通过');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
