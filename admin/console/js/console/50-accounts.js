/* ==========================================================================
   多平台账号池：Trae（国内版 / 国际版）
   --------------------------------------------------------------------------
   为什么单独一段渲染而不是复用 accRow：两个平台的「账号」字段集不同 ——
   WorkBuddy 有积分包到期日、成长任务、猫猫旅行；Trae 有区域、设备指纹、
   token 到期。硬套同一张表会让两种号都显示一半空列。

   但**底层数据是同源的**：都来自 accounts 表，都进 usage_logs，
   都受同一个 Key 配额约束 —— 所以列表之外（用量/日志/积分/K e）零改动。
   ========================================================================== */
let _traeState = { items: [], summary: null, loaded: false };

function traeRealmLabel(realm) {
  return ({ cn: "国内版", intl: "国际版" })[realm] || realm || "-";
}

function traeRow(a) {
  const cooling = a.cool_until && new Date(a.cool_until).getTime() > Date.now();
  const status = a.status === "active"
    ? (cooling ? `<span class="badge badge-warn">冷却中</span>` : `<span class="badge badge-ok">已启用</span>`)
    : `<span class="badge badge-danger">已禁用</span>`;
  const expires = a.expires_at
    ? fmtTime(new Date(a.expires_at * 1000).toISOString().slice(0, 19))
    : "—";
  const unit = a.balance_unit === "percent" ? "%" : "";
  return `<tr>
    <td class="c-name">
      <div class="nm">
        <b data-tooltip="${esc(a.name || "未命名")}">${esc(a.name || "未命名")}</b>
        <span class="c-uid" data-tooltip="Trae 用户 ID" data-tooltip-description="${esc(a.uid || "（该账号未提供 UID）")}">${esc(a.uid || "-")}</span>
        <small style="color:var(--fg-muted)">${esc(traeRealmLabel(a.realm))}${a.region ? " · " + esc(a.region) : ""}${a.device_id ? " · 设备已绑定" : ""}</small>
        ${a.last_err_msg ? `<small style="color:var(--danger)" data-tooltip="最近上游错误" data-tooltip-description="${esc(a.last_err_msg)}">${esc(a.last_err_msg.slice(0, 42))}</small>` : ""}
      </div>
    </td>
    <td class="col-status" data-label="状态">${status}</td>
    <td class="tnum text-right" data-label="额度总量" style="color:var(--fg-muted)">${fmtCredit(a.balance_total)}${unit}</td>
    <td class="tnum text-right font-medium" data-label="剩余" style="color:${a.balance_remain > 0 ? "var(--ok,#33587F)" : "var(--danger)"}">${fmtCredit(a.balance_remain)}${unit}</td>
    <td data-label="凭证到期">${esc(expires)}</td>
    <td class="c-ops" data-label="操作">${[
      [`traeRefresh(${a.id})`, "fa-rotate", "text-indigo-600", "刷新 token 与额度"],
      [`traeTest(${a.id})`, "fa-heart-pulse", "text-emerald-600", "连通性检查：token / 模型 / 真实对话 / 额度"],
      [`traeClearCooling(${a.id})`, "fa-snowflake", "text-sky-600", "清除冷却与熔断"],
      [`traeToggle(${a.id},'${a.status === "active" ? "disabled" : "active"}')`, "fa-power-off", "text-slate-500", "启用/禁用"],
      [`traeDelete(${a.id})`, "fa-trash", "text-red-500", "删除"],
    ].map(([fn, icon, color, title]) =>
      `<button onclick="${fn}" class="${color}" data-tooltip="${title}" aria-label="${title}">${consoleIcon(icon)}</button>`).join("")}</td>
  </tr>`;
}

async function loadTraeAccounts(platform) {
  // 区域：**先用 spec.realm**，再用 platform.realm。
  //
  // `platform-switch.js` 的 `current()` 返回的是「用户手动选中的区域」
  // （`state.realm`），而 trae-cn / trae-intl 是**单区平台** —— 它们的区域
  // 固定在 `spec.realm` 上，`state.realm` 永远是空串。
  // 只用 `platform.realm` 的后果：请求不带 `realm=`，后端返回**全部 Trae 账号**
  // （国内 1 + 国际 2 = 3 个），两个平台看起来完全一样 —— 这就是「合并混了」。
  const spec = window.WBPlatform ? window.WBPlatform.spec() : null;
  const realm = (spec && spec.realm) || (platform && platform.realm) || "";
  const qs = realm ? `?realm=${encodeURIComponent(realm)}` : "";
  const r = await api("/api/trae/accounts" + qs);
  if (!r.ok) return;
  const d = await r.json();
  _traeState.items = d.items || [];
  _traeState.summary = d.summary || {};
  _traeState.loaded = true;
  const s = _traeState.summary;
  const unit = (_traeState.items[0] || {}).balance_unit === "percent" ? "%" : "";
  $("#overview").innerHTML = `
    ${statCard("账号总数", s.total ?? 0, { icon: "fa-users", iconColor: "text-slate-400",
        sub: `启用 ${s.active ?? 0} · 冷却 ${s.cooling ?? 0}` + (s.disabled ? ` · 已禁用 ${s.disabled}` : "") })}
    ${statCard("可用额度", fmtCredit(s.balance_remain) + unit, { icon: "fa-wallet", iconColor: "text-slate-400",
        tone: "brand", sub: `额度口径：${(_traeState.items[0] || {}).balance_unit === "percent" ? "请求次数额度水位" : "Trae 积分"}` })}
    ${statCard("额度总量", fmtCredit(s.balance_total) + unit, { icon: "fa-chart-simple", iconColor: "text-slate-400",
        sub: `启用账号合计` })}
    ${statCard("当前区域", traeRealmLabel(realm) || "全部", { icon: "fa-globe", iconColor: "text-slate-400",
        sub: "切换上方区域可查看另一区账号" })}`;

  const headCount = $("#accHeadCount");
  if (headCount) headCount.textContent = s.total ?? _traeState.items.length;
  const headBreak = $("#accHeadBreak");
  if (headBreak) headBreak.textContent = `（启用 ${s.active ?? 0}）`;

  // 表头/脚注随平台切换：Trae 没有「积分到期」概念，那一列是凭证到期。
  const head = $("#accTableHead");
  if (head) {
    head.innerHTML = `<th>名称</th><th>状态</th>
      <th class="text-right">额度总量</th><th class="text-right">剩余</th>
      <th>凭证到期</th><th class="text-right">操作</th>`;
  }
  const foot = $("#accFootNote");
  if (foot) foot.textContent = "额度统计仅包含已启用账号";
  const footHint = $("#accFootHint");
  if (footHint) footHint.textContent = "Trae 额度来自上游权益接口，可点「刷新额度」同步";

  // 筛选器计数：**必须与 WorkBuddy 路径一致**。
  //
  // 原来这条路径完全不碰 `_accData` / 三个计数元素，于是切到 Trae 后
  // 筛选条显示「全部 0 / 已启用 0 / 已禁用 0」，而表格里明明有号。
  // 用户感知就是「数据丢了，刷新一下才回来」。
  // Trae 的账号对象同样有 `status` 字段（active / disabled），
  // 所以直接复用同一套计数逻辑，不需要新概念。
  _accData = _traeState.items || [];
  const filterAll = $("#filterAllCount");
  if (filterAll) filterAll.textContent = _accData.length;
  const filterActive = $("#filterActiveCount");
  if (filterActive) {
    filterActive.textContent = _accData.filter(a => a.status === "active").length;
  }
  const filterDisabled = $("#filterDisabledCount");
  if (filterDisabled) {
    filterDisabled.textContent = _accData.filter(a => a.status === "disabled").length;
  }

  const body = $("#accBody");
  if (body) {
    body.innerHTML = _traeState.items.map(traeRow).join("") ||
      `<tr><td colspan="6"><div class="account-empty"><strong>还没有 Trae 账号</strong>用上方「导入本机账号」从本机 Trae 客户端读取，或点「扫描本机 Trae」先看看发现了什么。</div></td></tr>`;
  }
  const pager = $("#accPager");
  if (pager) pager.innerHTML = "";
  // 切到 Trae 平台时该平台没有「积分到期」概念，角标隐藏。
  setSideDot("#sideExpiringDot", 0);
}

/**
 * Qoder 账号池。
 *
 * 为什么不复用 `loadTraeAccounts` / 通用 `/api/accounts`：
 * 三个平台的账号字段集不同 —— Trae 有「区域 / 凭证到期」，
 * Qoder 有「套餐 / 资源包」，混用会显示错列。
 */
async function loadQoderAccounts(platform) {
  const spec = (window.WBPlatform && window.WBPlatform.spec()) || {};
  const realm = (spec && spec.realm) || (platform && platform.realm) || "";
  const qs = realm ? `?realm=${encodeURIComponent(realm)}` : "";
  const r = await api("/api/qoder/accounts" + qs);
  if (!r.ok) {
    const body = $("#accBody");
    if (body) {
      body.innerHTML = `<tr><td colspan="6"><div class="account-empty">
        <strong>读取 Qoder 账号失败</strong>HTTP ${r.status}</div></td></tr>`;
    }
    return;
  }
  const d = await r.json();
  const items = d.items || [];
  const s = d.summary || {};

  // 状态变量与其它平台保持一致，筛选器才能正确计数
  _accData = items;

  $("#overview").innerHTML = `
    ${statCard("账号总数", s.total ?? 0, { icon: "fa-users", iconColor: "text-slate-400",
        sub: `启用 ${s.active ?? 0}` + (s.disabled ? ` · 已禁用 ${s.disabled}` : "") })}
    ${statCard("套餐额度", fmtCredit(s.balance_remain), { icon: "fa-wallet", iconColor: "text-slate-400",
        tone: "brand", sub: `总额度 ${fmtCredit(s.balance_total)}` })}
    ${statCard("资源包", fmtCredit(s.addon_remain), { icon: "fa-gift", iconColor: "text-slate-400",
        tone: (s.addon_remain || 0) > 0 ? "brand" : "",
        sub: "签到积分落在这里" })}
    ${statCard("当前区域", traeRealmLabel(realm) || "中国版", { icon: "fa-globe",
        iconColor: "text-slate-400", sub: "COSY 签名鉴权" })}`;

  const headCount = $("#accHeadCount");
  if (headCount) headCount.textContent = s.total ?? items.length;
  const headBreak = $("#accHeadBreak");
  if (headBreak) headBreak.textContent = `（启用 ${s.active ?? 0}）`;

  const head = $("#accTableHead");
  if (head) {
    head.innerHTML = `<th>名称</th><th>状态</th>
      <th class="text-right">套餐额度</th><th class="text-right">资源包</th>
      <th>套餐</th><th class="text-right">操作</th>`;
  }
  const foot = $("#accFootNote");
  if (foot) foot.textContent = "额度来自上游 /api/v2/quota/usage（套餐 + 资源包两个桶）";
  const footHint = $("#accFootHint");
  if (footHint) footHint.textContent = "Qoder 凭证加密在客户端原生层，额度由网关按 60 秒 TTL 同步";

  // 筛选器计数（与 WorkBuddy 路径一致，缺了会显示「全部 0」）
  const filterAll = $("#filterAllCount");
  if (filterAll) filterAll.textContent = _accData.length;
  const filterActive = $("#filterActiveCount");
  if (filterActive) {
    filterActive.textContent = _accData.filter(a => a.status === "active").length;
  }
  const filterDisabled = $("#filterDisabledCount");
  if (filterDisabled) {
    filterDisabled.textContent = _accData.filter(a => a.status === "disabled").length;
  }

  const body = $("#accBody");
  if (body) {
    body.innerHTML = items.map(qoderRow).join("") ||
      `<tr><td colspan="6"><div class="account-empty">
        <strong>还没有 Qoder 账号</strong>
        用「导入 PAT」或设备授权添加。</div></td></tr>`;
  }
  const pager = $("#accPager");
  if (pager) pager.innerHTML = "";
  setSideDot("#sideExpiringDot", 0);
}

function qoderRow(a) {
  const ok = a.status === "active";
  const status = ok
    ? '<span class="badge badge-ok">已启用</span>'
    : '<span class="badge badge-warn">已禁用</span>';
  const plan = a.plan ? esc(String(a.plan).replace(/_/g, " ")) : "—";
  return `<tr>
    <td class="text-xs" data-tooltip="${esc(a.name || "")}">${esc((a.name || "").slice(0, 16))}</td>
    <td class="col-status" data-label="状态">${status}</td>
    <td class="tnum text-right" data-label="套餐额度"
        style="color:var(--fg-muted)">${fmtCredit(a.balance_remain)} / ${fmtCredit(a.balance_total)}</td>
    <td class="tnum text-right font-medium" data-label="资源包"
        style="color:${(a.addon_remain || 0) > 0 ? "var(--ok)" : "var(--fg-subtle)"}">${fmtCredit(a.addon_remain)}</td>
    <td class="text-xs" data-label="套餐">${plan}</td>
    <td class="c-ops" data-label="操作">${[
      [`qoderRefresh(${a.id})`, "fa-rotate", "text-indigo-600", "刷新额度"],
      [`qoderTest(${a.id})`, "fa-heart-pulse", "text-emerald-600", "连通性检查"],
    ].map(([fn, icon, color, title]) =>
      `<button onclick="${fn}" class="${color}" data-tooltip="${title}" aria-label="${title}"><i class="fa ${icon}"></i></button>`
    ).join("")}</td>
  </tr>`;
}

/**
 * Loomy 账号池。
 *
 * 与其它平台的关键差异：**计量制** —— 没有「剩余额度」，
 * 只有「累计消耗 points」。所以列是「模型数 / 累计消耗」，
 * 不是「总额度 / 剩余」。伪造一个「剩余」会误导用户。
 */
async function loadLoomyAccounts(platform) {
  const spec = (window.WBPlatform && window.WBPlatform.spec()) || {};
  const realm = (spec && spec.realm) || (platform && platform.realm) || "";
  const qs = realm ? `?realm=${encodeURIComponent(realm)}` : "";
  const r = await api("/api/loomy/accounts" + qs);
  if (!r.ok) {
    const body = $("#accBody");
    if (body) {
      body.innerHTML = `<tr><td colspan="6"><div class="account-empty">
        <strong>读取 Loomy 账号失败</strong>HTTP ${r.status}</div></td></tr>`;
    }
    return;
  }
  const d = await r.json();
  const items = d.items || [];
  const s = d.summary || {};
  _accData = items;

  const models = items.reduce((max, i) => Math.max(max, i.models || 0), 0);
  const available = items.reduce((sum, i) => sum + (i.balance_remain || 0), 0);
  const daily = items.reduce((sum, i) => sum + (i.daily_balance || 0), 0);

  $("#overview").innerHTML = `
    ${statCard("账号总数", s.total ?? 0, { icon: "fa-users", iconColor: "text-slate-400",
        sub: `启用 ${s.active ?? 0}` + (s.disabled ? ` · 已禁用 ${s.disabled}` : "") })}
    ${statCard("可用积分", available, { icon: "fa-wallet", iconColor: "text-slate-400",
        tone: "brand", sub: `其中当日额度 ${daily}` })}
    ${statCard("可用模型", models, { icon: "fa-cube", iconColor: "text-slate-400",
        sub: "已过滤图像模型" })}
    ${statCard("鉴权方式", "会话鉴权", { icon: "fa-key", iconColor: "text-slate-400",
        sub: "双 token 头 + traceparent" })}`;

  const headCount = $("#accHeadCount");
  if (headCount) headCount.textContent = s.total ?? items.length;
  const headBreak = $("#accHeadBreak");
  if (headBreak) headBreak.textContent = `（启用 ${s.active ?? 0}）`;

  const head = $("#accTableHead");
  if (head) {
    head.innerHTML = `<th>名称</th><th>状态</th>
      <th class="text-right">可用积分</th><th class="text-right">当日额度</th>
      <th class="text-right">模型数</th><th class="text-right">操作</th>`;
  }
  const foot = $("#accFootNote");
  if (foot) foot.textContent = "可用积分 = 基础余额 + 当日额度（当日部分每日重置）";
  const footHint = $("#accFootHint");
  if (footHint) footHint.textContent = "凭证为客户端明文 auth-session.json，可重复扫描同步";

  const filterAll = $("#filterAllCount");
  if (filterAll) filterAll.textContent = _accData.length;
  const filterActive = $("#filterActiveCount");
  if (filterActive) {
    filterActive.textContent = _accData.filter(a => a.status === "active").length;
  }
  const filterDisabled = $("#filterDisabledCount");
  if (filterDisabled) {
    filterDisabled.textContent = _accData.filter(a => a.status === "disabled").length;
  }

  const body = $("#accBody");
  if (body) {
    body.innerHTML = items.map(loomyRow).join("") ||
      `<tr><td colspan="6"><div class="account-empty">
        <strong>还没有 Loomy 账号</strong>点上方「扫描本机」自动导入。</div></td></tr>`;
  }
  const pager = $("#accPager");
  if (pager) pager.innerHTML = "";
  setSideDot("#sideExpiringDot", 0);
}

function loomyRow(a) {
  const ok = a.status === "active";
  const status = ok
    ? '<span class="badge badge-ok">已启用</span>'
    : '<span class="badge badge-warn">已禁用</span>';
  return `<tr>
    <td class="text-xs" data-tooltip="${esc(a.name || "")}${a.phone ? " · " + esc(a.phone) : ""}">${esc((a.name || "").slice(0, 16))}</td>
    <td class="col-status" data-label="状态">${status}</td>
    <td class="tnum text-right font-medium" data-label="可用积分"
        style="color:var(--brand)">${fmtCredit(a.balance_remain)}</td>
    <td class="tnum text-right" data-label="当日额度"
        style="color:var(--fg-muted)">${fmtCredit(a.daily_balance)}</td>
    <td class="tnum text-right" data-label="模型数">${a.models || 0}</td>
    <td class="c-ops" data-label="操作">${[
      [`loomyRefresh(${a.id})`, "fa-rotate", "text-indigo-600", "探活并刷新"],
      [`loomyTest(${a.id})`, "fa-heart-pulse", "text-emerald-600", "连通性检查"],
    ].map(([fn, icon, color, title]) =>
      `<button onclick="${fn}" class="${color}" data-tooltip="${title}" aria-label="${title}"><i class="fa ${icon}"></i></button>`
    ).join("")}</td>
  </tr>`;
}

async function loomyRefresh(id) {
  const r = await api(`/api/loomy/accounts/${id}/refresh`, { method: "POST" });
  const { ok, data } = await safeJson(r);
  if (ok) {
    toast(`已刷新：${(data.quota || {}).models || 0} 个模型可用`);
    loadAccounts();
  } else {
    toast((data && data.detail) || "刷新失败", "err");
  }
}

async function loomyTest(id) {
  toast("正在检查（session → 模型）…");
  const r = await api(`/api/loomy/accounts/${id}/test`, { method: "POST" });
  const { ok, data } = await safeJson(r);
  if (!ok) { toast("检查失败", "err"); return; }
  const stages = data.stages || {};
  const lines = Object.keys(stages).map(k =>
    `${k}: ${stages[k].ok ? "✓" : "✗"} ${stages[k].detail || ""}`);
  openModal(`<h3 class="font-semibold text-lg mb-3">连通性检查 · ${esc(data.account || "")}</h3>
    <pre class="text-xs" style="background:var(--surface-2);padding:12px;border-radius:8px">${esc(lines.join("\n"))}</pre>`);
}

async function qoderRefresh(id) {
  const r = await api(`/api/qoder/accounts/${id}/refresh`, { method: "POST" });
  const { ok, data } = await safeJson(r);
  if (ok) {
    toast(`已刷新：${fmtCredit(data.balance_remain)} / ${fmtCredit(data.balance_total)}`);
    loadAccounts();
  } else {
    toast((data && data.detail) || "刷新失败", "err");
  }
}

async function qoderTest(id) {
  toast("正在检查（凭证 → 资料 → 模型 → 额度）…");
  const r = await api(`/api/qoder/accounts/${id}/test`, { method: "POST" });
  const { ok, data } = await safeJson(r);
  if (!ok) { toast("检查失败", "err"); return; }
  const stages = data.stages || {};
  const lines = Object.keys(stages).map(k =>
    `${k}: ${stages[k].ok ? "✓" : "✗"} ${stages[k].detail || ""}`);
  openModal(`<h3 class="font-semibold text-lg mb-3">连通性检查 · ${esc(data.account || "")}</h3>
    <pre class="text-xs" style="background:var(--surface-2);padding:12px;border-radius:8px">${esc(lines.join("\n"))}</pre>`);
}

async function traeRefresh(id) {
  const r = await api(`/api/trae/accounts/${id}/refresh?force=true`, { method: "POST" });
  const { ok, data } = await safeJson(r);
  if (ok) {
    toast(`已刷新：剩余 ${fmtCredit(data.balance_remain)} / ${fmtCredit(data.balance_total)}`);
    loadAccounts();
  } else {
    toast((data.detail && data.detail.message) || data.detail || "刷新失败", "err");
  }
}

async function traeTest(id) {
  toast("正在检查（token → 模型 → 真实对话 → 额度）…");
  const r = await api(`/api/trae/accounts/${id}/test`, { method: "POST" });
  const { ok, data } = await safeJson(r);
  if (!ok) { toast("检查失败", "err"); return; }
  const stage = data.stages || {};
  const lines = ["token", "models", "conversation", "quota"].map(key => {
    const item = stage[key] || {};
    const mark = item.ok ? "✅" : "❌";
    const detail = key === "models" ? (item.count ?? 0) + " 个模型"
      : key === "conversation" ? (item.ok ? `「${esc((item.text || "").slice(0, 30))}」` : (item.message || "无可用模型"))
        : key === "quota" ? `${fmtCredit(item.remain)} / ${fmtCredit(item.total)}`
          : item.ok ? "有效" : (item.message || "不可用");
    return `${mark} ${key}：${detail}`;
  });
  openModal(`<h3>Trae 账号检查 · ${esc(data.realm || "")}</h3>
    <p class="limit-note">四段链路依次验证，任一段失败即停在该段，便于定位是凭证、模型名还是额度问题。</p>
    <div style="line-height:2">${lines.join("<br>")}</div>`, "max-w-2xl");
  if (data.ok) loadAccounts();
}

async function traeClearCooling(id) {
  const r = await api(`/api/trae/accounts/${id}/cooling/clear`, { method: "POST" });
  if (r.ok) { toast("冷却与熔断已清空"); loadAccounts(); }
  else toast("操作失败", "err");
}

async function traeToggle(id, status) {
  const r = await api(`/api/trae/accounts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (r.ok) { toast(status === "active" ? "已启用" : "已禁用"); loadAccounts(); }
  else toast("操作失败", "err");
}

async function traeDelete(id) {
  const yes = await uiConfirm({ title: "删除 Trae 账号", message: "删除后需要重新从本机导入，确定继续？" });
  if (!yes) return;
  const r = await api(`/api/trae/accounts/${id}`, { method: "DELETE" });
  if (r.ok) { toast("已删除"); loadAccounts(); }
  else toast("删除失败", "err");
}

/* 平台切换模块派发的动作（只由 Trae 平台产生：扫描 / 导入 / 刷新额度）。
 *
 * ⚠️ 不能再判断 `platform === "trae"`：平台已拆成 `trae-cn` / `trae-intl`，
 * 旧写法永远为 false，于是这三个按钮点了**一点反应都没有**
 * （事件发出了、处理器直接 return，连报错都没有 —— 最难查的一类）。
 * 这里按**落库平台**判断，与 loadPlatformOverview / loadAccounts 同一套口径。
 *
 * WorkBuddy 不经过这里：它的扫描/导入入口在账号池页面，不重复注册 ——
 * 否则移动端会把桌面专属入口带出去（见 platform-switch.js 的 actionsFor）。
 */
/* 平台动作分发器。
 *
 * ## 改了什么（重要）
 *
 * 原来写死「只有 trae 有动作」：
 *
 *     if (storage !== "trae") return;              // Qoder / Loomy 被丢弃
 *     if (action === "scan") return traeScanLocal();
 *
 * 后果：新增平台点「扫描本机」一点反应都没有 ——
 * 事件发出了、处理器直接 return，连报错都没有（最难查的一类）。
 *
 * 现在按 `storage_platform` 分派到各平台自己的接口。
 * 新增平台时只要实现 /api/<storage>/scan-local，这里不用改。
 */
document.addEventListener("wb-platform-action", async event => {
  const { action, platform, spec } = event.detail || {};
  const storage = ((spec && spec.storage_platform) || platform || "").toLowerCase();

  // 各平台通用动作：扫描 / 导入 / 刷新额度
  if (action === "scan") {
    if (storage === "trae") return traeScanLocal();
    return platformScanLocal(spec, storage);
  }
  if (action === "import") {
    if (storage === "trae") return traeImportLocal();
    return platformImportLocal(spec, storage);
  }
  if (action === "refresh-quota") {
    if (storage === "trae") return traeRefreshAll();
    return platformRefreshAll(spec, storage);
  }

  // 签到：各平台自己的接口。
  // Trae 也没有独立的签到函数（它的签到走定时任务），
  // 所以统一走 platformCheckin —— 按 storage_platform 推接口前缀。
  if (action === "checkin") {
    return platformCheckin(spec, storage);
  }

  // 授权登录（设备流）：Qoder 的登录态加密在原生层，读不出文件，
  // 只能走设备授权 —— 用户点一次链接就自动拿到可续期的 token。
  if (action === "begin-auth") {
    return platformBeginAuth(spec, storage);
  }

  // 「用量明细」：Trae 有网页 cookie 专用实现，其它平台走通用账号用量表
  if (action === "usage") {
    if (storage === "trae") return traeUsageDetail(spec);
    return platformUsageDetail(spec, storage);
  }

  // Trae 专属动作
  if (storage !== "trae") return;
  if (action === "web-cookie") return traeWebCookie(spec);
});

/**
 * 用量明细。
 *
 * ⚠️ 上游接口只认**网页会话 cookie**：用 IDE token 调恒返回 total=0
 * （实测 6 个时间窗 × 8 组参数；传错参数会报 9004，证明鉴权是通的，
 * 只是这个接口不返数据）。所以结果必须区分三种情况：
 *
 *   缺 Cookie  -> 明确提示去补，不要显示「无记录」
 *   有 Cookie  -> 正常展示会话列表
 *   出错       -> 显示 errors
 *
 * 另外始终展示「本网关记录」作为对照 —— 那是经过本系统的请求，
 * 与上游账单口径不同，但排障更有用。
 */
async function traeUsageDetail(spec) {
  const realm = (spec && spec.realm) || "";
  openModal('<p id="usageLoading">正在读取用量明细…</p>', "max-w-4xl");
  const qs = new URLSearchParams({ days: "30" });
  if (realm) qs.set("realm", realm);
  const r = await api("/api/trae/usage?" + qs.toString());
  const { ok, data } = await safeJson(r);
  if (!ok) {
    openModal(`<h3 class="font-semibold text-lg mb-2">用量明细</h3>
      <p style="color:var(--danger)">读取失败：${esc((data && data.detail) || r.status)}</p>`);
    return;
  }

  const sessions = data.sessions || [];
  const local = data.local || [];
  const errors = data.errors || [];
  const missing = data.accounts_missing_cookie || [];

  let body = "";
  if (data.need_web_cookie) {
    // 关键：这不是「没有用量」，是「查不到」——必须说清区别
    body = `<div class="limit-note" style="border-color:var(--warn)">
      <p><b>需要网页会话 Cookie</b></p>
      <p>${esc(data.hint || "")}</p>
      <p style="color:var(--fg-muted)">受影响账号：${missing.map(id => "#" + id).join("、")}</p>
      <button type="button" class="console-btn primary mt-2"
              onclick="traeWebCookie(window.WBPlatform.spec())">去填写 Cookie</button>
    </div>`;
  } else if (sessions.length) {
    body = `<table class="tbl"><thead><tr>
        <th>账号</th><th>时间</th><th>模型</th><th class="text-right">消耗</th>
      </tr></thead><tbody>${sessions.map(item => `<tr>
        <td class="text-xs">${esc(item.account || "")}</td>
        <td class="text-xs">${esc(fmtTime(item.session_start_time || item.start_time || ""))}</td>
        <td class="text-xs font-mono">${esc(item.model || item.model_name || "—")}</td>
        <td class="text-xs text-right tnum">${esc(String(item.cost ?? item.amount ?? item.usage ?? "—"))}</td>
      </tr>`).join("")}</tbody></table>`;
  } else {
    body = `<p class="sentinel-empty">上游近 30 天没有用量记录（已成功查询 ${data.accounts_queried || 0} 个账号）</p>`;
  }

  // 本网关记录：**始终展示**，即使上游查不到。
  //
  // 这是经过本系统的真实请求（token 数 / 请求数），不依赖上游凭证，
  // 所以永远有数据。与上游账单口径不同（上游按 token 折成美元/积分），
  // 但排障时更直接 —— 「到底有没有人用过这个平台」看这里。
  const localItems = (local && local.items) || [];
  const localTotals = (local && local.totals) || {};
  const localBlock = localItems.length
    ? `<h4 class="font-semibold text-sm mt-4 mb-2">
         本网关记录（近 ${esc(String(local.days || 30))} 天）</h4>
       <p class="text-[11px] mb-2" style="color:var(--fg-subtle)">
         经过本系统的实际请求，与上游账单口径不同（上游按 token 折成美元/积分），
         但不受上游凭证影响，永远可查。</p>
       <div class="flex gap-4 text-xs mb-2">
         <span>请求 <b>${esc(String(localTotals.requests || 0))}</b> 次</span>
         <span>Token <b>${esc(Number(localTotals.total_tokens || 0).toLocaleString("zh-CN"))}</b></span>
         ${localTotals.credits ? `<span>积分 <b>${esc(String(localTotals.credits))}</b></span>` : ""}
       </div>
       <table class="tbl"><thead><tr>
         <th>模型</th><th class="text-right">请求</th>
         <th class="text-right">输入</th><th class="text-right">输出</th>
         <th class="text-right">合计</th>
       </tr></thead><tbody>${localItems.map(i => `<tr>
         <td class="text-xs font-mono">${esc(i.model || "—")}</td>
         <td class="text-xs text-right tnum">${esc(String(i.requests || 0))}</td>
         <td class="text-xs text-right tnum">${esc(Number(i.prompt_tokens || 0).toLocaleString("zh-CN"))}</td>
         <td class="text-xs text-right tnum">${esc(Number(i.completion_tokens || 0).toLocaleString("zh-CN"))}</td>
         <td class="text-xs text-right tnum">${esc(Number(i.total_tokens || 0).toLocaleString("zh-CN"))}</td>
       </tr>`).join("")}</tbody></table>`
    : `<p class="text-xs mt-4" style="color:var(--fg-subtle)">
         本网关近 ${esc(String((local && local.days) || 30))} 天没有该平台的请求记录。</p>`;

  const errBlock = errors.length
    ? `<div class="limit-note mt-3"><p><b>查询失败</b></p>${errors.map(e =>
        `<p>#${esc(String(e.account_id))} ${esc(e.account || "")}：${esc(e.error || "")}</p>`).join("")}</div>`
    : "";

  openModal(`<h3 class="font-semibold text-lg mb-3">
      用量明细 · ${esc((spec && spec.label) || realm || "Trae")}
    </h3>
    <p class="text-xs mb-3" style="color:var(--fg-subtle)">
      数据来源：${data.source === "upstream" ? "上游权益接口" : "本地记录"} ·
      近 ${data.days} 天
    </p>
    ${body}${localBlock}${errBlock}`, "max-w-4xl");
}

/** 填写网页会话 cookie（用于查询上游用量明细）。 */
async function traeWebCookie(spec) {
  const realm = (spec && spec.realm) || "";
  const realmLabel = realm === "intl" ? "国际版" : realm === "cn" ? "国内版" : "全部";
  openModal(`<h3 class="font-semibold text-lg mb-2">填写网页 Cookie · ${esc(realmLabel)}</h3>
    <p class="text-xs mb-3" style="color:var(--fg-subtle)">
      上游用量明细只认浏览器会话。步骤：登录
      <code>${realm === "intl" ? "www.trae.ai" : "www.trae.cn"}</code> →
      F12 打开开发者工具 → Network → 点任意请求 → 复制 <code>Cookie</code> 请求头整行。
    </p>
    <textarea id="webCookieInput" rows="6" class="w-full font-mono text-[11px]"
      style="border:1px solid var(--border);border-radius:8px;padding:10px;background:var(--surface)"
      placeholder="sid_tt=...; sessionid=...; X-Cloudide-Session=..."></textarea>
    <p class="text-[11px] mt-2" style="color:var(--fg-subtle)">
      只保存在本地数据库，仅用于读取用量，不会用于其他请求。
    </p>
    <div class="flex gap-2 mt-3">
      <button type="button" class="console-btn primary" onclick="saveTraeWebCookie(${JSON.stringify(realm)})">保存</button>
      <button type="button" class="console-btn quiet" onclick="closeModal()">取消</button>
    </div>`, "max-w-2xl");
}

async function saveTraeWebCookie(realm) {
  const input = $("#webCookieInput");
  const cookie = (input && input.value || "").trim();
  if (!cookie) { toast("请先粘贴 Cookie", "err"); return; }
  const r = await api("/api/trae/web-cookie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie }),
  });
  const { ok, data } = await safeJson(r);
  if (!ok) { toast((data && data.detail) || "保存失败", "err"); return; }
  toast(`已保存到 ${(data.updated || []).length} 个账号`);
  closeModal();
}

/**
 * 各平台的「扫描本机」。
 *
 * 之前所有平台都走同一个扫描实现（`/api/accounts/scan-local`），
 * 那是 WorkBuddy 的实现，会去读
 * `%LOCALAPPDATA%/CodeBuddyExtension/Data/Public/auth`。
 * 在 Loomy 平台点扫描，扫的却是 CodeBuddy 的目录 —— 实测发现的。
 *
 * 这里按 storage_platform 路由到各平台自己的接口。
 */
/**
 * 各平台的「签到」。
 *
 * 差异说明：
 *   Loomy  -> POST /points/first-login，**幂等**（当天已领导致
 *             alreadyProcessed: true，不是错误），每日赠送 5000 积分
 *   Qoder  -> 领取权益（campaigns 里可领的那些）
 *
 * 结果必须区分「新领取」和「今日已领」，否则用户会以为没生效。
 */
/**
 * 设备授权登录（Qoder 用）。
 *
 * 流程：start -> 展示链接 -> 每 3 秒 poll -> 拿到凭证即 claim 落账号。
 *
 * 为什么前端轮询而不是后端阻塞：后端阻塞一个请求 5 分钟会被
 * 网关/浏览器超时切断；前端每 3 秒拉一次，用户授权完下一次就能拿到。
 */
/** 官方登录页（Trae 没有设备授权端点时的「授权登录」入口）。 */
const PLATFORM_LOGIN_URL = {
  trae: "https://www.trae.ai/",
  "trae-cn": "https://www.trae.cn/",
  "trae-intl": "https://www.trae.ai/",
};

// ===== 平台授权形态（由各平台 /meta 的 auth_mode 声明）=====
//
// 三个平台的上游能力不一样，前端不该硬编码「有没有授权按钮」：
//   callback            Trae  —— 浏览器回调，服务器部署要配公网基址
//   device-poll         Qoder —— 服务端轮询，任意设备授权都行
//   local-session-only  Loomy —— 上游没有授权接口，只能扫本机
//
// 缓存按 storage_platform 存，页面生命周期内只需查一次。
const _PLATFORM_META_CACHE = new Map();

async function platformAuthMeta(storage) {
  const key = String(storage || "").toLowerCase();
  if (_PLATFORM_META_CACHE.has(key)) return _PLATFORM_META_CACHE.get(key);
  let meta = { auth_mode: "", auth_explain: "" };
  try {
    const r = await api(`/api/${encodeURIComponent(key)}/meta`);
    const { ok, data } = await safeJson(r);
    if (ok && data) {
      meta = {
        auth_mode: String(data.auth_mode || ""),
        auth_explain: String(data.auth_explain || ""),
      };
    }
  } catch (e) {
    // 拿不到就按「支持授权」处理，让用户点一下试，而不是直接藏掉入口
  }
  _PLATFORM_META_CACHE.set(key, meta);
  return meta;
}

/** 该平台是否支持「在线授权登录」。 */
async function platformSupportsAuth(storage) {
  const meta = await platformAuthMeta(storage);
  return meta.auth_mode !== "local-session-only";
}

async function platformBeginAuth(spec, storage) {
  const realm = (spec && spec.realm) || "cn";
  const id = String((spec && spec.id) || storage || "").toLowerCase();

  // Trae 没有 PKCE 设备端点：这里的「授权登录」= 打开官方登录页拿 IDE 登录态，
  // 登录后本机 storage.json 会更新，回到这里点「扫描本机」即可导入。
  // 之前 Trae 的登录入口是「贴网页 Cookie」—— 那只是用量查询用的，不是登录。
  if (id.startsWith("trae")) {
    // 走真正的 PKCE 授权链：后端生成 code_challenge 并起本地回调端口，
    // 用户点链接登录 → 浏览器自动回调 → 后端用 code 换 token 写号池。
    // 不再要求用户手动贴 Cookie，也不再依赖本机 storage.json。
    const realm = (spec && spec.realm) || "cn";
    let start;
    try {
      start = await api(`/api/trae/device/start?realm=${encodeURIComponent(realm)}`,
                        { method: "POST" });
    } catch (e) {
      toast("开始授权失败：" + (e && e.message ? e.message : e), "err");
      return;
    }
    const { ok, data } = await safeJson(start);
    if (!ok || !data || !data.auth_url) {
      toast("开始授权失败：" + ((data && data.detail) || "无授权地址"), "err");
      return;
    }
    // 上游强制回环回调（auth_type=local 写死），所以**服务器部署时**
    // 浏览器一定会跳到用户自己电脑的 127.0.0.1 —— 打不开是正常的，
    // 但地址栏里那条 URL 带着完整授权码，复制回来提交就能完成。
    //
    // ⚠️ 手动提交表单**始终显示**，不再按 reachable 隐藏：
    // 用户反馈「只有一行等待中 + 一个链接，找不到粘贴的地方」——
    // 即使是在本机能自动回调的场景，表单留着也是无害的兜底。
    const reachable = data.callback_reachable !== false;
    openModal(`<h3 class="font-semibold text-lg mb-2">授权登录 · ${esc((spec && spec.label) || storage)}</h3>

      <div style="padding:12px 14px;border-radius:10px;background:var(--surface-2);border:1px solid var(--border);margin-bottom:14px">
        <p class="text-sm m-0 mb-2" style="color:var(--fg)">
          <b>操作步骤</b>
        </p>
        <ol class="text-xs m-0" style="color:var(--fg-muted);padding-left:20px;line-height:1.95">
          <li>点下面的链接，在打开的 Trae 授权页上选择账号并点「授权」</li>
          <li>浏览器会跳转到一个 <b>无法访问</b> 的页面（地址以 <code>http://127.0.0.1</code> 开头）——
              <b style="color:var(--warn)">这是正常的，不是出错</b></li>
          <li>在那个「无法访问」的页上，<b>点「复制这条链接」</b>按钮
              （没有按钮就手动全选地址栏复制）</li>
          <li>回到这里，把链接<b>粘贴到下面的输入框</b>，点「提交回调链接」</li>
        </ol>
        ${reachable ? `<p class="text-xs mt-2 mb-0" style="color:var(--fg-subtle)">
          当前是<b>本机访问</b>，理论上浏览器会自动回跳，本页会自动提示成功；
          若超过 1 分钟没反应，就走上面第 3~4 步手动提交。</p>` : ''}
      </div>

      <div class="mb-3">
        <p class="text-xs mb-1" style="color:var(--fg-muted)">① 授权链接（点它去授权）</p>
        <p class="text-xs" style="word-break:break-all;margin:0">
          <a href="${esc(data.auth_url)}" target="_blank" rel="noopener"
             style="color:var(--brand);text-decoration:underline">${esc(data.auth_url)}</a>
        </p>
        <button type="button" class="console-btn" id="traeCopyAuthBtn"
                style="margin-top:8px">复制授权链接</button>
      </div>

      <form id="traeCallbackForm" class="mb-3" style="padding-top:12px;border-top:1px dashed var(--border)">
        <label for="traeCallbackUrl" class="block text-xs mb-1" style="color:var(--fg-muted)">
          ② 授权后跳转回来的链接（粘到这里）
          <span style="color:var(--fg-subtle)">— 就是那个打不开的页面，地址栏里那一整条</span>
        </label>
        <textarea id="traeCallbackUrl" rows="3" class="w-full text-xs"
          style="padding:8px;border:1px solid var(--border);border-radius:8px;resize:vertical;background:var(--bg);color:var(--fg)"
          placeholder="http://127.0.0.1:8790/authorize?isRedirect=true&amp;...&amp;authCodeInfo=..."
          spellcheck="false" autocomplete="off"></textarea>
        <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin-top:8px">
          <span class="text-xs" style="color:var(--fg-subtle)">
            <b>粘贴即自动提交</b>；按钮只在自动提交没触发时兜底
          </span>
          <button id="traeCallbackSubmit" type="submit" class="console-btn primary">
            提交回调链接
          </button>
        </div>
        <p id="traeCallbackError" class="text-xs mt-1" style="color:var(--danger)"></p>
      </form>

      <p id="traeAuthStatus" class="text-sm" style="color:var(--fg-muted)">
        等待授权…（提交上面的链接后这里会显示进度）
      </p>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">
        <button type="button" onclick="closeModal()" class="console-btn">关闭</button>
      </div>`);

    const nonce = data.nonce;
    // 复制授权链接按钮（独立绑定，避免内联 onclick 里的引号把模板打断）
    try {
      const copyBtn = document.getElementById("traeCopyAuthBtn");
      if (copyBtn) {
        copyBtn.addEventListener("click", async () => {
          const url = data.auth_url || "";
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(url);
            } else {
              const ta = document.createElement("textarea");
              ta.value = url;
              ta.style.position = "fixed";
              ta.style.top = "-1000px";
              document.body.appendChild(ta);
              ta.select();
              document.execCommand("copy");
              document.body.removeChild(ta);
            }
            copyBtn.textContent = "已复制";
            toast("授权链接已复制");
            setTimeout(() => { copyBtn.textContent = "复制授权链接"; }, 2000);
          } catch (e) {
            toast("复制失败，请手动选中链接复制", "err");
          }
        });
      }
    } catch (e) { /* 复制按钮绑不上不影响主流程 */ }

    // 手动提交回调链接：服务器部署时的必经之路（上游只接受回环回调地址，
    // 浏览器必然跳到用户自己电脑的 127.0.0.1，打不开但地址栏里有授权码）。
    //
    // **表单始终存在**（不按 reachable 隐藏），所以这里不再加 if 判断。
    {
      const form = document.getElementById("traeCallbackForm");
      const input = document.getElementById("traeCallbackUrl");
      const errEl = document.getElementById("traeCallbackError");
      const btn = document.getElementById("traeCallbackSubmit");

      /** 看着像 Trae 回调链接吗（避免把剪贴板里别的东西当成授权码提交）。 */
      const looksLikeCallback = text => /127\.0\.0\.1|localhost|authCodeInfo|loginTraceID/i
        .test(String(text || "").trim());

      /** 真正提交。`auto=true` 表示由「粘贴/自动填充」触发。
       *
       * 用户的要求很明确：链接粘进来就该自己去换 token，不必再点一次按钮。
       * 按钮保留，只作为「自动提交没触发 / 想重试」的兜底 —— 不能因为它存在
       * 就强迫用户多点一次。
       */
      let submitting = false;
      const submitCallback = async auto => {
        if (submitting) return;
        const url = (input && input.value ? input.value : "").trim();
        if (errEl) errEl.textContent = "";
        if (!url) {
          if (errEl) errEl.textContent = "请先粘贴授权后跳转页面的完整链接";
          return;
        }
        if (!looksLikeCallback(url)) {
          if (errEl) errEl.textContent = "这不像回调链接：应包含 127.0.0.1 / authCodeInfo / loginTraceID";
          return;
        }
        submitting = true;
        btn.disabled = true;
        btn.textContent = "提交中…";
        if (auto && window.toast) toast("已自动提交回调链接");
        try {
          const r = await api("/api/trae/device/callback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nonce, callback_url: url }),
          });
          const { ok: cok, data: cd } = await safeJson(r);
          if (!cok) {
            if (errEl) errEl.textContent = (cd && (cd.detail || cd.message)) || "提交失败";
            return;                       // 失败**保留输入框内容**，便于改一下再试
          }
          const status = document.getElementById("traeAuthStatus");
          if (status) status.textContent = "回调已接收，正在完成授权…";
          if (input) input.value = "";
        } catch (e) {
          if (errEl) errEl.textContent = "提交出错：" + (e && e.message ? e.message : e);
        } finally {
          submitting = false;
          btn.disabled = false;
          btn.textContent = "提交回调链接";
        }
      };

      /** 尝试把剪贴板内容填进输入框。
       *
       * 用户在那张「打不开」的回调页上已经点过「复制这条链接」，
       * 所以这里**主动读一次剪贴板自动回填** —— 能省掉「粘贴」这一步。
       *
       * 注意：`navigator.clipboard.readText()` 需要用户手势授权，
       * 无手势时浏览器会直接 reject（或弹权限框）。失败**不能报错打扰用户**，
       * 静默放弃、让他手动粘贴即可 —— 这是备选路径，不是主路径。
       */
      const autofillFromClipboard = async silent => {
        if (!input || input.value.trim()) return false;
        try {
          if (!navigator.clipboard || !navigator.clipboard.readText) return false;
          const text = (await navigator.clipboard.readText() || "").trim();
          // 只接受看着像回调链接的内容，避免把用户剪贴板里别的东西填进来
          if (!looksLikeCallback(text)) return false;
          input.value = text;
          if (errEl) errEl.textContent = "";
          if (!silent && window.toast) toast("已从剪贴板自动填入回调链接");
          return true;
        } catch (e) {
          // 无权限 / 非安全上下文 / 用户拒绝 —— 都不打扰
          return false;
        }
      };

      if (form) {
        // 打开弹窗即尝试一次（多数浏览器这里会失败，因为还没有用户手势）
        autofillFromClipboard(true).then(filled => { if (filled) submitCallback(true); });
        // 用户一点输入框（说明他准备粘贴/操作），再试一次 —— 这次有手势了
        if (input) {
          input.addEventListener("focus", async () => {
            const filled = await autofillFromClipboard(false);
            if (filled) submitCallback(true);
          });

          // **粘贴即提交**：这是主路径。paste 事件里 DOM 还没更新，
          // 所以等一个 tick 再读 value；确认是回调链接就直接换 token。
          input.addEventListener("paste", () => {
            setTimeout(() => {
              const v = (input.value || "").trim();
              if (looksLikeCallback(v)) submitCallback(true);
            }, 40);
          });
          // 兜底：不用鼠标、靠键盘输入/回车粘贴时也能触发（防抖 700ms）
          let typingTimer = null;
          input.addEventListener("input", () => {
            if (typingTimer) clearTimeout(typingTimer);
            typingTimer = setTimeout(() => {
              const v = (input.value || "").trim();
              if (looksLikeCallback(v) && v.length > 60) submitCallback(true);
            }, 700);
          });
        }

        form.addEventListener("submit", event => {
          event.preventDefault();
          submitCallback(false);
        });
      }
    }
    for (let i = 0; i < 150; i += 1) {
      await new Promise(r => setTimeout(r, 2000));
      const el = document.getElementById("traeAuthStatus");
      if (!el) return;                       // 弹窗被关掉了
      let poll;
      try {
        poll = await api("/api/trae/device/poll?nonce=" + encodeURIComponent(nonce));
      } catch (e) { continue; }
      const { ok: pok, data: pd } = await safeJson(poll);
      // **不要把错误当「继续等」**：换 token 失败会返回 502，
      // 之前 `if (!pok) continue` 会一直等下去，表现就是
      // 「回调页说授权完成，控制台却一直等待浏览器授权」。
      if (!pok) {
        el.textContent = "授权失败：" + ((pd && (pd.detail || pd.message)) || "请求出错");
        el.style.color = "var(--danger)";
        return;
      }
      if (pd && pd.pending) continue;
      if (pd && pd.ok) {
        el.textContent = "授权成功，账号已写入号池";
        el.style.color = "var(--ok)";
        toast("Trae 授权成功");
        setTimeout(() => {
          closeModal();
          loadAccounts();
          loadPlatformOverview();
          // 平台卡底部的账号数**必须重新拉**：它来自 /api/platforms 的
          // account_count，不重拉就一直是页面打开时的旧数字。
          // 原来这里只刷了概览和账号池，所以「授权成功、账号也进来了，
          // 但卡片上还是 0 个账号」（2026-10-31 实测）。
          if (window.WBPlatform) window.WBPlatform.refreshCounts();
        }, 900);
        return;
      }
      el.textContent = "授权失败：" + ((pd && (pd.error || pd.detail)) || "未知原因");
      el.style.color = "var(--danger)";
      return;
    }
    return;
  }

  const start = await api(`/api/${storage}/device/start?realm=${encodeURIComponent(realm)}`,
                          { method: "POST" });
  const { ok, data } = await safeJson(start);
  if (!ok) {
    toast(`发起授权失败：${(data && data.detail) || start.status}`, "err");
    return;
  }
  const authUrl = data.auth_url || "";
  const nonce = data.nonce || "";
  if (!authUrl || !nonce) {
    toast("授权链接生成异常", "err");
    return;
  }

  // 设备码授权（Qoder 这类）：token 由**服务端轮询**取回，
  // 浏览器在哪台机器上完全不重要 —— 手机上打开授权也行。
  // 文案直接这么写，避免服务器部署的用户以为只能在本机点。
  openModal(`<h3 class="font-semibold text-lg mb-2">授权登录 · ${esc((spec && spec.label) || storage)}</h3>
    <ol class="text-sm mb-3" style="color:var(--fg-muted);padding-left:18px">
      <li>用<b>任意设备</b>的浏览器打开下面的链接（手机也行）</li>
      <li>选择要接入的账号并确认授权</li>
      <li>本页会自动完成 —— 凭证由服务端轮询取回，与浏览器在哪无关</li>
    </ol>
    <p class="text-xs mb-3" style="word-break:break-all">
      <a href="${esc(authUrl)}" target="_blank" rel="noopener"
         style="color:var(--brand);text-decoration:underline">${esc(authUrl)}</a>
    </p>
    <p id="authStatus" class="text-sm" style="color:var(--fg-muted)">等待授权…</p>
    <div class="flex justify-end mt-4">
      <button onclick="closeModal()" class="console-btn quiet">关闭</button>
    </div>`);

  // 轮询：每 3 秒一次，最多 100 次（5 分钟）
  const statusEl = () => document.getElementById("authStatus");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    if (!document.getElementById("authStatus")) return;   // 弹窗被关了
    let poll;
    try {
      poll = await api(`/api/${storage}/device/poll?nonce=${encodeURIComponent(nonce)}`);
    } catch (error) {
      continue;
    }
    if (poll.status === 404) {
      const el = statusEl();
      if (el) el.textContent = "授权会话已过期，请重新发起";
      return;
    }
    const parsed = await safeJson(poll);
    if (!parsed.ok) continue;
    const payload = parsed.data || {};
    if (payload.pending) {
      const el = statusEl();
      if (el) el.textContent = payload.summary || "等待授权…";
      continue;
    }
    // 拿到凭证 -> 落账号
    const el = statusEl();
    if (el) el.textContent = "授权成功，正在保存…";
    const claim = await api(`/api/${storage}/device/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials: payload.credentials }),
    });
    const claimed = await safeJson(claim);
    if (claimed.ok) {
      const info = claimed.data || {};
      if (el) {
        el.style.color = "var(--success, #33587F)";
        el.textContent = `已添加账号：${info.name || info.uid || "成功"}`;
      }
      toast("授权完成，账号已添加");
      // ⚠️ 不能只调 loadAccounts()：
      // 它按 `window.WBPlatform.spec()` 分派，而授权期间当前平台
      // 可能不是刚授权的那个 -> 会去渲染别的平台的账号池，
      // 表现为「数据没进来，手动刷新才显示」。
      //
      // 正确做法：先显式切到该平台（select 内部会重新拉数据），
      // 再等一拍补一次 loadAccounts()。
      try {
        if (window.WBPlatform && typeof window.WBPlatform.select === "function") {
          await window.WBPlatform.select(spec && spec.id ? spec.id : storage, realm);
        }
      } catch (error) {
        // 切平台失败也要刷，至少别让用户以为没成功
      }
      await new Promise(resolve => setTimeout(resolve, 600));
      loadAccounts();
      // 平台卡账号数同步刷新（`select()` 里已经带了 refresh，这里再补一次
      // 是为了覆盖「切平台失败 / 本来就停在该平台」的分支，见上面 try 的注释）。
      if (window.WBPlatform) window.WBPlatform.refreshCounts();
      setTimeout(() => closeModal(), 900);
    } else {
      if (el) el.textContent = `保存失败：${(claimed.data && claimed.data.detail) || claim.status}`;
    }
    return;
  }
  const el = statusEl();
  if (el) el.textContent = "授权超时（5 分钟），请重新发起";
}

async function platformCheckin(spec, storage) {
  const realm = (spec && spec.realm) || "";
  const qs = realm ? `?realm=${encodeURIComponent(realm)}` : "";
  const prefix = storage === "workbuddy" ? "/api/accounts" : `/api/${storage}`;
  toast("正在签到…");
  const r = await api(prefix + "/checkin" + qs, { method: "POST" });
  if (r.status === 404) {
    // 该平台没有手动签到接口（签到在定时任务里跑）
    openModal(`<h3 class="font-semibold text-lg mb-2">该平台没有手动签到接口</h3>
      <p class="text-sm" style="color:var(--fg-muted)">
        ${esc((spec && spec.label) || storage)} 的签到由<strong>定时任务</strong>执行，
        不提供手动按钮。到「定时任务」里配置 <code>${esc(storage)}_checkin</code> 即可。
      </p>`);
    return;
  }
  const { ok, data } = await safeJson(r);
  if (!ok) {
    toast(`签到失败：${(data && data.detail) || r.status}`, "err");
    return;
  }
  if (data.supported === false) {
    openModal(`<h3 class="font-semibold text-lg mb-2">该平台没有签到</h3>
      <p class="text-sm" style="color:var(--fg-muted)">${esc(data.summary || "")}</p>`);
    loadAccounts();
    return;
  }

  const items = data.items || [];
  const rows = items.map(it => `<tr class="border-t">
      <td class="text-xs">${esc(it.account || "")}</td>
      <td class="text-xs">${it.already_processed ? "今日已领" : "新领取"}</td>
      <td class="text-xs tnum text-right">${it.current_balance ?? "-"}</td>
      <td class="text-xs tnum text-right">${it.daily_balance ?? "-"}</td>
    </tr>`).join("");

  openModal(`<h3 class="font-semibold text-lg mb-2">签到结果</h3>
    <p class="text-sm mb-2" style="color:var(--fg-muted)">${esc(data.summary || "")}</p>
    ${rows ? `<table class="w-full text-sm">
      <thead><tr class="text-xs" style="color:var(--fg-subtle)">
        <th class="text-left">账号</th><th class="text-left">状态</th>
        <th class="text-right">可用积分</th><th class="text-right">当日额度</th>
      </tr></thead><tbody>${rows}</tbody></table>` : ""}
    ${(data.failed || []).length ? `<p class="text-xs mt-2" style="color:var(--danger)">
      失败：${esc(JSON.stringify(data.failed))}</p>` : ""}`);
  loadAccounts();
}

/**
 * 各平台接口前缀。
 *
 * WorkBuddy 是主应用（挂在 /api/accounts 下），其余平台是
 * `/api/<storage>`。**但导入路径不是统一的**：
 *   · workbuddy / loomy / trae  -> POST {prefix}/import-local
 *   · qoder                     -> POST {prefix}/import（且必须带 PAT，
 *                                  原生层的 auth.v1.dat 解不开）
 * 之前一律拼 import-local，Qoder 直接 404 —— 表现就是「扫描没通」。
 */
function platformApiPrefix(spec, storage) {
  const id = String((spec && (spec.storage_platform || spec.id)) || storage || "").toLowerCase();
  if (id === "workbuddy" || id === "codebuddy") return "/api/accounts";
  return "/api/" + (storage || id);
}

/**
 * 账号**列表 / 单号操作**的基础路径。
 *
 * 与 `platformApiPrefix` 的区别：那个是「平台命名空间」（扫描/导入/用量都在
 * 它下面），这里要的是**账号集合**，各平台不是同一个前缀：
 *
 *   workbuddy -> /api/accounts          （admin 自己的账号池）
 *   trae      -> /api/trae/accounts
 *   qoder     -> /api/qoder/accounts
 *   loomy     -> /api/loomy/accounts
 *
 * 「刷新额度」原来拼的是 `/api/{storage}`，缺最后一级 —— `GET /api/qoder`
 * 没有这个路由，直接 404，表现就是「点刷新额度提示读取账号列表失败」，
 * 而账号池面板是好的（它走的是正确路径）。2026-10-31 实测确认。
 */
function platformAccountBase(spec, storage) {
  const id = String((spec && (spec.storage_platform || spec.id)) || storage || "").toLowerCase();
  if (id === "workbuddy" || id === "codebuddy") return "/api/accounts";
  return "/api/" + (storage || id) + "/accounts";
}

function platformImportPath(spec, storage) {
  const id = String((spec && (spec.storage_platform || spec.id)) || storage || "").toLowerCase();
  const base = platformApiPrefix(spec, storage);
  // Qoder 的导入是 /api/qoder/import，且需要 pat 字段
  return id === "qoder" ? base + "/import" : base + "/import-local";
}

async function platformScanLocal(spec, storage) {
  // WorkBuddy 有**专用**的扫描弹窗（`scanLocal()`）：按 UID 去重、
  // 标注「当前 / 号池已有」、逐条导入、显示 Token 到期时间。
  // 通用渲染（showScanResult）拿不到这些字段，会显示成一堆「不可导入」。
  // 这里直接复用专用实现，避免两套界面并存。
  const id = String((spec && (spec.storage_platform || spec.id)) || storage || "").toLowerCase();
  if (id === "workbuddy" || id === "codebuddy") {
    // Android 版构建会**删掉**整个 `scanLocal` 实现（桌面专属功能），
    // 所以这里必须做存在性判断，否则移动端调用直接 ReferenceError。
    if (typeof scanLocal === "function") return scanLocal();
    toast("移动端不支持扫描本机，请在桌面端操作", "err");
    return;
  }

  const realm = (spec && spec.realm) || "";
  const qs = realm ? `?realm=${encodeURIComponent(realm)}` : "";
  const prefix = platformApiPrefix(spec, storage);
  const r = await api(prefix + "/scan-local" + qs);
  const { ok, data } = await safeJson(r);
  if (!ok) {
    toast(`扫描失败：${(data && data.detail) || r.status}`, "err");
    return;
  }
  await showScanResult(data, spec, storage);
}

/**
 * 各平台的「导入本机」。
 *
 * Loomy 的凭证是明文 JSON，可以直接导入（用户零操作）；
 * Qoder 的凭证加密在原生层，导入会返回需要 PAT/设备流的提示。
 */
async function platformImportLocal(spec, storage) {
  const path = platformImportPath(spec, storage);
  const id = String((spec && (spec.storage_platform || spec.id)) || storage || "").toLowerCase();
  // 必须带 JSON body：ImportLocalIn 是必填模型，空 body 会 422
  // （WorkBuddy 的「导入本机」就是这么失效的）。all=true = 导入目录下全部账号。
  const payload = id === "qoder" ? { all: true } : { all: true };
  const r = await api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const { ok, data } = await safeJson(r);
  if (!ok) {
    toast(`导入失败：${(data && data.detail) || r.status}`, "err");
    return;
  }
  if (data.imported > 0) {
    toast(`已导入 ${data.imported} 个账号`);
    loadAccounts();
    return;
  }
  // 导入 0 个要**说清原因**，不要静默
  const hint = data.hint || data.reason || "本机没有可读凭证";
  openModal(`<h3 class="font-semibold text-lg mb-2">没有导入任何账号</h3>
    <p class="text-sm" style="color:var(--fg-muted)">${esc(hint)}</p>
    ${data.scanned ? `<p class="text-xs mt-2" style="color:var(--fg-subtle)">已扫描 ${data.scanned} 项</p>` : ""}`);
}

/**
 * 通用「用量明细」：按账号列出余额 / 今日请求 / 今日积分，点单个账号看上游明细。
 *
 * 为什么不再只给 Trae 做：WorkBuddy / Qoder / Loomy 的按钮都由后端
 * `actions` 声明了 `usage`，但前端只有 Trae 分支 —— 其它平台点了没反应。
 */
async function platformUsageDetail(spec, storage) {
  const prefix = storage === "workbuddy" ? "/api/accounts" : `/api/${storage}`;
  openModal(`<h3 class="font-semibold text-lg mb-1">用量明细 · ${esc((spec && spec.label) || storage)}</h3>
    <p class="text-xs mb-3" style="color:var(--fg-subtle)">读取中…</p>`, "max-w-3xl");
  let items = [];
  try {
    const { ok, data } = await safeJson(await api(prefix + "?page_size=200"));
    if (ok) items = (data && data.items) || [];
  } catch (e) { /* 下面统一提示 */ }
  const box = $("#modalBox");
  if (!box) return;
  if (!items.length) {
    box.innerHTML += `<p class="text-sm" style="color:var(--fg-muted)">该平台还没有账号，先在「平台管理」里扫描/导入。</p>
      <div class="flex justify-end mt-3"><button class="console-btn quiet" onclick="closeModal()">关闭</button></div>`;
    return;
  }
  const rows = items.map(a => {
    const today = (a.usage_today && (a.usage_today.requests ?? a.usage_today.count)) || 0;
    const credit = (a.usage_today && a.usage_today.credits) || 0;
    return `<tr class="border-t">
      <td class="py-2 pr-2 text-sm">${esc(a.name || a.uid || ("#" + a.id))}</td>
      <td class="py-2 px-2 text-xs">${a.status === "active"
        ? '<span class="badge bg-emerald-100 text-emerald-700">正常</span>'
        : '<span class="badge bg-slate-100 text-slate-500">停用</span>'}</td>
      <td class="py-2 px-2 text-right text-xs tnum">${fmtNum(a.balance_remain ?? 0)}</td>
      <td class="py-2 px-2 text-right text-xs tnum">${today || "—"}</td>
      <td class="py-2 px-2 text-right text-xs tnum">${credit ? fmtCredit(credit) : "—"}</td>
      <td class="py-2 pl-2 text-right">
        <button class="console-btn quiet" onclick="platformUsageOne('${prefix}', ${Number(a.id)}, '${esc(a.name || "")}')">上游明细</button>
      </td></tr>`;
  }).join("");
  box.innerHTML = `<h3 class="font-semibold text-lg mb-1">用量明细 · ${esc((spec && spec.label) || storage)}</h3>
    <p class="text-xs mb-3" style="color:var(--fg-subtle)">余额为本站记录；「上游明细」直接读该账号的请求用量（上游接口）。</p>
    <div class="overflow-x-auto"><table class="w-full text-sm">
      <thead><tr class="text-[10px]" style="color:var(--fg-subtle)">
        <th class="text-left py-1 pr-2">账号</th><th class="text-left py-1 px-2">状态</th>
        <th class="text-right py-1 px-2">可用积分</th><th class="text-right py-1 px-2">今日请求</th>
        <th class="text-right py-1 px-2">今日积分</th><th class="text-right py-1 pl-2">操作</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    <div id="platformUsageOne" class="mt-3"></div>
    <div class="flex justify-end mt-3"><button class="console-btn quiet" onclick="closeModal()">关闭</button></div>`;
}

/** 单个账号的上游用量（分页拉最近 20 条）。 */
async function platformUsageOne(prefix, accountId, name) {
  const host = $("#platformUsageOne");
  if (!host) return;
  host.innerHTML = `<p class="text-xs" style="color:var(--fg-subtle)">读取 ${esc(name)} 的上游用量…</p>`;
  let payload = null;
  try {
    const { ok, data } = await safeJson(await api(`${prefix}/${accountId}/request-usage`));
    if (ok) payload = data;
  } catch (e) {}
  const rows = (payload && payload.data && payload.data.data) || payload && payload.data || [];
  if (!Array.isArray(rows) || !rows.length) {
    host.innerHTML = `<p class="text-xs" style="color:var(--fg-warn)">该账号没有可读的上游用量（可能未同步或接口不支持）。</p>`;
    return;
  }
  host.innerHTML = `<div class="text-xs font-medium mb-1">${esc(name)} · 最近 ${rows.length} 条</div>
    <div class="overflow-x-auto" style="max-height:260px"><table class="w-full text-xs">
    <thead><tr style="color:var(--fg-subtle)"><th class="text-left py-1">时间</th><th class="text-left py-1">模型</th>
      <th class="text-right py-1">积分</th><th class="text-left py-1">输入摘要</th></tr></thead>
    <tbody>${rows.slice(0, 20).map(r => `<tr class="border-t">
      <td class="py-1 pr-2 whitespace-nowrap">${esc(String(r.requestTime || r.request_time || "—").slice(5))}</td>
      <td class="py-1 pr-2 font-mono">${esc(r.model || "—")}</td>
      <td class="py-1 pr-2 text-right tnum">${fmtCredit(r.credit ?? r.credits ?? 0)}</td>
      <td class="py-1" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.inputTrunc || r.input || "—")}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

/** 各平台的「刷新额度」：**只刷当前平台**的账号。 */
async function platformRefreshAll(spec, storage) {
  const base = platformAccountBase(spec, storage);
  const realm = (spec && spec.realm) || "";
  const qs = realm ? `?realm=${encodeURIComponent(realm)}` : "";
  const r = await api(base + qs);
  const { ok, data } = await safeJson(r);
  if (!ok) {
    toast(`刷新失败：读取账号列表失败（HTTP ${r.status}）`, "err");
    return;
  }
  const items = (data && data.items) || [];
  if (!items.length) { toast("该平台还没有账号", "err"); return; }
  let total = 0;
  const failures = [];
  for (const item of items) {
    const rr = await api(`${base}/${item.id}/refresh`, { method: "POST" });
    if (rr.ok) { total += 1; continue; }
    // 失败要**说清是上游拒绝还是本地问题**：上游 401 的原文是
    // 「APISIX 401 Authorization Required」，直接弹 401 会让人以为
    // 控制台登录失效（实测用户就是这么理解的）。
    let detail = null;
    try { detail = (await safeJson(rr)).data; } catch (e) {}
    const up = (detail && detail.detail && detail.detail.upstream) || {};
    const reason = (up.client_message || (detail && detail.detail && detail.detail.message)
                    || (detail && detail.detail) || item.message || rr.status);
    failures.push(`${item.name || ("#" + item.id)}：${reason}`);
  }
  toast(`已刷新 ${total}/${items.length} 个账号` + (failures.length
    ? `；${failures.length} 个失败 —— ${failures[0]}${failures.length > 1 ? " 等" : ""}` : ""),
    failures.length ? "err" : "ok");
  loadAccounts();
  // 平台卡底部的账号数 / 概览卡也要跟着更新（它们不随账号池自动刷新）
  if (window.WBPlatform) window.WBPlatform.refreshCounts();
  if (typeof _activeTab !== "undefined" && _activeTab === "platforms") loadPlatformOverview();
}

/**
 * 统一渲染扫描结果。
 *
 * 必须区分三种情况，不能一律显示「没找到」：
 *   1. 找到明文凭证 -> 可以导入
 *   2. 找到目录但凭证加密 -> 需要授权/重新登录
 *   3. 根本没找到目录 -> 客户端可能没装/没登录
 */
/**
 * 平台速度与稳定性卡片。
 *
 * 每个平台一行：排名 / 名称 / 成功率 / p50 延迟条 / 抖动 / 操作
 * （「设为最高优先级」直接写 gateway priority，省得再去网关页翻）。
 */
/**
 * 平台速度表：TTFT（首 token 延迟）+ TPS（输出速度）。
 *
 * 这两个是观感的决定因素：
 *   TTFT 1500ms  vs 3000ms  -> "点发送后要等多久才出字"
 *   TPS  220     vs 40      -> "出字是哗哗的还是一蹦一蹦的"
 * 只放一个「延迟」看不出这两件事，所以单独列出来。
 */
async function loadGatewaySpeed() {
  const host = document.querySelector("#gwSpeedTable");
  if (!host) return;
  host.innerHTML = '<p class="sentinel-empty" style="padding:10px">统计中…</p>';
  let data = null;
  try {
    const { ok, data: payload } = await safeJson(await api("/api/platform/speed?hours=24"));
    if (ok) data = payload;
  } catch (e) { /* 下面统一提示 */ }
  const rows = ((data && data.items) || []).filter(r => r.requests > 0);
  if (!rows.length) {
    host.innerHTML = '<p class="sentinel-empty" style="padding:10px">近 24 小时还没有样本。</p>';
    return;
  }
  const maxTps = Math.max(1, ...rows.map(r => r.tps_p50 || 0));
  // 用**平均值**排序展示：用户的目标是「看出哪个平台快、然后手动用它」，
  // 均值比中位数更贴近体感；中位数留在 tooltip 里当参考。
  const byTtft = [...rows].sort((a, b) => (a.ttfb_avg || 9e9) - (b.ttfb_avg || 9e9));
  const fastestId = byTtft[0] ? byTtft[0].platform : "";
  host.innerHTML = `<div class="gw-speed-row gw-speed-head">
      <span>平台</span><span>成功率</span><span>TTFT 均值</span><span>TPS 均值</span>
      <span>总耗时均值</span><span>样本</span>
    </div>` + rows.map(r => {
    const tone = r.success_rate >= 98 ? "ok" : r.success_rate >= 90 ? "warn" : "danger";
    const w = Math.max(6, Math.round((r.tps_avg || 0) / maxTps * 100));
    const badge = r.platform === fastestId ? '<b class="gw-speed-tag">最快</b>' : "";
    return `<div class="gw-speed-row">
      <span class="gw-speed-name">${esc(r.label || r.platform)}${badge}</span>
      <span class="tone-${tone}">${r.success_rate}%</span>
      <span data-tooltip="中位 ${r.ttfb_p50 || 0}ms">${r.ttfb_avg ? r.ttfb_avg + "ms" : "—"}</span>
      <span class="gw-speed-tps"><i style="width:${w}%"></i><em>${r.tps_avg ? r.tps_avg.toFixed(0) : "—"} tok/s</em></span>
      <span data-tooltip="中位 ${r.latency_p50 || 0}ms">${r.latency_avg ? r.latency_avg + "ms" : "—"}</span>
      <span class="gw-speed-sub">${fmtNum(r.requests)}</span>
    </div>`;
  }).join("") + `<p class="bench-note">
    表中均为**平均值**（悬停看中位数）。TTFT 越低越好、TPS 越高越好。
    想固定用某个平台：复制带 <code>-平台名</code> 后缀的模型 id 即可
    （如 <code>DeepSeek-V4.1-Flash-loomy</code>），网关会直接路由到该平台。
  </p>`;
  const hint = document.querySelector("#gwSpeedHint");
  if (hint) hint.textContent = `近 ${data.hours} 小时 · ${rows.length} 个平台有样本`;
}

async function loadPlatformBench() {
  const host = document.querySelector("#platformBench");
  if (!host) return;
  host.innerHTML = '<p class="sentinel-empty" style="padding:10px 2px">统计中…</p>';
  let data = null;
  try {
    const { ok, data: payload } = await safeJson(await api("/api/platform/speed?hours=24"));
    if (ok) data = payload;
  } catch (e) { /* 下面统一提示 */ }
  if (!data || !(data.items || []).length) {
    host.innerHTML = '<p class="sentinel-empty" style="padding:10px 2px">近 24 小时还没有足够样本。</p>';
    return;
  }
  const items = data.items.filter(row => row.requests > 0);
  const slowest = Math.max(1, ...items.map(row => row.latency_p50 || 1));
  const rows = items.map(row => {
    const tone = row.success_rate >= 98 ? "ok" : row.success_rate >= 90 ? "warn" : "danger";
    // 同一个平台可能既最快又最稳：两个徽标都要显示，不能互斥。
    const badge = (row.platform === data.fastest
        ? '<span class="bench-badge fastest">最快</span>' : '')
      + (row.platform === data.steadiest
        ? '<span class="bench-badge steadiest">最稳</span>' : '');
    const width = Math.max(6, Math.round((row.latency_p50 || 0) / slowest * 100));
    return `<div class="bench-row">
      <span class="bench-rank">#${row.rank}</span>
      <span class="bench-name">${esc(row.label || row.platform)}${badge}
        ${row.low_sample ? '<span class="bench-low">样本少</span>' : ""}</span>
      <span class="bench-rate tone-${tone}">${row.success_rate}%</span>
      <span class="bench-track"><i style="width:${width}%"></i></span>
      <span class="bench-lat">${row.latency_p50 ? fmtDuration(row.latency_p50) : "—"}</span>
      <span class="bench-jitter" data-tooltip="延迟标准差，越小越稳">±${row.jitter}ms</span>
      <span class="bench-ops">
        <button class="console-btn quiet" data-bench-priority="${esc(row.platform)}">设为最高优先级</button>
      </span>
    </div>`;
  }).join("");
  host.innerHTML = rows + `<p class="bench-note">
    按「延迟 + 抖动 + 失败率」综合排序；p50 为总耗时中位数，±为抖动。
    点「设为最高优先级」会把该平台优先级设为 1（其余自动顺延），策略需为「优先级」时生效。
  </p>`;
  const hint = document.querySelector("#platformBenchHint");
  if (hint) hint.textContent = `近 ${data.hours} 小时 · ${items.length} 个平台有样本`;

  host.querySelectorAll("[data-bench-priority]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const platform = btn.dataset.benchPriority;
      btn.disabled = true;
      try {
        const { ok } = await safeJson(await api("/api/gateway/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: { [platform]: 1 } }),
        }));
        toast(ok ? `已把 ${platform} 设为最高优先级` : "设置失败", ok ? "ok" : "err");
        if (ok) loadGateway && loadGateway();
      } finally { btn.disabled = false; }
    });
  });
}

async function showScanResult(data, spec, storage) {
  const items = (data && data.items) || [];
  const canImport = Boolean(data && data.can_import);
  // 各平台的 items 字段名不同，按可能的键依次取：
  //   Loomy     -> source / session / phone
  //   Qoder     -> account_id / uid_hint
  //   WorkBuddy -> data_dir / account_id
  const pick = (it, keys) => {
    for (const k of keys) {
      if (it && it[k] !== undefined && it[k] !== null && it[k] !== "") return it[k];
    }
    return "";
  };
  // 用**表格**展示，而不是裸 <li>：一列一个含义，路径过长自动省略，
  // 鼠标悬停看完整路径。之前所有信息挤在一行里，路径一长就没法读。
  const rows = items.map((it, index) => {
    // 字段名各平台不同，这里把实际返回的全列出来（WorkBuddy 用
    // nickname / file / domain；Loomy 用 session / source；
    // Qoder 用 account_id / uid_hint）。漏一个就会显示成空值。
    const where = pick(it, ["source", "file", "data_dir", "dir", "path"]);
    const who = pick(it, ["nickname", "session", "account_id", "uid_hint",
                          "uid", "phone", "name"]);
    const realm = pick(it, ["realm", "domain"]);
    // WorkBuddy 不返回 has_plain_credential（它的 .info 本身就是明文），
    // 有文件就视为可导入；其它平台仍看这个字段。
    const ok = Boolean(it.has_plain_credential) || Boolean(it.file);
    const note = pick(it, ["note", "credential_error"]);
    return `<tr>
      <td class="scan-idx">${index + 1}</td>
      <td>${ok
        ? '<span class="scan-ok">可导入</span>'
        : '<span class="scan-miss">不可导入</span>'}</td>
      <td class="scan-who" data-tooltip="${esc(String(who || "—"))}">${esc(String(who || "—"))}</td>
      <td>${realm ? `<span class="scan-realm">${esc(String(realm))}</span>` : "—"}</td>
      <td class="scan-path" data-tooltip="${esc(String(where || ""))}">${esc(String(where || "—"))}</td>
    </tr>`;
  }).join("");

  // 目录信息也展示（Qoder 的 data_dirs 有多个）
  const dirs = (data && (data.data_dirs || [])) || [];
  const dirBlock = dirs.length
    ? `<div class="text-xs mt-2" style="color:var(--fg-subtle)">
        扫描目录：${dirs.map(d => `<code>${esc(String(d))}</code>`).join("、")}</div>`
    : "";

  const id = String((spec && (spec.storage_platform || spec.id)) || storage || "").toLowerCase();
  // 「要不要显示授权登录按钮」不再硬编码 qoder：
  // 由各平台 /meta 的 auth_mode 决定（Loomy 是 local-session-only，天然没有）。
  const authMeta = await platformAuthMeta(storage);
  const supportsAuth = authMeta.auth_mode !== "local-session-only";
  const authExplain = authMeta.auth_explain || "";
  const needAuth = !canImport && supportsAuth;
  const body = `
    <h3 class="font-semibold text-lg mb-2">扫描结果 · ${esc((spec && spec.label) || storage)}</h3>
    <p class="text-sm mb-2" style="color:var(--fg-muted)">
      ${canImport ? "找到可导入的凭证" : (needAuth ? "本机没有可直接导入的凭证（凭证加密在客户端原生层）" : "没有找到可导入凭证")}
      ${data && data.config_root ? `<br><span class="text-xs">配置目录：<code>${esc(data.config_root)}</code></span>` : ""}
      ${data && data.base_url ? `<br><span class="text-xs">上游：<code>${esc(data.base_url)}</code></span>` : ""}
    </p>
    ${rows ? `<div class="scan-table-wrap">
      <table class="scan-table">
        <thead><tr>
          <th style="width:34px">#</th><th style="width:74px">状态</th>
          <th style="width:150px">账号</th><th style="width:56px">区</th>
          <th>来源路径</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>` : ""}
    ${dirBlock}
    ${data && data.hint ? `<p class="text-xs mt-2" style="color:var(--fg-subtle)">${esc(data.hint)}</p>` : ""}
    ${authExplain ? `<p class="text-xs mt-2" style="color:var(--fg-muted);padding:8px 10px;border-radius:8px;background:var(--surface-2)">
      ${esc(authExplain)}</p>` : ""}
    <div class="flex justify-end gap-2 mt-4">
      ${(needAuth && supportsAuth) ? `<button onclick="closeModal();platformBeginAuth(window.WBPlatform.spec(),'${esc(storage)}')"
          class="console-btn primary">立即授权登录</button>` : ""}
      ${canImport ? `<button onclick="closeModal();platformImportLocal(window.WBPlatform.spec(),'${esc(storage)}')"
          class="console-btn primary">导入这些凭证</button>` : ""}
      <button onclick="closeModal()" class="console-btn quiet">关闭</button>
    </div>`;
  openModal(body);
}

async function traeScanLocal() {
  const r = await api("/api/trae/scan-local");
  const { ok, data } = await safeJson(r);
  if (!ok) { toast((data.detail && data.detail.message) || "扫描失败", "err"); return; }
  const items = data.items || [];
  const realmName = (k) => ({ cn: "国内版", intl: "国际版" })[k] || k || "-";
  const errors = data.errors || [];

  const body = items.length ? `
    <div class="trae-scan-table">
      <table class="tbl">
        <thead><tr>
          <th>区域</th><th>名称</th><th>UID</th><th>地区</th>
          <th>凭证</th><th>设备指纹</th>
        </tr></thead>
        <tbody>
          ${items.map(item => `<tr>
            <td><span class="trae-realm-chip ${item.realm === 'cn' ? 'cn' : 'intl'}">${esc(realmName(item.realm))}</span></td>
            <td class="trae-scan-name" data-tooltip="${esc(item.name || '')}">${esc(item.name || "-")}</td>
            <td class="trae-scan-uid" data-tooltip="${esc(item.uid || '')}">${esc(item.uid || "-")}</td>
            <td>${esc(item.region || "-")}</td>
            <td>${item.has_refresh_token
              ? '<span class="trae-chip ok">可续期</span>'
              : '<span class="trae-chip warn">仅 token</span>'}</td>
            <td>${item.device_id
              ? '<span class="trae-chip ok">已绑定</span>'
              : '<span class="trae-chip">无</span>'}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : `
    <div class="trae-scan-empty">
      <strong>没有发现可导入的登录态</strong>
      请先在本机的 Trae 客户端登录（国内版或国际版），再回来重新扫描。
    </div>`;

  openModal(`
    <div class="trae-modal">
      <h3>本机 Trae 登录态</h3>
      <p class="trae-modal-note">
        从本机 Trae 客户端的 <code>storage.json</code> 读取并解密登录凭证。
        共发现 <b>${items.length}</b> 个账号。
      </p>
      <p class="trae-modal-path" data-tooltip="${esc(data.storage || '')}">${esc(data.storage || "未找到 Trae 安装目录")}</p>
      ${body}
      ${errors.length ? `<div class="trae-modal-errors">
        <strong>${errors.length} 条读取失败</strong>
        ${errors.map(e => `<div>${esc(e.error || JSON.stringify(e))}</div>`).join("")}
      </div>` : ""}
      ${items.length ? `<div class="trae-modal-actions">
        <button type="button" class="console-btn primary" onclick="closeModal(); traeImportLocal()">
          导入这 ${items.length} 个账号
        </button>
        <button type="button" class="console-btn quiet" onclick="closeModal()">关闭</button>
      </div>` : ""}
    </div>`, "max-w-3xl");
}

async function traeImportLocal() {
  toast("正在导入本机 Trae 账号…");
  const r = await api("/api/trae/import-local", { method: "POST" });
  const { ok, data } = await safeJson(r);
  if (!ok) {
    toast((data.detail && data.detail.message) || "导入失败", "err");
    return;
  }
  const errs = data.errors || [];
  const added = data.added || 0;
  const updated = data.updated || 0;
  // 导入结果必须**看得见**：只弹一个 3 秒消失的 toast，用户会怀疑
  // 「到底导没导进去」（尤其 added=0 时）。这里给一份带明细的确认框。
  if (!errs.length) {
    toast(`导入完成：新增 ${added}，更新 ${updated}`, "ok");
    openModal(`
      <div class="trae-modal">
        <h3>导入完成</h3>
        <p class="trae-modal-note">凭证已写入统一号池，可在「账号池」查看与刷新额度。</p>
        <div class="trae-import-summary">
          <div class="trae-import-stat">
            <span class="trae-import-num">${added}</span>
            <span class="trae-import-label">新增账号</span>
          </div>
          <div class="trae-import-stat">
            <span class="trae-import-num">${updated}</span>
            <span class="trae-import-label">更新凭证</span>
          </div>
          <div class="trae-import-stat">
            <span class="trae-import-num">0</span>
            <span class="trae-import-label">失败</span>
          </div>
        </div>
        <div class="trae-modal-actions">
          <button type="button" class="console-btn primary"
            onclick="closeModal(); activateTab('accounts')">去账号池查看</button>
          <button type="button" class="console-btn quiet" onclick="closeModal()">关闭</button>
        </div>
      </div>`, "max-w-lg");
  } else {
    toast(`导入完成：新增 ${added}，更新 ${updated}，${errs.length} 条失败`, "err");
    openModal(`
      <div class="trae-modal">
        <h3>导入完成（部分失败）</h3>
        <div class="trae-import-summary">
          <div class="trae-import-stat"><span class="trae-import-num">${added}</span>
            <span class="trae-import-label">新增账号</span></div>
          <div class="trae-import-stat"><span class="trae-import-num">${updated}</span>
            <span class="trae-import-label">更新凭证</span></div>
          <div class="trae-import-stat bad"><span class="trae-import-num">${errs.length}</span>
            <span class="trae-import-label">失败</span></div>
        </div>
        <div class="trae-modal-errors">
          <strong>以下条目未能写入号池</strong>
          ${errs.map(e => `<div>${esc(e.error || JSON.stringify(e))}</div>`).join("")}
        </div>
        <div class="trae-modal-actions">
          <button type="button" class="console-btn quiet" onclick="closeModal()">关闭</button>
        </div>
      </div>`, "max-w-2xl");
  }
  // 账号池 / 平台卡的数字都要立刻更新，否则用户点过去还是旧数
  if (window.WBPlatform) window.WBPlatform.refreshCounts();
  loadAccounts();
  if (typeof _activeTab !== "undefined" && _activeTab === "platforms") loadPlatformOverview();
}

async function traeRefreshAll() {
  toast("正在刷新所有 Trae 账号额度…");
  const r = await api("/api/trae/refresh-all", { method: "POST" });
  const { ok, data } = await safeJson(r);
  if (!ok) { toast("刷新失败", "err"); return; }
  toast(`刷新完成：成功 ${data.ok}，失败 ${data.failed}`);
  loadAccounts();
}

let _accountFilter = "all";function closeAccountMenu() {
  document.getElementById("accountBatchMenu").open = false;
}
function setAccountFilter(status) {
  _accountFilter = status;
  document.querySelectorAll("[data-account-filter]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.accountFilter === status));
  });
  renderAccPage(1);
}
document.addEventListener("click", event => {
  const menu = document.getElementById("accountBatchMenu");
  if (menu && menu.open && !menu.contains(event.target)) closeAccountMenu();
});
document.addEventListener("keydown", event => {
  const menu = document.getElementById("accountBatchMenu");
  if (event.key === "Escape" && menu && menu.open) {
    closeAccountMenu();
    menu.querySelector("summary").focus();
  }
});
function renderAccPage(p) {
  const term = (_accTerm = ($("#accSearch") ? $("#accSearch").value : "").trim().toLowerCase());
  const data = _accData.filter(a => (_accountFilter === "all" || a.status === _accountFilter)
    && (!term || (a.name||"").toLowerCase().includes(term) || (a.uid||"").toLowerCase().includes(term)));
  $("#filterAllCount").textContent = _accData.length;
  $("#filterActiveCount").textContent = _accData.filter(a => a.status === "active").length;
  $("#filterDisabledCount").textContent = _accData.filter(a => a.status === "disabled").length;
  const total = data.length, totalPages = Math.max(1, Math.ceil(total / PS));
  p = Math.min(Math.max(1, p), totalPages);
  _accountPage = p;
  const slice = data.slice((p - 1) * PS, p * PS);
  $("#accBody").innerHTML = slice.map(accRow).join("") ||
    `<tr><td colspan="6"><div class="account-empty"><strong>${term || _accountFilter !== "all" ? "没有匹配的账号" : "添加第一个账号"}</strong>${term || _accountFilter !== "all" ? "试试其他关键词，或切换账号状态筛选。" : "通过手机号登录，或导入已有账号备份即可开始。"}</div></td></tr>`;
  $("#accPager").innerHTML = pagerHtml(total, p, totalPages, "renderAccPage");
}
async function refreshAcc(id){
  const r = await api("/api/accounts/"+id+"/refresh",{method:"POST"});
  const { ok, data } = await safeJson(r);
  if (r.ok) {
    // 刷新现在会一并更新积分到期快照（后端 with_expiry 默认开），
    // 所以提示里带上「7 天内到期」的数字 —— 这才是用户刷新想确认的事。
    const soon = Number((data && data.credits_expiring_soon) || 0);
    toast(data?.warnings?.length ? '余额已刷新，到期快照未完整更新' : soon > 0 ? `已刷新：${soon} 积分将在 7 天内到期` : "余额与积分到期快照已刷新");
  } else {
    const detail = data?.detail;
    toast(typeof detail === 'object' ? detail.message : '刷新失败' + (detail ? '：' + detail : ''), 'err');
    if (detail?.upstream) openModal(`<h3>账号余额刷新失败</h3><p class="limit-note">本网关记录的上游响应如下：</p>${upstreamEvidenceHtml(detail.upstream)}`, 'max-w-3xl');
  }
  if (r.ok && data?.warnings?.length) openModal(`<h3>余额已刷新，到期快照未完整更新</h3>${data.warnings.map(upstreamEvidenceHtml).join('')}`, 'max-w-3xl');
  if (r.ok) { loadAccounts(); if (_creditStats) loadCreditStats(); }
}
function healthStageText(item) {
  const stages = item.stages || {};
  const label = {balance:'积分', models:'模型列表', conversation:'真实对话'};
  return Object.keys(label).map(key => {
    const stage = stages[key] || {};
    if (stage.ok && key === 'balance') return `${label[key]}通过 ${stage.remain ?? 0}/${stage.total ?? 0}`;
    if (stage.ok && key === 'models') return `${label[key]}通过 ${stage.count ?? 0} 个`;
    if (stage.ok && key === 'conversation') return `${label[key]}通过 ${stage.model || ''}${stage.free_model ? '（免费）' : '（可能消耗少量积分）'}`;
    return `${label[key]}失败${stage.status ? ' HTTP ' + stage.status : ''}${stage.code ? ' / ' + stage.code : ''}${stage.message ? '：' + stage.message : ''}`;
  }).join(' · ') || item.reason || '';
}
function healthStageIcon(item) {
  return item.healthy
    ? '<span class="wb-icon text-emerald-500 shrink-0"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg></span>'
    : item.status === 'skipped'
      ? '<span class="wb-icon text-slate-400 shrink-0"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg></span>'
      : '<span class="wb-icon text-red-500 shrink-0"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg></span>';
}
function healthCheckOptions(submitUrl, title, total) {
  return {
    title, submitUrl, body: {},
    label: item => item.account || item.account_id,
    detail: item => healthStageText(item),
    amount: item => item.healthy ? '<span class="text-emerald-600 font-semibold">健康</span>' : '',
    icon: healthStageIcon,
    doneText: job => job.result?.summary || `检查完成：${job.result?.healthy || 0}/${total} 个账号健康`,
    summaryHtml: job => job.result?.summary || '',
    doneToast: job => job.result?.summary || '健康检查完成',
    onFinish: () => loadAccounts(),
  };
}
async function healthCheckAcc(id) {
  if (!await uiConfirm({kind:'info', danger:false, title:'账号三项健康检查',
      message:'依次调用积分、模型列表和一次最大输出 1 token 的真实对话。优先免费模型；没有免费模型时可能消耗少量积分。失败只显示诊断，不会因此禁用账号；三项通过可恢复由自动失效判断禁用的账号。',
      okText:'开始检查'})) return;
  await accountBatchAction(() => runJob(healthCheckOptions(
    `/api/accounts/${id}/health-check`, '账号三项上游健康检查', 1)));
}
async function healthCheckAll() {
  if (!_accData.length) { toast('没有可检查的账号', 'err'); return; }
  if (!await uiConfirm({kind:'info', danger:false, title:'一键健康检查',
      message:`将对全部 ${_accData.length} 个账号依次调用积分、模型列表和一次最大输出 1 token 的真实对话。优先免费模型；没有免费模型时可能消耗少量积分。检查失败只显示诊断，不会因此禁用账号。`,
      okText:'开始检查'})) return;
  await accountBatchAction(() => runJob(healthCheckOptions(
    '/api/accounts/health-check-batch', '账号池三项上游健康检查', _accData.length)));
}
async function toggleAcc(id,st){ await api("/api/accounts/"+id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:st})}); loadAccounts(); }
async function delAcc(id){ if(!await uiConfirm({message:"确认删除该账号？", title:"删除账号"}))return; const r=await api("/api/accounts/"+id,{method:"DELETE"}); toast(r.ok?"已删除":"删除失败",r.ok?"ok":"err"); if(r.ok) loadAccounts(); }
async function injectAcc(id){
  if(!await uiConfirm({kind:"warn", danger:false, title:"注入本机客户端",
      message:"确认把该账号注入到本机 WorkBuddy 客户端？\n会先自动备份当前活动登录态（*.bak-时间戳）。", okText:"确认注入"})) return;
  const r = await api("/api/accounts/"+id+"/inject",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirm:true})});
  const d = await r.json().catch(()=>({}));
  if(r.ok){ toast(`已注入到本机客户端（备份: ${d.backup?d.backup.split(/[\\/]/).pop():"无"}）`); }
  else { toast("注入失败: "+(d.detail||""), "err"); }
}

/* 猫猫旅行：同意协议 → 首次领养(+300) → 派猫 → 领奖。逐步展示结果。 */
function catStepRow(s) {
  const icon = s.skipped ? '<span class="wb-icon text-slate-400"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg></span>'
             : s.ok      ? '<span class="wb-icon text-emerald-500"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg></span>'
                         : '<span class="wb-icon text-red-500"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg></span>';
  const name = { agreement:"同意协议", adopt:"首次领养", status:"查询状态",
                 depart:"派出旅行", claim:"领取奖励", info:"查询猫档案" }[s.step] || s.step;
  const rw = s.reward > 0 ? `<span class="ml-2 font-semibold text-amber-600">+${s.reward} 积分</span>` : "";
  return `<div class="flex items-start gap-2 py-1.5 border-b last:border-0">
    <span class="mt-0.5">${icon}</span>
    <div class="flex-1 text-sm">
      <span class="font-medium text-slate-700">${name}</span>
      <span class="text-slate-500 ml-1">${esc(s.message||"")}</span>${rw}
    </div></div>`;
}
function catResultHtml(d) {
  const steps = (d.steps || []).map(catStepRow).join("");
  const head = d.credits > 0
    ? `<div class="mb-2 text-emerald-600 font-semibold"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg></span>${esc(d.summary||"")}</div>`
    : `<div class="mb-2 ${d.ok?'text-slate-500':'text-red-500'} font-semibold">${esc(d.summary||"")}</div>`;
  const bal = d.balance_remain !== undefined
    ? `<div class="mt-3 text-xs text-slate-400">当前剩余积分：${d.balance_remain}</div>` : "";
  return head + `<div class="rounded-lg border bg-slate-50 px-3 py-1">${steps}</div>` + bal;
}
async function catTravel(id) {
  const name = (accById(id) || {}).name || id;
  openModal(`<h3 class="font-bold mb-1"><span class="wb-icon mr-1 text-pink-600"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75Z"/></svg></span> 猫猫旅行 — ${esc(name)}</h3>
    <p class="text-xs text-slate-400 mb-3">正在执行：同意协议 → 首次领养 → 派出 → 领奖...</p><div id="catBody"></div>
    <div class="flex justify-end mt-4"><button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">关闭</button></div>`);
  try {
    const r = await api("/api/accounts/" + id + "/cat-travel", { method: "POST" });
    const { ok, data: d } = await safeJson(r);
    if (!r.ok) { $("#catBody").innerHTML = `<p class="text-red-500 text-sm">执行失败: ${esc(d.detail||"未知错误")}</p>`; return; }
    $("#catBody").innerHTML = catResultHtml(d);
    /* 关键：领取成功必须有明确提示，不能只体现在积分明细里 */
    if (d.credits > 0) toast(`领取成功，获得 ${d.credits} 积分`, "ok");
    else if (d.ok)      toast("执行完成，本次无新增积分", "ok");
    else                toast("执行失败：" + (d.summary || ""), "err");
    loadAccounts();
  } catch (e) {
    $("#catBody").innerHTML = `<p class="text-red-500 text-sm">执行异常: ${esc(String(e))}</p>`;
  }
}

