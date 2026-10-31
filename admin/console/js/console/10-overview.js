/* ==========================================================================
   平台管理面板：当前平台的概览
   --------------------------------------------------------------------------
   切到某个平台后，第一眼就能看到「这个平台有几个号、多少额度、用在哪些模型上」，
   不必再跑去账号池确认。数据来自该平台自己的接口（trae 走 /api/trae/overview，
   其它平台走通用的 /api/accounts + /api/stats/usage）。
   ========================================================================== */
/* ==========================================================================
   总览面板（布局参照 keybuddy.html 的概览页）
   --------------------------------------------------------------------------
   信息密度是这里的关键：用户打开首页想看的是「还剩多少钱、今天用了多少、
   哪个号出问题」，而不是几个要点进去才看到数字的小卡片。

   一张 /api/overview 请求拿到全部聚合（服务端一次算完，避免 5 次串行
   请求 + 5 份口径不一致的统计）。所有数字都在服务端算好，前端只负责排版。

   区间切换（今日 / 7 天 / 30 天）只改 `_ovDays` 再重取，不重新加载整页。

   **默认口径是「今日」**：概览要聚合今天 / 窗口 / 30 天三段 `usage_logs`，
   窗口越长扫的行越多。线上 7 万+ 请求时默认查 7 天要 1.6 秒起步，
   首屏体感就是「卡」。今日窗口只碰当天分区，快得多；想看长的再点切换。
   ========================================================================== */
let _ovDays = 1;

/** 数字千分位；亿/万级自动缩写（与 keybuddy 的 1.00B 风格一致）。 */
function ovNum(value) {
  const n = Number(value) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e4) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("zh-CN");
}

/** 精确千分位（金额/积分这类不能缩写的数字）。 */
function ovInt(value) {
  return (Number(value) || 0).toLocaleString("zh-CN");
}

/**
 * 积分类数值：整数部分千分位 + **固定两位小数**。
 *
 * 为什么固定两位而不是「最多两位」：积分是钱，`189.2` 和 `189.20` 在
 * 对账时表达的意思不同 —— 前者看起来像精度丢失。设计要求保留两位。
 * 同时也避免 `toLocaleString` 默认 3 位小数把 47.4675 渲染成 "47.467"。
 */
function ovCredit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/* ==========================================================================
   数字计数器（count-up 动效）
   --------------------------------------------------------------------------
   为什么需要：概览页的数字是**结论**（还剩多少钱、今天用了多少）。
   直接跳变会让人怀疑「是不是没刷新」；从 0 滚到目标值能明确传达
   「这是刚取回来的新数据」。

   实现要点：
     · 用 `requestAnimationFrame` + easeOutCubic，300ms 左右 —— 再长就是拖沓；
     · 尊重 `prefers-reduced-motion`：开启时直接落到终值（无障碍要求）；
     · 同一元素上重复调用会**取消上一轮动画**，否则快速切换区间会看到
       「两个数字在抢同一个 DOM」的抖动；
     · 终值格式交给调用方传入的 formatter，计数器只管插值 ——
       这样「千分位 / 两位小数 / K-M-B 缩写」三种口径可以共用一个组件。
   ========================================================================== */
const _counterFrames = new WeakMap();

function animateNumber(el, target, opts) {
  if (!el) return;
  const options = opts || {};
  const formatter = options.format || ((n) => Math.round(n).toLocaleString("zh-CN"));
  // 默认 620ms：420ms 在实际使用中太快，用户几乎看不见（实测 300ms 时
  // 采样就已经是终值了）。计数动效的意义是「让用户注意到数字变了」，
  // 所以宁可稍慢一点，也不能快到无感。
  const duration = Math.max(0, Number(options.duration ?? 620));
  const to = Number(target) || 0;

  // 取消同一元素上尚未结束的动画
  const prev = _counterFrames.get(el);
  if (prev) cancelAnimationFrame(prev);

  const reduce = window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || duration === 0) {
    el.textContent = formatter(to);
    el.classList.remove("counting");
    el.dataset.countValue = String(to);
    _counterFrames.delete(el);
    return;
  }

  // 起点：优先用上一次的目标值（连续切换时从当前显示值继续，不跳回 0）
  const from = Number(el.dataset.countValue);
  const start = Number.isFinite(from) ? from : 0;
  el.dataset.countValue = String(to);
  const begin = performance.now();
  // 计数期间给个色偏提示（CSS 里有 .counting），让「正在更新」一眼可见
  el.classList.add("counting");

  const step = (now) => {
    const t = Math.min(1, (now - begin) / duration);
    // easeOutCubic：前段快、末段缓，读数字时不会有「最后几帧还在跳」的焦虑
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatter(start + (to - start) * eased);
    if (t < 1) {
      _counterFrames.set(el, requestAnimationFrame(step));
    } else {
      el.textContent = formatter(to);
      el.classList.remove("counting");
      _counterFrames.delete(el);
    }
  };
  _counterFrames.set(el, requestAnimationFrame(step));
}

/** 便捷封装：按选择器取元素并做计数动画。 */
function countTo(selector, value, formatter, duration) {
  animateNumber(document.querySelector(selector), value,
                { format: formatter, duration });
}

function ovPct(value, digits = 1) {
  if (value === null || value === undefined) return "—";
  return (Number(value) * 100).toFixed(digits) + "%";
}

async function loadOverview(force) {
  // 区间按钮的选中态
  document.querySelectorAll("[data-ov-days]").forEach(btn => {
    btn.classList.toggle("active", Number(btn.dataset.ovDays) === _ovDays);
  });
  // 手动刷新 / 切回面板时**重置计数起点**，让数字从 0 滚到目标值。
  //
  // 为什么必须重置：`animateNumber` 会从 `dataset.countValue`（上次的终值）
  // 接着滚。数据没变时 from == to，视觉上完全静止 —— 用户点了「刷新」
  // 或重新进入面板，会觉得「没反应 / 有缓存」。重置后每次都是 0 -> N，
  // 一眼就能确认「确实是重新取过了」。
  if (force) {
    document.querySelectorAll(
      "#ovBalance, #ovReq, #ovTokIn, #ovTokOut, #ovTokAll, " +
      "#ovCacheHit, #ovCachePrompt, #ovCacheSamples"
    ).forEach(el => { delete el.dataset.countValue; });
  }

  // ---- 加载态 ----
  //
  // 首次进入 / 切换统计区间时要打三个接口（overview + platforms + sentinel）。
  // 线上数据量大时首个请求要几百毫秒到 1 秒，**这段时间原来界面上毫无变化**，
  // 用户看到的是「点了没反应，过几秒数字突然跳出来」，主观上就是「卡」。
  //
  // 这里加一层：立刻显示转圈 + 骨架屏（卡片保持占位、数字位置显示骨架条），
  // 数据回来再替换。即使真的慢，用户也知道「在加载」而不是「坏了」。
  _ovSetLoading(true);
  try {
    const [data, platforms, sentinel] = await Promise.all([
      api(`/api/overview?days=${_ovDays}`).then(r => r.ok ? r.json() : null),
      api("/api/platforms").then(r => r.ok ? r.json() : null).catch(() => null),
      api("/api/sentinel/status?window=300").then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    if (!data) return;
    renderOverview(data, platforms, sentinel);
  } catch (e) {
    const host = $("#ovStatus");
    if (host) host.innerHTML = `<span style="color:var(--danger)">概览加载失败：${esc(e.message)}</span>`;
  } finally {
    _ovSetLoading(false);
  }
}

/** 概览加载态开关：状态条转圈 + 数字位骨架屏。 */
function _ovSetLoading(on) {
  const bar = document.getElementById("ovStatus");
  if (bar) {
    bar.classList.toggle("ov-loading", !!on);
    // 只在还没有真实内容时插入占位文案，避免覆盖已有数据
    if (on && !bar.dataset.filled) {
      bar.innerHTML = `<div class="ov-status-left">
        <span class="ov-loading-dot"></span>
        <span class="ov-muted">正在加载概览…</span>
      </div>`;
    }
    if (!on) bar.dataset.filled = "1";
  }
  // 数字位骨架：给每个大数字套一个 shimmer 占位
  const ids = ["#ovBalance", "#ovReq", "#ovTokIn", "#ovTokOut", "#ovTokAll",
               "#ovCacheHit"];
  ids.forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.classList.toggle("ov-skeleton", !!on);
  });
  // 账号监测 / 平台卡也标一下，避免半截数据看起来像最终结果
  document.querySelectorAll(".ov-card").forEach(card => {
    card.classList.toggle("ov-dim", !!on);
  });
}

function renderOverview(data, platforms, sentinel) {
  const acc = data.accounts || {};
  const today = data.today || {};
  const win = data.window || {};
  const cache = data.cache || {};
  const monitor = data.monitor || {};

  // ---- 运行状态条（API 地址只在顶栏「复制 API 地址」常驻，这里不再重复） ----
  const platformLabel = data.platform_label || "全部平台";
  $("#ovStatus").innerHTML = `
    <div class="ov-status-left">
      <span class="ov-badge-ok"><span class="ov-dot-pulse"></span> 服务运行中</span>
      <span class="ov-muted">当前统计：${esc(platformLabel)}</span>
      <span class="ov-muted">${esc((platforms && platforms.items || []).length)} 个平台</span>
    </div>
    <div class="ov-status-right">
      <span class="ov-muted">更新于 ${fmtTime(new Date().toISOString().slice(0,19), false)}</span>
    </div>`;

  // ---- 告警横幅：有封控信号才出现 ----
  const alertHost = $("#ovAlert");
  const affected = (sentinel && sentinel.accounts_affected) || 0;
  if (alertHost) {
    if (affected > 0) {
      alertHost.hidden = false;
      alertHost.className = "ov-alert danger";
      alertHost.innerHTML = `
        <div class="ov-alert-left">
          <strong>${affected} 个账号被上游拒绝过 (403 / 11140 / 4015)</strong>
          <span class="ov-muted">最近 5 分钟${sentinel.tripped ? " · 已达批次封控阈值" : ""}</span>
        </div>
        <button type="button" class="ov-link" onclick="activateTab('sentinel')">浏览详情 →</button>`;
    } else if (sentinel && Object.keys(sentinel.pause || {}).length) {
      alertHost.hidden = false;
      alertHost.className = "ov-alert warn";
      alertHost.innerHTML = `
        <div class="ov-alert-left">
          <strong>有平台处于暂停状态</strong>
          <span class="ov-muted">暂停期间请求会直接返回 503，不打上游</span>
        </div>
        <button type="button" class="ov-link" onclick="activateTab('sentinel')">查看 →</button>`;
    } else {
      alertHost.hidden = true;
      alertHost.innerHTML = "";
    }
  }

  // ---- 剩余额度 ----
  $("#ovModelBadge").textContent = `${data.models || 0} 个模型`;
  // 主数字用计数器动效：明确表达「这是刚取回来的新数据」
  countTo("#ovBalance", acc.balance_remain, (n) => ovInt(Math.round(n)));
  $("#ovBalanceRow").innerHTML = `
    <div>今日消耗 <span>${ovCredit(today.credits)}</span></div>
    <div>${win.days || 1} 天消耗 <span>${ovCredit(win.credits)}</span></div>
    <div>户均 <span>${data.average_credits == null ? "—" : ovCredit(data.average_credits)}</span></div>`;
  $("#ovBalanceNote").textContent = acc.disabled_balance
    ? `另有 ${ovInt(acc.disabled_balance)} 在已禁用账号上，不参与统计`
    : `总额度 ${ovInt(acc.balance_total)} · 启用 ${acc.total} 个账号`;
  const ratio = acc.used_ratio;
  const bar = $("#ovBalanceBar");
  if (ratio == null) {
    bar.style.width = "100%";
    bar.style.background = "var(--fg-subtle)";
  } else {
    bar.style.width = Math.min(100, Math.max(0, ratio * 100)) + "%";
    // 用得多 = 危险色；正常进度用品牌色
    bar.style.background = ratio > 0.9 ? "var(--danger)"
      : ratio > 0.7 ? "var(--warn,#f59e0b)" : "var(--brand)";
  }

  // ---- 用量（四个数字都做计数动效）----
  countTo("#ovReq", win.requests, ovNum);
  countTo("#ovTokIn", win.prompt_tokens, ovNum);
  countTo("#ovTokOut", win.completion_tokens, ovNum);
  countTo("#ovTokAll", win.total_tokens, ovNum);
  $("#ovUsageFoot").innerHTML = `
    <div>API Key <span class="ov-dot-sep">•</span> 模型: <b>${data.models || 0}</b></div>
    <div>统计范围: ${_ovDays === 1 ? "今日" : _ovDays + " 天"}${
      win.ok_requests !== undefined && win.requests
        ? ` · 成功率 ${ovPct(win.ok_requests / win.requests, 1)}` : ""}</div>`;

  // ---- 缓存命中率（conic-gradient 环形图）----
  const rate = cache.rate;
  const donut = $("#ovDonut");
  const pctVal = rate == null ? 0 : Math.min(100, Math.max(0, rate * 100));
  donut.style.background =
    `conic-gradient(var(--brand) ${pctVal}%, var(--surface-2) 0)`;
  // 环形图中心数字：它要带 `<span class="ov-donut-unit">%</span>`，
  // 而计数器组件按 textContent 写值 —— 两者不兼容。
  // 这里保留原写法（直接 innerHTML），百分比变化本身不需要滚动动效：
  // 圆环的 conic-gradient 已经有过渡动画，数字再滚会显得吵。
  const donutEl = $("#ovDonutVal");
  donutEl.innerHTML = rate == null ? "—"
    : `${pctVal.toFixed(0)}<span class="ov-donut-unit">%</span>`;
  countTo("#ovCacheHit", cache.cached_tokens, ovNum);
  $("#ovCacheRate").textContent = rate == null ? "—" : ovPct(rate);
  countTo("#ovCachePrompt", cache.prompt_tokens, ovNum);
  countTo("#ovCacheSamples", cache.samples, ovNum);
  $("#ovCacheNote").textContent = cache.note
    || (rate == null ? "当前区间没有可统计的输入 token" : "只统计含缓存字段的上游响应");

  // ---- 账号监测：状态条 + 异常账号列表 ----
  const buckets = [
    ["active", "活跃", "ok"],
    ["cooling", "冷却", "warn"],
    ["breaker", "熔断", "warn"],
    ["no_balance", "额度耗尽", "muted"],
    ["disabled", "已禁用", "danger"],
  ];
  const total = monitor.total || 0;
  $("#ovMonitorBars").innerHTML = buckets.map(([key, label, tone]) => {
    const n = monitor[key] || 0;
    const pct = total ? (n / total) * 100 : 0;
    return `<div class="ov-bar-row">
      <span class="ov-bar-label">${label}</span>
      <div class="ov-bar-track"><div class="ov-bar-fill ${tone}" style="width:${pct}%"></div></div>
      <span class="ov-bar-num" data-count="${n}">${n}</span>
    </div>`;
  }).join("");
  // 状态条上的数字也做计数动效（数量小，用短时长，避免看着像卡顿）
  document.querySelectorAll("#ovMonitorBars .ov-bar-num").forEach(node => {
    animateNumber(node, Number(node.dataset.count) || 0, { duration: 260 });
  });

  const items = (monitor.items || []).filter(item => item.state !== "active").slice(0, 6);
  $("#ovMonitorList").innerHTML = items.length
    ? items.map(item => {
        // 冷却剩余时间：把秒换成「x 分钟后自动重试」，用户最关心的是
        // 「这个号什么时候能自己回来」，而不是一个 ISO 时间戳。
        const mins = Math.max(0, Math.round((item.cool_remaining || 0) / 60));
        const remainText = mins > 0 ? `${mins} 分钟后自动重试` : "";
        // 哨兵记到的真实业务码（11140 / 403 …）优先级高于本地错误文本
        const why = item.signal_code
          ? `${item.signal_code}${item.signal_count > 1 ? " ×" + item.signal_count : ""}`
          : (item.last_error || "");
        return `<div class="ov-account-item">
        <span class="ov-dot ${item.state === "disabled" ? "danger"
          : item.state === "active" ? "ok" : "warn"}"></span>
        <span class="ov-account-name" data-tooltip="${esc(item.name)}">${esc(item.name || ("#" + item.id))}</span>
        <span class="ov-account-state">${esc(item.label)}</span>
        <span class="ov-account-err" data-tooltip="${esc(item.signal_label || item.last_error ||"")}">${
          esc(why.slice(0, 34))}${remainText ? ` · ${esc(remainText)}` : ""}</span>
      </div>`;
      }).join("")
    : `<div class="ov-all-ok"><span class="ov-dot ok"></span> 所有账号状态正常</div>`;

  // ---- 平台矩阵 ----
  const items2 = (platforms && platforms.items) || [];
  const curPid = window.WBPlatform ? window.WBPlatform.current().platform : "";
  $("#ovPlatforms").innerHTML = items2.map(item => {
    const realms = item.realm_counts || {};
    const realmText = Object.keys(realms).length
      ? Object.entries(realms)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k === "cn" ? "国内" : k === "intl" ? "国际" : k} ${v}`)
          .join(" · ")
      : "—";
    const active = item.id === curPid;
    return `<button type="button" class="ov-platform-row${active ? " active" : ""}"
        data-ov-platform="${esc(item.id)}"
        data-tooltip="${esc(item.label)}"
        data-tooltip-description="点击切换到这个平台，概览与账号池全部跟随">
      <span class="ov-platform-logo">${window.WBPlatformIcons ? WBPlatformIcons.get(item.icon || item.id) : ""}</span>
      <span class="ov-platform-body">
        <span class="ov-platform-name">${esc(item.label)}</span>
        <span class="ov-platform-sub">${esc(realmText)}</span>
      </span>
      <span class="ov-platform-count">${item.account_count || 0}</span>
    </button>`;
  }).join("") || '<p class="ov-note">还没有接入平台</p>';
  // 点击平台行 = **原地切换概览**，不跳转到平台管理页。
  //
  // 要求：「概览底部的平台状态点击能切换其它平台的概览查看」。
  // 所以切完平台后重新拉一次概览（`loadOverview(true)`），
  // 而不是 `activateTab("platforms")` —— 那会离开当前页面。
  $("#ovPlatforms").querySelectorAll("[data-ov-platform]").forEach(node => {
    node.addEventListener("click", async () => {
      const target = node.dataset.ovPlatform;
      if (!target || !window.WBPlatform) return;
      if (target === window.WBPlatform.current().platform) return;
      window.WBPlatform.select(target);
      await loadOverview(true);   // 平台切换是全局上下文变更，必须重取
      const label = (window.WBPlatform.spec() || {}).label || target;
      if (typeof toast === "function") toast(`已切换到 ${label}`);
    });
  });

  // 侧栏角标：0 时整体隐藏（不占位）
  setSideDot("#sideSentinelDot", affected);
}

/**
 * 侧栏角标统一更新。
 *
 * `n <= 0` 时用 `hidden` 属性彻底隐藏 —— 只加 class 不够，
 * 因为 `.side-dot` 自带 `display:inline-flex`，仅设文字为 "0"
 * 会留下一个空的橙色圆点，反而更让人困惑。
 */
function setSideDot(selector, n) {
  const dot = document.querySelector(selector);
  if (!dot) return;
  const value = Number(n) || 0;
  if (value > 0) {
    dot.hidden = false;
    dot.classList.remove("hidden");
    dot.textContent = value > 99 ? "99+" : value;
  } else {
    dot.hidden = true;
    dot.classList.add("hidden");
    dot.textContent = "0";
  }
  // 同一个数也显示在对应子标签上（见 05-nav.js 的 TAB_DOTS）
  document.querySelectorAll(`[data-dot-of="${selector}"]`).forEach(mirror => {
    mirror.classList.toggle("hidden", value <= 0);
    mirror.textContent = dot.textContent;
  });
}

/* 区间切换：只改状态再重取，不重载页面 */
document.addEventListener("click", event => {
  const btn = event.target.closest("[data-ov-days]");
  if (!btn) return;
  const next = Number(btn.dataset.ovDays) || 1;
  if (next === _ovDays) return;
  _ovDays = next;
  loadOverview(true);
});

