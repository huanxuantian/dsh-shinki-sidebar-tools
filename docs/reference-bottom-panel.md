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
