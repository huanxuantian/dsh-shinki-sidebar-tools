# 参考实现研究：better-sidebar 的下方面板（原文摘录）

> 用途：重新设计我们自己的下方面板时逐条对照，不靠猜。

## 1) CSS（bottomPanel / hidden / resize）
```css
.nArs4W_bottomPanel{z-index:40;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l2);pointer-events:auto;padding-bottom:env(safe-area-inset-bottom);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out), height var(--ds-transition-duration-slow) var(--ds-ease-in-out);flex-direction:column;display:flex;position:absolute;bottom:0}
.nArs4W_bottomPanelHidden{pointer-events:none;visibility:hidden;transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out), height var(--ds-transition-duration-slow) var(--ds-ease-in-out), visibility 0s linear var(--ds-transition-duration-slow);transform:translateY(102%)}
.nArs4W_bottomPanel{contain:layout style}
.nArs4W_bottomPanel{will-change:transform}
.nArs4W_bottomResize{cursor:row-resize;z-index:2;touch-action:none;height:8px;position:absolute;top:-4px;left:0;right:0}
.nArs4W_bottomResizeActive{background:var(--dsw-alias-interactive-bg-hover-accent)}
.nArs4W_splitCol{flex-direction:column}
```

## 2) push 高度算法 bottomPushHeight
```js
function bottomPushHeight(input) {（未提取到）
}
```

## 3) 中间列测量 useCenterColumn（关键：逐帧测量 + 直接写 DOM）
```js
function useCenterColumn(bottomRef, bottomOpen) {
  	const centerRectRef = (0, react.useRef)({
  		left: 0,
  		right: 0
  	});
  	const [centerMeasured, setCenterMeasured] = (0, react.useState)(false);
  	const centerColRef = (0, react.useRef)(null);
  	const draggingRef = (0, react.useRef)(false);
  	const measureCenter = (0, react.useCallback)(() => {
  		if (draggingRef.current) return;
  		const col = centerColRef.current;
  		if (col === null) return;
  		if (!col.isConnected) {
  			centerColRef.current = null;
  			return;
  		}
  		const rect = col.getBoundingClientRect();
  		centerRectRef.current = {
  			left: rect.left,
  			right: rect.right
  		};
  		const bottom = bottomRef.current;
  		if (bottom !== null) {
  			bottom.style.setProperty("left", `${rect.left}px`);
  			bottom.style.setProperty("right", `${window.innerWidth - rect.right}px`);
  		}
  		setCenterMeasured((prev) => prev ? prev : true);
  	}, [bottomRef]);
  	(0, react.useEffect)(() => {
  		let disposed = false;
  		let observer;
  		const locate = () => {
  			if (disposed) return;
  			const col = resolveCenterColumn(centerColRef.current);
  			if (col === void 0 || !col.isConnected) {
  				if (centerColRef.current !== null) {
  					centerColRef.current.removeAttribute("data-dsh-center-col");
  					centerColRef.current = null;
  					observer?.disconnect();
  					observer = void 0;
  				}
  				return;
  			}
  			if (centerColRef.current !== col) {
  				centerColRef.current?.removeAttr
```

## 4) 宿主与面板结构（data-dsh-panel-host / data-dsh-bottom-panel）
```js
nChat(ctx, sessionId, cwd, path, isDir);
  	}, [
  		ctx,
  		sessionId,
  		cwd
  	]);
  	if (state === void 0 || sessionId === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
  		"data-dsh-panel-host": true,
  		...osFileDragShield
  	});
  	const bottomPanelHeight = bottomPushHeight({
  		open: true,
  		height: state.bottomHeight,
  		viewportHeight: layoutViewportHeight
  	});
  	const onNewTab = (optionId) => {
  		const service = ctx.get("betterSidebar");
  		const descriptor = service?.getTab(optionId);
  		if (service === void 0 || descriptor === void 0) return;
  		const title = typeof descriptor.title === "function" ? descriptor.title() : descriptor.title;
  		service.openTab({
  			type: optionId,
  			title,
  			target: "bottom"
  		}, {
  			sessionId,
  			cwd
  		});
  	};
  	/**
  	* The tab icon from the tab-type registry. An editor tab WITH a file path
  	* (the per-path windows of split mode — `meta.dir` marks folder windows,
  	* which keep the folder glyph) shows the same file icon the tree row shows
  	* (`fileIcon`, feature `fileIcons`); ev
```

## 5) 中间列选择器
```js
const CENTER_COLUMN_SELECTOR = "#root [data-slot=\"main.conversation\"], #root [data-slot=\"conversation\"]";
```

## 6) 我们此前的教训（写进设计约束）
- 面板**不能**给会话列加 padding（会挤扁固定高度的 flex 列）
- 面板**不能**只试一次挂载（启动时会话列还没渲染 ⇒ 必须轮询/观察）
- 组件必须**交给 React 渲染**（直接调用组件函数 ⇒ Invalid hook call #321）
- 若作为列的**在流子节点**：flex:none + 明确高度 ⇒ 占位不遮挡、宽度随列（无需 rect 计算）
- **不要**写死 `min-height`（会卡住折叠）

## 7) 让位的**正确机制**（2026-10 实测定位，取代"给滚动容器加 padding"的旧做法）

参考实现（dsh-better-sidebar 0.24.1，同一 app）的地基：
`docs/external-plugin-guide.md:1034` + `src/client/layout.css:30`：

```css
#root [data-dsh-center-col] { margin-bottom: var(--dsh-sidebar-height, 0px); }
```

- 面板高度只写成 `<html>` 上的 CSS 变量；**让位 = 会话列的 `margin-bottom`**（面板打开 = 高度；关闭/收起 = 0）。
- 列的锚点与本节第 5 节同源：从对话槽宿主向上跳过 `display:contents` 的父级，取第一个非 `contents` 祖先
  （better-sidebar 用 JS 给它打 `[data-dsh-center-col]`；本插件用 `bpCol()` 找同一个节点，打自己的 `data-shinki-center-col`）。
- ⚠️ **绝不要给滚动容器（消息列表）加 `padding-bottom`**：滚动容器的底 padding 属于"可滚动内容的一部分"
  ⇒ 会话末尾平白多出一条与面板等高的空白，一滚到底就看得见，往上滚内容还会滚回那块区域（**我们踩过**：用户实测现象就是它）。
- ⚠️ 也不要给会话列加 `padding-bottom`（见第 6 节：会挤扁固定高度的 flex 列）——所以用 `margin-bottom`。
- ⚠️ 不要给该节点打 `data-dsh-center-col`：那是 better-sidebar 定位器的锚点（其 e2e 断言"恰一节点"），本插件一律用 `data-shinki-center-col`。
- 面板本身 `position:fixed; bottom:0`，`left/right` 取列的横向范围 ⇒ 让位腾出来的那条空间正好被面板盖住。

## 8) 面板与宿主尺寸：**不要清空 display，也不要把高度写死**（2026-10 实测教训）

内容"被切一半、下面还有但滚不到"、而宿主自身又**没有溢出**（滚动条不出现）——这是同一类故障的典型症状，
根因都出在"盒子的高度不是按面板实际高度算出来的"：

- ❌ **不要用 `el.style.display = ''` 来"显示"面板**：`''` 不是"设为默认"，而是**删除内联 display**。
  面板的 `display:flex` 来自 `style.cssText`，一旦被清掉，面板回落成 `display:block`，
  宿主那行 `flex:1 1 auto; min-height:0` **全部失效** ⇒ 宿主高度 = 内容高度（实测 494 > 面板 319）
  ⇒ 被面板的 `overflow:hidden` 裁掉；而宿主自身"内容正好等于容器高度"⇒ 浏览器判定**不需要滚动条** ⇒ 内容永远够不着。
  正确写法：显示时写 `style.display = 'flex'`（隐藏才写 `'none'`）。
- ❌ **不要把宿主高度写死**（例如 `calc(var(--dsh-shinki-bottom-height) - 52px)`）：工具栏高度/字体/拖拽条一变就不准，
  而且与"手动拖高"的实际尺寸脱钩。正解是让 flex 按**面板实际高度**自动分配 ⇒ 拖高、字体、工具栏变化全部自动跟随。
- ✅ 宿主 `overflow:auto` + 视图根 `height:auto` ⇒ **滚动与否完全由浏览器按实际内容高度决定**（纯 CSS，不需要 JS 判断）。
  JS 只留一个**滚轮兜底**（QtWebEngine 的原生滚轮/滚动条不可靠，同 §5 的 tab 条做法），它不参与"要不要滚"的判断。
- 调试脚手架（面板栏溢出读数、几何/DOM/槽位诊断、构建号）已在收尾时移除，需要时从 git 历史取回。
