let _confirmResolve = null;

function uiConfirm(opts) {
  opts = opts || {};
  const mask = $("#confirmMask");
  if (!mask) return Promise.resolve(window.confirm(opts.message || "确认？")); // 兜底

  const danger = opts.danger !== false; // 默认按危险操作处理（多为删除/覆盖）
  const kind = opts.kind || (danger ? "danger" : "info");
  const icons = { danger: "fa-triangle-exclamation", warn: "fa-circle-exclamation", info: "fa-circle-question" };
  const tones = { danger: "danger", warn: "warn", info: "info" };

  $("#confirmIco").className = "confirm-ico " + (tones[kind] || "danger");
  $("#confirmIco").innerHTML = ic(icons[kind] || icons.danger, "confirm-glyph");
  $("#confirmTitle").textContent = opts.title || "确认操作";
  $("#confirmMsg").textContent = opts.message || "";   // textContent：不解析 HTML，防注入
  const okBtn = $("#confirmOk");
  okBtn.textContent = opts.okText || "确认";
  okBtn.className = "px-3.5 py-1.5 rounded-lg text-sm " +
    (kind === "danger" ? "bg-red-600 hover:bg-red-700 text-white" : "btn-primary");

  mask.classList.add("show");
  setTimeout(() => okBtn.focus(), 30);

  return new Promise(resolve => { _confirmResolve = resolve; });
}

function _confirmClose(val) {
  const mask = $("#confirmMask");
  if (mask) mask.classList.remove("show");
  if (_confirmResolve) { const r = _confirmResolve; _confirmResolve = null; r(val); }
}

document.addEventListener("DOMContentLoaded", () => {
  const ok = $("#confirmOk"), cancel = $("#confirmCancel"), mask = $("#confirmMask");
  if (ok) ok.onclick = () => _confirmClose(true);
  if (cancel) cancel.onclick = () => _confirmClose(false);
  // 点击遮罩空白处 = 取消（点 .confirm-box 内部不关闭）
  if (mask) mask.addEventListener("click", e => {
    if (e.target === mask) _confirmClose(false);
  });
  document.addEventListener("keydown", e => {
    if (!mask || !mask.classList.contains("show")) return;
    if (e.key === "Escape") { e.stopPropagation(); _confirmClose(false); }
    if (e.key === "Enter") { e.stopPropagation(); _confirmClose(true); }
  }, true); // capture：抢在全局 Esc 关 modal 之前处理
});

/* ==================== 自研下拉组件（替换原生 select）====================
 * 原生 select 的弹出层由操作系统绘制，无法套用主题样式，因此自研。
 * 用法：
 *   <div class="ui-select" id="mySel"></div>
 *   uiSelect('#mySel', { value, options:[{value,label}], onChange(v), placeholder })
 * 也提供 uiSelectHTML(id, opts) 直接生成 HTML 字符串（用于弹窗内嵌）。
 */
const _uiSelectMap = new Map();  // id -> {options, value, onChange}

function uiSelectHTML(id, opts) {
  opts = opts || {};
  const options = opts.options || [];
  const val = opts.value != null ? String(opts.value) : (options[0] ? String(options[0].value) : "");
  _uiSelectMap.set(id, { options, value: val, onChange: opts.onChange || null });

  const cur = options.find(o => String(o.value) === val);
  const label = cur ? cur.label : (opts.placeholder || "请选择");
  const cls = opts.class || "border rounded-lg px-3 py-2 text-sm";

  return `<div class="ui-select" id="${id}">
    <div class="ui-select-btn ${cls}" onclick="uiSelectToggle('${id}', event)">
      <span class="ui-select-label truncate">${esc(label)}</span>
      <span class="wb-icon ui-select-arrow"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>
    </div>
    <div class="ui-select-panel">
      ${options.map(o => `
        <div class="ui-select-opt ${String(o.value) === val ? "sel" : ""}"
             data-value="${esc(String(o.value))}" onclick="uiSelectPick('${id}',this.dataset.value,event)">
          <span class="truncate">${esc(o.label)}</span>
          ${String(o.value) === val ? '<span class="wb-icon ui-select-check"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span>' : ""}
        </div>`).join("") || '<div class="ui-select-opt text-slate-400">无可选项</div>'}
    </div>
  </div>`;
}

function uiSelectClose(el) {
  if (!el || !el.classList.contains("open") || el.classList.contains("closing")) return;
  el.classList.add("closing");
  // 面板上收动画播完再摘掉 open（约 135ms），避免闪变
  setTimeout(() => el.classList.remove("open", "closing"), 135);
}
function uiSelectToggle(id, ev) {
  if (ev) ev.stopPropagation();
  const el = $("#" + id);
  if (!el) return;
  const wasOpen = el.classList.contains("open");
  // 同时只开一个，避免面板互相重叠
  document.querySelectorAll(".ui-select.open").forEach(x => { if (x.id !== id) uiSelectClose(x); });
  if (wasOpen) uiSelectClose(el); else el.classList.add("open");
}

function uiSelectPick(id, value, ev, notify = true) {
  if (ev) ev.stopPropagation();
  const st = _uiSelectMap.get(id);
  const el = $("#" + id);
  if (!st || !el) return;
  st.value = value;
  const o = st.options.find(x => String(x.value) === value);
  const lab = el.querySelector(".ui-select-label");
  if (lab && o) lab.textContent = o.label;
  el.querySelectorAll(".ui-select-opt").forEach(opt => {
    const on = opt.dataset.value === value;
    opt.classList.toggle("sel", on);
    // 重建勾选图标
    const old = opt.querySelector(".ui-select-check");
    if (on && !old) opt.insertAdjacentHTML("beforeend", '<span class="wb-icon ui-select-check"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span>');
    if (!on && old) old.remove();
  });
  uiSelectClose(el);
  if (notify && st.onChange) st.onChange(value, o);
}

function uiSelectValue(id) {
  const st = _uiSelectMap.get(id);
  return st ? st.value : "";
}
function uiSelectSet(id, value, notify = true) {
  uiSelectPick(id, String(value), null, notify);
}
const $ = (s) => document.querySelector(s);
const TOKEN_KEY = "wb_admin_token";
let TOKEN = localStorage.getItem(TOKEN_KEY) || "";
// 桌面托盘的「在浏览器中打开」会带一次性 JWT（?token=）：普通浏览器没有 pywebview 桥，
// ?desktop=1 的免密通道走不通。取到即存 localStorage 并清掉参数，避免 token 留在地址栏/历史里。
(() => {
  try {
    const t = new URLSearchParams(location.search).get("token");
    if (t) {
      TOKEN = t; localStorage.setItem(TOKEN_KEY, t);
      const u = new URL(location.href);
      u.searchParams.delete("token");
      history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
    }
  } catch (e) { /* 老浏览器兜底：忽略，走登录表单 */ }
})();

/* 时间格式化：数据库存的是 UTC，统一 +8 展示为北京时间（与服务器时区无关） */
function fmtTime(s, withSec = true) {
  if (!s) return FMT_EMPTY;
  const m = String(s).replace("T", " ").match(/(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return String(s).replace("T", " ");
  const Y = +m[1], Mo = +m[2], D = +m[3], H = +m[4], Mi = +m[5], S = +m[6];
  const total = Date.UTC(Y, Mo - 1, D, H, Mi, S) + 8 * 3600 * 1000;
  const d = new Date(total);
  const p = (n) => String(n).padStart(2, "0");
  const out = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return withSec ? out + ":" + p(d.getUTCSeconds()) : out;
}
/* ---- 表格展示格式的统一出口（见 docs/table-format-audit.md） ----
 * 空值一律 emdash：`-` 会和负号/分隔符混淆，且在数字列里会被读成「零」。
 * 以前同一个控制台里同时有 `-` / `—` / `未知` / `未观测到限制` 四种写法。 */
const FMT_EMPTY = "—";
function fmtEmpty(v) {
  if (v === null || v === undefined || v === "") return FMT_EMPTY;
  if (typeof v === "number" && !Number.isFinite(v)) return FMT_EMPTY;
  return String(v);
}
/* 比率：统一一位小数百分比；无样本给 emdash 而不是 0.0%（0.0% 会被当成"测过且为零"） */
function fmtPct(v, digits = 1) {
  if (v === null || v === undefined || v === "") return FMT_EMPTY;
  const n = Number(v);
  if (!Number.isFinite(n)) return FMT_EMPTY;
  return (n * 100).toFixed(digits) + "%";
}
/* 耗时：毫秒进、自动选单位出。
 *
 * 为什么必须做：之前全控制台写死 `ms`，几万毫秒也照写 `31245 ms` ——
 * 数字长得读不出量级，用户还得自己数位数。统一走这里：
 *
 *     < 1000ms      ->  "845 ms"
 *     < 60s         ->  "3.2s"
 *     < 60min       ->  "2分15秒"
 *     >= 60min      ->  "1小时02分"
 *
 * 入参单位固定是**毫秒**（后端 elapsed_ms / total_ms / ttfb_ms 都是毫秒）。
 * 空值/非数一律 emdash，不显示 0 ms（0 会被读成「瞬间」而实际是没测到）。 */
function fmtDuration(ms) {
  if (ms === null || ms === undefined || ms === "") return FMT_EMPTY;
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return FMT_EMPTY;
  if (n < 1000) return Math.round(n) + " ms";
  const totalSec = n / 1000;
  if (totalSec < 60) return totalSec.toFixed(1) + "s";
  const totalMin = Math.floor(totalSec / 60);
  const sec = Math.round(totalSec - totalMin * 60);
  if (totalMin < 60) {
    // 59.6s 四舍五入成 60 → 进位成 1 分钟，避免出现「0分60秒」
    return sec === 60 ? (totalMin + 1) + "分" : totalMin + "分" + String(sec).padStart(2, "0") + "秒";
  }
  const hour = Math.floor(totalMin / 60);
  const min = totalMin - hour * 60;
  return hour + "小时" + String(min).padStart(2, "0") + "分";
}
function fmtK(n) {
  n = Number(n) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

let _localSessionPromise = null, _localSessionReady = false;
async function ensureLocalSession(force = false) {
  if (_localSessionReady && !force) return;
  if (!_localSessionPromise) _localSessionPromise = (async () => {
    const token = window.pywebview?.api ? (await pywebview.api.desktop_login()).token : await WBAndroid.sessionToken();
    if (!token) throw new Error('本地连接凭据未准备好');
    TOKEN = token; localStorage.setItem(TOKEN_KEY, token); _localSessionReady = true;
  })().finally(() => { _localSessionPromise = null; });
  return _localSessionPromise;
}
async function api(path, opts = {}) {
  _loadStart();
  try {
    return await _apiRaw(path, opts);
  } finally {
    _loadEnd();
  }
}

/* 全局加载态：所有面板的请求都从这里过，只有「慢请求」才亮条。
 *
 * 为什么用计数 + 120ms 延迟，而不是每个面板自己 setLoading：
 *   · 一个面板往往并发发 2~4 个请求（列表 + 统计 + 平台卡），
 *     各自开关会让加载条疯狂闪；
 *   · 120ms 内返回的请求用户根本感知不到，亮一下反而像闪烁。
 * 计数归零才收起，慢请求才会被看见 —— 用户看到的「页面在动」，不是卡死。 */
let _apiPending = 0, _apiBarTimer = null;
function _loadStart() {
  _apiPending += 1;
  if (_apiPending !== 1) return;
  _apiBarTimer = setTimeout(() => {
    const bar = document.getElementById("globalLoadBar");
    if (bar) bar.classList.add("on");
  }, 120);
}
function _loadEnd() {
  _apiPending = Math.max(0, _apiPending - 1);
  if (_apiPending > 0) return;
  if (_apiBarTimer) { clearTimeout(_apiBarTimer); _apiBarTimer = null; }
  const bar = document.getElementById("globalLoadBar");
  if (bar) bar.classList.remove("on");
}

async function _apiRaw(path, opts = {}) {
  const localShell = window.pywebview?.api || window.WBAndroid?.sessionToken;
  // Prepare the non-expiring shell credential before the first request;
  // concurrent panel loads share one bridge call and never need a login form.
  if (localShell) await ensureLocalSession();
  opts.headers = Object.assign({ "X-Admin-Token": TOKEN }, opts.headers || {});
  // 平台作用域：**每个**后台请求都带上当前平台，后端据此收窄统计口径。
  // 只给账号池加平台筛选是不够的 —— 使用记录/日志/积分到期那些面板
  // 拿到的数据必须跟着平台走，否则平台一多就全是混算的数字。
  // 调用方显式给了 X-Platform 时以调用方为准（导出、对照查询等场景）。
  if (window.WBPlatform && !opts.headers["X-Platform"]) {
    Object.assign(opts.headers, window.WBPlatform.header());
  } else if (!opts.headers["X-Platform"]) {
    // `platform-switch.js` 在控制台主脚本**之后**加载 —— 首次渲染时
    // `window.WBPlatform` 还不存在。此时若不补 header，后端会按「全部平台」
    // 统计，表现是「切到 WorkBuddy，底部却显示 5 个账号」。
    // 直接读 localStorage 的落库值（`workbuddy` / `trae-cn` / `trae-intl`），
    // 与 WBPlatform.header() 同源，不引入第二套真相。
    try {
      const saved = JSON.parse(localStorage.getItem("wb_platform_current") || "null");
      const value = (saved && saved.platform) || "";
      if (value) opts.headers["X-Platform"] = value;
    } catch (_) { /* 存储损坏时按「全部平台」处理 */ }
  }
  let response = await fetch(path, opts);
  if (response.status === 401 && localShell) {
    try {
      await ensureLocalSession(true);
      opts.headers['X-Admin-Token'] = TOKEN;
      response = await fetch(path, opts);
    } catch (_) {}
  }
  return response;
}

/* ==================== 运行配置（.env 常用项动态改） ==================== */
let _runtimeFields = [];
let _runtimeDirty = new Set();
let _runtimeGroup = "";

async function loadRuntimeConfig() {
  const host = document.getElementById("runtimeConfigHost");
  if (!host) return;
  try {
    const { ok, data } = await safeJson(await api("/api/runtime-config"));
    if (!ok) throw new Error(data.detail || "加载失败");
    _runtimeFields = data.fields || [];
    _runtimeDirty = new Set();
    const groups = [...new Set(_runtimeFields.map(f => f.group))];
    if (!groups.includes(_runtimeGroup)) _runtimeGroup = groups[0] || "";
    renderRuntimeConfig(groups);
  } catch (e) {
    host.innerHTML = `<p class="fs-12" style="color:var(--danger)">运行配置加载失败：${esc(e.message)}</p>`;
  }
}
function renderRuntimeConfig(groups) {
  const host = document.getElementById("runtimeConfigHost");
  const overridden = _runtimeFields.filter(f => f.overridden).length;
  const dirtyCount = _runtimeDirty.size;
  host.innerHTML = `
    <div class="rt-toolbar">
      <div class="rt-group-sel" id="runtimeGroupHost"></div>
      <span class="rt-summary">${overridden ? `<span class="rt-override">已覆盖 ${overridden} 项</span>` : "全部为 .env 默认值"}${dirtyCount ? ` · <span style="color:var(--warn)">待保存 ${dirtyCount} 项</span>` : ""}</span>
    </div>
    <div class="rt-table">${_runtimeFields.filter(f => f.group === _runtimeGroup).map(runtimeFieldHtml).join("")}</div>`;
  const selHost = document.getElementById("runtimeGroupHost");
  if (selHost) {
    selHost.innerHTML = uiSelectHTML("runtimeGroupSel", {
      value: _runtimeGroup,
      options: groups.map(g => {
        const n = _runtimeFields.filter(f => f.group === g && f.overridden).length;
        return { value: g, label: g + (n ? ` · 已改 ${n}` : "") };
      }),
      onChange: value => { _runtimeGroup = value; renderRuntimeConfig(groups); },
    });
    initUISelects([["runtimeGroupSel", "配置分组"]]);
  }
  bindRuntimeControls(groups);
}
function runtimeFieldHtml(f) {
  const id = "rt-" + f.attr;
  const tips = [f.desc];
  if (f.kind === "int" || f.kind === "float") tips.push((f.max != null ? "范围 " + f.min + "~" + f.max : "最小 " + f.min) + " · 默认 " + f.default);
  if (f.kind === "str") tips.push("默认 " + (f.default ?? "空"));
  tips.push("保存后即时生效");
  const info = `<span class="wb-icon rt-info"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></span>`;
  const badge = f.overridden ? `<span class="rt-override" tabindex="0" data-tooltip="已覆盖默认值" data-tooltip-description="当前值偏离 .env 默认；点右侧「恢复默认」回落">已改</span>` : "";
  const restart = "";
  let control;
  if (f.kind === "bool") {
    control = `<label class="model-switch rt-switch"><input type="checkbox" id="${id}" ${f.value ? "checked" : ""} data-attr="${f.attr}" /><span></span></label>`;
  } else if (f.kind === "str") {
    control = `<input id="${id}" data-attr="${f.attr}" value="${esc(String(f.value ?? ""))}" placeholder="${esc(f.default ?? "")}" data-tooltip="默认：${esc(String(f.default ??""))}" />`;
  } else {
    control = `<input id="${id}" type="number" data-attr="${f.attr}" value="${f.value ?? ""}" min="${f.min ?? ""}"${f.max != null ? ` max="${f.max}"` : ""} step="${f.step ?? 1}" data-tooltip="${f.max != null ?"范围 " + f.min + "~" + f.max : "最小 " + f.min} · 默认 ${f.default}" />`;
  }
  return `<div class="rt-field${f.overridden ? " is-overridden" : ""}" id="wrap-${id}">
    <div class="rt-label"><span>${esc(f.label)}${info}${badge}${restart}</span></div>
    <div class="rt-control">${control}
      <button type="button" class="rt-reset" data-attr="${f.attr}" data-tooltip="恢复默认" data-tooltip-description="清除覆盖，回落 .env 默认值：${esc(String(f.default ?? ""))}" ${f.overridden || _runtimeDirty.has(f.attr) ? "" : "hidden"}>恢复默认</button>
    </div>
  </div>`;
}
function bindRuntimeControls(groups) {
  document.querySelectorAll("#runtimeConfigHost .rt-field [data-attr]").forEach(el => {
    el.addEventListener("change", () => {
      _runtimeDirty.add(el.dataset.attr);
      const wrap = document.getElementById("wrap-rt-" + el.dataset.attr);
      if (wrap) wrap.classList.add("is-dirty");
      const resetBtn = wrap && wrap.querySelector(".rt-reset");
      if (resetBtn) resetBtn.hidden = false;
    });
  });
  document.querySelectorAll("#runtimeConfigHost .rt-reset").forEach(btn => {
    btn.addEventListener("click", () => {
      const f = _runtimeFields.find(x => x.attr === btn.dataset.attr);
      if (!f) return;
      const el = document.getElementById("rt-" + f.attr);
      if (f.kind === "bool") el.checked = !!f.default;
      else el.value = f.kind === "str" ? (f.default ?? "") : (f.default ?? "");
      el.dataset.reset = "1";
      _runtimeDirty.add(f.attr);
      const wrap = document.getElementById("wrap-rt-" + f.attr);
      if (wrap) wrap.classList.add("is-dirty");
    });
  });
}

function askRestartAfterSave() {
  openModal('<h3><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg></span>配置已保存并即时生效</h3>' +
    '<p class="my-3">一般无需重启。若想彻底刷新进程状态（例如刚恢复过备份），可立即重启：监督器会自动拉起新实例，约 10 秒恢复。</p>' +
    '<div class="flex gap-2 justify-end mt-4"><button class="console-btn" onclick="closeModal()">暂不</button>' +
    '<button class="console-btn rt-restart-btn" id="restartSvcBtn" onclick="WBReview.doRestartService()"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></svg></span>立即重启</button></div>', 'max-w-lg');
}

async function saveRuntimeConfig() {
  const updates = {};
  for (const attr of _runtimeDirty) {
    const el = document.getElementById("rt-" + attr);
    if (!el) continue;
    if (el.dataset.reset === "1") { updates[attr] = null; continue; }
    updates[attr] = el.type === "checkbox" ? (el.checked ? 1 : 0) : el.value;
  }
  if (!Object.keys(updates).length) { toast("没有更改需要保存"); return; }
  const status = document.getElementById("runtimeConfigStatus");
  if (status) status.textContent = "保存中…";
  try {
    const { ok, data } = await safeJson(await api("/api/runtime-config", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    }));
    if (!ok) throw new Error(data.detail || "保存失败");
    const errs = data.errors || {};
    const errKeys = Object.keys(errs);
    _runtimeFields = data.fields || _runtimeFields;
    _runtimeDirty = new Set();
    renderRuntimeConfig([...new Set(_runtimeFields.map(f => f.group))]);
    if (errKeys.length) toast(`已保存，${errKeys.length} 项未通过校验：${errKeys.map(k => k + " " + errs[k]).join("；").slice(0, 120)}`, "err");
    else {
      const changed = (data.changed || []).length, reverted = (data.reverted || []).length;
      toast(`已保存并生效：${changed} 项更新${reverted ? ` · ${reverted} 项恢复默认` : ""}`, "ok");
      askRestartAfterSave();
    }
  } catch (e) {
    toast("保存失败：" + e.message, "err");
  } finally {
    if (status) status.textContent = "";
  }
}

async function loadInvitation() {
  try {
    const {ok, data} = await safeJson(await api('/api/settings/invitation'));
    if (!ok) throw new Error(data.detail || '读取邀请设置失败');
    $('#invitationInput').value = data.invite_code || '';
    $('#invitationStatus').textContent = data.enabled ? '已启用' : '未启用';
  } catch (e) { $('#invitationStatus').textContent = e.message; }
}
async function saveInvitation() {
  const btn = $('#invitationSave');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const {ok, data} = await safeJson(await api('/api/settings/invitation', {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({value:$('#invitationInput').value})
    }));
    if (!ok) throw new Error(typeof data.detail === 'string' ? data.detail : '保存失败');
    $('#invitationInput').value = data.invite_code || '';
    $('#invitationStatus').textContent = data.enabled ? '已启用' : '未启用';
    toast(data.enabled ? '邀请绑定已保存' : '邀请绑定已停用');
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}
async function clearInvitation() {
  if ($('#invitationSave').disabled) return;
  $('#invitationInput').value = '';
  await saveInvitation();
}
async function safeJson(r) {
  /* 容错解析：后端偶发返回非 JSON（如 500 明文）时，避免报 "Unexpected token" 崩溃 */
  const t = await r.text();
  try { return { ok: r.ok, status: r.status, data: t ? JSON.parse(t) : {} }; }
  catch (e) { return { ok: false, status: r.status, data: { detail: t || ("HTTP " + r.status), _parse_error: true } }; }
}
function toast(msg, type = "ok") {
  const c = type === "ok" ? "bg-emerald-600" : "bg-red-600";
  const el = document.createElement("div");
  el.className = `text-white text-sm px-4 py-2 rounded-lg shadow ${c} fade-in`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
let _modalCloseTimer = null;
function openModal(html, widthClass) {
  if (_modalCloseTimer) { clearTimeout(_modalCloseTimer); _modalCloseTimer = null; }
  $("#modal").classList.remove("closing");
  $('#modal').dataset.closeOnly = '';
  const box = $("#modalBox");
  window.WBDateTimePicker?.destroyWithin(box);
  // Reset every previous size, including the phone-login max-w-md class.
  [...box.classList].filter(name => /^max-w-/.test(name)).forEach(name => box.classList.remove(name));
  box.classList.add(widthClass || "max-w-6xl");
  const sizes = {"max-w-sm":400,"max-w-md":480,"max-w-lg":640,"max-w-xl":720,
    "max-w-2xl":800,"max-w-3xl":900,"max-w-4xl":1000,"max-w-6xl":1120};
  box.style.setProperty("--modal-width", (sizes[widthClass] || 1120) + "px");
  box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
  box.innerHTML = '<button type="button" class="modal-close-button" onclick="closeModal()" aria-label="关闭弹窗">×</button>' + html;
  box.scrollTop = 0;
  // CSS starts the entrance animation when the hidden dialog becomes visible.
  // Updating an already open dialog must not force layout or replay its animation.
  $("#modal").classList.remove("hidden");
  $("#modal").classList.add("flex");
}
function closeModal() {
  window.WBUsage?.closeDetail(); window.WBPhone?.closeRegion(); window.WBDateTimePicker?.close();
  const m = $("#modal");
  if (!m || m.classList.contains("hidden") || m.classList.contains("closing")) return;
  m.classList.add("closing");
  // 关闭动画播完再真正隐藏（约 175ms）
  _modalCloseTimer = setTimeout(() => {
    _modalCloseTimer = null;
    m.classList.remove("closing", "flex"); m.classList.add("hidden");
    if ($('#usageDiagnosticText') || $('#usageDetailLoading')) $('#modalBox').replaceChildren();
  }, 175);
}
/**
 * 直接复制一段文本（不依赖 DOM 选择器）。
 *
 * `copyText(sel)` 是「按选择器取内容」，传纯文本会静默失败；
 * 需要复制变量内容时用这个。
 */
async function copyRawText(text) {
  const value = String(text ?? "");
  if (!value) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      toast("已复制 " + value, "ok");
      return true;
    }
  } catch (_) { /* 落到 execCommand */ }
  const previous = document.activeElement;
  const field = document.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
  document.body.append(field);
  field.select();
  field.setSelectionRange(0, value.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
  field.remove();
  previous?.focus?.({ preventScroll: true });
  toast(ok ? ("已复制 " + value) : "复制失败，请手动选中", ok ? "ok" : "err");
  return ok;
}

async function copyText(sel){
  const source = $(sel); if(!source) return;
  const text = source.value ?? source.textContent ?? '';
  try {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    toast('已复制'); return;
  } catch (_) {}
  const previous = document.activeElement;
  const field = document.createElement('textarea');
  field.value = text; field.readOnly = true;
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
  document.body.append(field); field.select(); field.setSelectionRange(0, text.length);
  let copied = false;
  try { copied = document.execCommand('copy'); } catch (_) {}
  finally { field.remove(); previous?.focus?.({preventScroll:true}); }
  toast(copied ? '已复制' : '复制失败，请选中文字复制', copied ? 'ok' : 'err');
}

document.addEventListener("DOMContentLoaded", () => {
  $("#modal")?.addEventListener("click", (e) => { if (e.target === $("#modal") && !$('#modal').dataset.closeOnly) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$('#modal').dataset.closeOnly) closeModal(); });

  // 登录页回车提交（用户名 / 密码框内按 Enter）
  ["username", "password"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); doLogin(); }
    });
  });
});

function browserFingerprint() {
  try {
    const bits = [navigator.userAgent, navigator.language, (navigator.languages || []).join(","),
      screen.width + "x" + screen.height + "x" + (screen.colorDepth || 0),
      (Intl.DateTimeFormat().resolvedOptions().timeZone || ""),
      String(navigator.hardwareConcurrency || ""), String(navigator.deviceMemory || "")];
    const s = bits.join("|");
    let a = 0x811c9dc5, b = 0x9e3779b9;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = (Math.imul(a ^ c, 0x01000193)) >>> 0;
      b = (Math.imul(b ^ ((c + i) & 0xffff), 0x85ebca6b)) >>> 0;
    }
    return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
  } catch (e) { return ""; }
}

async function doLogin() {
  const fp = browserFingerprint();
  const fd = new URLSearchParams({ username: $("#username").value, password: $("#password").value });
  const btn = $("#loginBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="wb-icon mr-1 wb-ic-spin"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span> 登录中...'; }
  const showErr = (m) => {
    const el = $("#loginErr");
    if (el) { el.textContent = m; el.classList.remove("hidden"); }
  };
  try {
    const r = await fetch("/api/login", { method: "POST", body: fd, headers: fp ? { "X-Browser-Fingerprint": fp } : {} });
    if (!r.ok) {
      // 尽量给出真实原因，而不是笼统的"登录失败"
      let msg = "登录失败";
      try {
        const j = await r.json();
        if (j && j.detail) {
          msg = typeof j.detail === "string" ? j.detail
              : (Array.isArray(j.detail) ? (j.detail[0] && j.detail[0].msg) || "参数错误" : JSON.stringify(j.detail));
        }
      } catch (e) { /* 非 JSON 响应，沿用默认文案 */ }
      if (r.status === 401) msg = "用户名或密码错误";
      showErr(msg);
      return;
    }
    const d = await r.json();
    TOKEN = d.token; localStorage.setItem(TOKEN_KEY, TOKEN);
    enterApp();
  } catch (e) {
    showErr("网络异常：" + (e && e.message ? e.message : e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "登录"; }
  }
}
async function logout() {
  try { await fetch("/api/login/logout", { method: "POST" }); } catch (e) {}
  localStorage.removeItem(TOKEN_KEY); location.reload();
}
/**
 * 显示登录卡片。
 *
 * 服务端在确认有会话 Cookie 时会把 `<html>` 标成 `console-authed`，样式据此
 * 在第一帧就不画 `#login`（消除刷新时的登录页闪烁）。真正需要登录时
 * ——凭据两边都失效、或用户主动退出——必须把这个标记去掉，否则登录卡片
 * 会被那条 `display:none!important` 一直压住，页面看起来像卡死在空白。
 */
function showLoginCard() {
  document.documentElement.classList.remove("console-authed");
  const login = $("#login"), app = $("#app");
  if (app) app.classList.add("hidden");
  if (login) login.classList.remove("hidden");
}
function enterApp() {
  document.documentElement.classList.remove("console-authed");
  $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
  $("#proxyUrl").textContent = location.origin + "/v1";
  // 首屏只拉「概览 + 账号池 + 侧栏角标」需要的数据。
  // 日志（loadLogs）**有意不在这里调**：它要额外打 3 个请求（选项/汇总/列表），
  // 而用户可能根本不打开日志面板 —— 让首屏为它付代价是纯浪费，
  // 改成切到该面板时由 openLogsPanel() 按需加载。
  loadAccounts(); loadKeys(); loadModels(); loadSchedules(); loadSyncConfig(); loadShareInfo();
  // 还原地址栏里的面板（刷新后停在原页面，而不是跳回「账号」首页）。
  // updateUrl:false —— 地址栏本来就是这个值，不必再写一次。
  activateTab(_tabFromUrl(), { updateUrl: false });
}

// Tabs
// 面板清单与默认面板：默认面板不写进 URL（保持地址栏干净）。
const TABS = ["overview","sentinel","platforms","accounts","credits","journal","growth","usage","logs","keys","ip","models","groups","agent","schedules","client","sync","alerts","gateway","settings","maintenance"];
const TAB_DEFAULT = "overview";

/** 从地址栏读当前应显示的面板；非法/缺失一律回落到默认面板。 */
function _tabFromUrl() {
  let t = null;
  try { t = new URLSearchParams(location.search).get("tab"); } catch (e) { /* 老浏览器兜底 */ }
  return TABS.includes(t) ? t : TAB_DEFAULT;
}

/**
 * 等待平台切换脚本就绪并完成一次加载。
 *
 * 为什么需要它：`platform-switch.js` 在控制台主脚本**之后**才加载，
 * 而首屏的 `activateTab()` 在 DOMContentLoaded 里就跑了 —— 那时
 * `window.WBPlatform` 还不存在。直接 `if (window.WBPlatform)` 会静默
 * 跳过，表现为「面板出来了但内容空白」。
 *
 * 这里轮询等待（最多 5 秒），拿到后只初始化一次。
 */
let _platformReady = null;
function ensurePlatforms() {
  if (_platformReady) return _platformReady;
  _platformReady = new Promise((resolve) => {
    let tries = 0;
    const tick = () => {
      if (window.WBPlatform) {
        resolve(window.WBPlatform.enter());
        return;
      }
      if (++tries > 100) {  // ~5s
        console.warn("[platform] 平台切换脚本未就绪，跳过");
        resolve(null);
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
  return _platformReady;
}

/**
 * 当前**真正显示**的面板名。
 *
 * 为什么不直接读 URL：`activateTab` 用 `history.replaceState` 更新地址栏，
 * 而平台切换事件是在面板渲染之后才派发的 —— 那时 URL 可能还未更新
 * （首屏更是空）。任何「面板变了就刷新」的逻辑读 URL 都会拿到旧值，
 * 典型症状是「切完平台当前面板不刷新，切走再回来才对」。
 */
let _activeTab = TAB_DEFAULT;

/**
 * 激活某个面板：切 class、按需拉数据，并把面板写进 `?tab=`。
 *
 * 为什么要写 URL：面板状态原先只活在内存里，刷新/被踢回登录后再进来、
 * 或把地址发给别人，都会一律跳回「平台管理」首页 —— 在「客户端参数」「日志」
 * 这种深层面板上反复操作时尤其烦。
 *
 * 用 `replaceState` 而不是 `pushState`：切面板不该在历史栈里堆一长串，
 * 浏览器「后退」应当离开本页，而不是在面板之间来回跳。
 */
function activateTab(name, opts) {
  if (!TABS.includes(name)) name = TAB_DEFAULT;
  _activeTab = name;
  if (name !== 'logs') stopLogActivity();
  document.documentElement.dataset.activeTab = name;
  window.WBDateTimePicker?.close();
  window.WBFilterCombobox?.close();
  TABS.forEach(t => { const el = $(`#panel-${t}`); if (el) el.classList.toggle("hidden", t !== name); });
  // 侧栏分组高亮、子标签条、顶栏标题、平台切换器（见 05-nav.js）
  renderNavChrome(name);
  if (PLATFORM_SCOPED_TABS.has(name)) ensurePlatforms().then(renderTopbarPlatform);

  if (!opts || opts.updateUrl !== false) {
    try {
      const u = new URL(location.href);
      if (name === TAB_DEFAULT) u.searchParams.delete("tab");
      else u.searchParams.set("tab", name);
      history.replaceState(null, "", u);
    } catch (e) { /* 非 http 环境（file://）下忽略即可 */ }
  }

  // 切到这几个面板时按需拉数据（图表/分组列表/客户端参数不必在首屏就请求）
  //
  // ⚠️ 平台切换脚本（platform-switch.js）在**控制台主脚本之后**加载，
  // 而首屏的 activateTab 是在 DOMContentLoaded 里跑的 —— 那一刻
  // `window.WBPlatform` 还不存在。原来写成 `if (window.WBPlatform) ...`
  // 会静默跳过，结果「平台管理」成为默认面板后**一片空白**
  // （面板显示了、卡片区是空的）。这里改成延迟到脚本就绪再补一次。
  // 概览：每次进入面板都强制重跑计数动效（force=true），
  // 让「切 tab / 点刷新」都能看到数字从 0 滚到目标值。
  if (name === "overview") loadOverview(true);
  if (name === "sentinel") {
    if (typeof loadSentinel === "function") loadSentinel();
    setTimeout(() => {
      if (typeof sentinelInitTraffic === "function") sentinelInitTraffic(true);
    }, 240);
  }
  if (name === "platforms") ensurePlatforms().then(() => {
    loadPlatformOverview();
    loadPlatformBench();
  });
  if (name === "gateway") { loadGateway(); loadGatewaySpeed(); }
  if (name === "accounts") ensurePlatforms().then(() => loadAccounts());
  if (name === "journal") window.WBReview?.loadJournal(1);
  if (name === "maintenance") window.WBReview?.loadUpdate();
  if (name === "groups") loadGroups();
  if (name === "usage") loadUsageStats();
  if (name === "keys") { loadKeys(); loadShareInfo(); }
  if (name === "ip") window.WBIP?.load();
  if (name === "credits") loadCreditStats();
  if (name === "logs") openLogsPanel();
  if (name === "client") initClientPanel();
  if (name === "alerts") loadAlerts();
  if (name === "settings") { loadAppSource(); loadInvitation(); loadRuntimeConfig(); }
  // 模型面板：进入时按当前平台重置过滤（见 loadModels 的说明）。
  if (name === "models") { _modelPlatformFilter = ""; loadModels(); }
  // 定时任务：必须等平台解析完再加载 —— `loadSchedules` 要按平台过滤
  // （WorkBuddy 的签到任务不该出现在 Trae 平台下）。直接调会在
  // `WBPlatform` 尚未就绪时拿到空 storage，从而**跳过过滤**显示全量。
  if (name === "schedules") ensurePlatforms().then(() => loadSchedules());
  // 智能体面板的内容由它自己的脚本渲染。`agent.js` 在控制台主脚本**之后**
  // 加载，所以这里必须既处理「已经加载好」（直接 enter），也要在它还没就绪时
  // 挂一个一次性回调 —— 否则用 ?tab=agent 直接打开时，activateTab 先跑，
  // 那次调用会被 `?.` 静默吞掉，页面就停在空面板。
  if (name === "agent") window.WBAgent
    ? window.WBAgent.enter()
    : window.dispatchEvent(new Event('wb-agent-needed'));
  if (name === "growth") window.WBGrowthCenter?.enter();
  scheduleModelBusy();
}

