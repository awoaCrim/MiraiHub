/* ==========================================================================
   平台切换 = 全局上下文切换
   --------------------------------------------------------------------------
   切平台时，**所有**按平台统计的面板都要重新取数，否则看到的仍是
   上一个平台的数字（这是「切换后数字没变」最难排查的一类问题：
   接口没错、数据没错，只是没人重新请求）。

   只有当前可见的面板立刻刷新；其余面板在 activateTab 时会自然重取，
   因为 api() 已经自动带上新的 X-Platform。
   ========================================================================== */
document.addEventListener("wb-platform-change", () => {
  // ⚠️ 不能用 `_tabFromUrl()`：它读 `location.search`，而 `activateTab` 是
  // 用 `history.replaceState` 更新的 —— 切换平台发生在面板渲染**之后**，
  // 此时 URL 可能还是上一次的值（首次进入更是空的）。读 URL 的后果是
  // 「切完平台，当前面板的统计不刷新」，得手动切走再切回来才更新。
  // 因此用面板切换时记录的模块级变量，它永远反映**当前真正显示**的面板。
  const active = _activeTab;
  // 概览必须**每次都重新拉**：它的数字全部带平台作用域，
  // 而它又是默认首页 —— 漏了这条就会出现「切了平台，概览还是上一个平台的数」，
  // 用户会以为有缓存（数据其实一直是各自平台的新数据，只是没重取）。
  if (active === "overview") loadOverview(true);
  if (active === "platforms") { loadPlatformOverview(); loadPlatformBench(); }
  if (active === "accounts") loadAccounts();
  if (active === "usage") loadUsageStats();
  if (active === "logs") openLogsPanel();
  if (active === "credits") loadCreditStats();
  if (active === "keys") { loadKeys(); loadShareInfo(); }
  // 模型面板：切平台时要**重置**过滤到新平台，否则会沿用上一个平台的筛选，
  // 显示成空列表或别的平台的模型。
  if (active === "models") { _modelPlatformFilter = ""; loadModels(); }
  if (active === "schedules") loadSchedules();
});

/* ==========================================================================
   移动端导航抽屉
   --------------------------------------------------------------------------
   桌面是固定侧栏，移动端折叠成汉堡菜单（样式见 <style> 的 @media 段落）。
   这里只管开合状态，**不写死断点/宽度** —— 否则「什么时候该折叠」
   会同时存在 CSS 与 JS 两处判断，迟早不一致。
   ========================================================================== */

/**
 * 取某个面板的**纯文字**名称（用于移动端顶栏）。
 *
 * 为什么不用 `el.textContent`：导航项里可能夹着角标数字
 * （「积分到期」右边有个待处理数），textContent 会把数字一起读进来，
 * 顶栏就显示成「积分到期 3」。这里只取**第一个文本节点**。
 */
function _sideTabLabel(name) {
  const el = document.querySelector(`.side-item[data-tab="${name}"]`);
  if (!el) return name;
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || "").trim();
      if (t) return t;
    }
  }
  return name;
}
function toggleSideMenu(ev) {
  if (ev) ev.stopPropagation();
  const shell = document.querySelector(".app-shell");
  const aside = $("#appSide");
  const btn = $("#sideToggle");
  if (!shell || !aside) return;
  const open = !aside.classList.contains("open");
  aside.classList.toggle("open", open);
  shell.classList.toggle("menu-open", open);
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeSideMenu() {
  const shell = document.querySelector(".app-shell");
  const aside = $("#appSide");
  const btn = $("#sideToggle");
  if (aside) aside.classList.remove("open");
  if (shell) shell.classList.remove("menu-open");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

// 导航项：带 data-tab 的是面板切换（「退出登录」没有 data-tab，走自己的 onclick）。
// 用 data-tab 存在性判断，比维护类名白名单更不容易漏。
document.querySelectorAll(".side-item").forEach(b => {
  b.addEventListener("click", () => {
    if (b.dataset.tab) activateTab(b.dataset.tab);
    closeSideMenu();          // 点任意项后都收起抽屉
  });
});

// 前进/后退（含手改地址栏后回车）时同步面板。replaceState 不产生历史项，
// 所以这只在用户真的跨页面前进/后退时触发。
window.addEventListener("popstate", () => activateTab(_tabFromUrl(), { updateUrl: false }));

// 窄→宽切换时清掉抽屉状态：从手机转到桌面后若还留着 open/menu-open，
// 桌面侧栏会带上移动端的展开态（遮罩也可能残留）。
window.addEventListener("resize", () => {
  if (window.innerWidth > 900) closeSideMenu();
});

// Esc 关闭抽屉（与关闭弹窗同键，行为一致）
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSideMenu();
});

function esc(s){ return (s==null?"":String(s)).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
/* 内联 SVG 图标（lucide 路径，数据见 icons.js，取自官方客户端 bundle）。
 * 用法：ic('trash') / ic('spinner','wb-ic-spin') / ic('rotate','text-indigo-600')
 * 找不到的图标退化成空串而不是抛错 —— 少一个图标远好过整页白屏。 */
function ic(name, cls) {
  const path = (window.WB_ICON_PATHS || {})[name];
  if (!path) return '';
  return `<svg class="wb-ic ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}
/* 模型厂商图标 —— 严格照抄官方 getModelIcon() 的匹配顺序：
 *   1) 精确命中 vendor（含 glm / kimi / hunyuan / deepseek / minimax / claude / openai …）
 *   2) 模式 id 精确命中（fast / balanced / primary / deep）
 *   3) 子串包含匹配（先 gpt→openai 归一化；跳过模式 id，避免 "deep" 抢走一切）
 *   4) 都没有 → default
 * 顺序照抄很重要：第 3 步如果允许模式名参与，"deepseek" 会被 "deep" 抢走。
 *
 * 图标来源分两批：
 *   · icons.js           —— 官方客户端逆向出来的那批（hy3 / hunyuan / glm …）
 *   · model-icons.js     —— 由 scripts/build_model_icons.py 从 @lobehub/icons
 *                           拉取的品牌 mono SVG（gpt / gemini / grok / qwen /
 *                           doubao / kling / stepfun）。两者合并挂在
 *                           window.WB_MODEL_ICONS 上，这里不区分来源。
 */
const _MODEL_MODES = ['fast', 'balanced', 'primary', 'deep'];
// 模型名里的别名 -> 图标 key。上游/Panel 的写法五花八门，先把这类差异抹平，
// 再做子串匹配，否则 `seed_m8`（豆包）、`step-5`（阶跃）这类会一直空着。
const _VENDOR_ALIASES = [
  [/(^|[^a-z])gpt|o1|o3|chatgpt/, 'openai'],
  [/gemini|bard/, 'gemini'],
  [/grok|xai/, 'grok'],
  [/qwen|qwq|tongyi|通义/, 'qwen'],
  [/doubao|seed[_-]?m|volc|bytedance|豆包/, 'doubao'],
  [/kling|可灵/, 'kling'],
  [/step[_-]?\d|stepfun|阶跃/, 'stepfun'],
  [/glm|chatglm|zhipu/, 'glm'],
  [/kimi|moonshot/, 'kimi'],
  [/deepseek/, 'deepseek'],
  [/claude|anthropic/, 'claude'],
  [/minimax|abab|mimo/, 'minimax'],
  [/hunyuan|hy\d|tencent|混元/, 'hunyuan'],
];
function modelIconKey(vendor) {
  const icons = window.WB_MODEL_ICONS || {};
  const v = String(vendor || '').toLowerCase();
  if (v && Object.prototype.hasOwnProperty.call(icons, v)) return v;
  const mode = _MODEL_MODES.find(m => v === m);
  if (mode && icons[mode]) return mode;
  if (v) {
    // 先按别名表归一，命中且图标存在就直接用
    for (const [re, key] of _VENDOR_ALIASES) {
      if (re.test(v) && icons[key]) return key;
    }
    const norm = v.includes('gpt') ? 'openai' : v;
    const hit = Object.keys(icons).find(k => !_MODEL_MODES.includes(k) && norm.includes(k));
    if (hit) return hit;
  }
  return icons.default ? 'default' : null;
}
function modelIcon(vendor, cls) {
  const key = modelIconKey(vendor);
  const entry = key ? (window.WB_MODEL_ICONS || {})[key] : null;
  if (!entry) return '';
  // ⚠️ 不能在这里写死 fill="none"：
  //   · 官方逆向那批图标（icons.js）是**描边**风格，path 自己带 stroke，
  //     需要 svg 上 fill="none"；
  //   · @lobehub/icons 那批是**填充**风格，path **没有 fill 属性**，
  //     继承 svg 的 fill。svg 上写 fill="none" 会让它们整块消失
  //     （表现为「图标位置是空的」——这是实际踩过的坑）。
  // 因此 fill 只在填充类图标上显式给 currentColor，描边类保持 none。
  const filled = entry.fill === 'solid' || (!!window.__WB_SOLID_ICONS
    && window.__WB_SOLID_ICONS[key]);
  const fillAttr = filled ? 'currentColor' : 'none';
  return `<svg class="wb-mic ${cls || ''}" viewBox="${entry.viewBox}" fill="${fillAttr}" aria-hidden="true">${entry.body}</svg>`;
}
function card(t, v, iconName, col) {
  return `<div class="card p-4"><div class="text-slate-400 text-xs">${t}</div>
    <div class="mt-1 flex items-center gap-2">${ic(iconName, col)}<span class="text-2xl font-bold">${v}</span></div></div>`;
}
function badge(st) {
  const m = st === "active" ? ["bg-emerald-100 text-emerald-700","正常"] : ["bg-slate-100 text-slate-500","禁用"];
  return `<span class="badge ${m[0]}">${m[1]}</span>`;
}

