/* ==========================================================================
   导航分组：8 个一级入口 + 页内子标签
   --------------------------------------------------------------------------
   叶子面板（TABS / #panel-<tab> / ?tab=<tab>）保持不变，这里只在其上加一层
   「分组」：侧栏显示分组，顶栏下方的子标签条显示组内面板。所以旧的深链、
   代码里所有 `activateTab("logs")` 之类的调用都不用改。

   分组按「用户要做什么」划分，而不是按数据来源：
     调用 = 看统计 + 查明细；风控 = 实时拦截 + IP + 通知 ……
   ========================================================================== */
const NAV = [
  { id: "overview", label: "概览",   tabs: ["overview"] },
  { id: "platform", label: "平台",   tabs: ["platforms", "gateway"] },
  { id: "account",  label: "账号",   tabs: ["accounts", "credits", "journal", "growth"] },
  { id: "traffic",  label: "调用",   tabs: ["usage", "logs"] },
  { id: "risk",     label: "风控",   tabs: ["sentinel", "ip", "alerts"] },
  { id: "access",   label: "接入",   tabs: ["keys", "groups", "models"] },
  { id: "agent",    label: "智能体", tabs: ["agent"] },
  { id: "system",   label: "系统",   tabs: ["settings", "client", "schedules", "sync", "maintenance"] },
];

const TAB_LABELS = {
  overview: "概览",
  platforms: "平台管理", gateway: "调度策略",
  accounts: "账号池", credits: "积分到期", journal: "积分流水", growth: "成长计划",
  usage: "统计", logs: "明细日志",
  sentinel: "实时哨兵", ip: "IP 管理", alerts: "预警通知",
  keys: "API Keys", groups: "分组", models: "模型",
  agent: "智能体",
  settings: "常规设置", client: "客户端参数", schedules: "定时任务", sync: "同步", maintenance: "更新与备份",
};

/* 按「当前平台」过滤数据的面板：顶栏只在这些面板上显示平台切换器。
 * 调用 / 风控 / Keys 是跨平台视图，各自有页内「平台」筛选，再放一个全局
 * 切换器会让人分不清哪个生效。定时任务列出全部平台的任务（loadSchedules），
 * 不受切换器影响，所以也不显示。 */
const PLATFORM_SCOPED_TABS = new Set(["overview", "platforms", "accounts", "credits", "models"]);

/* 子标签角标：值是侧栏角标的选择器，setSideDot 更新侧栏时顺带同步这里。 */
const TAB_DOTS = { sentinel: "#sideSentinelDot", credits: "#sideExpiringDot" };

const _NAV_LAST_KEY = "wb_nav_last";

function navGroupOf(tab) {
  return NAV.find(g => g.tabs.includes(tab)) || NAV[0];
}

function _navLast() {
  try { return JSON.parse(sessionStorage.getItem(_NAV_LAST_KEY) || "{}") || {}; } catch (e) { return {}; }
}

/** 点侧栏分组：回到这个组上次停留的子页（本会话内），没有就进第一个。 */
function navGo(groupId) {
  const group = NAV.find(g => g.id === groupId);
  if (!group) return;
  const last = _navLast()[groupId];
  activateTab(group.tabs.includes(last) ? last : group.tabs[0]);
}

/** activateTab 调用：同步侧栏高亮、子标签条、顶栏标题与平台切换器。 */
function renderNavChrome(tab) {
  const group = navGroupOf(tab);
  try {
    const last = _navLast();
    last[group.id] = tab;
    sessionStorage.setItem(_NAV_LAST_KEY, JSON.stringify(last));
  } catch (e) { /* 隐私模式下 sessionStorage 可能不可写，忽略 */ }

  document.querySelectorAll(".side-item[data-nav]").forEach(x => {
    const on = x.dataset.nav === group.id;
    x.classList.toggle("active", on);
    if (on) x.setAttribute("aria-current", "page"); else x.removeAttribute("aria-current");
  });

  const bar = $("#subTabs");
  if (bar) {
    const multi = group.tabs.length > 1;
    bar.hidden = !multi;
    bar.innerHTML = multi ? group.tabs.map(t => {
      const dotSel = TAB_DOTS[t];
      const dot = dotSel ? $(dotSel) : null;
      const dotHtml = dotSel
        ? `<span class="sub-tab-dot${dot && !dot.classList.contains("hidden") ? "" : " hidden"}" data-dot-of="${dotSel}">${dot ? esc(dot.textContent) : ""}</span>`
        : "";
      return `<button type="button" class="sub-tab${t === tab ? " active" : ""}" role="tab" aria-selected="${t === tab}" data-tab="${t}">${esc(TAB_LABELS[t] || t)}${dotHtml}</button>`;
    }).join("") : "";
  }

  const title = $("#topbarTitle");
  if (title) title.textContent = group.label;
  const cur = $("#sideCurrent");
  if (cur) cur.textContent = group.label;   // 窄屏汉堡栏：组内页面由子标签条显示

  const picker = $("#topbarPlatform");
  if (picker) picker.hidden = !PLATFORM_SCOPED_TABS.has(tab);
  renderTopbarPlatform();
}

/* ---------- 顶栏平台切换器 ---------- */
function renderTopbarPlatform() {
  const host = $("#topbarPlatform");
  if (!host || host.hidden) return;
  const P = window.WBPlatform;
  const items = P && P.items ? P.items() : [];
  if (!items.length) { host.innerHTML = ""; return; }
  const cur = P.current().platform;
  host.innerHTML = uiSelectHTML("topbarPlatformSel", {
    options: items.map(item => ({ value: item.id, label: item.label })),
    value: cur,
    class: "topbar-platform-btn",
    onChange: value => P.select(value),
  });
  const btn = host.querySelector(".ui-select-btn");
  if (btn) {
    btn.setAttribute("data-tooltip", "当前平台：账号、积分、模型、定时任务按它统计");
    if (window.WBPlatformIcons) btn.insertAdjacentHTML("afterbegin", `<span class="topbar-platform-logo">${window.WBPlatformIcons.get(cur) || ""}</span>`);
  }
}

document.addEventListener("wb-platform-change", renderTopbarPlatform);

document.addEventListener("click", e => {
  const tab = e.target.closest("#subTabs [data-tab]");
  if (tab) activateTab(tab.dataset.tab);
});

/* 窄屏：顶栏操作并入汉堡栏（与安卓 mobile.js 的做法一致），顶栏整体隐藏，
 * 省掉一整行只放两个图标按钮的空栏。 */
const _compactNav = window.matchMedia("(max-width:900px)");
function _arrangeTopbar() {
  const actions = document.querySelector(".topbar-actions");
  const header = document.querySelector(".desktop-topbar");
  const side = $("#appSide");
  if (!actions || !header || !side) return;
  (_compactNav.matches ? side : header).appendChild(actions);
}
_compactNav.addEventListener("change", _arrangeTopbar);
_arrangeTopbar();

/* 子标签条吸附在顶栏下方。sticky 的参照是滚动容器 .app-main（console.css），
 * 顶栏就在它里面，所以偏移 = 顶栏实测高度（浏览器 90px / 桌面壳 64px）；
 * 窄屏顶栏隐藏，高度为 0，汉堡栏在 .app-main 之外，不参与计算。 */
(() => {
  const header = document.querySelector(".desktop-topbar");
  if (!header || !window.ResizeObserver) return;
  const apply = () => document.documentElement.style.setProperty("--topbar-h", header.offsetHeight + "px");
  new ResizeObserver(apply).observe(header);
  apply();
})();
