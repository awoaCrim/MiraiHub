/* ==========================================================================
   新版视觉组件（借鉴 workbuddy-switch 的设计系统）
   --------------------------------------------------------------------------
   旧函数 card()/badge() 保留不动：它们被十几处调用，逐个改的风险远大于收益。
   新面板与重点区域统一用下面这几个，视觉上更接近参考项目：
     * 数值等宽对齐（tabular-nums）—— 表格里数字不等宽会显得很廉价
     * 语义色只用三档：橙=7 天内到期、红=已到期、灰=长期有效
     * 卡片只用极淡的 slate 双层阴影，靠边框分隔而不是靠投影
   ========================================================================== */

/** 指标卡：大号等宽数值 + 小号标签，支持 brand/warn/danger 状态色。 */
function statCard(label, value, opts) {
  opts = opts || {};
  const cls = opts.tone ? ` is-${opts.tone}` : "";
  const icon = opts.icon ? ic(opts.icon, opts.iconColor || "") : "";
  const sub = opts.sub ? `<div class="stat-sub">${opts.sub}</div>` : "";
  return `<div class="stat${cls}">
    <div class="stat-label">${icon}${esc(label)}</div>
    <div class="stat-value">${value}</div>${sub}</div>`;
}

/**
 * 积分数值格式化。
 *
 * 分成两个函数，因为这两处的精度诉求**正好相反**：
 *
 *   `fmtCredit`      汇总/概览用 → **取整**。
 *       顶部卡片的 69475.00 看着又长又乱，末尾两位小数对「我还有多少积分」
 *       这个判断毫无信息量（对比 118030 的总额度，小数只是噪音）。
 *
 *   `fmtCreditExact` 单个积分包用 → 保留小数。
 *       包级别的 459.49 / 459 是真实差异（一个包用到只剩 0.49），
 *       抹成整数会让「这个包还剩多少」失真，对账时对不上。
 */
function fmtCredit(n) {
  return String(Math.round(Number(n) || 0));
}

/** 单个积分包的精确保留（最多两位小数，整数不补 .00）。 */
function fmtCreditExact(n) {
  n = Number(n) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * 到期徽标。三档语义色与参考项目一致（那边 expiryClass 用
 * orange-600 / destructive / muted）：橙=7 天内、红=已到期、灰=长期有效。
 * 「7 天内」用橙色而不是黄色，是因为它与「一般警告」不是一回事 ——
 * 黄色在整套配色里已经用于「注意」，用它会稀释紧迫感。
 */
function expiryBadge(daysLeft, expired, expiringSoon) {
  if (expired) return `<span class="exp-badge dead"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg></span>已到期</span>`;
  if (daysLeft == null) return `<span class="exp-badge ever">长期有效</span>`;
  const txt = daysLeft < 1 ? `${Math.max(1, Math.round(daysLeft * 24))} 小时内`
                           : `${Math.floor(daysLeft)} 天后`;
  return `<span class="exp-badge ${expiringSoon ? 'soon' : 'ever'}">${
    expiringSoon ? '<span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/></svg></span>' : ''}${txt}</span>`;
}

/**
 * 积分明细弹窗里的单行（比 pkgRowHtml 多显示总量与已用量）。
 * 抽成独立函数是为了让「仍有剩余」与「已用完」两组共用同一份渲染 ——
 * 两处各写一遍很容易在改动时只改一处，出现同一种包两种样式的割裂。
 */
function pkgDetailRow(p) {
  const low = Number(p.remaining) <= 0;
  const color = p.expired ? 'var(--danger)' : (p.expiringSoon ? 'var(--warn)' : 'var(--fg-muted)');
  const dateTxt = p.expired ? "已到期"
    : (p.expireDate && p.expireDate !== "长期有效" ? p.expireDate + " 到期" : p.expireLabel);
  return `<div class="pkg-row"${low ? ' style="opacity:.55"' : ''}>
    <div class="pkg-line">
      <span class="pkg-amt">${fmtCreditExact(p.remaining)}</span>
      <span class="truncate" style="color:var(--fg-muted)">
        ${esc(p.displayName || "积分包")}
        <span style="color:var(--fg-subtle)">/ ${fmtCreditExact(p.total)} · 已用 ${fmtCreditExact(p.used)}</span>${
          low ? '<span style="color:var(--fg-subtle)"> · 已用完</span>' : ""}</span>
      <span class="tnum" style="color:${color};font-weight:${p.expiringSoon || p.expired ? 600 : 400}">
        ${esc(dateTxt)}</span>
    </div>
    <div class="pkg-track"><i class="${p.expired ? 'dead' : (p.expiringSoon ? 'soon' : '')}"
      style="width:${p.total > 0 ? Math.min(100, Math.max(0, p.remaining / p.total * 100)) : 0}%"></i></div>
  </div>`;
}

/**
 * 单个积分包明细行（紧凑版：数量 chip + 包名 + 到期日 + 细进度条）。
 *
 * 结构本身就是参考项目 account-card.tsx 里 CreditResourceRow 的形态。
 * 这个布局比「一张多列表格」信息密度更高，也更容易一眼看出「哪个包快没了」。
 */
function pkgRowHtml(p, opts) {
  opts = opts || {};
  const remaining = Number(p.remaining || 0);
  const total = Number(p.total || 0);
  const ratio = total > 0 ? Math.min(100, Math.max(0, remaining / total * 100)) : 0;
  const tone = p.expired ? "dead" : (p.expiring_soon ? "soon" : "");
  const showAccount = opts.showAccount !== false && p.account_name;
  const dateTxt = p.expired ? "已到期" : (p.expire_date || "长期");
  const color = p.expired ? 'var(--danger)' : (p.expiring_soon ? 'var(--warn)' : 'var(--fg-muted)');
  // 提示统一走系统的 actionTooltip：原生 title 要悬停一两秒才出、样式不受控，
  // 而这一行本来就是「一眼看清这个包还剩多少、什么时候作废」。
  return `<div class="pkg-row" data-tooltip="${esc(p.display_name || '积分包')}"
    data-tooltip-description="${esc('剩余 ' + remaining + ' / ' + total + ' · ' + (p.expire_label || '长期有效'))}">
    <div class="pkg-line">
      <span class="pkg-amt">${fmtCreditExact(remaining)}</span>
      <span class="truncate" style="color:var(--fg-muted)">${esc(p.display_name || "积分包")}${
        showAccount ? ` <span style="color:var(--fg-subtle)">· ${esc(p.account_name)}</span>` : ""}</span>
      <span class="tnum" style="color:${color};font-weight:${p.expiring_soon || p.expired ? 600 : 400}">${esc(dateTxt)}</span>
    </div>
    <div class="pkg-track"><i class="${tone}" style="width:${ratio}%"></i></div>
  </div>`;
}

/* 列表分页大小。
 * 从 10 提到 20：账号表改成紧凑行（142px → ~44px）之后，一页 10 条
 * 显得太碎（翻页比滚动还频繁）。20 条在一屏内用内部滚动就能扫完。 */
const PS = 20;
let _accData = [], _keyData = [], _modelData = [];
/* 账号列表的 summary（含到期汇总）。积分到期面板直接复用它，
 * 避免为「侧栏角标 / 概览卡」再打一次接口。 */
let _accSummary = null;
/* 积分到期面板的最近一次数据。
 * 声明必须放在**使用它的函数之前**（这里是 refreshAcc）：
 * `let` 在声明语句执行前处于 TDZ，声明靠后会让先调用的函数抛
 * 「Cannot access before initialization」—— 同 _usageOpts 那条注释的坑。 */
let _creditStats = null;
let _creditSyncing = false;
/* 按 id 取账号（用于弹窗标题等展示，避免调用方重复传名称） */
function accById(id) { return _accData.find(a => a.id === id); }
let _accTerm = "", _keyTerm = "", _modelTerm = "";
let _modelPage = 1;  // 模型配置当前页：跨操作与浏览器刷新保持
//: 模型配置的平台过滤（空 = 全部平台）。
//: 注意这是**模型列表内部**的过滤，不影响全局平台上下文 ——
//: 模型是公共表，用户可能想一次看完所有平台，也可能只想看某一个。
let _modelPlatformFilter = "";
let _modelOfficialTotal = 0;  // 官方前端当前可见的模型数（同步时由 cli agent 名单落库）
// 模型列表排序：'default'(按 id) | 'mult_asc' | 'mult_desc'
let _modelSort = "default";
function pagerHtml(total, page, totalPages, fn) {
  if (totalPages <= 1) return `<span class="text-slate-400">共 ${total} 条</span>`;
  return `<span>共 ${total} 条 · 第 ${page}/${totalPages} 页</span>
    <span class="flex gap-1">
      <button class="pg-btn px-2 py-1 rounded border text-xs ${page<=1?'opacity-40 pointer-events-none':''} hover:bg-slate-50" onclick="${fn}(${page-1})"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></span></button>
      <button class="pg-btn px-2 py-1 rounded border text-xs ${page>=totalPages?'opacity-40 pointer-events-none':''} hover:bg-slate-50" onclick="${fn}(${page+1})"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></span></button>
    </span>`;
}

/* ==================== 账号 ==================== */
/**
 * 账号行的「积分到期」单元格 —— **压成一行**。
 *
 * 之前这里渲染 2 个积分包完整明细（名称 + 数量 chip + 进度条），
 * 每包约 50px，把行高撑到 142px，一屏只能看 4 行（原先能看 20 行）。
 * 表格该用来横向扫读对比，明细应去弹窗/积分面板看。
 *
 * 现在：徽标（快到期额度）+ 最近到期的包名与日期 + 包数，全部一行内；
 * 完整逐包明细挂到 `title`，鼠标悬停即可见 —— 信息没丢，只是不占版面。
 */
function accExpiryCell(a) {
  const soon = Number(a.credits_expiring_soon || 0);
  const next = a.credits_next_expiring || [];
  if (!a.credits_synced_at) {
    return `<span class="acc-exp">
      <span class="exp-badge ever">未采集</span>
      <span class="acc-exp-note">点「重新采集」</span></span>`;
  }
  const badge = soon > 0
    ? `<span class="exp-badge soon"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/></svg></span>${fmtCredit(soon)}</span>`
    : (a.credits_soonest_expire_at
        ? expiryBadge(a.credits_soonest_days_left, false, false)
        : `<span class="exp-badge ever">长期有效</span>`);
  const first = next[0];
  const note = first
    ? `${esc((first.display_name || "积分包").slice(0, 8))} ${esc(first.expire_date || "")}`
    : "无剩余包";
  const cnt = `<span class="acc-exp-note">· ${a.credits_active_package_count || next.length} 包</span>`;
  // 悬停看前 3 个包的完整信息（信息不丢，只不占版面）
  const tip = next.slice(0, 3)
    .map(p => `${p.display_name} 剩 ${fmtCreditExact(p.remaining)}/${fmtCreditExact(p.total)}`
              + `，${p.expired ? "已到期" : p.expire_label}`)
    .join("\n");
  const tipAttr = tip ? ` data-tooltip="${esc(tip)}"` : "";
  return `<span class="acc-exp"${tipAttr}>${badge}
    <span class="acc-exp-note">${note}</span>${cnt}</span>`;
}

function consoleIcon(name) {
  const paths = {"fa-user-group": "<circle cx=\"9\" cy=\"7\" r=\"3\"/><path d=\"M3 21v-3a6 6 0 0 1 12 0v3m2-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 2 4v3\"/>", "fa-hourglass-half": "<path d=\"M6 2h12M6 22h12M7 2v5l10 10v5M17 2v5L7 17v5\"/>", "fa-chart-pie": "<path d=\"M21 12a9 9 0 1 1-9-9v9Zm-5-9a9 9 0 0 1 5 5h-5Z\"/>", "fa-key": "<circle cx=\"8\" cy=\"8\" r=\"5\"/><path d=\"m12 12 9 9m-5-5 3-3m-1 5 3-3\"/>", "fa-cubes": "<path d=\"m12 3 8 4v10l-8 4-8-4V7Zm-8 4 8 4 8-4M12 11v10\"/>", "fa-layer-group": "<path d=\"m12 3 10 5-10 5L2 8Zm-9 10 9 5 9-5M3 18l9 5 9-5\"/>", "fa-clock-rotate-left": "<path d=\"M3 4v5h5m-5 0a9 9 0 1 1 0 7M12 7v5l3 2\"/>", "fa-list": "<path d=\"M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01\"/>", "fa-fingerprint": "<path d=\"M4 12a8 8 0 0 1 16 0m-13 5v-5a5 5 0 0 1 10 0v3m-7 5v-8a2 2 0 0 1 4 0v5m-1 5a12 12 0 0 0 4-4M3 16v-1\"/>", "fa-cloud-arrow-up": "<path d=\"M6 18a5 5 0 1 1 1-10 6 6 0 0 1 11 1 4 4 0 0 1 0 8m-6 4V11m-4 4 4-4 4 4\"/>", "fa-gear": "<path d=\"m10 3-1 3-3 1-2 3 2 2v3l2 2 3-1 2 2 3-1 1-3 3-1 1-3-3-2V7l-3-2-2 1Z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>", "fa-seedling": "<path d=\"M12 21v-9M12 16C5 16 3 11 3 7c6 0 9 3 9 9Zm0-4c0-6 3-9 9-9 0 6-3 9-9 9Z\"/>", "fa-cat": "<path d=\"m5 9-1-6 6 3h4l6-3-1 6a8 8 0 1 1-14 0Zm4 4h.01M15 13h.01m-4 4h2\"/>", "fa-list-ul": "<path d=\"M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01\"/>", "fa-chart-line": "<path d=\"M3 3v18h18M6 15l4-5 4 3 6-7\"/>", "fa-right-to-bracket": "<path d=\"M14 3h6v18h-6M3 12h12m-4-4 4 4-4 4\"/>", "fa-rotate": "<path d=\"M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1\"/>", "fa-file-export": "<path d=\"M12 3H4v18h12v-5M9 10h12m-4-4 4 4-4 4\"/>", "fa-power-off": "<path d=\"M12 2v10M6 5a9 9 0 1 0 12 0\"/>", "fa-trash": "<path d=\"M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7\"/>"};
  const extraPaths = {"fa-heart-pulse": "<path d=\"M3 12h4l2-6 4 12 2-6h6\"/>"};
  const path = paths[name] || extraPaths[name];
  return path ? `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>` : '';
}

function accountActionDescription(title) {
  const descriptions = {
    '成长任务':'查看任务进度，完成任务并领取奖励',
    '猫猫旅行':'查看旅行状态，派出或领取奖励',
    '积分明细（逐包到期日）':'查看积分包余额、有效期与到期风险',
    '请求用量':'查看该账号的上游请求与消耗明细',
    '三项健康检查：积分、模型列表、真实对话':'依次验证积分、模型目录和一次真实上游对话',
    '注入本机客户端':'将该账号登录态写入本机客户端',
    '刷新余额与到期快照':'同步最新余额及积分包到期信息',
    '导出登录态':'下载该账号凭据，供备份或重新导入',
    '启用/禁用':'控制该账号是否参与网关调度',
    '删除':'从账号池移除该账号'
  };
  return descriptions[title] || '';
}
/** 把「还有多久」写成人类可读的中文。 */
function fmtRemaining(untilIso) {
  if (!untilIso) return "";
  const ms = Date.parse(untilIso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "已到期";
  const total = Math.floor(ms / 1000);
  if (total < 60) return total + " 秒后";
  const min = Math.floor(total / 60);
  if (min < 60) return min + " 分钟后";
  const hour = Math.floor(min / 60);
  const restMin = min - hour * 60;
  if (hour < 24) return hour + " 小时" + (restMin ? restMin + " 分" : "") + "后";
  const day = Math.floor(hour / 24);
  const restHour = hour - day * 24;
  return day + " 天" + (restHour ? restHour + " 小时" : "") + "后";
}

/**
 * 账号状态徽标（冷却 / 模型冷却）。
 *
 * ## 为什么改成两行布局
 *
 * 原来这两个 chip 只有一行文字 + `data-tooltip`，问题有三个：
 *   1. `limit-chip` 没有上下间距、也没有和账号名左对齐 ——
 *      贴在名字右边挤成一团，多个 chip 之间还叠着。
 *   2. 冷却**剩余时间**只在 tooltip 里有，页面上看不到「还差多久」。
 *   3. **上游到底返回了什么**完全不展示，用户只看到「账号冷却」四个字，
 *      不知道是额度耗尽、限流还是风控；解除后过一会儿又冷却，
 *      也看不到为什么。
 *
 * 现在：文字直接写在徽标里（不用悬停），悬停时给出完整时间与原因。
 */
function accountLimitBadge(a) {
  const limits = (a.model_limits || []).filter(l => !l.until || Date.parse(l.until) > Date.now());
  const reasons = {
    hard_credit: '账号额度耗尽',
    soft_rate: '账号请求限流',
    account_fault: '账号授权或风控限制',
    breaker: '连续失败熔断',
    degraded: '连续失败退避',
    waf: '请求被网关拦截',
    not_found: '接口暂不可用',
    upstream_internal: '上游暂时故障',
  };
  const until = a.gateway_until;
  const cooling = a.gateway_state === 'cooling' && (!until || Date.parse(until) > Date.now());
  const reason = reasons[a.gateway_reason] || '账号暂时冷却';
  const remain = fmtRemaining(until);

  // ---- 上游返回的原始错误 ----
  //
  // 注意字段名：账号列表 API 返回的是 **`upstream_error`** 对象
  // （{http_status, code, message, display_message, raw, client_message}），
  // 而不是 `last_err_msg`（那是数据库列名，没有对外暴露）。
  // 之前读 `a.last_err_msg` 恒为 undefined，所以「上游返回了啥」永远是空的 ——
  // 用户只能看到「账号冷却」四个字，不知道是限流、额度还是风控。
  const up = a.upstream_error || {};
  const upstreamBits = [];
  if (up.http_status) upstreamBits.push("HTTP " + up.http_status);
  if (up.code !== null && up.code !== undefined && up.code !== "") {
    upstreamBits.push("code " + up.code);
  }
  const upMsg = String(up.message || up.display_message || "").trim();
  if (upMsg) upstreamBits.push(upMsg.slice(0, 160));
  const upstreamLine = upstreamBits.length
    ? upstreamBits.join(" · ")
    : (up.raw ? String(up.raw).slice(0, 160) : "");

  const chips = [];
  if (cooling) {
    // 徽标上一行只放**最关键的两个信息**：原因 + 还剩多久。
    // 「冷却 · 账号授权或风控限制 · 44 分钟后恢复」这种长句在表格里
    // 会被折成 4~5 行、比行还高 —— 精简成「冷却 44 分钟后 · 风控限制」，
    // 完整句子仍保留在 tooltip 里。
    const shortReason = {
      hard_credit: '额度耗尽',
      soft_rate: '请求限流',
      account_fault: '风控限制',
      breaker: '连续失败',
      degraded: '退避重试',
      waf: '网关拦截',
      not_found: '接口不可用',
      upstream_internal: '上游故障',
    }[a.gateway_reason] || '暂时冷却';
    const text = remain
      ? `冷却 ${remain} · ${shortReason}`
      : `冷却中 · ${shortReason}`;
    const desc = [
      `原因：${reason}`,
      until ? `冷却至：${fmtTime(until)}（${remain}自动恢复）` : "",
      upstreamLine ? `上游返回：${upstreamLine}` : "上游未记录具体错误信息",
      "点击可立即解除冷却，让该账号重新参与调度。",
    ].filter(Boolean).join("\n");
    chips.push(
      `<button type="button" class="gateway-chip" onclick="clearAccountCooldown(${a.id})"
        data-tooltip="${esc(`${reason} · ${remain || '冷却中'}`)}"
        data-tooltip-description="${esc(desc)}">${esc(text)}</button>`);
  }
  if (limits.length) {
    const kinds = { model_daily: '日额度耗尽', model_rate: '短时限流',
                    model_queue: '上游排队', model_block: '模型不可用' };
    // 最近到期的那一个，直接写在按钮上
    const soonest = limits.slice().sort(
      (x, y) => (Date.parse(x.until || 0) || 0) - (Date.parse(y.until || 0) || 0))[0];
    const soonestRemain = soonest && soonest.until ? fmtRemaining(soonest.until) : "";
    const text = soonestRemain
      ? `${limits.length} 模型冷却 · 最近 ${soonestRemain}`
      : `${limits.length} 模型冷却`;
    const detail = limits.map(l =>
      `${l.model} · ${kinds[l.kind] || '暂时受限'} · ` +
      `${modelLimitDeadlineLabel(l)} ${fmtTime(l.until)}` +
      (l.upstream_message ? `（上游：${String(l.upstream_message).slice(0, 80)}）` : "")
    ).join("\n");
    const scope = cooling
      ? "另有账号级冷却，当前全部模型暂不可调度"
      : "仅以下模型冷却，其他模型仍可调度";
    chips.push(
      `<button type="button" class="limit-chip" onclick="openModelLimits(${a.id})"
        data-tooltip="${esc(text)}" data-tooltip-description="${esc(scope + "\n" + detail)}"
        aria-label="查看模型冷却列表">${esc(text)}</button>`);
  }
  if (!chips.length) return "";
  // 包一层：保证多枚徽标上下有间距、彼此左对齐（见 .acc-chips）
  return `<div class="acc-chips">${chips.join("")}</div>`;
}
function modelLimitDeadlineLabel(entry) {
  return {upstream:'上游重置时间',client_midnight:'按客户端规则，次日零点可重试',queue_retry:'上游建议重试时间',estimated:'本地保守冷却至',backoff:'本地退避至'}[entry.reset_source] || '本地冷却至';
}

function upstreamEvidenceHtml(info) {
  if (!info || (!info.raw && !info.http_status && !info.code)) return '<small>尚无上游错误原文</small>';
  const display = typeof info.display_message === 'string' ? info.display_message : JSON.stringify(info.display_message || {});
  return `<details><summary>上游 HTTP ${esc(info.http_status ?? '未记录')} / code ${esc(info.code ?? '未返回')}</summary>
    ${info.client_message ? `<p>客户端解释：${esc(info.client_message)} ${esc(info.client_description || '')}</p>` : ''}
    ${info.message != null ? `<p>上游 message：${esc(info.message)}</p>` : ''}
    ${info.display_message ? `<p>上游 displayMsg：${esc(display)}</p>` : ''}
    <pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-width:560px;max-height:220px;overflow:auto">${esc(info.raw)}</pre></details>`;
}

// One fixed tooltip avoids clipping by scroll containers and supports keyboard focus.
//
// 定位策略（修「tooltip 漂移」）：
//   1. 先在不透明但**无动画**的状态下测量尺寸。入场动画只改 opacity，
//      transform 会让 `getBoundingClientRect()` 读到动画中间值，算出来的位置
//      和动画结束后的真实尺寸对不上 —— 这就是之前「提示框偏到旁边」的原因。
//   2. 用 `left/top` 直接写最终坐标（不再叠加 translate），避免 transform
//      与定位互相干扰。
//   3. 翻转与夹取一次算完：优先放在锚点上方，放不下才翻到下方；两侧都按
//      视口留 8px 边距夹住，不再产生负溢出。
//   4. 测量前把 `visibility` 留在 hidden，浏览器仍会完成布局，所以量到的是
//      最终尺寸，不会闪。
let _actionTipTarget = null;
let _actionTipTimer = null;
let _actionTipHideTimer = null;
const ACTION_TIP_GAP = 8;
const ACTION_TIP_EDGE = 8;

function hideActionTooltip() {
  clearTimeout(_actionTipTimer);
  clearTimeout(_actionTipHideTimer);
  const tip = document.getElementById('actionTooltip');
  if (tip) tip.hidden = true;
  if (_actionTipTarget) _actionTipTarget.removeAttribute('aria-describedby');
  _actionTipTarget = null;
}

/** 把提示框放到锚点附近，保证完整落在视口内。 */
function positionActionTooltip(tip, target) {
  const r = target.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || innerWidth;
  const vh = document.documentElement.clientHeight || innerHeight;

  // 水平：以锚点中心对齐，再夹进视口。
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(ACTION_TIP_EDGE, Math.min(vw - t.width - ACTION_TIP_EDGE, left));

  // 垂直：优先上方，空间不足则下方；两侧都放不下时贴空间更大的一侧。
  const above = r.top - t.height - ACTION_TIP_GAP;
  const below = r.bottom + ACTION_TIP_GAP;
  let top;
  if (above >= ACTION_TIP_EDGE) top = above;
  else if (below + t.height <= vh - ACTION_TIP_EDGE) top = below;
  else top = Math.max(ACTION_TIP_EDGE, Math.min(vh - t.height - ACTION_TIP_EDGE,
                                                r.top > vh - r.bottom ? above : below));

  tip.style.left = Math.round(left) + 'px';
  tip.style.top = Math.round(top) + 'px';
}

function showActionTooltip(target, immediate = false) {
  clearTimeout(_actionTipHideTimer);
  if (_actionTipTarget === target) return;
  hideActionTooltip();
  _actionTipTarget = target;
  _actionTipTimer = setTimeout(() => {
    if (!target.isConnected) return hideActionTooltip();
    let tip = document.getElementById('actionTooltip');
    if (!tip) {
      tip = document.createElement('div'); tip.id = 'actionTooltip'; tip.role = 'tooltip';
      tip.addEventListener('pointerenter', () => clearTimeout(_actionTipHideTimer));
      tip.addEventListener('pointerleave', scheduleActionTooltipHide);
      document.body.appendChild(tip);
    }
    const model=_modelData.find(m=>m.model_id===target.dataset.modelTooltip);
    const info=model?WBModelMetadata.display(model):null;
    tip.innerHTML = info ? `<strong class="model-tooltip-title">${esc(info.name)} ${modelPromotionBadges(info)}</strong><span>${esc(info.description||'上游暂未提供模型描述')}</span>${info.footer?`<div class="model-promotion-footer">${esc(info.footer)}</div>`:''}`
      : `<strong>${esc(target.dataset.tooltip)}</strong><span>${esc(target.dataset.tooltipDescription || '')}</span>`;
    // 先落位再显示：hidden→visible 之间测量会拿到 0 尺寸。
    tip.style.visibility = 'hidden';
    tip.hidden = false;
    positionActionTooltip(tip, target);
    tip.style.visibility = '';
    target.setAttribute('aria-describedby', 'actionTooltip');
  }, immediate ? 0 : 200);
}
function scheduleActionTooltipHide() {
  clearTimeout(_actionTipHideTimer);
  _actionTipHideTimer = setTimeout(() => {
    const tip = document.getElementById('actionTooltip');
    if (tip?.matches(':hover') || _actionTipTarget?.matches(':hover')) return;
    const selection = getSelection();
    if (selection && !selection.isCollapsed && tip?.contains(selection.anchorNode)) return;
    hideActionTooltip();
  }, 300);
}
document.addEventListener('pointerover', e => {
  if (e.pointerType === 'touch') return;
  const target = e.target.closest('[data-tooltip]');
  if (target && !target.contains(e.relatedTarget)) showActionTooltip(target);
});
document.addEventListener('pointerout', e => {
  if (_actionTipTarget?.contains(e.target) && !_actionTipTarget.contains(e.relatedTarget)) scheduleActionTooltipHide();
});
document.addEventListener('focusin', e => {
  const target = e.target.closest('[data-tooltip]');
  if (target) showActionTooltip(target, true);
});
document.addEventListener('focusout', e => {
  if (!document.getElementById('actionTooltip')?.contains(e.relatedTarget)) scheduleActionTooltipHide();
});
document.addEventListener('scroll', e => {
  if (!document.getElementById('actionTooltip')?.contains(e.target)) hideActionTooltip();
}, true);
document.addEventListener('click', e => {
  if (!document.getElementById('actionTooltip')?.contains(e.target) && !_actionTipTarget?.contains(e.target)) hideActionTooltip();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideActionTooltip(); });
window.addEventListener('resize', hideActionTooltip);

async function openModelLimits(accountId = null) {
  openModal(`<div class="section-head"><h3>模型额度与冷却</h3><button onclick="closeModal()" class="console-btn quiet" aria-label="关闭">关闭</button></div><div id="modelLimitsContent" class="limit-note">正在读取限额台账…</div>`, 'max-w-6xl');
  try {
    const [r, healthResponse] = await Promise.all([api('/api/accounts/model-limits'), api('/api/stats/model-health')]);
    const healthResult = await safeJson(healthResponse);
    const result = await safeJson(r);
    const container = document.getElementById('modelLimitsContent');
    if (!container) return;
    if (!result.ok) { container.textContent = '读取失败，请稍后重试'; return; }
    const d = result.data;
    const limitPriority = {model_block:0, model_daily:1, model_rate:2, model_queue:3};
    const entries = (d.items || []).filter(e => accountId == null || e.account_id === accountId).sort((a, b) =>
      (limitPriority[a.kind] ?? 4) - (limitPriority[b.kind] ?? 4)
      || String(a.model || '').localeCompare(String(b.model || ''))
      || Number(a.account_id) - Number(b.account_id));
    const healthItems = (healthResult.ok ? healthResult.data.items || [] : []).slice().sort((a, b) =>
      Number(Number(a.available_accounts) > 0) - Number(Number(b.available_accounts) > 0)
      || Number(b.limited_accounts || 0) - Number(a.limited_accounts || 0)
      || String(a.model || '').localeCompare(String(b.model || '')));
    const kind = {model_daily:'模型日限额已触发',model_rate:'短时限流',model_queue:'上游排队',model_block:'上游模型服务不存在 / 未配置'};
    const source = {upstream:'上游明确重置时间',client_midnight:'客户端 6008 规则：次日零点重置（北京时间）',queue_retry:'上游 retry_after（重试间隔，不是排队结束时间）',estimated:'上游未给重置时间，本地保守冷却（默认 24 小时）',backoff:'本地退避策略，不代表上游已恢复'};
    const risk = healthResult.ok ? healthResult.data.risk : null;
    const observations = risk?.observations || {};
    const riskCount = reason => Number(observations[reason]?.requests || 0);
    const backgroundSkips = Object.values(risk?.maintenance?.skipped_since_start || {}).reduce((sum, n) => sum + Number(n), 0);
    container.innerHTML = `<p class="limit-note">积分余额与模型每日额度分别计算，0 倍率模型也会触发日限额。6004 = 每日 Token 上限；6008 = 每日请求数上限，客户端说明次日零点重置。上游未提供每日限额数值时显示“未知”，不能用本网关用量推算官方剩余额度。冷却到期仅恢复重试资格。</p>
      ${d.waf_remaining_seconds > 0 ? `<p class="limit-note">出口 IP 保护已触发，约 ${d.waf_remaining_seconds} 秒后解除本地保护，是否可用仍需上游确认。</p>` : ''}
      ${risk ? `<p class="limit-note">近 ${Number(risk.window_minutes)} 分钟网关观测：WAF ${riskCount('waf')} 次，账号限流 ${riskCount('soft_rate')} 次，模型限流 / 排队 ${riskCount('model_rate')} 次，授权限制 ${riskCount('account_fault')} 次，登录失效 ${riskCount('session_dead')} 次。后台当前预留 ${Number(risk.maintenance.reserved_accounts)} 个账号，本进程启动以来累计保护跳过 ${backgroundSkips} 次；这是本网关观测，不代表官方风控评分。</p>` : ''}
      <h4 class="health-title">当前模型限制 · 不可用优先</h4>
      <div class="overflow-x-auto"><table class="tbl model-limit-table"><thead><tr><th>账号</th><th>模型</th><th>本网关判断 / 上游依据</th><th>重置 / 重试 / 本地冷却截止（北京时间）</th><th>时间依据</th><th class="text-right">官方日限额 / 剩余</th><th class="text-right">本网关今日成功 / 请求 · Token</th><th class="text-right">操作</th></tr></thead><tbody>${entries.map(e => `<tr><td>${esc(e.account_name)}</td><td>${esc(e.model)}</td><td>${e.upstream_code === '6004' ? '每日 Token 已达上限' : e.upstream_code === '6008' ? '每日请求数已达上限' : kind[e.kind] || esc(e.kind)}${upstreamEvidenceHtml(e.upstream_error)}</td><td>${modelLimitDeadlineLabel(e)}<br>${fmtTime(e.until)}</td><td>${source[e.reset_source] || '本地退避策略'}</td><td class="text-right tnum">${fmtEmpty(e.quota_total)} / ${fmtEmpty(e.quota_remaining)}</td><td class="text-right tnum">${fmtEmpty(e.successes_today)} / ${fmtNum(e.requests_today || 0)}<br>Token：${e.tokens_today == null ? FMT_EMPTY : fmtK(e.tokens_today)}</td><td class="text-right"><button class="console-btn quiet" onclick="clearModelLimit(${e.account_id},${esc(JSON.stringify(e.model))})">解除冷却</button></td></tr>`).join('') || '<tr><td colspan="8" class="account-empty">当前没有模型冷却记录</td></tr>'}</tbody></table></div>
      <details class="limit-note"><summary>最近账号错误原文（${(d.account_errors || []).filter(e => accountId == null || e.account_id === accountId).length} 条，历史记录不代表当前不可用）</summary>${(d.account_errors || []).filter(e => accountId == null || e.account_id === accountId).map(e => `<div><b>${esc(e.account_name)}</b>${upstreamEvidenceHtml(e.upstream_error)}</div>`).join('')}</details>
      <h4 class="health-title">模型健康 · 近 24 小时（无可选账号优先）</h4>
      <div class="overflow-x-auto"><table class="tbl health-table"><thead><tr><th>模型</th><th class="text-right">可选 / 受限账号</th><th class="text-right">成功 / 请求</th><th class="text-right">失败率</th><th class="text-right">首响应 P50 / P95</th><th class="text-right">总耗时 P95</th><th class="text-right">最早冷却截止</th></tr></thead><tbody>${healthResult.ok ? healthItems.map(m => `<tr><td><b>${esc(m.model)}</b>${m.free ? '<small class="health-free">免费</small>' : ''}</td><td class="text-right tnum">${m.available_accounts} / ${m.limited_accounts}</td><td class="text-right tnum">${m.successes} / ${m.requests}</td><td class="text-right tnum">${fmtPct(m.failure_rate)}</td><td class="text-right tnum">${fmtDuration(m.ttfb_ms.p50)} / ${fmtDuration(m.ttfb_ms.p95)}</td><td class="text-right tnum">${fmtDuration(m.latency_ms.p95)}</td><td class="text-right">${m.earliest_model_recovery ? fmtTime(m.earliest_model_recovery) : FMT_EMPTY}</td></tr>`).join('') || '<tr><td colspan="7" class="account-empty">暂无模型观测</td></tr>' : '<tr><td colspan="7" class="account-empty">健康统计暂时不可用</td></tr>'}</tbody></table></div>
      <p class="limit-note">延迟取最近最多 2000 条成功记录；账号可选数包含当前进程在途占用和出口保护。冷却截止只表示可再次尝试，不保证上游模型或账号已恢复可用。</p>
`;
  } catch(e) {
    const container = document.getElementById('modelLimitsContent');
    if (container) container.textContent = '读取失败，请稍后重试';
  }
}
async function clearModelLimit(accountId, model) {
  if (!await uiConfirm({title:'解除模型冷却',message:'仅清除本地冷却记录，不会重置官方额度；再次触发限额后将重新冷却。',danger:false})) return;
  const r = await api('/api/accounts/' + accountId + '/model-limits/clear', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model})});
  if (!r.ok) { toast('解除失败','err'); return; }
  toast('已解除本地冷却'); loadAccounts(); openModelLimits();
}
async function clearAccountCooldown(accountId) {
  if (!await uiConfirm({title:'解除账号冷却',message:'仅清除该账号的本地冷却 / 熔断 / 降权状态，不会重置官方额度，也不影响模型级冷却；再次触发后将重新冷却。',danger:false})) return;
  const r = await api('/api/accounts/' + accountId + '/cooldown/clear', {method:'POST'});
  const { ok, data } = await safeJson(r);
  if (!ok) { toast('解除失败' + (data && data.detail ? '：' + data.detail : ''), 'err'); return; }
  toast(data && data.cleared ? '已解除账号冷却' : '该账号当前不在冷却中');
  loadAccounts();
}

function accRow(a) {
  // 图标操作按钮抽成数组：顺序/配色一处可调，比 9 个 button 平铺更好维护
  const ops = [
    [`WBReview.accountLimit(${a.id})`, "fa-sliders", "text-indigo-600", "账号并发上限"],
    [`openReauthAccount(${a.id})`, "fa-key", "text-emerald-600", "重新登录"],
    [`growthTasks(${a.id},'${esc(a.name||'')}')`, "fa-seedling", "text-emerald-600", "成长任务"],
    [`catTravel(${a.id})`, "fa-cat", "text-pink-600", "猫猫旅行"],
    [`viewCreditDetails(${a.id},'${esc(a.name||'')}')`, "fa-list-ul", "text-amber-600", "积分明细（逐包到期日）"],
    [`viewRequestUsage(${a.id},'${esc(a.name||'')}')`, "fa-chart-line", "text-blue-600", "请求用量"],
    [`healthCheckAcc(${a.id})`, "fa-heart-pulse", "text-emerald-600", "三项健康检查：积分、模型列表、真实对话"],
    [`injectAcc(${a.id})`, "fa-right-to-bracket", "text-violet-600", "注入本机客户端"],
    [`refreshAcc(${a.id})`, "fa-rotate", "text-indigo-600", "刷新余额与到期快照"],
    [`exportAcc(${a.id},'${esc(a.name||'')}')`, "fa-file-export", "text-sky-600", "导出登录态"],
    [`toggleAcc(${a.id},'${a.status==='active'?'disabled':'active'}')`, "fa-power-off", "text-slate-500", "启用/禁用"],
    [`delAcc(${a.id})`, "fa-trash", "text-red-500", "删除"],
  ];
  // data-label 是给**窄屏卡片形态**用的字段名（见 CSS 里的移动端段落）：
  // 窄屏下表格变成卡片，靠 `td::before { content: attr(data-label) }`
  // 在每行左边补出「总积分 / 剩余 / 积分到期」这些标签，
  // 这样同一份 DOM 既能当表格又能当卡片，不必写两套渲染逻辑。
  // 「剩余」列只放数字：7 天内到期量不再跟可变后缀「(xx)」——右对齐的是
  // 「数字+后缀」整体，有后缀的行数字会被推左，整列数字上下对不齐。
  // 该数字与「积分到期」列的 🔥 徽标同源同值，去掉不丢信息。
  return `<tr>
    <td class="c-name">
      <div class="nm">
        <b data-tooltip="${esc(a.name || "未命名")}">${esc(a.name || "未命名")}</b>
        <span class="c-uid" data-tooltip="账号 UID" data-tooltip-description="${esc(a.uid || '（该账号未提供 UID）')}">${esc(a.uid || "-")}</span>
        ${a.bound_key_id ? `<small class="text-indigo-600">Key 独占：${esc(a.bound_key_name || ("#" + a.bound_key_id))}</small>` : ''}
        ${a.post_login_automation ? `<small style="color:var(--fg-muted)" data-tooltip="登录后自动任务" data-tooltip-description="${esc((a.post_login_automation.result?.errors || []).join('；') || '由账号登录后自动排队的收尾任务（余额、模型、权益同步）')}">${esc(({queued:'自动任务排队中',running:'自动任务执行中',completed:'自动任务已完成',failed:'部分自动任务未完成'})[a.post_login_automation.status] || '')}</small>` : ''}
          ${a.resource_initialization && a.resource_initialization.status !== 'completed' ? `<small style="color:var(--fg-muted)" data-tooltip="资源初始化" data-tooltip-description="${esc((a.resource_initialization.errors || []).join('；') || '账号导入后会自动同步余额与模型目录')}">${esc(({queued:'余额与模型初始化排队中',running:'正在初始化余额与模型',failed:'初始化未完成，可刷新余额或同步模型',invalid_credential:'账号凭证不完整，请重新导入或授权登录',unsupported_region:'国际版凭证无法访问当前国内接口，请更换国内版凭证',auth_required:'上游鉴权失败，请重新授权登录'})[a.resource_initialization.status] || '')}</small>` : ''}
      </div>
      ${accountLimitBadge(a)}
    </td>
    <td class="col-status" data-label="状态">${badge(a.status)}</td>
    <td class="tnum text-right" data-label="总积分" style="color:var(--fg-muted)">${a.balance_total}</td>
    <td class="tnum text-right font-medium" data-label="剩余" style="color:${a.balance_remain>0?'var(--ok,#33587F)':'var(--danger)'}">${a.balance_remain}</td>
    <td data-label="积分到期">${accExpiryCell(a)}${a.credits_collection ? `<small class="billing-state" data-tooltip="账单采集状态" data-tooltip-description="${esc((a.credits_collection.compatibility_fallback ? '兼容接口快照' : a.credits_collection.snapshot_preserved ? '保留上次完整快照' : '三路完整快照') + ' · ' + (a.credits_collection.failed_sources || []).join(' / ') + (a.credits_collection.remaining_difference == null ? '' : ' · 对账差值 ' + a.credits_collection.remaining_difference))}">${a.credits_collection.snapshot_preserved ? '采集不完整' : a.credits_collection.compatibility_fallback ? '兼容快照' : a.credits_collection.remaining_difference ? '账单有差异' : '三路已核对'}</small>` : ''}</td>
    <td class="c-ops" data-label="操作">${ops.map(([fn, ic, col, ttl]) =>
      `<button onclick="${fn}" class="${col}" data-tooltip="${ttl}" data-tooltip-description="${esc(accountActionDescription(ttl))}" aria-label="${ttl}">${consoleIcon(ic)}</button>`).join("")}</td>
  </tr>`;
}

let _accountResourceTimer = null;
let _accountPage = 1;
let _overviewRefreshing = false;
setInterval(async () => {
  if (document.hidden || !TOKEN || $('#app').classList.contains('hidden') || _overviewRefreshing) return;
  _overviewRefreshing = true;
  try { await loadAccounts(); } catch (_) {}
  finally { _overviewRefreshing = false; }
}, 30000);
async function loadAccounts() {
  clearTimeout(_accountResourceTimer);
  // 平台切换模块：账号池的所有数据都按当前平台取。
  // 平台未就绪时先等它加载完（首屏是同一次 DOMContentLoaded 触发，
  // 此时脚本可能还没执行），避免「先按 workbuddy 拉一次再被切换覆盖」的闪烁。
  const platform = await ensurePlatforms();
  // 按**落库平台**分派，不是「是不是 workbuddy」。
  //
  // 旧写法 `platform !== "workbuddy"` 会把所有新平台都当成 Trae ——
  // 切到 Qoder 时调的是 /api/trae/accounts，显示的是 Trae 的账号。
  // 三个平台的账号字段集不同（Trae 有区域/凭证到期，Qoder 有套餐/资源包），
  // 必须各走各的渲染。
  const spec = (window.WBPlatform && window.WBPlatform.spec()) || {};
  const storage = String(
    spec.storage_platform || (platform && platform.platform) || ""
  ).toLowerCase();
  if (storage === "trae") {
    return loadTraeAccounts(platform);
  }
  if (storage === "qoder") {
    return loadQoderAccounts(platform);
  }
  if (storage === "loomy") {
    return loadLoomyAccounts(platform);
  }
  const r = await api("/api/accounts"); if (!r.ok) return;
  // 从 Trae 切回默认平台时把表头/脚注还原（两平台列语义不同，必须显式复位）
  const headEl = $("#accTableHead");
  if (headEl) {
    headEl.innerHTML = `<th>名称</th><th>状态</th>
      <th class="text-right">总积分</th><th class="text-right">剩余</th>
      <th>积分到期</th><th class="text-right">操作</th>`;
  }
  const footEl = $("#accFootNote");
  if (footEl) footEl.textContent = "积分统计仅包含已启用账号";
  const footHintEl = $("#accFootHint");
  if (footHintEl) footHintEl.textContent = "调度优先级与到期明细可在「积分到期」查看";
  const d = await r.json();
  const s = d.summary;
  const soon = Number(s.credits_expiring_soon || 0);
  const soonest = s.soonest_expire_at
    ? expiryBadge((s.soonest_expire_at - Date.now()) / 86400000, false, true) : "";
  $("#overview").innerHTML = `
    ${statCard("账号总数", s.total, { icon:"fa-users", iconColor:"text-slate-400",
        sub: `启用 ${s.active} · 可用 ${s.available}`
             + (s.disabled ? ` · 已禁用 ${s.disabled}` : "") })}
    ${statCard("可用积分", fmtCredit(s.balance_remain), { icon:"fa-wallet", iconColor:"text-slate-400",
        tone: soon > 0 ? "warn" : "brand",
        // 口径必须写明：这里**只算启用中的账号**。
        // 已禁用（登录失效等）的号余额用不到，单独列出来，
        // 否则用户会看到「号少了但积分没少」。
        sub: `启用账号合计（总额度 ${fmtCredit(s.balance_total)}）`
             + (s.disabled_balance_remain
                 ? ` · 另有 ${fmtCredit(s.disabled_balance_remain)} 在已禁用号上（未计入）` : "") })}
    ${statCard("7 天内到期", fmtCredit(soon), { icon:"fa-fire", iconColor:"text-orange-500",
        tone: soon > 0 ? "warn" : "brand",
        sub: soon > 0 ? `${s.expiring_accounts} 个账号 · 不用完会作废` : "暂无即将作废的额度" })}
    ${statCard("最紧迫账号", s.expiring_accounts ? s.expiring_accounts + " 个待烧" : "无",
        { icon:"fa-hourglass-half", iconColor:"text-slate-400",
          tone: s.expiring_accounts ? "brand" : "",
          sub: soonest ? `最近 ${soonest.replace(/<[^>]+>/g, "")}` : "全部长期有效" })}`;
  const headCount = $("#accHeadCount");
  if (headCount) headCount.textContent = s.total;
  // 括号里补上「启用 / 禁用」，避免「共 xx 个」被误读成「xx 个都能用」
  const headBreak = $("#accHeadBreak");
  if (headBreak) {
    headBreak.textContent = `（启用 ${s.active}`
      + (s.disabled ? ` · 已禁用 ${s.disabled}` : "") + `）`;
  }
  _accData = d.items || [];
  if (_accData.some(a => ['queued','running'].includes(a.resource_initialization?.status) || ['queued','running'].includes(a.post_login_automation?.status))) {
    _accountResourceTimer = setTimeout(async () => { await loadAccounts(); await loadModels(); }, 2000);
  }
  _accSummary = s;
  renderAccPage(_accountPage);
  // 侧栏角标：没打开积分面板也能看到「有额度要作废」
  const expiringN = Number(s.expiring_accounts || 0);
  setSideDot("#sideExpiringDot", expiringN);
  const dot = $("#sideExpiringDot");
  if (dot) dot.title = expiringN > 0 ? `${expiringN} 个账号有 7 天内到期的积分` : "";
}
