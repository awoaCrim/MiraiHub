/* ==================== 线上同步设置 ==================== */
function toggleSecret(){ const i=$("#syncSecret"); if(i) i.type = i.type==="password"?"text":"password"; }
async function loadSyncConfig(){
  const r = await api("/api/sync/config"); if(!r.ok) return; const d = await r.json();
  if($("#syncUrl")) $("#syncUrl").value = d.remote_url || "";
  if($("#syncSecret")) $("#syncSecret").value = d.secret || "";
  $("#syncStatus").innerHTML = `当前：远程 URL ${d.remote_url ? '<span class="text-emerald-600">已配置</span>' : '<span class="text-slate-400">未配置</span>'} · 密钥 ${d.secret ? '已生成'+(d.is_auto_generated?'（基于本机特征自动生成）':'（自定义）') : '<span class="text-slate-400">未设置</span>'}<span id="syncDirty" class="ml-2 text-amber-500 hidden">· <span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg></span> 有未保存改动</span>`;
  _bindSyncDirty();
}
async function saveSyncConfig(){
  const body = { remote_url: $("#syncUrl").value.trim(), secret: $("#syncSecret").value };
  const r = await api("/api/sync/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  toast(r.ok?"已保存同步配置":"保存失败", r.ok?"ok":"err");
  if(r.ok){
    _syncMarkClean();
    loadSyncConfig();
  }
}
function _syncMarkDirty(){
  // 用户改了表单里任意字段 -> 露出「有未保存改动」标记
  $("#syncDirty")?.classList.remove("hidden");
}
function _syncMarkClean(){
  $("#syncDirty")?.classList.add("hidden");
}
function _bindSyncDirty(){
  const u=$("#syncUrl"), s=$("#syncSecret");
  if(u && !u.dataset.syncDirtyBound){ u.addEventListener("input", _syncMarkDirty); u.dataset.syncDirtyBound="1"; }
  if(s && !s.dataset.syncDirtyBound){ s.addEventListener("input", _syncMarkDirty); s.dataset.syncDirtyBound="1"; }
}
async function regenSecret(){
  if(!await uiConfirm({kind:"warn", danger:false, title:"重新生成同步密钥",
      message:"确认重新生成同步密钥？生成后需同步到线上实例才能继续接收。", okText:"重新生成"})) return;
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,"0")).join("");
  if($("#syncSecret")) $("#syncSecret").value = secret;
  toast("已生成新密钥，记得点「保存配置」");
}
async function pushToOnline(){
  if(!await uiConfirm({kind:"warn", danger:false, title:"推送到线上",
      message:"确认把本地账号与模型配置推送到配置的线上地址？", okText:"推送"})) return;
  toast("正在推送...","ok");
  try{
    // 把当前输入框里未保存的最新值先带过去，避免漏点「保存配置」导致 DB 没数据
    const body = {
      remote_url: $("#syncUrl").value.trim(),
      secret: $("#syncSecret").value,
    };
    const r = await api("/api/sync/push",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const d = await r.json();
    if(!r.ok){ $("#syncStatus").innerHTML = `<span class="text-red-500">推送失败: ${esc(d.detail||"")}</span>`; toast("推送失败","err"); return; }
    const rr = d.remote_result || {};
    const acc = (rr.accounts||{}); const md = (rr.models||{});
    const cp = rr.client_profile;
    // 客户端参数的应用结果（线上是否成功钉住同步过去的 UA/版本号）
    let cpTxt = "";
    if(cp && typeof cp === "object"){
      cpTxt = cp.applied
        ? ` · 客户端参数 <span class="text-emerald-600">已同步 ${(cp.fields||[]).length} 项</span>`
        : `<span class="text-amber-600"> · 客户端参数未同步${cp.errors?.length?"（"+esc(cp.errors.join("；"))+"）":""}</span>`;
    } else if(d.client_profile === false){
      cpTxt = ` · <span class="text-amber-600">客户端参数为空</span>`;
    }
    $("#syncStatus").innerHTML = `<span class="text-emerald-600">推送成功</span> · 账号 +${acc.added||0}/~${acc.updated||0} · 模型 +${md.added||0}/~${md.updated||0}${cpTxt}`;
    toast("已推送到线上");
    // 推送成功后清理脏标记，并刷新显示（DB 现在已与当前值一致）
    _syncMarkClean();
    loadSyncConfig();
  }catch(e){ toast("推送异常: "+e.message,"err"); }
}

/* ==================== 客户端兼容参数（UA / 版本号 / 请求头） ====================
   这些值用于对齐客户端协议中可验证的版本与请求头格式。它们可以：
     1. 现场探测（本机装了 WorkBuddy 就能读到真实版本号/风控配置）
     2. 在后台手动改（改完立即生效，不必重启进程）
     3. 随「同步到线上」一起推给线上实例
   线上服务器没装客户端、探测不到东西，所以它必须用 saved 策略钉住同步过去的值。
*/
let _clientProfile = null;

// 输入框分组定义：键 -> [标签, 类型, 说明]
const _CP_FIELDS = [
  ["desktop_version", "桌面端版本", "text", "X-IDE-Version 与 UA 都用它"],
  ["cli_version",     "内嵌 CLI 版本", "text", "UA 第三段"],
  ["ide_name",        "IDE 名称", "text", "X-IDE-Name"],
  ["ide_type",        "IDE 类型", "text", "X-IDE-Type"],
  ["product",         "产品头(X-Product)", "text", "官方取部署形态 deploymentType（WorkBuddy 为 SaaS），不是产品名"],
  ["application_name", "UA 产品名", "text", "UA 前后两段（官方取 applicationName）"],
  ["turing_channel_id", "风控 channelId", "int", "天御 SDK 渠道号"],
  ["turing_product_name", "风控产品名", "text", "天御 SDK productName"],
  ["commit",          "commit", "text", "安装包提交号"],
  ["release_date_ms", "发布日期(ms)", "int", "安装包构建时间戳"],
  ["node_version",    "内嵌 Node 版本", "text", "X-Stainless-Runtime-Version（装了客户端会自动探测精确值）"],
  ["stainless_package_version", "SDK 版本", "text", "X-Stainless-Package-Version（官方内嵌 stainless SDK）"],
];
const _CP_FP_FIELDS = [
  ["fp_product",   "指纹 product", "text", "遥测里的产品形态（官方为 SaaS），与请求头 X-Product 不同"],
  ["ext_name",     "扩展名", "text", "extName"],
  ["os",           "操作系统", "text", "官方 Windows 端为 win32"],
  ["arch",         "架构", "text", "x64 / arm64"],
  ["os_version",   "系统版本", "text", "osVersion"],
  ["cpu_cores",    "CPU 核数", "int", ""],
  ["memory_size",  "内存(GB)", "int", ""],
  ["timezone",     "时区", "text", ""],
  ["report_delay", "上报延迟(ms)", "int", ""],
];

function _cpInput(id, label, type, hint, val, srcBadge){
  const it = type === "int" ? "number" : "text";
  return `<label class="block mb-2">
      <span class="block text-xs text-slate-500 mb-1">${esc(label)}${srcBadge||""}${hint?` <span class="text-slate-300">· ${esc(hint)}</span>`:""}</span>
      <input id="${id}" type="${it}" value="${val===undefined||val===null?"":esc(String(val))}"
             class="w-full border rounded-lg px-3 py-1.5 text-sm font-mono" />
    </label>`;
}

// 来源徽标：把「安装包实测 / 本机系统 / 已保存 / 环境变量 / 兜底默认」标成彩色小标签，
// 让一眼能分清哪些是官方客户端实测值、哪些仍是协议兼容参考值（不是实测）。
function _cpSourceBadge(s){
  const t = String(s||"");
  let label = "", cls = "";
  if(t.startsWith("环境变量")){ label = "环境变量"; cls = "text-amber-600 border-amber-300"; }
  else if(t.includes("安装包")){ label = "安装包实测"; cls = "text-emerald-600 border-emerald-300"; }
  else if(t.includes("本机系统")){ label = "本机系统"; cls = "text-emerald-600 border-emerald-300"; }
  else if(t === "已保存"){ label = "已保存"; cls = "text-sky-600 border-sky-300"; }
  else if(t === "内置兜底"){ label = "兜底默认"; cls = "text-slate-400 border-slate-300"; }
  else if(t){ label = "现场探测"; cls = "text-emerald-600 border-emerald-300"; }
  return label
    ? `<span class="inline-block align-middle ml-1 px-1.5 py-0.5 border rounded text-[10px] leading-none ${cls}" data-tooltip="来源：${esc(t)}">${label}</span>`
    : "";
}

/* ==========================================================================
   预警管理
   --------------------------------------------------------------------------
   哨兵负责「发现」，这里负责「叫醒人」。没有这一步，连坐封号只会在
   面板里静静躺着，等有人偶然打开控制台才被发现。

   配置存在数据库 + 同步覆盖环境变量（见 alerts_router.bootstrap），
   所以改完立刻生效、重启也不丢。
   ========================================================================== */
let _alertChannels = [];

/** 「清除」只打标记，真正清空在保存时发 `__clear__` —— 否则一进页面就清。 */
let _smtpCompactClear = false;
function alertsClearCompact() {
  _smtpCompactClear = true;
  const el = $("#smtpCompact");
  if (el) {
    el.value = "";
    el.placeholder = "保存后即清空已存授权码";
  }
}

/** 渠道类型下拉（站内组件版，只初始化一次）。 */
function initAlertTypeSelect() {
  if (_uiSelectMap.has("alertNewType")) return;
  const host = $("#alertNewTypeHost");
  if (!host) return;
  host.outerHTML = uiSelectHTML("alertNewType", {
    value: "feishu",
    options: [
      { value: "feishu", label: "飞书群机器人" },
      { value: "qqbot", label: "QQ 机器人" },
      { value: "email", label: "邮件（SMTP）" },
    ],
    // 切换类型要**看得见变化**：原来只是下拉换了字，输入框与说明都没动，
    // 用户不知道邮件该填什么、SMTP 在哪配。
    onChange: (value) => applyAlertChannelType(value, true),
  });
  applyAlertChannelType("feishu", false);
}

/** 按渠道类型切换目标输入框的占位/说明，并高亮对应配置区。 */
function applyAlertChannelType(type, scroll) {
  const input = $("#alertNewTarget");
  const hint = $("#alertTargetHint");
  const smtpCard = $("#smtpQuickCard");
  const isEmail = type === "email";
  if (input) {
    input.placeholder = isEmail ? "收件邮箱，例如 me@qq.com（多个用英文逗号分隔）"
      : (type === "qqbot" ? "Webhook 地址，末尾加 ?group=群号" : "Webhook 地址，例如 https://open.feishu.cn/open-apis/bot/v2/hook/…");
  }
  if (hint) {
    hint.innerHTML = isEmail
      ? `<b>邮件渠道需要两步</b>：① 这里填收件邮箱；② 下方「SMTP（邮件渠道）」填 <code>qqSMTP:授权码</code>（QQ 邮箱一条就够，服务器/端口自动推导）。`
      : (type === "qqbot"
          ? "填写 QQ 群机器人地址，并在末尾加 <code>?group=群号</code>。"
          : "填写飞书群「自定义机器人」的 Webhook 地址。");
  }
  if (smtpCard) smtpCard.classList.toggle("is-highlight", isEmail);
  if (isEmail && scroll && smtpCard) {
    try { smtpCard.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
  }
}

async function loadAlerts() {
  initAlertTypeSelect();
  try {
    const r = await api("/api/alerts/config");
    if (!r.ok) return;
    const d = await r.json();
    const cfg = d.config || {};
    _alertChannels = (cfg.channels || []).slice();

    $("#alertEnabled").checked = cfg.enabled !== false;
    $("#alertCooldown").value = cfg.cooldown || 600;
    $("#smtpHost").value = cfg.smtp_host || "";
    $("#smtpPort").value = cfg.smtp_port || 465;
    $("#smtpUser").value = cfg.smtp_user || "";
    $("#smtpPassword").value = "";
    $("#smtpPassword").placeholder = cfg.has_password ? "已设置（留空不修改）" : "未设置";
    $("#smtpFrom").value = cfg.smtp_from || "";
    $("#smtpStarttls").checked = cfg.smtp_starttls !== false;
    // 一条式 QQ 授权码：掩码串只当占位符，不回填内容（否则一保存就被覆盖成星号）
    const compact = $("#smtpCompact");
    if (compact) {
      compact.value = "";
      compact.placeholder = cfg.has_smtp
        ? "已设置 qqSMTP:（留空不修改，可重新粘贴覆盖）"
        : "qqSMTP:授权码  或  qqSMTP:你的邮箱@qq.com:授权码";
    }
    if ($("#smtpMailTo")) $("#smtpMailTo").value = cfg.mail_to || "";
    renderSmtpHealth(d.smtp);
    renderAlertChannels(d.labels || {});
  } catch (e) {
    toast("预警配置加载失败：" + e.message, "err");
  }
}

/** 邮件链路体检：缺哪一步直接写在输入框下面（QQ 授权码反查不到账号）。 */
function renderSmtpHealth(smtp) {
  const host = $("#smtpStatus");
  if (!host) return;
  if (!smtp) { host.textContent = ""; host.removeAttribute("data-state"); return; }
  if (smtp.ready) {
    host.dataset.state = "ok";
    host.innerHTML = `<span class="wb-icon"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span>`
      + `邮件链路就绪：${esc(smtp.from || smtp.user)} → ${esc(smtp.mail_to || "渠道收件人")}`
      + `（${esc(smtp.host)}:${smtp.port}${smtp.ssl ? " SSL" : ""}）`;
    return;
  }
  host.dataset.state = "warn";
  const missing = (smtp.missing || []).filter(Boolean);
  host.innerHTML = `<span class="wb-icon"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg></span>`
    + `还差：${missing.map(esc).join("、")}`
    + `　提示：QQ 邮箱填 <code>qqSMTP:授权码</code> 即可推出服务器与端口，`
    + `但授权码属于哪个邮箱无法反查，请把「收件邮箱」填上（同账号即自寄）。`;
}

function renderAlertChannels(labels) {  const host = $("#alertChannels");
  if (!host) return;
  if (!_alertChannels.length) {
    host.innerHTML = `<p class="sentinel-empty">还没有配置通知渠道。风控告警只会记录在面板里。</p>`;
    return;
  }
  host.innerHTML = _alertChannels.map((c, index) => `
    <div class="alert-channel-item">
      <span class="alert-channel-type">${esc(labels[c.type] || c.type)}</span>
      <span class="alert-channel-target" data-tooltip="${esc(c.target)}">${esc(c.target)}</span>
      <button type="button" class="console-btn quiet" onclick="alertsRemoveChannel(${index})">移除</button>
    </div>`).join("");
}

function alertsAddChannel() {
  const type = uiSelectValue("alertNewType") || "feishu";
  const target = ($("#alertNewTarget").value || "").trim();
  if (!target) { toast("请填写地址", "err"); return; }
  if (type !== "email" && !/^https?:\/\//i.test(target)) {
    toast("Webhook 地址需以 http(s):// 开头", "err");
    return;
  }
  // 同一渠道同一地址不重复加（否则测试时会连发两条）
  if (_alertChannels.some(c => c.type === type && c.target === target)) {
    toast("该渠道已存在");
    return;
  }
  _alertChannels.push({ type, target });
  $("#alertNewTarget").value = "";
  renderAlertChannels(_alertLabelMap());
}

function alertsRemoveChannel(index) {
  _alertChannels.splice(index, 1);
  renderAlertChannels(_alertLabelMap());
}

/** 已加载过的标签表；没加载到时退化成类型名。 */
function _alertLabelMap() {
  const map = {};
  const state = _uiSelectMap.get("alertNewType");
  (state && state.options ? state.options : []).forEach(o => {
    map[String(o.value)] = String(o.label);
  });
  return map;
}

async function alertsSave(btn) {
  if (btn) btn.disabled = true;
  try {
    const body = {
      enabled: $("#alertEnabled").checked,
      cooldown: Number($("#alertCooldown").value) || 600,
      channels: _alertChannels,
      smtp_host: $("#smtpHost").value.trim(),
      smtp_port: Number($("#smtpPort").value) || 465,
      smtp_user: $("#smtpUser").value.trim(),
      // 空串 = 不修改；掩码串不能当真密码写回
      smtp_password: $("#smtpPassword").value,
      smtp_from: $("#smtpFrom").value.trim(),
      smtp_starttls: $("#smtpStarttls").checked,
      // 一条式 QQ 授权码 + 默认收件邮箱
      smtp: _smtpCompactClear ? "__clear__" : ($("#smtpCompact")?.value || "").trim(),
      mail_to: ($("#smtpMailTo")?.value || "").trim(),
    };
    const r = await api("/api/alerts/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) { _smtpCompactClear = false; toast("预警配置已保存"); loadAlerts(); }
    else toast("保存失败", "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function alertsSendTest(btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api("/api/alerts/test", { method: "POST" });
    const d = await r.json().catch(() => ({}));
    const results = d.results || [];
    if (!results.length) {
      toast("没有配置任何渠道，先添加一个", "err");
      return;
    }
    // 逐路展示成败：只说「发送失败」没法定位是 SMTP 还是 webhook
    const lines = results.map(item => {
      const ok = item.ok ? "✓" : "✗";
      return `${ok} ${item.type} → ${item.target}${item.ok ? "" : "：" + (item.error || "")}`;
    });
    openModal(`<h3>测试发送结果</h3><pre class="alert-test-result">${esc(lines.join("\n"))}</pre>`, "max-w-2xl");
  } catch (e) {
    toast("测试失败：" + e.message, "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}

//: 客户端参数页当前的平台（落库名）
var _clientPlatform = "";

/** 平台清单缓存（`/api/platforms` 的 items） */
var _clientPlatformSpecs = null;

async function clientPlatformSpecs(force) {
  if (!force && Array.isArray(_clientPlatformSpecs)) return _clientPlatformSpecs;
  try {
    const r = await api("/api/platforms");
    const { ok, data } = await safeJson(r);
    if (ok && data && Array.isArray(data.items)) {
      _clientPlatformSpecs = data.items;
    }
  } catch (error) {
    // 拿不到就只显示当前平台
  }
  if (!_clientPlatformSpecs) {
    const one = (window.WBPlatform && window.WBPlatform.spec)
      ? window.WBPlatform.spec() : null;
    _clientPlatformSpecs = one ? [one] : [];
  }
  return _clientPlatformSpecs;
}

/** 当前选中的客户端参数平台。 */
function clientPlatform() {
  if (!_clientPlatform) {
    const spec = (window.WBPlatform && window.WBPlatform.spec)
      ? window.WBPlatform.spec() : null;
    _clientPlatform = (spec && spec.storage_platform) || "workbuddy";
  }
  return _clientPlatform;
}

/** 渲染平台切换 chip。 */
async function renderClientPlatformBar() {
  const host = document.querySelector("#clientPlatformBar");
  if (!host) return;
  const specs = await clientPlatformSpecs();
  const seen = new Set();
  const chips = [];
  for (const spec of specs) {
    const storage = String(spec.storage_platform || spec.id || "").toLowerCase();
    if (!storage || seen.has(storage)) continue;
    seen.add(storage);
    const on = storage === clientPlatform();
    chips.push(`<button type="button"
      class="console-btn ${on ? "primary" : "quiet"}"
      onclick="selectClientPlatform('${esc(storage)}')"
      aria-pressed="${on ? "true" : "false"}">${esc(spec.label || storage)}</button>`);
  }
  host.innerHTML = `<span class="text-xs" style="color:var(--fg-subtle)">平台</span>`
    + chips.join("");
}

/** 切到某个平台（WorkBuddy 走原 loadClientProfile，其它走探测）。 */
async function selectClientPlatform(storage) {
  _clientPlatform = String(storage || "").toLowerCase() || "workbuddy";
  await renderClientPlatformBar();
  await detectClient();
}

/**
 * 扫描位置卡片：各平台的目录 / 凭据 / 上游地址。
 *
 * 所有平台都显示这一块。没有数据时显示「—」，
 * 让用户知道「这块能力存在但本机没有」，而不是整块消失。
 */
function renderClientScanBody(data, storage) {
  const body = document.querySelector("#clientProbeBody");
  if (!body) return;
  const detected = (data && data.detected) || {};
  const dirs = (data && data.dirs) || detected.data_dirs || [];
  const items = detected.items || [];
  const pick = (obj, keys) => {
    for (const key of keys) {
      const value = obj && obj[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return "";
  };
  const dash = '<span style="color:var(--fg-subtle)">—</span>';

  const rows = items.map(it => {
    const where = pick(it, ["source", "data_dir", "dir", "path", "account_id"]);
    const who = pick(it, ["session", "uid_hint", "uid", "phone", "account_id"]);
    const flag = it.has_plain_credential ? "明文" : "加密";
    return `<li style="padding:3px 0">
      <span class="text-[10px]" style="color:var(--fg-subtle)">[${esc(flag)}]</span>
      <code>${esc(String(where))}</code>
      ${who ? `<span style="color:var(--fg-muted)"> ${esc(String(who))}</span>` : ""}
    </li>`;
  }).join("");

  // 状态描述要区分三种情况，不能一律「未检测到」：
  //   1. 有目录 + 有凭据  -> 已检测到，可导入
  //   2. 有目录 + 无凭据  -> 目录在，但这里不放凭据（WorkBuddy 的凭据在别处）
  //   3. 没有目录         -> 客户端没装
  let stateText;
  if (dirs.length && items.length) {
    stateText = `<b style="color:var(--success,#33587F)">已检测到客户端</b>`;
  } else if (dirs.length) {
    stateText = `<b style="color:var(--success,#33587F)">已找到客户端目录</b>`
      + `<span style="color:var(--fg-subtle)"> · 这些目录里没有凭据文件</span>`;
  } else if (data && data.has_client) {
    stateText = `<b style="color:var(--success,#33587F)">已探测到参数</b>`
      + `<span style="color:var(--fg-subtle)"> · 本机没有该客户端的数据目录</span>`;
  } else {
    stateText = `<span style="color:var(--fg-subtle)">未检测到客户端</span>`;
  }

  body.innerHTML = `
    <div class="mb-2">
      ${stateText}
      <span style="color:var(--fg-subtle)">（${dirs.length} 个扫描目录${items.length ? `，${items.length} 个凭据位置` : ""}）</span>
    </div>
    <div class="mb-2">
      <div style="color:var(--fg-subtle);margin-bottom:2px">扫描目录</div>
      ${dirs.length
        ? `<ul>${dirs.map(d => `<li><code>${esc(String(d))}</code></li>`).join("")}</ul>`
        : `<div>${dash}</div>`}
    </div>
    <div class="mb-2">
      <div style="color:var(--fg-subtle);margin-bottom:2px">凭据位置</div>
      ${rows || `<div>${dash}</div>`}
    </div>
    ${detected.base_url
      ? `<div style="color:var(--fg-subtle)">上游地址：<code>${esc(String(detected.base_url))}</code></div>`
      : ""}
    ${detected.hint
      ? `<div class="mt-2" style="color:var(--fg-subtle)">${esc(detected.hint)}</div>`
      : ""}
    ${(data && data.errors || []).length
      ? `<div class="mt-2" style="color:var(--danger)">${esc((data.errors || []).join("；"))}</div>`
      : ""}`;
}

/**
 * 非 WorkBuddy 平台：用**与原版相同的「标签 + 值」骨架**填字段。
 *
 * 要求：「布局板块一样，哪怕确实没有数据探测不出来」。
 * 所以这里的 DOM 结构与 `_cpInput` 渲染的一致（同样的小标签 + 只读框），
 * 只是值来自探测结果，缺失显示「—」。
 */
function renderClientPlatformFields(data, storage) {
  const detected = (data && data.detected) || {};
  const dash = "";

  // ① 提示条（与 WorkBuddy 同结构：策略 / 客户端 / 字段数）
  const hint = document.querySelector("#clientHint");
  if (hint) {
    const has = Boolean(data && data.has_client);
    const dirs = (data && data.dirs) || detected.data_dirs || [];
    hint.innerHTML = `
      <div class="flex flex-wrap gap-x-6 gap-y-1">
        <span>平台：<b>${esc(storage)}</b></span>
        <span>本机客户端：${has
          ? '<b class="text-emerald-600">已探测到</b>'
          : '<b class="text-slate-400">未探测到</b>'}</span>
        <span>扫描目录：<b>${dirs.length}</b></span>
        <span>探测字段：<b>${Object.keys(detected).length}</b></span>
      </div>
      <div class="mt-2 text-slate-400">该平台的参数由客户端自身管理，
        这里只做只读探测；没有的字段显示「—」。</div>`;
  }

  // ② 运行时诊断：有就显示，没有给说明
  renderClientRuntimeDiagnostics((data && data.runtime_diagnostics) || null);

  // ③ UA：与原版同一个框，没值显示「—」
  const ua = document.querySelector("#clientUa");
  if (ua) {
    const value = (data && data.ua) || detected.ua || detected.user_agent || "";
    ua.textContent = value || "—";
  }

  // ④ 版本与归属 / 桌面指纹 / 风控头：同一套 label+value 骨架
  const fieldRow = (label, value, hintText) => `
    <div style="margin-bottom:10px">
      <div class="text-xs" style="color:var(--fg-subtle);margin-bottom:3px">
        ${esc(label)}${hintText ? ` <span style="opacity:.6">· ${esc(hintText)}</span>` : ""}
      </div>
      <div class="cp-input text-xs" style="border:1px solid var(--line);
           border-radius:8px;padding:6px 10px;font-family:ui-monospace,monospace">
        ${value === "" || value === undefined || value === null
          ? '<span style="color:var(--fg-subtle)">—</span>'
          : esc(String(value)).slice(0, 200)}
      </div>
    </div>`;

  const versionKeys = ["platform", "version", "desktop_version", "cli_version",
                       "os", "arch", "os_version", "machine_id", "app_status",
                       "live_user_data_dir"];
  const fields = document.querySelector("#clientFields");
  if (fields) {
    fields.innerHTML = versionKeys.map(key =>
      fieldRow(key, detected[key] !== undefined ? detected[key] : "")).join("");
  }

  const fpKeys = ["storage", "desktop_installed", "model_count", "realm",
                  "can_import", "config_root", "accounts_found"];
  const fp = document.querySelector("#clientFpFields");
  if (fp) {
    fp.innerHTML = fpKeys.map(key =>
      fieldRow(key, detected[key] !== undefined ? detected[key] : "")).join("");
  }

  const headers = document.querySelector("#clientHeaders");
  if (headers) {
    const extra = detected.headers || detected.request_headers || null;
    headers.innerHTML = extra
      ? fieldRow("headers", JSON.stringify(extra))
      : fieldRow("headers", "");
  }

  const sources = document.querySelector("#clientSources");
  if (sources) {
    const origins = (data && data.detected_origins) || {};
    const entries = Object.entries(origins);
    sources.innerHTML = entries.length
      ? entries.map(([key, value]) =>
          `<div>${esc(key)} ← ${esc(String(value))}</div>`).join("")
      : '<span style="color:var(--fg-subtle)">—</span>';
  }

  const status = document.querySelector("#clientStatus");
  if (status) {
    status.textContent = "该平台没有可写入的客户端参数（只读探测）";
  }
}

async function loadClientProfile(){
  const r = await api("/api/client-profile");
  if(!r.ok){
    // 404 = 运行中的后端还是旧代码（新增接口需重启服务）。
    // 静态页是即改即生效的，所以很容易出现「页面有新面板、接口还没有」的组合，
    // 这里明确提示，否则用户只会看到一个空白面板。
    if($("#clientHint")) $("#clientHint").innerHTML = r.status === 404
      ? `<span class="text-amber-600"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>后端尚未加载客户端参数接口（HTTP 404）。请重启服务后刷新本页。</span>`
      : `<span class="text-red-500">加载失败（HTTP ${r.status}）</span>`;
    return;
  }
  const d = await r.json(); _clientProfile = d;
  const eff = d.effective || {}, sav = d.saved || {}, det = d.detected || {};
  const src = d.sources || {};

  renderClientRuntimeDiagnostics(d.runtime_diagnostics);

  // 生效中的 UA
  if($("#clientUa")) $("#clientUa").textContent = eff.user_agent || "（未知）";

  // 提示条：说明当前策略与「本机是否装了客户端」
  const hasClient = !!d.has_client;
  const mode = d.source === "saved" ? "钉住已保存值" : "优先现场探测";
  if($("#clientHint")) $("#clientHint").innerHTML = `
    <div class="flex flex-wrap gap-x-6 gap-y-1">
      <span>取值策略：<b class="${d.source==="saved"?"text-amber-600":"text-emerald-600"}">${esc(mode)}</b></span>
      <span>本机客户端：${hasClient
        ? `<b class="text-emerald-600">已探测到</b>（${Object.keys(det).length} 项）`
        : `<b class="text-slate-400">未探测到</b>`}</span>
      <span>已保存字段：<b>${Object.keys(sav).length}</b></span>
    </div>
    <div class="mt-2 text-slate-400">${
      hasClient
        ? "本机装了客户端：版本号/风控配置从安装包读取，OS/硬件/时区按本机系统实测（与官方客户端取值公式一致）；改动版本后无需重启进程即刻生效。"
        : "本机未探测到客户端（线上服务器属正常）。线上实例请用「钉住已保存值」，否则会退化成内置兜底版本号。"
    }</div>
    ${d.source!=="saved" && !hasClient
      ? `<div class="mt-1 text-amber-600"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>建议切换到「钉住已保存值」，否则本机探测不到时会用兜底值。</div>`
      : ""}`;

  // 字段：显示生效值；标签旁的彩色徽标标出来源（悬停可见完整来源说明）
  const render = (defs, mount) => {
    const el = $(mount); if(!el) return;
    el.innerHTML = defs.map(([k,label,type,hint]) => {
      const v = eff[k] !== undefined ? eff[k] : "";
      const s = src[k] || "";
      return `<div data-tooltip="来源：${esc(s)}">${_cpInput("cp_"+k, label, type,
        hint || "", v, _cpSourceBadge(s))}</div>`;
    }).join("");
  };
  render(_CP_FIELDS, "#clientFields");
  render(_CP_FP_FIELDS, "#clientFpFields");

  // 可选客户端头：档案与保存值合并后的结果，仅用于查看/明确支持的业务
  const hs = eff.headers || {};
  const hEl = $("#clientHeaders");
  if(hEl){
    hEl.innerHTML = Object.keys(hs).sort().map((k,i) => `
      <div class="flex gap-2 mb-2 items-center cp-hrow">
        <input class="cp-hk w-1/3 border rounded-lg px-2 py-1 text-xs font-mono" value="${esc(k)}" />
        <input class="cp-hv flex-1 border rounded-lg px-2 py-1 text-xs font-mono" value="${esc(String(hs[k]))}" />
        <button onclick="this.parentNode.remove()" class="px-2 py-1 rounded border text-xs text-red-500" data-tooltip="删除"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span></button>
      </div>`).join("") +
      `<button onclick="_cpAddHeader()" class="text-xs px-2 py-1 rounded border hover:bg-slate-50 mt-1"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg></span>添加请求头</button>`;
  }

  // 来源表（排障）：按来源类别着色
  const sEl = $("#clientSources");
  if(sEl){
    const srcCls = v => String(v).startsWith("环境变量") ? "text-amber-600"
      : String(v) === "内置兜底" ? "text-slate-400"
      : String(v) === "已保存" ? "text-sky-600"
      : (String(v).includes("安装包") || String(v).includes("本机系统")) ? "text-emerald-600"
      : "text-slate-600";
    sEl.innerHTML = Object.keys(src).sort()
      .map(k => `<div><span class="text-slate-400">${esc(k)}</span> <span class="${srcCls(src[k])}">${esc(src[k])}</span></div>`)
      .join("");
  }

  // ---- 平台切换 + 扫描位置（新增，不动上面的渲染）----
  renderClientPlatformBar();
  renderClientScanBody(d, "workbuddy");
}

function renderClientRuntimeDiagnostics(diag){
  const el = $("#clientRuntimeDiagnostics");
  if(!el) return;
  const d = diag || {};
  const tok = d.device_token || {};
  const tokenOk = tok.available === true;
  const tokenClass = tokenOk ? "text-emerald-600" : "text-amber-600";
  const tokenText = tokenOk ? "原生 SDK 令牌可用（本机实测）" :
    (!tok.checked ? "尚无 SDK 令牌缓存" :
      (tok.cached_failure ? "原生 SDK 暂不可用（已有失败缓存）" : "原生 SDK 令牌不可用"));
  const boolText = v => v ? "可用" : "不可用";
  const groups = d.header_groups || {};
  // 每组头的来源：档案值标明探测/保存来源；账号会话头来自当前凭据。
  const groupOrigin = {
    client_profile: "档案值（探测/保存/兜底，见上方字段徽标）",
    sdk_stainless: "SDK 资料（仅在明确使用该 SDK 的业务中适用）",
    account_session: "账号凭据/会话字段",
    request_trace: "调用方明确提供的关联字段",
  };
  const groupHtml = Object.keys(groups).sort().map(name => {
    const headers = Array.isArray(groups[name]) ? groups[name] : [];
    return `<div class="mb-1"><span class="text-slate-400">${esc(name)}</span>`+
      (groupOrigin[name]?` <span class="text-[10px] text-slate-400">〔${esc(groupOrigin[name])}〕</span>`:"")+
      `· <span class="font-mono">${esc(headers.join(", "))}</span></div>`;
  }).join("");
  el.innerHTML = `<div class="flex flex-wrap gap-x-6 gap-y-1 mb-2">`+
    `<span>运行平台：<b class="font-mono">${esc(d.platform || "—")}</b></span>`+
    `<span>设备令牌：<b class="${tokenClass}">${esc(tokenText)}</b></span>`+
    `<span>Node：<b>${esc(boolText(tok.node_available))}</b></span>`+
    `<span>Native helper：<b>${esc(boolText(tok.helper_available))}</b></span>`+
    `</div>`+
    `<div class="text-slate-400 mb-1">请求头字段组（部分字段按请求上下文动态生成）：</div>`+
    `<div class="font-mono break-all">${groupHtml || "—"}</div>`+
    `<div class="mt-2 text-slate-400">服务器没有官方原生 SDK 时会明确显示不可用；不要手工填写或伪造设备令牌。客户端参数区的值只用于对齐协议中可验证的版本与请求头；账号身份、会话令牌和链路头由请求运行时生成，不代表官方客户端的实测值。</div>`;
}

function _cpAddHeader(){
  const el = $("#clientHeaders"); if(!el) return;
  const row = document.createElement("div");
  row.className = "flex gap-2 mb-2 items-center cp-hrow";
  row.innerHTML = `<input class="cp-hk w-1/3 border rounded-lg px-2 py-1 text-xs font-mono" placeholder="Header-Name" />
    <input class="cp-hv flex-1 border rounded-lg px-2 py-1 text-xs font-mono" placeholder="值" />
    <button onclick="this.parentNode.remove()" class="px-2 py-1 rounded border text-xs text-red-500"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span></button>`;
  el.insertBefore(row, el.lastElementChild);
  row.querySelector(".cp-hk").focus();
}

function _cpCollect(){
  const p = {};
  _CP_FIELDS.concat(_CP_FP_FIELDS).forEach(([k,,type]) => {
    const el = $("#cp_"+k); if(!el) return;
    const raw = (el.value||"").trim();
    if(raw === "") return;                 // 留空 = 不改这一项
    p[k] = type === "int" ? (parseInt(raw,10) || 0) : raw;
  });
  const hs = {};
  document.querySelectorAll("#clientHeaders .cp-hrow").forEach(row => {
    const k = row.querySelector(".cp-hk").value.trim();
    const v = row.querySelector(".cp-hv").value.trim();
    if(k) hs[k] = v;
  });
  if(Object.keys(hs).length) p.headers = hs;
  return p;
}

async function saveClientProfile(){
  const profile = _cpCollect();
  if(!Object.keys(profile).length){ toast("没有要保存的改动","err"); return; }
  const r = await api("/api/client-profile",{method:"PUT",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({profile, merge:true})});
  const d = await r.json().catch(()=>({}));
  if(!r.ok){ toast("保存失败: "+(d.detail||""),"err"); return; }
  toast("已保存，新值立即生效");
  if(d.errors?.length) console.warn("客户端参数提示:", d.errors);
  loadClientProfile();
}

async function resetClientProfile(){
  if(!await uiConfirm({kind:"warn", danger:true, title:"重置客户端参数",
      message:"清空后台保存的值，回到「优先现场探测 + 内置兜底」。确认重置？", okText:"重置"})) return;
  const r = await api("/api/client-profile/reset",{method:"POST"});
  if(r.ok){ toast("已重置"); loadClientProfile(); } else toast("重置失败","err");
}

// ===== 客户端参数：平台切换 + 全平台探测 =====
//
// 各平台的「客户端参数」完全不是一回事：
//   WorkBuddy  UA / 版本号 / 风控头 / 桌面指纹（要伪装成官方桌面端）
//   Trae       客户端数据目录 + 登录态
//   Qoder      auth.v1.dat（加密）+ 数据目录
//   Loomy      auth-session.json（明文）+ 运行配置
//
// 所以不能塞进同一个表单 —— WorkBuddy 那套保留，其它平台展示
// 「探测结果」（目录 / 账号 / 提示），而不是伪造成同类参数。

async function initClientPanel() {
  await renderClientPlatformBar();
  // 统一布局：所有平台都走 detectClient（内部按 storage 选接口）
  await detectClient();
}


/** 探测当前平台的客户端（不保存）。 */
/**
 * 把某平台的探测结果渲染成 HTML。
 *
 * 各平台字段差异很大，用 pick() 兼容：
 *   Loomy  config_root / items[].source / session / phone / base_url
 *   Qoder  data_dirs / cli_dirs / accounts_found / catalogs
 *   Trae   storage / desktop_installed / model_count
 */
function clientProbeHtml(data) {
  const detected = (data && data.detected) || {};
  const dirs = (data && data.dirs) || detected.data_dirs || [];
  const items = detected.items || [];
  const pick = (obj, keys) => {
    for (const key of keys) {
      const value = obj && obj[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return "";
  };

  const rows = items.map(it => {
    const where = pick(it, ["source", "data_dir", "dir", "path", "account_id"]);
    const who = pick(it, ["session", "uid_hint", "uid", "phone", "account_id"]);
    const flag = it.has_plain_credential ? "明文" : "加密";
    return `<li style="padding:3px 0">
      <span class="text-[10px]" style="color:var(--fg-subtle)">[${esc(flag)}]</span>
      <code>${esc(String(where))}</code>
      ${who ? `<span style="color:var(--fg-muted)"> ${esc(String(who))}</span>` : ""}
    </li>`;
  }).join("");

  return `
    <p class="mb-2">
      ${data.has_client
        ? '<span style="color:var(--success,#33587F)">已检测到客户端</span>'
        : '<span style="color:var(--fg-muted)">未检测到客户端</span>'}
      <span class="text-[11px]" style="color:var(--fg-subtle)">（${dirs.length} 个扫描目录${items.length ? `，${items.length} 个凭据位置` : ""}）</span>
    </p>
    ${dirs.length ? `<div class="mb-2">
      <span class="text-[11px]" style="color:var(--fg-subtle)">扫描目录</span>
      <ul style="max-height:160px;overflow:auto">${dirs.map(d => `<li><code>${esc(String(d))}</code></li>`).join("")}</ul>
    </div>` : `<p class="text-[11px]" style="color:var(--fg-subtle)">扫描目录：—</p>`}
    ${rows ? `<div>
      <span class="text-[11px]" style="color:var(--fg-subtle)">凭据位置</span>
      <ul style="max-height:200px;overflow:auto">${rows}</ul>
    </div>` : `<p class="text-[11px]" style="color:var(--fg-subtle)">凭据位置：—</p>`}
    ${detected.hint ? `<p class="mt-2 text-[11px]" style="color:var(--fg-subtle)">${esc(detected.hint)}</p>` : ""}
    ${(data.errors || []).length ? `<p class="mt-2" style="color:var(--danger)">${esc((data.errors || []).join("；"))}</p>` : ""}`;
}

/**
 * 按平台填充「统一布局」的各个板块。
 *
 * 所有平台共用同一套 DOM（状态 / 运行时诊断 / UA / 版本与归属 /
 * 桌面指纹 / 风控头 / 取值来源 / 扫描位置）。
 * **没有数据的字段显示「—」而不是隐藏整块** ——
 * 隐藏会让切平台时布局跳变，用户也看不出「这个平台缺什么」。
 */

// ===== 平台网关：调度可视化 =====
//
// 拓扑：Key -> 网关 -> 各平台
// 粒子飞向谁，由 `/api/gateway/order` 的真实顺序决定 —— 不是假动画。
var _gwTopology = null;
var _gwTrafficTimer = null;

/** 初始化（或重建）拓扑。 */
// ===== 风控哨兵：实时流量可视化 =====
var _wbtSentinelTopology = null;
var _wbtSentinelTimer = null;
var _wbtSentinelSeen = new Set();
//: 增量游标：只对「这个时间点之后」的请求发射粒子
var _wbtSentinelBaseline = 0;

/** 初始化哨兵拓扑（请求 -> 哨兵 -> 各平台）。 */
async function sentinelInitTraffic(force) {
  const host = document.querySelector("#sentinelTraffic");
  if (!host || !window.WBTraffic) return;
  if (_wbtSentinelTopology && !force) {
    _wbtSentinelTopology.redraw();
    return;
  }
  if (_wbtSentinelTopology) _wbtSentinelTopology.destroy();

  const platforms = await gwTrafficPlatforms();
  const nodes = [
    { id: "req", label: "客户端请求", sub: "最近 1 小时", side: "left" },
    { id: "sentry", label: "风控哨兵", sub: "检测中", side: "center" },
  ];
  platforms.forEach(item => {
    const parts = splitPlatformLabel(item.label || item.platform);
    nodes.push({
      id: "s-" + item.platform,
      label: parts.name || item.platform,
      sub: item.disabled ? "已禁用"
        : [parts.region, item.accounts + " 个账号"].filter(Boolean).join(" · "),
      side: "right",
    });
  });
  const links = [{ from: "req", to: "sentry", kind: "main" }];
  platforms.forEach(item => {
    links.push({ from: "sentry", to: "s-" + item.platform, kind: "branch" });
  });

  _wbtSentinelTopology = new window.WBTraffic.Topology(host, { nodes, links });
  // 哨兵拓扑的两个虚拟节点也要有图标：
  //   req    —— 客户端请求（终端窗口）
  //   sentry —— 风控哨兵（雷达扫描，和侧栏图标同一意象）
  // 之前这两个节点只有文字，左边空一块，看起来像图标丢了。
  _wbtSentinelTopology.setNodeIcon("req",
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<rect x="2.5" y="4" width="19" height="13" rx="2.2"/>'
    + '<path d="M8.5 20.5h7"/><path d="M12 17.5v3"/></svg>');
  _wbtSentinelTopology.setNodeIcon("sentry",
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M12 3a9 9 0 1 0 9 9"/>'
    + '<path d="M12 7.5A4.5 4.5 0 1 0 16.5 12"/>'
    + '<path d="M12 12l6.4-6.4"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>'
    + '</svg>');
  fillTrafficNodeIcons(_wbtSentinelTopology, "s-");
  await sentinelPollLogs();
  if (_wbtSentinelTimer) clearInterval(_wbtSentinelTimer);
  _wbtSentinelTimer = setInterval(sentinelPollLogs, 2000);
}

/** 标题里的平台标识（复用于粒子归因）。 */
function sentinelPlatformLabel(platform) {
  const node = _wbtSentinelTopology && _wbtSentinelTopology.node("s-" + platform);
  if (!node) return platform;
  return (node.querySelector(".wbt-node-label") || {}).textContent || platform;
}

function sentinelToneOf(item) {
  const status = Number(item.status || 0);
  // **先看 HTTP 状态**：2xx/3xx 一定是成功的。
  //
  // 之前只看 `outcome` 白名单 `("completed","ok")`，而流式请求正常结束
  // 时会记成 `interrupted`（客户端断开/流式收尾），于是 200 被染成红色。
  // 状态码是最硬的证据，它说成功就是成功。
  if (status >= 500) return "danger";
  if (status >= 400) return "warn";
  if (status >= 200 && status < 400) {
    // 2xx 但要能看出「真的失败」的情况：超时且无状态码
    if (item.outcome === "timeout" && !status) return "danger";
    return "ok";
  }
  // 没有状态码（连接层失败）：才轮到 outcome / error 说话
  if (item.outcome === "timeout") return "danger";
  const kind = String(item.error || "").trim().toLowerCase();
  if (kind && kind !== "success" && kind !== "ok" && kind !== "none" && kind !== "0") return "danger";
  // 无状态码但 outcome 明确成功
  if (!status && !kind) return "ok";
  return "warn";
}

function sentinelToneColor(tone) {
  return tone === "ok" ? "#3E6A99" : tone === "warn" ? "#f59e0b" : "#ef4444";
}

function sentinelClock(ts) {
  if (!ts) return "—";
  const date = new Date(Number(ts) * 1000);
  return String(date.getHours()).padStart(2, "0") + ":" +
    String(date.getMinutes()).padStart(2, "0") + ":" +
    String(date.getSeconds()).padStart(2, "0");
}

/**
 * 今日概况 KPI：4 个格子，跟着同一个轮询渲染。
 *
 * 为什么不做成图表：左栏已经有拓扑动画，再加曲线会抢注意力；
 * 这里要回答的是「今天到底稳不稳」——请求量、成功率、失败数、覆盖平台。
 */
function renderSentinelKpi(data) {
  const host = document.querySelector("#sentinelKpi");
  if (!host) return;
  const rows = (data && data.platforms) || [];
  const totals = (data && data.totals) || {};
  const requests = Number(totals.requests || 0);
  const ok = Number(totals.ok || 0);
  const failed = Number(totals.error || 0) + Number(totals.timeout || 0);
  const active = rows.filter(row => Number(row.requests || 0) > 0).length;
  const totalPlatforms = rows.length;
  const rate = requests ? (ok / requests * 100) : 100;
  // 失败最多的平台：出现批次级问题时，第一眼就知道先看谁
  const worst = rows
    .map(row => ({
      label: row.label || row.platform,
      bad: Number(row.error || 0) + Number(row.timeout || 0),
      total: Number(row.requests || 0),
    }))
    .filter(item => item.bad > 0)
    .sort((a, b) => b.bad - a.bad)[0];
  const tone = rate >= 98 ? "ok" : rate >= 90 ? "warn" : "danger";
  const cells = [
    { label: "今日请求", value: fmtNum(requests), sub: `${active}/${totalPlatforms} 个平台有流量` },
    { label: "成功率", value: rate.toFixed(1) + "%", sub: `成功 ${fmtNum(ok)} 次`, tone },
    { label: "失败 / 超时", value: fmtNum(failed), sub: worst ? `最多：${worst.label} ${worst.bad} 次` : "暂无失败", tone: failed ? "danger" : "ok" },
    { label: "当前存储", value: data && data.storage === "redis" ? "Redis" : "内存", sub: "跨进程共享" },
  ];
  host.innerHTML = cells.map(cell => `
    <div class="sentinel-kpi-cell${cell.tone ? " tone-" + cell.tone : ""}">
      <span class="sentinel-kpi-label">${esc(cell.label)}</span>
      <b class="sentinel-kpi-value">${esc(cell.value)}</b>
      <span class="sentinel-kpi-sub">${esc(cell.sub)}</span>
    </div>`).join("");
  const hint = document.querySelector("#sentinelKpiHint");
  if (hint) {
    hint.textContent = `今日累计 · ${data && data.storage === "redis" ? "Redis" : "内存"} · 每 2 秒刷新`;
  }
}

/**
 * 平台健康条：每个平台一行「名称 + 成功率条 + 请求/失败」。
 *
 * 用条而不是数字，是因为「90% 和 60% 差多少」看图比看数字快；
 * 颜色跟 KPI 一致：>=98% 绿、>=90% 黄、其余红。
 */
function renderSentinelBars(data) {
  const host = document.querySelector("#sentinelPlatformBars");
  if (!host) return;
  const rows = ((data && data.platforms) || [])
    .filter(row => Number(row.requests || 0) > 0)
    .sort((a, b) => Number(b.requests || 0) - Number(a.requests || 0));
  if (!rows.length) {
    host.innerHTML = '<p class="sentinel-empty" style="padding:6px 2px">今天还没有请求。</p>';
    return;
  }
  // 绿红**共用一条**：绿色=成功占比、红色=失败/超时占比，长度按真实比例分配。
  // 之前只画一根单色条（按成功率上色），于是要么全绿要么全红，
  // 看不出「100 次里挂了 40 次」这种信息。
  host.innerHTML = rows.map(row => {
    const requests = Number(row.requests || 0);
    const ok = Number(row.ok || 0);
    const failed = Math.max(0, requests - ok);
    const okPct = requests ? (ok / requests * 100) : 0;
    const badPct = 100 - okPct;
    const rate = okPct;
    const tone = rate >= 98 ? "ok" : rate >= 90 ? "warn" : "danger";
    return `<div class="sentinel-bar-row" data-tooltip="${esc(row.label || row.platform)} · 成功 ${ok} / 失败 ${failed}">
      <span class="sentinel-bar-name">${esc((row.label || row.platform).replace(/\s*(国内版|国际版)/, ""))}</span>
      <span class="sentinel-bar-track">
        <i class="bar-ok" style="width:${okPct.toFixed(2)}%"></i>
        <i class="bar-bad" style="width:${badPct.toFixed(2)}%"></i>
      </span>
      <span class="sentinel-bar-value tone-${tone}">${rate.toFixed(1)}%</span>
      <span class="sentinel-bar-sub">${fmtNum(requests)} 次${failed ? ` · ${failed} 失败` : ""}</span>
    </div>`;
  }).join("");
}

function renderSentinelTraffic(data) {
  renderSentinelKpi(data);
  renderSentinelBars(data);
  const counts = document.querySelector("#sentinelTrafficCounts");
  const recent = document.querySelector("#sentinelRecentResults");
  const storage = document.querySelector("#sentinelTrafficStorage");
  const rows = (data && data.platforms) || [];
  if (storage) {
    storage.textContent = "今日累计 · " + (data.storage === "redis" ? "Redis" : "内存") +
      " · 每 2 秒刷新";
  }
  if (counts) {
    counts.innerHTML = rows.map(row => {
      const total = Number(row.requests || 0);
      const failed = Number(row.error || 0) + Number(row.timeout || 0);
      return `<div class="live-platform-count" data-tooltip="${esc(row.label || row.platform)} · 今日请求">
        <span>${esc((row.label || row.platform).replace(/\s*国内版|\s*国际版/, ""))}</span>
        <span><b>${total}</b>${failed ? ` <em>${failed} 失败</em>` : ""}</span>
      </div>`;
    }).join("") || '<p class="sentinel-empty" style="padding:8px 2px">暂无请求</p>';
  }
  if (recent) {
    const items = ((data && data.recent) || []).slice(0, 40);
    recent.innerHTML = items.length ? items.map(item => {
      const tone = sentinelToneOf(item);
      const status = Number(item.status || 0);
      // running：请求**正在进行**（开始时就落一条，结束时被正式记录覆盖）。
      // 之前面板只在请求结束后才有数据，跑 30 秒的任务前 28 秒什么都看不到。
      const label = item.outcome === "running" ? "进行中"
        : item.outcome === "timeout" ? "超时"
        : status ? String(status) : (item.outcome || "—");
      const runningCls = item.outcome === "running" ? " live-request-running" : "";
      return `<div class="live-request-row${runningCls}">
        <span class="live-request-time">${sentinelClock(item.ts)}</span>
        <span class="live-request-model" data-tooltip="${esc(item.error || item.path || "")}">${esc(item.model || item.path || "—")}</span>
        <span class="live-request-platform">${esc(item.platform || "—")}</span>
        <span class="live-request-status ${tone}">${esc(label)}</span>
      </div>`;
    }).join("") : '<p class="sentinel-empty" style="padding:8px 2px">最近没有请求。</p>';
  }
}

/** 实时流量：轮询「每个平台今日累计 + 最近请求」，含超时 / 503 / 报错。 */
async function sentinelPollLogs() {
  if (!_wbtSentinelTopology) return;
  const hint = document.querySelector("#sentinelTrafficHint");
  let data = null;
  try {
    const r = await api("/api/sentinel/traffic?window=3600");
    const { ok, data: payload } = await safeJson(r);
    if (!ok) return;
    data = payload;
  } catch (error) {
    return;
  }
  renderSentinelTraffic(data);
  const items = (data && data.recent) || [];
  if (!_wbtSentinelBaseline) {
    // 首次：只建基线，不重放历史（否则一进页面就喷几百个粒子）
    _wbtSentinelBaseline = Math.max(0, ...items.map(it => Number(it.ts) || 0));
    if (hint) hint.textContent = items.length
      ? `实时监听中（今日 ${data.totals ? data.totals.requests : 0} 个请求）`
      : "等待第一个请求…";
    return;
  }
  const fresh = items.filter(item => {
    const ts = Number(item.ts) || 0;
    if (ts <= _wbtSentinelBaseline) return false;
    const key = ts + "|" + (item.platform || "") + "|" + (item.path || "");
    if (_wbtSentinelSeen.has(key)) return false;
    _wbtSentinelSeen.add(key);
    return true;
  }).sort((a, b) => Number(a.ts) - Number(b.ts)).slice(-6);
  if (!fresh.length) return;
  _wbtSentinelBaseline = Math.max(_wbtSentinelBaseline,
    ...fresh.map(item => Number(item.ts) || 0));
  if (_wbtSentinelSeen.size > 800) {
    _wbtSentinelSeen = new Set([..._wbtSentinelSeen].slice(-300));
  }
  if (hint) hint.textContent = `刚收到 ${fresh.length} 个新请求`;
  fresh.forEach((item, index) => {
    const tone = sentinelToneOf(item);
    const color = sentinelToneColor(tone);
    const platform = String(item.platform || "").toLowerCase();
    setTimeout(() => {
      _wbtSentinelTopology.fire("req", "sentry", { duration: 420, color: color, tone: tone });
      setTimeout(() => {
        const nodeId = "s-" + platform;
        if (_wbtSentinelTopology.node(nodeId)) {
          _wbtSentinelTopology.fire("sentry", nodeId, { duration: 520, color: color, tone: tone });
          _wbtSentinelTopology.pulse(nodeId, tone === "ok" ? "" : "danger");
        } else {
          _wbtSentinelTopology.pulse("sentry", tone === "ok" ? "" : "danger");
        }
      }, 400);
    }, index * 200);
  });
}

/** 停止轮询（离开面板时调）。 */
function sentinelStopTraffic() {
  if (_wbtSentinelTimer) {
    clearInterval(_wbtSentinelTimer);
    _wbtSentinelTimer = null;
  }
}

async function gwInitTraffic(force) {
  const host = document.querySelector("#gwTraffic");
  if (!host || !window.WBTraffic) return;
  if (_gwTopology && !force) {
    _gwTopology.redraw();
    return;
  }
  if (_gwTopology) _gwTopology.destroy();

  const platforms = await gwTrafficPlatforms();
  const nodes = [
    { id: "key", label: "API Key", sub: "调用方", side: "left" },
    { id: "gateway", label: "平台网关", sub: "鉴权 · 路由", side: "center" },
  ];
  platforms.forEach(item => {
    const parts = splitPlatformLabel(item.label || item.platform);
    nodes.push({
      id: "p-" + item.platform,
      label: parts.name || item.platform,
      sub: item.disabled ? "已禁用"
        : [parts.region, item.accounts + " 个账号"].filter(Boolean).join(" · "),
      side: "right",
      tone: item.disabled ? "muted" : "",
    });
  });

  const links = [
    { from: "key", to: "gateway", kind: "main" },
  ];
  platforms.forEach(item => {
    links.push({ from: "gateway", to: "p-" + item.platform, kind: "branch" });
  });

  _gwTopology = new window.WBTraffic.Topology(host, { nodes, links });
  // 填平台 logo（platform-icons.js 提供的 SVG）
  gwFillNodeIcons();
  // 首帧后再高亮，确保路径已画
  setTimeout(() => gwHighlightFirst(), 260);
}

/**
 * 给拓扑节点填图标。
 *
 * 平台 logo 用 `platform-icons.js` 的 `WBPlatformIcons.get(id)`；
 * key / gateway 这两个虚拟节点用内联 SVG。
 */
function gwFillNodeIcons() {
  if (!_gwTopology) return;
  const icons = window.WBPlatformIcons;
  // 虚拟节点
  const keySvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/>'
    + '<path d="M17 6l3 3"/><path d="M14 9l3 3"/></svg>';
  const gateSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/>'
    + '<rect x="14" y="3" width="7" height="7" rx="1"/>'
    + '<rect x="3" y="14" width="7" height="7" rx="1"/>'
    + '<path d="M17.5 14v7M14 17.5h7"/></svg>';
  _gwTopology.setNodeIcon("key", keySvg);
  _gwTopology.setNodeIcon("gateway", gateSvg);

  // 平台节点
  fillTrafficNodeIcons(_gwTopology, "p-");
}

/**
 * 给任意拓扑的平台节点填 logo。
 *
 * 网关用 `p-<platform>`、哨兵用 `s-<platform>`；两边共用同一份
 * `platform-icons.js`，缺图时用首字母兜底（不让节点空着）。
 */
function fillTrafficNodeIcons(topology, prefix) {
  if (!topology) return;
  const icons = window.WBPlatformIcons;
  const nodes = topology.nodes || {};
  Object.keys(nodes).forEach(id => {
    if (!id.startsWith(prefix)) return;
    const platformId = id.slice(prefix.length);
    let svg = "";
    if (icons && typeof icons.get === "function") {
      svg = icons.get(platformId) || "";
    }
    if (!svg) {
      const el = nodes[id];
      const label = (el.querySelector(".wbt-node-label") || {}).textContent || "";
      svg = `<span style="font-size:15px;font-weight:700;opacity:.65">${
        esc(label.trim().charAt(0).toUpperCase() || "?")}</span>`;
    }
    topology.setNodeIcon(id, svg);
  });
}

/**
 * 拆出「产品名 + 区域」。
 *
 * 平台标签是「Qoder 中国版」这种「产品 + 区」的组合。拓扑节点是 2 列窄卡，
 * 整串塞进标题会被截成「Qoder 中…」（实测），所以标题只留产品名，
 * 区域挪到副标题 —— 一眼仍然知道是哪个区，字也不会被截断。
 */
function splitPlatformLabel(label) {
  const text = String(label || "").trim();
  const matched = text.match(/^(.*?)[\s·]+(国内版|国际版|中国版|海外版|CN|INTL)$/i);
  if (!matched) return { name: text, region: "" };
  return { name: matched[1].trim(), region: matched[2].trim() };
}

/** 平台清单（含账号数 / 禁用状态）。 */
async function gwTrafficPlatforms() {  try {
    const r = await api("/api/gateway/order");
    const { ok, data } = await safeJson(r);
    const pool = (ok && data && (data.pool || data.items)) || [];
    if (pool.length) return pool;
  } catch (error) {
    // 落到下面的兜底
  }
  // 兜底：用平台列表（没有顺序信息）
  const specs = await clientPlatformSpecs();
  return specs.map(spec => ({
    platform: spec.id,
    label: spec.label,
    accounts: 0,
    disabled: false,
  }));
}

/** 按当前策略顺序，高亮第一个可用平台并发射粒子。 */
async function gwHighlightFirst() {
  if (!_gwTopology) return;
  const platforms = await gwTrafficPlatforms();
  if (!platforms.length) return;
  const first = platforms[0];
  _gwTopology.setActiveNode("p-" + first.platform);
  _gwTopology.setActiveLink("gateway", "p-" + first.platform);
  _gwTopology.setSub("gateway", "当前选：" + (first.label || first.platform));
  _gwTopology.fire("key", "gateway", { duration: 520 });
  setTimeout(() => {
    _gwTopology.fire("gateway", "p-" + first.platform, { duration: 620 });
  }, 480);
}

/** 模拟一批请求：按策略顺序轮流发粒子（体现「分摊」）。 */
async function gwTrafficBurst() {
  if (!_gwTopology) {
    await gwInitTraffic(true);
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  if (!_gwTopology) return;
  const platforms = await gwTrafficPlatforms();
  if (!platforms.length) {
    toast("没有可调度的平台", "err");
    return;
  }
  const count = 5;
  for (let index = 0; index < count; index += 1) {
    // 按策略顺序取（round_robin / random 时顺序本身就是策略结果）
    const target = platforms[index % platforms.length];
    const delay = index * 160;
    setTimeout(() => {
      _gwTopology.fire("key", "gateway", { duration: 500 });
      setTimeout(() => {
        _gwTopology.fire("gateway", "p-" + target.platform, { duration: 600 });
        _gwTopology.setSub("gateway", "本次 → " + (target.label || target.platform));
      }, 460);
    }, delay);
  }
  toast(`模拟 ${count} 个请求，按当前策略分散到 ${Math.min(count, platforms.length)} 个平台`);
}

/**
 * 切换策略后**只更新高亮**，不重建节点。
 *
 * 原来调 `gwInitTraffic(true)` 会 `innerHTML=""` 清空重画 ——
 * 节点短暂消失 + 容器高度变化 = 页面抽搐。
 * 现在只改 class 和文案。
 */
async function gwOnStrategyChanged() {
  if (!_gwTopology) {
    await gwInitTraffic(true);
    return;
  }
  const platforms = await gwTrafficPlatforms();
  if (!platforms.length) return;
  const first = platforms[0];
  // 更新每个节点的「顺序」副标题
  const patches = {};
  platforms.forEach((item, index) => {
    patches["p-" + item.platform] = {
      sub: `${index + 1}. ${item.accounts} 个账号`,
      active: index === 0,
    };
  });
  _gwTopology.updateNodes(patches);
  _gwTopology.setActiveLink("gateway", "p-" + first.platform);
  _gwTopology.setSub("gateway", "当前选：" + (first.label || first.platform));
  _gwTopology.fire("key", "gateway", { duration: 480 });
  setTimeout(() => {
    _gwTopology.fire("gateway", "p-" + first.platform, { duration: 560 });
  }, 440);
}

async function saveGwSpread(checked) {
  const r = await api("/api/gateway/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spread_unbound: Boolean(checked) }),
  });
  const { ok, data } = await safeJson(r);
  if (!ok) {
    toast("保存失败：" + ((data && data.detail) || r.status), "err");
    return;
  }
  toast(checked
    ? "已开启：无头请求会按策略分摊到各平台"
    : "已关闭：无头请求走默认平台");
  if (typeof loadGatewayConfig === "function") loadGatewayConfig();
}

async function detectAllClients() {
  toast("正在探测所有平台…");
  const r = await api("/api/client-profile/detect-all", { method: "POST" });
  const { ok, data } = await safeJson(r);
  if (!ok) {
    toast("探测失败：" + ((data && data.detail) || r.status), "err");
    return;
  }
  const items = (data && data.items) || [];
  const rows = items.map(item => {
    const dirs = item.dirs || [];
    const values = item.values || {};
    const detected = item.detected || {};
    const has = item.has_client
      || dirs.length > 0
      || Object.keys(values).length > 0
      || Boolean(detected.config_root)
      || Boolean((detected.items || []).length);
    const detail = item.kind === "workbuddy"
      ? Object.entries(values).slice(0, 4).map(([k, v]) =>
          `${esc(k)}=<code>${esc(String(v)).slice(0, 40)}</code>`).join("<br>")
      : [
          detected.config_root ? `目录 <code>${esc(String(detected.config_root))}</code>` : "",
          detected.base_url ? `上游 <code>${esc(String(detected.base_url))}</code>` : "",
          dirs.length ? `${dirs.length} 个扫描目录` : "",
          (detected.items || []).length ? `${detected.items.length} 个凭据位置` : "",
        ].filter(Boolean).join("<br>");
    return `<tr class="border-t">
      <td class="text-xs">${esc(item.label || item.platform)}</td>
      <td class="text-xs">${has
        ? '<span style="color:var(--success,#33587F)">已检测</span>'
        : '<span style="color:var(--fg-subtle)">未检测到</span>'}</td>
      <td class="text-[11px]">${detail || '<span style="color:var(--fg-subtle)">—</span>'}</td>
    </tr>`;
  }).join("");

  openModal(`<h3 class="font-semibold text-lg mb-2">全平台客户端探测</h3>
    <p class="text-xs mb-2" style="color:var(--fg-muted)">
      共 ${items.length} 个平台。缺客户端的平台不影响其它平台。
    </p>
    <table class="w-full text-sm">
      <thead><tr class="text-[11px]" style="color:var(--fg-subtle)">
        <th class="text-left">平台</th><th class="text-left">状态</th>
        <th class="text-left">探测到</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="flex justify-end mt-4">
      <button onclick="closeModal()" class="console-btn quiet">关闭</button>
    </div>`, "max-w-3xl");
}

async function detectClient(){
  const storage = clientPlatform() || "workbuddy";
  const body = document.querySelector("#clientProbeBody");
  if (body) body.innerHTML = '<span class="text-slate-400">正在探测…</span>';

  // WorkBuddy 走原接口（返回 effective / saved / detected 全套）
  if (storage === "workbuddy") {
    if (typeof loadClientProfile === "function") {
      await loadClientProfile();
      return;
    }
  }

  // 其它平台：只探目录/凭据，用**同一套字段骨架**填值
  let response;
  try {
    response = await api(
      `/api/client-profile/detect?platform=${encodeURIComponent(storage)}`,
      { method: "POST" });
  } catch (error) {
    if (body) {
      body.innerHTML = `<p style="color:var(--danger)">探测请求失败：${esc(String(error).slice(0, 140))}</p>`;
    }
    return;
  }
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (body) {
      body.innerHTML = `<p style="color:var(--danger)">探测失败：${esc(parsed.detail || response.status)}</p>`;
    }
    return;
  }
  renderClientScanBody(parsed, storage);
  renderClientPlatformFields(parsed, storage);
}

async function toggleClientSource(){
  const cur = _clientProfile?.source || "auto";
  const next = cur === "saved" ? "auto" : "saved";
  const isSaved = next === "saved";
  if(!await uiConfirm({kind:"warn", danger:false,
      title:isSaved?"切换为「钉住已保存值」":"切换为「优先现场探测」",
      message:isSaved
        ? "保存的值将优先于现场探测。线上实例应选这个（它探测不到客户端）。"
        : "现场探测的值将优先于保存值。本机装了客户端时用它，版本升级后会自动跟上。",
      okText:"切换"})) return;
  const r = await api("/api/client-profile",{method:"PUT",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({profile:{}, source:next, merge:true})});
  if(r.ok){ toast("已切换为 "+(isSaved?"钉住已保存值":"优先现场探测")); loadClientProfile(); }
  else toast("切换失败","err");
}

/* ==================== 逆向产物（开发/测试工具） ====================
   从本机客户端 app.asar 解出源码。全量实测 2242 个文件 / 225MB / 约 14 秒，
   所以走后台任务 + 轮询进度，避免请求挂死、界面「点了没反应」。
   生产环境用 ADMIN_DEV_TOOLS=0 整体关闭（接口 404，本区域自动隐藏）。
*/
let _unpackTimer = null;
let _appSource = null;

function _fmtBytes(n){
  n = Number(n)||0;
  if(n < 1024) return n + " B";
  if(n < 1024*1024) return (n/1024).toFixed(1) + " KB";
  if(n < 1024*1024*1024) return (n/1024/1024).toFixed(1) + " MB";
  return (n/1024/1024/1024).toFixed(2) + " GB";
}
function _fmtTime(ts){
  if(!ts) return "—";
  try { return new Date(ts*1000).toLocaleString(); } catch(e){ return "—"; }
}

async function loadAppSource(){
  const r = await api("/api/app-source/status");
  if(!r.ok){
    // 404 = 该功能被 ADMIN_DEV_TOOLS=0 关闭；整块隐藏，不给用户看死按钮
    if(r.status === 404){ $("#appSourceBlock")?.classList.add("hidden"); return; }
    if($("#appSourceStatus")) $("#appSourceStatus").innerHTML =
      `<span class="text-red-500">加载失败（HTTP ${r.status}）</span>`;
    return;
  }
  const d = await r.json();
  if(!d.dev_tools){ $("#appSourceBlock")?.classList.add("hidden"); return; }
  $("#appSourceBlock")?.classList.remove("hidden");
  _appSource = d;

  const st = d.source_stat || {};
  if($("#installDirInput")) $("#installDirInput").value = d.install_dir || "";
  if($("#sourceDirInput")) $("#sourceDirInput").value = d.source_dir || "";

  const ok = !!d.install_dir;
  $("#appSourceStatus").innerHTML = `
    <div class="grid md:grid-cols-2 gap-x-6 gap-y-1">
      <div>安装目录：${ok
        ? `<b class="text-emerald-600">${esc(d.install_dir)}</b>`
        : `<b class="text-amber-600">未找到</b>`}</div>
      <div>app.asar：${d.asar
        ? `<span class="text-slate-600">${_fmtBytes(d.asar_size)}</span>`
        : `<span class="text-slate-400">无</span>`}</div>
      <div>产物目录：<span class="text-slate-600">${esc(d.source_dir||"")}</span></div>
      <div>产物状态：${st.files
        ? `<b class="text-emerald-600">已产出</b> · ${st.files} 个文件 · ${_fmtBytes(st.bytes)}
           ${st.extracted_at?` · ${_fmtTime(st.extracted_at)}`:""}`
        : `<span class="text-slate-400">尚未产出</span>`}</div>
    </div>
    <div class="mt-1 text-slate-400">
      路径来源 — 安装目录：${esc(d.paths_config?.sources?.install_dir||"—")}
      · 产物目录：${esc(d.paths_config?.sources?.source_dir||"—")}
      · 解包环境：Python ${esc(d.python||"")}${d.node?` / Node ${esc(d.node)}（非必需）`:""}
    </div>
    ${!ok ? `<div class="mt-1 text-amber-600"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>
      未找到客户端安装目录。请在下方手动填入安装路径（例如 D:\\WorkBuddy），
      或把安装盘符加进 <code>WORKBUDDY_DRIVES</code>。</div>` : ""}`;

  if(st.files) $("#unpackBtn").innerHTML = '<span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg></span>补齐产物';
  else $("#unpackBtn").innerHTML = '<span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22v-9"/><path d="M15.17 2.21a1.67 1.67 0 0 1 1.63 0L21 4.57a1.93 1.93 0 0 1 0 3.36L8.82 14.79a1.655 1.655 0 0 1-1.64 0L3 12.43a1.93 1.93 0 0 1 0-3.36z"/><path d="M20 13v3.87a2.06 2.06 0 0 1-1.11 1.83l-6 3.08a1.93 1.93 0 0 1-1.78 0l-6-3.08A2.06 2.06 0 0 1 4 16.87V13"/><path d="M21 12.43a1.93 1.93 0 0 0 0-3.36L8.83 2.2a1.64 1.64 0 0 0-1.63 0L3 4.57a1.93 1.93 0 0 0 0 3.36l12.18 6.86a1.636 1.636 0 0 0 1.63 0z"/></svg></span>一键拆包';
}

async function detectInstall(){
  toast("正在扫描本机安装目录...","ok");
  const r = await api("/api/app-source/detect",{method:"POST"});
  const d = await r.json().catch(()=>({}));
  if(!r.ok){ toast("扫描失败","err"); return; }
  await loadAppSource();
  toast(d.install_dir ? "已找到安装目录" : "未找到安装目录，请手动指定",
        d.install_dir ? "ok" : "err");
}

async function locateInstall(){
  const v = ($("#installDirInput")?.value || "").trim();
  if(!v){ toast("请先填写安装目录","err"); return; }
  const r = await api("/api/app-source/locate",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({install_dir:v, save:true})});
  const d = await r.json().catch(()=>({}));
  if(!r.ok){ toast("校验失败: "+(d.detail||""),"err"); $("#appSourceMsg").innerHTML =
    `<span class="text-red-500">${esc(d.detail||"")}</span>`; return; }
  // 回填规范化后的路径：用户填的是 resources/ 或 app.asar 时能看到被纠正成什么
  const v2 = d.validated || {};
  $("#appSourceMsg").innerHTML = `<span class="text-emerald-600">已保存并立即生效</span>
    <div class="text-xs text-slate-400 mt-1">安装目录规范化为 <code>${esc(v2.install_dir||"")}</code>
    （你填的是 <code>${esc(v2.input||"")}</code>）</div>`;
  toast("安装目录已更新");
  await loadAppSource();
}

async function locateSourceDir(){
  const v = ($("#sourceDirInput")?.value || "").trim();
  if(!v){ toast("请填写产物输出目录","err"); return; }
  const r = await api("/api/app-source/locate",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({source_dir:v, save:true})});
  const d = await r.json().catch(()=>({}));
  if(!r.ok){ toast("设置失败: "+(d.detail||""),"err"); return; }
  toast("输出目录已更新");
  await loadAppSource();
}

async function unpackPlan(){
  const r = await api("/api/app-source/unpack/plan",{method:"POST"});
  const d = await r.json().catch(()=>({}));
  if(!r.ok){ toast("预检失败: "+(d.detail||""),"err"); return; }
  const p = d.plan||{}, e = d.existing||{};
  $("#appSourceMsg").innerHTML = `
    <div class="card p-3 bg-slate-50">
      <div class="text-xs">本次将处理 <b>${p.files||0}</b> 个文件、约 <b>${_fmtBytes(p.bytes)}</b>；
        其中 <b>${p.unpacked||0}</b> 个来自 <code>app.asar.unpacked</code>。</div>
      <div class="text-xs mt-1">输出到 <code>${esc(d.dest||"")}</code></div>
      ${e.files ? `<div class="text-xs mt-1 text-slate-400">已存在 ${e.files} 个文件（${_fmtBytes(e.bytes)}），
        拆包会<b>跳过已存在文件</b>、只补缺失的。</div>` : ""}
      ${p.missing ? `<div class="text-xs mt-1 text-amber-600">${p.missing} 个 unpacked 文件在磁盘上缺失，无法抽取。</div>` : ""}
    </div>`;
  // 顺带把预检结果作为确认框内容，让用户对「写 225MB」有预期
  if(await uiConfirm({kind:"info", danger:false, title:"确认拆包",
      message:`将写入约 ${_fmtBytes(p.bytes)}（${p.files} 个文件）到\n${d.dest}\n\n已存在的文件会被跳过。继续？`,
      okText:"开始拆包"})){
    doUnpack();
  }
}

async function doUnpack(){
  const btn = $("#unpackBtn");
  if(btn) btn.disabled = true;
  const r = await api("/api/app-source/unpack",{method:"POST",
    headers:{"Content-Type":"application/json"}, body:JSON.stringify({})});
  const d = await r.json().catch(()=>({}));
  if(!r.ok){
    if(btn) btn.disabled = false;
    toast("拆包失败: "+(d.detail||""),"err"); return;
  }
  if(d.already_running) toast("已有拆包任务在运行");
  else toast("已开始拆包");
  $("#unpackProgress")?.classList.remove("hidden");
  _pollUnpack();
}

function _pollUnpack(){
  if(_unpackTimer) clearInterval(_unpackTimer);
  const tick = async () => {
    const r = await api("/api/app-source/unpack/progress");
    if(!r.ok) return;
    const d = await r.json();
    if(!d.exists){ _stopUnpackPoll(); return; }
    const pct = d.total ? Math.floor((d.done||0)/d.total*100) : 0;
    if($("#unpackBar")) $("#unpackBar").style.width = pct + "%";
    if($("#unpackPct")) $("#unpackPct").textContent = pct + "%";
    if($("#unpackPhase")) $("#unpackPhase").textContent =
      d.status === "running" ? (d.phase||"进行中") : (d.status === "finished" ? "完成" : "失败");
    if($("#unpackDetail")) $("#unpackDetail").textContent =
      `${d.done||0}/${d.total||0}  ${d.current||""}`;

    if(d.status !== "running"){
      _stopUnpackPoll();
      const btn = $("#unpackBtn"); if(btn) btn.disabled = false;
      const res = d.result || {};
      if(d.status === "failed"){
        toast("拆包失败","err");
        $("#appSourceMsg").innerHTML = `<span class="text-red-500">失败：${esc(d.error||"")}</span>`;
      } else {
        toast("拆包完成");
        $("#appSourceMsg").innerHTML = `<span class="text-emerald-600">拆包完成</span>
          <div class="text-xs text-slate-400 mt-1">
            新增 ${res.written||0} 个文件（${_fmtBytes(res.bytes)}）·
            跳过已存在 ${res.skipped_exists||0} 个 ·
            缺失 ${res.skipped_missing||0} 个
            ${res.dest?`<br>输出目录：<code>${esc(res.dest)}</code>`:""}
          </div>`;
      }
      await loadAppSource();
    }
  };
  tick();
  _unpackTimer = setInterval(tick, 700);
}
function _stopUnpackPoll(){
  if(_unpackTimer){ clearInterval(_unpackTimer); _unpackTimer = null; }
}

async function removeSource(){
  if(!await uiConfirm({kind:"warn", danger:true, title:"删除逆向产物",
      message:"删除已解出的源码目录？只删本工具产出的那个目录（不含 .extracted 标记或名字不是 app_source 时会拒绝）。",
      okText:"删除"})) return;
  const r = await api("/api/app-source/remove",{method:"POST"});
  const d = await r.json().catch(()=>({}));
  if(!r.ok){ toast("删除失败: "+(d.detail||""),"err"); return; }
  toast(d.removed ? "已删除" : "目录不存在");
  $("#srcSearchResult").innerHTML = "";
  await loadAppSource();
}

async function searchSource(){
  const q = ($("#srcSearchInput")?.value || "").trim();
  if(!q){ toast("请输入关键字","err"); return; }
  const el = $("#srcSearchResult");
  el.innerHTML = '<span class="text-slate-400">检索中...</span>';
  const r = await api(`/api/app-source/search?q=${encodeURIComponent(q)}&limit=50`);
  const d = await r.json().catch(()=>({}));
  if(!r.ok){ el.innerHTML = `<span class="text-red-500">${esc(d.detail||"检索失败")}</span>`; return; }
  if(!d.ok){ el.innerHTML = `<span class="text-amber-600">${esc(d.reason||"")}</span>`; return; }
  if(!d.hits?.length){
    el.innerHTML = `<span class="text-slate-400">未找到「${esc(q)}」（已扫描 ${d.scanned||0} 个文件）</span>`;
    return;
  }
  el.innerHTML = `<div class="text-slate-400 mb-1">${d.hits.length} 处命中（已扫描 ${d.scanned} 个文件）</div>` +
    d.hits.map(h => `<div class="mb-1 border-b border-slate-100 pb-1">
        <span class="text-sky-600">${esc(h.file)}:${h.line}</span>
        <div class="text-slate-500 break-all">${esc(h.text)}</div>
      </div>`).join("");
}

/* ==================== 设置 ==================== */
async function changePassword(){
  const oldP=$("#oldPwd").value, np=$("#newPwd").value, np2=$("#newPwd2").value;
  if(np.length<6){ toast("新密码至少6位","err"); return; }
  if(np!==np2){ toast("两次输入不一致","err"); return; }
  const r=await api("/api/admin/password",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({old_password:oldP,new_password:np})});
  if(r.ok){ toast("密码已修改，下次登录生效（后台设置优先于 .env）"); $("#oldPwd").value=$("#newPwd").value=$("#newPwd2").value=""; }
  else { const d=await r.json().catch(()=>({})); toast("修改失败: "+(d.detail||""),"err"); }
}

/* ==================== 定时任务 ==================== */
let _schedules = [];
let _schedulePollTimer = null;
const _scheduleRequests = new Set();

// 任务类型 -> 人话名称。结果里有 summary 就用它，这样每个任务都统一可读。
// keepalive_tokens 是既有任务（保活）但两张表都漏了它，显得像"未知任务"。
const TASK_LABELS = {
  daily_checkin: "签到领取积分",
  refresh_balances: "刷新平台总积分",
  refresh_credits: "更新积分到期快照",
  sync_models: "同步模型列表",
  refresh_growth_tasks: "更新成长任务列表",
  run_growth_tasks: "自动做成长任务",
  run_growth_plan: "WorkBuddy 成长计划巡检",
  keepalive_tokens: "token 保活刷新",
};

function scheduleResultSummary(s){
  const raw = s.last_result || "";
  if(!raw) return '<span class="text-slate-400">尚未运行</span>';
  let obj = null;
  try { obj = JSON.parse(raw); } catch(e) {}
  // 解析失败：多半是历史数据（旧版会截断 JSON）。如实说明，别假装是数据。
  if(!obj) {
    return `<span class="text-amber-600" data-tooltip="历史结果格式已不可解析">
      <span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>历史结果（旧格式，点详情查看）</span>`;
  }
  if(obj.error) return `<span class="text-red-500">失败：${esc(String(obj.error))}</span>`;
  if(obj.skipped) return `<span class="text-slate-500">已跳过：${esc(String(obj.skipped))}</span>`;

  // 后端已经给出人话摘要 —— 优先用它，避免前后端两套口径不一致
  if(obj.summary){
    const bad = (obj.detail||[]).filter(x=>!x.ok).length;
    const cls = bad ? "text-amber-700" : "text-slate-600";
    const elapsed = obj.elapsed_s ? `<span class="text-slate-400 ml-1">${obj.elapsed_s}s</span>` : "";
    return `<span class="${cls}">${esc(String(obj.summary))}</span>${elapsed}`;
  }

  // 兜底：老数据没有 summary 时，按类型拼
  let parts = [];
  if(s.task === "daily_checkin"){
    if(obj.claimed) parts.push(`新领 ${obj.claimed}`);
    if(obj.credit) parts.push(`<span class="text-amber-600 font-medium">+${obj.credit} 积分</span>`);
    parts.push(`已领 ${obj.skipped_already||0}`);
    if(obj.failed) parts.push(`<span class="text-red-500">失败 ${obj.failed}</span>`);
  } else if(s.task === "refresh_balances"){
    parts.push(`刷新 ${obj.refreshed||0}`);
    if(obj.failed) parts.push(`<span class="text-red-500">失败 ${obj.failed}</span>`);
  } else if(s.task === "sync_models"){
    parts.push(`新增 ${obj.added||0}`);
    parts.push(`更新 ${obj.updated||0}`);
    parts.push(`共 ${obj.total_in_db||0}`);
  } else if(s.task === "refresh_growth_tasks"){
    parts.push(`任务 ${obj.total||0}`);
    parts.push(`可自动 ${obj.actionable||0}`);
  } else if(s.task === "run_growth_tasks"){
    parts.push(`账号 ${obj.accounts||0}`);
    if(obj.tasks_done) parts.push(`完成 ${obj.tasks_done}`);
    if(obj.credit) parts.push(`<span class="text-amber-600 font-medium">+${obj.credit} 积分</span>`);
    if(obj.energy) parts.push(`+${obj.energy} 能量`);
    if(!obj.tasks_done) parts.push("无待做");
  } else if(s.task === "keepalive_tokens"){
    parts.push(`成功 ${obj.alive||0}/${obj.total||0}`);
    if(obj.disabled) parts.push(`<span class="text-red-500">禁用 ${obj.disabled}</span>`);
  } else {
    parts.push(esc(raw.slice(0,120)));
  }
  const fmt = obj.elapsed_s ? `<span class="text-slate-400 ml-1">${obj.elapsed_s}s</span>` : "";
  return `<span class="text-slate-600">${parts.join(" · ")}</span>${fmt}`;
}

// 详情弹窗：把 JSON 变成「概览 + 逐账号表格 + 原因」，而不是一坨 JSON
function showScheduleResult(id){
  const s = (_schedules||[]).find(x => x.id === id);
  if(!s) return;
  const raw = s.last_result || "";
  let obj = null;
  try { obj = JSON.parse(raw); } catch(e) {}

  const title = esc(TASK_LABELS[s.task] || s.name || "任务");
  const head = `<h3 class="font-bold mb-3"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></span>
      上次运行结果 — ${esc(s.name)}</h3>`;

  if(!obj){
    // 旧格式：给出原文，并说明为什么不能结构化展示
    openModal(`${head}
      <p class="text-xs text-amber-600 mb-2">该结果由旧版本写入（JSON 被截断，无法解析），
      仅能显示原文；下次运行后即为可读格式。</p>
      <pre class="text-xs bg-slate-50 rounded-lg p-3 overflow-auto max-h-[60vh] whitespace-pre-wrap">${esc(raw||"（无）")}</pre>
      <div class="flex justify-end mt-3"><button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">关闭</button></div>`);
    return;
  }

  // 概览行：把标量字段挑出来展示（跳过 detail/errors 这类复杂字段）
  const skip = new Set(["detail","errors","failed_accounts","task"]);
  const kv = Object.entries(obj).filter(([k,v]) =>
      !skip.has(k) && (typeof v !== "object" || v === null));
  const ovHtml = kv.length ? `<div class="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
      ${kv.map(([k,v]) => `<div class="bg-slate-50 rounded-lg px-3 py-2">
        <div class="text-[11px] text-slate-400">${esc(k)}</div>
        <div class="text-sm font-medium text-slate-700">${esc(String(v))}</div>
      </div>`).join("")}
    </div>` : "";

  // 摘要单独突出显示
  const sumHtml = obj.summary
    ? `<div class="mb-3 text-sm bg-emerald-50 text-emerald-800 rounded-lg px-3 py-2">
         ${esc(String(obj.summary))}</div>` : "";

  // 逐账号明细表（签到/成长任务最关键的信息）
  let detailHtml = "";
  if(Array.isArray(obj.detail) && obj.detail.length){
    const rows = obj.detail.map(d => {
      const ok = d.ok;
      const icon = ok
        ? '<span class="wb-icon text-emerald-500"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg></span>'
        : '<span class="wb-icon text-red-500"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg></span>';
      const credit = d.credit ? `<span class="text-amber-600 font-medium">+${d.credit}</span>` : "—";
      return `<tr class="border-t">
        <td class="py-1.5 pr-2">${icon}</td>
        <td class="py-1.5 pr-3 text-slate-700">${esc(String(d.account ?? d.account_id ?? ""))}</td>
        <td class="py-1.5 pr-3">${credit}</td>
        <td class="py-1.5 text-slate-600">${esc(String(d.reason ?? ""))}</td>
      </tr>`;
    }).join("");
    const trunc = obj.detail_truncated
      ? `<p class="text-[11px] text-slate-400 mt-1">明细过长，仅显示前 ${obj.detail.length} 条。</p>` : "";
    detailHtml = `<div class="mb-2">
      <div class="text-xs font-semibold text-slate-500 mb-1">逐账号结果</div>
      <div class="max-h-64 overflow-auto rounded-lg border">
        <table class="w-full text-xs"><tbody>${rows}</tbody></table>
      </div>${trunc}</div>`;
  }

  // 失败账号名单（成长任务用它，没有 detail 时也有信息）
  let failHtml = "";
  if(Array.isArray(obj.failed_accounts) && obj.failed_accounts.length && !detailHtml){
    failHtml = `<div class="mb-2 text-xs"><span class="text-slate-500">失败账号：</span>
      <span class="text-red-500">${obj.failed_accounts.map(esc).join("、")}</span></div>`;
  }
  let errHtml = "";
  if(Array.isArray(obj.errors) && obj.errors.length){
    errHtml = `<details class="mb-2"><summary class="text-xs text-slate-500 cursor-pointer">
      错误明细（${obj.errors.length}）</summary>
      <pre class="text-[11px] bg-slate-50 rounded-lg p-2 mt-1 overflow-auto max-h-40 whitespace-pre-wrap">${esc(obj.errors.join("\n"))}</pre>
      </details>`;
  }

  // 原始 JSON 收进折叠区：需要时才看，不占主视觉
  const rawHtml = `<details class="mt-2"><summary class="text-xs text-slate-400 cursor-pointer">原始 JSON</summary>
      <pre class="text-[11px] bg-slate-50 rounded-lg p-2 mt-1 overflow-auto max-h-40 whitespace-pre-wrap">${esc(JSON.stringify(obj,null,2))}</pre>
    </details>`;

  openModal(`${head}${sumHtml}${ovHtml}${detailHtml}${failHtml}${errHtml}${rawHtml}
    <div class="flex justify-end mt-3"><button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">关闭</button></div>`);
}
async function loadSchedules(){
  const r = await api("/api/schedules"); if(!r.ok) return; const d = await r.json();
  const previous = new Map(_schedules.map(row => [row.id, row.last_result]));
  const all = d.items||[];
  // 平台作用域：任务本身带 `platform`（落库平台）。切到 Trae 时，
  // WorkBuddy 的签到/成长任务**不该出现在列表里** —— 点了也只会得到
  // 「该任务不作用于当前平台」，让人以为按钮坏了。
  // 定时任务**不跟随平台切换**：各平台的签到/保活都要能一眼看到并管理。
  // 之前按当前平台过滤，切到 WorkBuddy 时 Qoder/Loomy 的任务整批消失，
  // 用户以为「其它平台的保活/签到没进定时任务」。
  _schedules = all.slice().sort((a, b) => {
    const pa = String(a.platform || ""), pb = String(b.platform || "");
    return pa === pb ? (a.id - b.id) : pa.localeCompare(pb);
  });
  const hidden = 0;
  if (_schedules.some(row => previous.has(row.id) && previous.get(row.id) !== row.last_result)) loadAccounts();
  clearTimeout(_schedulePollTimer);
  if(_schedules.some(s => { try { return JSON.parse(s.last_result||"{}").running; } catch(e) { return false; } })){
    _schedulePollTimer = setTimeout(() => loadSchedules(), 4000);
  }
  $("#scheduleBody").innerHTML = (_schedules).map(s => `
    <tr class="border-t hover:bg-slate-50">
      <td class="px-4 py-3 whitespace-nowrap">${esc(s.display_name || s.name)}
        <div class="text-[11px] text-slate-400">${esc(s.platform_label || s.platform || "WorkBuddy")}</div></td>
      <td class="px-4 py-3 text-slate-500 whitespace-nowrap">${esc(s.task_label)}</td>
      <td class="px-4 py-3 text-slate-500 whitespace-nowrap">${esc(s.cycle_label || ('每 '+s.interval_minutes+' 分钟'))}</td>
      <td class="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">${fmtTime(s.next_run_at)}</td>
      <td class="px-4 py-3 text-xs align-top">
        <div class="flex items-start gap-1">
          <span class="flex-1 min-w-0 schedule-result-text">${scheduleResultSummary(s)}</span>
          <button onclick="showScheduleResult(${s.id})" class="shrink-0 text-sky-600 hover:text-sky-800" data-tooltip="查看完整结果"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/></svg></span></button>
        </div>
        ${s.stop_after?`<div class="text-rose-400 mt-0.5">停止于 ${fmtTime(s.stop_after)}</div>`:''}
      </td>
      <td class="px-4 py-3 col-status">${s.enabled?'<span class="badge bg-emerald-100 text-emerald-700">启用</span>':'<span class="badge bg-slate-100 text-slate-500">禁用</span>'}</td>
      <td class="px-4 py-3 text-right whitespace-nowrap">
        <button onclick="runSchedule(${s.id})" class="text-emerald-600 hover:text-emerald-800 mr-1" data-tooltip="立即运行"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg></span></button>
        <button onclick="toggleSchedule(${s.id})" class="text-indigo-600 hover:text-indigo-800 mr-1" data-tooltip="启停"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></svg></span></button>
        <button onclick="editSchedule(${s.id})" class="text-slate-500 hover:text-slate-800 mr-1" data-tooltip="编辑"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg></span></button>
        <button onclick="delSchedule(${s.id})" class="text-red-500 hover:text-red-700" data-tooltip="删除任务" data-tooltip-description="删除后不再自动执行，已执行产生的数据保留。"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></span></button>
      </td>
    </tr>`).join("") || `<tr><td colspan="7" class="px-4 py-8 text-center text-slate-400">${
      hidden > 0
        ? `当前平台没有定时任务（另有 ${hidden} 个属于其它平台，切回对应平台可查看）`
        : "还没有定时任务"}</td></tr>`;
}
async function runSchedule(id){
  if(_scheduleRequests.has(id)) return;
  _scheduleRequests.add(id);
  toast("正在启动任务...","ok");
  try {
    const r=await api("/api/schedules/"+id+"/run",{method:"POST"});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){
      toast("运行失败: "+(d.detail||r.status),"err");
      return;
    }
    const result = d.result || {};
    if(result.running){ toast("任务在后台执行，结果会自动刷新","ok"); }
    else {
      // ⚠️ 只提示「运行完成」是**没有反馈**的：签到到底是「领到了 100 积分」
      // 还是「今天已领过」还是「全部失败」，用户完全看不出来 ——
      // 这正是「点了没反应」的直接原因。这里必须把后端的结果摘要如实展示。
      const text = scheduleResultText(result);
      toast(text.message, result.failed > 0 ? "err" : "ok");
      // 有逐账号明细时同时弹窗，便于逐个核对（签到/成长任务最关键）
      if ((result.detail || []).length) {
        openModal(`<h3>${esc(text.title)}</h3>
          <p class="trae-modal-note">${esc(text.message)}</p>
          ${scheduleDetailTable(result.detail)}`, "max-w-3xl");
      }
    }
    await loadSchedules();
    await loadAccounts();
  } finally { _scheduleRequests.delete(id); }
}

/**
 * 把任务结果翻译成一句人话。
 *
 * 不同任务的 result 字段完全不同（签到看 claimed/skipped_already，
 * 刷新看 ok/fail），所以按「有没有这些字段」分派，而不是按任务名 ——
 * 任务名会改名/新增，字段才是稳定契约。
 */
function scheduleResultText(result) {
  if (result.claimed !== undefined || result.skipped_already !== undefined) {
    const claimed = Number(result.claimed || 0);
    const already = Number(result.skipped_already || 0);
    const failed = Number(result.failed || 0);
    const credit = Number(result.credit || 0);
    const bits = [];
    if (claimed) bits.push(`领取 ${claimed} 个` + (credit ? `（+${credit} 积分）` : ""));
    if (already) bits.push(`${already} 个今日已领过`);
    if (failed) bits.push(`${failed} 个失败`);
    return {
      title: "签到结果",
      message: bits.length ? bits.join(" · ") : "没有可签到的账号",
    };
  }
  if (result.deferred) {
    return { title: "任务已顺延", message: result.summary || "出口保护期间顺延，稍后自动重试" };
  }
  if (result.ok !== undefined) {
    const ok = Number(result.ok || 0);
    const fail = Number(result.fail || 0);
    return {
      title: "任务完成",
      message: result.summary || `成功 ${ok} 个` + (fail ? ` · 失败 ${fail} 个` : ""),
    };
  }
  return { title: "任务完成", message: result.summary || "运行完成" };
}

/** 逐账号明细表（签到 / 成长任务 / 刷新余额共用）。 */
function scheduleDetailTable(detail) {
  const rows = (detail || []).map(item => `<tr>
    <td class="sentinel-acc">#${esc(String(item.account_id ?? ""))}</td>
    <td>${esc(item.account || "-")}</td>
    <td>${item.ok
      ? `<span class="trae-chip ok">${esc(item.status || "成功")}</span>`
      : `<span class="trae-chip warn">${esc(item.status || "失败")}</span>`}</td>
    <td>${item.credit ? "+" + esc(String(item.credit)) : "—"}</td>
    <td class="sentinel-detail">${esc(item.reason || item.error || "")}</td>
  </tr>`).join("");
  return `<div class="sentinel-table-wrap"><table class="tbl">
    <thead><tr><th>账号</th><th>名称</th><th>结果</th><th>积分</th><th>说明</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
async function toggleSchedule(id){ await api("/api/schedules/"+id+"/toggle",{method:"POST"}); loadSchedules(); }
async function delSchedule(id){ if(!await uiConfirm({message:"确认删除该任务？", title:"删除定时任务"}))return; const r=await api("/api/schedules/"+id,{method:"DELETE"}); toast(r.ok?"已删除":"失败",r.ok?"ok":"err"); if(r.ok) loadSchedules(); }
function scheduleTimingHTML(data){
  const timing = data.timing || {mode:'preset', time:'09:00', weekdays:[0], monthday:1};
  const modes = [['preset','系统预设'],['interval','固定间隔'],['daily','每天'],['weekly','每周'],['monthly','每月']];
  const minutes = data.interval_minutes || 60;
  const unit = [10080,1440,60,1].find(value => minutes % value === 0);
  return `<div class="schedule-field"><label id="scCycleLabel">执行周期</label>
    ${uiSelectHTML('scCycle', {value:timing.mode, options:modes.map(([value,label])=>({value,label})), onChange:onScheduleCycleChange})}</div>
    <div id="scIntervalWrap" ${['preset','interval'].includes(timing.mode)?'':'hidden'}>
      <div class="schedule-field"><label for="scIv">执行间隔</label><div class="schedule-interval"><input aria-label="执行间隔" id="scIv" type="number" min="1" max="5256000" value="${minutes/unit}">
      ${uiSelectHTML('scUnit', {value:String(unit), options:[[1,'分钟'],[60,'小时'],[1440,'天'],[10080,'周']].map(([value,label])=>({value:String(value),label}))})}</div></div>
    </div>
    <div id="scCalendarWrap" ${['daily','weekly','monthly'].includes(timing.mode)?'':'hidden'}>
      <div class="schedule-field"><label for="scTimeButton">执行时间 <span class="schedule-zone">北京时间 · UTC+8</span></label>
      <input id="scTime" aria-label="执行时间" data-timezone="北京时间 · UTC+8" type="time" value="${esc(timing.time||'09:00')}"></div>
      <div id="scWeekWrap" class="schedule-field" ${timing.mode==='weekly'?'':'hidden'}><span id="scWeekLabel">执行日</span><div class="schedule-weekdays" role="group" aria-labelledby="scWeekLabel">${[...'一二三四五六日'].map((day,i)=>`<label class="schedule-weekday"><input type="checkbox" name="scWeekday" value="${i}" ${(timing.weekdays||[0]).includes(i)?'checked':''}><span>周${day}</span></label>`).join('')}</div></div>
      <div id="scMonthWrap" class="schedule-field" ${timing.mode==='monthly'?'':'hidden'}><label for="scMonthday">每月几号</label><input id="scMonthday" aria-describedby="scMonthHint" type="number" min="1" max="31" value="${Number(timing.monthday)||1}"><p id="scMonthHint" class="schedule-hint">当月没有该日期时，在当月最后一天执行。</p></div>
    </div>
    <p id="scPresetHint" class="schedule-hint" ${timing.mode==='preset'?'':'hidden'}>沿用系统现有间隔；token 保活沿用系统配置的整点时间。选择其他周期可自定义。</p>`;
}
function onScheduleCycleChange(){
  window.WBDateTimePicker?.close();
  const mode = uiSelectValue('scCycle');
  $('#scIntervalWrap').hidden = !['preset','interval'].includes(mode);
  $('#scCalendarWrap').hidden = !['daily','weekly','monthly'].includes(mode);
  $('#scWeekWrap').hidden = mode !== 'weekly';
  $('#scMonthWrap').hidden = mode !== 'monthly';
  $('#scPresetHint').hidden = mode !== 'preset';
}
function scheduleForm(title, data){
  data = data || {};
  const taskOpts = _taskOptions();
  const saVal = (data.stop_after||"").slice(0,16); // 适配 <input type="datetime-local">
  const isCheckin = data.task==="daily_checkin";
  openModal(`
    <div class="schedule-form">
    <header class="schedule-form-head"><span class="schedule-form-icon"><i class="fa-regular fa-clock" aria-hidden="true"></i></span><div><h3>${title}</h3><p>设置任务内容与执行周期</p></div></header>
    <div class="schedule-field"><label for="scName">任务名称 <span class="schedule-zone">可选</span></label>
    <input id="scName" placeholder="留空按执行周期自动命名" value="${esc(data.display_name && data.display_name!==data.name ? '' : (data.name||''))}" /></div>
    <div class="schedule-field"><label id="scTaskLabel">任务类型</label>
    ${uiSelectHTML("scTask", { value: String(data.task || (tasks[0] && tasks[0][0]) || ""),
        options: taskOpts, onChange: () => onTaskChange() })}</div>
    ${scheduleTimingHTML(data)}
    <details class="schedule-help"><summary><i class="fa-regular fa-circle-question" aria-hidden="true"></i>成长计划执行说明</summary><p>成长计划建议每 60 分钟巡检：逐账号补每日活跃、签到、领取旅行礼物、兑换连登奖励并使用免费抽奖次数。每天最多一次成功活跃对话；每日最多开启一批盲盒（5个以内，消耗已有能量）、抽奖5次。进度持久化，重复运行会跳过已完成项。</p></details>
    <div id="scStopWrap" class="${isCheckin?'':'hidden'}">
      <div class="schedule-field"><label for="scStopButton">停止领取时间 <span class="schedule-zone">可选 · 本地时间</span></label>
      <input id="scStop" aria-label="停止领取时间" type="datetime-local" value="${saVal}" />
      <p class="schedule-hint">到达该时间后停止自动领取。留空不限制，活动结束会自动停止。</p></div>
    </div>
    <div class="schedule-enabled"><div><label for="scEnabled">启用任务</label><p>按设置的周期自动执行</p></div><label class="schedule-switch"><input id="scEnabled" type="checkbox" role="switch" aria-label="启用任务" ${data.enabled?'checked':''} /><span></span></label></div>
    <footer class="schedule-form-actions">
      <button type="button" onclick="closeModal()" class="console-btn">取消</button>
      <button type="button" onclick="submitSchedule(${data.id||0})" class="console-btn primary">保存任务</button>
    </footer></div>`, 'max-w-lg');
  WBDateTimePicker.attach('scTime');
  WBDateTimePicker.attach('scStop');
  initScheduleSelects();
}
function initScheduleSelects(){
  initUISelects([['scTask','任务类型'],['scCycle','执行周期'],['scUnit','间隔单位']]);
}
function initUISelects(entries){
  for(const [id,label] of entries){
    const select = document.getElementById(id), trigger = select.querySelector('.ui-select-btn');
    trigger.tabIndex = 0; trigger.setAttribute('role','combobox');
    trigger.setAttribute('aria-label',label); trigger.setAttribute('aria-haspopup','listbox');
    trigger.setAttribute('aria-expanded','false'); trigger.setAttribute('aria-controls',id+'Options');
    const panel = select.querySelector('.ui-select-panel');
    panel.id = id+'Options'; panel.setAttribute('role','listbox'); panel.setAttribute('aria-label',label);
    select.querySelectorAll('.ui-select-opt').forEach((option,index)=>{
      option.id = id+'Option'+index; option.setAttribute('role','option');
      option.setAttribute('aria-selected',String(option.classList.contains('sel')));
    });
    select.addEventListener('keydown',event=>{
      const options = [...select.querySelectorAll('.ui-select-opt')];
      const keys = ['ArrowDown','ArrowUp','Home','End','Enter',' ','Escape','Tab'];
      if(!keys.includes(event.key)) return;
      if(!options.length) return;
      const opened = select.classList.contains('open');
      if(event.key==='Tab'){ select.classList.remove('open'); return; }
      if(event.key==='Escape'){
        if(opened){event.preventDefault();event.stopPropagation();select.classList.remove('open');}
        return;
      }
      event.preventDefault();
      if(!opened){uiSelectToggle(id); if(event.key==='Enter'||event.key===' ') return;}
      let index = options.findIndex(option=>option.id===trigger.getAttribute('aria-activedescendant'));
      if(index<0) index = Math.max(0,options.findIndex(option=>option.classList.contains('sel')));
      if(event.key==='Enter'||event.key===' '){ uiSelectPick(id,options[index].dataset.value); return; }
      if(event.key==='Home') index=0;
      else if(event.key==='End') index=options.length-1;
      else index=(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
      options.forEach((option,i)=>option.classList.toggle('active',i===index));
      trigger.setAttribute('aria-activedescendant',options[index].id);
      options[index].scrollIntoView({block:'nearest'});
    });
    new MutationObserver(()=>{
      trigger.setAttribute('aria-expanded',String(select.classList.contains('open')));
      if(!select.classList.contains('open')){
        trigger.removeAttribute('aria-activedescendant');
        select.querySelectorAll('.ui-select-opt').forEach(option=>{option.classList.remove('active'); option.setAttribute('aria-selected',String(option.classList.contains('sel')));});
      }
    }).observe(select,{attributes:true,attributeFilter:['class']});
  }
}
/** 可选任务清单（含各平台专属任务），来自 /api/schedules/tasks。 */
let _taskCatalog = [];
let _taskCatalogAt = 0;
async function loadTaskCatalog(force) {
  if (!force && _taskCatalog.length && Date.now() - _taskCatalogAt < 60000) return _taskCatalog;
  try {
    const { ok, data } = await safeJson(await api("/api/schedules/tasks"));
    if (ok && Array.isArray(data.items)) {
      _taskCatalog = data.items;
      _taskCatalogAt = Date.now();
    }
  } catch (e) { /* 失败就用内置兜底 */ }
  return _taskCatalog;
}

/** 任务名 -> 平台（创建时必须带上，否则平台任务会被当成默认平台的任务）。 */
function taskPlatformOf(task) {
  const hit = _taskCatalog.find(item => item.value === task);
  return hit ? (hit.platform || "") : "";
}

function onTaskChange(){
  window.WBDateTimePicker?.close();
  const v = uiSelectValue("scTask");
  const wrap = document.getElementById("scStopWrap");
  // 所有平台的签到任务都以 `_checkin` / `daily_checkin` 结尾
  const isCheckin = /(^|_)checkin$/.test(String(v || "")) || v === "daily_checkin";
  if(wrap) wrap.classList.toggle("hidden", !isCheckin);
}

/** 任务下拉的选项：内置 + 各平台专属（带平台后缀，避免同名歧义）。 */
function _taskOptions() {
  if (_taskCatalog.length) {
    return _taskCatalog.map(item => ({
      value: item.value,
      // 任务名已经带了平台后缀（「签到领取积分（Trae 国内版）」），
      // 这里不再重复拼，保持下拉短一些。
      label: item.label,
    }));
  }
  return Object.entries(TASK_LABELS).map(([value, label]) => ({ value, label }));
}
async function openAddSchedule(){ await loadTaskCatalog(); scheduleForm("新建定时任务", {enabled:1, interval_minutes:60, task:"refresh_balances"}); }
async function editSchedule(id){ await loadTaskCatalog(); const s=_schedules.find(x=>x.id===id); if(!s) return; scheduleForm("编辑定时任务", s); }
async function submitSchedule(id){
  const stopRaw = ($("#scStop") ? $("#scStop").value : "").trim();
  const pickedTask = uiSelectValue("scTask");
  const body = { name:$("#scName").value, task:pickedTask,
    // 平台专属任务必须带 platform：后端按它找 gateway 的 runner
    platform: taskPlatformOf(pickedTask) || undefined,
    interval_minutes:Number($("#scIv").value)*Number(uiSelectValue("scUnit")), enabled:$("#scEnabled").checked?1:0, stop_after: stopRaw || null,
    timing:{mode:uiSelectValue("scCycle"), time:$("#scTime").value || '09:00', monthday:Number($("#scMonthday").value), weekdays:[...document.querySelectorAll('[name=scWeekday]:checked')].map(el=>Number(el.value))} };
  if(!body.timing.weekdays.length && body.timing.mode === 'weekly'){ toast('请至少选择一周中的一天','err'); return; }
  if(!body.timing.weekdays.length) body.timing.weekdays = [0];
  if(body.timing.mode === 'monthly' && !$('#scMonthday').reportValidity()) return;
  if(body.timing.mode !== 'monthly') body.timing.monthday = 1;
  if(!Number.isInteger(body.interval_minutes) || body.interval_minutes < 1 || body.interval_minutes > 5256000){
    if(['preset','interval'].includes(body.timing.mode)){ toast('请输入有效的执行间隔','err'); return; }
    body.interval_minutes = 60;
  }
  let r;
  if(id){ r = await api("/api/schedules/"+id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); }
  else { r = await api("/api/schedules",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); }
  if(r.ok){ closeModal(); loadSchedules(); toast("已保存"); }
  else { const d=await r.json().catch(()=>({})); toast("保存失败: "+(d.detail||""),"err"); }
}

