/* ==================== Keys ==================== */
/* 来源 IP 标签：表格里只放前 2 个、只写「IP · 次数」，并发为 0 时不写；
 * 原来 3 个「IP · 0 并发 · 4 次」标签加一个「并发 0」，把这一列撑到整行一半宽，
 * 名称 / Key / 频率被挤成两三行。完整列表点「N 个 / 24h」看。 */
function keyIpBadges(summary) {
  return (summary?.top_ips || []).slice(0,2).map(item => {
    const active = Number(item.active_requests || 0);
    return `<span class="badge bg-indigo-100 text-indigo-700" data-tooltip="来源 IP 用量" data-tooltip-description="${active} 路并发 · 近 24 小时 ${Number(item.requests || 0)} 次请求。">${esc(item.ip)} · ${active ? active + " 并发 · " : ""}${Number(item.requests || 0)} 次</span>`;
  }).join("");
}
/**
 * 一键复制完整 Key。
 *
 * 之前必须点「眼睛」打开弹窗再手动复制，多两步。现在点钥匙图标直接进剪贴板。
 * Key 只在创建/查看接口返回，所以先取一次再写剪贴板。
 */
async function copyKeyValue(id, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api("/api/keys/" + Number(id) + "/view");
    const { ok, data } = await safeJson(r);
    if (!ok || !data || !data.key) {
      toast((data && data.detail) || "读取 Key 失败", "err");
      return;
    }
    await copyRawText(data.key);
  } catch (e) {
    toast("读取 Key 失败：" + (e && e.message ? e.message : e), "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function keyRow(k) {
  return `
    <tr class="border-t hover:bg-slate-50">
      <td class="px-4 py-3">${esc(k.name||"未命名")}<div class="text-xs text-slate-400 mt-1">${k.account_id ? `独占账号：${esc(k.account_name || ("#" + k.account_id))}` : "公共账号池"}</div></td>
      <td class="px-4 py-3 font-mono text-xs text-slate-500">
        <div class="key-cell">
          <span class="key-cell-text">${esc(k.masked)}</span>
          <button type="button" class="key-copy-btn" onclick="copyKeyValue(${Number(k.id)}, this)"
                  data-tooltip="点击复制完整 Key">${ic("key","wb-ic")}</button>
        </div>
      </td>
      <td class="px-4 py-3 text-right tnum">${k.unlimited?"∞":fmtNum(k.credit_limit)}</td>
      <td class="px-4 py-3 text-right tnum ${k.credit_used>=k.credit_limit&&!k.unlimited?'text-red-500':''}">${fmtNum(k.credit_used)}</td>
      <td class="px-4 py-3 text-right tnum" data-tooltip="并发与频率" data-tooltip-description="同一个 Key 的所有对话共享这里的并发上限和每分钟请求额度。空=跟随全局，0=不限。">${k.max_concurrent===0?'不限':(k.max_concurrent==null?'全局':k.max_concurrent)}<div class="text-xs text-slate-400">${k.rate_per_minute===0?'不限频率':(k.rate_per_minute==null?'频率随全局':k.rate_per_minute+' 次/分')}</div></td>
      <td class="px-4 py-3"><button type="button" onclick="WBKeyIP.open(${Number(k.id)})" class="text-blue-600 whitespace-nowrap" data-tooltip="来源 IP" data-tooltip-description="查看该 Key 的来源 IP 与请求次数，用于识别共享范围与异常来源。"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg></span>${Number(k.ip_summary?.unique_ips || 0)} 个 / 24h</button><div class="mt-1 flex flex-wrap gap-1">${Number(k.ip_summary?.active_requests) > 0 ? WBIP.concurrentTag(k.ip_summary.active_requests) : ""}${keyIpBadges(k.ip_summary)}</div></td>
      <td class="px-4 py-3">${k.group_name
          ? `<span class="badge bg-indigo-100 text-indigo-700" data-tooltip="已绑定分组" data-tooltip-description="该 Key 仅可使用所绑定分组内的模型，组外模型会返回 403。">${esc(k.group_name)}</span>`
          : `<span class="text-xs text-slate-300" data-tooltip="全部模型" data-tooltip-description="未绑定分组，可用全部已启用的模型。">全部模型</span>`}</td>
      <td class="px-4 py-3 col-status">${k.status==="active"?'<span class="badge bg-emerald-100 text-emerald-700">正常</span>':'<span class="badge bg-slate-100 text-slate-500">已停用</span>'}</td>
      <td class="px-4 py-3 text-right whitespace-nowrap">
        <button onclick="viewKeyUsage(${k.id},'${esc(k.name||'')}')" class="text-blue-600 hover:text-blue-800 mr-1" data-tooltip="查看用量" data-tooltip-description="按模型与时间范围查看该 Key 的调用次数、Token 与积分消耗。"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"/><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/></svg></span></button>
        <button onclick="viewKeyFull(${k.id},'${esc(k.name||'')}')" class="text-violet-600 hover:text-violet-800 mr-1" data-tooltip="查看完整 Key" data-tooltip-description="显示该 Key 的完整密钥，可复制给客户端使用。等同凭据，请勿外传。"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg></span></button>
        <button onclick="editKey(${k.id})" class="text-indigo-600 hover:text-indigo-800 mr-1" data-tooltip="调整限额" data-tooltip-description="修改积分限额、并发与每分钟请求数。已用量不清零。"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/></svg></span></button>
        <button onclick="toggleKeyStatus(${k.id},this)" class="${k.status==='active'?'text-amber-600 hover:text-amber-800':'text-emerald-600 hover:text-emerald-800'} mr-1" data-tooltip="${k.status==='active'?'停用 Key':'启用 Key'}" data-tooltip-description="${k.status==='active'?'停用后该 Key 立即无法调用网关，配额与用量记录保留，可随时恢复。':'恢复后该 Key 按剩余额度继续可用。'}" aria-label="${k.status==='active'?'停用':'启用'} API Key">${ic(k.status==='active'?'pause':'play')}</button>
        <button onclick="deleteKey(${k.id})" class="text-red-500 hover:text-red-700" data-tooltip="删除 Key" data-tooltip-description="删除后该 Key 立即无法调用网关，用量记录保留。"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></span></button>
      </td>
    </tr>`;
}
async function loadKeys(){
  const r = await api("/api/keys"); if(!r.ok) return; const d = await r.json();
  _keyData = d.items || [];
  renderKeyPage(1);
  try {
    const policy = await safeJson(await api('/api/credits/selection-policy'));
    if (policy.ok && $('#keySelectionPolicy')) $('#keySelectionPolicy').textContent =
      (policy.data.modes || []).find(x => x.value === policy.data.mode)?.label || '账号调度策略';
  } catch (_) {}
}
/* 对外对接信息：暴露 baseurl + 启用模型列表，供把 Key 共享给外部使用 */
async function loadShareInfo() {
  const selected = uiSelectValue('shareAddress');
  const choices = new Map([[location.origin, '当前访问 · ' + location.host]]);
  let status = '';
  try {
    const response = await api('/api/app/network');
    if (!response.ok) throw new Error('无法读取内网地址');
    const network = await response.json();
    const port = location.port || (['localhost', '127.0.0.1'].includes(location.hostname) ? network.port : '');
    const suffix = port ? ':' + port : '';
    choices.set('http://127.0.0.1' + suffix, '本机 · 127.0.0.1' + suffix);
    for (const ip of network.lan_ips || []) choices.set('http://' + ip + suffix, '局域网 · ' + ip + suffix);
    if (!(network.lan_ips || []).length) status = '未检测到内网 IPv4，请检查 Wi-Fi 或有线网络连接。';
  } catch (_) { status = '内网地址读取失败，可点击刷新重试。'; }
  const picker = $('#shareAddressWrap');
  if (picker) {
    const value = choices.has(selected) ? selected : location.origin;
    picker.innerHTML = uiSelectHTML('shareAddress', {value, options:[...choices].map(([value,label])=>({value,label})), onChange:renderShareAddress});
    initUISelects([['shareAddress','连接地址']]);
    renderShareAddress(value);
  }
  if ($('#shareNetworkStatus')) $('#shareNetworkStatus').textContent = status;
  try {
    // 可用模型必须**按模型聚合**：同一个模型在各平台有不同 system 名
    // （hy3 / dmodel / spark-x2.6…），平铺会把同一模型重复列好几次。
    // 这里只显示一个 chip，悬停展开各平台的具体 model_id 与倍率。
    const r = await api("/api/models/aggregate");
    const { ok, data } = await safeJson(r);
    if (!ok) return;
    const groups = (data.items || []).filter(item => item.enabled_any !== false);
    const box = $("#shareModels");
    if ($("#shareModelCount")) {
      $("#shareModelCount").textContent = groups.length;
    }
    if (box) {
      box.innerHTML = groups.length
        ? groups.map(item => {
            const platforms = (item.platforms || []).filter(p => p.enabled !== false);
            // model_id 点一下就能复制 —— 用户经常要「用某个平台的那个 id」。
            // 因为不同平台常有**同名 id**（dfmodel / hy3 这种），
            // 所以每行都标明归属平台，避免复制错。
            // 多平台同名时，光复制 model_id 分不清落点。这里直接把
            // 「带平台后缀」的名字作为可复制值（`xxx-workbuddy`），
            // 用户粘到 model 字段就固定走那个平台，不用再加 header。
            // 单平台模型没必要加后缀（加了也能用，但名字更长）。
            const needSuffix = platforms.length > 1;
            const detail = platforms.map(p => {
              const pid = p.platform_id || p.platform;
              const copyValue = needSuffix ? `${p.model_id}-${pid}` : p.model_id;
              return `<div class="model-chip-row">
                <span>${esc(p.platform_label || p.platform)}</span>
                <code data-copy-model="${esc(copyValue)}"
                      data-tooltip="点击复制${needSuffix ? " · 带平台后缀，直接指定该平台" : ""}"
                >${esc(needSuffix ? copyValue : p.model_id)}</code>
                <span>${p.multiplier == null ? "—"
                  : (Number(p.multiplier) === 0 ? "FREE" : "×" + p.multiplier)}</span>
              </div>`;
            }).join("");
            return `<span class="model-chip-wrap">
              <span class="model-chip"><b>${esc(item.name)}</b>
                ${platforms.length > 1
                  ? `<span class="model-chip-more">${platforms.length} 平台</span>` : ""}
              </span>
              <span class="model-chip-pop">
                <div class="model-chip-pop-head">
                  <b>${esc(item.name)}</b>
                  <span>共 ${platforms.length} 个平台可调度</span>
                </div>
                ${detail || "<div>暂无平台明细</div>"}
                <div class="model-chip-hint">
                  点 ID 复制；带平台后缀的名字会**直接路由到该平台**
                </div>
              </span>
            </span>`;
          }).join("")
        : '<span class="text-xs text-slate-400">未配置模型白名单（放行全部模型）</span>';
      if (box) {
        box.querySelectorAll("[data-copy-model]").forEach(el => {
          el.addEventListener("click", event => {
            event.stopPropagation();
            // copyText() 期望的是**选择器**，不是文本内容 —— 直接传文字
            // 会让 $(sel) 返回 null，函数静默 return，于是「提示成功但没复制」。
            copyRawText(el.dataset.copyModel);
          });
        });
      }
    }
  } catch (e) {}
}
function renderShareAddress(origin) {
  // 两个 SDK 对 base_url 的约定不同，必须分别给出：
  //   OpenAI 系    -> origin + "/v1"（SDK 自己拼 /chat/completions）
  //   Anthropic 系 -> origin        （SDK 自己拼 /v1/messages，再带 /v1 会变成 /v1/v1/messages）
  // 两者共用同一批 Key 与配额。
  const base = origin + "/v1";
  if ($("#shareBaseUrl")) $("#shareBaseUrl").textContent = base;
  if ($("#shareBaseUrlClaude")) $("#shareBaseUrlClaude").textContent = origin;
  if ($('#shareCurlAudio')) $('#shareCurlAudio').textContent = [
    `curl "${base}/audio/transcriptions"`,
    '  -H "Authorization: Bearer <你的 Key>"',
    '  -F "file=@recording.webm"',
    '  -F "model=workbuddy-asr"',
    '  -F "response_format=json"'
  ].join(' \\\n');
  if ($('#sharePythonAudio')) $('#sharePythonAudio').textContent = [
    'from openai import OpenAI',
    `client = OpenAI(api_key="<你的 Key>", base_url="${base}")`,
    'with open("recording.webm", "rb") as audio:',
    '    result = client.audio.transcriptions.create(model="workbuddy-asr", file=audio)',
    'print(result.text)'
  ].join('\n');
  if ($('#sharePythonImages')) $('#sharePythonImages').textContent = [
    'from openai import OpenAI',
    `client = OpenAI(api_key="<你的 Key>", base_url="${base}")`,
    'result = client.images.generate(model="hunyuan-image-alpha", prompt="白色背景上的蓝色圆形", n=1)',
    'print(result.data[0].url)',
    'with open("input.png", "rb") as image:',
    '    edited = client.images.edit(model="hunyuan-image-alpha", image=image, prompt="把圆形改成绿色")',
    'print(edited.data[0].url)'
  ].join('\n');
  if ($('#shareCurlVideo')) $('#shareCurlVideo').textContent = [
    '# 1) 创建任务：立即返回 queued，不阻塞等待生成',
    `curl "${base}/videos"`,
    '  -H "Authorization: Bearer <你的 Key>"',
    '  -H "Content-Type: application/json"',
    '  -d \'{"model":"kling-video-v3","prompt":"一只猫在弹钢琴","seconds":"4","size":"1280x720"}\'',
    '',
    '# 2) 轮询（用上一步返回的 id），直到 status=completed',
    `curl "${base}/videos/<视频 ID>" -H "Authorization: Bearer <你的 Key>"`,
    '',
    '# 3) 下载 MP4',
    `curl "${base}/videos/<视频 ID>/content" -H "Authorization: Bearer <你的 Key>" -o output.mp4`
  ].join(' \\\n');
  if ($('#sharePythonVideo')) $('#sharePythonVideo').textContent = [
    'import time',
    'from openai import OpenAI',
    `client = OpenAI(api_key="<你的 Key>", base_url="${base}")`,
    '',
    'video = client.videos.create(',
    '    model="kling-video-v3",',
    '    prompt="一只猫在弹钢琴",',
    '    seconds="4",',
    '    size="1280x720",',
    ')',
    'print(video.id, video.status)          # queued',
    '',
    'while video.status not in ("completed", "failed"):',
    '    time.sleep(5)',
    '    video = client.videos.retrieve(video.id)',
    '',
    'if video.status == "completed":',
    '    content = client.videos.download_content(video.id)',
    '    content.write_to_file("output.mp4")',
    '    print("已保存 output.mp4")',
    '',
    '# 图生视频：传入参考图（HTTPS 或 data: URL）',
    'video = client.videos.create(model="kling-video-v3",',
    '                             input_reference="https://example.com/frame.png",',
    '                             prompt="镜头缓慢推近")'
  ].join('\n');
  if ($("#shareCurl")) {
    $("#shareCurl").textContent =
      "curl " + base + "/chat/completions \\\n" +
      '  -H "Authorization: Bearer <你的 Key>" \\\n' +
      '  -H "Content-Type: application/json" \\\n' +
      "  -d '{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}'";
  }
  if ($("#shareCurlClaude")) {
    $("#shareCurlClaude").textContent =
      "curl " + origin + "/v1/messages \\\n" +
      '  -H "x-api-key: <你的 Key>" \\\n' +
      '  -H "anthropic-version: 2023-06-01" \\\n' +
      '  -H "Content-Type: application/json" \\\n' +
      "  -d '{\"model\":\"claude-sonnet-4-5-20250929\",\"max_tokens\":1024," +
      "\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}'";
  }
}
function renderKeyPage(p) {
  const term = (_keyTerm = ($("#keySearch") ? $("#keySearch").value : "").trim().toLowerCase());
  const data = term ? _keyData.filter(k => (k.name||"").toLowerCase().includes(term)) : _keyData;
  const total = data.length, totalPages = Math.max(1, Math.ceil(total / PS));
  p = Math.min(Math.max(1, p), totalPages);
  const slice = data.slice((p - 1) * PS, p * PS);
  $("#keyBody").innerHTML = slice.map(keyRow).join("") ||
    `<tr><td colspan="8" class="px-4 py-8 text-center text-slate-400">${term ? "无匹配的 Key" : "还没有 Key，点「创建 Key」"}</td></tr>`;
  $("#keyPager").innerHTML = pagerHtml(total, p, totalPages, "renderKeyPage");
}
async function keyAccountOptions(key) {
  const r = await api("/api/accounts");
  const { ok, data } = await safeJson(r);
  if (!ok) throw new Error("账号列表加载失败，请重试");
  const options = [{ value: "0", label: "不绑定（使用公共账号池）" }].concat(
    (data.items || []).filter(a => !a.bound_key_id || a.bound_key_id === key?.id)
      .map(a => ({ value: String(a.id), label: `${a.name || a.uid || "账号"} #${a.id} · ${a.balance_remain} 积分${a.status !== "active" ? " · 已禁用" : ""}` })));
  if (key?.account_id && !options.some(o => o.value === String(key.account_id)))
    options.push({ value: String(key.account_id), label: `原绑定账号 #${key.account_id}（不存在）` });
  return options;
}
/**
 * 独占平台下拉（空 = 不限制）。
 *
 * 与账号多选联动：选了平台，账号列表只显示该平台的。
 */
function keyPlatformSelect(id, platforms, value) {
  const options = [{ value: "", label: "不限制（全部平台）" }].concat(
    (platforms || []).map(item => ({
      value: String(item.storage || item.id || "").toLowerCase(),
      label: item.label || item.storage || item.id,
    })).filter(item => item.value));
  return `<div class="mb-2">
    <label class="text-xs text-slate-500">独占平台（可选）</label>
    <div class="mt-1">${uiSelectHTML(id, {
      value: String(value || ""), options,
      // uiSelectHTML 读的是 `onChange`（驼峰），写 `onchange` 会被忽略
      onChange: onKeyPlatformChange,
    })}</div>
    <p class="text-[11px] text-slate-400 mt-1">绑定后该 Key 只在这个平台的账号池里选号；请求头 <code>X-Platform</code> 仍可覆盖。</p>
  </div>`;
}

/**
 * 独占账号**选择器**：select 形态 + 搜索筛选（可多选）。
 *
 * 为什么不再用裸 checkbox 列表：平台一多、账号一多，长列表会把弹窗撑爆，
 * 也看不出「已选了几个」。这里做成下拉面板：触发器显示已选摘要，
 * 面板里带搜索框，勾选即时写回隐藏 input（提交逻辑只读隐藏值）。
 *
 * @param {string} prefix   "k"（创建）/ "ek"（编辑）
 */
function keyAccountPicker(prefix, accounts, selected, platform) {
  const picked = new Set((selected || []).map(Number));
  const rows = (accounts || []).filter(item => {
    if (!platform) return true;
    return String(item.platform || "").toLowerCase() === platform;
  });
  const summary = picked.size
    ? `已选 ${picked.size} 个账号 · 只用这些，不换号`
    : "不限制（使用公共账号池）";
  const list = rows.length ? rows.map(item => {
    const on = picked.has(Number(item.id));
    const name = esc(item.name || item.uid || "账号") + " #" + item.id;
    const sub = [
      platform ? "" : (item.platform || ""),
      `${item.balance_remain ?? 0} 积分`,
      item.status !== "active" ? "已禁用" : "",
    ].filter(Boolean).map(esc).join(" · ");
    return `<label class="key-picker-row" data-search="${esc(
        `${item.name || ""} ${item.uid || ""} ${item.id} ${item.platform || ""}`.toLowerCase())}">
      <input type="checkbox" value="${item.id}" ${on ? "checked" : ""}
             data-acc-prefix="${prefix}" onchange="keyAccChange('${prefix}')">
      <span class="key-picker-row-main">
        <span class="key-picker-row-name">${name}</span>
        <span class="key-picker-row-sub">${sub || "—"}</span>
      </span>
    </label>`;
  }).join("") : `<p class="sentinel-empty" style="padding:8px 6px">${
    platform ? "该平台下没有可用账号" : "没有可用账号"}</p>`;
  return `<div class="mb-2 key-picker" id="${prefix}AccountPicker">
    <label class="text-xs text-slate-500">独占绑定账号（可选，多选）</label>
    <div class="mt-1">
      <button type="button" class="key-picker-trigger"
              onclick="keyAccToggle('${prefix}')">
        <span class="key-picker-summary${picked.size ? " has-value" : ""}"
              id="${prefix}AccountSummary">${esc(summary)}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
             stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="key-picker-pop" id="${prefix}AccountPop" hidden>
        <input class="key-picker-search" id="${prefix}AccountSearch"
               placeholder="搜索账号 / UID / 平台" autocomplete="off"
               oninput="keyAccFilter('${prefix}', this.value)">
        <div class="key-picker-list" id="${prefix}AccountList">${list}</div>
        <div class="key-picker-foot">
          <span>${rows.length} 个可选账号</span>
          <button type="button" class="key-picker-clear"
                  onclick="keyAccClear('${prefix}')">清空选择</button>
        </div>
      </div>
      <input type="hidden" id="${prefix}AccountIds"
             value="${JSON.stringify([...picked])}">
    </div>
    <p class="text-[11px] text-slate-400 mt-1">不勾选 = 使用公共账号池；勾选后该 Key 只用这些账号，账号不可用时不换号。</p>
  </div>`;
}

function keyAccToggle(prefix) {
  const pop = document.getElementById(prefix + "AccountPop");
  if (!pop) return;
  const willOpen = pop.hidden;
  // 同一弹窗里只开一个
  document.querySelectorAll(".key-picker-pop").forEach(node => { node.hidden = true; });
  pop.hidden = !willOpen;
  if (willOpen) {
    // 弹窗本体是 max-h-[88vh] + overflow-y-auto：面板若用 absolute 定位，
    // 一定会被滚动容器裁掉。
    // 因此改成 fixed 定位，并按触发器的实际位置贴上去，再按视口剩余空间
    // 决定向下还是向上展开。滚动/缩放时重新贴一次。
    keyAccPlace(prefix);
    const search = document.getElementById(prefix + "AccountSearch");
    if (search) { search.value = ""; keyAccFilter(prefix, ""); search.focus(); }
  }
}

/** 把账号面板贴到触发器下方（空间不够则翻到上方），并夹在视口内。 */
function keyAccPlace(prefix) {
  const pop = document.getElementById(prefix + "AccountPop");
  if (!pop || pop.hidden) return;
  const trigger = pop.parentElement && pop.parentElement.querySelector(".key-picker-trigger");
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const margin = 8;
  // 面板不必和触发器同宽：它是「列表 + 搜索」，铺满 1000px 后每行留白太多，
  // 反而看不出层级。上限 440px，左边缘与触发器对齐并夹在视口内。
  const width = Math.min(rect.width, 440, window.innerWidth - margin * 2);
  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  // 面板理想高度：搜索框 38 + 列表 240 + 脚注 28 + 内边距 16 ≈ 340
  const ideal = 340;
  const flip = spaceBelow < Math.min(ideal, 240) && spaceAbove > spaceBelow;
  const space = flip ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(170, Math.min(ideal, space));
  pop.style.position = "fixed";
  pop.style.width = width + "px";
  pop.style.left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin) + "px";
  pop.style.maxHeight = maxHeight + "px";
  pop.classList.toggle("flip", flip);
  if (flip) {
    // 关键：base 样式里有 `top:0`，不显式写 `auto` 的话 top 会压过 bottom，
    // 面板被钉在视口顶部（实测矮视口下面板跑到 y=0，完全错位）。
    pop.style.top = "auto";
    pop.style.bottom = (window.innerHeight - rect.top + 6) + "px";
  } else {
    pop.style.bottom = "auto";
    pop.style.top = (rect.bottom + 6) + "px";
  }
}

// 弹窗内滚动 / 窗口缩放时重新定位（面板是 fixed，不跟随滚动会飘走）
(function () {
  function reposition() {
    document.querySelectorAll(".key-picker-pop").forEach(node => {
      if (!node.hidden) keyAccPlace(node.id.replace(/AccountPop$/, ""));
    });
  }
  window.addEventListener("resize", reposition);
  document.addEventListener("scroll", reposition, true);
})();

function keyAccFilter(prefix, term) {
  const query = String(term || "").trim().toLowerCase();
  document.querySelectorAll(`#${prefix}AccountList .key-picker-row`).forEach(row => {
    row.style.display = !query || (row.dataset.search || "").includes(query) ? "" : "none";
  });
}

function keyAccChange(prefix) {
  const ids = [...document.querySelectorAll(`#${prefix}AccountList input[type="checkbox"]:checked`)]
    .map(node => Number(node.value)).filter(value => Number.isFinite(value) && value > 0);
  const hidden = document.getElementById(prefix + "AccountIds");
  if (hidden) hidden.value = JSON.stringify(ids);
  const summary = document.getElementById(prefix + "AccountSummary");
  if (summary) {
    summary.textContent = ids.length
      ? `已选 ${ids.length} 个账号 · 只用这些，不换号`
      : "不限制（使用公共账号池）";
    summary.classList.toggle("has-value", ids.length > 0);
  }
}

function keyAccClear(prefix) {
  document.querySelectorAll(`#${prefix}AccountList input[type="checkbox"]`)
    .forEach(node => { node.checked = false; });
  keyAccChange(prefix);
}

document.addEventListener("click", event => {
  if (event.target.closest(".key-picker")) return;
  document.querySelectorAll(".key-picker-pop").forEach(node => { node.hidden = true; });
});

/** 聚合开关（默认开）。 */
function keyAggregateSwitch(value, inputId) {
  const on = value !== false;
  const id = inputId || "kAggregate";
  return `<label class="ui-check mb-2">
    <input id="${id}" type="checkbox" ${on ? "checked" : ""}>
    <span>
      <strong>聚合模型</strong>
      <span class="ui-check-hint">开启后模型列表按「同模型跨平台」合并，调用聚合名可由网关挑平台转发。</span>
    </span>
  </label>`;
}

function keyAccountSelect(id, options, value = 0) {
  return `<div class="mb-3"><label class="text-xs text-slate-500">独占绑定账号（可选）</label>
    <div class="mt-1">${uiSelectHTML(id, { value: String(value || 0), options })}</div>
    <p class="text-[11px] text-slate-400 mt-1">绑定后公共池跳过该账号；此 Key 仅使用该账号的积分和模型权益，账号不可用时不会换到其他账号。停用 Key 保留绑定，解绑或删除 Key 释放账号。</p></div>`;
}
/** 拉平台列表 + 全平台账号（Key 表单用）。 */
async function keyFormData() {
  let platforms = [];
  let accounts = [];

  // 1) 平台列表：按 storage_platform 去重（trae-cn/trae-intl 同为 trae），
  //    保留每个 storage 的第一个 label。
  try {
    const r = await api("/api/platforms");
    const { ok, data } = await safeJson(r);
    if (ok && data && Array.isArray(data.items)) {
      const byStorage = new Map();
      for (const item of data.items) {
        const storage = String(
          item.storage_platform || item.id || "").toLowerCase();
        if (!storage || byStorage.has(storage)) continue;
        byStorage.set(storage, {
          storage,
          label: item.label || storage,
        });
      }
      platforms = [...byStorage.values()];
    }
  } catch (error) {
    console.warn("[keyForm] 平台列表加载失败", error);
  }

  // 2) 全平台账号：显式带 all_platforms=1，否则只回当前平台的
  try {
    const r = await api("/api/accounts?all_platforms=1");
    const { ok, data } = await safeJson(r);
    if (ok && data && Array.isArray(data.items)) accounts = data.items;
  } catch (error) {
    console.warn("[keyForm] 账号列表加载失败", error);
  }

  return { platforms, accounts };
}

/** 平台切换时重渲染账号选择器。 */
async function onKeyPlatformChange() {
  // 创建弹窗用 kPlatform/kAccountsHost，编辑弹窗用 ekPlatform/ekAccountsHost。
  // 哪个存在就操作哪个（两个弹窗不会同时打开）。
  const isEdit = Boolean(document.querySelector("#ekPlatform"));
  const prefix = isEdit ? "ek" : "k";
  // ⚠️ `uiSelectHTML` 是自定义组件，值在模块内的映射表里，
  // **DOM 上读不到 `.value`** —— 必须用项目自己的 `uiSelectValue()`。
  const platform = String(
    uiSelectValue(isEdit ? "ekPlatform" : "kPlatform") || "").toLowerCase();
  const host = document.querySelector(isEdit ? "#ekAccountsHost" : "#kAccountsHost");
  if (!host) return;
  const state = window._keyFormState || {};
  const picked = keySelectedAccountIds(prefix);
  host.innerHTML = keyAccountPicker(prefix, state.accounts || [], picked, platform);
  window._keyFormState = { ...state, platform, picked };
}

/** 收集多选账号 id（从隐藏 input 读，选择器自己维护它）。 */
function keySelectedAccountIds(prefix) {
  const hidden = document.getElementById((prefix || "k") + "AccountIds");
  if (!hidden) return [];
  try {
    const value = JSON.parse(hidden.value || "[]");
    return Array.isArray(value)
      ? value.map(Number).filter(item => Number.isFinite(item) && item > 0)
      : [];
  } catch (error) {
    return [];
  }
}

async function openAddKey(){
  const formData = await keyFormData();
  window._keyFormState = { accounts: formData.accounts, platform: "", picked: [] };
  // 拉一次分组列表填下拉；失败不阻塞创建（下拉退化为「不限制」）
  let groups = [];
  try {
    const r = await api("/api/groups");
    const { ok, data } = await safeJson(r);
    if (ok) groups = data.items || [];
  } catch (e) { /* 忽略：无分组时仍可创建不限制的 Key */ }


  openModal(`
    <h3 class="font-bold mb-3"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/></svg></span> 创建 API Key</h3>
    <input id="kName" class="w-full border rounded-lg px-3 py-2 mb-2 text-sm" placeholder="名称（可选）" />
    <label class="ui-check mb-2"><input id="kUnlimited" type="checkbox" checked
      onchange="if(this.checked) document.getElementById('kLimit').value=''" />
      <span><strong>不限额（∞，默认）</strong>
        <span class="ui-check-hint">取消后可填写积分上限；0 表示零额度。</span></span></label>
    <input id="kLimit" type="number" min="0" class="w-full border rounded-lg px-3 py-2 mb-2 text-sm" placeholder="留空不限额；填写 0 表示零额度" oninput="document.getElementById('kUnlimited').checked=this.value.trim()===''" />
    <input id="kMaxConcurrent" type="number" min="0" class="w-full border rounded-lg px-3 py-2 mb-1 text-sm" placeholder="并发上限（空=全局，0=不限）" data-tooltip="key 并发≠账号在途上限（ADMIN_POOL_MAX_IN_FLIGHT）" />
    <p class="text-[11px] text-slate-400 mb-2">并发：空=全局默认；0=不限；N=此 Key 所有对话合计最多 N 个在途请求，每个对话可同时发出多个请求。</p>
    <input id="kRatePerMinute" type="number" min="0" class="w-full border rounded-lg px-3 py-2 mb-1 text-sm" placeholder="每分钟请求数（空=全局，0=不限）" />
    <p class="text-[11px] text-slate-400 mb-2">频率与并发独立。提高并发不会提高每分钟请求额度；积分不限额也不会解除流量限制。</p>
    <div class="mb-2">
      <label class="text-xs text-slate-500">模型分组（可选）</label>
      <div class="mt-1">${uiSelectHTML("kGroup", {
        value: "0",
        options: [{ value: "0", label: "不限制（全部可用模型）" }].concat(
          groups.map(g => ({ value: String(g.id), label: `${g.name}（${g.effective_count} 个模型）` }))),
      })}</div>
      <p class="text-[11px] text-slate-400 mt-1">选择后该 Key 只能调用组内模型，调用组外模型返回 403。</p>
    </div>
    ${keyAggregateSwitch(false)}
    ${keyPlatformSelect("kPlatform", formData.platforms, "")}
    <div id="kAccountsHost">
      ${keyAccountPicker("k", formData.accounts, [], "")}
    </div>
    <input id="kNote" class="w-full border rounded-lg px-3 py-2 mb-2 text-sm" placeholder="备注（可选）" />
    <div class="flex justify-end gap-2 mt-2">
      <button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">取消</button>
      <button onclick="submitAddKey()" class="px-3 py-1.5 rounded-lg btn-primary">创建</button>
    </div>`);
}
async function submitAddKey(){
  const unlimited = $("#kUnlimited").checked || $("#kLimit").value.trim() === "";
  const mcRaw = $("#kMaxConcurrent").value;
  const rpmRaw = $("#kRatePerMinute").value;
  const body = { name:$("#kName").value||"", unlimited, credit_limit: Number($("#kLimit").value||0), note:$("#kNote").value||"", group_id: Number(uiSelectValue("kGroup")||0),
    // 新控件：聚合开关 / 独占平台 / 多选账号
    aggregate: ($("#kAggregate")||{}).checked !== false,
    platform: String(uiSelectValue("kPlatform") || "").toLowerCase(),
    account_ids: keySelectedAccountIds("k"),
    max_concurrent: mcRaw === "" ? null : Number(mcRaw), rate_per_minute: rpmRaw === "" ? null : Number(rpmRaw) };
  const r = await api("/api/keys",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const d = await r.json().catch(()=>({}));
  if(r.ok){
    openModal(`<h3 class="font-bold mb-3 text-emerald-600"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span> Key 已创建</h3>
      <p class="text-xs text-slate-500 mb-2">可随时在列表中点击「眼睛」图标再次查看：</p>
      <div class="flex gap-2"><input id="newKey" readonly class="w-full border rounded-lg px-2 py-2 text-xs font-mono" value="${esc(d.key)}"><button onclick="copyText('#newKey')" class="px-3 bg-wb text-white rounded-lg text-sm">复制</button></div>
      <div class="flex justify-end mt-4"><button onclick="closeModal();loadKeys()" class="px-3 py-1.5 rounded-lg border text-sm">完成</button></div>`);
  } else { toast("创建失败：" + (d.detail || "未知错误"),"err"); }
}
async function viewKeyFull(id, name){
  openModal(`<h3 class="font-bold mb-1"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg></span> 查看 Key — ${esc(name)}</h3><p class="text-xs text-slate-400 mb-3">加载中...</p><div id="keyFullBody"></div>
    <div class="flex justify-end mt-4"><button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">关闭</button></div>`);
  try{
    const r = await api("/api/keys/"+id+"/view");
    const { ok, data:d } = await safeJson(r);
    if(!r.ok){ $("#keyFullBody").innerHTML=`<p class="text-red-500 text-sm">读取失败: ${esc(d.detail||"")}</p>`; return; }
    $("#keyFullBody").innerHTML = `
      <div class="mb-2 text-xs text-slate-400">创建于 ${fmtTime(d.created_at)}</div>
      <div class="flex gap-2"><input readonly id="fullKeyValue" class="w-full border rounded-lg px-3 py-2 text-sm font-mono bg-slate-50" value="${esc(d.key)}"><button onclick="copyText('#fullKeyValue')" class="px-3 bg-wb text-white rounded-lg text-sm shrink-0">复制</button></div>`;
  } catch(e){ $("#keyFullBody").innerHTML=`<p class="text-red-500 text-sm">异常: ${esc(e.message)}</p>`; }
}
async function viewKeyUsage(id, name){
  openModal(`<h3 class="font-bold mb-1"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"/><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/></svg></span> Key 用量 — ${esc(name)}</h3><p class="text-xs text-slate-400 mb-3">加载中...</p><div id="keyUsageBody"></div>
    <div class="flex justify-end mt-4"><button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">关闭</button></div>`);
  try{
    const r = await api("/api/keys/"+id+"/usage");
    const { ok, data:d } = await safeJson(r);
    if(!ok){ $("#keyUsageBody").innerHTML=`<p class="text-red-500 text-sm">读取失败: ${esc(d.detail||"")}</p>`; return; }
    const pct = d.usage_percent ?? null;
    const barColor = d.unlimited ? 'bg-emerald-500' : (pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-emerald-500');
    $("#keyUsageBody").innerHTML = `
      <div class="grid grid-cols-2 gap-3 mb-4">
        <div class="p-3 bg-slate-50 rounded-lg"><div class="text-xs text-slate-400">限额</div><div class="text-lg font-bold">${d.unlimited?'∞（无限制）':d.credit_limit}</div></div>
        <div class="p-3 bg-slate-50 rounded-lg"><div class="text-xs text-slate-400">已用</div><div class="text-lg font-bold">${d.credit_used}</div></div>
        <div class="p-3 bg-slate-50 rounded-lg"><div class="text-xs text-slate-400">剩余</div><div class="text-lg font-bold ${d.unlimited?'text-emerald-600':Number(d.credit_remaining)<=0?'text-red-500':'text-emerald-600'}">${d.unlimited?'∞':d.credit_remaining}</div></div>
        <div class="p-3 bg-slate-50 rounded-lg"><div class="text-xs text-slate-400">使用率</div><div class="text-lg font-bold">${pct!==null?pct+'%':'N/A'}</div></div>
      </div>
      ${!d.unlimited ? `<div class="mb-2"><div class="w-full h-3 bg-slate-200 rounded-full overflow-hidden"><div class="h-full ${barColor} transition-all" style="width:${Math.min(pct||0,100)}%"></div></div></div>` : ''}
      <div class="text-xs text-slate-400">状态: ${d.status==='active'?'<span class="text-emerald-600">正常</span>':'<span class="text-red-500">已停用</span>'} · 创建: ${fmtTime(d.created_at)}</div>`;
  } catch(e){ $("#keyUsageBody").innerHTML=`<p class="text-red-500 text-sm">异常: ${esc(e.message)}</p>`; }
}
/* 编辑 Key：名称 / 分组 / 限额 / 重置已用 */
async function editKey(id){
  const k = _keyData.find(x => x.id === id);
  if (!k) { toast("Key 不存在", "err"); return; }

  let accountOptions;
  try { accountOptions = await keyAccountOptions(k); } catch(e) { toast(e.message, "err"); return; }
  // 平台列表 + 全平台账号（独占平台 / 多选账号用）
  const formData = await keyFormData();
  window._keyFormState = {
    accounts: formData.accounts,
    platform: k.platform || "",
    picked: (k.account_ids || []).map(Number),
  };
  // 分组下拉数据；拉取失败也不阻塞编辑（退化为仅「不限制」）
  let groups = [];
  try {
    const r = await api("/api/groups");
    const { ok, data } = await safeJson(r);
    if (ok) groups = data.items || [];
  } catch (e) { /* 忽略 */ }

  const groupOpts = [{ value: "0", label: "不限制（全部可用模型）" }]
    .concat(groups.map(g => ({ value: String(g.id), label: `${g.name}（${g.effective_count} 个模型）` })));

  openModal(`<h3 class="font-bold mb-3"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/></svg></span> 编辑 API Key</h3>
    <label class="block text-xs text-slate-500 mb-1">名称</label>
    <input id="ekName" class="w-full border rounded-lg px-3 py-2 mb-3 text-sm" placeholder="名称" value="${esc(k.name || '')}" />

    <label class="block text-xs text-slate-500 mb-1">模型分组</label>
    <div class="mb-3">${uiSelectHTML("ekGroup", {
      value: String(k.group_id || 0), options: groupOpts,
    })}</div>
    <p class="text-[11px] text-slate-400 -mt-2 mb-3">不限制 = 可用全部启用模型；选了分组则只能调用组内模型。</p>

    ${keyAggregateSwitch(k.aggregate !== false, "ekAggregate")}
    ${keyPlatformSelect("ekPlatform", formData.platforms, k.platform || "")}
    <div id="ekAccountsHost">
      ${keyAccountPicker("ek", formData.accounts, k.account_ids || [], k.platform || "")}
    </div>
    <label class="block text-xs text-slate-500 mb-1">积分限额（credits）</label>
    <input id="ekLimit" type="number" min="0" class="w-full border rounded-lg px-3 py-2 mb-3 text-sm" value="${k.unlimited ? "" : k.credit_limit}" placeholder="留空不限额；填写 0 表示零额度" oninput="document.getElementById('ekUnlimited').checked=this.value.trim()===''" />
    <label class="ui-check mb-2"><input id="ekUnlimited" type="checkbox" onchange="if(this.checked) document.getElementById('ekLimit').value=''" ${k.unlimited ? "checked" : ""} />
      <span><strong>不限额（∞）</strong>
        <span class="ui-check-hint">取消后可填写积分上限。</span></span></label>
    <label class="ui-check mb-2"><input id="ekReset" type="checkbox" />
      <span><strong>重置已用额度</strong>
        <span class="ui-check-hint">当前已用 ${k.credit_used}，勾选后归零（不影响历史日志）。</span></span></label>

    <label class="block text-xs text-slate-500 mb-1">并发上限</label>
    <input id="ekMaxConcurrent" type="number" min="0" class="w-full border rounded-lg px-3 py-2 mb-1 text-sm" value="${k.max_concurrent == null ? "" : k.max_concurrent}" placeholder="空=全局，0=不限" data-tooltip="key 并发≠账号在途上限（ADMIN_POOL_MAX_IN_FLIGHT）" />
    <p class="text-[11px] text-slate-400 mb-2">空=全局默认；0=不限；N=此 Key 所有对话合计最多 N 个在途请求，每个对话可同时发出多个请求。</p>
    <label class="block text-xs text-slate-500 mb-1">每分钟请求数</label>
    <input id="ekRatePerMinute" type="number" min="0" class="w-full border rounded-lg px-3 py-2 mb-1 text-sm" value="${k.rate_per_minute == null ? "" : k.rate_per_minute}" placeholder="空=全局，0=不限" />
    <p class="text-[11px] text-slate-400 mb-2">频率与并发独立。提高并发不会提高每分钟请求额度；积分不限额也不会解除流量限制。</p>

    <div class="flex justify-end gap-2 mt-2"><button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">取消</button>
    <button onclick="submitEditKey(${id})" class="px-3 py-1.5 rounded-lg btn-primary">保存</button></div>`);
}

async function submitEditKey(id){
  const name = ($("#ekName").value || "").trim();
  if (!name) { toast("名称不能为空", "err"); return; }
  const mcRaw = $("#ekMaxConcurrent").value;
  const rpmRaw = $("#ekRatePerMinute").value;
  const body = {
    name,
    group_id: Number(uiSelectValue("ekGroup") || 0),
    // 新控件：聚合 / 独占平台 / 多选账号
    aggregate: ($("#ekAggregate")||{}).checked !== false,
    platform: String(uiSelectValue("ekPlatform") || "").toLowerCase(),
    account_ids: keySelectedAccountIds("ek"),
    credit_limit: Number($("#ekLimit").value || 0),
    unlimited: $("#ekUnlimited").checked || $("#ekLimit").value.trim() === "",
    max_concurrent: mcRaw === "" ? null : Number(mcRaw),
    rate_per_minute: rpmRaw === "" ? null : Number(rpmRaw),
    reset_used: $("#ekReset").checked,
  };
  const r = await api("/api/keys/"+id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const { ok, data: d } = await safeJson(r);
  if (!ok) { toast("保存失败: " + (d.detail || "未知错误"), "err"); return; }
  closeModal(); toast("已保存"); loadKeys(); loadGroups(); loadAccounts();
}
async function toggleKeyStatus(id, button) {
  const key = _keyData.find(item => item.id === id);
  if (!key) return;
  const status = key.status === 'active' ? 'revoked' : 'active';
  if (button) button.disabled = true;
  try {
    const response = await api('/api/keys/' + id, {method: 'PATCH',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status})});
    const result = await safeJson(response);
    if (!result.ok) { toast(result.data.detail || '状态更新失败', 'err'); return; }
    toast(status === 'active' ? 'Key 已启用' : 'Key 已停用，排队请求将停止，已发往上游的请求继续完成');
    await loadKeys();
  } catch (error) {
    toast('状态更新失败：' + (error.message || error), 'err');
  } finally {
    if (button) button.disabled = false;
  }
}
async function deleteKey(id){ if(!await uiConfirm({message:"确认删除该 Key？此操作不可恢复。如需临时停止调用，请使用停用按钮。", title:"删除 API Key"}))return; const r=await api("/api/keys/"+id,{method:"DELETE"}); toast(r.ok?"已删除":"删除失败", r.ok?"ok":"err"); if(r.ok) loadKeys(); }

/* ==================== 模型配置 ==================== */
const MODEL_BUSY_LABELS = {idle:'空闲', normal:'空闲', busy:'轻微拥堵', congested:'极度拥堵', unavailable:'不可用', unknown:'未知'};
let _modelBusy = {}, _modelBusyTimer = null, _modelBusyLoading = false;
let _modelHealth = {}, _modelProbes = {}, _modelProbeBusy = false;
let _modelHealthLoading = null;
async function loadModelHealth(manual = false) {
  const button = $('#modelHealthRefresh');
  if (manual && button) { button.disabled = true; button.innerHTML = '<span class="wb-icon wb-ic-spin"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span>正在刷新…'; }
  try {
    if (!_modelHealthLoading) _modelHealthLoading = fetchModelHealth();
    await _modelHealthLoading;
    if (manual) toast('模型健康状态已刷新（最近 24 小时统计）');
  } catch (error) { toast(error.message, 'err'); }
  finally {
    _modelHealthLoading = null;
    if (manual && button) { button.disabled = false; button.innerHTML = '<span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg></span>刷新健康状态'; }
  }
}
async function fetchModelHealth() {
  try {
    const response = await api('/api/stats/model-health');
    if (!response.ok) throw new Error('无法读取模型健康状态');
    const result = await response.json();
    _modelHealth = Object.fromEntries((result.items || []).map(row => [row.model, row]));
    renderModelPage(_modelPage);
  } catch (error) { throw error; }
}
async function loadModelDescriptions() {
  try {
    const response = await api('/api/models/descriptions');
    if (!response.ok) return;
    const result = await response.json();
    const descriptions = new Map((result.items || []).map(m=>[m.model_id,m]));
    _modelData.forEach(m=>{ if(descriptions.has(m.model_id)) Object.assign(m,descriptions.get(m.model_id)); });
    renderModelPage(_modelPage);
  } catch (_) {}
}
function modelHealthCell(model) {
  const row = _modelHealth[model] || {}, probe = _modelProbes[model];
  const ms = value => value == null ? '—' : fmtDuration(value);
  const ttft = row.ttfb_ms || {};
  const tps = row.tps || {};
  const tpsText = tps.samples ? `TPS P50 ${tps.p50 ?? '—'} / 均值 ${tps.mean ?? '—'}` : 'TPS 暂无样本';
  const health = row.requests ? `成功 ${(100 * row.success_rate).toFixed(1)}% · ${row.requests} 次` : '暂无调用样本';
  return `<div class="model-health-cell"><span>${health}</span>
    <small data-tooltip="首字延迟 P50 / P95" data-tooltip-description="最近 24 小时成功调用的首字延迟，包含网络、上游排队与推理耗时。P95 与 P50 的差值反映请求延迟波动，不等同于网络 RTT 抖动。">首字 P50 ${ms(ttft.p50)} / P95 ${ms(ttft.p95)}</small>
    <small data-tooltip="吞吐 TPS" data-tooltip-description="输出 Token / 纯解码耗时（总耗时减首字延迟），仅统计解码段 ≥300ms 且折算不超过 300 tok/s 的成功请求（${tps.samples || 0} 个样本）。上游把整段一次性吐出的「突发」样本量不出真实出字速度，已剔除。">正常 ${tpsText}</small>
    <small data-tooltip="延迟波动" data-tooltip-description="P95 与 P50 的差值，反映请求延迟波动，不等同于网络 RTT 抖动。">延迟波动 ${ms(ttft.p95 == null ? null : ttft.p95 - ttft.p50)} · 可用 ${row.available_accounts ?? '—'} 账号</small>
    ${probe ? `<small data-tooltip="最近一次检测" data-tooltip-description="${esc(fmtTime(probe.observed_at))}">检测：${ms(probe.ttft_ms)} · 响应头 ${ms(probe.headers_ms)}</small><small data-tooltip="输出间隔波动" data-tooltip-description="增量到达间隔的标准差，包含模型生成与网络传输，不是纯网络抖动。">输出间隔波动 ${ms(probe.inter_delta_jitter_ms)}</small>` : ''}</div>`;
}
let _modelDisplay = {show_multiplier:true, show_busy:true, official_only:true};
function applyModelDisplay(options) {
  _modelDisplay = {..._modelDisplay, ...(options || {})};
  $('#modelShowMultiplier').checked = _modelDisplay.show_multiplier !== false;
  $('#modelShowBusy').checked = _modelDisplay.show_busy !== false;
  $('#modelOfficialOnly').checked = _modelDisplay.official_only !== false;
  const parts = ['model-id'];
  if (_modelDisplay.show_multiplier !== false) parts.push('×1.25');
  if (_modelDisplay.show_busy !== false) parts.push('空闲');
  $('#modelNamePreview').textContent = 'name: ' + parts.join(' · ');
}
async function saveModelDisplay() {
  const fields = [$('#modelShowMultiplier'), $('#modelShowBusy'), $('#modelOfficialOnly')];
  const options = {show_multiplier:fields[0].checked, show_busy:fields[1].checked, official_only:fields[2].checked};
  fields.forEach(field => { field.disabled = true; });
  try {
    const response = await api('/api/models/display', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(options)});
    if (!response.ok) throw new Error('展示设置保存失败');
    applyModelDisplay(await response.json());
    // 「官方同显」直接改变可见行集合，必须重绘表格（其余两个开关只改接口 name 文本）
    if (!$('#panel-models').classList.contains('hidden')) renderModelPage(_modelPage);
  } catch (error) { toast(error.message, 'err'); }
  finally { fields.forEach(field => { field.disabled = false; }); }
}
function modelBusyBadge(m) {
  const state = _modelBusy[m.model_id] || {};
  const level = Object.prototype.hasOwnProperty.call(MODEL_BUSY_LABELS, state.busy_level) ? state.busy_level : 'unknown';
  const tip = state.observed_at ? `上游采集：${fmtTime(state.observed_at)}${state.stale ? '（刷新失败，显示上次结果）' : ''}` : '尚未获取上游繁忙程度';
  return `<span class="model-busy ${level}" data-tooltip="上游繁忙程度 · ${esc(MODEL_BUSY_LABELS[level])}" data-tooltip-description="${esc(tip)}">${MODEL_BUSY_LABELS[level]}${state.stale && state.observed_at ? ' · 缓存' : ''}</span>`;
}
function scheduleModelBusy() {
  clearTimeout(_modelBusyTimer);
  _modelBusyTimer = null;
  if (document.hidden || !TOKEN || $('#panel-models').classList.contains('hidden')) return;
  _modelBusyTimer = setTimeout(async () => { await loadModelBusy(); scheduleModelBusy(); }, 50000);
}
async function loadModelBusy() {
  if (_modelBusyLoading || document.hidden || !TOKEN || $('#panel-models').classList.contains('hidden')) return;
  _modelBusyLoading = true;
  try {
    const r = await api('/api/models/busy');
    if (!r.ok) throw new Error('busy fetch failed');
    const d = await r.json();
    _modelBusy = Object.fromEntries((d.items || []).map(m => [m.model_id, {...m, observed_at:d.observed_at, stale:d.stale}]));
    renderModelPage(_modelPage);
  } catch(e) {
    Object.values(_modelBusy).forEach(m => { m.stale = true; });
    renderModelPage(_modelPage);
  } finally { _modelBusyLoading = false; }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadModelBusy();
  scheduleModelBusy();
});
function modelPromotionBadges(info) {
  return info.badges.map(b=>{
    const color=/^#[0-9a-f]{6}$/i.test(b.color||'')?b.color:'var(--brand-ink)';
    const label=b.shortLabel||b.label;
    const icon=String(b.label).includes('夜间')?'fa-moon':String(b.label).includes('免费')||String(b.label).includes('限免')?'fa-gift':'fa-tag';
    return `<span class="model-promotion-badge" style="--promotion-color:${color}">${ic(icon)}${esc(label)}</span>`;
  }).join('');
}
// Re-evaluate on minute boundaries, including when a hidden window resumes.
function refreshModelPromotions(){
  if(!document.hidden&&_modelData.length&&!$('#panel-models').classList.contains('hidden')) renderModelPage(_modelPage);
}
function schedulePromotionRefresh(){
  setTimeout(()=>{refreshModelPromotions();schedulePromotionRefresh();},60000-Date.now()%60000+50);
}
schedulePromotionRefresh();
window.addEventListener('focus',refreshModelPromotions);
window.addEventListener('pageshow',refreshModelPromotions);
document.addEventListener('visibilitychange',refreshModelPromotions);
function modelRow(m) {
  const info=WBModelMetadata.display(m);
  info.kind=m.model_type||info.kind||(/^hunyuan-image-/i.test(m.model_id||'')?'image':'text');
  if(info.kind!=='text') { info.price=null; info.base=null; }
  const isFree = info.price === 0;
  const mult = info.price;
  const kindLabel={image:'IMAGE',video:'VIDEO',text:'TEXT'}[info.kind]||'TEXT';
  const kindIcon={image:'fa-image',video:'fa-film',text:'fa-font'}[info.kind]||'fa-font';
  const kindTitle={image:'图片生成模型',video:'视频生成模型（异步任务，按实际用量计费）',text:'文本输出模型'}[info.kind]||'文本输出模型';
  const typeTag=`<span class="model-type-tag ${info.kind}" data-tooltip="${kindLabel} · ${kindTitle}" data-tooltip-description="${{image:'输出为图片。按上游返回的 usage.credit 实际积分记账，不套文本倍率。',video:'输出为视频。异步任务：创建后需轮询到 completed 再下载；按上游 usage.credit 实际积分记账。',text:'输出为文本，按下方倍率与 token 计费。'}[info.kind]||''}">${ic(kindIcon,'wb-ic-sm')}${kindLabel}</span>`;
  const officialTag=m.official_visible===false?`<span class="model-official-tag" data-tooltip="旧模型" data-tooltip-description="官方客户端前端当前不显示该模型（不在官方 cli agent 名单内）。关闭「官方同显」可查看并启用。">旧模型</span>`:'';
  // 「需会员」标记：来自上游客户端的 identity_list（`plan_free === false`）。
  // 与 FREE 徽标是**两件事**：FREE 是本站不计费，这个是「免费账号调不通」。
  // 免费号选到这类模型上游会直接拒，提前标出来能省掉一轮无效重试。
  const planTag = m.plan_free === false
    ? `<span class="model-plan-tag" data-tooltip="需会员" data-tooltip-description="上游客户端的套餐白名单里不含免费身份（identity_list 无 0），免费账号调用会被上游拒绝。需要 Lite/Pro/Pro+/Ultra 订阅。">需会员</span>`
    : '';

  // 品牌标识（`MiraiHub` / `1017`）已从模型列表移除：它只表达模型来源，
  // 与「能不能用、多少钱」无关，却在每行都占一个彩色徽标的位置。
  // 品牌信息仍保留在 API 响应与 metadata 里（`vendor` 字段），需要时可用。

  // ---- 计费口径按平台分流 ----
  //
  // WorkBuddy：按「每千 token 倍率」计费，所以显示倍率 + FREE 徽标。
  // Trae：上游**按 token 实际用量计费**（官方已从按次数改为按 token，
  //   见 https://docs.trae.ai/ide/models ），本站不套倍率 ——
  //   显示「按用量」而不是伪造一个倍率数字。
  // 繁忙程度：Trae 的上游接口没有这个概念（那是 WorkBuddy 的采集项），
  //   给 Trae 显示繁忙徽标等于展示一个永远为「未知」的假信息。
  const platformKey = (m.platform || "").toLowerCase();
  // 后端给的是**权威倍率**（`credit_multiplier`），优先用它：
  //   > 0  -> 收费，显示 ×N
  //   = 0  -> 免费（FREE）
  //   < 0  -> 无量纲（Loomy 按 token 计量，没有倍率概念）
  //   null -> 尚未同步
  //
  // 原来只看 `info.price`（从 upstream_metadata 推测），
  // 而 Qoder 的 price_factor 不在 metadata 里 -> 全部显示「未知」。
  const rawMult = (typeof m.credit_multiplier === "number")
    ? m.credit_multiplier
    : (typeof m.credit_multiplier === "string" && m.credit_multiplier !== ""
        ? Number(m.credit_multiplier) : null);

  let multDisplay;
  if (info.kind !== 'text') {
    multDisplay = '<span class="text-xs text-slate-500" data-tooltip="按实际用量" data-tooltip-description="按上游返回的 usage.credit 实际积分记账，不套文本模型的每千 token 倍率。目录未给价格不代表免费。">按实际用量</span>';
  } else if (rawMult == null) {
    multDisplay = `<span class="text-xs text-slate-400" data-tooltip="尚未同步" data-tooltip-description="该模型还没有从上游同步到倍率信息。点「从后端同步」拉取。">未知</span>`;
  } else if (rawMult < 0) {
    // 无量纲：上游按 token 实际消耗计费，没有倍率概念
    multDisplay = `<span class="text-xs text-slate-500" data-tooltip="按 Token 计费" data-tooltip-description="该平台没有倍率概念，按上游实际 token 消耗扣费。0 倍率才叫免费，这里不是。">按用量</span>`;
  } else if (rawMult === 0) {
    multDisplay = '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700" data-tooltip="免费" data-tooltip-description="0 倍率：本站不计费。">FREE</span>';
  } else {
    multDisplay = `<span class="text-amber-600 font-medium" data-tooltip="倍率 ${rawMult.toFixed(2)}" data-tooltip-description="按该倍率计费（×token 数）。0 倍率才免费。">×${rawMult.toFixed(2)}</span>`;
  }
  const original = (rawMult != null && rawMult > 0
                    && info.discountMode === 'strikethrough'
                    && info.base != null && info.base !== rawMult)
    ? `<del class="model-original-price">×${info.base.toFixed(2)}</del>` : '';
  return `
    <tr class="border-t hover:bg-slate-50">
      <td class="px-4 py-3 text-xs"><span class="model-id-line">${modelIcon(m.model_id,'wb-mic-sm')}<span tabindex="0" class="model-id-description" data-model-tooltip="${esc(m.model_id)}" data-tooltip="${esc(m.note || m.model_id)}" data-tooltip-description="${esc(m.model_id)} · ${esc(info.description || '上游暂未提供模型描述')}">${esc(m.note || m.model_id)}</span></span><div class="model-promotion-row">${typeTag}${planTag}${officialTag}${modelPromotionBadges(info)}</div>${(m.note && m.note !== m.model_id) ? `<div style="margin-top:2px;color:var(--fg-subtle);font-size:10px;font-family:ui-monospace,monospace">${esc(m.model_id)}</div>` : ''}</td>
      <td class="px-4 py-3 text-xs">${platformBadge(m.platform)}</td>
      <td class="px-4 py-3 model-mult-column">${original}${multDisplay}</td>
      <td class="px-4 py-3 whitespace-nowrap model-busy-column">${
        (platformKey === "workbuddy")
          ? modelBusyBadge(m)
          : '<span class="text-slate-300" data-tooltip="该平台没有繁忙程度接口">—</span>'}
      <td class="px-4 py-3">${modelHealthCell(m.model_id)}</td>
      <td class="px-4 py-3 text-slate-400 text-xs">${esc(m.note||'-')}</td>
      <td class="px-4 py-3 col-status">${m.enabled?'<span class="badge bg-emerald-100 text-emerald-700">启用</span>':'<span class="badge bg-slate-100 text-slate-500">禁用</span>'}</td>
      <td class="px-4 py-3 text-right whitespace-nowrap">
        <button onclick="speedTestModel(${esc(JSON.stringify(m.model_id))}, this)" ${info.kind!=='text'?'disabled':''} class="text-sky-600 hover:text-sky-800 text-sm mr-2 disabled:opacity-30 disabled:cursor-not-allowed" data-tooltip="模型测速" data-tooltip-description="${info.kind==='video'?'视频模型走 /v1/videos 异步任务，不支持文本测速。':info.kind==='image'?'图片模型不支持文本测速，请用生图接口验证。':'发起一次真实短请求，检测延迟与健康。会消耗少量积分。'}"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg></span></button>
        <button onclick="toggleModel(${m.id},${!m.enabled})" class="${m.enabled?'text-amber-600 hover:text-amber-800':'text-emerald-600 hover:text-emerald-800'} text-sm mr-2" data-tooltip="${m.enabled?'禁用模型':'启用模型'}" data-tooltip-description="${m.enabled?'禁用后该模型从 /v1/models 与自动选型中移除，已有调用不受影响。':'启用后该模型重新出现在 /v1/models，可用 Key 即可调用。'}">${ic(m.enabled?'ban':'check')}</button>
        <button onclick="deleteModelConfig(${m.id})" class="text-red-500 hover:text-red-700" data-tooltip="移除模型配置" data-tooltip-description="从本地白名单删除该模型。重新同步模型目录会把它加回来。"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></span></button>
      </td>
    </tr>`;
}
const MODEL_SORT_FIELDS = ['id','level','mult','busy','success','requests','p50','p95','jitter','accounts','note','enabled'];
function toggleModelSort(field = 'mult'){
  if(!MODEL_SORT_FIELDS.includes(field)) return;
  _modelSort = _modelSort === field+'_asc' ? field+'_desc' : _modelSort === field+'_desc' ? 'default' : field+'_asc';
  try { localStorage.setItem('wb_model_sort',_modelSort); } catch(_) {}
  updateModelSortIcon(); renderModelPage(1);
}
function updateModelSortIcon(){
  document.querySelectorAll('[data-model-sort]').forEach(button=>{
    const field=button.dataset.modelSort, active=_modelSort.startsWith(field+'_');
    const direction=active?(_modelSort.endsWith('_asc')?'ascending':'descending'):'none';
    button.classList.toggle('active',active);
    button.setAttribute('aria-label',button.textContent.trim()+'，'+(direction==='none'?'未排序':direction==='ascending'?'升序':'降序'));
    button.querySelector('.wb-icon').innerHTML = '<svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true">' + ((window.WB_ICON_PATHS||{})[active?(direction==='ascending'?'sort-up':'sort-down'):'sort']||'') + '</svg>';
    button.closest('th').setAttribute('aria-sort',direction);
  });
  // The health column offers several independent sort fields.
  const selected=document.querySelector('[data-model-sort].active');
  if(selected) selected.closest('th').setAttribute('aria-sort',_modelSort.endsWith('_asc')?'ascending':'descending');
}
/* 模型平台过滤芯片：委托绑定一次，避免每次重渲染都重挂事件。 */
document.addEventListener("click", event => {
  const chip = event.target.closest("[data-platform-filter]");
  if (!chip) return;
  _modelPlatformFilter = chip.dataset.platformFilter || "";
  renderModelPage(1);
});
function sortModelData(list){
  if(_modelSort === 'default') return list;
  const [field,order]=_modelSort.split('_'), dir=order==='asc'?1:-1;
  const value=m=>{
    const health=_modelHealth[m.model_id]||{}, ttft=health.ttfb_ms||{};
    switch(field){
      case 'id':return m.model_id||'';
      case 'level':return m.level==='system'?0:1;
      case 'mult':return WBModelMetadata.display(m).price;
      case 'busy':return ({idle:0,normal:0,busy:1,congested:2,unavailable:3})[_modelBusy[m.model_id]?.busy_level] ?? null;
      case 'success':return health.requests ? health.success_rate : null;
      case 'requests':return health.requests ?? 0;
      case 'p50':return ttft.p50 ?? null;
      case 'p95':return ttft.p95 ?? null;
      case 'jitter':return ttft.p95==null||ttft.p50==null?null:ttft.p95-ttft.p50;
      case 'accounts':return health.available_accounts ?? null;
      case 'note':return m.note||'';
      case 'enabled':return Number(Boolean(m.enabled));
      default:return null;
    }
  };
  return list.slice().sort((a,b)=>{
    const av=value(a),bv=value(b);
    // Missing observations stay at the end in both directions.
    if(av==null&&bv!=null) return 1;
    if(bv==null&&av!=null) return -1;
    const delta=av==null?0:typeof av==='string'?av.localeCompare(bv,'zh-CN',{numeric:true}):av-bv;
    return delta*dir||(a.model_id||'').localeCompare(b.model_id||'')||a.id-b.id;
  });
}
/**
 * 按平台同步「显示倍率 / 显示繁忙程度 / 官方同显」三个开关的可见性。
 *
 * 为什么不能一律显示：
 *   · Trae **按 token 计费**（https://docs.trae.ai/ide/models 已明确），
 *     后端不返回倍率，留着「显示倍率」开关等于暗示一个不存在的功能；
 *   · Trae 上游没有繁忙度接口，那一列永远是「—」；
 *   · 「官方同显」比较的是 WorkBuddy 的官方模型名单，对 Trae 无意义。
 */
function syncModelDisplayControls() {
  const curSpec = window.WBPlatform ? window.WBPlatform.spec() : null;
  const storage = ((curSpec && curSpec.storage_platform)
                   || (window.WBPlatform ? window.WBPlatform.current().platform : "")
                   || "").toLowerCase();
  const isTrae = storage === "trae";
  [["#modelShowMultiplierLabel", true], ["#modelShowBusyLabel", true],
   ["#modelOfficialOnly", true]].forEach(([sel]) => {
    const node = document.querySelector(sel);
    if (!node) return;
    node.hidden = isTrae;
    node.style.display = isTrae ? "none" : "";
  });
}

// ===== 模型列表：聚合显示 =====
//
// 聚合 = 同一模型跨平台合并成一行。悬停看各平台的具体 model_id。
// 关闭时回到平铺视图（一行 = 一个平台的模型）。

/** 聚合开关状态（记住用户选择）。 */
function modelAggregateOn() {
  try {
    return localStorage.getItem("wb_model_aggregate") !== "0";
  } catch (error) {
    return true;
  }
}

function toggleModelAggregate() {
  try {
    localStorage.setItem("wb_model_aggregate",
      modelAggregateOn() ? "0" : "1");
  } catch (error) { /* 忽略 */ }
  loadModels();
}

/** 把聚合开关的勾选状态与 localStorage 对齐。 */
function syncAggregateSwitch() {
  const box = document.querySelector("#modelAggregate");
  if (box) box.checked = modelAggregateOn();
}

/** 渲染聚合视图。 */
async function renderAggregatedModels() {
  const body = document.querySelector("#modelBody");
  const pager = document.querySelector("#modelPager");
  const head = document.querySelector("#modelTableHead");
  if (!body) return;

  let data = null;
  try {
    const r = await api("/api/models/aggregate");
    const parsed = await safeJson(r);
    if (parsed.ok) data = parsed.data;
  } catch (error) {
    console.warn("[models] 聚合列表加载失败", error);
  }
  if (!data) {
    body.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center"
      style="color:var(--fg-subtle)">聚合列表加载失败</td></tr>`;
    return;
  }

  if (head) {
    head.innerHTML = `<th class="px-4 py-3">模型</th>
      <th class="px-4 py-3">平台数</th>
      <th class="px-4 py-3">最低倍率</th>
      <th class="px-4 py-3">免费</th>
      <th class="px-4 py-3">各平台模型</th>`;
  }

  // 搜索框在聚合视图里原本完全没接上 —— 输入什么都不筛选。这里按组名 / 各平台模型 id / 平台名 / 描述匹配。
  const term = ($("#modelSearch") ? $("#modelSearch").value : "").trim().toLowerCase();
  const platformFilter = (_modelPlatformFilter || "").toLowerCase();
  const matches = item => {
    if (platformFilter && !(item.platforms || []).some(
        p => String(p.platform || "").toLowerCase() === platformFilter)) return false;
    if (!term) return true;
    const hay = [
      item.name, item.key,
      ...(item.platforms || []).flatMap(p => [p.model_id, p.platform, p.platform_label, p.display_name]),
      (item.platforms || []).map(p => p.description || "").join(" "),
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(term);
  };
  const allMulti = (data.items || []).filter(item => item.platform_count > 1);
  const items = allMulti.filter(matches);
  const multi = allMulti.length;
  if (pager) {
    pager.innerHTML = `<span class="text-xs" style="color:var(--fg-subtle)">
      共 ${data.total_models} 个模型 · 聚合为 ${data.total_groups} 组 ·
      其中 <b>${multi}</b> 组可在多个平台间调度</span>`;
  }

  const countEl = $("#modelSearchCount");
  if (countEl) {
    if (term || platformFilter) {
      countEl.textContent = `${items.length} 个结果`;
      countEl.hidden = false;
    } else {
      countEl.hidden = true;
    }
  }
  const clearBtn = $("#modelSearchClear");
  if (clearBtn) clearBtn.hidden = !term;

  if (!items.length) {
    body.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center"
      style="color:var(--fg-subtle)">${
        term || platformFilter ? `没有匹配「${esc(term || platformFilter)}」的跨平台模型`
          : "没有跨平台的同名模型"}</td></tr>`;
    return;
  }

  body.innerHTML = items.map(item => {
    const platforms = item.platforms || [];
    // 每个平台 chip 都要能看该平台模型的详情：描述、上下文/能力、倍率、显示名。
    // 之前只有聚合行有描述，平台明细里只有一个 model_id，鼠标移上去什么也没有。
    const chips = platforms.map(p => {
      const desc = (p.description || "").trim();
      const tip = `${p.platform_label || p.platform} · ${p.model_id}`;
      const note = (p.note || "").trim();
      const meta = [
        desc,
        p.display_name && p.display_name !== p.model_id ? `显示名：${p.display_name}` : "",
        p.multiplier != null ? (Number(p.multiplier) === 0 ? "倍率：免费" : `倍率：×${p.multiplier}`) : "",
        note ? `备注：${note}` : "",
        p.enabled === false ? "状态：已禁用" : "",
      ].filter(Boolean).join("\n");
      return `<span class="inline-flex items-center gap-1 mr-2 mb-1"
         style="font-size:10px;padding:1px 6px;border-radius:9999px;
                background:var(--surface-2);border:1px solid var(--line)"
         data-tooltip="${esc(tip)}"
         data-tooltip-description="${esc(meta)}">
        <b>${esc(p.platform_label || p.platform)}</b>
        <code style="opacity:.7">${esc(p.model_id)}</code>
        ${p.multiplier != null ? `<span style="opacity:.6">×${p.multiplier}</span>` : ""}
      </span>`;
    }).join("");
    const mult = item.min_multiplier == null ? "—"
      : (item.min_multiplier === 0 ? "FREE" : "×" + item.min_multiplier);
    const desc = (platforms.find(p => p.description) || {}).description || "";
    return `<tr class="border-t hover:bg-slate-50">
      <td class="px-4 py-3">
        <div class="text-xs font-medium">${esc(item.name)}</div>
        ${desc ? `<div class="text-[11px] mt-1"
          style="color:var(--fg-subtle);max-width:520px">${esc(desc).slice(0, 120)}</div>` : ""}
      </td>
      <td class="px-4 py-3 text-xs tnum">${item.platform_count}</td>
      <td class="px-4 py-3 text-xs tnum">${mult}</td>
      <td class="px-4 py-3 text-xs">${item.free_any
        ? '<span style="color:var(--success,#33587F)">有</span>' : "—"}</td>
      <td class="px-4 py-3">${chips}</td>
    </tr>`;
  }).join("");
}

async function loadModels(){
  syncAggregateSwitch();
  // 聚合视图：一行 = 一个跨平台模型（悬停看各平台明细）
  if (modelAggregateOn()) {
    return await renderAggregatedModels();
  }

  // 平台过滤条跟随**全局平台切换**：切到 Trae 时默认只看 Trae 的模型。
  //
  // 之前在模型面板里记一个独立的 `_modelPlatformFilter`（默认空 = 全部），
  // 于是「切到 Trae 平台的模型配置」实际显示的是 111 个全平台模型的并集，
  // WorkBuddy 的倍率/繁忙标就混在 Trae 的行里 —— 看起来像是两套口径串了。
  // 用户需要的是「当前平台的模型」，要跨平台比较再点「全部」。
  const curSpec = window.WBPlatform ? window.WBPlatform.spec() : null;
  const curStorage = ((curSpec && curSpec.storage_platform)
                      || (window.WBPlatform ? window.WBPlatform.current().platform : "")
                      || "").toLowerCase();
  if (curStorage && _modelPlatformFilter === "") _modelPlatformFilter = curStorage;
  syncModelDisplayControls();
  const r = await api("/api/models/configs"); if(!r.ok) return;
  const d = await r.json();
  try {
    const display = await api('/api/models/display');
    if (display.ok) applyModelDisplay(await display.json());
  } catch (_) {}
  loadModelHealth();
  _modelData = d.items || [];
  _modelOfficialTotal = d.official_total || 0;
  // 恢复上次停留的页码与排序（浏览器刷新 / 操作后保持）
  try { _modelPage = parseInt(localStorage.getItem("wb_model_page") || "1") || 1; } catch(e) {}
  try {
    const s = localStorage.getItem("wb_model_sort");
    if(s === 'default' || MODEL_SORT_FIELDS.some(field=>s===field+'_asc'||s===field+'_desc')) _modelSort = s;
  } catch(e) {}
  updateModelSortIcon();
  renderModelPage(_modelPage);
  loadModelBusy().finally(loadModelDescriptions);
}
function clearModelSearch() {
  const input = $("#modelSearch");
  if (input) { input.value = ""; input.focus(); }
  // 清除之后必须**重新取数**：聚合视图的数据是接口现算的，
  // 只重绘会沿用上一次的过滤条件。
  loadModels();
}

/** 模型列表内的平台过滤（芯片）。空 = 全部平台。 */
function renderModelPlatformFilter() {
  const host = $("#modelPlatformFilter");
  if (!host) return;
  const groups = {};
  (_modelData || []).forEach(m => {
    const key = m.platform || "workbuddy";
    groups[key] = (groups[key] || 0) + 1;
  });
  const keys = Object.keys(groups);
  if (keys.length <= 1) { host.innerHTML = ""; return; }  // 只有一个平台就不必显示
  const chip = (value, label, count) =>
    `<button type="button" class="model-platform-chip${_modelPlatformFilter === value ? " active" : ""}" data-platform-filter="${esc(value)}">${esc(label)}<span>${count}</span></button>`;
  const totalAll = keys.reduce((sum, key) => sum + groups[key], 0);
  host.innerHTML = chip("", "全部", totalAll) + keys.map(key => {
    const sample = (_modelData || []).find(m => (m.platform || "workbuddy") === key) || {};
    return chip(key, sample.platform_label || key, groups[key]);
  }).join("");
}

function renderModelPage(p) {
  // 聚合视图下表格由 renderAggregatedModels 渲染：搜索/清空必须交给它，
  // 否则只是往隐藏的明细表里写数据，看起来就是「搜索没反应」。
  if (typeof modelAggregateOn === "function" && modelAggregateOn()) {
    renderAggregatedModels();
    return;
  }
  const term = (_modelTerm = ($("#modelSearch") ? $("#modelSearch").value : "").trim().toLowerCase());
  // 清除按钮只在有输入时出现
  const clearBtn = $("#modelSearchClear");
  if (clearBtn) clearBtn.hidden = !term;

  // 官方同显：仅显示官方前端当前可见的模型；关闭开关时全量展示并以标签区分
  const officialHide = _modelDisplay.official_only !== false;
  const officialBase = officialHide ? _modelData.filter(m => m.official_visible !== false) : _modelData;
  const officialHidden = _modelData.length - officialBase.length;

  // 平台：账号池/统计面板会跟着平台切换，模型配置**保持全量**（公共表），
  // 但这里提供一个只看某个平台的过滤开关，避免平台一多就分不清。
  //
  // ⚠️ 后端返回的 `platform` 是**对外 id**（`trae-cn` / `trae-intl` / `qoder-intl`），
  // 而 `_modelPlatformFilter` 存的是**落库平台**（`trae` / `qoder`）——
  // 两者字符串不相等，直接用 `===` 比会把 Trae 的 50 条模型全滤掉，
  // 表现是「切到 Trae，模型配置一条都不显示」（2026-10-31 实测确认）。
  // 这里同时认：落库平台命中，或它的区级 id（storage + '-'）命中。
  const platformFilter = (_modelPlatformFilter || "").toLowerCase();
  const matchesPlatform = (m) => {
    if (!platformFilter) return true;
    const p = String(m.platform || "workbuddy").toLowerCase();
    if (p === platformFilter) return true;
    // trae -> trae-cn / trae-intl / qoder -> qoder-intl
    if (p.startsWith(platformFilter + "-")) return true;
    // 反向兜底：过滤条上是区级 id（历史 localStorage 值），模型却按落库平台标
    if (platformFilter.startsWith(p + "-")) return true;
    return false;
  };
  const platformBase = officialBase.filter(matchesPlatform);

  // 搜索匹配范围要比"ID + 备注"宽：
  //   · 厂商/别名（写 "gpt"、"豆包"、"qwen" 应该能找到对应模型）
  //   · 平台名（写 "trae" 能筛出该平台的全部模型）
  //   · reasoning 能力标签等元数据
  const hit = (m) => {
    if (!term) return true;
    const iconKey = modelIconKey(m.model_id || "");
    const haystack = [
      m.model_id, m.note, m.description, m.platform, m.platform_label,
      m.level, m.model_type,
      iconKey,
      (m.tags || []).join(" "),
    ].filter(Boolean).join(" ").toLowerCase();
    if (haystack.includes(term)) return true;
    // 厂商中文名也要能搜（豆包 / 通义 / 混元 …）
    const zh = { doubao: ["豆包"], qwen: ["通义", "千问"], hunyuan: ["混元"],
                 kimi: ["月之暗面"], glm: ["智谱"], stepfun: ["阶跃"] }[iconKey];
    return !!zh && zh.some(name => name.includes(term) || term.includes(name));
  };

  const filtered = term ? platformBase.filter(hit) : platformBase;
  const data = sortModelData(filtered);
  const total = data.length, totalPages = Math.max(1, Math.ceil(total / PS));
  p = Math.min(Math.max(1, p), totalPages);
  _modelPage = p;  // 记住当前页，供后续操作 / 刷新恢复
  try { localStorage.setItem("wb_model_page", String(p)); } catch(e) {}

  // 结果计数：搜完不知道剩几个是很糟的体验
  const countEl = $("#modelSearchCount");
  if (countEl) {
    if (term || platformFilter) {
      countEl.textContent = `${total} 个结果`;
      countEl.hidden = false;
    } else {
      countEl.hidden = true;
    }
  }
  renderModelPlatformFilter();

  const slice = data.slice((p - 1) * PS, p * PS);
  $("#modelBody").innerHTML = slice.map(modelRow).join("") ||
    `<tr><td colspan="8" class="px-4 py-8 text-center text-slate-400">${
      term ? `没有匹配「${esc(term)}」的模型` : "还没有模型配置，点击「从后端同步模型」拉取可用模型列表"
    }</td></tr>`;
  const officialNote = officialHidden > 0
    ? `<span class="model-official-note" data-tooltip="官方客户端前端当前不显示这些模型（不在 cli agent 名单内）。关闭「官方同显」可查看它们">已按官方同显隐藏 ${officialHidden} 个旧模型</span>` : '';
  $("#modelPager").innerHTML = officialNote + pagerHtml(total, p, totalPages, "renderModelPage");
}
async function syncModels(){
  // 按当前平台同步：不传 platform 会同步全部平台（慢，且日志里混在一起）。
  // 传了之后 Postgres/MySQL 只写这一个平台，结果里的 `platforms` 明细
  // 也能直接看出「哪个平台拿到几个、哪个平台为什么没拿到」。
  const spec = window.WBPlatform ? window.WBPlatform.spec() : null;
  const storage = ((spec && spec.storage_platform) || "").toLowerCase();
  toast(storage ? `正在同步 ${spec.label || storage} 的模型...` : "正在同步全部平台的模型...", "ok");
  try{
    const qs = storage ? `?platform=${encodeURIComponent(storage)}` : "";
    const r = await api("/api/models/sync" + qs, {method:"POST"});
    const d = await r.json();
    if(!r.ok){ toast(`同步失败: ${d.detail||""}`,"err"); return; }
    const per = (d.platforms && Object.keys(d.platforms).length)
      ? Object.keys(d.platforms).map(k => `${k} +${d.platforms[k].added}`).join(" / ") : "";
    const probs = (d.problems && Object.keys(d.problems).length)
      ? `；未取到：${Object.keys(d.problems).join("、")}` : "";
    toast(`同步完成: 新增 ${d.added} 个，更新 ${d.updated} 个，共 ${d.total_in_db} 个`
          + (per ? `（${per}）` : "") + probs,
          (d.problems && Object.keys(d.problems).length) ? "err" : "ok");
    if (d.problems && Object.keys(d.problems).length) console.warn("模型同步未取到的平台", d.problems);
    loadModels();
    // API Keys 页顶部的「可用模型」来自 /api/models/aggregate，
    // 不跟着同步刷新就会一直停在页面打开时那份（只有同步新平台时才明显，
    // 因为老平台的模型早就列过了）。2026-10-31 实测反馈。
    loadShareInfo();
  } catch(e){ toast("同步异常: "+e.message,"err"); }
}
async function toggleModel(id, enabled){
  const r = await api("/api/models/"+id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled})});
  toast(r.ok?(enabled?"已启用":"已禁用"):"操作失败", r.ok?"ok":"err");
  if(r.ok) loadModels();
}
async function deleteModelConfig(id){ if(!await uiConfirm({message:"确认移除该模型配置？移除后该模型将被过滤。", title:"移除模型配置"}))return; const r=await api("/api/models/"+id,{method:"DELETE"}); toast(r.ok?"已移除":"失败",r.ok?"ok":"err"); if(r.ok) loadModels(); }
async function enableAllModels(enabled){
  if (_modelBatchBusy) return;
  if (!await uiConfirm({title:enabled?'全部启用模型':'全部禁用模型', message:enabled?'启用全部系统模型？':'禁用后所有系统模型将无法被调用。继续？', danger:!enabled})) return;
  _modelBatchBusy = true;
  try {
  const r = await api("/api/models/batch-toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled,level:"system"})});
  const d = await r.json().catch(()=>({}));
  toast(`${enabled?'启用':'禁用'}了 ${d.updated||0} 个模型`, r.ok?"ok":"err");
  if(r.ok) loadModels();
  } catch(e) { toast(e.message, 'err'); }
  finally { _modelBatchBusy = false; }
}
let _modelBatchBusy = false;
async function speedTestModel(modelId, btn){
  if(_modelProbeBusy || (btn && btn.disabled)) return;
  _modelProbeBusy = true;
  const old = btn ? btn.innerHTML : "";
  if(btn){ btn.disabled = true; btn.innerHTML = '<span class="wb-icon wb-ic-spin"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span>'; }
  try{
    const r = await api("/api/models/speed-test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:modelId})});
    const d = await r.json();
    if(!r.ok){ toast(`测速失败(${modelId}): ${esc(d.detail||"")}`,"err"); return; }
    _modelProbes[modelId] = d;
    await loadModelHealth();
    const ttft = d.ttft_ms!=null ? d.ttft_ms+"ms" : "—";
    const sp = d.speed_tps!=null ? d.speed_tps+" t/s" : "—";
    const comp = d.completion_tokens!=null ? d.completion_tokens : (d.total_tokens??0);
    const prompt = d.prompt_tokens!=null ? d.prompt_tokens : "—";
    toast(`<b>${esc(modelId)}</b> 测速：首字 ${ttft} · 提示 ${prompt} / 补全 ${comp} tok · ${sp}` + (d.account?` · 账号 ${esc(d.account)}`:""), "ok");
  }catch(e){ toast("测速异常: "+e.message,"err"); }
  finally{ _modelProbeBusy = false; if(btn){ btn.disabled=false; btn.innerHTML = old; } }
}

