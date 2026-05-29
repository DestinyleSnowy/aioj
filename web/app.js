/* ═══════════════════════════════════════════════════════════════════════════
   AIOJ — AI Olympiad Judge  ·  Core SPA Logic
   Premium redesigned interface with modular layouts and rich micro-interactions
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── Utilities ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const state = {
  token: localStorage.getItem('aioj_token') || '',
  user: null,
  healthOk: false,
  currentRoute: '',
  countdownTimer: null,
  activeProblemTab: 'statement', // Default tab in problem detail
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

// ─── HTML Helpers ───────────────────────────────────────────────────────────
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
  return `
    <div class="empty-state">
      <div class="empty-icon">📭</div>
      <div class="loading-text" style="color: var(--text-muted);">${esc(text || '暂无数据')}</div>
    </div>
  `;
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

// ─── Navigation & App Shell ────────────────────────────────────────────────
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

  $('userPill').style.display = state.user ? 'flex' : 'none';
  $('authBtn').style.display = state.user ? 'none' : '';
  $('logoutBtn').style.display = state.user ? 'inline-flex' : 'none';

  const userPill = $('userPill');
  if (state.user) {
    userPill.innerHTML = `
      <div class="user-avatar">${esc(state.user.username[0].toUpperCase())}</div>
      <span class="user-name">${esc(state.user.username)}</span>
    `;
  }

  const footerEl = $('sidebarUser');
  if (state.user) {
    footerEl.innerHTML = `
      <div class="user-avatar">${esc(state.user.username[0].toUpperCase())}</div>
      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: 600; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(state.user.username)}</div>
        <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">${esc(state.user.role)}</div>
      </div>
    `;
  } else {
    footerEl.innerHTML = '<span class="text-muted">账户未登录</span>';
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
    statusEl.querySelector('.status-text').textContent = '运行在线';
  } catch {
    state.healthOk = false;
    statusEl.classList.remove('online');
    statusEl.querySelector('.status-text').textContent = '服务离线';
  }
}

// ─── Auth Module ────────────────────────────────────────────────────────────
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
    <div class="tabs" id="authTabs" style="margin-bottom: var(--space-md);">
      <button class="tab ${tab === 'login' ? 'active' : ''}" onclick="switchAuthTab('login')">用户登录</button>
      <button class="tab ${tab === 'register' ? 'active' : ''}" onclick="switchAuthTab('register')">新户注册</button>
    </div>
    <div id="authLogin" style="${tab !== 'login' ? 'display:none' : ''}">
      <div class="form-group">
        <label for="loginUser">用户名或邮箱</label>
        <input type="text" id="loginUser" placeholder="请输入注册用户名/邮箱" autocomplete="username" />
      </div>
      <div class="form-group">
        <label for="loginPass">登录密码</label>
        <input type="password" id="loginPass" placeholder="请输入密码" autocomplete="current-password" />
      </div>
      <div id="loginError" class="notice error" style="display:none"></div>
    </div>
    <div id="authRegister" style="${tab !== 'register' ? 'display:none' : ''}">
      <div class="form-group">
        <label for="regUser">用户名</label>
        <input type="text" id="regUser" placeholder="大小写英文字母及数字" autocomplete="username" />
      </div>
      <div class="form-group">
        <label for="regEmail">邮箱地址 (选填)</label>
        <input type="email" id="regEmail" placeholder="email@address.com" autocomplete="email" />
      </div>
      <div class="form-group">
        <label for="regPass">设置密码</label>
        <input type="password" id="regPass" placeholder="请牢记您的密码" autocomplete="new-password" />
      </div>
      <div id="regError" class="notice error" style="display:none"></div>
    </div>
  `;
  const footer = `
    <button class="btn btn-secondary" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" id="authSubmitBtn" onclick="submitAuth()">确认提交</button>
  `;
  openModal({ title: 'AIOJ 会员中心', body, footer });

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
  btn.textContent = '正在处理中...';
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
      toast('欢迎登录 AIOJ 评测平台', 'success');
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
        toast('账号注册成功！', 'success');
        route();
      } else {
        toast('注册成功，请在此登录。', 'success');
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
    btn.textContent = '确认提交';
  }
}

function logout() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('aioj_token');
  updateNav();
  toast('已成功登出您的账号', 'info');
  navigate('/');
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
async function renderDashboard() {
  setPage('平台概览', 'AI Olympiad Judge 竞技运营概况');
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在同步平台数据...</span>
    </div>
  `;

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
      <div class="dashboard-hero">
        <h2 class="dashboard-hero-title">AIOJ 智能机器学习评测系统</h2>
        <p class="dashboard-hero-subtitle">面向 AI 和深度学习算法竞赛的在线自动化评测中心，支持多卡多进程安全沙箱环境、多重评测指标自动优化和实时高性能排行榜。</p>
      </div>

      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-value">${problems.length}</div>
          <div class="stat-label">题库总量</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${contests.length}</div>
          <div class="stat-label">历史比赛</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${runningContests.length}</div>
          <div class="stat-label">当前进行中</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${submissions.length}</div>
          <div class="stat-label">我的提交</div>
        </div>
      </div>

      ${runningContests.length > 0 ? `
        <div class="card highlight mb-lg">
          <div class="card-header">
            <h3 class="card-title">
              <span class="pulsing-dot"></span> 🔥 正在进行的比赛
            </h3>
          </div>
          <div class="contest-grid">
            ${runningContests.map(c => contestCard(c)).join('')}
          </div>
        </div>
      ` : ''}

      ${upcomingContests.length > 0 ? `
        <div class="card mb-lg">
          <div class="card-header">
            <h3 class="card-title">📅 即将开始的比赛</h3>
          </div>
          <div class="contest-grid">
            ${upcomingContests.map(c => contestCard(c)).join('')}
          </div>
        </div>
      ` : ''}

      <div class="two-col mt-lg">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">推荐练习题目</h3>
            <a href="/problems" class="btn btn-ghost btn-sm" data-link>题库主页 →</a>
          </div>
          ${problems.length === 0 ? emptyBox('暂无可用题目') : `
            <div class="card-grid compact">
              ${problems.slice(0, 6).map(p => `
                <a href="/problems/${esc(p.slug)}" class="mini-card" data-link>
                  <div class="mini-card-title">${esc(p.title)}</div>
                  <div class="mini-card-meta">${esc(p.slug)} · ${esc(p.metric || 'accuracy')}</div>
                </a>
              `).join('')}
            </div>
          `}
        </div>
        
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">我的最近提交记录</h3>
            <a href="/submissions" class="btn btn-ghost btn-sm" data-link>全部提交 →</a>
          </div>
          ${submissions.length === 0 ? emptyBox('近期无提交记录') : `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>编号</th>
                    <th>题目标识</th>
                    <th>评测状态</th>
                    <th>公开分数</th>
                    <th>提交时间</th>
                  </tr>
                </thead>
                <tbody>
                  ${submissions.slice(0, 8).map(s => `
                    <tr class="clickable-row" onclick="navigate('/submissions/${s.id}')">
                      <td>#${s.id}</td>
                      <td style="font-family: var(--font-mono); font-size: 12px;">${esc(s.problem_slug || s.problem_title || '')}</td>
                      <td>${statusPill(s.status)}</td>
                      <td class="text-accent">${scoreDisplay(s.public_score)}</td>
                      <td style="font-size: 12px; color: var(--text-muted);">${formatDate(s.created_at)}</td>
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
        <span>标识: ${esc(c.slug)}</span>
        <span>共 ${c.problem_count || 0} 道题</span>
        ${c.start_at ? `<span>开始: ${formatDate(c.start_at)}</span>` : ''}
      </div>
    </a>
  `;
}

// ─── Problems Library ───────────────────────────────────────────────────────
async function renderProblems() {
  setPage('公开题库', '挑战各种 AI / 机器学习场景题目');
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在检索题库列表...</span>
    </div>
  `;
  try {
    const data = await api('/api/problems');
    const items = data.items || [];
    if (items.length === 0) {
      app.innerHTML = emptyBox('题库尚未上传公开题目');
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
            <div class="problem-card-footer" style="justify-content: space-between; border-top: 1px solid hsla(0,0%,100%,0.04); padding-top: 10px;">
              <span class="pill blue">${esc(p.metric || 'accuracy')}</span>
              <span class="text-muted" style="font-size: 11px;">${metricText(p)}</span>
            </div>
          </a>
        `).join('')}
      </div>
    `;
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

// ─── Problem Workspace ──────────────────────────────────────────────────────
async function renderProblemDetail(slug, contestSlug = null) {
  setPage('正在载入题目', slug);
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在构建题目评测工作区...</span>
    </div>
  `;
  try {
    const [problem, subsData] = await Promise.all([
      api(`/api/problems/${slug}`),
      loadProblemSubmissions(slug, contestSlug),
    ]);
    const subs = subsData.items || [];

    setPage(problem.title, `评测指标: ${problem.metric || 'accuracy'}`);

    app.innerHTML = `
      ${contestSlug ? `
        <a href="/contests/${esc(contestSlug)}" class="breadcrumb" data-link>← 返回竞技比赛主页</a>
      ` : ''}
      <div class="problem-layout">
        <div class="problem-main">
          <!-- Workspace Navigation Tabs -->
          <div class="tabs" id="problemTabs">
            <button class="tab active" onclick="switchProblemTab('statement')">题目详情与规范</button>
            <button class="tab" onclick="switchProblemTab('submissions')">我的提交记录 (${subs.length})</button>
            <button class="tab" onclick="switchProblemTab('leaderboard')">在线排行榜</button>
          </div>

          <!-- Statement Tab -->
          <div class="tab-panel active" id="tab-statement">
            <div class="card glass">
              <div class="card-body">
                ${renderMd(problem.statement_md)}
              </div>
            </div>
          </div>

          <!-- Submissions Tab -->
          <div class="tab-panel" id="tab-submissions">
            <div class="card">
              ${subs.length === 0 ? emptyBox('本题目暂无您的提交记录') : `
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>提交用户</th>
                        <th>评测结果</th>
                        <th>公开分数</th>
                        <th>耗时</th>
                        <th>提交时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${subs.map(s => `
                        <tr class="clickable-row" onclick="navigate('/submissions/${s.id}')">
                          <td>#${s.id}</td>
                          <td><strong>${esc(s.username || '—')}</strong></td>
                          <td>${statusPill(s.status)}</td>
                          <td class="text-accent">${scoreDisplay(s.public_score)}</td>
                          <td>${s.runtime_ms != null ? s.runtime_ms + 'ms' : '—'}</td>
                          <td style="font-size: 12px; color: var(--text-muted);">${formatDate(s.created_at)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `}
            </div>
          </div>

          <!-- Leaderboard Tab -->
          <div class="tab-panel" id="tab-leaderboard">
            <div class="card">
              <div id="problemLeaderboard">
                <div class="loading-overlay" style="min-height: 150px;">
                  <div class="spinner-ring"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Sidebar Actions & Specs -->
        <div class="problem-side">
          <div class="card highlight">
            <h3 class="card-title" style="margin-bottom: 12px;">提交评测方案</h3>
            
            <div class="file-upload" id="uploadArea">
              <input type="file" id="submitFile" accept=".zip" onchange="handleFileSelect(this)" />
              <div class="file-upload-label">
                <span class="file-upload-icon">📁</span>
                <span id="uploadFileName" style="font-weight: 600; color: var(--text-main);">拖入或选择 .zip 解答包</span>
                <span style="font-size: 11px; color: var(--text-muted);">ZIP 压缩包容量限制 20MB</span>
              </div>
            </div>
            
            <button class="btn btn-primary full-width mt-md" onclick="submitSolution('${esc(slug)}', ${contestSlug ? `'${esc(contestSlug)}'` : 'null'})">
              开始自动化评测
            </button>
            
            <a href="/api/problems/${esc(slug)}/sample-submission" target="_blank" class="btn btn-secondary btn-sm full-width mt-sm">
              📥 下载示例提报文件 (.zip)
            </a>
          </div>

          <div class="card">
            <h3 class="card-title" style="margin-bottom: var(--space-sm);">题目限制参数</h3>
            <div class="config-list">
              <div class="config-item"><span class="config-label">度量指标</span><span>${esc(problem.metric || 'accuracy')}</span></div>
              <div class="config-item"><span class="config-label">优化方向</span><span>${problem.higher_is_better ? '分数越高越好 ↑' : '分数越低越好 ↓'}</span></div>
              <div class="config-item"><span class="config-label">时长限制</span><span>${problem.time_limit_sec || 60} 秒</span></div>
              <div class="config-item"><span class="config-label">运行内存</span><span>${problem.memory_limit_mb || 2048} MB</span></div>
              <div class="config-item"><span class="config-label">计算核数</span><span>${problem.cpu_count || 2} 核 CPU</span></div>
              <div class="config-item"><span class="config-label">输出包限制</span><span>${problem.output_limit_mb || 64} MB</span></div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Load leaderboard
    loadProblemLeaderboard(slug);
    // Init Drag and Drop upload area triggers
    initDragAndDrop();
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

function switchProblemTab(tabName) {
  state.activeProblemTab = tabName;
  document.querySelectorAll('#problemTabs .tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('onclick').includes(`'${tabName}'`));
  });
  document.querySelectorAll('.problem-main > .tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${tabName}`);
  });
}

function handleFileSelect(input) {
  const label = $('uploadFileName');
  if (label && input.files.length) {
    const file = input.files[0];
    const sizeStr = (file.size / 1024 / 1024).toFixed(2);
    label.textContent = `${file.name} (${sizeStr} MB)`;
    label.style.color = 'var(--color-success)';
  }
}

function initDragAndDrop() {
  const area = $('uploadArea');
  if (!area) return;
  ['dragenter', 'dragover'].forEach(eventName => {
    area.addEventListener(eventName, (e) => {
      e.preventDefault();
      area.classList.add('dragover');
    }, false);
  });
  ['dragleave', 'drop'].forEach(eventName => {
    area.addEventListener(eventName, (e) => {
      e.preventDefault();
      area.classList.remove('dragover');
    }, false);
  });
  area.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    const fileInput = $('submitFile');
    if (fileInput && files.length) {
      fileInput.files = files;
      handleFileSelect(fileInput);
    }
  }, false);
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
      el.innerHTML = `<div class="text-muted text-sm text-center" style="padding: var(--space-md);">题目尚未产生评测排行记录</div>`;
      return;
    }
    el.innerHTML = `
      <div class="leaderboard-mini">
        ${items.slice(0, 15).map((e, i) => `
          <div class="lb-row ${i < 3 ? 'lb-top' : ''}">
            <span class="lb-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1)}</span>
            <span class="lb-name">${esc(e.username)}</span>
            <span class="lb-score">${scoreDisplay(e.public_score)}</span>
          </div>
        `).join('')}
      </div>
    `;
  } catch {
    el.innerHTML = `<div class="text-muted text-sm" style="padding: var(--space-md);">排行榜加载失败，请检查网络状态</div>`;
  }
}

async function submitSolution(slug, contestSlug) {
  const fileInput = $('submitFile');
  if (!fileInput || !fileInput.files.length) {
    toast('请先选择或拖拽拖入 ZIP 解答包文件', 'warning');
    return;
  }
  if (!state.token) {
    showAuthModal();
    return;
  }
  const fd = new FormData();
  fd.append('file', fileInput.files[0]);
  if (contestSlug) fd.append('contest_slug', contestSlug);
  
  toast('文件已上传，正在启动沙箱容器评测...', 'info');
  try {
    const data = await api(`/api/problems/${slug}/submissions`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    });
    toast('方案提报成功，正在为您监控运行状态', 'success');
    navigate(`/submissions/${data.submission_id || data.id}`);
  } catch (err) {
    toast(`提报方案失败: ${err.message}`, 'error');
  }
}

// ─── Contests Module ────────────────────────────────────────────────────────
async function renderContests() {
  setPage('竞技比赛', '参加机器学习/算法比赛');
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在检索比赛列表...</span>
    </div>
  `;
  try {
    const data = await api('/api/contests');
    const items = data.items || [];
    if (items.length === 0) {
      app.innerHTML = emptyBox('当前尚未发布任何竞技比赛');
      return;
    }
    
    const running = items.filter(c => (c.state || c.status) === 'RUNNING');
    const upcoming = items.filter(c => (c.state || c.status) === 'UPCOMING');
    const ended = items.filter(c => (c.state || c.status) === 'ENDED');
    const draft = items.filter(c => (c.state || c.status) === 'DRAFT');
    const other = items.filter(c => !['RUNNING', 'UPCOMING', 'ENDED', 'DRAFT'].includes(c.state || c.status));

    const renderSection = (title, list) => list.length === 0 ? '' : `
      <h3 class="section-title" style="margin-bottom: var(--space-md); font-size: 16px;">${title}</h3>
      <div class="contest-grid mb-lg">
        ${list.map(c => contestCard(c)).join('')}
      </div>
    `;

    app.innerHTML = `
      ${renderSection('🔥 正在进行的竞赛', running)}
      ${renderSection('📅 即将开启的竞赛', upcoming)}
      ${renderSection('🏁 已结束的历史竞赛', ended)}
      ${renderSection('📝 草稿调试赛事', draft)}
      ${renderSection('其他竞赛', other)}
    `;
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

// ─── Contest Arena Workspace ────────────────────────────────────────────────
async function renderContestDetail(slug) {
  setPage('载入竞赛中', slug);
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在同步竞赛数据...</span>
    </div>
  `;
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
    if (!contest) throw new Error('该比赛项目不存在');

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

    setPage(contest.title, `竞赛标识: ${contest.slug}`);

    app.innerHTML = `
      <div class="contest-detail">
        <!-- Contest Header Panel -->
        <div class="contest-countdown-box">
          <div class="contest-header-row" style="margin-bottom: var(--space-md);">
            <div>
              <h2 class="contest-title" style="font-size: 24px;">${esc(contest.title)}</h2>
              <div class="row gap-sm mt-sm" style="flex-wrap: wrap;">
                ${contestStatePill(st)}
                <span class="pill gray">SLUG: ${esc(contest.slug)}</span>
                ${contest.visibility ? `<span class="pill blue">可见: ${esc(contest.visibility)}</span>` : ''}
                ${contest.registration_mode ? `<span class="pill gray">注册: ${esc(contest.registration_mode)}</span>` : ''}
              </div>
            </div>
            <div class="contest-actions">
              ${renderContestActions(contest, access, participantStatus, isParticipant, slug)}
            </div>
          </div>

          <!-- Countdown -->
          <div id="contestCountdown" class="countdown mb-md"></div>

          <!-- Dynamic Statistics Grid -->
          <div class="contest-stats">
            <div class="contest-stat">
              <span class="contest-stat-value">${stats.participant_count || access.participant_counts?.accepted_count || 0}</span>
              <span class="contest-stat-label">报名选手</span>
            </div>
            <div class="contest-stat">
              <span class="contest-stat-value">${stats.submission_count || 0}</span>
              <span class="contest-stat-label">累计提报</span>
            </div>
            <div class="contest-stat">
              <span class="contest-stat-value">${stats.accepted_count || 0}</span>
              <span class="contest-stat-label">通过解答</span>
            </div>
            <div class="contest-stat">
              <span class="contest-stat-value">${problems.length}</span>
              <span class="contest-stat-label">竞赛题目</span>
            </div>
          </div>

          <!-- Dates metadata -->
          <div class="contest-dates mt-md" style="justify-content: center; font-size: 12px; color: var(--text-muted);">
            ${contest.start_at ? `<span style="margin-right: 12px;">🕐 开始时间: ${formatDate(contest.start_at)}</span>` : ''}
            ${contest.end_at ? `<span>🏁 结束时间: ${formatDate(contest.end_at)}</span>` : ''}
          </div>

          ${contest.description_md ? `
            <div style="margin-top: var(--space-md); padding-top: var(--space-md); border-top: 1px solid hsla(0,0%,100%,0.04); font-size: 13.5px; color: var(--text-secondary);">
              ${renderMd(contest.description_md)}
            </div>
          ` : ''}
        </div>

        <!-- Tabbed Container -->
        <div class="tabs" id="contestTabs">
          <button class="tab active" onclick="showContestTab('problems')">竞赛题目列表</button>
          <button class="tab" onclick="showContestTab('scoreboard')">动态排行榜</button>
          <button class="tab" onclick="showContestTab('submissions')">我的提报记录</button>
          <button class="tab" onclick="showContestTab('announcements')">
            官方赛事公告 ${announcements.length > 0 ? `<span class="badge">${announcements.length}</span>` : ''}
          </button>
          <button class="tab" onclick="showContestTab('questions')">
            答疑与交流区 ${questions.length > 0 ? `<span class="badge">${questions.length}</span>` : ''}
          </button>
        </div>

        <!-- Tab contents -->
        <div id="contestTabContent" class="mt-md">
          <!-- Problems tab -->
          <div class="tab-panel active" id="tab-problems">
            ${!canViewProblems ? emptyBox('题目尚未公开，请在竞赛开启后查看') : problems.length === 0 ? emptyBox('本场竞赛尚未绑定题目') : `
              <div class="problem-grid">
                ${problems.map(p => {
                  const ps = problemStats.find(s => s.slug === p.slug || s.id === p.id) || {};
                  return `
                    <a href="/contests/${esc(slug)}/problems/${esc(p.slug)}" class="problem-card" data-link>
                      <div class="problem-card-header">
                        <h3 class="problem-card-title">${esc(p.title)}</h3>
                      </div>
                      <div class="problem-card-slug">${esc(p.slug)}</div>
                      <div class="problem-card-footer" style="justify-content: space-between; border-top: 1px solid hsla(0,0%,100%,0.04); padding-top: 10px; font-size: 12px; color: var(--text-muted);">
                        <span>已通过 ${ps.solved_users || 0} 人</span>
                        <span>累计提交 ${ps.submissions || 0} 次</span>
                      </div>
                    </a>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <!-- Scoreboard tab -->
          <div class="tab-panel" id="tab-scoreboard">
            <div id="scoreboardContent">
              <div class="loading-overlay" style="min-height: 200px;">
                <div class="spinner-ring"></div>
                <span class="loading-text">正在同步选手实时成绩...</span>
              </div>
            </div>
          </div>

          <!-- Submissions tab -->
          <div class="tab-panel" id="tab-submissions">
            <div class="card">
              ${submissions.length === 0 ? emptyBox('您在此比赛中暂无提交') : `
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>提报编号</th>
                        <th>题目</th>
                        <th>运行状态</th>
                        <th>公开分数</th>
                        <th>评测耗时</th>
                        <th>提交时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${submissions.map(s => `
                        <tr class="clickable-row" onclick="navigate('/submissions/${s.id}')">
                          <td>#${s.id}</td>
                          <td style="font-family: var(--font-mono);">${esc(s.problem_slug || s.problem_title || '')}</td>
                          <td>${statusPill(s.status)}</td>
                          <td class="text-accent">${scoreDisplay(s.public_score)}</td>
                          <td>${s.runtime_ms != null ? s.runtime_ms + 'ms' : '—'}</td>
                          <td style="font-size: 12px; color: var(--text-muted);">${formatDate(s.created_at)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `}
            </div>
          </div>

          <!-- Announcements tab -->
          <div class="tab-panel" id="tab-announcements">
            ${announcements.length === 0 ? emptyBox('本场比赛尚未发布官方公告') : announcements.map(a => `
              <div class="card mb-md">
                <div class="card-header" style="border-bottom: 1px solid hsla(0,0%,100%,0.04); padding-bottom: var(--space-sm);">
                  <h4 class="card-title">${esc(a.title)}</h4>
                  <span class="text-muted" style="font-size: 12px;">${formatDate(a.created_at)}</span>
                </div>
                <div class="card-body" style="padding-top: var(--space-md);">
                  ${renderMd(a.body_md)}
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Questions tab -->
          <div class="tab-panel" id="tab-questions">
            <div style="margin-bottom: var(--space-md); display: flex; justify-content: space-between; align-items: center;">
              <span class="text-muted" style="font-size: 13px;">如对赛题规范、数据集有疑问，可在此公开提问</span>
              ${isParticipant || (state.user && state.user.role === 'ADMIN') ? `
                <button class="btn btn-primary btn-sm" onclick="showAskQuestionModal('${esc(slug)}')">✏️ 向裁判提问</button>
              ` : ''}
            </div>
            
            ${questions.length === 0 ? emptyBox('尚未有选手发起赛题答疑') : questions.map(q => `
              <div class="card mb-md ${q.is_public ? '' : 'card-private'}">
                <div class="card-header" style="align-items: flex-start;">
                  <div>
                    <h4 class="card-title">${esc(q.title)}</h4>
                    <div class="row gap-sm mt-xs" style="font-size: 12px; color: var(--text-muted);">
                      <span>提问人: ${esc(q.username || '匿名选手')}</span>
                      <span>提问时间: ${formatDate(q.created_at)}</span>
                      ${statusPill(q.status)}
                      ${q.is_public ? '<span class="pill blue">公开回答</span>' : '<span class="pill gray">私密会话</span>'}
                    </div>
                  </div>
                  ${state.user && state.user.role === 'ADMIN' ? `
                    <div class="row gap-sm">
                      <button class="btn btn-secondary btn-sm" onclick="showAnswerQuestionModal('${esc(slug)}', ${q.id})">进行解答</button>
                      ${q.status !== 'CLOSED' ? `<button class="btn btn-danger btn-sm" onclick="closeQuestion('${esc(slug)}', ${q.id})">关闭问题</button>` : ''}
                    </div>
                  ` : ''}
                </div>
                ${q.can_view_body !== false ? `
                  <div class="card-body" style="padding-top: var(--space-md); border-top: 1px solid hsla(0,0%,100%,0.03);">
                    <div style="font-size: 13.5px; color: var(--text-secondary);">${renderMd(q.body_md)}</div>
                    ${q.answer_md ? `
                      <div class="answer-block">
                        <div class="answer-label">📝 官方答疑回复</div>
                        <div style="font-size: 13.5px; color: var(--text-main);">${renderMd(q.answer_md)}</div>
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
    return `<button class="btn btn-primary" onclick="showAuthModal()">登录以加入比赛</button>`;
  }
  if (isParticipant) {
    return `
      <span class="pill green" style="margin-right: 8px;">已报名参赛</span>
      <button class="btn btn-danger btn-sm" onclick="leaveContest('${esc(slug)}')">退出此比赛</button>
    `;
  }
  if (participantStatus === 'PENDING') {
    return `<span class="pill yellow">报名审核中</span>`;
  }
  if (participantStatus === 'REJECTED') {
    const canReregister = access.allow_join_after_start !== false || st !== 'RUNNING';
    return `
      <span class="pill red" style="margin-right: 8px;">提报申请被驳回</span>
      ${canReregister ? `<button class="btn btn-primary btn-sm" onclick="joinContest('${esc(slug)}', '${esc(contest.registration_mode || 'OPEN')}')">重新报名</button>` : ''}
    `;
  }
  return `<button class="btn btn-primary" onclick="joinContest('${esc(slug)}', '${esc(contest.registration_mode || 'OPEN')}')">报名加入竞赛</button>`;
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
    toast('已成功报名参赛该项目', 'success');
    renderContestDetail(slug);
  } catch (err) {
    toast(`报名参赛失败: ${err.message}`, 'error');
  }
}

function showInviteCodeModal(slug) {
  openModal({
    title: '输入邀请码参赛',
    body: `
      <div class="form-group">
        <label for="inviteCode">比赛邀请码</label>
        <input type="text" id="inviteCode" placeholder="请输入管理员分发的邀请密钥" />
      </div>
      <div id="inviteError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="submitInviteCode('${esc(slug)}')">确认验证</button>
    `,
  });
}

async function submitInviteCode(slug) {
  const code = $('inviteCode')?.value?.trim();
  if (!code) { toast('请输入邀请密钥', 'warning'); return; }
  try {
    await api(`/api/contests/${slug}/join`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ invite_code: code }),
    });
    closeModal();
    toast('验证成功，已加入参赛团队', 'success');
    renderContestDetail(slug);
  } catch (err) {
    const el = $('inviteError');
    if (el) { el.style.display = ''; el.textContent = err.message; }
  }
}

async function leaveContest(slug) {
  if (!confirm('确定要放弃并退出此场竞技比赛吗？您的历史提报将不再计分。')) return;
  try {
    await api(`/api/contests/${slug}/leave`, { method: 'POST', headers: authHeaders() });
    toast('已退出比赛项目', 'info');
    renderContestDetail(slug);
  } catch (err) {
    toast(`退出比赛失败: ${err.message}`, 'error');
  }
}

function startContestCountdown(contest) {
  const st = contest.state || contest.status || '';
  const el = $('contestCountdown');
  if (!el) return;

  function updateCountdown() {
    const now = Date.now();
    let targetTime, label;
    if (st === 'UPCOMING' && contest.start_at) {
      targetTime = new Date(contest.start_at).getTime();
      label = '距离比赛开始';
    } else if (st === 'RUNNING' && contest.end_at) {
      targetTime = new Date(contest.end_at).getTime();
      label = '距离竞赛封榜/结束';
    } else {
      el.innerHTML = st === 'ENDED' ? '<div class="countdown-ended">本场竞赛已结束</div>' : '';
      return false;
    }
    const diff = targetTime - now;
    if (diff <= 0) {
      el.innerHTML = `<div class="countdown-ended">${label === '距离开始' ? '竞赛已开始运行' : '本场竞赛封榜结束'}</div>`;
      return false;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.innerHTML = `
      <div class="countdown-digits">
        <div style="align-self: center; font-size: 13.5px; color: var(--text-secondary); margin-right: 12px;">${esc(label)}:</div>
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
      el.innerHTML = emptyBox('暂无任何选手提报排名成绩');
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
    ${data.is_frozen ? '<div class="notice warning mb-md">🧊 排行榜已冻结，仅显示冻结前的公开评测分数。</div>' : ''}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>排名</th><th>选手名称</th><th>通过数</th><th>公开总分</th>
            ${showPrivate ? '<th>最终得分</th>' : ''}
            ${(items[0]?.problems || []).map(p => `<th style="text-align: center;">${esc(p.slug || p.title || '')}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${items.map(r => `
            <tr>
              <td><strong>${r.rank || ''}</strong></td>
              <td><strong>${esc(r.username)}</strong></td>
              <td>${r.solved || 0}</td>
              <td class="text-accent">${scoreDisplay(r.total_public_score)}</td>
              ${showPrivate ? `<td style="font-weight: 600; color: var(--color-success);">${scoreDisplay(r.total_private_score)}</td>` : ''}
              ${(r.problems || []).map(p => `
                <td class="${p.solved ? 'cell-solved' : p.attempts > 0 ? 'cell-attempted' : ''}" style="text-align: center;">
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
    ${data.is_frozen ? '<div class="notice warning mb-md">🧊 排行榜已冻结，罚时统计停止实时同步。</div>' : ''}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>排名</th><th>选手名称</th><th>通过数</th><th>累计罚时</th>
            ${(items[0]?.problems || []).map(p => `<th style="text-align: center;">${esc(p.slug || p.title || '')}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${items.map(r => `
            <tr>
              <td><strong>${r.rank || ''}</strong></td>
              <td><strong>${esc(r.username)}</strong></td>
              <td>${r.solved || 0}</td>
              <td class="text-accent">${r.penalty || 0}</td>
              ${(r.problems || []).map(p => `
                <td class="${p.solved ? 'cell-solved' : p.attempts > 0 ? 'cell-attempted' : ''}" style="text-align: center;">
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

// ─── Contest Q&A ────────────────────────────────────────────────────────────
function showAskQuestionModal(slug) {
  openModal({
    title: '发起赛题答疑提问',
    body: `
      <div class="form-group">
        <label for="qTitle">问题摘要标题</label>
        <input type="text" id="qTitle" placeholder="请用一句话描述您的问题" />
      </div>
      <div class="form-group">
        <label for="qBody">详细描述 (支持 Markdown 规范)</label>
        <textarea id="qBody" placeholder="说明您在评测、测试数据包、或接口中遇到的异常..." rows="6"></textarea>
      </div>
      <div id="qError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="submitQuestion('${esc(slug)}')">确认提交</button>
    `,
  });
}

async function submitQuestion(slug) {
  const title = $('qTitle')?.value?.trim();
  const body = $('qBody')?.value?.trim();
  if (!title) { toast('请填写提问标题', 'warning'); return; }
  try {
    await api(`/api/contests/${slug}/questions`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body_md: body || '' }),
    });
    closeModal();
    toast('提问成功，管理员或裁判将尽快为您回复', 'success');
    renderContestDetail(slug);
  } catch (err) {
    const el = $('qError');
    if (el) { el.style.display = ''; el.textContent = err.message; }
  }
}

function showAnswerQuestionModal(slug, questionId) {
  openModal({
    title: '裁判答疑回复',
    body: `
      <div class="form-group">
        <label for="answerMd">回复内容文本 (Markdown)</label>
        <textarea id="answerMd" placeholder="在此键入官方说明与解答..." rows="6"></textarea>
      </div>
      <div class="form-group">
        <label class="checkbox-label"><input type="checkbox" id="answerPublic" /> 公开此回复 (本场比赛所有选手均可查阅)</label>
      </div>
      <div id="answerError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="submitAnswer('${esc(slug)}', ${questionId})">提交回复</button>
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
    toast('已提交官方回复', 'success');
    renderContestDetail(slug);
  } catch (err) {
    const el = $('answerError');
    if (el) { el.style.display = ''; el.textContent = err.message; }
  }
}

async function closeQuestion(slug, questionId) {
  if (!confirm('确定要关闭此项答疑对话吗？关闭后将不再允许回复。')) return;
  try {
    await api(`/api/admin/contests/${slug}/questions/${questionId}/close`, {
      method: 'POST', headers: authHeaders(),
    });
    toast('对话已关闭', 'info');
    renderContestDetail(slug);
  } catch (err) {
    toast(`关闭失败: ${err.message}`, 'error');
  }
}

// ─── Submissions Log ────────────────────────────────────────────────────────
async function renderSubmissions() {
  setPage('提交历史', '监控评测任务运行队列与日志');
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在检索提报队列...</span>
    </div>
  `;
  try {
    let data;
    if (state.user && state.user.role === 'ADMIN') {
      data = await api('/api/admin/submissions/recent', { headers: authHeaders() });
    } else if (state.token) {
      data = await api('/api/my/submissions', { headers: authHeaders() });
    } else {
      app.innerHTML = `
        <div class="notice info">
          您需要先 <button class="btn btn-secondary btn-sm" onclick="showAuthModal()">登录账户</button> 才能查阅您的提报评测历史。
        </div>
      `;
      return;
    }
    const items = data.items || [];
    if (items.length === 0) {
      app.innerHTML = emptyBox('队列中暂无您的提报历史');
      return;
    }
    app.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>提报 ID</th>
              <th>绑定题目</th>
              <th>提报选手</th>
              <th>评测结果</th>
              <th>公开分</th>
              <th>最终得分</th>
              <th>单条耗时</th>
              <th>内存峰值</th>
              <th>提交时间</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(s => `
              <tr class="clickable-row" onclick="navigate('/submissions/${s.id}')">
                <td>#${s.id}</td>
                <td style="font-family: var(--font-mono); font-size: 12px;">${esc(s.problem_slug || '')}</td>
                <td><strong>${esc(s.username || '—')}</strong></td>
                <td>${statusPill(s.status)}</td>
                <td class="text-accent">${scoreDisplay(s.public_score)}</td>
                <td style="color: var(--color-success); font-weight: 500;">${scoreDisplay(s.private_score)}</td>
                <td>${s.runtime_ms != null ? s.runtime_ms + 'ms' : '—'}</td>
                <td>${s.memory_peak_mb != null ? s.memory_peak_mb + 'MB' : '—'}</td>
                <td style="font-size: 12px; color: var(--text-muted);">${formatDate(s.created_at)}</td>
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

// ─── Submission Detail (Terminal Output) ───────────────────────────────────
async function renderSubmissionDetail(id) {
  setPage('提取评测报告', `#${id}`);
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在从分布式存储提取运行日志...</span>
    </div>
  `;
  try {
    const sub = await api(`/api/submissions/${id}`, { headers: authHeaders() });
    let logContent = '';
    try {
      const logData = await api(`/api/submissions/${id}/log`, { headers: authHeaders() });
      logContent = logData.log || '';
    } catch {}

    app.innerHTML = `
      <a href="/submissions" class="breadcrumb" data-link>← 返回提报队列</a>
      
      <div class="submission-layout" style="display: flex; flex-direction: column; gap: var(--space-lg);">
        <div class="card highlight">
          <div class="card-header" style="border-bottom: 1px solid hsla(0,0%,100%,0.04); padding-bottom: var(--space-sm);">
            <h2 class="card-title">评测提报报告 #${id}</h2>
            ${statusPill(sub.status)}
          </div>
          <div class="card-body" style="padding-top: var(--space-md);">
            <div class="detail-grid">
              <div class="detail-item"><span class="detail-label">题目标识</span><span style="font-family: var(--font-mono); font-weight: 600;">${esc(sub.problem_slug || sub.problem_id || '')}</span></div>
              <div class="detail-item"><span class="detail-label">参赛选手</span><span><strong>${esc(sub.username || '—')}</strong></span></div>
              <div class="detail-item"><span class="detail-label">公开成绩 (Public)</span><span class="text-accent">${scoreDisplay(sub.public_score)}</span></div>
              <div class="detail-item"><span class="detail-label">最终成绩 (Private)</span><span style="font-weight: 600; color: var(--color-success);">${scoreDisplay(sub.private_score)}</span></div>
              <div class="detail-item"><span class="detail-label">执行时长</span><span>${sub.runtime_ms != null ? sub.runtime_ms + 'ms' : '—'}</span></div>
              <div class="detail-item"><span class="detail-label">内容峰值</span><span>${sub.memory_peak_mb != null ? sub.memory_peak_mb + 'MB' : '—'}</span></div>
              <div class="detail-item"><span class="detail-label">提报时间</span><span>${formatDate(sub.created_at)}</span></div>
              <div class="detail-item"><span class="detail-label">评测完成时间</span><span>${formatDate(sub.judged_at)}</span></div>
              ${sub.error_message ? `
                <div class="detail-item full" style="margin-top: 10px;">
                  <span class="detail-label" style="color: var(--color-danger);">评测核心异常诊断:</span>
                  <div class="notice error" style="margin-top: 4px;">${esc(sub.error_message)}</div>
                </div>
              ` : ''}
            </div>
          </div>
        </div>

        <!-- Terminal Windows Console Mock -->
        ${logContent ? `
          <div class="terminal-window">
            <div class="terminal-header">
              <div class="terminal-dots">
                <span class="terminal-dot red"></span>
                <span class="terminal-dot yellow"></span>
                <span class="terminal-dot green"></span>
              </div>
              <div class="terminal-title">AIOJ Sandbox Log Terminal Console</div>
              <button class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;" onclick="copyTerminalText()">复制输出</button>
            </div>
            <pre class="log-output" id="terminalLog"><code>${esc(logContent)}</code></pre>
          </div>
        ` : ''}

        <div style="display: flex; gap: var(--space-md); flex-wrap: wrap;">
          ${sub.problem_slug ? `<a href="/problems/${esc(sub.problem_slug)}" class="btn btn-secondary" data-link>回到题目工作区</a>` : ''}
          <a href="/api/submissions/${id}/output" target="_blank" class="btn btn-primary">📥 下载容器输出打包文件 (.zip)</a>
        </div>
      </div>
    `;

    // Auto refresh if judging
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

function copyTerminalText() {
  const code = $('terminalLog')?.querySelector('code');
  if (code) {
    navigator.clipboard.writeText(code.textContent)
      .then(() => toast('运行日志已成功复制到剪切板', 'success'))
      .catch(() => toast('复制失败，请手动选取', 'error'));
  }
}

// ─── Account Settings ───────────────────────────────────────────────────────
async function renderAccount() {
  setPage('个人中心', '维护与更新您的 AIOJ 会员档案');
  const app = $('app');
  if (!state.user) {
    app.innerHTML = `<div class="notice info">请先 <button class="btn btn-secondary btn-sm" onclick="showAuthModal()">登录账户</button>。</div>`;
    return;
  }
  app.innerHTML = `
    <div class="max-w-md" style="display: flex; flex-direction: column; gap: var(--space-lg);">
      <div class="card highlight">
        <h3 class="card-title" style="margin-bottom: var(--space-md);">您的账号信息</h3>
        <div class="detail-grid">
          <div class="detail-item"><span class="detail-label">登录用户名</span><span style="font-weight: 600;">${esc(state.user.username)}</span></div>
          <div class="detail-item"><span class="detail-label">关联邮箱</span><span>${esc(state.user.email || '尚未绑定邮箱')}</span></div>
          <div class="detail-item"><span class="detail-label">安全权限组</span><span>${statusPill(state.user.role)}</span></div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title" style="margin-bottom: var(--space-md);">重设安全密钥密码</h3>
        <div class="form-group">
          <label for="oldPass">当前密码</label>
          <input type="password" id="oldPass" placeholder="验证老密码密码" />
        </div>
        <div class="form-group">
          <label for="newPass">设置新密码</label>
          <input type="password" id="newPass" placeholder="保障密钥强度" />
        </div>
        <div id="pwdError" class="notice error" style="display:none"></div>
        <div id="pwdSuccess" class="notice success" style="display:none"></div>
        <button class="btn btn-primary mt-sm" onclick="changePassword()">确定修改密码</button>
      </div>
    </div>
  `;
}

async function changePassword() {
  const oldPwd = $('oldPass')?.value;
  const newPwd = $('newPass')?.value;
  if (!oldPwd || !newPwd) { toast('请填写老密码和新密码！', 'warning'); return; }
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
    if (sucEl) { sucEl.style.display = ''; sucEl.textContent = '新安全密钥保存成功！'; }
    toast('修改密码成功，已生效。', 'success');
    $('oldPass').value = '';
    $('newPass').value = '';
  } catch (err) {
    const errEl = $('pwdError');
    if (errEl) { errEl.style.display = ''; errEl.textContent = err.message; }
  }
}

// ─── Admin Pages Controls ──────────────────────────────────────────────────
function requireAdmin() {
  if (!state.user || state.user.role !== 'ADMIN') {
    $('app').innerHTML = `
      <div class="notice error" style="max-width: 600px; margin: 0 auto;">
        <strong>权限受阻诊断:</strong> 需要管理员/裁判特权组权限。
      </div>
    `;
    return false;
  }
  return true;
}

// Admin: User Administration
async function renderUsers() {
  setPage('用户管理', '控制平台选手与系统组权限');
  if (!requireAdmin()) return;
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在整理核心选手库...</span>
    </div>
  `;
  try {
    const data = await api('/api/admin/users', { headers: authHeaders() });
    const items = data.items || [];
    app.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">系统注册选手列表 (${items.length} 个记录)</h3>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>选手 ID</th>
                <th>用户名</th>
                <th>关联邮箱</th>
                <th>安全角色</th>
                <th>账号状态</th>
                <th>注册时间</th>
                <th style="text-align: right;">日常操作</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(u => `
                <tr>
                  <td>#${u.id}</td>
                  <td><strong>${esc(u.username)}</strong></td>
                  <td>${esc(u.email || '—')}</td>
                  <td>${statusPill(u.role)}</td>
                  <td>${u.is_disabled ? '<span class="pill red">暂停服务</span>' : '<span class="pill green">正常通行</span>'}</td>
                  <td style="font-size: 12px; color: var(--text-muted);">${formatDate(u.created_at)}</td>
                  <td>
                    <div class="row gap-xs" style="justify-content: flex-end;">
                      <button class="btn btn-secondary btn-sm" onclick="toggleUserRole(${u.id}, '${u.role}')">${u.role === 'ADMIN' ? '撤销管理' : '委任管理'}</button>
                      <button class="btn btn-danger btn-sm" style="${u.is_disabled ? 'background: var(--color-success); color:#fff; border-color:transparent;' : ''}" onclick="toggleUserDisabled(${u.id}, ${u.is_disabled})">
                        ${u.is_disabled ? '恢复通行' : '强行停权'}
                      </button>
                      <button class="btn btn-secondary btn-sm" onclick="showResetPasswordModal(${u.id}, '${esc(u.username)}')">重置密码</button>
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
  if (!confirm(`确定将此选手的系统身份变更为 [${newRole}] 吗？`)) return;
  try {
    await api(`/api/admin/users/${userId}/role`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    toast('选手安全组委任已变更生效', 'success');
    renderUsers();
  } catch (err) {
    toast(`提权/降权失败: ${err.message}`, 'error');
  }
}

async function toggleUserDisabled(userId, currentDisabled) {
  try {
    await api(`/api/admin/users/${userId}/disabled`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_disabled: !currentDisabled }),
    });
    toast(currentDisabled ? '该选手账号已重新授权激活' : '该选手账号已被强制停权', 'success');
    renderUsers();
  } catch (err) {
    toast(`停权/激活失败: ${err.message}`, 'error');
  }
}

function showResetPasswordModal(userId, username) {
  openModal({
    title: `重置选手密码 — ${username}`,
    body: `
      <div class="form-group">
        <label for="newAdminPass">该选手的新安全登录密钥</label>
        <input type="password" id="newAdminPass" placeholder="为该选手键入新密码" />
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="resetUserPassword(${userId})">确认更新</button>
    `,
  });
}

async function resetUserPassword(userId) {
  const pwd = $('newAdminPass')?.value;
  if (!pwd) { toast('请设置有效的重置密钥', 'warning'); return; }
  try {
    await api(`/api/admin/users/${userId}/password`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password: pwd }),
    });
    closeModal();
    toast('选手安全密码已重置，请告知选手登录。', 'success');
  } catch (err) {
    toast(`更新选手密码失败: ${err.message}`, 'error');
  }
}

// Admin: Problem Repository Manager
async function renderProblemAdmin() {
  setPage('题目管理', '导入、测试与部署智能算法题目包');
  if (!requireAdmin()) return;
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">同步题库数据库索引...</span>
    </div>
  `;
  try {
    const data = await tryApi(['/api/admin/problems', '/api/problems'], { headers: authHeaders() });
    const items = data.items || [];
    app.innerHTML = `
      <div class="card highlight mb-lg">
        <div class="card-header">
          <h3 class="card-title">导入/更新题目压缩包</h3>
        </div>
        <div class="card-body">
          <p class="text-muted" style="font-size: 13.5px; margin-bottom: 12px;">上传标准 ZIP 题目包，包内需包含 problem.yaml、statement.md、public 文件夹（包含公开评测资源）和 private 文件夹（包含最终测试资源）。</p>
          <div class="row gap-md" style="flex-wrap: wrap;">
            <input type="file" id="problemZip" accept=".zip" style="width: auto; max-width: 320px;" />
            <button class="btn btn-primary" onclick="importProblem()">执行题包部署</button>
          </div>
          <div id="importResult" class="mt-md"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">平台装载题目清单 (${items.length} 道)</h3>
        </div>
        ${items.length === 0 ? emptyBox('平台尚未部署题目') : `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>题目标识 (Slug)</th>
                  <th>题目名称</th>
                  <th>评测可见状态</th>
                  <th>可用历史版本</th>
                  <th style="text-align: right;">快速调试</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(p => `
                  <tr>
                    <td><strong style="font-family: var(--font-mono);">${esc(p.slug)}</strong></td>
                    <td><strong>${esc(p.title)}</strong></td>
                    <td>${statusPill(p.status)}</td>
                    <td style="font-family: var(--font-mono); font-size: 12px;">${p.versions || '1'}</td>
                    <td>
                      <div class="row gap-xs" style="justify-content: flex-end;">
                        <a href="/problems/${esc(p.slug)}" class="btn btn-secondary btn-sm" data-link>预览</a>
                        <button class="btn btn-secondary btn-sm" onclick="setProblemStatus('${esc(p.slug)}', 'PUBLIC')">发布公开</button>
                        <button class="btn btn-secondary btn-sm" onclick="setProblemStatus('${esc(p.slug)}', 'DRAFT')">草稿锁定</button>
                        <button class="btn btn-danger btn-sm" onclick="setProblemStatus('${esc(p.slug)}', 'ARCHIVED')">封存归档</button>
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
  if (!fileInput || !fileInput.files.length) { toast('请先选择有效的 .zip 题包文件！', 'warning'); return; }
  const resultEl = $('importResult');
  resultEl.innerHTML = `
    <div style="display: flex; gap: 8px; align-items: center; font-size: 13.5px; color: var(--text-secondary);">
      <div class="spinner-ring" style="width:16px; height:16px; border-width:2px;"></div>
      <span>解密题包并验证沙箱配置，部署可能需要 3-10 秒...</span>
    </div>
  `;
  try {
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    const data = await tryApi(
      ['/api/admin/problems/import', '/api/admin/problem-packages/import'],
      { method: 'POST', headers: authHeaders(), body: fd }
    );
    resultEl.innerHTML = `
      <div class="notice success">
        <strong>部署成功!</strong> 题目: ${esc(data.slug)} 已经成功装载入库 (版本号: v${esc(data.version || '1')})。
      </div>
    `;
    toast('题包文件部署入库成功', 'success');
    setTimeout(() => renderProblemAdmin(), 1800);
  } catch (err) {
    resultEl.innerHTML = `<div class="notice error">部署导入失败: ${esc(err.message)}</div>`;
  }
}

async function setProblemStatus(slug, status) {
  try {
    await api(`/api/admin/problems/${slug}/status`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    toast(`题目 [${slug}] 的发布状态已成功变更为 [${status}]`, 'success');
    renderProblemAdmin();
  } catch (err) {
    toast(`变更状态失败: ${err.message}`, 'error');
  }
}

// Admin: Contest Management
async function renderContestAdmin() {
  setPage('比赛管理', '编排、监控与运作算法及深度学习赛事');
  if (!requireAdmin()) return;
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在查询平台赛事清单...</span>
    </div>
  `;
  try {
    const data = await api('/api/admin/contests', { headers: authHeaders() });
    const items = data.items || [];
    app.innerHTML = `
      <div class="row flex-between mb-lg" style="flex-wrap: wrap;">
        <h3 class="section-title">竞赛规划项目列表 (${items.length} 个赛事)</h3>
        <button class="btn btn-primary" onclick="showCreateContestModal()">+ 策划编排新比赛</button>
      </div>

      ${items.length === 0 ? emptyBox('平台暂未编排比赛') : `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>唯一标识 (Slug)</th>
                <th>比赛标题</th>
                <th>竞赛状态</th>
                <th>题目绑定量</th>
                <th>开始时间</th>
                <th>结束时间</th>
                <th style="text-align: right;">统筹操控</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(c => `
                <tr>
                  <td><strong style="font-family: var(--font-mono);">${esc(c.slug)}</strong></td>
                  <td><strong>${esc(c.title)}</strong></td>
                  <td>${contestStatePill(c.state || c.status)}</td>
                  <td>共 ${(c.problems || []).length || c.problem_count || 0} 题</td>
                  <td style="font-size: 12px;">${formatDate(c.start_at)}</td>
                  <td style="font-size: 12px;">${formatDate(c.end_at)}</td>
                  <td>
                    <div class="row gap-xs" style="justify-content: flex-end; flex-wrap: wrap;">
                      <a href="/contests/${esc(c.slug)}" class="btn btn-secondary btn-sm" data-link>前台页</a>
                      <button class="btn btn-secondary btn-sm" onclick="showContestSettingsModal('${esc(c.slug)}')">规则设置</button>
                      <button class="btn btn-secondary btn-sm" onclick="showRegistrationModal('${esc(c.slug)}')">选手审核</button>
                      <button class="btn btn-secondary btn-sm" onclick="showAnnouncementModal('${esc(c.slug)}')">发公告</button>
                      <button class="btn btn-ghost btn-sm" style="color: var(--color-primary);" onclick="window.open('/api/admin/contests/${esc(c.slug)}/registrations.csv')">选手CSV</button>
                      <button class="btn btn-ghost btn-sm" style="color: var(--color-accent);" onclick="window.open('/api/admin/contests/${esc(c.slug)}/scoreboard-advanced.csv')">成绩CSV</button>
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
    title: '编排新竞赛',
    wide: true,
    body: `
      <div class="form-row" style="display: flex; gap: var(--space-md); flex-wrap: wrap;">
        <div class="form-group" style="flex: 1; min-width: 260px;">
          <label for="cSlug">竞赛唯一标识 (Slug)</label>
          <input type="text" id="cSlug" placeholder="如: neurips-2026-challenge" />
        </div>
        <div class="form-group" style="flex: 1; min-width: 260px;">
          <label for="cTitle">竞赛显示名称</label>
          <input type="text" id="cTitle" placeholder="如: NeurIPS 2026 深度学习大模型对抗挑战赛" />
        </div>
      </div>
      <div class="form-row" style="display: flex; gap: var(--space-md); flex-wrap: wrap;">
        <div class="form-group" style="flex: 1; min-width: 260px;">
          <label for="cStart">竞赛开启时间</label>
          <input type="datetime-local" id="cStart" />
        </div>
        <div class="form-group" style="flex: 1; min-width: 260px;">
          <label for="cEnd">竞赛封榜/结束时间</label>
          <input type="datetime-local" id="cEnd" />
        </div>
      </div>
      <div class="form-group">
        <label for="cProblems">绑定赛题标识 (用半角逗号“,”或换行分隔，题目需先在题库部署完成)</label>
        <textarea id="cProblems" rows="3" placeholder="problem-a, problem-b, problem-c"></textarea>
      </div>
      <div class="form-group">
        <label for="cDesc">竞赛官方章程描述 (支持 Markdown 规范)</label>
        <textarea id="cDesc" rows="5" placeholder="请在此简述参赛资格、提交格式限制、评分细则等..."></textarea>
      </div>
      <div id="createContestError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="createContest()">保存赛事</button>
    `,
  });
}

async function createContest() {
  const slug = $('cSlug')?.value?.trim();
  const title = $('cTitle')?.value?.trim();
  if (!slug || !title) { toast('请填写竞赛 Slug 和显示名称！', 'warning'); return; }
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
    toast('成功策划并编排了一场新比赛！', 'success');
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
    openModal({
      title: `高级规则参数设置 — ${slug}`,
      wide: true,
      body: `
        <div class="form-row" style="display: flex; gap: var(--space-md); flex-wrap: wrap; margin-bottom: 10px;">
          <div class="form-group" style="flex: 1; min-width: 240px;">
            <label for="csVisibility">可见度限制</label>
            <select id="csVisibility">
              <option value="PUBLIC" ${c.visibility === 'PUBLIC' ? 'selected' : ''}>PUBLIC (公开检索)</option>
              <option value="PRIVATE" ${c.visibility === 'PRIVATE' ? 'selected' : ''}>PRIVATE (内嵌不可见)</option>
              <option value="UNLISTED" ${c.visibility === 'UNLISTED' ? 'selected' : ''}>UNLISTED (仅链接参赛)</option>
            </select>
          </div>
          <div class="form-group" style="flex: 1; min-width: 240px;">
            <label for="csRegMode">选手参赛注册模式</label>
            <select id="csRegMode">
              <option value="OPEN" ${c.registration_mode === 'OPEN' ? 'selected' : ''}>OPEN (自由加入)</option>
              <option value="INVITE" ${c.registration_mode === 'INVITE' ? 'selected' : ''}>INVITE (凭邀请密钥)</option>
              <option value="APPROVAL" ${c.registration_mode === 'APPROVAL' ? 'selected' : ''}>APPROVAL (裁判手动审核)</option>
              <option value="CLOSED" ${c.registration_mode === 'CLOSED' ? 'selected' : ''}>CLOSED (锁定停止注册)</option>
            </select>
          </div>
        </div>
        <div class="form-row" style="display: flex; gap: var(--space-md); flex-wrap: wrap; margin-bottom: 10px;">
          <div class="form-group" style="flex: 1; min-width: 240px;">
            <label for="csScoreMode">榜单计算模式</label>
            <select id="csScoreMode">
              <option value="SCORE" ${c.scoreboard_mode === 'SCORE' ? 'selected' : ''}>SCORE (分数制，公开度量分数累加)</option>
              <option value="ACM" ${c.scoreboard_mode === 'ACM' ? 'selected' : ''}>ACM (AC题目数优先，按罚时统计)</option>
            </select>
          </div>
          <div class="form-group" style="flex: 1; min-width: 240px;">
            <label for="csInviteCode">邀请密钥 (INVITE模式可用)</label>
            <input type="text" id="csInviteCode" value="${esc(c.invite_code || '')}" placeholder="空则表示无邀请限制" />
          </div>
        </div>
        <div class="form-row" style="display: flex; gap: var(--space-md); flex-wrap: wrap; margin-bottom: 15px;">
          <div class="form-group" style="flex: 1; min-width: 240px;">
            <label for="csPenalty">ACM 每题罚时惩罚 (分钟)</label>
            <input type="number" id="csPenalty" value="${c.penalty_minutes || 20}" />
          </div>
          <div class="form-group" style="flex: 1; min-width: 240px;">
            <label for="csFreeze">竞赛排行榜自动冻结时间点 (ISO格式)</label>
            <input type="text" id="csFreeze" value="${esc(c.freeze_at || '')}" placeholder="如: 2026-06-01T12:00:00Z" />
          </div>
        </div>
        
        <div class="form-group" style="display: flex; flex-direction: column; gap: 8px;">
          <label class="checkbox-label"><input type="checkbox" id="csHideProblems" ${c.hide_problems_before_start ? 'checked' : ''} /> 竞赛开赛前隐藏题目列表</label>
          <label class="checkbox-label"><input type="checkbox" id="csAllowJoin" ${c.allow_join_after_start !== false ? 'checked' : ''} /> 允许选手在比赛开赛后报名加入</label>
          <label class="checkbox-label"><input type="checkbox" id="csShowScoreboard" ${c.scoreboard_visible !== false ? 'checked' : ''} /> 允许选手前台浏览实时排行榜</label>
          <label class="checkbox-label"><input type="checkbox" id="csEnableQA" ${c.questions_enabled !== false ? 'checked' : ''} /> 启用前台裁判答疑模块</label>
          <label class="checkbox-label"><input type="checkbox" id="csEnableAnn" ${c.announcements_enabled !== false ? 'checked' : ''} /> 允许发布赛事官方公告</label>
          <label class="checkbox-label"><input type="checkbox" id="csShowPrivate" ${c.show_private_after_end ? 'checked' : ''} /> 竞赛结束后自动公开 Private 测试得分(最终排名)</label>
        </div>
        
        <div id="csError" class="notice error" style="display:none"></div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="saveContestSettings('${esc(slug)}')">确认保存高级设置</button>
      `,
    });
  } catch (err) {
    toast(`高级参数载入异常: ${err.message}`, 'error');
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
    toast('赛事参数配置已保存，已实时应用。', 'success');
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
      title: `选手报名与参赛资格审核 — ${slug}`,
      wide: true,
      body: `
        <div class="card mb-md" style="background: hsla(0,0%,0%,0.15);">
          <h4 class="card-title" style="margin-bottom: var(--space-sm);">批量导入/追加授权选手</h4>
          <div class="form-group" style="margin-bottom: var(--space-sm);">
            <textarea id="bulkUsers" rows="3" placeholder="输入选手的用户名或注册邮箱地址，多个名字以半角逗号“,”或换行分隔"></textarea>
          </div>
          <div class="row gap-sm">
            <button class="btn btn-primary btn-sm" onclick="bulkAddUsers('${esc(slug)}', 'ACCEPTED')">批量导入 (直接授权通行)</button>
            <button class="btn btn-secondary btn-sm" onclick="bulkAddUsers('${esc(slug)}', 'PENDING')">批量导入 (置于待审核状态)</button>
          </div>
          <div id="bulkResult" class="mt-sm"></div>
        </div>
        
        <h4 class="mb-sm">本场竞赛报名审核清单 (${items.length} 位选手)</h4>
        <div id="regList" style="max-height: 350px; overflow-y: auto;">
          ${items.length === 0 ? emptyBox('本竞赛尚未有选手发起报名申请') : `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>选手账号</th>
                    <th>注册邮箱</th>
                    <th>资格状态</th>
                    <th>报名申请时间</th>
                    <th style="text-align: right;">参赛操作</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map(r => `
                    <tr>
                      <td><strong>${esc(r.username)}</strong></td>
                      <td>${esc(r.email || '—')}</td>
                      <td>${statusPill(r.status)}</td>
                      <td style="font-size:12px;">${formatDate(r.joined_at)}</td>
                      <td>
                        <div class="row gap-xs" style="justify-content: flex-end;">
                          <button class="btn btn-primary btn-sm" onclick="setRegStatus('${esc(slug)}', ${r.user_id}, 'ACCEPTED')">批准</button>
                          <button class="btn btn-secondary btn-sm" onclick="setRegStatus('${esc(slug)}', ${r.user_id}, 'PENDING')">待审</button>
                          <button class="btn btn-danger btn-sm" onclick="setRegStatus('${esc(slug)}', ${r.user_id}, 'REJECTED')">驳回</button>
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
      footer: `<button class="btn btn-secondary" onclick="closeModal()">关闭面板</button>`,
    });
  } catch (err) {
    toast(`加载选手列表失败: ${err.message}`, 'error');
  }
}

async function setRegStatus(slug, userId, status) {
  try {
    await api(`/api/admin/contests/${slug}/registrations/${userId}/status`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    toast('选手参赛资格状态已更新', 'success');
    showRegistrationModal(slug); // Refresh UI
  } catch (err) {
    toast(`资格操作失败: ${err.message}`, 'error');
  }
}

async function bulkAddUsers(slug, status) {
  const users = $('bulkUsers')?.value?.trim();
  if (!users) { toast('请填入要批量导入的选手名单！', 'warning'); return; }
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
      <div class="notice success" style="margin-top: var(--space-sm);">
        成功导入且授权 ${added.length} 名选手。
      </div>
      ${missing.length ? `<div class="notice warning">平台数据库未录入选手: ${missing.join(', ')}，请选手先注册平台账号。</div>` : ''}
    `;
    setTimeout(() => showRegistrationModal(slug), 1800);
  } catch (err) {
    resultEl.innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
  }
}

function showAnnouncementModal(slug) {
  openModal({
    title: `发布赛事官方公告 — ${slug}`,
    body: `
      <div class="form-group">
        <label for="annTitle">公告标题摘要</label>
        <input type="text" id="annTitle" placeholder="如: 关于B题测试数据集规范微调通告" />
      </div>
      <div class="form-group">
        <label for="annBody">公告详细说明 (支持 Markdown 规范)</label>
        <textarea id="annBody" rows="6" placeholder="请具体写明变更内容、注意事项等，发布后将实时对全体选手可见并推送..."></textarea>
      </div>
      <div id="annError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="publishAnnouncement('${esc(slug)}')">发布赛事公告</button>
    `,
  });
}

async function publishAnnouncement(slug) {
  const title = $('annTitle')?.value?.trim();
  const body = $('annBody')?.value || '';
  if (!title) { toast('请输入公告标题！', 'warning'); return; }
  try {
    await api(`/api/admin/contests/${slug}/announcements`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body_md: body }),
    });
    closeModal();
    toast('官方公告发布成功，已推送至本场竞赛前台。', 'success');
  } catch (err) {
    const el = $('annError');
    if (el) { el.style.display = ''; el.textContent = err.message; }
  }
}

// ─── SPA Router ─────────────────────────────────────────────────────────────
function route() {
  clearPageState();
  let path = location.pathname || '/';

  // Support legacy hash routers redirects
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

  // 404 handler
  setPage('异常访问', '404 错误');
  app.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🔍</div>
      <h2 style="font-family: var(--font-display); font-size: 20px; font-weight:700; margin-bottom: 6px;">工作区不存在</h2>
      <p class="text-muted" style="margin-bottom: 16px;">您访问的路由指向了系统未定义的核心节点，请核对地址栏 URL</p>
      <a href="/" class="btn btn-primary" data-link>回到平台首页</a>
    </div>
  `;
}

// ─── Dom Initialize ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  $('authBtn').addEventListener('click', () => showAuthModal());
  $('logoutBtn').addEventListener('click', logout);

  // Mobile drawer trigger
  $('menuBtn').addEventListener('click', () => {
    $('sidebar').classList.toggle('open');
    $('sidebarOverlay').classList.toggle('open');
  });
  $('sidebarOverlay').addEventListener('click', () => {
    $('sidebar').classList.remove('open');
    $('sidebarOverlay').classList.remove('open');
  });

  // Modal triggers
  $('modalCloseBtn').addEventListener('click', closeModal);
  $('modalRoot').addEventListener('click', (e) => {
    if (e.target.id === 'modalRoot') closeModal();
  });

  document.addEventListener('click', handleSpaLinkClick);
  window.addEventListener('popstate', () => route());

  // Global change listeners for files display
  document.addEventListener('change', (e) => {
    if (e.target.type === 'file' && e.target.id !== 'submitFile') {
      const label = e.target.closest('.file-upload')?.querySelector('.file-upload-label span:last-child');
      if (label && e.target.files.length) {
        label.textContent = e.target.files[0].name;
      }
    }
  });

  // Startup checks
  checkHealth();
  loadMe().then(() => route());
});

// ─── Window exports for handlers ──────────────────────────────────────────
Object.assign(window, {
  navigate, showAuthModal, switchAuthTab, submitAuth, logout,
  submitSolution, showContestTab, switchProblemTab, handleFileSelect,
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
  closeModal, copyTerminalText
});
