/* ==========================================================================
   用量日志（服务端分页 + 按账号查询）
   --------------------------------------------------------------------------
   本次的三处改进（都对应原来真实的「慢 / 查不到」问题）：

   1. **按账号下拉**：只列「窗口内真的产生过请求」的账号，并带上请求数与
      最近使用时间。原来是一个自由文本框 + datalist，用户选中一个从没被
      用过的号会筛出空结果，以为功能坏了。
   2. **名称模糊匹配不再丢记录**：后端已改成返回完整 id 集合
      （原来 `.scalar()` 只取第一条），前端这次也把筛选值从「名称文本」
      换成「账号 id」，避免重名再一次造成歧义。
   3. **快速翻页**：日志量大时 `COUNT(*)` 本身就是一次完整索引扫描。
      关掉总数统计后，走 keyset 游标（`before_id`）翻页 ——
      `WHERE id < N ORDER BY id DESC LIMIT n` 只走主键索引，
      不再有 `OFFSET 100000` 那种「先扫掉十万行再丢弃」的开销。
   ========================================================================== */
let _logPage = 1, _logPageSize = 20;
let _logOpts = { accounts: [] };
let _logBeforeId = null;      // 当前页兼容游标
let _logCursors = new Map([[1, null]]); // page -> before_id，支持快速模式返回上一页
let _logSelReady = false;
let _logLoadSeq = 0;
let _logListController = null, _logAccountController = null, _logAccountSeq = 0;
let _logAccountsPromise = null, _logAccountsAt = 0, _logAccountsDays = null;
const _logTotals = new Map();
let _logUsageRevision = null, _logUsageDirty = false, _logUsageBusy = false, _logUsageAt = 0;
let _logSummaryDirty = true, _logSummaryAt = 0, _logSummaryBusy = false, _logSummarySeq = 0;
let _logSummaryController = null, _logSummarySignature = '';
const _logFolded = {summary:false};
/** 折叠/展开「按账号汇总」卡片（「请求动态」已下线，只剩这一张）。 */
function applyLogCard(name) {
  const box = $('#logSummary');
  const button = $('#logSummaryToggle');
  if (box) box.hidden = _logFolded[name];
  if (button) {
    button.setAttribute('aria-expanded', String(!_logFolded[name]));
    button.querySelector('[data-fold-label]').textContent = _logFolded[name] ? '展开 ▾' : '收起 ▴';
  }
}
function toggleLogCard(name) {
  if (!(name in _logFolded)) return;
  _logFolded[name] = !_logFolded[name];
  try { localStorage.setItem('wb_log_fold_'+name, String(_logFolded[name])); } catch(e) {}
  applyLogCard(name);
  if (!_logFolded[name]) loadLogSummary();
}
function logFilterSignature() {
  return JSON.stringify(['logModel','logKey','logIp','logStart','logEnd'].map(id=>$('#'+id)?.value || '').concat([
    uiSelectValue('logResult'), uiSelectValue('logDaysSel'), uiSelectValue('logAccountSel')
  ]));
}

/**
 * 用量表实时刷新：只探一个主键，变了才重拉首页。
 *
 * 「请求动态」面板**已下线**（设计决定）：风控哨兵那边有更完整的实时
 * 视图（拓扑 + 每平台计数 + 明细 + 进行中），这里再推一份是纯重复查询。
 * 移除后省掉：一条 SSE 长连接、每 0.5 秒一次的全量采样、
 * 以及整张表格的重复渲染。
 *
 * 保留的只有这个轻量探针：`include_history=false` 时后端只执行
 * `SELECT id ORDER BY id DESC LIMIT 1`，比原来的采样轻一个量级。
 */
let _logUsagePollTimer = null;
const _LOG_USAGE_POLL_MS = 5000;

function scheduleLogUsagePoll() {
  if (_logUsagePollTimer) clearTimeout(_logUsagePollTimer);
  _logUsagePollTimer = setTimeout(pollLogUsageRevision, _LOG_USAGE_POLL_MS);
}

// ===== 用量日志页：请求动态（实时区）=====
//
// 数据源与风控哨兵相同（/api/sentinel/status 的 traffic 段），不新增后端查询。
// 只有日志页处于激活状态时才轮询 —— 切走立即停，不留后台空转。
let _logLiveSource = null;
let _logLiveRows = new Map();

function stopLogLive() {
  if (_logLiveSource) {
    try { _logLiveSource.close(); } catch (e) { /* 已关闭 */ }
    _logLiveSource = null;
  }
}

/** 用 registry 式的合并：按 rid 覆盖，按 ts 倒序保留最近 12 条。 */
function _logLiveMerge(changed, removed) {
  (removed || []).forEach(rid => _logLiveRows.delete(String(rid)));
  (changed || []).forEach(row => {
    const rid = String(row.rid || "");
    if (rid) _logLiveRows.set(rid, row);
  });
  const all = Array.from(_logLiveRows.values());
  all.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
  if (all.length > 40) {
    all.slice(40).forEach(r => _logLiveRows.delete(String(r.rid || "")));
  }
  return all.slice(0, 12);
}

function _logLiveRender(rows, running) {
  const hint = $("#logLiveHint");
  if (hint) {
    hint.textContent = running > 0
      ? "进行中 " + running + " 个 · 实时推送"
      : "实时推送 · 最近 1 小时 " + _logLiveRows.size + " 条";
  }
  const host = $("#logLiveRecent");
  if (host) {
    host.innerHTML = rows.length
      ? rows.map(_logLiveRow).join("")
      : '<p class="sentinel-empty" style="padding:10px 2px">最近 1 小时还没有请求</p>';
  }
}

function _logLiveRenderPlatforms(platforms) {
  const counts = $("#logLivePlatforms");
  if (!counts || !platforms) return;
  counts.innerHTML = platforms.map(row => {
    const total = Number(row.requests || 0);
    const failed = Number(row.error || 0) + Number(row.timeout || 0);
    // 结构：左「平台名」+ 右「数字 [失败N]」。
    // **失败数必须是独立一块**，不能和总数挤在同一段文本里 ——
    // 之前写成 `29 11 失败`，两者之间只有一个空格，窄屏下会连成一片。
    return `<div class="live-platform-count" data-tooltip="${esc(row.label || row.platform)} · 最近 1 小时">
      <span class="lpc-name">${esc(String(row.label || row.platform).replace(/\s*(国内版|国际版|中国版)/, ""))}</span>
      <span class="lpc-values">
        <b class="lpc-total">${total}</b>
        ${failed ? `<em class="lpc-fail" data-tooltip="失败（错误 + 超时）">${failed} 失败</em>` : ""}
      </span>
    </div>`;
  }).join("");
}

/** 一条实时请求的单行渲染。
 *
 *  刻意复用哨兵的 `live-request-*` 类与 `sentinelToneOf()` / `sentinelClock()`：
 *  同一个数据源就该长一个样，用户在两个面板之间切换时不用重新认。
 *
 *  ## 列（7 列，与 CSS 的 `.live-request-row.with-duration` 网格对应）
 *
 *      时间 | Key | 客户端 IP | 模型 | 平台 | 耗时 | 状态
 *
 *  ## 阶段（stage）
 *
 *  服务端 `traffic_stats` 会推进 stage：
 *      接收 -> 排队 -> 转发上游 -> 回传中 -> 完成
 *  面板据此显示「当前卡在哪一步」，而不是只有「进行中/成功」两态。
 *  拿不到 stage 的老数据按 outcome 兜底。
 */
function _logLiveRow(item) {
  const tone = sentinelToneOf(item);
  const status = Number(item.status || 0);
  const running = item.outcome === "running";
  // 阶段文案：优先用服务端给的 stage，没有就按 outcome 推
  const STAGE_TEXT = {
    received: "已接收",
    waiting: "排队选号",
    upstream: "转发上游",
    streaming: "回传中",
    done: "",
  };
  const stage = String(item.stage || "");
  let label;
  if (running) {
    label = STAGE_TEXT[stage] || "进行中";
  } else if (item.outcome === "timeout") {
    label = "超时";
  } else {
    label = status ? String(status) : (item.outcome || "—");
  }
  // 字段名以 traffic_stats.snapshot() 为准：elapsed_ms（毫秒，浮点）。
  const ms = Number(item.elapsed_ms || item.latency_ms || item.latency || 0);
  const runningCls = running ? " live-request-running" : "";
  // 进行中的请求：`elapsed_ms` 由 mark_stage 每次推进时刷新，
  // 所以这里能显示「已跑了多久」，比一直显示「…」有用得多。
  const msText = ms > 0 ? fmtDuration(ms) : (running ? "…" : "—");
  const keyLabel = String(item.key_label || "").trim();
  const ip = String(item.client_ip || "").trim();
  // 平台：请求刚进来时还选不出平台（选路在后面），
  // 这时显示「选路中」比显示 `unknown` 清楚 —— 后者看着像统计错了。
  const platformText = String(item.platform || "").trim();
  const platformLabel = (platformText && platformText !== "unknown")
    ? platformText : (running ? "选路中" : "—");
  return `<div class="live-request-row with-duration${runningCls}">
    <span class="live-request-time">${sentinelClock(item.ts)}</span>
    <span class="live-request-key" title="${esc(keyLabel)}">${keyLabel ? esc(keyLabel) : "—"}</span>
    <span class="live-request-ip tnum" title="${esc(ip)}">${ip ? esc(ip) : "—"}</span>
    <span class="live-request-model" data-tooltip="${esc(item.error || item.path || "")}">${esc(item.model || item.path || "—")}</span>
    <span class="live-request-platform">${esc(platformLabel)}</span>
    <span class="live-request-ms">${esc(msText)}</span>
    <span class="live-request-status ${tone}">${esc(label)}</span>
  </div>`;
}

/**
 * 日志页实时区：**SSE 长连接**，不再轮询。
 *
 * 轮询的两个代价：没有请求时也在持续打接口（多开标签页更明显），
 * 以及事件落在两次轮询之间时要等下一拍。SSE 用一条长连接，
 * 服务端只在内容变化时推一帧，空闲时几乎零流量。
 *
 * 兼容性兜底：`EventSource` 不可用（极老的 WebView）时退回 3 秒轮询，
 * 而不是让区域直接空着。
 */
function startLogLive() {
  stopLogLive();
  _logLiveRows = new Map();
  const host = $("#logLiveRecent");
  if (host) host.innerHTML = '<p class="sentinel-empty" style="padding:10px 2px">正在连接实时通道…</p>';

  if (typeof EventSource === "undefined" || !TOKEN) {
    // 兜底：没有 EventSource 就退回轮询（频率低于原来，减少空转）
    let timer = null;
    const tick = async () => {
      if (document.hidden || document.documentElement.dataset.activeTab !== "logs") {
        timer = setTimeout(tick, 3000); return;
      }
      try {
        const r = await api("/api/sentinel/traffic?window=3600");
        const { ok, data } = await safeJson(r);
        if (ok && data) {
          _logLiveMerge(data.recent || [], []);
          _logLiveRenderPlatforms(data.platforms || []);
          _logLiveRender(_logLiveMerge([], []), Number(data.running || 0));
        }
      } catch (e) { /* 下一拍再试 */ }
      timer = setTimeout(tick, 3000);
    };
    tick();
    _logLiveSource = { close: () => clearTimeout(timer) };
    return;
  }

  const url = "/api/sentinel/traffic/stream?window=3600";
  const source = new EventSource(url);
  _logLiveSource = source;

  source.onmessage = (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch (e) { return; }
    if (payload.type === "snapshot") {
      _logLiveRows = new Map();
      (payload.recent || []).forEach(r => {
        if (r.rid) _logLiveRows.set(String(r.rid), r);
      });
      _logLiveRenderPlatforms(payload.platforms || []);
      _logLiveRender(_logLiveMerge([], []), Number(payload.running || 0));
    } else {
      const rows = _logLiveMerge(payload.changed || [], payload.removed || []);
      if (payload.platforms) _logLiveRenderPlatforms(payload.platforms);
      _logLiveRender(rows, Number(payload.running || 0));
    }
  };

  source.onerror = () => {
    const hint = $("#logLiveHint");
    if (hint) hint.textContent = "实时通道断开，正在重连…";
    // EventSource 自带重连；连续失败时它自己会放弃，这里不做额外处理
  };
}

async function pollLogUsageRevision() {
  _logUsagePollTimer = null;
  if (document.hidden
      || document.documentElement.dataset.activeTab !== 'logs'
      || !TOKEN) {
    return;
  }
  try {
    const r = await api('/api/logs/requests?include_history=false');
    const { ok, data } = await safeJson(r);
    if (!ok) throw new Error('revision unavailable');
    const rev = data && data.usage_revision;
    if (rev != null && _logUsageRevision !== null && rev !== _logUsageRevision) {
      _logUsageDirty = true;
      _logSummaryDirty = true;
    }
    if (rev != null) _logUsageRevision = rev;
    if (_logUsageDirty && _logPage === 1 && !_logUsageBusy && _logSelReady) {
      _logUsageBusy = true;
      Promise.resolve(loadLogs(1, true)).finally(() => { _logUsageBusy = false; });
    }
    if (_logSummaryDirty && !_logFolded.summary
        && Date.now() - _logSummaryAt >= 30000) {
      loadLogSummary(true);
    }
  } catch (e) {
    // 网络抖动：下一轮再试，不打断页面
  } finally {
    if (document.documentElement.dataset.activeTab === 'logs') scheduleLogUsagePoll();
  }
}

function startLogActivity() {
  if (document.documentElement.dataset.activeTab !== 'logs' || !TOKEN) return;
  // 两条独立节奏：
  //   pollLogUsageRevision —— 5 秒探一次主键，变了才重拉表格（省查询）
  //   startLogLive         —— SSE 长连接推送上方实时区（事件驱动，非轮询）
  pollLogUsageRevision();
  startLogLive();
}

/** 离开日志页时停掉实时区，避免后台空转。 */
function stopLogActivity() {
  if (_logUsagePollTimer) {
    clearTimeout(_logUsagePollTimer);
    _logUsagePollTimer = null;
  }
  stopLogLive();
}


/** 只渲染一次：账号与时间范围两个下拉。 */
function initLogSelects() {
  if (_logSelReady) return;
  fillLogFilterOptions();
  const daysBox = $("#logDaysSel");
  if (daysBox) daysBox.outerHTML = uiSelectHTML("logDaysSel", {
    value: "today",
    options: [
      { value: "today", label: "今日（自然日）" },
      { value: "1", label: "近 1 天" }, { value: "3", label: "近 3 天" },
      { value: "7", label: "近 7 天" }, { value: "30", label: "近 30 天" },
      { value: "0", label: "不限时间" },
    ],
    onChange: () => {
      _logBeforeId = null; _logCursors = new Map([[1, null]]);
      loadLogAccounts(true).catch(() => {}); loadLogs(1);
    },
  });
  const resultBox = $("#logResult");
  if (resultBox) resultBox.outerHTML = uiSelectHTML("logResult", {
    value: "",
    options: [
      { value: "", label: "全部结果" },
      { value: "error", label: "仅错误" },
      { value: "success", label: "仅成功" },
    ],
    onChange: () => loadLogs(1),
  });
  const accountBox = $("#logAccountSel");
  if (accountBox && !_uiSelectMap.has("logAccountSel")) accountBox.outerHTML = uiSelectHTML("logAccountSel", {
    value: "", options: [{ value: "", label: "账号选项加载中…" }], onChange: () => loadLogs(1),
  });
  // 平台筛选：默认「全部平台」（= 全网关共享口径）。选项来自 /api/platforms，
  // 值用落库平台名（trae / qoder / loomy…），与 usage_logs.platform 对齐。
  const platformBox = $("#logPlatformSel");
  if (platformBox && !_uiSelectMap.has("logPlatformSel")) {
    platformBox.outerHTML = uiSelectHTML("logPlatformSel", {
      value: "", options: [{ value: "", label: "全部平台" }], onChange: () => loadLogs(1),
    });
    fillLogPlatformOptions().catch(() => {});
  }
  _logSelReady = true;
}

/** 平台下拉选项：一次拉全平台清单，之后不再重复请求。 */
let _logPlatformLoaded = false;
//: 落库平台名 -> 展示名（筛选提示与表格徽标共用）
let _logPlatformLabels = {};
async function fillLogPlatformOptions(force) {
  if (_logPlatformLoaded && !force) return;
  let items = [];
  try {
    const r = await api("/api/platforms");
    const { ok, data } = await safeJson(r);
    if (ok && data && Array.isArray(data.items)) items = data.items;
  } catch (e) { return; }
  if (!items.length) return;
  _logPlatformLoaded = true;
  // 同一个 storage 平台只留一项（trae-cn/trae-intl 存的是同一个 trae）
  const seen = new Set();
  const options = [{ value: "", label: "全部平台" }];
  items.forEach(item => {
    const storage = String(item.storage_platform || item.id || "").toLowerCase();
    if (!storage || seen.has(storage)) return;
    seen.add(storage);
    options.push({ value: storage, label: item.label || storage });
    _logPlatformLabels[storage] = item.label || storage;
  });
  const cur = uiSelectValue("logPlatformSel") || "";
  const box = $("#logPlatformSel");
  if (box) box.outerHTML = uiSelectHTML("logPlatformSel", {
    value: options.some(o => o.value === cur) ? cur : "",
    options,
    onChange: () => loadLogs(1),
  });
}

/** 按账号下拉：选项来自 /api/logs/accounts（窗口内有记录的账号）。 */
function loadLogAccounts(force = false) {
  const rawDays = uiSelectValue("logDaysSel") || "1";
  const days = rawDays === "0" ? 0 : (parseInt(rawDays, 10) || 1);
  if (_logAccountsPromise && _logAccountsDays === days) return _logAccountsPromise;
  if (!force && _logAccountsDays === days && Date.now() - _logAccountsAt < 5000) return Promise.resolve();
  if (_logAccountController) _logAccountController.abort();
  const seq = ++_logAccountSeq;
  const controller = new AbortController();
  _logAccountController = controller;
  _logAccountsDays = days;
  const task = (async () => {
  let items = [];
  try {
    const r = await api(`/api/logs/accounts?days=${days}&compact=true`, {signal:controller.signal});
    const { ok, data } = await safeJson(r);
    if (ok) items = data.items || [];
  } catch (e) { if (e && e.name === 'AbortError') return; /* 选项拉取失败不阻塞列表 */ }
  if (seq !== _logAccountSeq) return;
  _logOpts.accounts = items;

  const cur = uiSelectValue("logAccountSel") || "";
  const vals = items.map(x => String(x.id));
  const keep = (cur && vals.includes(cur)) ? cur : "";
  const box = $("#logAccountSel");
  if (box) {
    box.outerHTML = uiSelectHTML("logAccountSel", {
      value: keep,
      options: [{ value: "", label: `全部账号（${items.length} 个有记录）` }].concat(
        items.map(x => ({
          value: String(x.id),
          // 选项里直接带上「请求数 · 积分」，让用户**选之前**就知道值不值得点
          label: x.requests == null ? x.name : `${x.name} · ${x.requests} 次 · ${fmtCredit(x.credits)} 积分`,
        }))),
      onChange: () => loadLogs(1),
    });
  }
  })();
  _logAccountsPromise = task.finally(() => {
    if (seq === _logAccountSeq) {
      _logAccountController = null;
      _logAccountsPromise = null;
      _logAccountsAt = Date.now();
    }
  });
  return _logAccountsPromise;
}

/** 日志表当前列数：选了具体平台时「平台」列隐藏，占位格要跟着减一。 */
function _logColCount() {
  return (uiSelectValue("logPlatformSel") || "") ? 10 : 11;
}

/** 平台列显隐：只在「全部平台」口径下显示，筛成单平台后自动收起。 */
function syncLogPlatformColumn() {
  const table = document.querySelector(".log-table");
  if (!table) return;
  table.classList.toggle("hide-platform", Boolean(uiSelectValue("logPlatformSel") || ""));
}

/** 当前筛选 → query string，并生成一句人话提示。 */
function _logQuery() {
  const daysRaw = uiSelectValue("logDaysSel") || "today";
  const isToday = daysRaw === "today";
  const days = parseInt(daysRaw, 10) || 0;
  const accountId = uiSelectValue("logAccountSel") || "";
  const platform = uiSelectValue("logPlatformSel") || "";
  const model = ($("#logModel") ? $("#logModel").value : "").trim();
  const key = ($("#logKey") ? $("#logKey").value : "").trim();
  const ip = ($("#logIp") ? $("#logIp").value : "").trim();
  const start = ($("#logStart") ? $("#logStart").value : "").trim();
  const end = ($("#logEnd") ? $("#logEnd").value : "").trim();
  const fast = $("#logFastMode") ? $("#logFastMode").checked : false;

  const p = new URLSearchParams({ page: _logPage, page_size: _logPageSize });
  const result = uiSelectValue("logResult") || "";
  if (result) p.set("result", result);
  if (platform) p.set("platform", platform);
  if (accountId) p.set("account_id", accountId);
  if (model) p.set("model", model);
  if (key) p.set("key", key);
  if (ip) p.set("client_ip", ip);
  // 时间范围：显式日期优先，「今日」= 北京时间 00:00 起的自然日（与账号池
  // 「今日已用」同一口径），否则按「近 N 天」滚动窗口（0 = 不限）
  if (start) p.set("start", start + " 00:00:00");
  else if (isToday) {
    const t = new Date(Date.now() + 8 * 3600000);
    const cnMidnight = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - 8 * 3600000;
    p.set("start", new Date(cnMidnight).toISOString());
  }
  else if (days > 0) {
    const d0 = new Date(Date.now() - days * 86400000);
    p.set("start", d0.toISOString());
  }
  if (end) p.set("end", end + " 23:59:59");
  if (fast) {
    p.set("with_total", "false");
    const cursor = _logCursors.get(_logPage);
    if (cursor) p.set("before_id", cursor);
  }

  const acc = (_logOpts.accounts || []).find(x => String(x.id) === accountId);
  const conds = [];
  if (platform) conds.push(`平台=${_logPlatformLabels[platform] || platform}`);
  if (acc) conds.push(`账号=${acc.name}`);
  if (model) conds.push(`模型=${model}`);
  if (key) conds.push(`Key=${key}`);
  if (ip) conds.push(`IP=${ip}`);
  if (start || end) conds.push(`日期=${start || "…"}~${end || "…"}`);
  else if (isToday) conds.push("今日（自然日）");
  else if (days > 0) conds.push(`近 ${days} 天`);
  if (fast) conds.push("快速翻页");
  return { qs: p.toString(), conds };
}

async function loadLogs(page, silent = false) {
  const loadSeq = ++_logLoadSeq;
  if (_logListController) _logListController.abort();
  const controller = new AbortController();
  _logListController = controller;
  initLogSelects();
  if (!_logSelReady) return;
  syncLogPlatformColumn();
  _logPage = Math.max(1, Number(page) || 1);
  if (_logPage === 1) {
    _logBeforeId = null;
    _logCursors = new Map([[1, null]]);
  }
  // 账号选项是辅助筛选，不能阻塞日志首屏。它在后台更新下拉，列表先按当前条件返回。
  if (!_logOpts.accounts.length && !_logAccountsPromise) loadLogAccounts().catch(() => {});
  if (loadSeq !== _logLoadSeq) return;

  const { qs, conds } = _logQuery();
  const filterSignature = logFilterSignature();
  const revision = _logUsageRevision;
  const params = new URLSearchParams(qs);
  const fast = Boolean($("#logFastMode") && $("#logFastMode").checked);
  const cachedStats = !fast ? _logTotals.get(filterSignature) : null;
  const useCachedStats = cachedStats && Date.now() - cachedStats.at < 5000;
  if (silent || fast || useCachedStats) params.set('with_total', 'false');
  const hint = $("#logFilterHint");
  if (hint) {
    if (conds.length) {
      hint.classList.remove("hidden");
      hint.innerHTML = `<span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/></svg></span>已筛选：${esc(conds.join("，"))}`;
    } else hint.classList.add("hidden");
  }

  const body = $("#logBody");
  if (body && !silent) body.innerHTML = `<tr><td colspan="${_logColCount()}" class="px-4 py-8 text-center" style="color:var(--fg-subtle)">加载中...</td></tr>`;
  let d;
  try {
    const r = await api("/api/logs?" + params, {signal:controller.signal});
    const { ok, data } = await safeJson(r);
    if (loadSeq !== _logLoadSeq || filterSignature !== logFilterSignature()) return;
    if (!ok) {
      if (body && !silent) body.innerHTML = `<tr><td colspan="${_logColCount()}" class="px-4 py-8 text-center text-red-500">加载失败：${esc(data.detail || "")}</td></tr>`;
      return;
    }
    d = data;
    if (d.total != null && d.stats && !fast) {
      _logTotals.set(filterSignature, {at:Date.now(), total:d.total, stats:d.stats});
      if (_logTotals.size > 32) _logTotals.delete(_logTotals.keys().next().value);
    } else if (useCachedStats) {
      // **实时刷新也必须保住总数**。
      //
      // 静默刷新（每 5 秒探到新记录才触发）走的是 `with_total=false`
      // —— 不重算总数是为了快，但以前这里只在 `!silent` 时把缓存的总数补回来，
      // 于是每一次实时刷新都会让分页条从「共 N 条 · 1 2 3 …」退化成
      // 「第 1 页 / 已到末尾」：用户看到的就是「分页没了、数据不全」。
      // 缓存里有 5 秒内的总数，补回来即可，不必再查库。
      d.total = cachedStats.total;
      d.stats = cachedStats.stats;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    if (loadSeq !== _logLoadSeq) return;
    if (body && !silent) body.innerHTML = `<tr><td colspan="${_logColCount()}" class="px-4 py-8 text-center text-red-500">加载异常：${esc(String(e && e.message || e))}</td></tr>`;
    return;
  } finally {
    if (loadSeq === _logLoadSeq) _logListController = null;
  }
  fillLogFilterOptions();
  const stats = d.stats;
  if (revision === _logUsageRevision) _logUsageDirty = false;
  _logUsageAt = Date.now();
  $('#logStats').textContent = stats ? `当前筛选 · 共 ${stats.total} 次 · 成功 ${stats.success} 次 · 错误 ${stats.error} 次` : silent ? '用量记录已实时更新 · 总数统计请点击查询' : '快速翻页未统计总数';
  if (_logPage === 1 && !silent) { loadLogSummary(); }

  const total = d.total;              // null = 本次未统计
  const totalPages = total != null
    ? Math.max(1, Math.ceil(total / _logPageSize))
    : (d.has_more ? _logPage + 1 : _logPage);
  // 游标推进：保存每一页的起点，快速模式才能稳定地前后翻页。
  if (fast) {
    _logBeforeId = d.next_before_id || null;
    if (d.next_before_id) _logCursors.set(_logPage + 1, d.next_before_id);
  }

  _logLastItems = d.items || [];
  _logLastConds = conds;
  $("#logBody").innerHTML = _logLastItems.map(logRow).join("") ||
    `<tr><td colspan="${_logColCount()}"><div class="empty">${
      conds.length ? "当前筛选条件下没有记录，试试放宽时间范围或清除筛选" : "还没有请求记录（代理产生调用后这里会出现）"
    }</div></td></tr>`;

  $("#logPager").innerHTML = total != null
    ? pagerHtml(total, _logPage, totalPages, "loadLogs")
    : `<span>${fast ? "快速翻页模式（未统计总数）· " : ""}第 ${_logPage} 页${
        d.has_more ? "" : " · 已到末尾"}</span>
       <span class="flex gap-1">
         <button class="pg-btn px-2 py-1 rounded border text-xs ${_logPage<=1?'opacity-40 pointer-events-none':''} hover:bg-slate-50" onclick="loadLogs(${_logPage-1})"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></span></button>
         <button class="pg-btn px-2 py-1 rounded border text-xs ${d.has_more?'':'opacity-40 pointer-events-none'} hover:bg-slate-50" onclick="loadLogs(${_logPage+1})"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></span></button>
       </span>`;
}

/** 单条日志行（抽出来便于与汇总区共用配色）。 */
function hitRateHtml(l) {
  // 命中率 = 缓存命中 token / 输入(prompt) token；无输入或不支持的请求显示 —
  const pt = Number(l.prompt_tokens || 0), ct = Number(l.cached_tokens || 0);
  if (!pt) return `<span class="text-xs" style="color:var(--fg-subtle)">—</span>`;
  const pct = Math.min(100, ct / pt * 100);
  const tone = pct >= 60 ? "var(--ok)" : pct >= 30 ? "#d97706" : "var(--fg-subtle)";
  return `<div class="leading-tight tnum" data-tooltip="缓存命中 ${fmtK(ct)} / 输入 ${fmtK(pt)}">
    <span class="text-xs font-medium" style="color:${tone}">${pct.toFixed(2)}%</span>
    <div class="pkg-track" style="width:44px;margin:2px 0 0"><i style="width:${Math.max(pct,2).toFixed(1)}%;background:${tone}"></i></div>
  </div>`;
}
/**
 * 日志里的平台徽标。
 *
 * 日志面板展示**全部平台**的请求，必须标出每条走的是哪个上游 ——
 * 否则同一个模型名（`deepseek-v3`）出现在两个平台下时无法区分，
 * 而两者的计费口径与排障路径完全不同。
 *
 * 空平台（孤儿日志）显示灰色「未知」，不要假装是某个平台。
 */
function platformBadge(platform) {
  const raw = String(platform || "").toLowerCase();
  if (!raw) {
    return '<span class="log-platform unknown" data-tooltip="历史日志未记录平台"'
      + ' data-tooltip-description="这条记录写入时还没有平台字段，或对应的账号已被删除">未知</span>';
  }
  // 展示名优先用「日志筛选」里那份落库平台 -> 展示名映射（来自 /api/platforms），
  // 这样新增平台（Loomy / Qoder）不用再回来改这张表。
  // 兜底只保留几个老平台名：接口没回来时也不至于显示裸 id。
  const LABELS = {
    workbuddy: "WorkBuddy",
    trae: "Trae",
    "trae-cn": "Trae 国内版",
    "trae-intl": "Trae 国际版",
    qoder: "Qoder",
    loomy: "Loomy",
  };
  const label = _logPlatformLabels[raw] || LABELS[raw] || raw;
  return `<span class="log-platform ${esc(raw)}">${esc(label)}</span>`;
}

/* --------------------------------------------------------------------------
   模型 id -> 展示名映射（日志表用）
   --------------------------------------------------------------------------
   Qoder 的用法日志里 `model` 列存的是**平台内部 id**（dfmodel / kmodel），
   直接显示出来谁也看不懂，而且「dfmodel 到底是 DeepSeek 还是什么」只能靠记。
   这里用一次 `/api/models/aggregate` 建 {model_id: 聚合展示名}，
   表格显示展示名、tooltip 保留原始 id。 */
let _modelLabelMap = {};
let _modelLabelAt = 0;
let _modelLabelPromise = null;
async function loadModelLabelMap(force) {
  if (!force && Date.now() - _modelLabelAt < 60000) return _modelLabelMap;
  if (_modelLabelPromise) return _modelLabelPromise;
  _modelLabelPromise = (async () => {
    try {
      const { ok, data } = await safeJson(await api("/api/models/aggregate"));
      if (!ok) return _modelLabelMap;
      const map = {};
      for (const group of data.items || []) {
        for (const entry of group.platforms || []) {
          const id = String(entry.model_id || "");
          if (id && group.name) map[id] = group.name;
        }
      }
      _modelLabelMap = map;
      _modelLabelAt = Date.now();
    } catch (e) {
      // 拿不到就照旧显示原始 id
    } finally {
      _modelLabelPromise = null;
    }
    return _modelLabelMap;
  })();
  return _modelLabelPromise;
}

/** 日志里的模型显示名：优先映射到聚合展示名。 */
function modelLabelOf(model) {
  const raw = String(model || "");
  return _modelLabelMap[raw] || raw;
}

//: 当前页数据（模型展示名映射到手后要重画，避免再打一次接口）
let _logLastItems = [];
let _logLastConds = [];
function renderLogRows() {
  const body = $("#logBody");
  if (!body) return;
  body.innerHTML = _logLastItems.map(logRow).join("") ||
    `<tr><td colspan="${_logColCount()}"><div class="empty">${
      (_logLastConds || []).length ? "当前筛选条件下没有记录，试试放宽时间范围或清除筛选"
        : "还没有请求记录（代理产生调用后这里会出现）"
    }</div></td></tr>`;
}

/** 用途列的可读短名。
 *
 * 原始值是网关写进去的 `X-Agent-Purpose`（`qoder-completions` /
 * `loomy-chat` / `anthropic`…）。整串塞进 74px 的列只能显示
 * 「qoder-completi…」，既占地方又没信息量 —— 平台那一列已经写了是谁，
 * 这里只保留「什么接口」。tooltip 仍然给完整值。
 */
function useCaseLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const stripped = raw.replace(/^(qoder|loomy|trae|wb|workbuddy|anthropic|openai)[-_]?/i, "");
  const key = stripped.toLowerCase();
  const NAMES = {
    "chat": "对话", "completions": "补全", "messages": "消息",
    "responses": "响应", "embeddings": "向量", "images": "图片",
    "videos": "视频", "audio": "语音", "moderation": "审核",
    "chat-completions": "对话", "messages/count_tokens": "计数",
  };
  return NAMES[key] || NAMES[stripped] || stripped || raw;
}

function logRow(l) {
  const tokenHtml = (l.prompt_tokens!=null || l.completion_tokens!=null)
    ? `<div class="leading-tight text-[11px] tnum">
         <div><span class="wb-icon text-emerald-500 text-[10px]"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg></span> ${fmtK(l.prompt_tokens||0)}
              <span class="wb-icon text-amber-500 text-[10px] ml-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg></span> ${fmtK(l.completion_tokens||0)}</div>
         <div style="color:var(--fg-subtle)"><span class="wb-icon text-[9px] mr-0.5"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12v-2"/><path d="M12 18v-2"/><path d="M16 12v-2"/><path d="M16 18v-2"/><path d="M2 11h1.5"/><path d="M20 18v-2"/><path d="M20.5 11H22"/><path d="M4 18v-2"/><path d="M8 12v-2"/><path d="M8 18v-2"/><rect x="2" y="6" width="20" height="10" rx="2"/></svg></span> ${fmtK(l.cached_tokens||0)}</div>
       </div>`
    : `<span class="text-xs" style="color:var(--fg-subtle)">—</span>`;
  const credHtml = l.credits>0
    ? `<span class="text-emerald-600 font-semibold tnum">${Number(l.credits).toFixed(4)}</span>`
    : `<span style="color:var(--fg-subtle)">—</span>`;
  const ttfbColor = ms => ms==null ? 'var(--fg-subtle)' : ms<=3000 ? 'var(--ok)' : ms<=8000 ? '#d97706' : ms<=20000 ? 'var(--warn)' : 'var(--danger)';
  const totalColor = ms => ms==null ? 'var(--fg-subtle)' : ms<=15000 ? 'var(--ok)' : ms<=30000 ? '#d97706' : ms<=60000 ? 'var(--warn)' : 'var(--danger)';
  const latencyBar = ms => ms==null ? 0 : Math.min(100, Math.max(4, Math.log10(ms/100+1)*22)).toFixed(1);
  const latS = l.latency_ms!=null ? fmtDuration(l.latency_ms) : '—';
  const ttfbS = l.ttfb_ms!=null ? fmtDuration(l.ttfb_ms) : '—';

  // 计算 TPS（Tokens Per Second）—— **必须与 DSH / 后端 bench_router 同口径**。
  //
  // 原来这里错得很离谱，同一请求算出 2208 / 3854 这种物理不可能的值：
  //   1. 分子用了 `prompt_tokens + completion_tokens` —— prompt 经常上千，
  //      而它根本不是「生成的量」，直接把 TPS 放大一个数量级；
  //   2. 分母用了整段 `latency_ms`，把首包等待（往往 1~3 秒）也算进
  //      「生成耗时」，方向反了：等待越久 TPS 越"低"，但实际生成很快；
  //   3. 没有任何边界保护。
  //
  // 正确口径（与 `bench_router` 完全一致）：
  //   tps = completion_tokens / (decodeMs / 1000)
  //   decodeMs = latency_ms - ttfb_ms      ← 纯解码段，不含首包等待
  //
  // 边界：decodeMs < 300ms 视为没有有效分段（那几毫秒是网络抖动，
  // 上游一次性爆发时就是这种形态，算出来没有参考价值），
  // 上限 300 tok/s —— 线上实测：真实出字速度 30~200 tok/s，超过这个数
  // 一定是「整包突发」（上游把整段答案一次吐完，窗口只剩网络 RTT）。
  // 显示「—」比显示一个假的高值诚实 —— 用户拿它跟客户端对不上就是这里。
  const _outTok = Number(l.completion_tokens || 0);
  const _decodeMs = Number(l.latency_ms || 0) - Number(l.ttfb_ms || 0);
  let tpsValue = null;
  if (_outTok > 0 && _decodeMs >= 300) {
    const _raw = _outTok / (_decodeMs / 1000);
    if (_raw > 0 && _raw <= 300) tpsValue = _raw.toFixed(1);
  }

  // 耗时单元格：三行（首响应 / 总 / TPS）必须**左对齐成一条竖线**。
  //
  // 原来用 Tailwind 的 `w-7` 给标签固定宽度 —— 但 `w-7` 不在预编译子集里，
  // 实际宽度为 0，于是「首响应 / 总 / TPS」三行的数值起点各不相同，
  // 整列看起来是乱的。改成独立的 grid + 自定义标签列宽，不依赖 Tailwind。
  const latencyHtml = l.ttfb_ms!=null || l.latency_ms!=null
    ? `<div class="latency-cell tnum">
         <div class="latency-row">
           <span class="latency-label" data-tooltip="从收到请求到首次转发正文、思考或工具增量；最终答案可能更晚出现">首响应</span>
           <span class="font-medium" style="color:${ttfbColor(l.ttfb_ms)}">${ttfbS}</span>
         </div>
         <div class="latency-row">
           <span class="latency-label">总</span>
           <div class="pkg-track" style="width:44px;margin:0;flex:0 0 44px"><i style="width:${latencyBar(l.latency_ms)}%;background:${totalColor(l.latency_ms)}"></i></div>
           <span class="font-medium" style="color:${totalColor(l.latency_ms)}">${latS}</span>
         </div>
         ${tpsValue ? `<div class="latency-row" data-tooltip="吞吐量 (Token/秒)">
           <span class="latency-label">TPS</span>
           <span class="font-medium" style="color:var(--brand)">${tpsValue}</span>
         </div>` : ''}
       </div>`
    : `<span class="text-xs" style="color:var(--fg-subtle)">—</span>`;
  const ok = !l.error_kind || l.error_kind === 'success';
  const statusHtml = ok
    ? `<span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 text-xs" data-tooltip="成功"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span></span>`
    : `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" data-tooltip="${esc(l.error_kind||'')}">${esc((l.error_kind||'失败').slice(0,6))}</span>`;
  return `<tr data-tooltip="IP: ${esc(l.client_ip||'—')} | Seq: ${l.seq||'—'}">
    <td class="text-xs whitespace-nowrap tnum" style="color:var(--fg-subtle)" data-tooltip="${esc(fmtTime(l.created_at))}">${esc(fmtTime(l.created_at).slice(5))}</td>
    <td class="text-xs font-mono">${WBUsage.ipCell(l.client_ip)}</td>
    <td class="text-xs font-mono" data-tooltip="${esc(l.key_name)}">${esc((l.key_name||'').slice(0,10))}</td>
    <td class="text-xs">${platformBadge(l.platform)}</td>
    <td class="text-xs" data-tooltip="${esc(l.account_name)}">${esc((l.account_name||'').slice(0,14))}</td>
    <td class="font-mono text-[11px] whitespace-nowrap" data-tooltip="${esc(l.model)}" data-tooltip-description="${esc(modelLabelOf(l.model) !== (l.model||'') ? '平台内部模型 ID：' + (l.model||'') : '')}">${esc(modelLabelOf(l.model).slice(0, 26))}<small class="block mt-1" style="color:var(--fg-muted)" data-tooltip="客户端请求的思考强度；空值表示请求未指定或历史日志未记录">思考：${esc(l.reasoning_effort || '默认 / 未记录')}</small></td>
    <td>${tokenHtml}</td>
    <td>${hitRateHtml(l)}</td>
    <td class="text-xs text-right">${credHtml}</td>
    <td>${latencyHtml}</td>
    <td class="text-xs" style="color:var(--fg-muted)" data-tooltip="${esc(l.use_case || '—')}" data-tooltip-description="透传给上游的 X-Agent-Purpose">${esc(useCaseLabel(l.use_case))}</td>
    <td><button type="button" class="console-btn quiet" onclick="openUsageDetail(${Number(l.id)})" data-tooltip="查看调用详情">${statusHtml} 详情</button></td>
  </tr>`;
}

function renderMobileRuntime(d) {
  if (!d || (!d.android_runtime && !d.event_loop_stalls?.length && !(d.event_loop_lag_ms >= 1000))) return '';
  const a = d.android_runtime;
  return `<div class="limit-note"><p><b>手机服务运行状态</b></p>
    <p>事件循环最大延迟：${((d.event_loop_lag_ms || 0)/1000).toFixed(3)} 秒${d.event_loop_lag_ms >= 1000 ? '（本地处理曾停顿，不能仅凭此判定为上游超时）' : ''}</p>
    ${a ? `<p>${esc(a.manufacturer || '')} ${esc(a.device_model || '')} · Android SDK ${Number(a.android_sdk) || '—'} · 服务代次 ${Number(a.service_revision) || '—'}</p>
    <p>电池优化：${a.battery_unrestricted ? '已允许不受限制' : '未豁免'} · 后台限制：${a.background_restricted ? '已限制' : '系统未报告限制'} · 屏幕：${a.interactive ? '亮屏' : '息屏'}</p>
    <p>省电模式：${a.power_save ? '开启' : '关闭'} · 系统休眠：${a.device_idle ? '是' : '否'} · CPU 保活：${a.wake_lock ? '持有' : '未持有'}</p>
    <p>网络：${a.wifi ? 'Wi-Fi' : a.cellular ? '移动网络' : a.network_available ? '其他网络' : '未连接'} · 系统联网校验：${a.network_validated ? '通过' : '未通过'}</p>` : ''}
    ${(d.event_loop_stalls || []).map(s => `<details><summary>停顿采样：${(Number(s.paused_ms)/1000).toFixed(3)} 秒 · 期间进程 CPU ${(Number(s.process_cpu_ms)/1000).toFixed(3)} 秒</summary><pre class="whitespace-pre-wrap break-all">${esc((s.stack || []).join('\n'))}</pre></details>`).join('')}</div>`;
}

let _usageDetailSeq = 0;
async function openUsageDetail(id) {
  WBUsage.closeDetail();
  const seq = ++_usageDetailSeq;
  openModal('<p id="usageDetailLoading">正在读取调用详情…</p>', 'max-w-3xl');
  try {
    const response = await api('/api/logs/' + Number(id));
    const {ok, data} = await safeJson(response);
    if (seq !== _usageDetailSeq || !$('#usageDetailLoading') || $('#modal').classList.contains('hidden')) return;
    if (!ok) { closeModal(); toast(data.detail || '读取详情失败', 'err'); return; }
    const d = data.diagnostic;
    const json = d ? JSON.stringify(d, null, 2) : '这条历史记录没有保存请求详情，无法恢复当时的上游响应。';
    openModal(`<h3 class="font-semibold text-lg mb-3">调用详情 · ${esc(data.model)}</h3>
      <p>账号：${esc(data.account_name)} · 网关分类：${esc(data.error_kind || '未记录')}</p>
      <p>客户端 IP：<span class="font-mono">${esc(data.client_ip || '未记录')}</span></p>
      ${WBUsage.payloadHtml(data)}
      ${d?.gateway_error ? `<div class="limit-note"><p>网关本地拒绝（未请求上游）：</p><pre class="whitespace-pre-wrap break-all">${esc(d.gateway_error)}</pre></div>` : ""}
      ${d?.diagnostic_truncated ? '<p class="limit-note">诊断内容过长，部分消息已截断。</p>' : ''}
      ${renderMobileRuntime(d)}
      ${d ? `<p>请求编号：${esc(d.id || '—')} · 网关 HTTP：${Number(d.status) || '记账时尚未发送响应头'}</p><p>网关处理结果：${Number(d.gateway_result_status) || '—'}${d.status === 200 && d.error_kind && d.error_kind !== 'success' ? '（响应头已发送 200，随后处理失败）' : ''}</p>
      ${(d.account_policy_events || []).map(e => `<div class="limit-note"><p>账号 #${Number(e.account_id)} · ${esc(e.model || '')} · 网关分类：${esc(e.kind)}</p><p>上游 HTTP：${Number(e.http_status) || '未收到 HTTP 响应'} · 上游 code：${esc(e.upstream_code ?? '未提供')}</p><p>上游 msg：${esc(e.upstream_message ?? '未提供')}</p>${e.message_truncated || e.raw_truncated ? '<p>消息过长，以下内容已截断。</p>' : ''}${e.upstream_raw != null ? `<p>上游响应原文（凭据脱敏）：</p><pre class="whitespace-pre-wrap break-all">${esc(e.upstream_raw)}</pre>` : ''}</div>`).join('')}
      ${(d.network_errors || []).map(e => `<div class="limit-note"><p>本地网络异常 · 账号 #${Number(e.account_id) || '—'} · ${esc(e.phase || '')}</p><pre class="whitespace-pre-wrap break-all">${esc(e.message)}</pre><p>${e.http_status ? '已收到上游 HTTP ' + Number(e.http_status) + '，随后传输中断。' : '未收到响应，没有可展示的上游 HTTP / code / msg。'}</p></div>`).join('')}
      ${d.connection_recoveries ? `<p>已尝试新连接恢复：${Number(d.connection_recoveries)} 次</p>` : ''}` : ''}
      <details class="mt-3"><summary>完整诊断 JSON</summary><pre class="whitespace-pre-wrap break-all text-xs">${esc(json)}</pre></details>
      <textarea id="usageDiagnosticText" hidden></textarea><div class="flex gap-2 mt-3"><button class="console-btn quiet" onclick="copyText('#usageDiagnosticText')">复制摘要</button><button class="console-btn quiet" onclick="WBUsage.download()">下载完整 JSONL</button><button class="console-btn quiet" onclick="closeModal()">关闭</button></div>`, 'max-w-3xl');
    document.getElementById('usageDiagnosticText').value = JSON.stringify(data, null, 2);
  } catch (error) { if (seq === _usageDetailSeq && $('#usageDetailLoading')) { closeModal(); toast('读取详情失败', 'err'); } }
}

/** 按账号汇总表：回答「这个号用了多少」，不用翻几十页去数。 */
async function loadLogSummary(silent = false) {
  const box = $("#logSummary");
  const hint = $("#logSummaryHint");
  if (!box || _logFolded.summary || (silent && _logSummaryBusy)) return;
  const filterSignature = logFilterSignature();
  if (!_logSummaryDirty && filterSignature === _logSummarySignature && Date.now() - _logSummaryAt < 30000) return;
  const seq = ++_logSummarySeq;
  const usageRevision = _logUsageRevision;
  if (_logSummaryController) _logSummaryController.abort();
  const controller = new AbortController();
  _logSummaryController = controller;
  _logSummaryBusy = true;
  const parsedDays = parseInt(uiSelectValue("logDaysSel") || "1", 10);
  const days = Number.isFinite(parsedDays) ? parsedDays : 1;
  const accountId = uiSelectValue("logAccountSel") || "";
  if (!silent) box.innerHTML = `<div class="fs-12 py-3" style="color:var(--fg-subtle)">加载中...</div>`;
  try {
    const filters = new URLSearchParams(_logQuery().qs);
    ['page','page_size','before_id','with_total'].forEach(k => filters.delete(k));
    // 「今日」模式保留 _logQuery 注入的自然日起点（start 存在时后端忽略 days），
    // 其余情况沿用旧行为：删掉 start，交给后端按 days 滚动窗口算。
    const explicitStart = Boolean($('#logStart')?.value);
    const todayMode = (uiSelectValue("logDaysSel") || "") === "today";
    if (!explicitStart && !todayMode) filters.delete('start');
    filters.set('days', explicitStart ? '0' : String(days));
    const r = await api('/api/logs/summary?' + filters, {signal:controller.signal});
    const { ok, data } = await safeJson(r);
    if (seq !== _logSummarySeq || filterSignature !== logFilterSignature() || _logFolded.summary) return;
    if (!ok) { box.innerHTML = `<div class="empty">加载失败：${esc(data.detail || "")}</div>`; return; }
    const items = data.items || [];
    if (usageRevision === _logUsageRevision) _logSummaryDirty = false;
    _logSummarySignature = filterSignature;
    _logSummaryAt = Date.now();
    if (hint) hint.textContent = `当前筛选 · ${data.account_count} 个账号 · 成功 ${data.ok_requests} / 错误 ${data.failed_requests} · ${fmtCredit(data.total_credits)} 积分${data.unattributed_requests ? ` · ${data.unattributed_requests} 次未记录账号 / 未选号` : ""}`;
    if (!items.length) { box.innerHTML = `<div class="empty">该时间范围内没有账号产生请求。</div>`; return; }
    const maxC = Math.max(1, ...items.map(x => x.credits));
    box.innerHTML = `<table class="tbl" style="min-width:820px">
      <thead><tr>
        <th>账号</th><th class="text-right">请求数</th><th class="text-right">失败</th>
        <th class="text-right">积分</th><th class="text-right">Token</th><th class="text-right">命中率</th>
        <th class="text-right">平均耗时</th><th>最近使用</th><th style="width:120px">积分占比</th>
      </tr></thead><tbody>${items.map(x => `
        <tr>
          <td class="font-medium">${esc(x.account_name)}</td>
          <td class="text-right tnum">${fmtNum(x.requests)}</td>
          <td class="text-right tnum" style="color:${x.failed_requests > 0 ? 'var(--danger)' : 'var(--fg-subtle)'}">${x.failed_requests}</td>
          <td class="text-right tnum font-medium" style="color:var(--warn)">${fmtCredit(x.credits)}</td>
          <td class="text-right tnum" style="color:var(--fg-muted)">${fmtK(x.total_tokens)}</td>
          <td class="text-right tnum font-medium" style="color:${x.prompt_tokens ? (x.cached_tokens / x.prompt_tokens >= .6 ? 'var(--ok)' : x.cached_tokens / x.prompt_tokens >= .3 ? '#d97706' : 'var(--fg-subtle)') : 'var(--fg-subtle)'}" data-tooltip="缓存命中 ${fmtK(x.cached_tokens||0)} / 输入 ${fmtK(x.prompt_tokens||0)}">${x.prompt_tokens ? Math.min(100, x.cached_tokens / x.prompt_tokens * 100).toFixed(2) + '%' : '—'}</td>
          <td class="text-right tnum" style="color:var(--fg-muted)">${x.avg_latency_ms ? (x.avg_latency_ms/1000).toFixed(2)+'s' : '—'}</td>
          <td class="text-xs" style="color:var(--fg-subtle)">${fmtTime(x.last_used_at, false)}</td>
          <td><div class="pkg-track" style="margin:0"><i style="width:${Math.max(2, x.credits/maxC*100)}%"></i></div></td>
        </tr>`).join("")}</tbody></table>`;
  } catch (e) {
    if (!(e && e.name === 'AbortError') && !silent && seq === _logSummarySeq) box.innerHTML = `<div class="empty">加载异常：${esc(String(e && e.message || e))}</div>`;
  } finally {
    if (seq === _logSummarySeq) {
      _logSummaryBusy = false;
      _logSummaryController = null;
    }
  }
}

function resetLogFilters() {
  WBFilterCombobox.close();
  // Reset all controls first, then issue one list request below. Notifying
  // each select here would briefly start the same query two extra times.
  uiSelectSet("logAccountSel", "", false);
  uiSelectSet("logPlatformSel", "", false);
  uiSelectSet("logDaysSel", "today", false);
  ["logModel", "logKey", "logIp", "logStart", "logEnd"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  uiSelectSet("logResult", "", false);
  const f = $("#logFastMode"); if (f) f.checked = false;
  _logBeforeId = null; _logCursors = new Map([[1, null]]);
  loadLogAccounts(true).catch(() => {}); loadLogs(1);
}

/** 进入日志面板时恢复折叠状态，后台只做轻量增量检查。 */
function openLogsPanel() {
  WBUsage.captureStatus();
  stopLogActivity();
  _logUsageRevision = null;
  _logUsageDirty = false;
  for (const name of Object.keys(_logFolded)) {
    try { _logFolded[name] = localStorage.getItem('wb_log_fold_'+name) === 'true'; } catch(e) {}
    applyLogCard(name);
  }
  // 折叠状态是持久化的，所以这里不能再无条件拉一次：
  // applyLogCard('activity') 已按折叠状态决定连不连推送。
  startLogActivity();
  _logBeforeId = null; _logCursors = new Map([[1, null]]);
  // 模型展示名映射（dfmodel -> DeepSeek-V4.1-Flash）：拿到后重画一次表体
  loadModelLabelMap().then(() => renderLogRows()).catch(() => {});
  loadLogAccounts().catch(() => {}); loadLogs(1);
}

function fillLogFilterOptions(){
  WBFilterCombobox.attach('logModel', _modelData.map(m => m.model_id));
  WBFilterCombobox.attach('logKey', _keyData.map(k => k.name));
}

async function exportLogs(diagnostics = false){
  const daysRaw = uiSelectValue("logDaysSel") || "today";
  const days = parseInt(daysRaw, 10) || 0;
  const accountId = uiSelectValue("logAccountSel") || "";
  const model = ($("#logModel") ? $("#logModel").value : "").trim();
  const key = ($("#logKey") ? $("#logKey").value : "").trim();
  const ip = ($("#logIp") ? $("#logIp").value : "").trim();
  const start = ($("#logStart") ? $("#logStart").value : "").trim();
  const end = ($("#logEnd") ? $("#logEnd").value : "").trim();
  const params = [];
  if(accountId) params.push("account_id=" + encodeURIComponent(accountId));
  if(model) params.push("model=" + encodeURIComponent(model));
  if(key) params.push("key=" + encodeURIComponent(key));
  if(ip) params.push("client_ip=" + encodeURIComponent(ip));
  if(start) params.push("start=" + encodeURIComponent(start + " 00:00:00"));
  else if(daysRaw === "today") {
    const t = new Date(Date.now() + 8 * 3600000);
    const iso = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - 8 * 3600000)
      .toISOString().slice(0,19).replace("T"," ");
    params.push("start=" + encodeURIComponent(iso));
  }
  else if(days > 0) params.push("start=" + encodeURIComponent(
    new Date(Date.now() - days*86400000).toISOString().slice(0,19).replace("T"," ")));
  if(end) params.push("end=" + encodeURIComponent(end + " 23:59:59"));
  const result = uiSelectValue('logResult') || '';
  if (result) params.push('result=' + encodeURIComponent(result));
  if (diagnostics) params.push('diagnostics=true&limit=1000');
  const qs = params.length ? ("?" + params.join("&")) : "";
  toast("正在导出 CSV...", "ok");
  try {
    const r = await api("/api/logs/export" + qs, { method: "GET" });
    if(!r.ok){ toast("导出失败", "err"); return; }
    await downloadText('usage_logs.csv', await r.text(), 'text/csv');
    toast("已导出 usage_logs.csv");
  } catch(e){ toast("导出异常: " + e.message, "err"); }
}

/* ==================== 分组管理 ==================== */
let _groupData = [];

async function loadGroups() {
  try {
    const r = await api("/api/groups");
    const { ok, data: d } = await safeJson(r);
    if (!ok) { toast("加载分组失败: " + (d.detail || ""), "err"); return; }
    _groupData = d.items || [];
    renderGroups();
  } catch (e) { toast("加载分组异常: " + e.message, "err"); }
}

function renderGroups() {
  const body = $("#groupBody");
  if (!body) return;
  if (!_groupData.length) {
    body.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-slate-400">还没有分组，点「新建分组」创建</td></tr>`;
    return;
  }
  body.innerHTML = _groupData.map(g => {
    // 有效模型数 < 模型数 说明组内有模型被禁用了，提示一下
    const stale = g.effective_count < g.model_count;
    return `
    <tr class="border-t hover:bg-slate-50">
      <td class="px-4 py-3 font-medium">${esc(g.name)}</td>
      <td class="px-4 py-3 text-right tnum">
        ${g.model_count} 个
        ${stale ? `<span class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" data-tooltip="部分模型已被禁用，实际可用 ${g.effective_count} 个">${g.effective_count} 可用</span>` : ""}
      </td>
      <td class="px-4 py-3 text-right tnum">${g.key_count > 0 ? `<span class="text-wb font-medium">${g.key_count}</span>` : `<span class="text-slate-300">0</span>`}</td>
      <td class="px-4 py-3 text-slate-500 text-xs">${esc(g.note || "-")}</td>
      <td class="px-4 py-3 text-right whitespace-nowrap">
        <button onclick="openGroupEditor(${g.id})" class="text-blue-600 hover:text-blue-700 mr-3" data-tooltip="编辑"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg></span></button>
        <button onclick="deleteGroup(${g.id}, '${esc(g.name)}')" class="text-red-500 hover:text-red-600" data-tooltip="删除"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></span></button>
      </td>
    </tr>`;
  }).join("");
}

/* 新建 / 编辑分组：多选模型列表 */
let _geModels = [];   // 全部模型配置（可选池）
let _geSelected = new Set();
let _geEditId = 0;

async function openGroupEditor(gid) {
  _geEditId = gid || 0;
  // 拉全部模型配置作为候选（只列启用的，禁用模型选进来没意义）
  try {
    const r = await api("/api/models/configs");
    const { ok, data: d } = await safeJson(r);
    if (!ok) { toast("加载模型列表失败", "err"); return; }
    _geModels = (d.items || []).filter(m => m.enabled);
  } catch (e) { toast("加载模型列表异常: " + e.message, "err"); return; }

  let g = null;
  if (_geEditId) {
    g = _groupData.find(x => x.id === _geEditId);
    if (!g) { toast("分组不存在", "err"); return; }
  }
  _geSelected = new Set(g ? (g.models || []) : []);

  openModal(`
    <h3 class="font-bold mb-1"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></svg></span> ${_geEditId ? "编辑分组" : "新建分组"}</h3>
    <p class="text-xs text-slate-400 mb-3">选择该分组允许使用的模型，并起一个名字。</p>
    <div class="grid gap-3">
      <div>
        <label class="text-xs text-slate-500">分组名称 <span class="text-red-500">*</span></label>
        <input id="geName" class="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="例如：便宜模型组"
               value="${g ? esc(g.name) : ""}" />
      </div>
      <div>
        <label class="text-xs text-slate-500">备注</label>
        <input id="geNote" class="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="可选"
               value="${g ? esc(g.note || "") : ""}" />
      </div>
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-xs text-slate-500">模型列表 <span class="text-red-500">*</span>（已选 <span id="geCount">0</span> 个）</label>
          <div class="flex gap-2 text-xs">
            <button onclick="geSelectAll(true)" class="text-wb hover:underline">全选</button>
            <button onclick="geSelectAll(false)" class="text-slate-400 hover:underline">清空</button>
          </div>
        </div>
        <input id="geFilter" oninput="renderGeModels()" placeholder="搜索模型 ID" class="w-full border rounded-lg px-3 py-1.5 text-sm mb-2" />
        <div id="geModelList" class="border rounded-lg max-h-64 overflow-auto p-2 grid gap-1"></div>
      </div>
    </div>
    <div class="flex justify-end gap-2 mt-4">
      <button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">取消</button>
      <button onclick="saveGroup()" class="px-3 py-1.5 rounded-lg btn-primary text-sm">保存</button>
    </div>`);
  renderGeModels();
}

function renderGeModels() {
  const box = $("#geModelList");
  if (!box) return;
  const term = (($("#geFilter") || {}).value || "").trim().toLowerCase();
  // 搜索同时匹配「平台名 + model_id」，否则搜 loomy 找不到
  const list = _geModels.filter(m => {
    if (!term) return true;
    return String(m.model_id || "").toLowerCase().includes(term)
        || String(m.platform_label || "").toLowerCase().includes(term)
        || String(m.platform || "").toLowerCase().includes(term);
  });
  if (!list.length) { box.innerHTML = `<div class="text-xs text-slate-400 p-2">无匹配模型</div>`; }
  else {
    // **必须显示平台标签**：`dfmodel` 在 Qoder 国内版和国际版都存在，
    // 只写 model_id 根本分不清勾的是哪个平台。
    // 按平台分段：169 条平铺看不出结构，加小标题后一眼能扫到某平台
    const grouped = {};
    for (const m of list) (grouped[m.platform_label || m.platform || "其他"] ||= []).push(m);
    box.innerHTML = Object.keys(grouped).sort().map(gname => {
      const rows = grouped[gname].map(m => {
      const label = m.platform_label || m.platform || "";
      const realmTag = m.realm
        ? `<span class="text-[10px] px-1.5 py-0.5 rounded" style="background:var(--surface-2);color:var(--fg-subtle)">${esc(m.realm === "intl" ? "国际" : "国内")}</span>`
        : "";
      return `
      <label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-50 cursor-pointer text-sm">
        <input type="checkbox" ${_geSelected.has(m.model_id) ? "checked" : ""}
               onchange="geToggle('${esc(m.model_id)}', this.checked)" />
        <span class="text-[10px] px-1.5 py-0.5 rounded shrink-0 w-[86px] truncate"
              style="background:var(--surface-2);color:var(--fg-muted)"
              data-tooltip="${esc(label)}">${esc(label)}</span>
        ${realmTag}
        <span class="font-mono text-xs">${esc(m.model_id)}</span>
        ${m.is_free ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">免费</span>`
                    : `<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">x${m.credit_multiplier}</span>`}
      </label>`;
      }).join("");
      return `<div class="ge-group">
        <div class="ge-group-head">${esc(gname)} <span>${rows ? grouped[gname].length : 0} 个</span></div>
        ${rows}
      </div>`;
    }).join("");
  }
  const c = $("#geCount"); if (c) c.textContent = _geSelected.size;
}

function geToggle(mid, on) {
  if (on) _geSelected.add(mid); else _geSelected.delete(mid);
  const c = $("#geCount"); if (c) c.textContent = _geSelected.size;
}
function geSelectAll(on) {
  // 全选只作用于当前筛选结果，避免误勾到看不见的模型
  const term = (($("#geFilter") || {}).value || "").trim().toLowerCase();
  const list = _geModels.filter(m => !term || (m.model_id || "").toLowerCase().includes(term));
  for (const m of list) { if (on) _geSelected.add(m.model_id); else _geSelected.delete(m.model_id); }
  renderGeModels();
}

async function saveGroup() {
  const name = ($("#geName").value || "").trim();
  if (!name) { toast("请填写分组名称", "err"); return; }
  if (!_geSelected.size) { toast("请至少选择一个模型", "err"); return; }
  const payload = { name, note: ($("#geNote").value || "").trim(), models: [..._geSelected] };
  try {
    const r = await api(_geEditId ? `/api/groups/${_geEditId}` : "/api/groups", {
      method: _geEditId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const { ok, data: d } = await safeJson(r);
    if (!ok) { toast("保存失败: " + (d.detail || "未知错误"), "err"); return; }
    closeModal();
    toast(_geEditId ? "分组已更新" : `分组「${name}」已创建`);
    loadGroups();
  } catch (e) { toast("保存异常: " + e.message, "err"); }
}

async function deleteGroup(gid, name) {
  if (!await uiConfirm({title:"删除分组",
      message:`确认删除分组「${name}」？\n绑定了该分组的 Key 会自动变为「不限制模型」`})) return;
  try {
    const r = await api(`/api/groups/${gid}`, { method: "DELETE" });
    const { ok, data: d } = await safeJson(r);
    if (!ok) { toast("删除失败: " + (d.detail || ""), "err"); return; }
    toast(d.unbound_keys > 0 ? `已删除分组，${d.unbound_keys} 个 Key 已自动解除限制` : "分组已删除");
    loadGroups(); loadKeys();
  } catch (e) { toast("删除异常: " + e.message, "err"); }
}

/* ==================== 使用记录统计 ==================== */
const _PIE_COLORS = ["#3b82f6","#22c55e","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#ec4899","#84cc16"];

function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}
/* 注意：`fmtCredit` 定义在上面（组件区），**不要在这里再定义一次** ——
 * 之前这里有一份 `return n.toFixed(2)` 的重复实现，因为声明在后，
 * 直接把上面那版覆盖掉，于是「积分不保留小数」的改动完全没生效。
 * 函数声明会提升，同名后者胜出，属于最难察觉的一类覆盖。 */

/* 纯 SVG 环形图 + 图例表格（不引第三方图表库，保持单文件零依赖）
 * tooltip：原生 <title> 有 ~1s 延迟且样式不可控，故自绘跟随鼠标的浮层。
 */
function donutChart(rows, valueKey, opts) {
  const options = opts || {};
  const items = (rows || []).filter(r => (r.requests || 0) > 0 || (r[valueKey] || 0) > 0);
  if (!items.length) return `<div class="text-xs text-slate-400 py-8 text-center">暂无数据</div>`;

  const total = items.reduce((s, r) => s + (r[valueKey] || 0), 0);
  const countsOnly = items.every(r => r.credits === undefined);
  // 平台列：只有「全部平台」口径才显示 —— 已经按平台筛过时，
  // 每一行都写着同一个平台名，纯噪音。调用方通过 showPlatform 控制。
  const showPlatform = options.showPlatform !== false &&
    items.some(r => r.platform_label);
  const platformTag = r => (showPlatform && r.platform_label)
    ? `<span class="usage-legend-platform">${esc(r.platform_label)}</span>` : "";
  const R = 60, SW = 26, C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = items.map((r, i) => {
    if (!(r[valueKey] > 0)) return '';
    const frac = (r[valueKey] || 0) / total;
    const len = frac * C;
    const pct = (frac * 100).toFixed(1);
    const tip = `<b>${esc(r.label)}</b>${showPlatform && r.platform_label ? ' · ' + esc(r.platform_label) : ''}<br>${valueKey === 'requests' ? '请求 '+fmtNum(r.requests) : '积分 '+fmtCredit(r.credits)}（${pct}%）${countsOnly ? '' : '<br>请求 '+fmtNum(r.requests)+' · Token '+fmtNum(r.tokens)}`;
    const seg = `<circle class="chart-hit" cx="80" cy="80" r="${R}" fill="none"
        stroke="${_PIE_COLORS[i % _PIE_COLORS.length]}" stroke-width="${SW}"
        stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}"
        transform="rotate(-90 80 80)"
        onmousemove="showTip(event, '${tip.replace(/'/g, "&#39;")}')" onmouseleave="hideTip()"></circle>`;
    offset += len;
    return seg;
  }).join("");

  const legend = items.map((r, i) => {
    const frac = total ? ((r[valueKey] || 0) / total * 100).toFixed(1) : "0.0";
    return `
    <tr class="border-t hover:bg-slate-50">
      <td class="donut-legend-name">
        <span class="donut-legend-dot" style="background:${_PIE_COLORS[i % _PIE_COLORS.length]}"></span>
        <span class="donut-legend-body">
          <span class="donut-legend-text">${esc(r.label)}</span>${platformTag(r)}
        </span>
      </td>
      <td class="donut-legend-num">${fmtNum(r.requests)}</td>
      ${countsOnly ? '' : `<td class="donut-legend-num">${fmtNum(r.tokens)}</td>`}
      <td class="donut-legend-num donut-legend-pct">${frac}%</td>
      ${countsOnly ? '' : `<td class="donut-legend-num donut-legend-credit">${fmtCredit(r.credits)}</td>`}
    </tr>`;
  }).join("");

  return `
    <div class="flex items-center gap-3 donut-legend">
      <svg viewBox="0 0 160 160" class="w-32 h-32 shrink-0">${arcs}</svg>
      <div class="flex-1 min-w-0 max-h-56 overflow-auto">
        <table class="donut-legend-table">
          <colgroup>
            <col class="donut-col-name"><col class="donut-col-num">
            ${countsOnly ? '' : '<col class="donut-col-num">'}
            <col class="donut-col-pct">
            ${countsOnly ? '' : '<col class="donut-col-num">'}
          </colgroup>
          <thead><tr class="text-[10px] text-slate-400">
            <th class="text-left font-normal pb-1">名称</th>
            <th class="text-right font-normal pb-1">请求</th>
            ${countsOnly ? '' : '<th class="text-right font-normal pb-1">Token</th>'}
            <th class="text-right font-normal pb-1">占比</th>
            ${countsOnly ? '' : '<th class="text-right font-normal pb-1">积分</th>'}
          </tr></thead>
          <tbody>${legend}</tbody>
        </table>
      </div>
    </div>`;
}

/* Token 趋势：输入/输出 双折线 + 面积；每个数据点可 hover 看当点明细 */
function trendChart(rows) {
  if (!rows || !rows.length) return `<div class="text-xs text-slate-400 py-8 text-center">暂无数据</div>`;
  const W = 560, H = 200, PAD = 34;
  const n = rows.length;
  const maxV = Math.max(1, ...rows.map(r => Math.max(r.prompt_tokens, r.completion_tokens)));
  const x = i => PAD + (n === 1 ? (W - PAD * 2) / 2 : (i * (W - PAD * 2)) / (n - 1));
  const y = v => H - PAD - (v / maxV) * (H - PAD * 2);

  const line = (key, color) => {
    const pts = rows.map((r, i) => `${x(i)},${y(r[key])}`).join(" ");
    const area = `${PAD},${H - PAD} ${pts} ${x(n - 1)},${H - PAD}`;
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" pointer-events="none"></polyline>
            <polygon points="${area}" fill="${color}" opacity="0.10" pointer-events="none"></polygon>`;
  };

  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const v = maxV * f, yy = y(v);
    return `<line x1="${PAD}" y1="${yy}" x2="${W - PAD}" y2="${yy}" stroke="#e2e8f0" stroke-width="1" pointer-events="none"></line>
            <text x="${PAD - 6}" y="${yy + 3}" text-anchor="end" font-size="9" fill="#94a3b8" pointer-events="none">${fmtNum(v)}</text>`;
  }).join("");

  const step = Math.max(1, Math.ceil(n / 6));
  const xlabels = rows.map((r, i) => (i % step === 0 || i === n - 1)
    ? `<text x="${x(i)}" y="${H - PAD + 14}" text-anchor="middle" font-size="9" fill="#94a3b8" pointer-events="none">${esc(String(r.bucket).slice(5))}</text>`
    : "").join("");

  // 每个点画一个透明的较大命中圆，便于悬停
  const hits = rows.map((r, i) => {
    const tip = `<b>${esc(r.bucket)}</b><br>输入 ${fmtNum(r.prompt_tokens)} · 输出 ${fmtNum(r.completion_tokens)}<br>请求 ${fmtNum(r.requests)} · 积分 ${fmtCredit(r.credits)}`;
    const cx = x(i);
    const dots = `
      <circle cx="${cx}" cy="${y(r.prompt_tokens)}" r="2.5" fill="#3b82f6" pointer-events="none"></circle>
      <circle cx="${cx}" cy="${y(r.completion_tokens)}" r="2.5" fill="#22c55e" pointer-events="none"></circle>`;
    return `<g class="chart-hit" onmousemove="showTip(event, '${tip.replace(/'/g, "&#39;")}')" onmouseleave="hideTip()">
      ${dots}
      <circle cx="${cx}" cy="${H / 2}" r="${Math.max(8, (W - PAD * 2) / Math.max(1, n) / 2)}" fill="transparent"></circle>
    </g>`;
  }).join("");

  return `
    <div>
      <div class="flex gap-3 text-xs mb-1">
        <span class="flex items-center gap-1"><span class="inline-block w-3 h-0.5" style="background:#3b82f6"></span> 输入</span>
        <span class="flex items-center gap-1"><span class="inline-block w-3 h-0.5" style="background:#22c55e"></span> 输出</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="w-full">
        ${grid}
        ${line("prompt_tokens", "#3b82f6")}
        ${line("completion_tokens", "#22c55e")}
        ${hits}
        ${xlabels}
      </svg>
    </div>`;
}

/* 使用记录工具栏的下拉：首次进入时渲染一次；
 * Key/模型/端点三个筛选下拉的选项来自「窗口内真实出现过的值」。 */
let _usageSelReady = false;
let _usageFilterReady = false;
let _usageLoadGeneration = 0;
// 筛选下拉的选项缓存。声明必须在使用它的 _usageQuery / loadUsageFilterOptions
// **之前**：虽是顶层 let（会被提升到 TDZ），但函数可能在任何位置被调用，
// 声明靠后容易踩「Cannot access before initialization」。放前面最省心。
let _usageOpts = { keys: [], models: [], use_cases: [], accounts: [], platforms: [] };

function initUsageSelects() {
  if (_usageSelReady) return;
  _usageSelReady = true;
  const platformBox = $("#usagePlatformSel");
  if (platformBox) platformBox.outerHTML = uiSelectHTML("usagePlatformSel", {
    value: "",
    options: [{ value: "", label: "全部平台（全网关）" }],
    onChange: () => loadUsageStats(),
  });
  const daysBox = $("#usageDaysSel");
  if (daysBox) daysBox.outerHTML = uiSelectHTML("usageDaysSel", {
    // 默认今日（自然日）+ 按小时：最常见的诉求是「今天怎么样」，
    // 与账号池「今日已用」同口径；要看滚动窗口（含昨日流量）选「近 N 天」
    value: "today",
    options: [
      { value: "today", label: "今日（自然日）" },
      { value: "1", label: "近 1 天" },
      { value: "3", label: "近 3 天" },
      { value: "7", label: "近 7 天" },
      { value: "14", label: "近 14 天" },
      { value: "30", label: "近 30 天" },
      { value: "90", label: "近 90 天" },
      { value: "custom", label: "自定义日期" },
    ],
    onChange: async value => {
      if (value === "custom") return;
      for (const id of ["usageStart", "usageEnd"]) { $("#" + id).value = ""; window.WBDateTimePicker?.sync(id); }
      _usageFilterReady = false;
      await loadUsageFilterOptions(); loadUsageStats();
    },
  });
  const gBox = $("#usageGrainSel");
  if (gBox) gBox.outerHTML = uiSelectHTML("usageGrainSel", {
    value: "hour",
    options: [
      { value: "hour", label: "按小时" },
      { value: "day", label: "按天" },
    ],
    onChange: () => loadUsageStats(),
  });
  for (const id of ["usageStart", "usageEnd"]) {
    $("#" + id).addEventListener("change", () => {
      _usageFilterReady = false;
      if ($("#usageStart").value || $("#usageEnd").value) uiSelectSet("usageDaysSel", "custom");
      else uiSelectSet("usageDaysSel", "today");
    });
  }
}

function _usageDatesValid() {
  const start = $("#usageStart").value, end = $("#usageEnd").value;
  return !start || !end || start <= end;
}
function _usageTimeParams() {
  const start = $("#usageStart").value, end = $("#usageEnd").value;
  const params = new URLSearchParams();
  if (start || end) {
    if (start) params.set("start", new Date(start + "T00:00:00").toISOString());
    if (end) params.set("end", new Date(end + "T23:59:59.999").toISOString());
  } else if (uiSelectValue("usageDaysSel") === "today") {
    // 今日 = 北京时间 00:00 起的自然日（与账号池「今日已用」同口径）
    const t = new Date(Date.now() + 8 * 3600000);
    const cnMidnight = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - 8 * 3600000;
    params.set("start", new Date(cnMidnight).toISOString());
  } else params.set("days", String(Number(uiSelectValue("usageDaysSel")) || 1));
  return params;
}
async function applyUsageDates() {
  if (!_usageDatesValid()) return toast("开始日期不能晚于结束日期", "err");
  _usageFilterReady = false;
  await loadUsageFilterOptions();
  await loadUsageStats();
}

// 渲染 Key/模型/端点筛选下拉。
// 选项只列窗口内真实出现过的值 —— 否则下拉里塞满从没用过的模型，
// 选中后筛出空结果，用户会以为"功能坏了"。
async function loadUsageFilterOptions() {
  if (!_usageDatesValid()) return;
  const windowQuery = _usageTimeParams().toString();
  let opts = { models: [], use_cases: [], keys: [] };
  try {
    const r = await api('/api/stats/usage/options?' + windowQuery);
    const { ok, data } = await safeJson(r);
    if (ok) opts = data || opts;
  } catch (e) { /* 选项拉取失败不阻塞统计展示 */ }
  if (windowQuery !== _usageTimeParams().toString()) return;
  _usageOpts = opts;

  // 保留当前选择；但若该值本次不在选项里（换了时间窗后消失），
  // 必须回落到"全部"，否则会出现「标签写着全部、实际仍在筛选」的假象。
  const keep = (id, val, list) =>
    (val && list.some(x => String(x) === val)) ? val : "";

  const curKey = uiSelectValue("usageKeySel") || "";
  const curModel = uiSelectValue("usageModelSel") || "";
  const curCase = uiSelectValue("usageCaseSel") || "";
  const curAccount = uiSelectValue("usageAccountSel") || "";
  const keyVals = (opts.keys || []).map(k => String(k.id));

  // 平台筛选：选项 = 窗口内真有数据的平台（+ 历史未记录平台）。
  // `value` 用落库平台名（trae / qoder / loomy…），后端按它收窄。
  const pBox = $("#usagePlatformSel");
  if (pBox) {
    const curPlatform = uiSelectValue("usagePlatformSel") || "";
    const platformVals = (opts.platforms || []).map(p => String(p.value || ""));
    pBox.outerHTML = uiSelectHTML("usagePlatformSel", {
      value: platformVals.includes(curPlatform) ? curPlatform : "",
      options: [{ value: "", label: "全部平台（全网关）" }].concat(
        (opts.platforms || []).map(p => ({
          value: String(p.value || ""),
          label: `${p.label}${p.requests ? ` · ${p.requests} 次` : ""}`,
        }))),
      onChange: () => loadUsageStats(),
    });
  }
  const keyBox = $("#usageKeySel");
  if (keyBox) {
    keyBox.outerHTML = uiSelectHTML("usageKeySel", {
      value: keep("usageKeySel", curKey, keyVals),
      options: [{ value: "", label: "全部 Key" }].concat(
        (opts.keys || []).map(k => ({ value: String(k.id), label: k.name || ("#" + k.id) }))),
      onChange: () => loadUsageStats(),
    });
  }
  const mBox = $("#usageModelSel");
  if (mBox) {
    // 选项现在是 {value,label}：value 是落库 id，label 是展示名
    // （Qoder 的 dfmodel 显示成 DeepSeek-V4.1-Flash）。兼容旧的字符串形式。
    const modelOpts = (opts.models || []).map(m =>
      (typeof m === "string") ? { value: m, label: m }
        : { value: String(m.value || m.model || ""), label: m.label || m.value || "" });
    mBox.outerHTML = uiSelectHTML("usageModelSel", {
      value: keep("usageModelSel", curModel, modelOpts.map(o => o.value)),
      options: [{ value: "", label: "全部模型" }].concat(modelOpts),
      onChange: () => loadUsageStats(),
    });
  }
  const aBox = $("#usageAccountSel");
  if (aBox) aBox.outerHTML = uiSelectHTML("usageAccountSel", {
    value: keep("usageAccountSel", curAccount, (opts.accounts || []).map(a => String(a.id))),
    options: [{value:"", label:"全部账号"}].concat((opts.accounts || []).map(a => ({value:String(a.id), label:`${a.name} · #${a.id}`}))),
    onChange: () => loadUsageStats(),
  });
  const cBox = $("#usageCaseSel");
  if (cBox) {
    cBox.outerHTML = uiSelectHTML("usageCaseSel", {
      value: keep("usageCaseSel", curCase, opts.use_cases || []),
      options: [{ value: "", label: "全部端点" }].concat(
        (opts.use_cases || []).map(c => ({ value: c, label: c }))),
      onChange: () => loadUsageStats(),
    });
  }
  _usageFilterReady = true;
}

/** 平台分布条 → 下钻：把下拉同步成该平台再重查（下拉与筛选必须同源）。 */
function setUsagePlatform(value) {
  uiSelectSet("usagePlatformSel", value || "", false);
  loadUsageStats();
}

function resetUsageFilters() {  // 必须走 uiSelectSet：下拉的真实状态在 _uiSelectMap 里，
  // 直接改 DOM 的 dataset 只会让标签变了、筛选值还在。
  uiSelectSet("usageKeySel", "", false);
  uiSelectSet("usageModelSel", "", false);
  uiSelectSet("usageCaseSel", "", false);
  uiSelectSet("usageAccountSel", "", false);
  uiSelectSet("usagePlatformSel", "", false);
  uiSelectSet("usageDaysSel", "today", false);
  for (const id of ["usageStart", "usageEnd"]) { $("#" + id).value = ""; window.WBDateTimePicker?.sync(id); }
  _usageFilterReady = false;
  loadUsageStats();
}

/* 当前筛选条件 -> query string，并生成一句人话提示 */
function _usageQuery() {
  const grain = uiSelectValue("usageGrainSel") || "hour";
  const key = uiSelectValue("usageKeySel") || "";
  const model = uiSelectValue("usageModelSel") || "";
  const cs = uiSelectValue("usageCaseSel") || "";
  const account = uiSelectValue("usageAccountSel") || "";
  const platform = uiSelectValue("usagePlatformSel") || "";
  const qs = _usageTimeParams();
  qs.set("granularity", grain);
  if (key) qs.set("key_id", key);
  if (model) qs.set("model", model);
  if (cs) qs.set("use_case", cs);
  if (account) qs.set("account_id", account);
  if (platform) qs.set("platform", platform);

  const keyName = ((_usageOpts.keys || []).find(k => String(k.id) === key) || {}).name || key;
  const conds = [];
  const start = $("#usageStart").value, end = $("#usageEnd").value;
  const daysMode = uiSelectValue("usageDaysSel") || "today";
  if (start || end) conds.push("日期=" + (start || "…") + " ~ " + (end || "…"));
  else if (daysMode === "today") conds.push("今日（自然日）");
  else if (daysMode !== "custom" && Number(daysMode) > 0) conds.push(`近 ${daysMode} 天（滚动）`);
  if (key) conds.push(`Key=${keyName}`);
  if (model) conds.push(`模型=${model}`);
  if (cs) conds.push(`端点=${cs}`);
  if (account) conds.push(`账号=${(_usageOpts.accounts || []).find(a=>String(a.id)===account)?.name || account}`);
  if (platform) conds.push(`平台=${(_usageOpts.platforms || []).find(p=>String(p.value)===platform)?.label || platform}`);
  return { qs: qs.toString(), conds };
}

// 空结果说明：区分「本来就没量」和「被筛选条件筛没了」，
// 后者要提示清除筛选，否则用户会以为数据丢了。
function _usageEmpty(conds) {
  const tip = conds.length
    ? `当前筛选条件（${esc(conds.join("，"))}）下没有记录，试试放宽时间范围或
       <a href="javascript:resetUsageFilters()" class="text-emerald-600 underline">清除筛选</a>`
    : "该时间范围内没有任何请求记录";
  return `<div class="text-sm text-slate-400 py-8 text-center">${tip}</div>`;
}

async function loadUsageStats() {  initUsageSelects();
  const generation = ++_usageLoadGeneration;
  if (!_usageDatesValid()) return toast("开始日期不能晚于结束日期", "err");
  if (!_usageFilterReady) await loadUsageFilterOptions();
  if (generation !== _usageLoadGeneration) return;

  const { qs, conds } = _usageQuery();
  const ov = $("#usageOverview");
  const hint = $("#usageFilterHint");
  if (ov) ov.innerHTML = `<div class="col-span-4 text-sm text-slate-400">加载中...</div>`;
  if (hint) {
    if (conds.length) {
      hint.classList.remove("hidden");
      hint.innerHTML = `<span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/></svg></span>已筛选：${esc(conds.join("，"))}（下方所有图表与卡片均限于此条件）`;
    } else {
      hint.classList.add("hidden");
    }
  }
  try {
    const r = await api(`/api/stats/usage?${qs}`);
    const { ok, data: d } = await safeJson(r);
    if (generation !== _usageLoadGeneration) return;
    if (!ok) { if (ov) ov.innerHTML = `<div class="col-span-4 text-sm text-red-500">加载失败: ${esc(d.detail || "")}</div>`; return; }

    const o = d.overview || {};
    const accountBox = $('#usageAccountModels');
    accountBox.classList.toggle('hidden', !d.filters?.account_id);
    const limitLabels = {model_daily:'日限额', model_rate:'模型限流', model_queue:'排队限制'};
    const sourceLabels = {upstream:'上游返回', estimated:'估算', queue_retry:'上游重试时间', backoff:'本地退避'};
    accountBox.innerHTML = `<h3 class="text-sm font-semibold mb-2">所选账号 · 模型用量与限额</h3><p class="text-xs text-slate-400 mb-3">用量为所选日期内经过本网关的记录；限额为当前观测状态，上游未提供总额度和剩余额度时不推算。</p>
      <div class="overflow-x-auto"><table class="tbl min-w"><thead><tr><th>模型</th><th class="text-right">请求 / 成功 / 失败</th><th class="text-right">Token</th><th class="text-right">积分</th><th>当前限制</th><th>恢复时间</th></tr></thead><tbody>${(d.account_models||[]).map(m=>`<tr><td class="font-mono text-xs">${fmtEmpty(m.model)}</td><td class="text-right">${fmtNum(m.requests)} / ${fmtNum(m.successes)} / ${fmtNum(m.failures)}</td><td class="text-right">${fmtNum(m.tokens)}</td><td class="text-right">${fmtCredit(m.credits)}</td><td>${m.limit ? `${esc(limitLabels[m.limit.kind]||m.limit.kind)}${m.limit.upstream_code ? ' · '+esc(m.limit.upstream_code) : ''}` : FMT_EMPTY}</td><td>${m.limit ? `${fmtTime(m.limit.until)} · ${esc(sourceLabels[m.limit.reset_source]||m.limit.reset_source)}` : FMT_EMPTY}</td></tr>`).join('') || '<tr><td colspan="6">当前筛选下无模型用量或限制记录</td></tr>'}</tbody></table></div>`;
    $('#usageAccountChart').innerHTML = (d.by_account || []).length ? donutChart(d.by_account, 'requests') : _usageEmpty(conds);
    $('#usageResultChart').innerHTML = (d.by_result || []).length ? donutChart(d.by_result, 'requests') : _usageEmpty(conds);
    const failTip = o.failed_requests ? `（含失败 ${fmtNum(o.failed_requests)}）` : "";
    if (ov) ov.innerHTML = `
      ${card("总请求数", fmtNum(o.requests) + failTip, "fa-paper-plane", "text-indigo-600")}
      ${card("总 Token", fmtNum(o.total_tokens), "fa-cube", "text-amber-600")}
      ${card("总消费", fmtCredit(o.credits), "fa-coins", "text-emerald-600")}
      ${card("平均耗时", o.avg_latency_ms ? fmtDuration(o.avg_latency_ms) : FMT_EMPTY, "fa-stopwatch", "text-violet-600")}`;

    // 平台分布条：全部平台口径下展示每家贡献（请求 / 积分），点了直接下钻。
    // 已选平台时整块隐藏，避免「筛了 loomy 还满屏平台名」的噪音。
    const strip = $("#usagePlatformStrip");
    if (strip) {
      const rows = (d.platforms || []).filter(p => p.requests > 0);
      if (d.platform && rows.length <= 1) {
        strip.classList.add("hidden");
        strip.innerHTML = "";
      } else if (rows.length) {
        strip.classList.remove("hidden");
        strip.innerHTML = `<span class="usage-platform-strip-label">平台分布</span>` +
          rows.map(p => `<button type="button" class="usage-platform-chip${p.value === d.platform ? " active" : ""}"
              data-usage-platform="${esc(p.value)}"
              onclick="setUsagePlatform('${esc(p.value)}')"
              data-tooltip="${esc(p.label)} · 点击只看该平台">
              <b>${esc(p.label)}</b>
              <span>${fmtNum(p.requests)} 次</span>
              <i>${fmtCredit(p.credits)} 积分</i>
            </button>`).join("");
      } else {
        strip.classList.add("hidden");
        strip.innerHTML = "";
      }
    }

    // 空结果时明确说明，而不是留一片空白让人以为没加载出来
    const empty = !(d.trend || []).length;
    if (empty) {
      $("#usageModelChart").innerHTML = _usageEmpty(conds);
      $("#usageKeyChart").innerHTML = _usageEmpty(conds);
      $("#usageEndpointChart").innerHTML = _usageEmpty(conds);
      $("#usageTrendChart").innerHTML = _usageEmpty(conds);
      return;
    }

    for (const [id, rows] of [['usageModelChart', d.by_model], ['usageKeyChart', d.by_key], ['usageEndpointChart', d.by_endpoint]]) {
      const metric = (rows || []).some(r => r.credits > 0) ? 'credits' : 'requests';
      const chart = $('#' + id);
      chart.previousElementSibling.querySelector('span').textContent = metric === 'credits' ? '按积分' : '按成功请求数';
      // 模型分布带平台名（同模型在不同平台是两笔账）；已按平台筛选时隐藏。
      chart.innerHTML = donutChart(rows, metric, {
        showPlatform: id === 'usageModelChart' && !d.platform,
      });
    }
    $("#usageTrendChart").innerHTML = trendChart(d.trend);
  } catch (e) {
    if (generation !== _usageLoadGeneration) return;
    if (ov) ov.innerHTML = `<div class="col-span-4 text-sm text-red-500">加载异常: ${esc(e.message)}</div>`;
  }
}

