/* ==========================================================================
   后台任务进度（批量做任务 / 猫猫旅行）
   --------------------------------------------------------------------------
   这类批量是串行 + 限速的，一个账号要好几秒，全量跑完可能几分钟。
   同步等会让 nginx 先超时（默认 60s）→ 504。所以：
     1. 请求只负责「提交」，立即拿到 job_id；
     2. 弹窗每 1.5 秒轮询一次进度，实时追加已完成账号；
     3. 关掉弹窗不会中断后台执行（线程还在跑），重新点按钮能看到进度。
   ========================================================================== */
let _jobTimer = null;
let _accountActionBusy = false;
let _accountJob = null;

function syncAccountBatchButtons() {
  const busy = _accountActionBusy || !!_accountJob;
  document.querySelectorAll('[data-account-batch]').forEach(button => {
    if (busy && !button.dataset.batchLocked) {
      button.dataset.batchWasDisabled = button.disabled ? '1' : '0';
      button.dataset.batchLocked = '1';
      button.disabled = true;
    } else if (!busy && button.dataset.batchLocked) {
      button.disabled = button.dataset.batchWasDisabled === '1';
      delete button.dataset.batchLocked;
    }
    button.setAttribute('aria-busy', String(busy));
  });
  const status = document.getElementById('accountJobStatus');
  if (status) {
    status.hidden = !busy;
    status.disabled = !_accountJob;
    status.innerHTML = '<span class="wb-icon wb-ic-spin"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span> ' + (_accountJob ? '执行中 · 查看进度' : '准备中…');
  }
}
async function accountBatchAction(action) {
  if (_accountJob) { showAccountJob(); return; }
  if (_accountActionBusy) return;
  _accountActionBusy = true;
  syncAccountBatchButtons();
  try { await action(); }
  catch (error) { toast('批量操作失败：' + esc(String(error.message || error)), 'err'); }
  finally { _accountActionBusy = false; syncAccountBatchButtons(); }
}
function showAccountJob() {
  if (!_accountJob) return;
  openModal(`<h3 class="font-bold mb-2">${esc(_accountJob.opts.title)}</h3>
    <div id="jobHead" class="text-sm">正在提交，请稍候…</div>
    <div id="jobList" class="rounded-lg border bg-slate-50 px-3 py-1 max-h-72 overflow-auto text-sm"></div>
    <p class="text-xs mt-3" style="color:var(--fg-muted)">关闭弹窗后任务继续执行，可点击“查看进度”重新打开。</p>
    <div class="flex justify-end mt-4"><button onclick="closeModal()" class="console-btn">关闭</button></div>`);
  if (_accountJob.snapshot) updateJobProgress(_accountJob.snapshot, _accountJob.opts);
}

/** Only stop polling when the task finishes; closing the modal keeps it alive. */
function stopJobPoll() {
  if (_jobTimer) { clearInterval(_jobTimer); _jobTimer = null; }
}

/** 进度头部（文字 + 进度条 + 汇总）。**不含**账号列表。 */
function jobProgressHtml(d, opts) {
  const pct = d.percent || 0;
  const done = d.status !== "running";
  // 细粒度进度：当前账号已完成几个任务。
  // 一个账号要跑十几个任务、几分钟，只有账号级进度时界面会长时间不动，
  // 用户以为卡死了 —— 所以要显示「本账号已完成 N 个任务」。
  const taskBit = (!done && d.task_done)
    ? ` <span class="text-slate-400 font-normal text-xs">· 本账号已完成 ${d.task_done} 个任务</span>`
    : "";

  const head = done
    ? `<div class="mb-2 font-semibold ${d.status === "failed" ? "text-red-500" : "text-emerald-600"}">
         ${d.status === "failed" ? "执行失败：" + esc(d.error || "") : esc(opts.doneText(d))}</div>`
    : `<div class="mb-2 text-slate-600 font-semibold">
         <span class="wb-icon mr-1 wb-ic-spin"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span>
         ${esc(d.phase || "执行中")} ${d.done}/${d.total}
         <span class="text-slate-400 font-normal text-xs ml-1">已用 ${d.elapsed_s}s</span>
       </div>
       ${d.current ? `<div class="text-xs text-slate-500 mb-2">
           <span class="wb-icon mr-1 text-sky-500 wb-ic-spin"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/></svg></span>
           正在处理 <b class="text-slate-700">${esc(d.current)}</b>${taskBit}
           ${d.task_current ? `<div class="mt-1">${esc(d.task_current)}</div>` : ""}
         </div>` : ""}`;

  return `${head}
    <div class="h-2 rounded-full bg-slate-100 overflow-hidden mb-2">
      <div class="h-full rounded-full transition-all duration-300 ${done ? "bg-emerald-500" : "bg-sky-500"}"
           style="width:${pct}%"></div>
    </div>
    ${done ? `<div class="text-xs text-slate-500 mb-2">${opts.summaryHtml ? opts.summaryHtml(d) : ""}</div>` : ""}`;
}

/** 已完成账号列表（**单独一块**，便于局部更新、不整块闪烁）。 */
function jobProgressRows(d, opts) {
  return (d.items || []).map(x => {
    const label = opts.label(x);
    const detail = opts.detail(x);
    const amount = opts.amount(x);
    const icon = opts.icon(x);
    return `<div class="flex items-center gap-2 py-1.5 border-b last:border-0">
      ${icon}
      <span class="flex-1 truncate">${esc(label)}</span>
      <span class="text-slate-500 text-xs truncate maxw-45">${esc(detail)}</span>
      ${amount}
    </div>`;
  }).join("") || `<div class="text-slate-400 text-xs py-2">等待第一个账号完成...</div>`;
}

/**
 * 局部更新进度：**只替换真正变了的那部分**。
 *
 * 为什么不能用 `innerHTML = jobProgressHtml(...)`：那样每 1.5 秒把整块
 * DOM（含滚动位置、hover 状态、CSS 过渡）全部销毁重建，视觉上就是
 * 「卡片一直在闪」。这里把头部与列表拆成两个固定容器，分别比对内容，
 * 只有内容真的变了才写 —— 列表没变就完全不动它，滚动条也不会跳回顶部。
 */
function updateJobProgress(d, opts) {
  const head = $("#jobHead");
  const list = $("#jobList");
  if (!head || !list) return;
  const headHtml = jobProgressHtml(d, opts);
  if (head.dataset.sig !== headHtml) {
    head.innerHTML = headHtml;
    head.dataset.sig = headHtml;
  }
  const listHtml = jobProgressRows(d, opts);
  if (list.dataset.sig !== listHtml) {
    list.innerHTML = listHtml;
    list.dataset.sig = listHtml;
  }
}

/** 提交后台任务并开始轮询进度。 */
async function runJob(opts) {
  if (_accountJob) { showAccountJob(); return; }
  stopJobPoll();
  // 两个**固定容器**：轮询时只更新它们的内容，不重建整块 DOM。
  // 整块重建会让列表每 1.5 秒消失再出现 —— 就是「卡片闪来闪去」的原因。
  _accountJob = {opts, snapshot:null};
  syncAccountBatchButtons();
  showAccountJob();

  let d;
  try {
    const r = await api(opts.submitUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts.body || {}),
    });
    const j = await safeJson(r);
    if (!r.ok || !j.ok || !j.data?.job_id) {
      showAccountJob();
      $("#jobHead").innerHTML = `<span class="text-red-500">提交失败: ${esc(j.data?.detail || "未知错误")}</span>`;
      _accountJob = null; syncAccountBatchButtons();
      return;
    }
    d = j.data;
  } catch (e) {
    showAccountJob();
    $("#jobHead").innerHTML = `<span class="text-red-500">提交异常: ${esc(String(e))}</span>`;
    _accountJob = null; syncAccountBatchButtons();
    return;
  }

  if (d.reused) toast("已有批量任务在执行，显示其进度", "ok");
  _accountJob.snapshot = d;
  updateJobProgress(d, opts);

  let polling = false;
  _jobTimer = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const r = await api(`/api/growth/job/${d.job_id}`);
      const j = await safeJson(r);
      if (!r.ok || !j.data) return;
      const cur = j.data;
      if (_accountJob) _accountJob.snapshot = cur;
      updateJobProgress(cur, opts);
      if (cur.status !== "running") {
        stopJobPoll();
        showAccountJob();
        _accountJob = null; syncAccountBatchButtons();
        if (cur.status === "failed") toast("批量执行失败：" + esc(cur.error || ""), "err");
        else toast(esc(opts.doneToast(cur)), "ok");
        opts.onFinish && opts.onFinish(cur);
      }
    } catch (e) {
      if ($("#jobHead")) $("#jobHead").textContent = '进度连接暂时中断，正在重试；请勿重复提交。';
    } finally { polling = false; }
  }, 1500);
}

/* 猫猫旅行：批量执行 */
async function catTravelBatch() {
  const list = _accData.filter(a => a.status === "active");
  if (!list.length) { toast("没有可执行的账号", "err"); return; }
  if (!await uiConfirm({kind:"info", danger:false, title:"批量猫猫旅行",
      message:`确认对 ${list.length} 个账号执行猫猫旅行？\n流程：同意协议 → 首次领养(+300) → 派出 → 领奖`, okText:"开始执行"})) return;

  await runJob({
    title: "批量猫猫旅行",
    iconHtml: '<span class="wb-icon mr-1 text-pink-600"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75Z"/></svg></span>',
    submitUrl: "/api/accounts/cat-travel/batch-async",
    body: {},
    label: x => x.account || x.id,
    detail: x => x.summary || "",
    amount: x => x.credits > 0 ? `<span class="font-semibold text-amber-600 shrink-0">+${x.credits}</span>` : "",
    icon: x => x.credits > 0 ? '<span class="wb-icon text-emerald-500 shrink-0"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg></span>'
             : x.ok ? '<span class="wb-icon text-slate-400 shrink-0"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg></span>'
                    : '<span class="wb-icon text-red-500 shrink-0"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg></span>',
    doneText: d => {
      const b = (d.result && d.result.buckets) || {};
      const tot = (d.result && d.result.credits) || 0;
      return `完成，共 ${d.total} 个账号，合计获得 ${tot} 积分`;
    },
    summaryHtml: d => {
      const b = (d.result && d.result.buckets) || {};
      const parts = [];
      if (b.adopted) parts.push(`首次领养 <b class="text-emerald-600">${b.adopted}</b> 个（+${b.adopt_credits}）`);
      if (b.travel_claimed) parts.push(`旅行返现 <b class="text-amber-600">${b.travel_claimed}</b> 个（+${b.travel_credits}）`);
      if (b.travel_none) parts.push(`无新增 ${b.travel_none} 个`);
      if (b.traveling) parts.push(`旅行中 ${b.traveling} 个`);
      if (b.gate_blocked) parts.push(`<span class="text-orange-600">门槛未达标 ${b.gate_blocked} 个</span>`);
      if (b.error) parts.push(`<span class="text-red-600">失败 ${b.error} 个</span>`);
      return parts.join(" · ") || "";
    },
    doneToast: d => {
      const b = (d.result && d.result.buckets) || {};
      const tot = (d.result && d.result.credits) || 0;
      return tot > 0 ? `批量完成，共获得 ${tot} 积分` : "批量完成，无新增积分";
    },
    onFinish: () => loadAccounts(),
  });
}

/* ==========================================================================
   成长任务
   --------------------------------------------------------------------------
   任务进度由「模型请求体里的 extra_vars.growthEvent」驱动，走的是与正常
   对话完全相同的接口，因此不需要客户端参与、可全自动完成。
   已实测可自动完成的任务见后端 admin/growth_plans.py 的策略表；其余任务
   在面板上标为「复杂」，仍可点击尝试，失败会自动说明原因。
   ========================================================================== */

/* 难度标签样式 */
function growthLevelBadge(level, label){
  const cls = {
    auto:  "bg-emerald-50 text-emerald-700 border-emerald-200",
    multi: "bg-sky-50 text-sky-700 border-sky-200",
    manual:"bg-amber-50 text-amber-700 border-amber-200",
    skip:  "bg-slate-100 text-slate-500 border-slate-200",
  }[level] || "bg-slate-100 text-slate-500 border-slate-200";
  return `<span class="text-xs px-1.5 py-0.5 rounded border ${cls} whitespace-nowrap">${esc(label||level)}</span>`;
}

/* 任务状态标签 */
function growthStatusBadge(status){
  const map = {
    claimed:      ["已领取", "text-slate-400"],
    completed:    ["待领取", "text-amber-600 font-semibold"],
    in_progress:  ["进行中", "text-sky-600"],
    accepted:     ["已参与", "text-slate-500"],
    not_accepted: ["未参与", "text-slate-400"],
  };
  const [label, cls] = map[status] || [status || "-", "text-slate-400"];
  return `<span class="text-xs ${cls}">${esc(label)}</span>`;
}

/* 单账号任务弹窗 */
async function growthTasks(id, name){
  openModal(
    `<h3 class="font-bold mb-1"><span class="wb-icon mr-1 text-emerald-600"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"/><path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"/><path d="M5 21h14"/></svg></span> 成长任务 — ${esc(name)}</h3>
     <p class="text-xs text-slate-400 mb-3">加载中...</p>
     <div id="growthBody" class="text-sm"></div>`, "max-w-4xl");

  try {
    const r = await api("/api/growth/accounts/" + id + "/tasks");
    const { ok, data: d } = await safeJson(r);
    if (!r.ok) {
      $("#growthBody").innerHTML =
        `<p class="text-red-500">获取失败: ${esc(d.detail || "未知错误")}</p>
         <div class="flex justify-end mt-4"><button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">关闭</button></div>`;
      return;
    }
    window._growthTaskAccount = id;
    renderGrowthTasks(d);
  } catch (e) {
    $("#growthBody").innerHTML = `<p class="text-red-500">请求异常: ${esc(String(e))}</p>`;
  }
}

function renderGrowthTasks(d){
  const s = d.summary || {};
  const tasks = d.tasks || [];
  // 可执行 = 标为可自动 且 未领取
  const runnable = tasks.filter(t => t.actionable && t.accept_status !== "claimed");
  const claimable = tasks.filter(t => t.accept_status === "completed");

  const rows = tasks.map(t => {
    const pr = t.progress || {};
    const prog = (pr.target != null) ? `${pr.current || 0}/${pr.target}` : "-";
    const canRun = t.actionable && t.accept_status !== "claimed";
    const canClaim = t.accept_status === "completed";
    return `<tr class="border-b hover:bg-slate-50">
      <td class="px-3 py-2">
        <div class="font-medium">${esc(t.title || t.task_code)}</div>
        <div class="text-xs text-slate-400">${esc(t.task_code)}</div>
      </td>
      <td class="px-3 py-2">${growthLevelBadge(t.level, t.level_label)}</td>
      <td class="px-3 py-2">${growthStatusBadge(t.accept_status)}</td>
      <td class="px-3 py-2 text-slate-500 text-xs">${esc(prog)}</td>
      <td class="px-3 py-2 text-amber-600 font-medium">${t.reward_credit || 0}</td>
      <td class="px-3 py-2 text-xs text-slate-400 max-w-[16rem]">${esc(t.strategy || "")}</td>
      <td class="px-3 py-2 text-right whitespace-nowrap">
        ${canClaim ? `<button onclick="growthDoClaim(${d.account_id},'${esc(t.task_code)}',this)" class="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50">领奖</button>` : ""}
        ${canRun ? `<button onclick="growthDoRun(${d.account_id},'${esc(t.task_code)}',this)" class="text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 ml-1">完成</button>` : ""}
      </td>
    </tr>`;
  }).join("");

  $("#growthBody").innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
      <div class="rounded-lg border px-3 py-2"><div class="text-xs text-slate-400">总任务</div><div class="font-semibold">${s.total || 0}</div></div>
      <div class="rounded-lg border px-3 py-2"><div class="text-xs text-slate-400">已完成</div><div class="font-semibold text-emerald-600">${s.done || 0}</div></div>
      <div class="rounded-lg border px-3 py-2"><div class="text-xs text-slate-400">待领取</div><div class="font-semibold text-amber-600">${s.claimable || 0}</div></div>
      <div class="rounded-lg border px-3 py-2"><div class="text-xs text-slate-400">可领积分</div><div class="font-semibold text-amber-600">${s.claimable_credit || 0}</div></div>
    </div>
    <div class="text-xs text-slate-400 mb-2">
      等级 ${(d.profile && d.profile.level) || "-"} · 已自动完成 ${s.actionable || 0} 个可自动化任务
    </div>
    <div class="flex flex-wrap gap-2 mb-3">
      <button onclick="growthDoRun(${d.account_id},null,this)" ${runnable.length ? "" : "disabled"}
        class="text-sm px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed">
        <span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg></span> 完成可自动化任务 (${runnable.length})</button>
      <button onclick="growthDoClaim(${d.account_id},null,this)" ${claimable.length ? "" : "disabled"}
        class="text-sm px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed">
        <span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg></span> 领取全部奖励 (${claimable.length})</button>
      <button onclick="growthTasks(${d.account_id},'${esc(d.name || "")}')" class="text-sm px-3 py-1.5 rounded-lg border hover:bg-slate-50">
        <span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg></span> 刷新</button>
    </div>
    <div class="card overflow-auto max-h-[55vh]">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500 text-left sticky top-0">
          <tr>
            <th class="px-3 py-2">任务</th><th class="px-3 py-2">难度</th>
            <th class="px-3 py-2">状态</th><th class="px-3 py-2">进度</th>
            <th class="px-3 py-2">积分</th><th class="px-3 py-2">说明</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="flex justify-between items-center mt-3">
      <p class="text-xs text-slate-400">「完成」只对已实测可自动化的任务开放；标为「复杂」的任务需在客户端手动完成。<br>
        执行按「参与 → 等待落库 → 触发 → 复查」串行进行，请勿中途并行操作同一账号。</p>
      <button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">关闭</button>
    </div>`;
}

/* ==========================================================================
   按钮「加载中」态（防呆 + 让用户知道要等）
   --------------------------------------------------------------------------
   之前的问题：点「执行」后按钮**毫无变化**，也没有防重复点击。
   而单账号跑一轮要几分钟 —— 用户只能对着一个没反应的按钮猜，
   于是以为卡死，还会反复点（叠出更多请求）。
   这里统一：立刻禁用 + 转圈 + 显示已用秒数。
   ========================================================================== */

/** 按钮进入「加载中」，返回一个 restore 函数（务必在 finally 里调用）。 */
function btnBusy(btn, text) {
  if (!btn) return () => {};
  const html = btn.innerHTML;
  const wasDisabled = btn.disabled;
  btn.dataset.busy = "1";
  btn.disabled = true;
  btn.classList.add("opacity-60", "cursor-not-allowed");
  const t0 = Date.now();
  const render = () => {
    const s = Math.floor((Date.now() - t0) / 1000);
    // 显示秒数：用户能看出「在动」，也能大致判断还要等多久
    btn.innerHTML = `<span class="wb-icon mr-1 wb-ic-spin"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span>${esc(text)}${s ? " " + s + "s" : ""}`;
  };
  render();
  const timer = setInterval(render, 1000);
  return () => {
    clearInterval(timer);
    btn.dataset.busy = "";
    btn.disabled = wasDisabled;
    btn.classList.remove("opacity-60", "cursor-not-allowed");
    btn.innerHTML = html;
  };
}

/** 是否正在忙（防呆：重复点击直接忽略）。 */
function btnIsBusy(btn) {
  return !!(btn && btn.dataset && btn.dataset.busy === "1");
}

/* 执行任务（taskCode 为空 = 全部可自动化任务）
   走**异步接口 + 进度弹窗**：单账号十几个任务要跑几分钟，
   同步接口只会让用户对着一个没有反馈的按钮干等，还会撞 nginx 60s 超时。 */
async function growthDoRun(id, taskCode, btn){
  if (btnIsBusy(btn)) return;          // 防呆：已在执行就别再点一次
  const label = taskCode ? `任务 ${taskCode}` : "全部可自动化任务";
  if (!await uiConfirm({kind:"info", danger:false, title:"执行成长任务",
      message:`确认对账号执行「${label}」？\n将自动参与并触发完成，随后自动领奖。\n（单账号可能需要几分钟，可关闭弹窗，后台继续执行）`,
      okText:"开始执行"})) return;

  const restore = btnBusy(btn, "执行中");
  try {
    await runJob({
      title: "执行成长任务",
      iconHtml: '<span class="wb-icon mr-1 text-emerald-600"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"/><path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"/><path d="M5 21h14"/></svg></span>',
      submitUrl: "/api/growth/run-async",
      body: { account_ids: [id], task_codes: taskCode ? [taskCode] : null },
      label: x => x.name || x.account_id,
      detail: x => {
        if (!x.ok) return x.skipped || x.msg || "失败";
        if (x.noop) return x.noop_reason || "无可做任务";
        const done = (x.tasks || []).filter(t => t.ok && !t.skipped).length;
        const skipped = (x.tasks || []).filter(t => t.skipped).length;
        return done ? `完成 ${done} 个任务` + (skipped ? `，跳过 ${skipped}` : "")
                    : `跳过 ${skipped} 个`;
      },
      amount: x => (x.credit > 0)
        ? `<span class="font-semibold text-amber-600 shrink-0">+${x.credit}</span>` : "",
      icon: x => (x.credit > 0)
        ? '<span class="wb-icon text-emerald-500 shrink-0"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg></span>'
        : x.ok ? '<span class="wb-icon text-slate-400 shrink-0"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg></span>'
               : '<span class="wb-icon text-red-500 shrink-0"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg></span>',
      doneText: d => {
        const r = (d.items || [])[0] || {};
        const c = r.credit || 0;
        return c > 0 ? `完成，获得 ${c} 积分` : "执行完成";
      },
      summaryHtml: d => {
        const r = (d.items || [])[0] || {};
        const parts = [];
        const done = (r.tasks || []).filter(t => t.ok && !t.skipped).length;
        if (done) parts.push(`完成 <b>${done}</b> 个任务`);
        if (r.credit) parts.push(`<b class="text-amber-600">+${r.credit} 积分</b>`);
        if (r.energy) parts.push(`+${r.energy} 能量`);
        if (r.balance_remain != null) {
          parts.push(`余额 <b>${r.balance_remain}/${r.balance_total}</b>`);
        }
        // 跳过/失败要说清原因，否则只有「完成 0 个」像执行失败
        const blocked = (r.tasks || []).filter(t => !t.ok && !t.skipped);
        if (blocked.length) {
          parts.push(`<span class="text-red-600">${blocked.length} 个未完成</span>`);
        }
        return parts.join(" · ") || "执行完成";
      },
      doneToast: d => {
        const r = (d.items || [])[0] || {};
        return r.credit > 0 ? `执行完成，获得 ${r.credit} 积分` : "执行完成";
      },
      // 完成后刷新列表（余额）**并**刷新任务弹窗 —— 完成之后没刷新」
      onFinish: () => {
        loadAccounts();
        const cur = window._growthTaskAccount;
        if (cur === id) growthTasks(id, "");
      },
    });
  } finally {
    restore();
  }
}

/* 领取奖励（taskCode 为空 = 所有已完成待领取） */
async function growthDoClaim(id, taskCode, btn){
  if (btnIsBusy(btn)) return;
  const restore = btnBusy(btn, "领取中");
  try {
    const r = await api("/api/growth/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_ids: [id], task_codes: taskCode ? [taskCode] : null }),
    });
    const { ok, data: d } = await safeJson(r);
    if (!r.ok) { toast("领取失败: " + (d.detail || "未知错误"), "err"); return; }
    const a = (d.results || [])[0] || {};
    const got = a.total_credit || 0;
    if (got > 0) {
      // 带上刷新后的余额，用户能立刻看到「积分确实到账了」
      const bal = (a.balance_remain != null)
        ? `，当前余额 ${a.balance_remain}/${a.balance_total}` : "";
      toast(`领取成功，获得 ${got} 积分${bal}`, "ok");
    }
    else if ((a.claimed || []).length && (a.claimed || []).every(c => c.already))
      toast("奖励此前已领取", "ok");
    else toast("没有可领取的奖励", "ok");
    loadAccounts();
    // 刷新弹窗内容（列表里的状态/余额要跟着变）
    const cur = window._growthTaskAccount;
    if (cur === id) growthTasks(id, "");
  } catch (e) {
    toast("领取异常: " + String(e), "err");
  } finally {
    restore();
  }
}

/* 批量做任务：所有 active 账号，逐个执行 + 领奖 */
async function growthRunBatch(){
  const r0 = await api("/api/accounts");
  if (!r0.ok) { toast("获取账号列表失败", "err"); return; }
  const d0 = await r0.json();
  const list = (d0.accounts || d0.items || []).filter(a => a.status === "active");
  if (!list.length) { toast("没有可用账号", "err"); return; }

  if (!await uiConfirm({kind:"warn", danger:true, title:"批量做成长任务",
      message:`确认对 ${list.length} 个账号批量执行？\n流程：自动参与 → 触发完成 → 自动领取。\n仅处理已实测可自动化的任务，其余跳过。`,
      okText:"开始执行"})) return;

  // 交给后台线程串行跑，前端只轮询进度：
  // 原先前端逐个账号发两轮请求（run + claim），xx 个账号要 6 分钟以上，
  // nginx 默认 60s 就超时，体感是「点了没反应」。现在点完立刻有进度条。
  await runJob({
    title: "批量做成长任务",
    iconHtml: '<span class="wb-icon mr-1 text-emerald-600"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"/><path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"/><path d="M5 21h14"/></svg></span>',
    submitUrl: "/api/growth/run-async",
    body: { account_ids: [], task_codes: null },
    label: x => x.name || x.account_id,
    detail: x => {
      if (!x.ok) return x.msg || "失败";
      if (x.noop) return x.noop_reason || "无可做任务";
      const done = (x.tasks || []).filter(t => t.ok && !t.skipped).length;
      return done ? `完成 ${done} 个任务` : "无可做任务";
    },
    amount: x => (x.credit > 0)
      ? `<span class="font-semibold text-amber-600 shrink-0">+${x.credit}</span>` : "",
    icon: x => (x.credit > 0)
      ? '<span class="wb-icon text-emerald-500 shrink-0"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg></span>'
      : x.ok ? '<span class="wb-icon text-slate-400 shrink-0"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg></span>'
             : '<span class="wb-icon text-red-500 shrink-0"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg></span>',
    doneText: d => {
      const r = d.result || {};
      return `完成，共 ${r.accounts || d.total} 个账号，合计获得 ${r.credit || 0} 积分`;
    },
    summaryHtml: d => {
      const r = d.result || {};
      const items = d.items || [];
      const noopN = items.filter(x => x.noop).length;
      const parts = [`完成任务 <b>${r.tasks_done || 0}</b> 个`];
      if (r.credit) parts.push(`<b class="text-amber-600">+${r.credit} 积分</b>`);
      if (r.energy) parts.push(`+${r.energy} 能量`);
      // 全部无可做时要说清原因，否则只有一句「完成 0 个」看着像执行失败
      if (noopN) {
        parts.push(noopN === d.total
          ? `<span class="text-slate-600">${noopN} 个账号的任务已全部领完，本次无新任务</span>`
          : `${noopN} 个账号无可做任务`);
      }
      if (r.failed && r.failed.length) parts.push(`<span class="text-red-600">失败 ${r.failed.length} 个账号</span>`);
      return parts.join(" · ");
    },
    doneToast: d => {
      const r = d.result || {};
      const noopN = (d.items || []).filter(x => x.noop).length;
      if (r.credit > 0) return `批量完成，共获得 ${r.credit} 积分`;
      if (noopN && noopN === d.total) return `批量完成：${noopN} 个账号的任务均已领完，无新任务`;
      return "批量完成，无新增积分";
    },
    onFinish: () => loadAccounts(),
  });
}

/* 积分明细（全部积分包，按到期升序）
 *
 * 优先用库内快照（秒开）；点「重新采集」才真调上游。这是本次的性能取向：
 * 打开弹窗时再打一次上游，每个号要等 0.4s，用户只是想看一眼而已。
 * 到期口径由后端 admin/credits.py 统一处理，前端只负责展示 ——
 * 之前前端自己用 `new Date(p.deduction_end)` 判过期，踩的就是
 * 2034 占位值被当成真实到期日的坑（那个包永远显示「未过期」）。 */
async function viewCreditDetails(id, name, force){
  openModal(`<h3 class="font-bold mb-1"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/></svg></span> 积分明细 — ${esc(name)}</h3>
    <div class="flex items-center justify-between mb-3 gap-2">
      <p class="text-xs m-0" style="color:var(--fg-muted)">按到期时间升序 —— 排最前的就是最先作废的包。</p>
      <button onclick="viewCreditDetails(${id},'${esc(name)}',true)" id="cdReloadBtn"
              class="text-xs px-2-5 py-1.5 rounded-lg border hover:bg-slate-50 whitespace-nowrap">
        <span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 13v8l-4-4"/><path d="m12 21 4-4"/><path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284"/></svg></span>重新采集</button>
    </div>
    <div id="creditDetailBody"><p class="text-sm" style="color:var(--fg-subtle)">加载中...</p></div>
    <div class="flex justify-end mt-4"><button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">关闭</button></div>`);
  try {
    const r = await api("/api/accounts/"+id+"/credit-details" + (force ? "?refresh=true" : ""));
    const { ok, data:d } = await safeJson(r);
    if(!r.ok){ $("#creditDetailBody").innerHTML = `<p class="text-red-500 text-sm">获取失败: ${esc(d.detail||"未知错误")}</p>`; return; }
    const c = d.credits || {};
    // 「积分明细」要看**全量**（含已用完的，用户需要确认某个包确实用完了），
    // 而且后端已按到期升序排好 —— 前端不再自己排，避免两处排序口径漂移。
    const rs = c.all_resources || c.resources || [];
    const active = rs.filter(p => Number(p.remaining) > 0);
    const usedUp = rs.filter(p => Number(p.remaining) <= 0);
    const soon = Number(c.expiring_soon_remaining || 0);
    const stale = d.source === "cache"
      ? `<span class="exp-badge ever"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg></span>本地快照</span>` : "";

    $("#creditDetailBody").innerHTML = `
      <div class="modal-stat-grid gap-3 mb-3">
        ${statCard("当前剩余", fmtCredit(c.total_remaining),
            { icon:"fa-wallet", iconColor:"text-slate-400", sub:`总额度 ${fmtCredit(c.total_capacity)}` })}
        ${statCard(`${c.expiring_soon_days || 7} 天内到期`, fmtCredit(soon),
            { icon:"fa-fire", iconColor:"text-orange-500", tone: soon > 0 ? "warn" : "",
              sub: soon > 0 ? "不用完会作废" : "暂无即将作废" })}
        ${statCard("最近到期", c.soonest_days_left != null
              ? (c.soonest_days_left < 1
                  ? Math.max(1, Math.round(c.soonest_days_left * 24)) + " 小时内"
                  : Math.floor(c.soonest_days_left) + " 天后")
              : "长期有效",
            { icon:"fa-hourglass-half", iconColor:"text-slate-400",
              tone: soon > 0 ? "warn" : "", sub: esc(c.soonest_expire_at
                  ? fmtTime(new Date(c.soonest_expire_at).toISOString().replace('T',' ').slice(0,19)) : "") })}
        ${statCard("积分包", `${active.length} / ${rs.length}`,
            { icon:"fa-boxes-stacked", iconColor:"text-slate-400",
              sub: active.length < rs.length ? `已用完 ${rs.length - active.length} 个` : "全部仍有剩余" })}
      </div>
      ${d.error ? `<div class="mb-3 fs-11-5" style="color:var(--danger)">
        <span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>上游采集失败（显示的是本地快照）：${esc(d.error)}</div>` : ""}
      <div class="flex items-center gap-2 mb-2 text-[11px]">${stale}
        <span style="color:var(--fg-subtle)">${d.source === "live" ? "本次已从上游采集" : "来自本地快照，可点「重新采集」更新"}</span>
        <span style="color:var(--fg-subtle)">· 按到期时间升序</span></div>
      <div class="card p-3">
        ${active.length ? active.map(p => pkgDetailRow(p)).join("")
          : `<div class="empty">该账号没有仍有剩余的积分包。</div>`}
        ${usedUp.length ? `
          <details class="mt-2">
            <summary class="cursor-pointer fs-11-5 select-none py-1"
                     style="color:var(--fg-muted)">已用完的 ${usedUp.length} 个包（点击展开）</summary>
            <div class="mt-1">${usedUp.map(p => pkgDetailRow(p)).join("")}</div>
          </details>` : ""}
      </div>`;
  } catch(e) { $("#creditDetailBody").innerHTML = `<p class="text-red-500 text-sm">请求异常: ${esc(e.message)}</p>`; }
}

/* 请求用量（服务端分页） */
let _ruState = { id:0, name:"", page:1, size:20, total:0, start:"", end:"" };
const _RU_FIELD_MAP = {
  requestId:"请求ID", credit:"积分消耗", model:"模型",
  client:"客户端", requestTime:"请求时间",
  inputTrunc:"输入(截断)", input:"输入(完整)", agentPurpose:"用途",
};
async function viewRequestUsage(id, name){
  const today = new Date().toISOString().slice(0,10);
  _ruState = { id, name, page:1, size:20, total:0, start:today, end:today };
  openModal(`
    <h3 class="font-bold mb-1"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/></svg></span> 请求用量 — ${esc(name)}</h3>
    <div class="flex gap-2 mb-3 flex-wrap">
      <input id="ruStart" type="date" class="border rounded px-2 py-1 text-sm" value="${today}" />
      <input id="ruEnd" type="date" class="border rounded px-2 py-1 text-sm" value="${today}" />
      <button onclick="_ruState.start=$('#ruStart').value;_ruState.end=$('#ruEnd').value;doLoadRequestUsage(1)" class="px-3 py-1 bg-wb text-white rounded text-sm">查询</button>
    </div>
    <div id="ruBody" class="text-sm text-slate-400">点击「查询」加载用量数据（来自 WorkBuddy 后端 API）</div>
    <div class="flex justify-end mt-4"><button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">关闭</button></div>`);
}
async function doLoadRequestUsage(page){
  _ruState.page = page || 1;
  const start = (_ruState.start || "") + " 00:00:00";
  const end = (_ruState.end || "") + " 23:59:59";
  const body = $("#ruBody"); if(body) body.innerHTML = "查询中...";
  try {
    const r = await api(`/api/accounts/${_ruState.id}/request-usage?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&page_num=${_ruState.page}&page_size=${_ruState.size}`);
    const { ok, data:d } = await safeJson(r);
    if(!r.ok){ if(body) body.innerHTML = `<p class="text-red-500">查询失败: ${esc(d.detail||"")}</p>`; return; }
    const wrapper = d.data || {};
    const items = wrapper.data || wrapper.list || wrapper.records || [];
    const arr = Array.isArray(items) ? items : (items ? [items] : []);
    const total = wrapper.total || arr.length;
    _ruState.total = total;
    if(!arr.length){ if(body) body.innerHTML = `<p class="text-slate-400">该时间段无请求数据</p>`; return; }

    const allKeys = new Set();
    for(const it of arr){ for(const k of Object.keys(it)) allKeys.add(k); }
    const keyOrder = ["requestTime","model","credit","client","agentPurpose","inputTrunc","input","requestId"];
    const sortedKeys = [...allKeys].sort((a,b) => {
      const ia = keyOrder.indexOf(a), ib = keyOrder.indexOf(b);
      if(ia>=0 && ib>=0) return ia-ib; if(ia>=0) return -1; if(ib>=0) return 1; return a.localeCompare(b);
    });
    const trunc = (s, len=80) => !s ? '' : (String(s).length > len ? String(s).slice(0,len)+'...' : s);
    const table = `
      <div class="rounded-lg border overflow-x-auto">
        <table class="w-full text-xs min-w"><thead class="bg-slate-50 text-slate-500 sticky top-0"><tr>${
          sortedKeys.map(k => `<th class="px-2 py-1.5 text-left whitespace-nowrap">${_RU_FIELD_MAP[k]||k}</th>`).join('')
        }</tr></thead><tbody>${arr.map(it => `<tr class="border-t hover:bg-slate-50">${
          sortedKeys.map(k => {
            let v = it[k];
            if(k === 'credit') return `<td class="px-2 py-1 ${v>0?'text-amber-600 font-medium':'text-slate-400'}">${v}</td>`;
            const sv = String(v ?? '');
            if(sv.length > 60) return `<td class="px-2 py-1 max-w-[260px]" data-tooltip="${esc(sv)}">${esc(trunc(sv))}</td>`;
            return `<td class="px-2 py-1 whitespace-nowrap">${esc(sv||'-')}</td>`;
          }).join('')
        }</tr>`).join('')}</tbody></table>
      </div>`;
    const totalPages = Math.max(1, Math.ceil(total / _ruState.size));
    const pager = totalPages > 1 ? `<div class="flex justify-between items-center mt-3 text-xs text-slate-500">
        <span>共 ${total} 条 · 第 ${_ruState.page}/${totalPages} 页</span>
        <span class="flex gap-1">
          <button class="pg-btn px-2 py-1 rounded border ${_ruState.page<=1?'opacity-40 pointer-events-none':''} hover:bg-slate-50" onclick="doLoadRequestUsage(${_ruState.page-1})"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></span></button>
          <button class="pg-btn px-2 py-1 rounded border ${_ruState.page>=totalPages?'opacity-40 pointer-events-none':''} hover:bg-slate-50" onclick="doLoadRequestUsage(${_ruState.page+1})"><span class="wb-icon "><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></span></button>
        </span></div>` : `<div class="text-xs text-slate-400 mt-3">共 ${total} 条</div>`;
    if(body) body.innerHTML = table + pager;
  } catch(e){ if(body) body.innerHTML = `<p class="text-red-500">异常: ${esc(e.message)}</p>`; }
}

/* 扫描本机账号（已按 UID 去重 + 标记号池已有；解释「磁盘无文件但号池已有」的情况） */
async function scanLocal(){
  const r = await api("/api/accounts/scan-local"); const d = await r.json().catch(()=>({}));
  if(!r.ok){ toast("扫描失败","err"); return; }
  if(!d.exists){ openModal(`<h3 class="font-bold mb-3">扫描本机账号</h3><p class="text-sm text-slate-500">未找到登录目录：<br><code class="text-xs">${esc(d.dir||"")}</code></p><div class="flex justify-end mt-4"><button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm">关闭</button></div>`); return; }
  // 交叉对比号池，标出「已在号池但本机无登录文件」的账号（如多设备导入的情况）
  let poolUids = new Set();
  try { const ar = await api("/api/accounts"); const ad = await ar.json(); poolUids = new Set((ad.items||[]).map(a=>a.uid)); } catch(e){}
  // 过滤国际版账号（www.workbuddy.ai）：本网关只对接国内版
  // （workbuddy.cn / copilot.tencent.com）。国际版的登录态拿到国内站
  // 也用不了，列出来只会让人误以为「能扫码但不能导入」。
  const isIntl = (it) => /(^|\.)workbuddy\.ai$/i.test(String(it && it.domain || ""));
  d.items = (d.items || []).filter(it => !isIntl(it));

  const scanUids = new Set((d.items||[]).map(it=>it.uid));
  const onlyInPool = [...poolUids].filter(u => u && !scanUids.has(u));
  const notePool = onlyInPool.length ? `<div class="mt-3 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">提示：号池中还有 ${onlyInPool.length} 个账号（如 ${esc(onlyInPool.slice(0,3).join("、"))}${onlyInPool.length>3?' 等':''}）本机登录目录里找不到对应 .info 文件——它们通常是其它设备导入或登录态已清理，不会出现在下方扫描列表，属于正常情况。</div>` : "";
  const scanTotal = (d.items||[]).length;
  const currentCount = (d.items||[]).filter(it=>it.is_active).length;
  const poolExisting = (d.items||[]).filter(it=>poolUids.has(it.uid)).length;

  const makeExpLabel = (it) => {
    const expired = it.expires_ts && it.expires_ts < Date.now();
    let label = it.expires_at || '-';
    if (it.expires_at && !expired && it.expires_ts) {
      const days = Math.floor((it.expires_ts - Date.now()) / 86400000);
      if (days < 365) label += ` · ${days}天后`;
    }
    return { expired, label };
  };

  const desktopRows = (d.items||[]).map(it => {
    const inPool = poolUids.has(it.uid);
    const shortUid = (it.uid||"").length > 12 ? it.uid.slice(0,8)+"..."+it.uid.slice(-4) : (it.uid||"-");
    const fileName = it.file ? it.file.replace(/^.*[\\\\/]/,'') : "-";
    const { expired, label } = makeExpLabel(it);
    return `
    <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <td class="px-3 py-2.5">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">${esc((it.nickname||"?").slice(0,1))}</div>
          <div class="min-w-0">
            <div class="text-sm font-medium text-slate-700 truncate" data-tooltip="${esc(it.nickname)}">${esc(it.nickname||"-")}</div>
            <div class="text-[11px] text-slate-400 truncate max-w-[220px]" data-tooltip="${esc(it.file)}">${esc(fileName)}</div>
            <div class="text-[11px] text-slate-400 font-mono truncate" data-tooltip="${esc(it.uid)}">${esc(shortUid)} · ${esc(it.domain||"-")}</div>
          </div>
        </div>
      </td>
      <td class="px-3 py-2.5 text-xs ${expired?'text-red-500 font-medium':'text-slate-500'}"><span class="whitespace-nowrap">${label}</span>${it.credential_error?`<div class="text-amber-600 mt-1">${esc(it.credential_error)}</div>`:''}</td>
      <td class="px-3 py-2.5 text-right">
        <div class="flex flex-wrap items-center justify-end gap-1.5">
          ${it.is_active?'<span class="px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-700">当前</span>':''}
          ${inPool?'<span class="px-2 py-0.5 rounded-full text-[10px] bg-indigo-100 text-indigo-700">号池已有</span>':''}
          <button onclick="importOne('${encodeURIComponent(it.file)}')" ${inPool?'disabled':''} class="${inPool?'text-slate-300 cursor-not-allowed border-slate-100 bg-slate-50':'text-indigo-600 hover:text-indigo-800 border-indigo-100 hover:bg-indigo-50'} text-xs font-medium px-2 py-1 rounded border">${ic(inPool?'check':'download','mr-1')}${inPool?'已导入':'导入'}</button>
        </div>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="3" class="px-3 py-8 text-center text-slate-400 text-sm">未发现 .info 登录文件</td></tr>`;

  const mobileCards = (d.items||[]).map(it => {
    const inPool = poolUids.has(it.uid);
    const shortUid = (it.uid||"").length > 12 ? it.uid.slice(0,8)+"..."+it.uid.slice(-4) : (it.uid||"-");
    const fileName = it.file ? it.file.replace(/^.*[\\\\/]/,'') : "-";
    const { expired, label } = makeExpLabel(it);
    return `
    <div class="px-3 py-3 border-b border-slate-100 last:border-0">
      <div class="flex items-start gap-2.5">
        <div class="w-9 h-9 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">${esc((it.nickname||"?").slice(0,1))}</div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-slate-700 truncate" data-tooltip="${esc(it.nickname)}">${esc(it.nickname||"-")}</div>
          <div class="text-[11px] text-slate-400 truncate" data-tooltip="${esc(it.file)}">${esc(fileName)}</div>
          <div class="text-[11px] text-slate-400 font-mono truncate">${esc(shortUid)} · ${esc(it.domain||"-")}</div>
          <div class="text-[11px] ${expired?'text-red-500 font-medium':'text-slate-500'} mt-0.5">Token 到期：${label}</div>
          ${it.credential_error?`<div class="text-[11px] text-amber-600 mt-1">${esc(it.credential_error)}</div>`:''}
          <div class="flex flex-wrap items-center gap-1.5 mt-2">
            ${it.is_active?'<span class="px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-700">当前</span>':''}
            ${inPool?'<span class="px-2 py-0.5 rounded-full text-[10px] bg-indigo-100 text-indigo-700">号池已有</span>':''}
            <button onclick="importOne('${encodeURIComponent(it.file)}')" ${inPool?'disabled':''} class="${inPool?'text-slate-300 cursor-not-allowed border-slate-100 bg-slate-50':'text-indigo-600 hover:text-indigo-800 border-indigo-100 hover:bg-indigo-50'} text-xs font-medium px-2 py-1 rounded border">${ic(inPool?'check':'download','mr-1')}${inPool?'已导入':'导入'}</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join("") || `<div class="px-3 py-8 text-center text-slate-400 text-sm">未发现 .info 登录文件</div>`;

  openModal(`
    <div class="flex flex-col md:flex-row md:items-start justify-between mb-3 gap-3">
      <div class="min-w-0">
        <h3 class="text-base font-bold text-slate-800 flex items-center gap-2"><span class="wb-icon text-indigo-500"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg></span> 扫描本机账号</h3>
        <p class="text-xs text-slate-500 mt-1 break-all">目录：<code class="bg-slate-100 px-1 rounded text-[11px]">${esc(d.dir)}</code>${d.active_uid?` · 当前 UID：<code class="bg-slate-100 px-1 rounded text-[11px]">${esc(d.active_uid.slice(0,12))}</code>`:''}</p>
      </div>
      <div class="flex flex-row flex-wrap gap-1.5 text-[10px] shrink-0">
        <span class="px-2 py-1 rounded-full bg-blue-50 text-blue-600 border border-blue-100">新发现 ${scanTotal}</span>
        <span class="px-2 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">当前 ${currentCount}</span>
        <span class="px-2 py-1 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">号池已有 ${poolExisting}</span>
      </div>
    </div>
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div class="scan-desktop overflow-x-auto max-h-72">
        <table class="tbl">
          <thead class="bg-slate-50 text-slate-500 text-left sticky top-0 z-10 shadow-sm"><tr>
            <th class="px-3 py-2 text-xs font-medium">账号</th><th class="px-3 py-2 text-xs font-medium whitespace-nowrap">Token 到期</th><th class="px-3 py-2 text-xs font-medium text-right">状态 / 操作</th>
          </tr></thead>
          <tbody>${desktopRows}</tbody>
        </table>
      </div>
      <div class="scan-mobile max-h-72 overflow-y-auto">${mobileCards}</div>
    </div>${notePool}
    <div class="flex flex-col md:flex-row justify-between items-stretch md:items-center mt-4 pt-3 border-t border-slate-100 gap-3">
      <span class="text-xs text-slate-400">导入后自动用真实昵称命名，并刷新余额；已导入账号会被跳过。</span>
      <div class="flex gap-2 justify-end">
        <button onclick="closeModal()" class="px-3 py-1.5 rounded-lg border text-sm hover:bg-slate-50">关闭</button>
        <button onclick="importAll()" class="px-3 py-1.5 rounded-lg btn-primary"><span class="wb-icon mr-1"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg></span>全部导入号池</button>
      </div>
    </div>`);
}
async function importOne(file){
  const r = await api("/api/accounts/import-local",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({files:[decodeURIComponent(file)]})});
  const d = await r.json().catch(()=>({}));
  if(r.ok){
    toast(d.skipped ? `该账号已在号池，已跳过` : `已导入 ${d.added||0} 个`,
          d.skipped ? "err" : "ok");
    closeModal(); loadAccounts();
  }
  else toast("导入失败","err");
}
async function importAll(){
  const r = await api("/api/accounts/import-local",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({all:true})});
  const d = await r.json().catch(()=>({}));
  if(r.ok){
    const parts = [`已导入 ${d.added||0} 个`];
    if(d.skipped) parts.push(`跳过 ${d.skipped} 个重复`);
    if(d.errors && d.errors.length) parts.push(`${d.errors.length} 个失败`);
    toast(parts.join("，"));
    closeModal(); loadAccounts();
  }
  else toast("导入失败","err");
  if(d.errors) console.warn(d.errors);
}
async function refreshAll(){
  // **只刷当前平台**：`_accData` 就是账号池按平台作用域取回来的那一份。
  // 原来 body 传空对象，后端 `refresh_batch` 会 `db.query(Account).all()`
  // 拿**全库** id，再用 WorkBuddy 的 backend 去刷 Trae / Qoder / Loomy ——
  // 每个号必然失败一次，账号一多就是「点了卡住」（2026-10-31 实测）。
  const ids = (_accData || []).map(a => Number(a.id)).filter(Boolean);
  if (!ids.length) { toast("当前平台没有可刷新的账号", "err"); return; }
  await runJob({title:`刷新 ${ids.length} 个账号的余额与到期快照`,
    submitUrl:'/api/accounts/refresh-batch', body:{account_ids: ids},
    label:item => item.account || item.account_id, detail:item => item.reason || '',
    amount:() => '', icon:item => item.ok ? '<span class="wb-icon text-emerald-500"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span>' : '<span class="wb-icon text-amber-600"><svg class="wb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="10"/></svg></span>',
    doneText:job => job.result?.summary || '刷新完成', summaryHtml:() => '',
    doneToast:job => job.result?.summary || '刷新完成',
    onFinish:() => { loadAccounts(); if (_creditStats) loadCreditStats();
                     if (window.WBPlatform) window.WBPlatform.refreshCounts(); }
  });
}

