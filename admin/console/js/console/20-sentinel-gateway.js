/* ==========================================================================
   风控哨兵面板
   --------------------------------------------------------------------------
   两个诉求：**看得见**（哪些账号被风控、什么时候、什么原因）与
   **停得下**（一键暂停该平台，避免连坐扩大）。

   数据每次刷新现取，不做前端缓存 —— 封控是分钟级事件，缓存只会误导。
   ========================================================================== */
let _sentinelTimer = null;
let _sentinelData = null;

async function loadSentinel(force) {
  const summary = $("#sentinelSummary");
  if (!summary) return;
  try {
    const r = await api("/api/sentinel/status?window=300");
    if (!r.ok) return;
    const data = await r.json();
    _sentinelData = data;
    renderSentinel(data);
    // 侧栏角标：没打开面板也能看到「有账号正在被风控」
    const n = data.accounts_affected || 0;
    setSideDot("#sideSentinelDot", n);
    const dot = $("#sideSentinelDot");
    if (dot) dot.title = n > 0 ? `${n} 个账号近期被上游风控` : "";
  } catch (e) {
    summary.innerHTML = `<p class="fs-12" style="color:var(--danger)">哨兵加载失败：${esc(e.message)}</p>`;
  }
}

/** 最近一次风控信号的人话时间（没有信号就是「—」）。 */
function sentinelLastSignalText(data) {
  const stamps = (data.accounts || []).map(a => Number(a.last_ts || 0)).filter(Boolean);
  if (!stamps.length) return "—";
  const age = Math.max(0, Math.floor(Date.now() / 1000 - Math.max(...stamps)));
  if (age < 60) return "刚刚";
  if (age < 3600) return Math.floor(age / 60) + " 分钟前";
  return Math.floor(age / 3600) + " 小时前";
}

function renderSentinel(data) {
  const paused = data.pause || {};
  const pausedKeys = Object.keys(paused);
  const tripped = data.tripped;

  $("#sentinelSummary").innerHTML = `
    <div class="sentinel-banner ${tripped ? "danger" : "ok"}">
      <span class="sentinel-banner-icon">${tripped ? "!" : "✓"}</span>
      <div class="sentinel-banner-body">
        <strong>${tripped
          ? `检测到批次级封控：最近 ${Math.round((data.window_seconds || 300) / 60)} 分钟内有 ${data.accounts_affected} 个账号被风控`
          : "未检测到批次级封控"}</strong>
        <span>阈值 ${data.threshold} 个账号 / ${Math.round((data.window_seconds || 300) / 60)} 分钟${
          tripped ? ` · 建议暂停 ${data.suggested_pause_seconds} 秒止损` : ""}</span>
      </div>
      <div class="sentinel-banner-actions">
        ${tripped
          ? `<button type="button" class="console-btn danger" onclick="sentinelPause()">立即暂停止损</button>`
          : ""}
        ${pausedKeys.length
          ? pausedKeys.map(k => `<button type="button" class="console-btn quiet"
              onclick="sentinelResume('${esc(k === "all" ? "" : k)}')">恢复 ${esc(k)}</button>`).join("")
          : ""}
      </div>
    </div>
    <div class="sentinel-stats">
      <div class="sentinel-stat"><span>${data.total_events || 0}</span><em>信号总数</em></div>
      <div class="sentinel-stat"><span>${data.accounts_affected || 0}</span><em>涉及账号</em></div>
      <div class="sentinel-stat"><span>${Object.keys(data.by_code || {}).length}</span><em>原因种类</em></div>
      <div class="sentinel-stat"><span>${data.redis ? "Redis" : "内存"}</span><em>存储后端</em></div>
      <div class="sentinel-stat"><span>${esc(sentinelLastSignalText(data))}</span><em>最近信号</em></div>
      <div class="sentinel-stat${pausedKeys.length ? " is-warn" : ""}"><span>${pausedKeys.length || 0}</span><em>暂停中的平台</em></div>
    </div>`;

  // 账号表：谁处于什么阶段
  const accounts = data.accounts || [];
  $("#sentinelAccounts").innerHTML = `
    <div class="sentinel-card-head"><h3>受影响账号</h3>
      <span>按最近一次信号排序</span></div>
    ${accounts.length ? `<div class="sentinel-table-wrap"><table class="tbl">
      <thead><tr><th>账号</th><th>最近信号</th><th>次数</th><th>首次</th><th>最近</th></tr></thead>
      <tbody>${accounts.map(item => `<tr>
        <td class="sentinel-acc">#${item.account_id}</td>
        <td><span class="sentinel-code">${esc(item.code || item.kind || "-")}</span>
          ${esc(item.label || "")}</td>
        <td class="tnum">${item.count}</td>
        <td class="sentinel-ts">${fmtTime(new Date((item.first_ts || 0) * 1000).toISOString().slice(0, 19))}</td>
        <td class="sentinel-ts">${fmtTime(new Date((item.last_ts || 0) * 1000).toISOString().slice(0, 19))}</td>
      </tr>`).join("")}</tbody></table></div>`
    : `<p class="sentinel-empty">最近没有账号被上游风控。</p>`}`;

  // 原始事件流：排障时能定位到具体某次请求
  const events = data.recent || [];
  $("#sentinelEvents").innerHTML = `
    <div class="sentinel-card-head"><h3>信号明细</h3>
      <span>最近 ${events.length} 条（Redis 保留 15 分钟，自动过期）</span></div>
    ${events.length ? `<div class="sentinel-table-wrap"><table class="tbl">
      <thead><tr><th>时间</th><th>账号</th><th>类型</th><th>码</th><th>模型</th><th>细节</th></tr></thead>
      <tbody>${events.map(ev => `<tr>
        <td class="sentinel-ts">${fmtTime(new Date((ev.ts || 0) * 1000).toISOString().slice(0, 19))}</td>
        <td class="sentinel-acc">#${ev.account_id}</td>
        <td>${esc(ev.kind || "")}</td>
        <td><span class="sentinel-code">${esc(ev.code || "-")}</span></td>
        <td class="sentinel-model">${esc(ev.model || "-")}</td>
        <td class="sentinel-detail" data-tooltip="${esc(ev.detail ||"")}">${esc((ev.detail || "").slice(0, 90))}</td>
      </tr>`).join("")}</tbody></table></div>`
    : `<p class="sentinel-empty">暂无明细。</p>`}`;
}

async function sentinelPause(platform) {
  const cur = window.WBPlatform ? window.WBPlatform.current().platform : "";
  const target = platform || cur || "";
  const yes = await uiConfirm({
    title: "暂停该平台止损",
    message: `暂停 ${target || "全部平台"} 的上游请求 10 分钟？\n` +
             "暂停期间请求会直接返回 503，不会消耗账号额度、也不会打到上游。",
    okText: "暂停",
  });
  if (!yes) return;
  const r = await api("/api/sentinel/pause", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: target, seconds: 600, reason: "手动止损" }),
  });
  if (r.ok) { toast("已暂停，可随时恢复"); loadSentinel(true); loadOverview(); }
  else toast("暂停失败", "err");
}

async function sentinelResume(platform) {
  const r = await api("/api/sentinel/resume?platform=" + encodeURIComponent(platform || ""),
                      { method: "POST" });
  if (r.ok) { toast("已恢复"); loadSentinel(true); loadOverview(); }
  else toast("恢复失败", "err");
}

/* ==========================================================================
   平台网关（跨平台调度）
   --------------------------------------------------------------------------
   与「平台管理」的分工：
     平台管理 = 我有哪些平台、每个平台几个号
     平台网关 = 这些平台之间怎么调度（策略 / 优先级 / 禁用）

   数据来自 /api/gateway/*，后端负责实际排序（见 admin/platform/gateway_router.py）。
   前端只做展示与保存 —— 策略逻辑绝不在前端复刻一份，否则两处会算出不同顺序。
   ========================================================================== */
let _gwConfig = null;

async function loadGateway() {
  // 调度可视化：延后初始化，等策略网格渲染完再量尺寸
  setTimeout(() => {
    if (typeof gwInitTraffic === "function") gwInitTraffic(true);
  }, 220);

  try {
    const [cfgResp, orderResp] = await Promise.all([
      api("/api/gateway/config"),
      api("/api/gateway/order"),
    ]);
    if (!cfgResp.ok) {
      const host = $("#gwStrategies");
      if (host) host.innerHTML = `<p class="ov-note">配置加载失败（HTTP ${cfgResp.status}）</p>`;
      return;
    }
    _gwConfig = await cfgResp.json();
    const order = orderResp.ok ? (await orderResp.json()).items || [] : [];
    renderGatewayStrategies(_gwConfig);
    renderGatewayPlatforms(_gwConfig, order);
    renderGatewayOrder(order);
  } catch (e) {
    const host = $("#gwStrategies");
    if (host) host.innerHTML = `<p class="ov-note" style="color:var(--danger)">加载失败：${esc(e.message)}</p>`;
  }
}

function renderGatewayStrategies(cfg) {
  const host = $("#gwStrategies");
  if (!host) return;
  host.innerHTML = (cfg.strategies || []).map(item => `
    <button type="button" class="gw-strategy${item.value === cfg.strategy ? " active" : ""}"
        data-gw-strategy="${esc(item.value)}">
      <span class="gw-strategy-name">${esc(item.label)}</span>
      <span class="gw-strategy-desc">${esc(item.description)}</span>
    </button>`).join("");

  host.querySelectorAll("[data-gw-strategy]").forEach(node => {
    node.addEventListener("click", async () => {
      const strategy = node.dataset.gwStrategy;
      if (strategy === _gwConfig?.strategy) return;
      const r = await api("/api/gateway/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy }),
      });
      if (r.ok) {
        toast("策略已切换：" + node.querySelector(".gw-strategy-name").textContent);
        loadGateway();
        // 重建可视化并演示新策略的流向
        if (typeof gwOnStrategyChanged === "function") {
          gwOnStrategyChanged();
        }
      } else {
        toast("切换失败", "err");
      }
    });
  });
}

function renderGatewayPlatforms(cfg, order) {
  const host = $("#gwPlatforms");
  if (!host) return;
  const rank = {};
  (order || []).forEach((item, index) => { rank[item.platform] = index + 1; });
  const disabled = cfg.disabled || {};
  const priority = cfg.priority || {};

  // 平台列表来自 /api/gateway/config 的 platforms 字段（平台自己注册的），
  // 不是前端写死的 —— 新增平台自动出现在这里。
  const items = cfg.platforms || [];
  if (!items.length) {
    host.innerHTML = `<p class="ov-note">还没有接入平台</p>`;
    return;
  }

  host.innerHTML = items.map(item => {
    const off = Object.prototype.hasOwnProperty.call(disabled, item.id);
    const prio = Object.prototype.hasOwnProperty.call(priority, item.id)
      ? priority[item.id] : "";
    return `<div class="gw-platform-row${off ? " disabled" : ""}">
      <span class="gw-platform-logo">${window.WBPlatformIcons ? WBPlatformIcons.get(item.id) : ""}</span>
      <span class="gw-platform-name">${esc(item.label)}</span>
      <span class="gw-platform-rank">${off ? "已禁用" : (rank[item.id] ? "第 " + rank[item.id] + " 位" : "无可用账号")}</span>
      <label class="gw-priority">优先级
        <input type="number" min="0" max="9999" value="${esc(String(prio))}"
               data-gw-priority="${esc(item.id)}" placeholder="100">
      </label>
      <button type="button" class="gw-toggle ${off ? "on" : ""}"
              data-gw-toggle="${esc(item.id)}" data-gw-enabled="${off ? "1" : "0"}">
        ${off ? "启用" : "禁用"}
      </button>
    </div>`;
  }).join("");

  // 优先级：失焦时保存（避免每敲一个键就发一次请求）
  host.querySelectorAll("[data-gw-priority]").forEach(node => {
    node.addEventListener("change", async () => {
      const pid = node.dataset.gwPriority;
      const value = node.value.trim();
      const next = { ...(cfg.priority || {}) };
      if (value === "") delete next[pid];
      else next[pid] = Number(value) || 0;
      const r = await api("/api/gateway/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: next }),
      });
      if (r.ok) { toast("优先级已保存"); loadGateway(); }
      else toast("保存失败", "err");
    });
  });

  // 禁用 / 启用
  host.querySelectorAll("[data-gw-toggle]").forEach(node => {
    node.addEventListener("click", async () => {
      const pid = node.dataset.gwToggle;
      const currentlyOff = node.dataset.gwEnabled === "1";
      const action = currentlyOff ? "enable" : "disable";
      if (action === "disable") {
        const yes = await uiConfirm({
          title: "禁用平台网关",
          message: `禁用后该平台不再参与调度，它的模型权益将不可用。\n账号数据保留，随时可以恢复。`,
          okText: "禁用",
        });
        if (!yes) return;
      }
      const r = await api("/api/gateway/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: pid, reason: "控制台手动操作" }),
      });
      if (r.ok) {
        toast(currentlyOff ? "已启用" : "已禁用");
        loadGateway();
      } else {
        toast("操作失败", "err");
      }
    });
  });
}

function renderGatewayOrder(order) {
  const host = $("#gwOrder");
  if (!host) return;
  if (!order || !order.length) {
    host.innerHTML = `<p class="sentinel-empty">当前没有可用平台（全部被禁用或没有可用账号）</p>`;
    return;
  }
  host.innerHTML = order.map((item, index) => `
    <div class="gw-order-row">
      <span class="gw-order-rank">${index + 1}</span>
      <span class="gw-order-name">${esc(item.label || item.platform)}</span>
      <span class="gw-order-reason">${esc(item.reason || "")}</span>
      <span class="gw-order-meta">${item.usable || 0} 个可用 · 额度 ${item.balance_remain || 0}</span>
    </div>`).join("");
}

async function loadPlatformOverview() {
  // 平台概览卡片：**完全由平台自己声明**，前端只负责渲染。
  //
  // 改造前这里是两套写死的分支（`if (isTrae) {...} else {...}`），
  // 新增平台就得再加一个分支，而且前端必须认识每个平台的统计口径。
  // 现在数据来自 `GET /api/platforms/{id}/overview`，卡片由平台返回：
  // 加载对应网关 → 渲染卡片 → 平台增删自动反映，互不影响。
  const host = $("#platformOverview");
  if (!host || !window.WBPlatform) return;
  const cur = window.WBPlatform.current();
  const spec = window.WBPlatform.spec() || {};
  const platformId = cur.platform || spec.id || "";

  // 标题：平台名 + 固定区域（单区平台才拼区域后缀，避免「Trae 国内版 · 国内版」）
  const fixedRealm = cur.realm || spec.realm || "";
  const realmLabel = fixedRealm
    ? (spec.realm_label
       || (spec.realms || []).find(x => x.key === fixedRealm)?.label
       || ({ cn: "国内版", intl: "国际版" })[fixedRealm] || fixedRealm)
    : "";
  const titleLabel = spec.label || platformId || "";
  const showRealm = realmLabel && !titleLabel.includes(realmLabel);

  // 「扫描本机 / 导入 / 刷新额度」这些按钮作用于当前平台，挂在平台标题右侧；
  // 重绘前先把它们挪出 host，免得 innerHTML 把节点连同事件委托目标一起销毁。
  const actions = $("#platformActions");
  if (actions && host.contains(actions)) host.parentNode.insertBefore(actions, host);
  const dockActions = () => {
    const head = host.querySelector(".platform-overview-head");
    if (head && actions) head.appendChild(actions);
  };

  try {
    const r = await api("/api/platforms/" + encodeURIComponent(platformId) + "/overview");
    if (!r.ok) {
      host.innerHTML = `<p class="ov-note">该平台概览加载失败（HTTP ${r.status}）</p>`;
      return;
    }
    const data = await r.json();
    const cards = data.cards || [];

    host.innerHTML = `
      <div class="platform-overview-head">
        <div>
          <h2>${esc(titleLabel)}${showRealm ? " · " + esc(realmLabel) : ""}</h2>
          <p>${esc(spec.notes || "")}</p>
        </div>
      </div>
      ${cards.length
        ? `<div class="stat-grid">${cards.map(renderPlatformCard).join("")}</div>`
        : `<p class="ov-note">${esc(data.reason || "该平台暂未提供概览")}</p>`}`;
    dockActions();

    // 数值动画：只对「看起来是数字」的卡片做滚动，
    // 避免给「内置默认」「反向代理」这种文案做无意义的计数动画。
    cards.forEach(card => {
      const node = host.querySelector(`[data-card-key="${card.key}"] .stat-value`);
      if (!node) return;
      const raw = String(card.value ?? "").replace(/[,\s%]/g, "");
      const num = Number(raw);
      if (!Number.isFinite(num) || raw === "") return;
      const suffix = String(card.value).includes("%") ? "%" : "";
      animateNumber(node, num, {
        format: (n) => (suffix ? Math.round(n) + suffix
                              : Math.round(n).toLocaleString("zh-CN")),
      });
    });
  } catch (e) {
    host.innerHTML = `<p class="ov-note" style="color:var(--danger)">概览加载失败：${esc(e.message)}</p>`;
  }
}

/**
 * 渲染一张平台概览卡片。
 *
 * 所有字段都来自后端（平台自己声明），前端不认识任何具体平台 ——
 * 这是「新增平台前端不用改」的落点。
 */
function renderPlatformCard(card) {
  const tone = card.tone ? ` is-${card.tone}` : "";
  return `<div class="stat${tone}" data-card-key="${esc(card.key || "")}">
    <div class="stat-head">
      <span class="stat-label">${esc(card.label || "")}</span>
    </div>
    <div class="stat-value">${esc(String(card.value ?? "—"))}</div>
    ${card.sub ? `<div class="stat-sub">${esc(card.sub)}</div>` : ""}
  </div>`;
}

