/* ==========================================================================
   积分到期面板（这是「快到期的先用完」这条策略的观察窗）
   --------------------------------------------------------------------------
   借鉴参考项目 workbuddy-switch 的两处：
     * 「近期到期」——把最近要作废的积分包直接摊开，而不是只给一个总额
     * 「积分总览 / 账号消耗构成」——把存量（还剩多少、多久到期）与
       流量（谁在烧）放在一起看，才能判断「调度到底有没有把快过期的用掉」

   关键设计：**排序与后端调度共用同一套分级**（admin/credits.urgency_rank）。
   界面上排第一的账号就是下一个会被选中的账号 —— 两处口径一旦不一致，
   用户会认为调度坏了，而实际只是排序不同。
   ========================================================================== */

async function loadCreditStats(sync) {
  if (sync) {
    if (_creditSyncing) { toast("正在采集中，请稍候", "err"); return; }
    _creditSyncing = true;
    const btn = $("#creditSyncBtn");
    const old = btn ? btn.innerHTML : "";
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="wb-icon mr-1 wb-ic-spin"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span> 采集中...'; }
    try {
      // 逐号串行采集，账号多时会到几十秒 —— 给明确的等待提示，
      // 而不是让界面静默卡住（用户会以为点坏了）。
      toast("开始重新采集全部账号的积分到期快照…");
      const r = await api("/api/accounts/credits/sync", { method: "POST" });
      const { ok, data } = await safeJson(r);
      if (!ok) { toast("采集失败: " + (data.detail || ""), "err"); return; }
      const failed = data.failed || 0;
      toast(`采集完成：成功 ${data.refreshed}/${data.total}`
        + (failed ? `，${failed} 个失败` : "")
        + (data.credits_expiring_soon ? `，7 天内到期 ${data.credits_expiring_soon}` : ""));
      loadAccounts();   // 概览卡与侧栏角标同步刷新
    } catch (e) {
      toast("采集异常: " + (e && e.message ? e.message : e), "err");
    } finally {
      _creditSyncing = false;
      if (btn) { btn.disabled = false; btn.innerHTML = old; }
    }
  }


const includeDisabled = $("#creditShowDisabled") ? $("#creditShowDisabled").checked : false;
  // **必须带平台**：积分到期是「哪个平台的钱快过期」，
  // 后端虽然支持按平台过滤，但前端不传就等于全平台混算 ——
  // 在某个平台的视图里会看到别的平台的账号。
  const scopeQs = platformScopeQuery();
  const r = await api("/api/credits/expiry?include_disabled="
    + (includeDisabled ? "true" : "false") + platformScopeQuery());
  const { ok, data } = await safeJson(r);
  if (!ok) { toast("加载积分到期失败: " + (data.detail || ""), "err"); return; }
  _creditStats = data;
  renderCreditOverview(data);
  renderCreditRisk(data);
  renderCreditPackages(data);
  renderCreditUsage(data);
  renderCreditRoutingPolicy(data);
  renderCreditAccounts(data);
}

function _creditRoutingMode(policy, mode) {
  return (policy?.modes || []).find(x => x.value === mode) || {value: mode, label: mode, description: ''};
}

function renderCreditRoutingPolicy(d) {
  const policy = d.routing_policy || {};
  const select = $('#creditSelectionMode');
  const interval = $('#creditStartInterval');
  if (!select || !interval) return;
  const current = policy.mode || 'expiry_weighted';
  const options = policy.modes || [];
  select.outerHTML = uiSelectHTML('creditSelectionMode', {options, value: current,
    class: 'w-full border rounded-lg px-3 py-2 text-sm', onChange: updateCreditSelectionHint});
  initUISelects([['creditSelectionMode','选号模式']]);
  interval.value = Number.isFinite(Number(policy.upstream_start_interval_ms))
    ? Number(policy.upstream_start_interval_ms) : 75;
  updateCreditSelectionHint();
}

function updateCreditSelectionHint() {
  const select = $('#creditSelectionMode');
  const hint = $('#creditSelectionHint');
  if (!select || !hint) return;
  const policy = _creditStats?.routing_policy || {};
  const item = _creditRoutingMode(policy, uiSelectValue('creditSelectionMode'));
  hint.textContent = item.description || '';
}

/* 平台切换 -> 积分数据立即重载。
   之前切平台后积分页还是旧平台的数据，要手动刷新才更新。
   这里监听统一事件，切了就重拉，不做整页刷新。 */
document.addEventListener("wb-platform-change", function () {
  // 只有积分面板可见时才拉，避免在别的页面白跑请求
  const panel = document.getElementById("panel-credits");
  if (panel && !panel.classList.contains("hidden")) {
    if (typeof loadCreditStats === "function") loadCreditStats();
  }
});

async function saveCreditRoutingPolicy() {
  const button = $('#creditRoutingSave');
  const mode = uiSelectValue('creditSelectionMode') || 'expiry_weighted';
  const raw = $('#creditStartInterval')?.value ?? '75';
  const interval = Number(raw);
  if (!Number.isInteger(interval) || interval < 0 || interval > 60000) {
    toast('上游启动间隔必须是 0 到 60000 的整数毫秒', 'err');
    return;
  }
  if (button) { button.disabled = true; button.textContent = '保存中…'; }
  try {
    const response = await api('/api/credits/selection-policy', {
      method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({mode, upstream_start_interval_ms: interval})
    });
    const result = await safeJson(response);
    if (!result.ok) { toast(result.data.detail || '策略保存失败', 'err'); return; }
    toast('账号调度策略已保存，新会话立即按新策略分配');
    if (_creditStats) { _creditStats.routing_policy = result.data; renderCreditRoutingPolicy(_creditStats); renderCreditAccounts(_creditStats); }
    await loadCreditStats();
  } catch (error) {
    toast('策略保存失败：' + (error.message || error), 'err');
  } finally {
    if (button) { button.disabled = false; button.textContent = '保存策略'; }
  }
}

/** 概览卡：存量 + 风险 + 最紧迫账号。 */
/**
 * 当前平台的查询串（`&platform=xxx&realm=yyy`）。
 *
 * 后端每个列表接口都支持按平台收窄，但前端很多地方**没传**，
 * 于是「在某平台视图里看到别的平台数据」。统一从这里取，保证口径一致。
 *
 * 注意：**必须定义在全局作用域**。之前被误插入 `loadCreditStats` 内部，
 * 结果只有那一处能用，其它地方调用直接 ReferenceError。
 */
function platformScopeQuery() {
  try {
    const cur = window.WBPlatform && window.WBPlatform.current
      ? window.WBPlatform.current() : null;
    if (!cur || !cur.platform) return "";
    const parts = ["platform=" + encodeURIComponent(cur.platform)];
    if (cur.realm) parts.push("realm=" + encodeURIComponent(cur.realm));
    return "&" + parts.join("&");
  } catch (e) {
    return "";
  }
}

function renderCreditOverview(d) {
  const s = d.summary;
  const box = $("#creditOverview");
  if (!box) return;
  const atRisk = Number(s.at_risk_ratio || 0) * 100;
  // 概览卡用**余额口径**的可用积分（与账号面板「可用积分」一致）。
  // 快照口径只覆盖采集过到期数据的号，拿它当「总剩余」会偏小，
  // 于是同一块屏上两个面板显示两个不同的总数。
  const avail = Number(s.available_remaining != null ? s.available_remaining : s.total_remaining);
  const snapAcc = Number(s.snapshot_accounts || s.accounts || 0);
  box.innerHTML = `
    ${statCard("可用积分", fmtCredit(avail), {
        icon:"fa-wallet", iconColor:"text-slate-400", tone:"brand",
        sub:`${s.accounts} 个启用账号 · ${s.expiring_packages} 个快到期包` })}
    ${statCard(`${d.expiring_soon_days} 天内到期`, fmtCredit(s.expiring_soon_remaining), {
        icon:"fa-fire", iconColor:"text-orange-500",
        tone: s.expiring_soon_remaining > 0 ? "warn" : "brand",
        sub: s.expiring_soon_remaining > 0
          ? `占全部剩余 ${atRisk.toFixed(1)}% · 不用完会作废`
          : "暂无即将作废的额度" })}
    ${statCard("长期有效", fmtCredit(s.evergreen_remaining), {
        icon:"fa-infinity", iconColor:"text-slate-400", tone:"brand",
        sub:"没有作废风险，留到最后用" })}
    ${statCard("最紧迫账号", s.soonest_account_name || "无", {
        icon:"fa-hourglass-half", iconColor:"text-slate-400",
        tone: s.expiring_soon_remaining > 0 ? "warn" : "brand",
        sub: s.soonest_days_left != null
          ? `${s.soonest_days_left < 1
              ? Math.max(1, Math.round(s.soonest_days_left * 24)) + " 小时内到期"
              : Math.floor(s.soonest_days_left) + " 天后到期"}`
          : "全部长期有效" })}
    ${s.expired_remaining > 0 ? `<div style="grid-column:1/-1" class="fs-11-5 px-1"
        style="color:var(--danger)"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>
        有 ${fmtCredit(s.expired_remaining)} 积分已过期但账面仍有剩余（上游扣减延迟），建议核对。</div>` : ""}`;
}

/** 到期风险分布：把各时间档要作废的额度画成一条堆叠条 + 图例。 */
function renderCreditRisk(d) {
  const box = $("#creditRiskBar");
  const hint = $("#creditRiskHint");
  if (!box) return;
  const wins = (d.windows || []).filter(w => w.amount > 0);
  const total = Number(d.summary.total_remaining || 0);
  const evergreen = Number(d.summary.evergreen_remaining || 0);
  // 如实标注覆盖范围：分档条只统计「已采集到期快照」的账号
  // （`total_remaining` 是快照口径），没采集的号不在其中。
  // 不写清楚的话，用户会拿它跟上面的「可用积分」对比，觉得数字对不上。
  const _snapN = Number(d.summary.snapshot_accounts || 0);
  const _allN = Number(d.summary.accounts || 0);
  const _cover = _snapN && _allN && _snapN < _allN
    ? `（已采集 ${_snapN}/${_allN} 个账号）` : "";
  if (hint) hint.textContent = total > 0
    ? `共 ${fmtCredit(total)} 积分，按到期时间分档${_cover}` : "";
  if (!wins.length) {
    box.innerHTML = `<div class="empty">没有任何即将到期的额度 —— 全部积分包都是长期有效或已清空。</div>`;
    return;
  }
  const colors = ["var(--danger)", "var(--warn-bar)", "#f59e0b", "#84cc16", "var(--c1)"];
  // windows 是**累计**金额（≤1 天 / ≤3 天 / …），画堆叠条要取增量才不重叠。
  // 各段之和必然 ≤ total，但可能不等于 total：
  //   * 30 天以外的有限期额度（有到期日但很远）既不在任何档里，也
  //     不属于「长期有效」—— 用一个中性灰段把它显示出来，
  //     否则条形图会「看起来少了一截」而没有任何解释。
  let prev = 0;
  const segs = wins.map((w, i) => {
    const delta = Math.max(0, w.amount - prev);
    prev = w.amount;
    const pct = total > 0 ? Math.max(0.6, delta / total * 100) : 0;
    return `<span style="width:${pct}%;background:${colors[i % colors.length]}"
      data-tooltip="≤${w.days} 天到期：${fmtCredit(delta)} 积分（${w.packages} 个包）"></span>`;
  }).join("");
  const rest = Math.max(0, total - prev - evergreen);
  const everPct = total > 0 ? Math.max(0, evergreen / total * 100) : 0;
  const restPct = total > 0 ? Math.max(0, rest / total * 100) : 0;
  box.innerHTML = `
    <div class="risk-bar mb-3">${segs}${
      restPct > 0.4 ? `<span style="width:${restPct}%;background:var(--c8)"
        data-tooltip="30 天以外到期：${fmtCredit(rest)} 积分"></span>` : ""}${
      everPct > 0.4 ? `<span style="width:${everPct}%;background:var(--surface-3)"
        data-tooltip="长期有效：${fmtCredit(evergreen)} 积分"></span>` : ""}</div>
    <div class="flex flex-wrap gap-x-4 gap-y-1-5 fs-11-5" style="color:var(--fg-muted)">
      ${wins.map((w, i) => `<span class="flex items-center gap-1.5">
        <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${colors[i % colors.length]}"></span>
        ≤${w.days} 天：<b class="tnum" style="color:var(--fg)">${fmtCredit(w.amount)}</b>
        <span style="color:var(--fg-subtle)">（${w.packages} 个包）</span></span>`).join("")}
      ${rest > 0 ? `<span class="flex items-center gap-1.5">
        <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--c8)"></span>
        30 天以外：<b class="tnum" style="color:var(--fg)">${fmtCredit(rest)}</b></span>` : ""}
      <span class="flex items-center gap-1.5">
        <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--surface-3)"></span>
        长期有效：<b class="tnum" style="color:var(--fg)">${fmtCredit(evergreen)}</b></span>
    </div>`;
}

/** 「最近快到期的积分包」：逐包平铺、按到期升序，**分页 + 滚动到底自动加载**。
 *
 * 后端一页只给 60 条（总包数实测 400+ 且会随账号数继续长）。
 * 已加载的页累积在 `_creditPkgLoaded`，用户滚到接近底部时自动取下一页 ——
 * 不用手动点按钮（手点很烦），也不会把整页拉成无限长（那会越用越卡）。
 */
let _creditPkgLoaded = [];      // 已加载的包（按到期升序拼接）
let _creditPkgLoading = false;  // 防重入：一次只发一个续页请求
let _creditPkgScrollBound = false;

function renderCreditPackages(d) {
  const box = $("#creditPackages");
  const hint = $("#creditPkgHint");
  if (!box) return;
  _creditPkgLoaded = d.packages || [];     // 重新加载面板时重置为第一页
  _creditPkgLoading = false;
  const total = Number(d.packages_total || _creditPkgLoaded.length);
  if (hint) {
    hint.textContent = total
      ? `按到期升序 · 已显示 ${_creditPkgLoaded.length}/${total} 个`
      : "";
  }
  if (!_creditPkgLoaded.length) {
    box.innerHTML = `<div class="empty">没有仍有剩余的积分包。<br>点右上「重新采集」从上游拉取最新明细。</div>`;
    updateCreditPkgMore(false);
    return;
  }
  box.innerHTML = _creditPkgLoaded.map(p => pkgRowHtml(p)).join("");
  box.scrollTop = 0;
  updateCreditPkgMore(!!d.has_more);
  bindCreditPkgScroll();
}

/**
 * 绑定「滚动到底自动续页」。
 *
 * 为什么用 `scroll` 事件 + 阈值而不是 IntersectionObserver：
 * 容器固定高度、滚动的是容器本身（不是 window），scroll 事件最直观可靠，
 * 且不需要维护观察者生命周期。**只绑一次**（`_creditPkgScrollBound` 守卫），
 * 否则每次重新渲染都会叠加一个监听器，滚动一次触发 N 次请求。
 */
function bindCreditPkgScroll() {
  const box = $("#creditPackages");
  if (!box || _creditPkgScrollBound) return;
  _creditPkgScrollBound = true;
  box.addEventListener("scroll", () => {
    if (_creditPkgLoading) return;
    // 距底部 120px 内就预取下一页 —— 等真正见底再加载会有一段空白等待
    const nearBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 120;
    if (!nearBottom) return;
    const total = Number((_creditStats && _creditStats.packages_total) || 0);
    if (total && _creditPkgLoaded.length >= total) return;   // 已取完
    loadMoreCreditPackages();
  }, { passive: true });
}

/**
 * 续页提示行的显隐。
 *
 * `loading=true` 时才显示「正在加载更多」。
 * 注意**不能**用「has_more 就显示」—— 滚动加载的场景下，绝大多数时间
 * 都不是在加载，一直挂个转圈会让用户以为卡住了（这正是第一版的 bug）。
 * 全部取完后 `has_more=false`，此时也不显示。
 */
function updateCreditPkgMore(hasMore, loading) {
  const wrap = $("#creditPkgMore");
  if (!wrap) return;
  wrap.classList.toggle("hidden", !loading);
}

/** 取下一页积分包并**追加**到列表（不重建整页，滚动位置不跳）。 */
async function loadMoreCreditPackages() {
  if (_creditPkgLoading) return;
  _creditPkgLoading = true;
  updateCreditPkgMore(true, true);
  try {
    const r = await api(`/api/credits/expiry?package_offset=${_creditPkgLoaded.length}&package_limit=60${platformScopeQuery()}`);
    const { ok, data } = await safeJson(r);
    if (!ok) { toast("加载失败：" + (data.detail || ""), "err"); return; }
    const box = $("#creditPackages");
    const add = data.packages || [];
    if (box && add.length) {
      // 追加而不是整体重建：避免滚动位置跳回顶部（用户正在往下翻）
      box.insertAdjacentHTML("beforeend", add.map(p => pkgRowHtml(p)).join(""));
    }
    _creditPkgLoaded = _creditPkgLoaded.concat(add);
    if (_creditStats) {           // 让「总数」与后续判断保持一致
      _creditStats.packages_total = data.packages_total;
      _creditStats.has_more = data.has_more;
    }
    const hint = $("#creditPkgHint");
    const total = Number(data.packages_total || _creditPkgLoaded.length);
    if (hint) {
      hint.textContent = `按到期升序 · 已显示 ${_creditPkgLoaded.length}/${total} 个`
        + (data.has_more ? "" : " · 已全部加载");
    }
  } catch (e) {
    toast("加载异常：" + (e && e.message ? e.message : e), "err");
  } finally {
    _creditPkgLoading = false;
    updateCreditPkgMore(false, false);   // 加载结束即隐藏转圈
  }
}

/** 账号消耗构成：谁在烧积分（数据源 usage_logs 的积分聚合）。 */
async function renderCreditUsage(d) {
  const box = $("#creditUsage");
  const hint = $("#creditUsageHint");
  if (!box) return;
  box.innerHTML = `<div class="fs-12-5 py-4 text-center" style="color:var(--fg-subtle)">加载中...</div>`;
  try {
    // 必须带平台：这个面板是「当前平台的号谁在烧积分」，
    // 不传平台就会把所有平台的账号混进来。
    const r = await api("/api/credits/usage?days=7&top=12" + platformScopeQuery());
    const { ok, data } = await safeJson(r);
    if (!ok) { box.innerHTML = `<div class="empty">加载失败：${esc(data.detail || "")}</div>`; return; }
    const rows = (data.accounts || []).filter(x => x.credits > 0);
    const maxC = Math.max(1, ...rows.map(x => x.credits));
    if (hint) hint.textContent = `近 ${data.range_days} 天 · 合计 ${fmtCredit(data.total_credits)} 积分`;
    if (!rows.length) {
      box.innerHTML = `<div class="empty">近 ${data.range_days} 天没有产生积分消耗。</div>`;
      return;
    }
    box.innerHTML = `<div class="flex flex-col gap-2.5">${rows.map(x => {
      const w = Math.max(2, x.credits / maxC * 100);
      const soonTag = x.expiring_soon_remaining > 0
        ? `<span class="exp-badge soon">${fmtCredit(x.expiring_soon_remaining)} 将到期</span>` : "";
      return `<div>
        <div class="flex items-center justify-between gap-2 fs-12-5">
          <span class="truncate font-medium">${esc(x.account_name)}</span>
          <span class="shrink-0 tnum" style="color:var(--fg-muted)">
            <b style="color:var(--fg)">${fmtCredit(x.credits)}</b> 积分
            <span style="color:var(--fg-subtle)">· ${x.requests} 次</span></span>
        </div>
        <div class="pkg-track" style="margin-top:4px"><i style="width:${w}%"></i></div>
        <div class="flex items-center gap-2 fs-10-5 mt-1" style="color:var(--fg-subtle)">
          <span>剩余 ${fmtCredit(x.remaining)}</span>${soonTag}
        </div>
      </div>`;
    }).join("")}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="empty">加载异常：${esc(String(e && e.message || e))}</div>`;
  }
}

/** 账号到期排行：用于观察到期风险；真实选号由当前策略决定。 */
function renderCreditAccounts(d) {
  const body = $("#creditBody");
  const hint = $("#creditAccHint");
  if (!body) return;
  const rows = d.accounts || [];
  const policy = d.routing_policy || {};
  const modeItem = _creditRoutingMode(policy, policy.mode || 'expiry_weighted');
  if (hint) hint.textContent = `${rows.length} 个账号 · ${d.selection_mode === 'manual' ? '手动优先级（已覆盖自动策略）' : '自动：' + modeItem.label} · 排名用于观察到期风险`;
  if ($('#creditAutoOrder')) $('#creditAutoOrder').disabled = d.selection_mode !== 'manual';
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8"><div class="empty">没有账号。先在「账号池」里添加。</div></td></tr>`;
    return;
  }
  body.innerHTML = rows.map((a, i) => {
    const soon = Number(a.expiring_soon_remaining || 0);
    const expired = Number(a.expired_remaining || 0);
    const rank = i + 1;
    // 前三名给「快到期」的视觉权重；自动模式是否优先使用由策略决定。
    const rankHtml = soon > 0 && rank <= 3
      ? `<span class="exp-badge soon" data-tooltip="优先级 ${rank}"
           data-tooltip-description="这是到期风险排行第 ${rank} 名。实际流量按当前调度策略分配，排名越靠前只代表到期更紧迫。">${rank}</span>`
      : `<span class="tnum" style="color:var(--fg-subtle)">${rank}</span>`;
    const next = (a.next_expiring || []).slice(0, 2)
      .map(p => pkgRowHtml(p, { showAccount: false })).join("");
    const disabled = a.status !== "active"
      ? `<span class="fs-10-5" style="color:var(--fg-subtle)">（不参与调度）</span>` : "";
    return `<tr>
      <td class="align-top">${rankHtml}</td>
      <td class="align-top">
        <div class="font-medium">${esc(a.account_name)}</div>
        <div class="fs-10-5 font-mono" style="color:var(--fg-subtle)">${esc(a.uid || "-")}</div>
      </td>
      <td class="align-top">${badge(a.status)}${disabled}</td>
      <td class="align-top text-right tnum font-medium">${fmtCredit(a.total_remaining)}</td>
      <td class="align-top text-right tnum" style="color:${soon > 0 ? 'var(--warn)' : 'var(--fg-subtle)'};font-weight:${soon > 0 ? 600 : 400}">
        ${soon > 0 ? fmtCredit(soon) : "—"}</td>
      <td class="align-top text-right tnum" style="color:var(--fg-muted)">${fmtCredit(a.evergreen_remaining)}</td>
      <td class="align-top">${expiryBadge(a.soonest_days_left, expired > 0 && a.soonest_expire_at === null, a.expiring_soon)}
        ${a.synced_at ? `<div class="text-[10px] mt-0.5" style="color:var(--fg-subtle)">${fmtTime(new Date(a.synced_at).toISOString().replace('T',' ').slice(0,19), false)} 采集</div>` : ""}</td>
      <td class="align-top" style="min-width:230px">${next || `<span class="text-[11px]" style="color:var(--fg-subtle)">没有仍有剩余的积分包</span>`}</td>
      <td class="align-top text-right whitespace-nowrap credit-ops">
        <!-- 操作提示统一走系统的 actionTooltip（data-tooltip / data-tooltip-description）：
             title 属性是浏览器原生气泡，延迟 1~2 秒才出现、样式不可控、鼠标一动就消失，
             而这张表里「上移/下移会改变真实选号顺序」必须说清楚，误点代价不小。
             排序按钮加浅色底：它们是这个表格里唯一会改变系统行为的操作，
             不能和「查看明细」「重新采集」这种只读操作长得一样。 -->
        <button type="button" class="console-btn quiet credit-sort-btn" onclick="moveCreditAccount(${a.account_id},-1)"
                aria-label="上移账号 ${esc(a.account_name)}"
                data-tooltip="上移 · 提高真实使用优先级"
                data-tooltip-description="${esc('把「' + a.account_name + '」与上一名对调。保存后立刻影响真实选号顺序，在途请求继续执行；只有手动排序模式下才会生效。')}"
                ${i === 0 ? 'disabled' : ''}><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg></span></button>
        <button type="button" class="console-btn quiet credit-sort-btn" onclick="moveCreditAccount(${a.account_id},1)"
                aria-label="下移账号 ${esc(a.account_name)}"
                data-tooltip="下移 · 降低真实使用优先级"
                data-tooltip-description="${esc('把「' + a.account_name + '」与下一名对调。保存后立刻影响真实选号顺序，在途请求继续执行；只有手动排序模式下才会生效。')}"
                ${i === rows.length - 1 ? 'disabled' : ''}><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg></span></button>
        <button type="button" class="console-btn quiet credit-op-btn" onclick="viewCreditDetails(${a.account_id},'${esc(a.account_name)}')"
                aria-label="查看 ${esc(a.account_name)} 的全部积分包"
                data-tooltip="积分明细 · 逐包到期日"
                data-tooltip-description="查看该账号全部积分包的余额、总额度与到期日（按到期升序，排最前的最先作废）。默认读库内快照，秒开；要最新数据请在弹窗里点「重新采集」。"
                style="color:var(--warn)"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/></svg></span></button>
        <button type="button" class="console-btn quiet credit-op-btn" onclick="refreshAcc(${a.account_id}).then(loadCreditStats)"
                aria-label="重新采集 ${esc(a.account_name)} 的积分与到期快照"
                data-tooltip="重新采集该账号"
                data-tooltip-description="只对这一个账号真实调用上游（余额 + 逐包到期快照，约 0.4~2 秒）。全部账号请用右上角「重新采集」。"
                style="color:var(--brand-ink)"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg></span></button>
      </td>
    </tr>`;
  }).join("");
}

let _creditOrderSaving = false;
async function saveCreditOrder(mode, ids, description) {
  if (_creditOrderSaving || !_creditStats) return;
  _creditOrderSaving = true;
  const expected = [...(_creditStats.selection_order || [])];
  try {
    if (!await uiConfirm({title:'确认调整真实账号优先级', danger:true,
      message:description + '这会改变实际被优先使用的账号，下一次选号即生效。停用、额度限制、冷却和账号独享绑定仍然有效；在途请求继续执行。是否确认？', okText:'确认调整'})) return;
    const response = await api('/api/credits/selection-order', {method:'POST',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({mode, ids, expected_ids:expected, confirm:true})});
    const result = await safeJson(response);
    if (!result.ok) { toast(result.data.detail || '保存排序失败', 'err'); await loadCreditStats(); return; }
    toast(mode === 'manual' ? '真实账号优先级已更新' : '已恢复当前自动调度策略');
    await loadCreditStats();
  } catch (error) { toast('保存排序失败：' + error.message, 'err'); }
  finally { _creditOrderSaving = false; }
}
async function moveCreditAccount(accountId, direction) {
  const visible = _creditStats?.accounts || [];
  const index = visible.findIndex(a => a.account_id === accountId);
  const other = visible[index + direction];
  if (index < 0 || !other || ![-1, 1].includes(direction)) return;
  const ids = [...(_creditStats.selection_order || [])];
  const from = ids.indexOf(accountId), to = ids.indexOf(other.account_id);
  if (from < 0 || to < 0) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  await saveCreditOrder('manual', ids, `将「${visible[index].account_name}」从第 ${index + 1} 位移至第 ${index + direction + 1} 位。`);
}
async function resetCreditOrder() {
  const policy = _creditStats?.routing_policy || {};
  const mode = _creditRoutingMode(policy, policy.mode || 'expiry_weighted');
  await saveCreditOrder('automatic', [], `恢复「${mode.label}」自动调度，清除手动优先级。`);
}

/* ==================== 手机号登录（全自动授权换凭证） ====================
 * 与「批量上传」的区别：这里不需要用户手上有 .info 文件，
 * 应用户手机号 + 验证码，由**服务端**完成整条 auth 授权并把凭证直接入库。
 * 全程不需要安装 WorkBuddy 客户端，手机浏览器也能走完。
 */
let _plSid = "", _plTimer = null, _plCountdown = 0, _plBusy = false, _plRetryUntil = 0, _plRestoring = false;
function plSave() {
  WBPhone.save('wb_admin_phone', {sid:_plSid, mobile:$('#plMobile')?.value || '',
    country:$('#plCountry')?.value || '86', retryUntil:_plRetryUntil,
    codeSent:!$('#plStep2')?.classList.contains('hidden')});
}

let _plAccountId = null;
async function openPhoneLogin(accountId = null){
  const sameTarget = _plAccountId === accountId;
  _plAccountId = accountId;
  if (sameTarget && $('#plMobile') && $('#plStep3').classList.contains('hidden')) {
    $('#modal').classList.remove('hidden'); $('#modal').classList.add('flex');
    $('#modal').dataset.closeOnly = '1'; return;
  }
  const saved = WBPhone.read('wb_admin_phone');
  _plSid = saved.sid || '';
  openModal(`
    <h3 class="font-bold mb-1"><span class="wb-icon mr-1 text-emerald-600"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg></span> 手机号登录</h3>
    <p class="text-xs text-slate-500 mb-2">${accountId ? `正在重新登录账号 #${Number(accountId)}，只接受原身份，保留历史与绑定。` : ""}</p>
    <p class="text-xs text-slate-500 mb-4">输入手机号获取验证码。登录成功后系统会自动完成授权，把凭证加入账号池；<b>无需安装客户端</b>。</p>

    <div id="plStep1">
      <label class="text-xs text-slate-500">手机号</label>
      <div class="flex gap-2 mt-1">
        <select id="plCountry" aria-label="地区" onchange="plSave()">
          <option value="86">+86 中国大陆</option><option value="852">+852 中国香港</option><option value="853">+853 中国澳门</option>
        </select>
        <input id="plMobile" type="tel" inputmode="numeric" maxlength="11" placeholder="11 位手机号"
               oninput="plSave()" class="flex-1 min-w-0 border rounded-lg px-3 py-2 text-sm font-mono" />
      </div>
      <div class="flex justify-end gap-2 mt-4">
        <button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">取消</button>
        <button id="plSendBtn" onclick="plSend()" class="px-3 py-1.5 rounded-lg btn-primary">获取验证码</button>
      </div>
    </div>

    <div id="plStep2" class="hidden">
      <label class="text-xs text-slate-500">验证码</label>
      <div class="flex gap-2 mt-1">
        <input id="plCode" type="tel" inputmode="numeric" maxlength="6" placeholder="6 位验证码"
               class="flex-1 border rounded-lg px-3 py-2 text-sm font-mono tracking-widest" />
        <button id="plResendBtn" onclick="plSend()" class="px-3 py-1.5 rounded-lg border text-sm shrink-0 whitespace-nowrap" disabled>重新获取</button>
      </div>
      <p id="plHint" class="text-xs text-slate-400 mt-2"></p>
      <div class="flex justify-end gap-2 mt-4">
        <button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">取消</button>
        <button id="plVerifyBtn" onclick="plVerify()" class="px-3 py-1.5 rounded-lg btn-primary">登录并上传</button>
      </div>
    </div>

    <div id="plStep3" class="hidden text-center py-4">
      <div id="plResultIcon" class="text-4xl mb-2"></div>
      <div id="plResultMsg" class="text-sm"></div>
      <div class="flex justify-center gap-2 mt-4">
        <button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">关闭</button>
      </div>
    </div>
    <div class="phone-login-footer">
      <a href="/join" target="_blank" rel="noopener noreferrer" onclick="watchJoinAuthorization()"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg></span>授权页面</a>
      <span>在浏览器完成授权后自动加入账号池</span>
    </div>`, "max-w-md");
  $('#modal').dataset.closeOnly = '1';
  $('#plMobile').value = saved.mobile || '';
  $('#plCountry').value = ['86','852','853'].includes(saved.country) ? saved.country : '86';
  WBPhone.mountRegion($('#plCountry'), $('#plMobile'));
  $('#plMobile').maxLength = $('#plCountry').value === '86' ? 11 : 8;
  _plRetryUntil = saved.retryUntil || 0;
  _plRestoring = !!_plSid;
  plStartCountdown(Math.max(0, Math.ceil((_plRetryUntil-Date.now())/1000)));
  if (_plSid) {
    try {
      const response = await api('/api/login/status/' + encodeURIComponent(_plSid));
      if (!response.ok) throw new Error('无法恢复登录会话');
      const state = await response.json();
      if (state.alive && !state.consumed && state.code_sent) {
        $('#plMobile').value = state.mobile; $('#plCountry').value = state.country_code;
        WBPhone.syncRegion($('#plCountry'));
        $('#plStep1').classList.add('hidden'); $('#plStep2').classList.remove('hidden');
        $('#plHint').textContent = '验证码已发送至 +' + state.country_code + ' ' + state.mobile;
        plStartCountdown(Math.max(state.retry_after || 0, Math.ceil((_plRetryUntil-Date.now())/1000)));
      } else if (!state.alive || state.consumed) { _plSid = ''; WBPhone.clear('wb_admin_phone'); }
    } catch (e) { toast(e.message, 'err'); }
    finally {
      _plRestoring = false;
      if ($('#plSendBtn')) $('#plSendBtn').disabled = _plBusy || Date.now() < _plRetryUntil;
      if ($('#plResendBtn')) $('#plResendBtn').disabled = _plBusy || Date.now() < _plRetryUntil;
    }
  }
  setTimeout(() => { const el = $("#plMobile"); if(el) el.focus(); }, 60);
}

let _joinRefreshPending = false;
function watchJoinAuthorization(){ _joinRefreshPending = true; }
function refreshAfterJoin(){
  if(!_joinRefreshPending || document.visibilityState === "hidden") return;
  _joinRefreshPending = false;
  loadAccounts();
}
window.addEventListener("focus", refreshAfterJoin);
window.addEventListener("wb-shell-resume", refreshAfterJoin);
document.addEventListener("visibilitychange", refreshAfterJoin);

/* 发起会话（拿 sid）。发码前必须先有 sid —— 整条授权链绑定在它上面。 */
async function plStart(){
  const r = await api("/api/login/start", { method: "POST" });
  const { ok, data } = await safeJson(r);
  if(!ok || !data.sid){
    throw new Error((data.detail && (data.detail.message || data.detail)) || "发起登录失败");
  }
  _plSid = data.sid;
  plSave();
  return data.sid;
}

function plStartCountdown(sec){
  _plRetryUntil = Date.now() + Math.max(0, sec) * 1000;
  const btn = $("#plResendBtn");
  if(_plTimer) clearInterval(_plTimer);
  const tick = () => {
    _plCountdown = Math.max(0, Math.ceil((_plRetryUntil - Date.now()) / 1000));
    const b = $("#plResendBtn");
    if(!b) { clearInterval(_plTimer); return; }
    if(_plCountdown <= 0){
      clearInterval(_plTimer); _plTimer = null;
      b.disabled = _plBusy || _plRestoring; b.textContent = "重新获取";
      if ($('#plSendBtn')) { $('#plSendBtn').disabled = _plBusy || _plRestoring; $('#plSendBtn').textContent = '获取验证码'; }
      return;
    }
    b.disabled = true; b.textContent = _plCountdown + "s";
    if ($('#plSendBtn')) { $('#plSendBtn').disabled = true; $('#plSendBtn').textContent = _plCountdown + 's'; }
  };
  tick();
  if (_plCountdown > 0) _plTimer = setInterval(tick, 1000);
  plSave();
}

async function plSend(){
  if (_plBusy || _plRestoring || Date.now() < _plRetryUntil) return;
  const mobile = ($("#plMobile").value || "").replace(/\D/g, "");
  const country_code = $('#plCountry').value;
  if(!WBPhone.valid(country_code, mobile)){ toast("请输入所选地区的有效手机号", "err"); return; }
  _plBusy = true;
  const btn = $("#plSendBtn") || $("#plResendBtn");
  if(btn) btn.disabled = true;
  try {
    if(!_plSid) await plStart();
    const r = await api("/api/login/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid: _plSid, mobile, country_code })
    });
    const { ok, data } = await safeJson(r);
    if(!ok){
      const d = data.detail;
      const msg = (d && (d.message || d)) || "发送失败";
      // 会话可能已过期（超时/已消费）→ 清掉，下次点击自动重开
      if(d && d.step === "session") _plSid = "";
      toast(String(msg), "err");
      plStartCountdown(Number(r.headers.get('Retry-After')) || 60);
      return;
    }
    $("#plStep1").classList.add("hidden");
    $("#plStep2").classList.remove("hidden");
    $("#plHint").textContent = "验证码已发送至 +" + country_code + ' ' + mobile + "，请查看短信";
    plStartCountdown(data.retry_after || 60);
    setTimeout(() => { const el = $("#plCode"); if(el) el.focus(); }, 60);
  } catch(e){
    toast(String(e.message || e), "err");
    plStartCountdown(60);
  } finally { _plBusy = false; }
}

async function plVerify(){
  if (_plBusy) return;
  const code = ($("#plCode").value || "").replace(/\D/g, "");
  if(code.length !== 6){ toast("请输入 6 位验证码", "err"); return; }
  if(!_plSid){ toast("会话已失效，请重新获取验证码", "err"); return; }
  _plBusy = true;
  const btn = $("#plVerifyBtn");
  if(btn){ btn.disabled = true; btn.innerHTML = '<span class="wb-icon mr-1 wb-ic-spin"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span> 登录中…'; }
  try {
    const r = await api("/api/login/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid: _plSid, code, account_id: _plAccountId })
    });
    const { ok, data } = await safeJson(r);
    if(ok){
      $('#plStep2').classList.add('hidden'); $('#plStep3').classList.remove('hidden');
      _plSid = ''; WBPhone.clear('wb_admin_phone');
      // 上游验证结果一并展示：既证明凭证真实可用，也让「积分/账号名」
      // 直接来自腾讯侧的事实（而不是凭证里那个可能被改过的 account 字段）
      const ck = data.check || {};
      $("#plResultIcon").innerHTML = '<span class="wb-icon text-emerald-500"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg></span>';
      $("#plResultMsg").innerHTML = `<div class="font-medium text-emerald-700">${esc(data.message || "登录成功")}</div>
        <div class="text-slate-500 mt-1 text-xs">账号：${esc((data.account && data.account.name) || "-")}${data.uid ? " · UID " + esc(data.uid) : ""}</div>
        ${ck.live_message ? `<div class="text-emerald-600 mt-1 text-xs"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 22V2"/></svg></span>${esc(ck.live_message)}</div>` : ""}
        ${data.invitation && data.invitation.status !== 'disabled' ? `<div class="mt-1 text-xs">${esc(data.invitation.message)}</div>` : ""}`;
      if(_plTimer){ clearInterval(_plTimer); _plTimer = null; }
      loadAccounts();
    } else {
      const d = data.detail;
      const msg = (d && (d.message || d)) || "登录失败";
      toast(esc(String(msg)), 'err');
    }
  } catch(e){
    toast(esc(String(e.message || e)), 'err');
  } finally {
    _plBusy = false;
    if(btn){ btn.disabled = false; btn.textContent = '登录并上传'; }
  }
}

/* 批量上传 */
function openUpload(){
  openModal(`
    <h3 class="font-bold mb-3"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"/></svg></span> 批量上传账号</h3>
    <p class="text-xs text-slate-500 mb-2">粘贴 WorkBuddy 登录态，支持单个 JSON、JSON 数组或每行一个 JSON。也可选择多个凭证文件：新版加密、旧版明文及 .info.bak-时间戳备份均支持，按文件内容验证。</p>
    <p class="text-xs text-amber-600 mb-2"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 22V2"/></svg></span>每条都会调真实上游接口验证是否可用，<b>伪造的凭证会被拒收</b>（因此上传略慢，属正常）。</p>
    <textarea id="upText" class="w-full border rounded-lg p-2 text-xs h-40 font-mono" placeholder='{"auth":{...},"account":{...}}'></textarea>
    <input id="upFile" type="file" multiple class="upload-file-input" aria-label="选择账号凭证或备份文件" />
    <div id="upResult" class="upload-result hidden" role="status" aria-live="polite"></div>
    <div class="upload-footer">
      <button id="upSubmit" type="button" onclick="submitUpload()" class="console-btn primary upload-submit"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m-4-4 4 4 4-4M4 16v4h16v-4"/></svg><span>确认导入</span></button>
      <span class="upload-footer-note">支持多文件，重复账号会更新凭证</span>
      <button type="button" onclick="closeModal()" class="console-btn upload-cancel">取消</button>
    </div>`, "max-w-2xl");
}
async function submitUpload(){
  const submit = $("#upSubmit");
  if(submit?.disabled) return;
  const text = $("#upText").value.trim();
  const files = $("#upFile").files;
  if(!text && !files.length){ toast("内容为空","err"); return; }

  // 去掉 BOM，避免 Windows 生成的 .info 文件解析失败
  function stripBOM(s){ return s.replace(/^\uFEFF/, ''); }
  function tryParse(s){
    s = stripBOM(s).trim();
    if(!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  }

  let allItems = [];

  // 1) 解析文本域：支持 JSON 数组 / 单个 JSON 对象 / JSONL 每行一个对象
  if(text){
    const j = tryParse(text);
    if(j){ allItems = Array.isArray(j) ? j : [j]; }
    else {
      for(const line of text.split("\n")){
        const t = line.trim(); if(!t) continue;
        const o = tryParse(t); if(o) allItems.push(o);
      }
    }
  }

  // 2) 逐个解析文件，避免多文件拼接后格式混乱
  for(const f of files){
    try {
      const s = await f.text();
      const j = tryParse(s);
      if(j){ allItems = allItems.concat(Array.isArray(j) ? j : [j]); }
      else {
        for(const line of s.split("\n")){
          const t = line.trim(); if(!t) continue;
          const o = tryParse(t); if(o) allItems.push(o);
        }
      }
    } catch(e) {
      console.warn("文件读取失败:", f.name, e);
    }
  }

  if(!allItems.length){ toast("未解析出任何账号凭证","err"); return; }
  const body = { items: allItems.map(x => ({ name: [x.account?.nickname, x.name].find(v => typeof v === "string" && v.trim()) || "", auth_json: JSON.stringify(x) })) };
  const result = $("#upResult");
  const showResult = message => { result.textContent = message; result.classList.remove("hidden"); };
  const previous = submit.innerHTML;
  submit.disabled = true;
  submit.setAttribute("aria-busy", "true");
  submit.innerHTML = '<span class="wb-icon wb-ic-spin"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span><span>正在导入…</span>';
  showResult(`正在验证并导入 ${allItems.length} 份凭证，请稍候…`);
  try {
    const r = await api("/api/accounts/batch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const d = await r.json().catch(()=>({}));
    if(r.ok){
      const parts = [`已添加 ${d.added||0} 个账号`];
      if(d.skipped) parts.push(`更新 ${d.skipped} 个已有账号`);
      if(d.errors && d.errors.length) parts.push(`${d.errors.length} 个失败`);
      const message = parts.join("，");
      showResult(message + (d.errors?.length ? "\n" + d.errors.join("\n") : ""));
      toast(message, d.errors?.length ? "err" : "ok");
      loadAccounts();
    } else {
      const detail = d.detail;
      const message = typeof detail === "string" ? detail : (detail?.message || "导入失败，请检查凭证格式");
      showResult(message);
      toast(message, "err");
    }
  } catch(e) {
    showResult("导入请求失败，请检查服务连接后重试。");
    toast("导入请求失败", "err");
  } finally {
    submit.disabled = false;
    submit.removeAttribute("aria-busy");
    submit.innerHTML = previous;
  }
}
/* ==========================================================================
   账号导出
   --------------------------------------------------------------------------
   单账号为官方加密 .info，批量为加密凭证集合或明文备份。
   ========================================================================== */

/** 触发浏览器下载一个文本文件。 */
async function downloadText(filename, text, mime = "application/json") {
  if(window.WBMobile?.saveText) return WBMobile.saveText(filename, text, mime);
  if(window.pywebview?.api?.save_text) {
    const result = await pywebview.api.save_text(filename, text, mime);
    if (!result?.ok) throw new Error(result?.cancelled ? '已取消保存' : result?.error || '文件未保存');
    return;
  }
  if (window.pywebview?.api || document.documentElement.classList.contains('native-window'))
    throw new Error('当前安装包缺少文件保存功能，请更新 EXE');
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 导出时间戳，形如 20260914-1530。 */
function exportStamp() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function openExport() {
  const list = _accData || [];
  const act = list.filter(a => a.status === "active").length;
  openModal(`
    <h3 class="font-bold mb-3"><span class="wb-icon mr-1 text-sky-600"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.226 20.925A2 2 0 0 0 6 22h12a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.127"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="m5 11-3 3"/><path d="m5 17-3-3h10"/></svg></span> 批量导出账号</h3>
    <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 mb-3">
      <span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>
      导出内容包含登录 token，等同账号凭据，请勿外传或提交到代码仓库。
    </div>
    <label class="block text-sm mb-3">导出格式
      <select id="expFormat" class="w-full border rounded-lg px-3 py-2 mt-2">
        ${window.WBMobile ? '' : '<option value="client">官方新版加密凭证集（.jsonl）</option>'}
        <option value="backup">系统明文备份（.jsonl）</option>
      </select>
    </label>
    <label class="flex items-center gap-2 text-sm mb-3">
      <input id="expIncludeDisabled" type="checkbox" class="rounded" />
      包含已禁用的账号
    </label>
    <div class="text-sm text-slate-600 mb-3">
      当前账号 <b>${list.length}</b> 个，其中可用 <b>${act}</b> 个
    </div>
    <div class="flex justify-between gap-2 mt-4">
      <button onclick="copyExport()" class="px-3 py-1.5 rounded-lg border text-sm"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></span>复制到剪贴板</button>
      <div class="flex gap-2">
        <button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">取消</button>
        <button onclick="doExport()" class="px-3 py-1.5 rounded-lg btn-primary"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg></span>下载文件</button>
      </div>
    </div>`);
}

async function _fetchExport() {
  const inc = $("#expIncludeDisabled")?.checked;
  const r = await api("/api/accounts/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [], include_disabled: !!inc, format: $('#expFormat')?.value || 'client' })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { toast("导出失败：" + (d.detail || r.status), "err"); return null; }
  if (!d.items || !d.items.length) { toast("没有可导出的账号", "err"); return null; }
  return d;
}

async function doExport() {
  try {
    const d = await _fetchExport();
    if (!d) return;
    // Each line is independently importable as an account backup.
    const text = d.items.map(x => JSON.stringify(JSON.parse(x))).join("\n");
    await downloadText(`miraihub-accounts-${d.format === 'client' ? 'encrypted' : 'backup'}-${exportStamp()}.jsonl`, text, 'application/x-ndjson');
    closeModal();
    toast(`已导出 ${d.count} 个账号${d.skipped ? `（跳过 ${d.skipped} 个无效凭据）` : ""}`, "ok");
  } catch(error) { toast(error.message || '文件未保存', 'err'); }
}

async function copyExport() {
  const d = await _fetchExport();
  if (!d) return;
  const text = d.items.map(x => JSON.stringify(JSON.parse(x))).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast(`已复制 ${d.count} 个账号到剪贴板`, "ok");
  } catch (e) {
    // 非 HTTPS / 无权限时降级：把内容放进文本框让用户手动复制
    openModal(`
      <h3 class="font-bold mb-3">手动复制（剪贴板不可用）</h3>
      <textarea class="w-full border rounded-lg p-2 text-xs h-60 font-mono">${esc(text)}</textarea>
      <div class="flex justify-end mt-3">
        <button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">关闭</button>
      </div>`);
  }
}

/** 导出单个账号。 */
async function exportAcc(id, name) {
  try {
    const r = await api(`/api/accounts/${id}/export?format=${window.WBMobile ? 'backup' : 'client'}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast("导出失败：" + (d.detail || r.status), "err"); return; }
    const safe = String(name || d.name || d.uid || id).replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    await downloadText(`${safe || "account"}-${id}.info`, JSON.stringify(JSON.parse(d.item), null, 2));
    toast(`已导出账号「${name || d.name || id}」`, "ok");
  } catch(error) { toast(error.message || '文件未保存', 'err'); }
}

function openReauthAccount(id) {
  openModal(`<h3 class="font-bold mb-2">重新登录 · 账号 #${Number(id)}</h3>
    <p class="text-sm mb-4">验证通过后更新原账号凭证，保留排序、Key 绑定与历史记录。模型日限不会因重登而重置。</p>
    <button class="console-btn mb-3" onclick="openPhoneLogin(${Number(id)})">手机号验证码登录</button>
    <label class="block text-sm mb-2">上传凭证或备份文件 <input id="reauthFile" type="file" /></label>
    <p class="text-xs text-slate-500 mb-2">支持新版加密、旧版明文及 .info.bak-时间戳备份；将验证凭证是否仍可用、是否属于原账号。</p>
    <textarea id="reauthJson" class="w-full border rounded-lg p-2 text-xs h-40 font-mono" placeholder="或粘贴最新账号凭证"></textarea>
    <div class="flex gap-2 mt-3"><button id="reauthSubmit" class="console-btn" onclick="submitReauthAccount(${Number(id)})">验证并更新原账号</button><button class="console-btn quiet" onclick="closeModal()">取消</button></div>`);
  $('#reauthFile').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) { toast('凭证文件过大', 'err'); return; }
    $('#reauthJson').value = await file.text();
  };
}
async function submitReauthAccount(id) {
  const button = $('#reauthSubmit');
  const auth_json = $('#reauthJson').value.trim();
  if (!auth_json) { toast('请上传或粘贴最新凭证', 'err'); return; }
  button.disabled = true;
  try {
    const {ok, data} = await safeJson(await api('/api/accounts/' + Number(id) + '/reauth', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({auth_json})}));
    if (!ok) { toast(typeof data.detail === 'string' ? data.detail : data.detail?.message || '验证失败，原凭证未修改', 'err'); return; }
    closeModal(); toast(data.message); loadAccounts();
  } catch (_) { toast('更新失败，请检查连接后重试', 'err'); }
  finally { button.disabled = false; }
}

function openAddAccount(){
  openModal(`
    <h3 class="font-bold mb-3"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg></span> 添加单个账号</h3>
    <input id="accName" class="w-full border rounded-lg px-3 py-2 mb-2 text-sm" placeholder="名称（可选）" />
    <textarea id="accJson" class="w-full border rounded-lg p-2 text-xs h-40 font-mono" placeholder='粘贴单个 .info JSON'></textarea>
    <div class="flex justify-end gap-2 mt-4">
      <button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">取消</button>
      <button onclick="submitAddAccount()" class="px-3 py-1.5 rounded-lg btn-primary">添加</button>
    </div>`);
}
async function submitAddAccount(){
  const auth_json = $("#accJson").value.trim();
  if(!auth_json){ toast("请粘贴 JSON","err"); return; }
  const r = await api("/api/accounts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:$("#accName").value||"",auth_json})});
  const d = await r.json().catch(()=>({}));
  closeModal();
  if(!r.ok){ toast("添加失败", "err"); return; }
  // 按 uid 去重：已存在时不再新增记录，并明确告诉用户
  if(d.duplicated){ toast(d.message || "该账号已存在，未重复添加", "err"); return; }
  toast("已添加", "ok"); loadAccounts();
}

