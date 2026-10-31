/* ==================== 自研确认框（替换原生 confirm）====================
 * 原生 confirm 有三大问题：样式无法控制、阻塞主线程、移动端样式丑陋。
 * 这里用 Promise 化实现：await uiConfirm({...}) 返回 true/false。
 * 用法：if (!await uiConfirm({ title, message, danger:true })) return;
 */



/* ==================== 手风琴（details）开合动画 ====================   原生 details 开合是瞬间跳变。这里接管 summary 的点击：把 summary 之外的
   内容包进 .acc-body（只包一次），用 height + opacity 过渡实现展开/收起，
   动画结束后交还给原生 open 状态（键盘/无障碍行为不变）。 */
(function () {
  function accWrap(d) {
    let w = d.querySelector(":scope > .acc-body");
    if (!w) {
      w = document.createElement("div");
      w.className = "acc-body";
      [...d.children].forEach(c => { if (c.tagName !== "SUMMARY") w.appendChild(c); });
      d.appendChild(w);
    }
    return w;
  }
  document.addEventListener("click", (e) => {
    const sum = e.target.closest && e.target.closest("summary");
    if (!sum) return;
    const d = sum.closest("details");
    if (!d || d.hasAttribute("data-no-anim")) return;
    e.preventDefault();
    if (d.classList.contains("animating")) return;
    const wrap = accWrap(d);
    d.classList.add("animating");
    const D = 230;
    if (d.open) {
      const h = wrap.scrollHeight;
      wrap.style.height = h + "px";
      void wrap.offsetWidth;
      wrap.style.height = "0px";
      wrap.style.opacity = "0";
      setTimeout(() => {
        d.open = false;
        wrap.style.height = ""; wrap.style.opacity = "";
        d.classList.remove("animating");
      }, D);
    } else {
      d.open = true;
      const h = wrap.scrollHeight;
      wrap.style.height = "0px"; wrap.style.opacity = "0";
      void wrap.offsetWidth;
      wrap.style.height = h + "px";
      wrap.style.opacity = "1";
      setTimeout(() => {
        wrap.style.height = ""; wrap.style.opacity = "";
        d.classList.remove("animating");
      }, D);
    }
  }, true);
})();

// 点击空白处收起所有下拉（带上收动画）
document.addEventListener("click", () => {
  document.querySelectorAll(".ui-select.open").forEach(x => uiSelectClose(x));
});


/* ==================== 图表 tooltip ==================== */
function _ensureTip() {
  let t = $("#chartTip");
  if (!t) {
    t = document.createElement("div");
    t.id = "chartTip";
    t.role = 'tooltip';
    t.addEventListener('pointerenter', () => clearTimeout(_chartTipTimer));
    t.addEventListener('pointerleave', hideTip);
    document.body.appendChild(t);
  }
  return t;
}
let _chartTipTimer = null;
function showTip(ev, html) {
  clearTimeout(_chartTipTimer);
  const t = _ensureTip();
  t.innerHTML = html;
  t.style.display = "block";
  const r = t.getBoundingClientRect();
  t.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, ev.clientX - r.width / 2)) + 'px';
  t.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, ev.clientY > r.height + 16 ? ev.clientY - r.height - 12 : ev.clientY + 12)) + 'px';
}
function dismissChartTip() {
  clearTimeout(_chartTipTimer);
  const t = $("#chartTip");
  if (t) t.style.display = "none";
}
function hideTip() {
  clearTimeout(_chartTipTimer);
  _chartTipTimer = setTimeout(() => {
    const t = $('#chartTip'), selection = getSelection();
    if (t?.matches(':hover') || selection && !selection.isCollapsed && t?.contains(selection.anchorNode)) return;
    dismissChartTip();
  }, 300);
}
document.addEventListener('click', e => {
  if (!e.target.closest('#chartTip, .chart-hit')) dismissChartTip();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') dismissChartTip(); });
document.addEventListener('scroll', e => { if (!$('#chartTip')?.contains(e.target)) dismissChartTip(); }, true);
window.addEventListener('resize', dismissChartTip);

// 启动时的会话恢复：**cookie 优先**。
//
// 这里修的是「刷新页面会闪一下登录卡片」——哪怕这次刷新本来就已经登录着。
// 根因是原来的门禁只看 `localStorage` 里的 token：token 过期（默认 24h）但
// 服务端的 HttpOnly 会话 Cookie 仍然有效时，代码会先 `logout()` 把 token 删掉，
// 于是整页刷新后先渲染出登录表单，再被 `/api/login/session` 救回来。
//
// 现在的顺序：
//   1. 先请求 `/api/accounts`：带 token 走，没有 token 就靠 Cookie 走（同源于
//      这个页面，Cookie 一定带上）。
//   2. 成功 → 直接进应用，登录卡片在整个过程中都不会显示。
//   3. 401/403 → 说明**两边都**没凭据，才去清 token 并留在登录页。
//   4. 其它状态 / 网络异常 → 先进应用由各面板自行提示（与原来一致）。
//
// 本地壳（桌面 / 安卓 WebView）本来就走桥接换非过期凭据，不进入这段逻辑：
// 它们的登录卡片由 desktop.css 隐藏，`localBoot` 负责显示连接状态。
const _localConsoleShell = Boolean(window.pywebview?.api || window.WBAndroid?.sessionToken
  || new URLSearchParams(location.search).has("desktop"));
// 请求立刻发出，但结果要等 DOMContentLoaded 再处理：enterApp → activateTab
// 会调用 `window.WBIP?.load()` / `window.WBReview?.loadUpdate()` 等，这些对象由
// 本文件之后的同步脚本定义。响应先于它们执行完时，`?.` 会静默跳过首屏加载
// （表现为 IP 管理 / 更新与备份 刷新后只渲染一半）。
const _consoleScriptsReady = document.readyState === "loading"
  ? new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }))
  : Promise.resolve();
if (!_localConsoleShell) {
  const _booted = () => !document.getElementById("app").classList.contains("hidden");
  api("/api/accounts").then(async r => {
    await _consoleScriptsReady;
    if (r.ok) { if (!_booted()) enterApp(); return; }
    if (r.status === 401 || r.status === 403) {
      // token 和 Cookie **都**失效才会走到这里（`require_admin` 两个都认）。
      // 删掉本地 token 让页面回到干净状态，再刷新由服务端下发登录壳页。
      if (TOKEN) logout();
      else showLoginCard();
      return;
    }
    // 其它状态：先进应用，由各面板自己提示错误
    if (!_booted()) enterApp();
    toast("部分数据加载失败（HTTP " + r.status + "），可稍后重试", "err");
  }).catch(async e => {
    await _consoleScriptsReady;
    // 网络异常也不清 token，允许用户手动重试
    if (!_booted()) enterApp();
    toast("网络异常：" + (e && e.message ? e.message : e), "err");
  });
} else { /* 显示登录 */ }
