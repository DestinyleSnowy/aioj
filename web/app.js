/* ═══════════════════════════════════════════════════════════════════════════
   AIOJ — AI Olympiad Judge  ·  Frontend SPA
   Complete rewrite — modern, clean, premium UI
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── Utilities ──────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const state = {
  token: localStorage.getItem('aioj_token') || '',
  user: null,
  healthOk: false,
  currentRoute: '',
  countdownTimer: null,
};

function setPage(title, subtitle = '') {
  $('pageTitle').textContent = title || 'AIOJ';
  $('pageSubtitle').textContent = subtitle || '';
  document.title = title ? `${title} — AIOJ` : 'AIOJ — AI Olympiad Judge';
}

function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const opts = { ...options, headers };
  if (!(opts.body instanceof FormData) && opts.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, opts);
  const ct = res.headers.get('content-type') || '';
  let payload;
  if (ct.includes('application/json')) {
    payload = await res.json();
  } else {
    payload = await res.text();
  }
  if (!res.ok) {
    const detail = typeof payload === 'object'
      ? (payload.detail || payload.message || JSON.stringify(payload))
      : payload;
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return payload;
}

async function tryApi(paths, options = {}) {
  let lastErr;
  for (const p of paths) {
    try { return await api(p, options); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No API candidates');
}

// ─── HTML helpers ───────────────────────────────────────────────────────────

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderMd(md) {
  let t = esc(md || '');
  t = t.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
  t = t.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  t = t.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  t = t.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  t = t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\n{2,}/g, '</p><p>');
  t = t.replace(/\n/g, '<br>');
  return `<div class="md-content"><p>${t}</p></div>`;
}

function statusPill(s) {
  s = String(s || '').toUpperCase();
  const cls =
    s === 'ACCEPTED' || s === 'PUBLIC' || s === 'RUNNING' || s === 'RUN_FINISHED' ? 'green' :
    s.includes('FAIL') || s === 'REJECTED' || s === 'ENDED' || s === 'ERROR' ? 'red' :
    s === 'PENDING' || s === 'UPCOMING' || s === 'DRAFT' || s === 'QUEUED' ? 'yellow' : 'gray';
  return `<span class="pill ${cls}">${esc(s || 'UNKNOWN')}</span>`;
}

function contestStateLabel(st) {
  return ({ UPCOMING: '未开始', RUNNING: '进行中', ENDED: '已结束', DRAFT: '草稿' })[st] || st || '未知';
}

function contestStatePill(st) {
  const s = String(st || '').toUpperCase();
  const cls = s === 'RUNNING' ? 'green' : s === 'ENDED' ? 'red' : s === 'UPCOMING' ? 'yellow' : 'gray';
  return `<span class="pill ${cls}">${esc(contestStateLabel(s))}</span>`;
}

function emptyBox(text) {
  return `<div class="empty-state"><div class="empty-icon">📭</div><p>${esc(text || '暂无数据')}</p></div>`;
}

function errorBox(err) {
  const msg = err && err.message ? err.message : String(err || 'Unknown error');
  return `<div class="notice error">${esc(msg)}</div>`;
}

function metricText(p) {
  return `${p.time_limit_sec || 60}s · ${p.memory_limit_mb || 2048}MB · ${p.cpu_count || 2} CPU`;
}

function scoreDisplay(score) {
  if (score === null || score === undefined) return '—';
  return Number(score).toFixed(4);
}

// ─── Toast Notifications ────────────────────────────────────────────────────

function toast(message, type = 'info', duration = 4000) {
  const container = $('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <div class="toast-content">
      <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ'}</span>
      <span class="toast-message">${esc(message)}</span>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-exit');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ─── Modal ──────────────────────────────────────────────────────────────────

function openModal({ title, body, footer = '', wide = false }) {
  $('modalTitle').textContent = title || '';
  $('modalBody').innerHTML = body || '';
  $('modalFooter').innerHTML = footer || '';
  const root = $('modalRoot');
  root.querySelector('.modal').classList.toggle('wide', !!wide);
  root.classList.add('open');
}

function closeModal() {
  $('modalRoot').classList.remove('open');
  $('modalBody').innerHTML = '';
  $('modalFooter').innerHTML = '';
}

// ─── Navigation ─────────────────────────────────────────────────────────────

function clearPageState() {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
  $('sidebar').classList.remove('open');
  $('sidebarOverlay').classList.remove('open');
}

function updateNav() {
  const path = location.pathname || '/';
  document.querySelectorAll('.nav-link').forEach((a) => {
    const route = a.dataset.route || '/';
    const active = route === '/' ? path === '/' : path.startsWith(route);
    a.classList.toggle('active', active);
  });
  const isAdmin = state.user && state.user.role === 'ADMIN';
  $('adminNav').style.display = isAdmin ? '' : 'none';

  $('userPill').style.display = state.user ? '' : 'none';
  $('userPill').textContent = state.user ? state.user.username : '';
  $('authBtn').style.display = state.user ? 'none' : '';
  $('logoutBtn').style.display = state.user ? '' : 'none';

  const footerEl = $('sidebarUser');
  if (state.user) {
    footerEl.innerHTML = `<span class="user-avatar">${esc(state.user.username[0].toUpperCase())}</span>
      <div><div class="text-primary">${esc(state.user.username)}</div>
      <div class="text-muted text-sm">${esc(state.user.role)}</div></div>`;
  } else {
    footerEl.innerHTML = '<span class="text-muted">未登录</span>';
  }
}

function navigate(path) {
  history.pushState(null, '', path);
  route();
}

function handleSpaLinkClick(e) {
  const link = e.target.closest('a[href]');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:') ||
      link.target === '_blank' || link.hasAttribute('download') ||
      href.startsWith('/api/') || href.startsWith('/health')) return;
  if (href.startsWith('#/')) {
    e.preventDefault();
    navigate(href.slice(1));
    return;
  }
  if (href.startsWith('/')) {
    e.preventDefault();
    navigate(href);
  }
}

// ─── Health Check ───────────────────────────────────────────────────────────

async function checkHealth() {
  const statusEl = $('apiStatus');
  try {
    await api('/health');
    state.healthOk = true;
    statusEl.classList.add('online');
    statusEl.querySelector('.status-text').textContent = '在线';
  } catch {
    state.healthOk = false;
    statusEl.classList.remove('online');
    statusEl.querySelector('.status-text').textContent = '离线';
  }
}

// ─── Auth ───────────────────────────────────────────────────────────────────

async function loadMe() {
  if (!state.token) { state.user = null; updateNav(); return; }
  try {
    const data = await api('/api/auth/me', { headers: authHeaders() });
    state.user = data.user || data;
    updateNav();
  } catch {
    state.token = '';
    localStorage.removeItem('aioj_token');
    state.user = null;
    updateNav();
  }
}

function showAuthModal(tab = 'login') {
  const body = `
    <div class="tabs" id="authTabs">
      <button class="tab ${tab === 'login' ? 'active' : ''}" onclick="switchAuthTab('login')">登录</button>
      <button class="tab ${tab === 'register' ? 'active' : ''}" onclick="switchAuthTab('register')">注册</button>
    </div>
    <div id="authLogin" style="${tab !== 'login' ? 'display:none' : ''}">
      <div class="form-group">
        <label for="loginUser">用户名或邮箱</label>
        <input type="text" id="loginUser" placeholder="请输入用户名或邮箱" autocomplete="username" />
      </div>
      <div class="form-group">
        <label for="loginPass">密码</label>
        <input type="password" id="loginPass" placeholder="请输入密码" autocomplete="current-password" />
      </div>
      <div id="loginError" class="notice error" style="display:none"></div>
    </div>
    <div id="authRegister" style="${tab !== 'register' ? 'display:none' : ''}">
      <div class="form-group">
        <label for="regUser">用户名</label>
        <input type="text" id="regUser" placeholder="请输入用户名" autocomplete="username" />
      </div>
      <div class="form-group">
        <label for="regEmail">邮箱 (可选)</label>
        <input type="email" id="regEmail" placeholder="请输入邮箱" autocomplete="email" />
      </div>
      <div class="form-group">
        <label for="regPass">密码</label>
        <input type="password" id="regPass" placeholder="请输入密码" autocomplete="new-password" />
      </div>
      <div id="regError" class="notice error" style="display:none"></div>
    </div>
  `;
  const footer = `
    <button class="button ghost" onclick="closeModal()">取消</button>
    <button class="button" id="authSubmitBtn" onclick="submitAuth()">确定</button>
  `;
  openModal({ title: '登录 / 注册', body, footer });

  // Enter key support
  setTimeout(() => {
    const inputs = $('modalBody').querySelectorAll('input');
    inputs.forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); }));
  }, 50);
}

function switchAuthTab(tab) {
  $('authLogin').style.display = tab === 'login' ? '' : 'none';
  $('authRegister').style.display = tab === 'register' ? '' : 'none';
  $('authTabs').querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
  });
}

function currentAuthTab() {
  return $('authLogin') && $('authLogin').style.display !== 'none' ? 'login' : 'register';
}

async function submitAuth() {
  const tab = currentAuthTab();
  const btn = $('authSubmitBtn');
  btn.disabled = true;
  btn.textContent = '处理中…';
  try {
    if (tab === 'login') {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username_or_email: $('loginUser').value.trim(),
          password: $('loginPass').value,
        }),
      });
      state.token = data.token || data.access_token;
      localStorage.setItem('aioj_token', state.token);
      await loadMe();
      closeModal();
      toast('登录成功', 'success');
      route();
    } else {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username: $('regUser').value.trim(),
          email: $('regEmail').value.trim() || undefined,
          password: $('regPass').value,
        }),
      });
      if (data.token || data.access_token) {
        state.token = data.token || data.access_token;
        localStorage.setItem('aioj_token', state.token);
        await loadMe();
        closeModal();
        toast('注册成功', 'success');
        route();
      } else {
        toast('注册成功，请登录', 'success');
        switchAuthTab('login');
        if ($('loginUser')) $('loginUser').value = $('regUser').value;
      }
    }
  } catch (err) {
    const errEl = tab === 'login' ? $('loginError') : $('regError');
    if (errEl) {
      errEl.style.display = '';
      errEl.textContent = err.message;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '确定';
  }
}

function logout() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('aioj_token');
  updateNav();
  toast('已退出登录', 'info');
  navigate('/');
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

async function renderDashboard() {
  setPage('概览', 'AI Olympiad Judge 平台总览');
  const app = $('app');
  app.innerHTML = `<div class="loading-overlay"><div class="spinner"></div><span>加载中…</span></div>`;

  try {
    const [problemsRes, contestsRes, subsRes] = await Promise.allSettled([
      api('/api/problems'),
      api('/api/contests'),
      state.token ? api('/api/my/submissions', { headers: authHeaders() }) : Promise.resolve({ items: [] }),
    ]);

    const problems = problemsRes.status === 'fulfilled' ? (problemsRes.value.items || []) : [];
    const contests = contestsRes.status === 'fulfilled' ? (contestsRes.value.items || []) : [];
    const submissions = subsRes.status === 'fulfilled' ? (subsRes.value.items || []) : [];

    const runningContests = contests.filter(c => c.state === 'RUNNING' || c.status === 'RUNNING');
    const upcomingContests = contests.filter(c => c.state === 'UPCOMING' || c.status === 'UPCOMING');

    app.innerHTML = `
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-value">${problems.length}</div>
          <div class="stat-label">题目总数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${contests.length}</div>
          <div class="stat-label">比赛总数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${runningContests.length}</div>
          <div class="stat-label">进行中比赛</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${submissions.length}</div>
          <div class="stat-label">我的提交</div>
        </div>
      </div>

      ${runningContests.length > 0 ? `
        <div class="card highlight mt-lg">
          <div class="card-header">
            <h3 class="card-title">🔥 正在进行的比赛</h3>
          </div>
          <div class="card-grid">
            ${runningContests.map(c => contestCard(c)).join('')}
          </div>
        </div>
      ` : ''}

      ${upcomingContests.length > 0 ? `
        <div class="card mt-lg">
          <div class="card-header">
            <h3 class="card-title">📅 即将开始的比赛</h3>
          </div>
          <div class="card-grid">
            ${upcomingContests.map(c => contestCard(c)).join('')}
          </div>
        </div>
      ` : ''}

      <div class="two-col mt-lg">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">题目列表</h3>
            <a href="/problems" class="button ghost sm" data-link>查看全部 →</a>
          </div>
          ${problems.length === 0 ? emptyBox('暂无题目') : `
            <div class="card-grid compact">
              ${problems.slice(0, 6).map(p => `
                <a href="/problems/${esc(p.slug)}" class="mini-card" data-link>
                  <div class="mini-card-title">${esc(p.title)}</div>
                  <div class="mini-card-meta">${esc(p.slug)} · ${esc(p.metric || '')}</div>
                </a>
              `).join('')}
            </div>
          `}
        </div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">最近提交</h3>
            <a href="/submissions" class="button ghost sm" data-link>查看全部 →</a>
          </div>
          ${submissions.length === 0 ? emptyBox('暂无提交记录') : `
            <div class="table-wrap">
              <table>
                <thead><tr><th>ID</th><th>题目</th><th>状态</th><th>得分</th><th>时间</th></tr></thead>
                <tbody>
                  ${submissions.slice(0, 8).map(s => `
                    <tr class="clickable-row" onclick="navigate('/submissions/${s.id}')">
                      <td>#${s.id}</td>
                      <td>${esc(s.problem_slug || s.problem_title || '')}</td>
                      <td>${statusPill(s.status)}</td>
                      <td>${scoreDisplay(s.public_score)}</td>
                      <td>${formatDate(s.created_at)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

function contestCard(c) {
  const st = c.state || c.status || '';
  return `
    <a href="/contests/${esc(c.slug)}" class="contest-card" data-link>
      <div class="contest-card-header">
        <span class="contest-card-title">${esc(c.title)}</span>
        ${contestStatePill(st)}
      </div>
      <div class="contest-card-meta">
        <span>${esc(c.slug)}</span>
        <span>${c.problem_count || 0} 题</span>
        ${c.start_at ? `<span>${formatDate(c.start_at)}</span>` : ''}
      </div>
    </a>
  `;
}

// ─── Problems ───────────────────────────────────────────────────────────────

async function renderProblems() {
  setPage('题库', '浏览所有公开题目');
  const app = $('app');
  app.innerHTML = `<div class="loading-overlay"><div class="spinner"></div><span>加载中…</span></div>`;
  try {
    const data = await api('/api/problems');
    const items = data.items || [];
    if (items.length === 0) {
      app.innerHTML = emptyBox('暂无公开题目');
      return;
    }
    app.innerHTML = `
      <div class="problem-grid">
        ${items.map(p => `
          <a href="/problems/${esc(p.slug)}" class="problem-card" data-link>
            <div class="problem-card-header">
              <h3 class="problem-card-title">${esc(p.title)}</h3>
              ${statusPill(p.status || 'PUBLIC')}
            </div>
            <div class="problem-card-slug">${esc(p.slug)}</div>
            <div class="problem-card-footer">
              <span class="pill blue">${esc(p.metric || 'accuracy')}</span>
              <span class="text-muted text-sm">${metricText(p)}</span>
            </div>
          </a>
        `).join('')}
      </div>
    `;
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

// ─── Problem Detail ─────────────────────────────────────────────────────────

async function renderProblemDetail(slug, contestSlug = null) {
  setPage('题目详情', slug);
  const app = $('app');
  app.innerHTML = `<div class="loading-overlay"><div class="spinner"></div><span>加载中…</span></div>`;
  try {
    const [problem, subsData] = await Promise.all([
      api(`/api/problems/${slug}`),
      loadProblemSubmissions(slug, contestSlug),
    ]);
    const subs = subsData.items || [];

    app.innerHTML = `
      ${contestSlug ? `
        <a href="/contests/${esc(contestSlug)}" class="breadcrumb" data-link>← 返回比赛 ${esc(contestSlug)}</a>
      ` : ''}
      <div class="problem-layout">
        <div class="problem-main">
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">${esc(problem.title)}</h2>
              <div class="row gap-sm">
                <span class="pill blue">${esc(problem.metric || 'accuracy')}</span>
                ${statusPill(problem.status || 'PUBLIC')}
              </div>
            </div>
            <div class="card-body">
              ${renderMd(problem.statement_md)}
            </div>
          </div>

          <div class="card mt-lg">
            <div class="card-header">
              <h3 class="card-title">提交记录</h3>
            </div>
            ${subs.length === 0 ? emptyBox('暂无提交') : `
              <div class="table-wrap">
                <table>
                  <thead><tr><th>ID</th><th>用户</th><th>状态</th><th>公开分</th><th>耗时</th><th>提交时间</th></tr></thead>
                  <tbody>
                    ${subs.map(s => `
                      <tr class="clickable-row" onclick="navigate('/submissions/${s.id}')">
                        <td>#${s.id}</td>
                        <td>${esc(s.username || '—')}</td>
                        <td>${statusPill(s.status)}</td>
                        <td>${scoreDisplay(s.public_score)}</td>
                        <td>${s.runtime_ms != null ? s.runtime_ms + 'ms' : '—'}</td>
                        <td>${formatDate(s.created_at)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>

        <div class="problem-side">
          <div class="card">
            <h3 class="card-title mb-md">提交方案</h3>
            <div class="file-upload" id="uploadArea">
              <input type="file" id="submitFile" accept=".zip" />
              <div class="file-upload-label">
                <span class="file-upload-icon">📁</span>
                <span>选择 .zip 文件</span>
              </div>
            </div>
            <button class="button mt-md full-width" onclick="submitSolution('${esc(slug)}', ${contestSlug ? `'${esc(contestSlug)}'` : 'null'})">
              提交
            </button>
            <a href="/api/problems/${esc(slug)}/sample-submission" target="_blank" class="button ghost sm mt-sm full-width">
              📥 下载示例提交
            </a>
          </div>

          <div class="card mt-md">
            <h3 class="card-title mb-md">评测配置</h3>
            <div class="config-list">
              <div class="config-item"><span class="config-label">评测指标</span><span>${esc(problem.metric || 'accuracy')}</span></div>
              <div class="config-item"><span class="config-label">优化方向</span><span>${problem.higher_is_better ? '越高越好 ↑' : '越低越好 ↓'}</span></div>
              <div class="config-item"><span class="config-label">时间限制</span><span>${problem.time_limit_sec || 60}s</span></div>
              <div class="config-item"><span class="config-label">内存限制</span><span>${problem.memory_limit_mb || 2048}MB</span></div>
              <div class="config-item"><span class="config-label">CPU 数量</span><span>${problem.cpu_count || 2}</span></div>
              <div class="config-item"><span class="config-label">输出限制</span><span>${problem.output_limit_mb || 64}MB</span></div>
            </div>
          </div>

          <div class="card mt-md">
            <div class="card-header">
              <h3 class="card-title">排行榜</h3>
            </div>
            <div id="problemLeaderboard"><div class="spinner"></div></div>
          </div>
        </div>
      </div>
    `;

    // Load leaderboard
    loadProblemLeaderboard(slug);
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

async function loadProblemSubmissions(slug, contestSlug) {
  try {
    if (contestSlug && state.token) {
      return await api(`/api/contests/${contestSlug}/submissions?limit=50`, { headers: authHeaders() });
    }
    return await api(`/api/problems/${slug}/submissions`, { headers: authHeaders() });
  } catch {
    return { items: [] };
  }
}

async function loadProblemLeaderboard(slug) {
  const el = $('problemLeaderboard');
  if (!el) return;
  try {
    const data = await api(`/api/problems/${slug}/leaderboard`);
    const items = data.items || [];
    if (items.length === 0) {
      el.innerHTML = `<div class="text-muted text-sm text-center">暂无排行</div>`;
      return;
    }
    el.innerHTML = `
      <div class="leaderboard-mini">
        ${items.slice(0, 10).map((e, i) => `
          <div class="lb-row ${i < 3 ? 'lb-top' : ''}">
            <span class="lb-rank">${i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1)}</span>
            <span class="lb-name">${esc(e.username)}</span>
            <span class="lb-score">${scoreDisplay(e.public_score)}</span>
          </div>
        `).join('')}
      </div>
    `;
  } catch {
    el.innerHTML = `<div class="text-muted text-sm">排行榜加载失败</div>`;
  }
}

async function submitSolution(slug, contestSlug) {
  const fileInput = $('submitFile');
  if (!fileInput || !fileInput.files.length) {
    toast('请选择一个 .zip 文件', 'warning');
    return;
  }
  if (!state.token) {
    showAuthModal();
    return;
  }
  const fd = new FormData();
  fd.append('file', fileInput.files[0]);
  if (contestSlug) fd.append('contest_slug', contestSlug);
  try {
    const data = await api(`/api/problems/${slug}/submissions`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    });
    toast('提交成功', 'success');
    navigate(`/submissions/${data.submission_id || data.id}`);
  } catch (err) {
    toast(`提交失败: ${err.message}`, 'error');
  }
}

// ─── Contests ───────────────────────────────────────────────────────────────

async function renderContests() {
  setPage('比赛', '参加 AI/ML 竞赛');
  const app = $('app');
  app.innerHTML = `<div class="loading-overlay"><div class="spinner"></div><span>加载中…</span></div>`;
  try {
    const data = await api('/api/contests');
    const items = data.items || [];
    if (items.length === 0) {
      app.innerHTML = emptyBox('暂无比赛');
      return;
    }
    // Group by state
    const running = items.filter(c => (c.state || c.status) === 'RUNNING');
    const upcoming = items.filter(c => (c.state || c.status) === 'UPCOMING');
    const ended = items.filter(c => (c.state || c.status) === 'ENDED');
    const draft = items.filter(c => (c.state || c.status) === 'DRAFT');
    const other = items.filter(c => !['RUNNING', 'UPCOMING', 'ENDED', 'DRAFT'].includes(c.state || c.status));

    const renderSection = (title, list) => list.length === 0 ? '' : `
      <h3 class="section-title">${title}</h3>
      <div class="contest-grid">
        ${list.map(c => contestCard(c)).join('')}
      </div>
    `;

    app.innerHTML = `
      ${renderSection('🔥 进行中', running)}
      ${renderSection('📅 即将开始', upcoming)}
      ${renderSection('🏁 已结束', ended)}
      ${renderSection('📝 草稿', draft)}
      ${renderSection('其他', other)}
    `;
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

// ─── Contest Detail ─────────────────────────────────────────────────────────

async function renderContestDetail(slug) {
  setPage('比赛详情', slug);
  const app = $('app');
  app.innerHTML = `<div class="loading-overlay"><div class="spinner"></div><span>加载中…</span></div>`;
  try {
    const results = await Promise.allSettled([
      api(`/api/contests/${slug}`),
      api(`/api/contests/${slug}/access`, { headers: authHeaders() }),
      api(`/api/contests/${slug}/stats`),
      api(`/api/contests/${slug}/announcements`),
      api(`/api/contests/${slug}/questions`, { headers: authHeaders() }).catch(() => ({ items: [] })),
      state.token ? api(`/api/contests/${slug}/submissions?show_all=true`, { headers: authHeaders() }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      api(`/api/contests/${slug}/problem-stats`).catch(() => ({ items: [] })),
    ]);

    const contest = results[0].status === 'fulfilled' ? results[0].value : null;
    if (!contest) throw new Error('比赛不存在');

    const access = results[1].status === 'fulfilled' ? results[1].value : {};
    const stats = results[2].status === 'fulfilled' ? results[2].value : {};
    const announcements = results[3].status === 'fulfilled' ? (results[3].value.items || []) : [];
    const questions = results[4].status === 'fulfilled' ? (results[4].value.items || []) : [];
    const submissions = results[5].status === 'fulfilled' ? (results[5].value.items || []) : [];
    const problemStats = results[6].status === 'fulfilled' ? (results[6].value.items || []) : [];

    const st = contest.state || contest.status || '';
    const problems = contest.problems || [];
    const canViewProblems = access.can_view_problems !== false;
    const participantStatus = access.participant_status || access.status || null;
    const isParticipant = participantStatus === 'ACCEPTED';

    setPage(contest.title, contestStateLabel(st));

    app.innerHTML = `
      <div class="contest-detail">
        <!-- Contest Header -->
        <div class="card glass highlight">
          <div class="contest-header-row">
            <div>
              <h2 class="contest-title">${esc(contest.title)}</h2>
              <div class="row gap-sm mt-sm">
                ${contestStatePill(st)}
                <span class="pill gray">${esc(contest.slug)}</span>
                ${contest.visibility ? `<span class="pill blue">${esc(contest.visibility)}</span>` : ''}
                ${contest.registration_mode ? `<span class="pill gray">${esc(contest.registration_mode)}</span>` : ''}
              </div>
            </div>
            <div class="contest-actions" id="contestActions">
              ${renderContestActions(contest, access, participantStatus, isParticipant, slug)}
            </div>
          </div>

          <!-- Countdown -->
          <div id="contestCountdown" class="countdown mt-md"></div>

          <!-- Stats row -->
          <div class="contest-stats mt-md">
            <div class="contest-stat"><span class="contest-stat-value">${stats.participant_count || access.participant_counts?.accepted_count || 0}</span><span class="contest-stat-label">参赛者</span></div>
            <div class="contest-stat"><span class="contest-stat-value">${stats.submission_count || 0}</span><span class="contest-stat-label">提交数</span></div>
            <div class="contest-stat"><span class="contest-stat-value">${stats.accepted_count || 0}</span><span class="contest-stat-label">通过数</span></div>
            <div class="contest-stat"><span class="contest-stat-value">${problems.length}</span><span class="contest-stat-label">题目数</span></div>
          </div>

          <!-- Date info -->
          <div class="contest-dates mt-md">
            ${contest.start_at ? `<span>🕐 开始: ${formatDate(contest.start_at)}</span>` : ''}
            ${contest.end_at ? `<span>🏁 结束: ${formatDate(contest.end_at)}</span>` : ''}
          </div>

          ${contest.description_md ? `<div class="mt-md">${renderMd(contest.description_md)}</div>` : ''}
        </div>

        <!-- Tabs Navigation -->
        <div class="tabs mt-lg" id="contestTabs">
          <button class="tab active" onclick="showContestTab('problems')">题目</button>
          <button class="tab" onclick="showContestTab('scoreboard')">排行榜</button>
          <button class="tab" onclick="showContestTab('submissions')">提交</button>
          <button class="tab" onclick="showContestTab('announcements')">公告 ${announcements.length > 0 ? `<span class="badge">${announcements.length}</span>` : ''}</button>
          <button class="tab" onclick="showContestTab('questions')">答疑 ${questions.length > 0 ? `<span class="badge">${questions.length}</span>` : ''}</button>
        </div>

        <!-- Tab Content -->
        <div id="contestTabContent">
          <!-- Problems Tab (default) -->
          <div class="tab-panel active" id="tab-problems">
            ${!canViewProblems ? emptyBox('题目在比赛开始前不可见') : problems.length === 0 ? emptyBox('暂无题目') : `
              <div class="problem-grid">
                ${problems.map(p => {
                  const ps = problemStats.find(s => s.slug === p.slug || s.id === p.id) || {};
                  return `
                    <a href="/contests/${esc(slug)}/problems/${esc(p.slug)}" class="problem-card" data-link>
                      <div class="problem-card-header">
                        <h3 class="problem-card-title">${esc(p.title)}</h3>
                      </div>
                      <div class="problem-card-slug">${esc(p.slug)}</div>
                      <div class="problem-card-footer">
                        <span class="text-muted text-sm">${ps.solved_users || 0} 人通过</span>
                        <span class="text-muted text-sm">${ps.submissions || 0} 次提交</span>
                      </div>
                    </a>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <!-- Scoreboard Tab -->
          <div class="tab-panel" id="tab-scoreboard">
            <div id="scoreboardContent"><div class="loading-overlay"><div class="spinner"></div><span>加载排行榜…</span></div></div>
          </div>

          <!-- Submissions Tab -->
          <div class="tab-panel" id="tab-submissions">
            ${submissions.length === 0 ? emptyBox('暂无提交记录') : `
              <div class="table-wrap">
                <table>
                  <thead><tr><th>ID</th><th>题目</th><th>状态</th><th>公开分</th><th>耗时</th><th>时间</th></tr></thead>
                  <tbody>
                    ${submissions.map(s => `
                      <tr class="clickable-row" onclick="navigate('/submissions/${s.id}')">
                        <td>#${s.id}</td>
                        <td>${esc(s.problem_slug || s.problem_title || '')}</td>
                        <td>${statusPill(s.status)}</td>
                        <td>${scoreDisplay(s.public_score)}</td>
                        <td>${s.runtime_ms != null ? s.runtime_ms + 'ms' : '—'}</td>
                        <td>${formatDate(s.created_at)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>

          <!-- Announcements Tab -->
          <div class="tab-panel" id="tab-announcements">
            ${announcements.length === 0 ? emptyBox('暂无公告') : announcements.map(a => `
              <div class="card mb-md">
                <div class="card-header">
                  <h4 class="card-title">${esc(a.title)}</h4>
                  <span class="text-muted text-sm">${formatDate(a.created_at)}</span>
                </div>
                <div class="card-body">${renderMd(a.body_md)}</div>
              </div>
            `).join('')}
          </div>

          <!-- Questions Tab -->
          <div class="tab-panel" id="tab-questions">
            ${isParticipant || (state.user && state.user.role === 'ADMIN') ? `
              <button class="button sm mb-md" onclick="showAskQuestionModal('${esc(slug)}')">✏️ 提问</button>
            ` : ''}
            ${questions.length === 0 ? emptyBox('暂无问题') : questions.map(q => `
              <div class="card mb-md ${q.is_public ? '' : 'card-private'}">
                <div class="card-header">
                  <div>
                    <h4 class="card-title">${esc(q.title)}</h4>
                    <div class="row gap-sm mt-xs">
                      <span class="text-muted text-sm">${esc(q.username || '匿名')}</span>
                      <span class="text-muted text-sm">${formatDate(q.created_at)}</span>
                      ${statusPill(q.status)}
                      ${q.is_public ? '<span class="pill blue">公开</span>' : '<span class="pill gray">私密</span>'}
                    </div>
                  </div>
                  ${state.user && state.user.role === 'ADMIN' ? `
                    <div class="row gap-sm">
                      <button class="button ghost sm" onclick="showAnswerQuestionModal('${esc(slug)}', ${q.id})">回复</button>
                      ${q.status !== 'CLOSED' ? `<button class="button ghost sm danger" onclick="closeQuestion('${esc(slug)}', ${q.id})">关闭</button>` : ''}
                    </div>
                  ` : ''}
                </div>
                ${q.can_view_body !== false ? `
                  <div class="card-body">
                    ${renderMd(q.body_md)}
                    ${q.answer_md ? `
                      <div class="answer-block mt-md">
                        <div class="answer-label">📝 回复</div>
                        ${renderMd(q.answer_md)}
                      </div>
                    ` : ''}
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    // Start countdown
    startContestCountdown(contest);
    // Load scoreboard in background
    loadContestScoreboard(slug, contest);
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

function renderContestActions(contest, access, participantStatus, isParticipant, slug) {
  const st = contest.state || contest.status || '';
  if (!state.user) {
    return `<button class="button" onclick="showAuthModal()">登录参赛</button>`;
  }
  if (isParticipant) {
    return `
      <span class="pill green">已参赛</span>
      <button class="button ghost sm danger" onclick="leaveContest('${esc(slug)}')">退出比赛</button>
    `;
  }
  if (participantStatus === 'PENDING') {
    return `<span class="pill yellow">审核中</span>`;
  }
  if (participantStatus === 'REJECTED') {
    const canReregister = access.allow_join_after_start !== false || st !== 'RUNNING';
    return `
      <span class="pill red">已拒绝</span>
      ${canReregister ? `<button class="button sm" onclick="joinContest('${esc(slug)}', '${esc(contest.registration_mode || 'OPEN')}')">重新报名</button>` : ''}
    `;
  }
  // Not registered
  return `<button class="button" onclick="joinContest('${esc(slug)}', '${esc(contest.registration_mode || 'OPEN')}')">报名参赛</button>`;
}

function showContestTab(tabName) {
  document.querySelectorAll('#contestTabs .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const tabBtn = document.querySelector(`#contestTabs .tab[onclick*="'${tabName}'"]`);
  if (tabBtn) tabBtn.classList.add('active');
  const panel = $(`tab-${tabName}`);
  if (panel) panel.classList.add('active');
}

async function joinContest(slug, registrationMode) {
  if (!state.token) { showAuthModal(); return; }
  if (registrationMode === 'INVITE') {
    showInviteCodeModal(slug);
    return;
  }
  try {
    await tryApi(
      [`/api/contests/${slug}/register`, `/api/contests/${slug}/join`],
      { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: '{}' }
    );
    toast('报名成功', 'success');
    renderContestDetail(slug);
  } catch (err) {
    toast(`报名失败: ${err.message}`, 'error');
  }
}

function showInviteCodeModal(slug) {
  openModal({
    title: '输入邀请码',
    body: `
      <div class="form-group">
        <label for="inviteCode">邀请码</label>
        <input type="text" id="inviteCode" placeholder="请输入邀请码" />
      </div>
      <div id="inviteError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="button ghost" onclick="closeModal()">取消</button>
      <button class="button" onclick="submitInviteCode('${esc(slug)}')">确定</button>
    `,
  });
}

async function submitInviteCode(slug) {
  const code = $('inviteCode')?.value?.trim();
  if (!code) { toast('请输入邀请码', 'warning'); return; }
  try {
    await api(`/api/contests/${slug}/join`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ invite_code: code }),
    });
    closeModal();
    toast('报名成功', 'success');
    renderContestDetail(slug);
  } catch (err) {
    const el = $('inviteError');
    if (el) { el.style.display = ''; el.textContent = err.message; }
  }
}

async function leaveContest(slug) {
  if (!confirm('确定要退出比赛吗？')) return;
  try {
    await api(`/api/contests/${slug}/leave`, { method: 'POST', headers: authHeaders() });
    toast('已退出比赛', 'info');
    renderContestDetail(slug);
  } catch (err) {
    toast(`退出失败: ${err.message}`, 'error');
  }
}

// Contest countdown
function startContestCountdown(contest) {
  const st = contest.state || contest.status || '';
  const el = $('contestCountdown');
  if (!el) return;

  function updateCountdown() {
    const now = Date.now();
    let targetTime, label;
    if (st === 'UPCOMING' && contest.start_at) {
      targetTime = new Date(contest.start_at).getTime();
      label = '距离开始';
    } else if (st === 'RUNNING' && contest.end_at) {
      targetTime = new Date(contest.end_at).getTime();
      label = '距离结束';
    } else {
      el.innerHTML = st === 'ENDED' ? '<div class="countdown-ended">比赛已结束</div>' : '';
      return false;
    }
    const diff = targetTime - now;
    if (diff <= 0) {
      el.innerHTML = `<div class="countdown-ended">${label === '距离开始' ? '比赛已开始' : '比赛已结束'}</div>`;
      return false;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.innerHTML = `
      <span class="countdown-label">${esc(label)}</span>
      <div class="countdown-digits">
        ${d > 0 ? `<div class="cd-unit"><span class="cd-value">${d}</span><span class="cd-label">天</span></div>` : ''}
        <div class="cd-unit"><span class="cd-value">${String(h).padStart(2, '0')}</span><span class="cd-label">时</span></div>
        <div class="cd-unit"><span class="cd-value">${String(m).padStart(2, '0')}</span><span class="cd-label">分</span></div>
        <div class="cd-unit"><span class="cd-value">${String(s).padStart(2, '0')}</span><span class="cd-label">秒</span></div>
      </div>
    `;
    return true;
  }

  if (updateCountdown()) {
    state.countdownTimer = setInterval(() => {
      if (!updateCountdown()) clearInterval(state.countdownTimer);
    }, 1000);
  }
}

// Contest scoreboard
async function loadContestScoreboard(slug, contest) {
  const el = $('scoreboardContent');
  if (!el) return;
  try {
    let data;
    try {
      data = await api(`/api/contests/${slug}/scoreboard-advanced`, { headers: authHeaders() });
    } catch {
      try {
        data = await api(`/api/contests/${slug}/scoreboard`, { headers: authHeaders() });
      } catch {
        data = await api(`/api/contests/${slug}/leaderboard`);
      }
    }
    const items = data.items || [];
    const mode = data.mode || contest?.scoreboard_mode || 'SCORE';

    if (items.length === 0) {
      el.innerHTML = emptyBox('暂无排行数据');
      return;
    }

    if (mode === 'ACM') {
      el.innerHTML = renderAcmScoreboard(items, data);
    } else {
      el.innerHTML = renderScoreScoreboard(items, data);
    }
  } catch (err) {
    el.innerHTML = `<div class="notice warning">排行榜暂不可用: ${esc(err.message)}</div>`;
  }
}

function renderScoreScoreboard(items, data) {
  const showPrivate = data.show_private === true;
  return `
    ${data.is_frozen ? '<div class="notice warning mb-md">🧊 排行榜已冻结</div>' : ''}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>排名</th><th>用户</th><th>已解决</th><th>公开分</th>
            ${showPrivate ? '<th>最终分</th>' : ''}
            ${(items[0]?.problems || []).map(p => `<th>${esc(p.slug || p.title || '')}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${items.map(r => `
            <tr>
              <td><strong>${r.rank || ''}</strong></td>
              <td>${esc(r.username)}</td>
              <td>${r.solved || 0}</td>
              <td>${scoreDisplay(r.total_public_score)}</td>
              ${showPrivate ? `<td>${scoreDisplay(r.total_private_score)}</td>` : ''}
              ${(r.problems || []).map(p => `
                <td class="${p.solved ? 'cell-solved' : p.attempts > 0 ? 'cell-attempted' : ''}">
                  ${p.visible_score != null ? scoreDisplay(p.visible_score) : (p.solved ? '✓' : p.attempts > 0 ? `−${p.attempts}` : '')}
                </td>
              `).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderAcmScoreboard(items, data) {
  return `
    ${data.is_frozen ? '<div class="notice warning mb-md">🧊 排行榜已冻结</div>' : ''}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>排名</th><th>用户</th><th>已解决</th><th>罚时</th>
            ${(items[0]?.problems || []).map(p => `<th>${esc(p.slug || p.title || '')}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${items.map(r => `
            <tr>
              <td><strong>${r.rank || ''}</strong></td>
              <td>${esc(r.username)}</td>
              <td>${r.solved || 0}</td>
              <td>${r.penalty || 0}</td>
              ${(r.problems || []).map(p => `
                <td class="${p.solved ? 'cell-solved' : p.attempts > 0 ? 'cell-attempted' : ''}">
                  ${p.solved ? `✓ (${p.penalty || 0})` : p.attempts > 0 ? `−${p.attempts}` : ''}
                </td>
              `).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// Contest Q&A
function showAskQuestionModal(slug) {
  openModal({
    title: '提问',
    body: `
      <div class="form-group">
        <label for="qTitle">标题</label>
        <input type="text" id="qTitle" placeholder="问题标题" />
      </div>
      <div class="form-group">
        <label for="qBody">内容 (Markdown)</label>
        <textarea id="qBody" placeholder="详细描述你的问题…" rows="6"></textarea>
      </div>
      <div id="qError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="button ghost" onclick="closeModal()">取消</button>
      <button class="button" onclick="submitQuestion('${esc(slug)}')">提交</button>
    `,
  });
}

async function submitQuestion(slug) {
  const title = $('qTitle')?.value?.trim();
  const body = $('qBody')?.value?.trim();
  if (!title) { toast('请输入标题', 'warning'); return; }
  try {
    await api(`/api/contests/${slug}/questions`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body_md: body || '' }),
    });
    closeModal();
    toast('提问成功', 'success');
    renderContestDetail(slug);
  } catch (err) {
    const el = $('qError');
    if (el) { el.style.display = ''; el.textContent = err.message; }
  }
}

function showAnswerQuestionModal(slug, questionId) {
  openModal({
    title: '回复问题',
    body: `
      <div class="form-group">
        <label for="answerMd">回复内容 (Markdown)</label>
        <textarea id="answerMd" placeholder="输入回复…" rows="6"></textarea>
      </div>
      <div class="form-group">
        <label><input type="checkbox" id="answerPublic" /> 公开此回复</label>
      </div>
      <div id="answerError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="button ghost" onclick="closeModal()">取消</button>
      <button class="button" onclick="submitAnswer('${esc(slug)}', ${questionId})">提交回复</button>
    `,
  });
}

async function submitAnswer(slug, questionId) {
  const answer = $('answerMd')?.value?.trim();
  const isPublic = $('answerPublic')?.checked || false;
  if (!answer) { toast('请输入回复内容', 'warning'); return; }
  try {
    await api(`/api/admin/contests/${slug}/questions/${questionId}/answer`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer_md: answer, is_public: isPublic }),
    });
    closeModal();
    toast('回复成功', 'success');
    renderContestDetail(slug);
  } catch (err) {
    const el = $('answerError');
    if (el) { el.style.display = ''; el.textContent = err.message; }
  }
}

async function closeQuestion(slug, questionId) {
  if (!confirm('确定关闭此问题？')) return;
  try {
    await api(`/api/admin/contests/${slug}/questions/${questionId}/close`, {
      method: 'POST', headers: authHeaders(),
    });
    toast('问题已关闭', 'info');
    renderContestDetail(slug);
  } catch (err) {
    toast(`操作失败: ${err.message}`, 'error');
  }
}

// ─── Submissions ────────────────────────────────────────────────────────────

async function renderSubmissions() {
  setPage('提交记录', '查看所有提交');
  const app = $('app');
  app.innerHTML = `<div class="loading-overlay"><div class="spinner"></div><span>加载中…</span></div>`;
  try {
    let data;
    if (state.user && state.user.role === 'ADMIN') {
      data = await api('/api/admin/submissions/recent', { headers: authHeaders() });
    } else if (state.token) {
      data = await api('/api/my/submissions', { headers: authHeaders() });
    } else {
      app.innerHTML = `<div class="notice info">请<button class="button ghost sm" onclick="showAuthModal()">登录</button>查看提交记录</div>`;
      return;
    }
    const items = data.items || [];
    if (items.length === 0) {
      app.innerHTML = emptyBox('暂无提交');
      return;
    }
    app.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>题目</th><th>用户</th><th>状态</th><th>公开分</th>
              <th>最终分</th><th>耗时</th><th>内存</th><th>提交时间</th><th>评测时间</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(s => `
              <tr class="clickable-row" onclick="navigate('/submissions/${s.id}')">
                <td>#${s.id}</td>
                <td>${esc(s.problem_slug || '')}</td>
                <td>${esc(s.username || '—')}</td>
                <td>${statusPill(s.status)}</td>
                <td>${scoreDisplay(s.public_score)}</td>
                <td>${scoreDisplay(s.private_score)}</td>
                <td>${s.runtime_ms != null ? s.runtime_ms + 'ms' : '—'}</td>
                <td>${s.memory_peak_mb != null ? s.memory_peak_mb + 'MB' : '—'}</td>
                <td>${formatDate(s.created_at)}</td>
                <td>${formatDate(s.judged_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

// ─── Submission Detail ──────────────────────────────────────────────────────

async function renderSubmissionDetail(id) {
  setPage('提交详情', `#${id}`);
  const app = $('app');
  app.innerHTML = `<div class="loading-overlay"><div class="spinner"></div><span>加载中…</span></div>`;
  try {
    const sub = await api(`/api/submissions/${id}`, { headers: authHeaders() });
    let logContent = '';
    try {
      const logData = await api(`/api/submissions/${id}/log`, { headers: authHeaders() });
      logContent = logData.log || '';
    } catch {}

    app.innerHTML = `
      <a href="/submissions" class="breadcrumb" data-link>← 返回提交列表</a>
      <div class="submission-layout">
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">提交 #${id}</h2>
            ${statusPill(sub.status)}
          </div>
          <div class="card-body">
            <div class="detail-grid">
              <div class="detail-item"><span class="detail-label">题目</span><span>${esc(sub.problem_slug || sub.problem_id || '')}</span></div>
              <div class="detail-item"><span class="detail-label">用户</span><span>${esc(sub.username || '—')}</span></div>
              <div class="detail-item"><span class="detail-label">公开分</span><span class="text-accent">${scoreDisplay(sub.public_score)}</span></div>
              <div class="detail-item"><span class="detail-label">最终分</span><span>${scoreDisplay(sub.private_score)}</span></div>
              <div class="detail-item"><span class="detail-label">运行时间</span><span>${sub.runtime_ms != null ? sub.runtime_ms + 'ms' : '—'}</span></div>
              <div class="detail-item"><span class="detail-label">内存峰值</span><span>${sub.memory_peak_mb != null ? sub.memory_peak_mb + 'MB' : '—'}</span></div>
              <div class="detail-item"><span class="detail-label">提交时间</span><span>${formatDate(sub.created_at)}</span></div>
              <div class="detail-item"><span class="detail-label">评测时间</span><span>${formatDate(sub.judged_at)}</span></div>
              ${sub.error_message ? `<div class="detail-item full"><span class="detail-label">错误信息</span><div class="notice error">${esc(sub.error_message)}</div></div>` : ''}
            </div>
          </div>
        </div>

        ${logContent ? `
          <div class="card mt-lg">
            <div class="card-header">
              <h3 class="card-title">运行日志</h3>
            </div>
            <div class="card-body">
              <pre class="log-output"><code>${esc(logContent)}</code></pre>
            </div>
          </div>
        ` : ''}

        <div class="row gap-md mt-lg">
          ${sub.problem_slug ? `<a href="/problems/${esc(sub.problem_slug)}" class="button ghost" data-link>查看题目</a>` : ''}
          <a href="/api/submissions/${id}/output" target="_blank" class="button ghost">📥 下载输出</a>
        </div>
      </div>
    `;

    // Auto-refresh if still judging
    if (['QUEUED', 'PENDING', 'JUDGING', 'RUNNING'].includes(sub.status)) {
      setTimeout(() => {
        if (location.pathname === `/submissions/${id}`) {
          renderSubmissionDetail(id);
        }
      }, 5000);
    }
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

// ─── Account ────────────────────────────────────────────────────────────────

async function renderAccount() {
  setPage('账号设置', '管理您的账号信息');
  const app = $('app');
  if (!state.user) {
    app.innerHTML = `<div class="notice info">请先<button class="button ghost sm" onclick="showAuthModal()">登录</button></div>`;
    return;
  }
  app.innerHTML = `
    <div class="max-w-md">
      <div class="card">
        <h3 class="card-title mb-lg">账号信息</h3>
        <div class="detail-grid">
          <div class="detail-item"><span class="detail-label">用户名</span><span>${esc(state.user.username)}</span></div>
          <div class="detail-item"><span class="detail-label">邮箱</span><span>${esc(state.user.email || '未设置')}</span></div>
          <div class="detail-item"><span class="detail-label">角色</span><span>${statusPill(state.user.role)}</span></div>
        </div>
      </div>

      <div class="card mt-lg">
        <h3 class="card-title mb-lg">修改密码</h3>
        <div class="form-group">
          <label for="oldPass">当前密码</label>
          <input type="password" id="oldPass" placeholder="请输入当前密码" />
        </div>
        <div class="form-group">
          <label for="newPass">新密码</label>
          <input type="password" id="newPass" placeholder="请输入新密码" />
        </div>
        <div id="pwdError" class="notice error" style="display:none"></div>
        <div id="pwdSuccess" class="notice success" style="display:none"></div>
        <button class="button mt-md" onclick="changePassword()">修改密码</button>
      </div>
    </div>
  `;
}

async function changePassword() {
  const oldPwd = $('oldPass')?.value;
  const newPwd = $('newPass')?.value;
  if (!oldPwd || !newPwd) { toast('请填写完整', 'warning'); return; }
  try {
    await tryApi(
      ['/api/auth/change-password', '/api/account/change-password'],
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
      }
    );
    const errEl = $('pwdError');
    if (errEl) errEl.style.display = 'none';
    const sucEl = $('pwdSuccess');
    if (sucEl) { sucEl.style.display = ''; sucEl.textContent = '密码修改成功'; }
    toast('密码修改成功', 'success');
    $('oldPass').value = '';
    $('newPass').value = '';
  } catch (err) {
    const errEl = $('pwdError');
    if (errEl) { errEl.style.display = ''; errEl.textContent = err.message; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ADMIN PAGES
// ═══════════════════════════════════════════════════════════════════════════

function requireAdmin() {
  if (!state.user || state.user.role !== 'ADMIN') {
    $('app').innerHTML = `
      <div class="notice error">
        <strong>权限不足</strong> — 需要管理员权限
      </div>
    `;
    return false;
  }
  return true;
}

// ─── Admin: Users ───────────────────────────────────────────────────────────

async function renderUsers() {
  setPage('用户管理', '管理平台用户');
  if (!requireAdmin()) return;
  const app = $('app');
  app.innerHTML = `<div class="loading-overlay"><div class="spinner"></div><span>加载中…</span></div>`;
  try {
    const data = await api('/api/admin/users', { headers: authHeaders() });
    const items = data.items || [];
    app.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">用户列表 (${items.length})</h3>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>用户名</th><th>邮箱</th><th>角色</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead>
            <tbody>
              ${items.map(u => `
                <tr>
                  <td>${u.id}</td>
                  <td><strong>${esc(u.username)}</strong></td>
                  <td>${esc(u.email || '—')}</td>
                  <td>${statusPill(u.role)}</td>
                  <td>${u.is_disabled ? '<span class="pill red">禁用</span>' : '<span class="pill green">正常</span>'}</td>
                  <td>${formatDate(u.created_at)}</td>
                  <td>
                    <div class="row gap-xs">
                      <button class="button ghost sm" onclick="toggleUserRole(${u.id}, '${u.role}')">${u.role === 'ADMIN' ? '降权' : '升权'}</button>
                      <button class="button ghost sm ${u.is_disabled ? 'success' : 'danger'}" onclick="toggleUserDisabled(${u.id}, ${u.is_disabled})">${u.is_disabled ? '启用' : '禁用'}</button>
                      <button class="button ghost sm" onclick="showResetPasswordModal(${u.id}, '${esc(u.username)}')">重置密码</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

async function toggleUserRole(userId, currentRole) {
  const newRole = currentRole === 'ADMIN' ? 'USER' : 'ADMIN';
  if (!confirm(`确定将此用户角色改为 ${newRole}？`)) return;
  try {
    await api(`/api/admin/users/${userId}/role`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    toast('角色已更新', 'success');
    renderUsers();
  } catch (err) {
    toast(`操作失败: ${err.message}`, 'error');
  }
}

async function toggleUserDisabled(userId, currentDisabled) {
  try {
    await api(`/api/admin/users/${userId}/disabled`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_disabled: !currentDisabled }),
    });
    toast(currentDisabled ? '用户已启用' : '用户已禁用', 'success');
    renderUsers();
  } catch (err) {
    toast(`操作失败: ${err.message}`, 'error');
  }
}

function showResetPasswordModal(userId, username) {
  openModal({
    title: `重置密码 — ${username}`,
    body: `
      <div class="form-group">
        <label for="newAdminPass">新密码</label>
        <input type="password" id="newAdminPass" placeholder="请输入新密码" />
      </div>
    `,
    footer: `
      <button class="button ghost" onclick="closeModal()">取消</button>
      <button class="button" onclick="resetUserPassword(${userId})">确认重置</button>
    `,
  });
}

async function resetUserPassword(userId) {
  const pwd = $('newAdminPass')?.value;
  if (!pwd) { toast('请输入新密码', 'warning'); return; }
  try {
    await api(`/api/admin/users/${userId}/password`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password: pwd }),
    });
    closeModal();
    toast('密码已重置', 'success');
  } catch (err) {
    toast(`操作失败: ${err.message}`, 'error');
  }
}

// ─── Admin: Problems ────────────────────────────────────────────────────────

async function renderProblemAdmin() {
  setPage('题目管理', '管理题目和版本');
  if (!requireAdmin()) return;
  const app = $('app');
  app.innerHTML = `<div class="loading-overlay"><div class="spinner"></div><span>加载中…</span></div>`;
  try {
    const data = await tryApi(['/api/admin/problems', '/api/problems'], { headers: authHeaders() });
    const items = data.items || [];
    app.innerHTML = `
      <div class="card mb-lg">
        <div class="card-header">
          <h3 class="card-title">导入题目包</h3>
        </div>
        <div class="card-body">
          <p class="text-muted text-sm mb-md">上传 .zip 格式题目包，包含 problem.yaml, statement.md, private/ 和 public/ 目录</p>
          <div class="row gap-md">
            <input type="file" id="problemZip" accept=".zip" />
            <button class="button" onclick="importProblem()">导入</button>
          </div>
          <div id="importResult" class="mt-md"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">题目列表 (${items.length})</h3>
        </div>
        ${items.length === 0 ? emptyBox('暂无题目') : `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Slug</th><th>标题</th><th>状态</th><th>版本数</th><th>操作</th></tr></thead>
              <tbody>
                ${items.map(p => `
                  <tr>
                    <td><strong>${esc(p.slug)}</strong></td>
                    <td>${esc(p.title)}</td>
                    <td>${statusPill(p.status)}</td>
                    <td>${p.versions || '—'}</td>
                    <td>
                      <div class="row gap-xs">
                        <a href="/problems/${esc(p.slug)}" class="button ghost sm" data-link>查看</a>
                        <button class="button ghost sm" onclick="setProblemStatus('${esc(p.slug)}', 'PUBLIC')">公开</button>
                        <button class="button ghost sm" onclick="setProblemStatus('${esc(p.slug)}', 'DRAFT')">草稿</button>
                        <button class="button ghost sm danger" onclick="setProblemStatus('${esc(p.slug)}', 'ARCHIVED')">归档</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

async function importProblem() {
  const fileInput = $('problemZip');
  if (!fileInput || !fileInput.files.length) { toast('请选择题目包', 'warning'); return; }
  const resultEl = $('importResult');
  resultEl.innerHTML = '<div class="spinner"></div>';
  try {
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    const data = await tryApi(
      ['/api/admin/problems/import', '/api/admin/problem-packages/import'],
      { method: 'POST', headers: authHeaders(), body: fd }
    );
    resultEl.innerHTML = `<div class="notice success">导入成功: ${esc(data.slug)} (v${esc(data.version || '')})</div>`;
    toast('题目导入成功', 'success');
    setTimeout(() => renderProblemAdmin(), 1500);
  } catch (err) {
    resultEl.innerHTML = `<div class="notice error">导入失败: ${esc(err.message)}</div>`;
  }
}

async function setProblemStatus(slug, status) {
  try {
    await api(`/api/admin/problems/${slug}/status`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    toast(`题目 ${slug} 已设为 ${status}`, 'success');
    renderProblemAdmin();
  } catch (err) {
    toast(`操作失败: ${err.message}`, 'error');
  }
}

// ─── Admin: Contests ────────────────────────────────────────────────────────

async function renderContestAdmin() {
  setPage('比赛管理', '创建和管理比赛');
  if (!requireAdmin()) return;
  const app = $('app');
  app.innerHTML = `<div class="loading-overlay"><div class="spinner"></div><span>加载中…</span></div>`;
  try {
    const data = await api('/api/admin/contests', { headers: authHeaders() });
    const items = data.items || [];
    app.innerHTML = `
      <div class="row flex-between mb-lg">
        <h3>比赛列表 (${items.length})</h3>
        <button class="button" onclick="showCreateContestModal()">+ 新建比赛</button>
      </div>

      ${items.length === 0 ? emptyBox('暂无比赛') : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Slug</th><th>标题</th><th>状态</th><th>题目</th><th>开始</th><th>结束</th><th>操作</th></tr></thead>
            <tbody>
              ${items.map(c => `
                <tr>
                  <td><strong>${esc(c.slug)}</strong></td>
                  <td>${esc(c.title)}</td>
                  <td>${contestStatePill(c.state || c.status)}</td>
                  <td>${c.problem_count || (c.problems || []).length || 0}</td>
                  <td>${formatDate(c.start_at)}</td>
                  <td>${formatDate(c.end_at)}</td>
                  <td>
                    <div class="row gap-xs flex-wrap">
                      <a href="/contests/${esc(c.slug)}" class="button ghost sm" data-link>查看</a>
                      <button class="button ghost sm" onclick="showContestSettingsModal('${esc(c.slug)}')">高级</button>
                      <button class="button ghost sm" onclick="showRegistrationModal('${esc(c.slug)}')">报名</button>
                      <button class="button ghost sm" onclick="showAnnouncementModal('${esc(c.slug)}')">公告</button>
                      <button class="button ghost sm" onclick="window.open('/api/admin/contests/${esc(c.slug)}/registrations.csv')">📥 注册CSV</button>
                      <button class="button ghost sm" onclick="window.open('/api/admin/contests/${esc(c.slug)}/scoreboard-advanced.csv')">📥 榜单CSV</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

function showCreateContestModal() {
  openModal({
    title: '新建比赛',
    wide: true,
    body: `
      <div class="form-row">
        <div class="form-group">
          <label for="cSlug">Slug (唯一标识)</label>
          <input type="text" id="cSlug" placeholder="例: spring-2026" />
        </div>
        <div class="form-group">
          <label for="cTitle">标题</label>
          <input type="text" id="cTitle" placeholder="例: 2026 春季 AI 赛" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="cStart">开始时间</label>
          <input type="datetime-local" id="cStart" />
        </div>
        <div class="form-group">
          <label for="cEnd">结束时间</label>
          <input type="datetime-local" id="cEnd" />
        </div>
      </div>
      <div class="form-group">
        <label for="cProblems">题目 Slugs (逗号或换行分隔)</label>
        <textarea id="cProblems" rows="3" placeholder="problem-a, problem-b"></textarea>
      </div>
      <div class="form-group">
        <label for="cDesc">描述 (Markdown)</label>
        <textarea id="cDesc" rows="5" placeholder="比赛描述…"></textarea>
      </div>
      <div id="createContestError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="button ghost" onclick="closeModal()">取消</button>
      <button class="button" onclick="createContest()">创建</button>
    `,
  });
}

async function createContest() {
  const slug = $('cSlug')?.value?.trim();
  const title = $('cTitle')?.value?.trim();
  if (!slug || !title) { toast('请填写 Slug 和标题', 'warning'); return; }
  const startAt = $('cStart')?.value ? new Date($('cStart').value).toISOString() : undefined;
  const endAt = $('cEnd')?.value ? new Date($('cEnd').value).toISOString() : undefined;
  const problemSlugs = ($('cProblems')?.value || '').split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  const desc = $('cDesc')?.value || '';
  try {
    await api('/api/admin/contests/upsert', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug, title, description_md: desc,
        start_at: startAt, end_at: endAt,
        problem_slugs: problemSlugs,
      }),
    });
    closeModal();
    toast('比赛创建成功', 'success');
    renderContestAdmin();
  } catch (err) {
    const el = $('createContestError');
    if (el) { el.style.display = ''; el.textContent = err.message; }
  }
}

async function showContestSettingsModal(slug) {
  try {
    const data = await api(`/api/admin/contests/${slug}/full-settings`, { headers: authHeaders() });
    const c = data.contest || {};
    const a = data.access || {};
    openModal({
      title: `比赛设置 — ${slug}`,
      wide: true,
      body: `
        <div class="form-row">
          <div class="form-group">
            <label for="csVisibility">可见性</label>
            <select id="csVisibility">
              <option value="PUBLIC" ${c.visibility === 'PUBLIC' ? 'selected' : ''}>PUBLIC</option>
              <option value="PRIVATE" ${c.visibility === 'PRIVATE' ? 'selected' : ''}>PRIVATE</option>
              <option value="UNLISTED" ${c.visibility === 'UNLISTED' ? 'selected' : ''}>UNLISTED</option>
            </select>
          </div>
          <div class="form-group">
            <label for="csRegMode">注册模式</label>
            <select id="csRegMode">
              <option value="OPEN" ${c.registration_mode === 'OPEN' ? 'selected' : ''}>OPEN</option>
              <option value="INVITE" ${c.registration_mode === 'INVITE' ? 'selected' : ''}>INVITE</option>
              <option value="APPROVAL" ${c.registration_mode === 'APPROVAL' ? 'selected' : ''}>APPROVAL</option>
              <option value="CLOSED" ${c.registration_mode === 'CLOSED' ? 'selected' : ''}>CLOSED</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="csScoreMode">排行榜模式</label>
            <select id="csScoreMode">
              <option value="SCORE" ${c.scoreboard_mode === 'SCORE' ? 'selected' : ''}>SCORE</option>
              <option value="ACM" ${c.scoreboard_mode === 'ACM' ? 'selected' : ''}>ACM</option>
            </select>
          </div>
          <div class="form-group">
            <label for="csInviteCode">邀请码</label>
            <input type="text" id="csInviteCode" value="${esc(c.invite_code || '')}" placeholder="留空则无需邀请码" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="csPenalty">ACM 罚时 (分钟)</label>
            <input type="number" id="csPenalty" value="${c.penalty_minutes || 20}" />
          </div>
          <div class="form-group">
            <label for="csFreeze">榜单冻结时间 (ISO)</label>
            <input type="text" id="csFreeze" value="${esc(c.freeze_at || '')}" placeholder="例: 2026-06-01T12:00:00Z" />
          </div>
        </div>
        <div class="form-group">
          <label class="checkbox-label"><input type="checkbox" id="csHideProblems" ${c.hide_problems_before_start ? 'checked' : ''} /> 开始前隐藏题目</label>
        </div>
        <div class="form-group">
          <label class="checkbox-label"><input type="checkbox" id="csAllowJoin" ${c.allow_join_after_start !== false ? 'checked' : ''} /> 允许开始后加入</label>
        </div>
        <div class="form-group">
          <label class="checkbox-label"><input type="checkbox" id="csShowScoreboard" ${c.scoreboard_visible !== false ? 'checked' : ''} /> 显示排行榜</label>
        </div>
        <div class="form-group">
          <label class="checkbox-label"><input type="checkbox" id="csEnableQA" ${c.questions_enabled !== false ? 'checked' : ''} /> 启用答疑</label>
        </div>
        <div class="form-group">
          <label class="checkbox-label"><input type="checkbox" id="csEnableAnn" ${c.announcements_enabled !== false ? 'checked' : ''} /> 启用公告</label>
        </div>
        <div class="form-group">
          <label class="checkbox-label"><input type="checkbox" id="csShowPrivate" ${c.show_private_after_end ? 'checked' : ''} /> 结束后显示最终分</label>
        </div>
        <div id="csError" class="notice error" style="display:none"></div>
      `,
      footer: `
        <button class="button ghost" onclick="closeModal()">取消</button>
        <button class="button" onclick="saveContestSettings('${esc(slug)}')">保存</button>
      `,
    });
  } catch (err) {
    toast(`加载设置失败: ${err.message}`, 'error');
  }
}

async function saveContestSettings(slug) {
  try {
    await api(`/api/admin/contests/${slug}/full-settings`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visibility: $('csVisibility')?.value,
        registration_mode: $('csRegMode')?.value,
        scoreboard_mode: $('csScoreMode')?.value,
        invite_code: $('csInviteCode')?.value || null,
        penalty_minutes: parseInt($('csPenalty')?.value) || 20,
        freeze_at: $('csFreeze')?.value || null,
        hide_problems_before_start: $('csHideProblems')?.checked,
        allow_join_after_start: $('csAllowJoin')?.checked,
        scoreboard_visible: $('csShowScoreboard')?.checked,
        questions_enabled: $('csEnableQA')?.checked,
        announcements_enabled: $('csEnableAnn')?.checked,
        show_private_after_end: $('csShowPrivate')?.checked,
      }),
    });
    closeModal();
    toast('设置已保存', 'success');
    renderContestAdmin();
  } catch (err) {
    const el = $('csError');
    if (el) { el.style.display = ''; el.textContent = err.message; }
  }
}

async function showRegistrationModal(slug) {
  try {
    const data = await api(`/api/admin/contests/${slug}/registrations`, { headers: authHeaders() });
    const items = data.items || [];
    openModal({
      title: `报名管理 — ${slug}`,
      wide: true,
      body: `
        <div class="card mb-md">
          <h4 class="card-title mb-md">批量添加用户</h4>
          <div class="form-group">
            <textarea id="bulkUsers" rows="3" placeholder="用户名或邮箱，逗号/换行分隔"></textarea>
          </div>
          <div class="row gap-sm">
            <button class="button sm" onclick="bulkAddUsers('${esc(slug)}', 'ACCEPTED')">添加 (自动通过)</button>
            <button class="button ghost sm" onclick="bulkAddUsers('${esc(slug)}', 'PENDING')">添加 (待审核)</button>
          </div>
          <div id="bulkResult" class="mt-sm"></div>
        </div>
        <h4 class="mb-md">注册列表 (${items.length})</h4>
        <div id="regList">
          ${items.length === 0 ? emptyBox('暂无注册') : `
            <div class="table-wrap">
              <table>
                <thead><tr><th>用户名</th><th>邮箱</th><th>状态</th><th>加入时间</th><th>操作</th></tr></thead>
                <tbody>
                  ${items.map(r => `
                    <tr>
                      <td>${esc(r.username)}</td>
                      <td>${esc(r.email || '—')}</td>
                      <td>${statusPill(r.status)}</td>
                      <td>${formatDate(r.joined_at)}</td>
                      <td>
                        <div class="row gap-xs">
                          <button class="button ghost sm success" onclick="setRegStatus('${esc(slug)}', ${r.user_id}, 'ACCEPTED')">通过</button>
                          <button class="button ghost sm" onclick="setRegStatus('${esc(slug)}', ${r.user_id}, 'PENDING')">待审</button>
                          <button class="button ghost sm danger" onclick="setRegStatus('${esc(slug)}', ${r.user_id}, 'REJECTED')">拒绝</button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      `,
      footer: `<button class="button ghost" onclick="closeModal()">关闭</button>`,
    });
  } catch (err) {
    toast(`加载注册列表失败: ${err.message}`, 'error');
  }
}

async function setRegStatus(slug, userId, status) {
  try {
    await api(`/api/admin/contests/${slug}/registrations/${userId}/status`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    toast('状态已更新', 'success');
    showRegistrationModal(slug); // refresh
  } catch (err) {
    toast(`操作失败: ${err.message}`, 'error');
  }
}

async function bulkAddUsers(slug, status) {
  const users = $('bulkUsers')?.value?.trim();
  if (!users) { toast('请输入用户名', 'warning'); return; }
  const resultEl = $('bulkResult');
  try {
    const data = await api(`/api/admin/contests/${slug}/registrations/bulk-add`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ users, status }),
    });
    const added = data.added || [];
    const missing = data.missing || [];
    resultEl.innerHTML = `
      <div class="notice success">添加成功: ${added.length} 人</div>
      ${missing.length ? `<div class="notice warning mt-sm">未找到: ${missing.join(', ')}</div>` : ''}
    `;
    setTimeout(() => showRegistrationModal(slug), 1500);
  } catch (err) {
    resultEl.innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
  }
}

function showAnnouncementModal(slug) {
  openModal({
    title: `发布公告 — ${slug}`,
    body: `
      <div class="form-group">
        <label for="annTitle">标题</label>
        <input type="text" id="annTitle" placeholder="公告标题" />
      </div>
      <div class="form-group">
        <label for="annBody">内容 (Markdown)</label>
        <textarea id="annBody" rows="6" placeholder="公告内容…"></textarea>
      </div>
      <div id="annError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="button ghost" onclick="closeModal()">取消</button>
      <button class="button" onclick="publishAnnouncement('${esc(slug)}')">发布</button>
    `,
  });
}

async function publishAnnouncement(slug) {
  const title = $('annTitle')?.value?.trim();
  const body = $('annBody')?.value || '';
  if (!title) { toast('请输入标题', 'warning'); return; }
  try {
    await api(`/api/admin/contests/${slug}/announcements`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body_md: body }),
    });
    closeModal();
    toast('公告已发布', 'success');
  } catch (err) {
    const el = $('annError');
    if (el) { el.style.display = ''; el.textContent = err.message; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROUTER
// ═══════════════════════════════════════════════════════════════════════════

function route() {
  clearPageState();
  let path = location.pathname || '/';

  // Legacy hash routes
  if (location.hash.startsWith('#/')) {
    const newPath = location.hash.slice(1);
    history.replaceState(null, '', newPath);
    path = newPath;
  }

  state.currentRoute = path;
  updateNav();

  const app = $('app');
  app.className = 'content animate-fade-in';

  // Route matching
  if (path === '/') return renderDashboard();
  if (path === '/problems') return renderProblems();
  if (path === '/contests') return renderContests();
  if (path === '/submissions') return renderSubmissions();
  if (path === '/account') return renderAccount();
  if (path === '/admin/users' || path === '/users') return renderUsers();
  if (path === '/problem-admin') return renderProblemAdmin();
  if (path === '/contest-admin') return renderContestAdmin();

  // Parameterized routes
  let match;
  if ((match = path.match(/^\/contests\/([^/]+)\/problems\/([^/]+)$/))) {
    return renderProblemDetail(match[2], match[1]);
  }
  if ((match = path.match(/^\/contests\/([^/]+)$/))) {
    return renderContestDetail(match[1]);
  }
  if ((match = path.match(/^\/problems\/([^/]+)$/))) {
    return renderProblemDetail(match[1]);
  }
  if ((match = path.match(/^\/submissions\/(\d+)$/))) {
    return renderSubmissionDetail(match[1]);
  }

  // 404
  setPage('页面不存在', '404');
  app.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🔍</div>
      <h2>页面不存在</h2>
      <p class="text-muted">请检查 URL 或返回首页</p>
      <a href="/" class="button mt-md" data-link>返回首页</a>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // Auth button
  $('authBtn').addEventListener('click', () => showAuthModal());
  $('logoutBtn').addEventListener('click', logout);

  // Mobile menu
  $('menuBtn').addEventListener('click', () => {
    $('sidebar').classList.toggle('open');
    $('sidebarOverlay').classList.toggle('open');
  });
  $('sidebarOverlay').addEventListener('click', () => {
    $('sidebar').classList.remove('open');
    $('sidebarOverlay').classList.remove('open');
  });

  // Modal close
  $('modalCloseBtn').addEventListener('click', closeModal);
  $('modalRoot').addEventListener('click', (e) => {
    if (e.target.id === 'modalRoot') closeModal();
  });

  // SPA link handling
  document.addEventListener('click', handleSpaLinkClick);
  window.addEventListener('popstate', () => route());

  // File upload styling
  document.addEventListener('change', (e) => {
    if (e.target.type === 'file') {
      const label = e.target.closest('.file-upload')?.querySelector('.file-upload-label span:last-child');
      if (label && e.target.files.length) {
        label.textContent = e.target.files[0].name;
      }
    }
  });

  // Init
  checkHealth();
  loadMe().then(() => route());
});

// ─── Global exports for inline handlers ─────────────────────────────────────

Object.assign(window, {
  navigate, showAuthModal, switchAuthTab, submitAuth, logout,
  submitSolution, showContestTab,
  joinContest, submitInviteCode, leaveContest,
  showAskQuestionModal, submitQuestion,
  showAnswerQuestionModal, submitAnswer, closeQuestion,
  changePassword, showResetPasswordModal, resetUserPassword,
  toggleUserRole, toggleUserDisabled,
  importProblem, setProblemStatus,
  showCreateContestModal, createContest,
  showContestSettingsModal, saveContestSettings,
  showRegistrationModal, setRegStatus, bulkAddUsers,
  showAnnouncementModal, publishAnnouncement,
  closeModal,
});
