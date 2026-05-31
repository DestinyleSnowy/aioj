/* ═══════════════════════════════════════════════════════════════════════════
   AIOJ — AI Olympiad Judge  ·  Core SPA Logic
   Premium redesigned interface with modular layouts and rich micro-interactions
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── Theme Management ───────────────────────────────────────────────────────
function initTheme() {
  const savedTheme = localStorage.getItem('aioj_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('aioj_theme', newTheme);
  toast(`已切换至${newTheme === 'dark' ? '深色' : '浅色'}模式`, 'info');
}

// Run theme init immediately to prevent page flash
initTheme();

// ─── Utilities ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const state = {
  token: localStorage.getItem('aioj_token') || '',
  user: null,
  healthOk: false,
  currentRoute: '',
  countdownTimer: null,
  activeProblemTab: 'statement', // Default tab in problem detail
  notificationUnreadCount: 0,
  messageUnreadCount: 0,
  messageRefreshTimer: null,
  messageRefreshInFlight: false,
};

const MESSAGE_REFRESH_INTERVAL_MS = 5000;

function setPage(title) {
  $('pageTitle').textContent = title || 'AIOJ';
  if ($('pageSubtitle')) {
    $('pageSubtitle').textContent = '';
    $('pageSubtitle').style.display = 'none';
  }
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
    if (res.status === 401 && state.token) {
      state.token = '';
      localStorage.removeItem('aioj_token');
      state.user = null;
      state.notificationUnreadCount = 0;
      state.messageUnreadCount = 0;
      updateNav();
      toast('登录会话已过期，请重新登录。', 'warning');
    }
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

function safeMdHref(value) {
  const raw = String(value || '').trim();
  if (!raw) return '#';
  try {
    const decoded = raw.replaceAll('&amp;', '&');
    if ((decoded.startsWith('/') && !decoded.startsWith('//')) || decoded.startsWith('#')) return esc(decoded);
    const url = new URL(decoded, window.location.origin);
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return esc(decoded);
  } catch {
    return '#';
  }
  return '#';
}

function jsArg(value) {
  return esc(JSON.stringify(value));
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
  
  // Render lists: match consecutive lines starting with - or * and format as <ul><li>
  t = t.replace(/((?:^\s*[-*]\s+.*(?:\n|$))+)/gm, (match) => {
    let listItems = match.trim().split('\n').map(line => {
      let content = line.replace(/^\s*[-*]\s+/, '');
      return `<li>${content}</li>`;
    }).join('');
    return `<ul>${listItems}</ul>`;
  });

  // Render links with a conservative protocol allow-list.
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safeHref = safeMdHref(href);
    const target = safeHref.startsWith('/') || safeHref.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"';
    return `<a href="${safeHref}"${target} class="text-primary" style="text-decoration: underline;">${label}</a>`;
  });
  
  t = t.replace(/\n{2,}/g, '</p><p>');
  t = t.replace(/\n/g, '<br>');
  return `<div class="md-content"><p>${t}</p></div>`;
}

function statusPill(s) {
  s = String(s || '').toUpperCase();
  const cls =
    s === 'ACCEPTED' || s === 'PUBLIC' || s === 'RUNNING' || s === 'RUN_FINISHED' || s === 'PASSED' || s === 'ACTIVE' ? 'green' :
    s.includes('FAIL') || s === 'REJECTED' || s === 'ENDED' || s === 'ERROR' || s === 'ARCHIVED' ? 'red' :
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
  if (type === 'danger') type = 'error';
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
  stopMessageAutoRefresh();
  $('sidebar').classList.remove('open');
  $('sidebarOverlay').classList.remove('open');
}

function stopMessageAutoRefresh() {
  if (state.messageRefreshTimer) {
    clearInterval(state.messageRefreshTimer);
    state.messageRefreshTimer = null;
  }
  state.messageRefreshInFlight = false;
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

  $('userDropdownContainer').style.display = state.user ? 'block' : 'none';
  $('authBtn').style.display = state.user ? 'none' : '';
  $('notificationBtn').style.display = state.user ? 'inline-flex' : 'none';
  $('messageBtn').style.display = state.user ? 'inline-flex' : 'none';

  const badge = $('notificationBadge');
  if (badge) {
    const unread = Number(state.notificationUnreadCount || 0);
    badge.style.display = state.user && unread > 0 ? '' : 'none';
    badge.textContent = unread > 99 ? '99+' : String(unread);
  }

  const messageBadge = $('messageBadge');
  if (messageBadge) {
    const unread = Number(state.messageUnreadCount || 0);
    messageBadge.style.display = state.user && unread > 0 ? '' : 'none';
    messageBadge.textContent = unread > 99 ? '99+' : String(unread);
  }

  const userPill = $('userPill');
  if (state.user) {
    userPill.innerHTML = `
      <div class="user-avatar">${esc(state.user.username[0].toUpperCase())}</div>
      <span class="user-name">${esc(state.user.username)}</span>
      <svg class="dropdown-arrow" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 6px;">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
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
  if (!state.token) {
    state.user = null;
    state.notificationUnreadCount = 0;
    state.messageUnreadCount = 0;
    updateNav();
    return;
  }
  try {
    const data = await api('/api/auth/me', { headers: authHeaders() });
    state.user = data.user || data;
    await Promise.allSettled([refreshNotificationCount(), refreshMessageCount()]);
    updateNav();
  } catch {
    state.token = '';
    localStorage.removeItem('aioj_token');
    state.user = null;
    state.notificationUnreadCount = 0;
    state.messageUnreadCount = 0;
    updateNav();
  }
}

async function refreshNotificationCount() {
  if (!state.token || !state.user) {
    state.notificationUnreadCount = 0;
    updateNav();
    return;
  }
  try {
    const data = await api('/api/notifications/unread-count', { headers: authHeaders() });
    state.notificationUnreadCount = Number(data.unread_count || 0);
  } catch {
    state.notificationUnreadCount = 0;
  }
  updateNav();
}

async function refreshMessageCount() {
  if (!state.token || !state.user) {
    state.messageUnreadCount = 0;
    updateNav();
    return;
  }
  try {
    const data = await api('/api/messages/unread-count', { headers: authHeaders() });
    state.messageUnreadCount = Number(data.unread_count || 0);
  } catch {
    state.messageUnreadCount = 0;
  }
  updateNav();
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
  state.notificationUnreadCount = 0;
  state.messageUnreadCount = 0;
  localStorage.removeItem('aioj_token');
  updateNav();
  toast('已成功登出您的账号', 'info');
  navigate('/');
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
async function renderDashboard() {
  setPage('平台概览');
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

    // Calculate solved problems stats
    const solvedSlugs = new Set(
      submissions
        .filter(s => s.status === 'ACCEPTED' || s.status === 'RUN_FINISHED')
        .map(s => s.problem_slug || s.problem_title)
        .filter(Boolean)
    );
    const solvedCount = solvedSlugs.size;
    const totalCount = problems.length;
    const solvedPercent = totalCount > 0 ? Math.round((solvedCount / totalCount) * 100) : 0;
    
    // SVG stroke dash calculate
    const radius = 30;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (solvedPercent / 100) * circumference;

    app.innerHTML = `
      <div class="dashboard-layout">
        <!-- Main Column (Left) -->
        <div style="display: flex; flex-direction: column; gap: var(--space-lg); min-width: 0;">

          <div class="stats-row" style="margin-bottom: 0;">
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
              <div class="stat-label">进行中比赛</div>
            </div>
            <div class="stat-card" style="border-color: var(--color-success);">
              <div class="stat-value" style="color: var(--color-success);">${solvedCount}</div>
              <div class="stat-label">已通过题目</div>
            </div>
          </div>

          ${runningContests.length > 0 ? `
            <div class="card highlight">
              <div class="card-header" style="margin-bottom: var(--space-md);">
                <h3 class="card-title">
                  <span class="pulsing-dot"></span> 🔥 正在进行的比赛
                </h3>
              </div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style="width: 140px;">赛事状态</th>
                      <th>竞赛名称与基本规格</th>
                      <th style="width: 150px;">赛题数量</th>
                      <th style="width: 140px; text-align: right;">进入行动</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${runningContests.map(c => `
                      <tr class="clickable-row" onclick="if (!event.target.closest('a') && !event.target.closest('button')) navigate('/contests/${esc(c.slug)}')" style="transition: all var(--transition-fast);">
                        <td>
                          <span class="pill green" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px;"><span class="pulsing-dot" style="display:inline-block; margin-right:4px;"></span>进行中</span>
                        </td>
                        <td>
                          <div style="font-weight: 700; font-size: 14.5px; color: var(--text-main); font-family: var(--font-display);">${esc(c.title)}</div>
                          <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-top: 4px;">SLUG: ${esc(c.slug)}</div>
                        </td>
                        <td>
                          <span class="pill blue" style="font-family: var(--font-mono); font-size: 11px;">${c.problem_count || 0} 道题</span>
                        </td>
                        <td style="text-align: right;">
                          <a href="/contests/${esc(c.slug)}" class="btn btn-primary btn-sm" style="font-size: 11px; padding: 6px 14px;" data-link>立即参赛 🚀</a>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}

          ${upcomingContests.length > 0 ? `
            <div class="card">
              <div class="card-header" style="margin-bottom: var(--space-md);">
                <h3 class="card-title">📅 即将开始的比赛</h3>
              </div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style="width: 140px;">赛事状态</th>
                      <th>竞赛名称与基本规格</th>
                      <th style="width: 150px;">赛题数量</th>
                      <th style="width: 140px; text-align: right;">进入行动</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${upcomingContests.map(c => `
                      <tr class="clickable-row" onclick="if (!event.target.closest('a') && !event.target.closest('button')) navigate('/contests/${esc(c.slug)}')" style="transition: all var(--transition-fast);">
                        <td>
                          <span class="pill yellow" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px;">📅 未开启</span>
                        </td>
                        <td>
                          <div style="font-weight: 700; font-size: 14.5px; color: var(--text-main); font-family: var(--font-display);">${esc(c.title)}</div>
                          <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-top: 4px;">SLUG: ${esc(c.slug)}</div>
                        </td>
                        <td>
                          <span class="pill blue" style="font-family: var(--font-mono); font-size: 11px;">${c.problem_count || 0} 道题</span>
                        </td>
                        <td style="text-align: right;">
                          <a href="/contests/${esc(c.slug)}" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 14px;" data-link>查看详情</a>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}

          <div class="card">
            <div class="card-header" style="margin-bottom: var(--space-md);">
              <h3 class="card-title">推荐挑战题目</h3>
              <a href="/problems" class="btn btn-ghost btn-sm" data-link>题库主页 →</a>
            </div>
            ${problems.length === 0 ? emptyBox('暂无可用题目') : `
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>算法题目信息</th>
                      <th style="width: 160px;">评测指标</th>
                      <th style="width: 220px;">系统限制规格</th>
                      <th style="width: 120px; text-align: right;">挑战行动</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${problems.slice(0, 6).map(p => `
                      <tr class="clickable-row" onclick="if (!event.target.closest('a') && !event.target.closest('button')) navigate('/problems/${esc(p.slug)}')" style="transition: all var(--transition-fast);">
                        <td>
                          <div style="font-weight: 700; font-size: 15px; color: var(--text-main); font-family: var(--font-display);">${esc(p.title)}</div>
                          <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-top: 4px;">ID: ${esc(p.slug)}</div>
                        </td>
                        <td>
                          <span class="pill blue" style="text-transform: lowercase; font-family: var(--font-mono);">${esc(p.metric || 'accuracy')}</span>
                        </td>
                        <td style="font-family: var(--font-mono); font-size: 12.5px; color: var(--text-secondary);">
                          ⏱️ ${p.time_limit_sec || 60}s &nbsp;·&nbsp; 💾 ${Math.round((p.memory_limit_mb || 2048) / 1024 * 10) / 10}GB
                        </td>
                        <td style="text-align: right;">
                          <a href="/problems/${esc(p.slug)}" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 14px;" data-link>立即挑战 🚀</a>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>

        <!-- Sidebar Column (Right) -->
        <div style="display: flex; flex-direction: column; gap: var(--space-md);">
          <!-- User Profile & Stats ring -->
          <div class="card">
            <h3 class="card-title" style="margin-bottom: var(--space-sm);">我的参赛进度</h3>
            ${state.user ? `
              <div style="display: flex; align-items: center; gap: var(--space-md); margin-top: 10px;">
                <div style="position: relative; width: 72px; height: 72px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                  <svg width="72" height="72">
                    <circle stroke="var(--border-light)" stroke-width="5" fill="transparent" r="${radius}" cx="36" cy="36"/>
                    <circle stroke="var(--color-primary)" stroke-width="5" stroke-dasharray="${circumference}" stroke-dashoffset="${strokeDashoffset}" stroke-linecap="round" fill="transparent" r="${radius}" cx="36" cy="36" style="transform: rotate(-90deg); transform-origin: 36px 36px; transition: stroke-dashoffset 0.5s ease-in-out;"/>
                  </svg>
                  <span style="position: absolute; font-size: 13px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main);">${solvedPercent}%</span>
                </div>
                <div>
                  <div style="font-weight: 700; color: var(--text-main); font-size: 15px;">${esc(state.user.username)}</div>
                  <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">已通过 ${solvedCount} / ${totalCount} 题</div>
                </div>
              </div>
            ` : `
              <div style="padding: 10px 0; text-align: center;">
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">登录以查看并同步您的学习和参赛进度</p>
                <button class="btn btn-primary btn-sm full-width" onclick="showAuthModal()">立即登录</button>
              </div>
            `}
          </div>

          <!-- Distributed evaluation node stats -->
          <div class="card">
            <h3 class="card-title" style="margin-bottom: 12px;">评测集群状态</h3>
            <div style="display:flex; flex-direction: column; gap: 8px;">
              <div style="display:flex; justify-content:space-between; align-items:center; padding: 8px 12px; border-radius: var(--radius-sm); background: hsla(0,0%,100%,0.02); border: var(--border-subtle); font-size:12px;">
                <span style="color:var(--text-secondary); font-weight:500;">API Server Gateway</span>
                <span class="pill green" style="padding: 2px 8px; font-size: 10px; border-radius: 4px;">🟢 运行中</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; padding: 8px 12px; border-radius: var(--radius-sm); background: hsla(0,0%,100%,0.02); border: var(--border-subtle); font-size:12px;">
                <span style="color:var(--text-secondary); font-weight:500;">api-local-worker</span>
                <span class="pill green" style="padding: 2px 8px; font-size: 10px; border-radius: 4px;">🟢 运行中</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; padding: 8px 12px; border-radius: var(--radius-sm); background: hsla(0,0%,100%,0.02); border: var(--border-subtle); font-size:12px;">
                <span style="color:var(--text-secondary); font-weight:500;">Docker Sandbox</span>
                <span class="pill blue" style="padding: 2px 8px; font-size: 10px; border-radius: 4px;">🛡️ 隔离保护</span>
              </div>
            </div>
          </div>

          <!-- Recent my submissions list -->
          <div class="card">
            <div class="card-header" style="margin-bottom: var(--space-md);">
              <h3 class="card-title">最近评测诊断</h3>
            </div>
            ${submissions.length === 0 ? emptyBox('暂无评测历史记录') : `
              <div style="display: flex; flex-direction: column; gap: 10px;">
                ${submissions.slice(0, 4).map(s => `
                  <div class="clickable-row" onclick="navigate('/submissions/${s.id}')" style="padding: 10px; border-radius: var(--radius-sm); background: hsla(0,0%,100%,0.015); border: var(--border-subtle); display:flex; justify-content:space-between; align-items:center;">
                    <div style="min-width: 0; flex: 1; padding-right: 10px;">
                      <div style="font-weight:600; font-size:12.5px; color:var(--text-main); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${esc(s.problem_slug || s.problem_title)}</div>
                      <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">#${s.id} · ${formatDate(s.created_at)}</div>
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px; flex-shrink: 0;">
                      ${statusPill(s.status)}
                      <span style="font-family: var(--font-mono); font-size:11.5px; font-weight:700; color:var(--color-primary);">${scoreDisplay(s.public_score)}</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
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
    <div class="contest-card" onclick="if (!event.target.closest('a') && !event.target.closest('button')) navigate('/contests/${esc(c.slug)}')" style="cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; gap: var(--space-md); transition: all var(--transition-base);">
      <div>
        <div style="display: flex; justify-content: space-between; align-items: start; gap: var(--space-sm);">
          <span style="font-weight: 700; font-size: 14.5px; color: var(--text-main); font-family: var(--font-display);">${esc(c.title)}</span>
          ${contestStatePill(st)}
        </div>
        <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-top: 4px;">ID: ${esc(c.slug)}</div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-subtle); padding-top: var(--space-sm); font-size: 12px;">
        <span class="pill blue" style="font-size: 10px; font-family: var(--font-mono);">${c.problem_count || 0} 道题</span>
        <a href="/contests/${esc(c.slug)}" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 10px;" data-link>立即进入</a>
      </div>
    </div>
  `;
}

// ─── Problems Library ───────────────────────────────────────────────────────
async function renderProblems() {
  setPage('公开题库');
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在检索题库列表...</span>
    </div>
  `;
  try {
    const [problemsData, subsData] = await Promise.allSettled([
      api('/api/problems'),
      state.token ? api('/api/my/submissions', { headers: authHeaders() }) : Promise.resolve({ items: [] }),
    ]);

    const items = problemsData.status === 'fulfilled' ? (problemsData.value.items || []) : [];
    const submissions = subsData.status === 'fulfilled' ? (subsData.value.items || []) : [];

    if (items.length === 0) {
      app.innerHTML = emptyBox('题库尚未上传公开题目');
      return;
    }

    const solvedSlugs = new Set();
    const attemptedSlugs = new Set();
    submissions.forEach(s => {
      const slug = s.problem_slug || s.problem_title;
      if (!slug) return;
      if (s.status === 'ACCEPTED' || s.status === 'RUN_FINISHED') {
        solvedSlugs.add(slug);
      } else {
        attemptedSlugs.add(slug);
      }
    });

    const getStatusPill = (slug) => {
      if (solvedSlugs.has(slug)) {
        return `<span class="pill green" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px;">已通过</span>`;
      }
      if (attemptedSlugs.has(slug)) {
        return `<span class="pill yellow" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px;">已尝试</span>`;
      }
      return `<span class="pill gray" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px; opacity:0.65;">未尝试</span>`;
    };
    const getProgressState = (slug) => solvedSlugs.has(slug) ? 'solved' : attemptedSlugs.has(slug) ? 'attempted' : 'new';
    const metricOptions = Array.from(new Set(items.map(p => p.metric || 'accuracy'))).sort();

    app.innerHTML = `
      <div class="card" style="margin-bottom: var(--space-md);">
        <div class="row gap-sm" style="flex-wrap: wrap;">
          <input id="problemSearchInput" type="search" placeholder="搜索题目标题或 Slug" style="flex: 1 1 260px;" />
          <select id="problemMetricFilter" style="width: 180px;">
            <option value="">全部指标</option>
            ${metricOptions.map(metric => `<option value="${esc(metric)}">${esc(metric)}</option>`).join('')}
          </select>
          <select id="problemProgressFilter" style="width: 160px;">
            <option value="">全部状态</option>
            <option value="solved">已通过</option>
            <option value="attempted">已尝试</option>
            <option value="new">未尝试</option>
          </select>
          <span id="problemFilterCount" class="text-muted" style="font-size: 12px; margin-left: auto;">共 ${items.length} 题</span>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width: 140px;">我的状态</th>
              <th>算法题目信息</th>
              <th style="width: 160px;">评测指标</th>
              <th style="width: 220px;">系统限制规格</th>
              <th style="width: 120px; text-align: right;">挑战行动</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(p => `
              <tr class="clickable-row problem-row" data-title="${esc(p.title)}" data-slug="${esc(p.slug)}" data-metric="${esc(p.metric || 'accuracy')}" data-progress="${getProgressState(p.slug)}" onclick="if (!event.target.closest('a') && !event.target.closest('button')) navigate('/problems/${esc(p.slug)}')" style="transition: all var(--transition-fast);">
                <td style="font-weight: 500;">
                  ${getStatusPill(p.slug)}
                </td>
                <td>
                  <div style="font-weight: 700; font-size: 15px; color: var(--text-main); font-family: var(--font-display);">${esc(p.title)}</div>
                  <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-top: 4px;">ID: ${esc(p.slug)}</div>
                </td>
                <td>
                  <span class="pill blue" style="text-transform: lowercase; font-family: var(--font-mono);">${esc(p.metric || 'accuracy')}</span>
                </td>
                <td style="font-family: var(--font-mono); font-size: 12.5px; color: var(--text-secondary);">
                  <div>⏱️ ${p.time_limit_sec || 60}s &nbsp;·&nbsp; 💾 ${Math.round((p.memory_limit_mb || 2048) / 1024 * 10) / 10}GB</div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">CPU: ${p.cpu_count || 2} 核</div>
                </td>
                <td style="text-align: right;">
                  <a href="/problems/${esc(p.slug)}" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 14px;" data-link>立即挑战 🚀</a>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    const applyProblemFilters = () => {
      const q = ($('problemSearchInput')?.value || '').trim().toLowerCase();
      const metric = $('problemMetricFilter')?.value || '';
      const progress = $('problemProgressFilter')?.value || '';
      let visible = 0;
      document.querySelectorAll('.problem-row').forEach(row => {
        const haystack = `${row.dataset.title || ''} ${row.dataset.slug || ''}`.toLowerCase();
        const ok = (!q || haystack.includes(q)) &&
          (!metric || row.dataset.metric === metric) &&
          (!progress || row.dataset.progress === progress);
        row.style.display = ok ? '' : 'none';
        if (ok) visible++;
      });
      const countEl = $('problemFilterCount');
      if (countEl) countEl.textContent = `显示 ${visible} / ${items.length} 题`;
    };
    ['problemSearchInput', 'problemMetricFilter', 'problemProgressFilter'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', applyProblemFilters);
      if (el) el.addEventListener('change', applyProblemFilters);
    });
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

// ─── Problem Workspace ──────────────────────────────────────────────────────
async function renderProblemDetail(slug, contestSlug = null) {
  setPage('正在载入题目');
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

    setPage(problem.title);

    app.innerHTML = `
      ${contestSlug ? `
        <a href="/contests/${esc(contestSlug)}" class="breadcrumb" data-link>← 返回竞技比赛主页</a>
      ` : ''}
      <div class="problem-layout">
        <div class="problem-main">
          <!-- Workspace Navigation Tabs -->
          <div class="tabs" id="problemTabs">
            <button class="tab active" onclick="switchProblemTab('statement')">题目详情与规范</button>
            <button class="tab" id="editorTabHeader" onclick="switchProblemTab('editor')">在线代码编辑器 💻</button>
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

          <!-- Editor Tab -->
          <div class="tab-panel" id="tab-editor">
            <div class="ide-container" style="margin-bottom: var(--space-md);">
              <!-- IDE Toolbar -->
              <div class="ide-toolbar">
                <div class="ide-toolbar-left">
                  <div class="ide-mode-switcher">
                    <button class="ide-mode-btn active" id="modeScript" onclick="switchEditorMode('script', '${esc(slug)}')">📄 Python 脚本</button>
                    <button class="ide-mode-btn" id="modeNotebook" onclick="switchEditorMode('notebook', '${esc(slug)}')">📓 Notebook 单元格</button>
                  </div>
                  <span class="ide-file-label">
                    <span class="dot-indicator"></span>
                    <span id="ideFileLabel">predict.py</span>
                  </span>
                </div>
                <div class="ide-toolbar-right">
                  <span style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono);">Python 3 &amp; ML Libs</span>
                  <button class="btn btn-ghost btn-sm" onclick="resetEditorCode('${esc(slug)}')" style="font-size: 11px; padding: 4px 10px; gap: 4px;">
                    <span>🔄</span> 重置
                  </button>
                  <button class="btn btn-ghost btn-sm" onclick="toggleFullscreenEditor()" id="btnFullscreenEditor" style="font-size: 11px; padding: 4px 10px; gap: 4px;" title="全屏模式">
                    <span>⛶</span> 全屏
                  </button>
                </div>
              </div>
              <div class="ide-editor-body" id="editorScriptMode">
                <div class="ide-line-numbers" id="lineNumbers"></div>
                <textarea id="codeEditor" class="ide-textarea" spellcheck="false" placeholder="在此编写 Python 预测代码..."></textarea>
              </div>
              <div id="editorNotebookMode" style="display: none;">
                <div class="ide-cells-container" id="nbCellsContainer"></div>
              </div>
              <div class="ide-actions">
                <button class="btn btn-secondary" onclick="runSandboxTest('${esc(slug)}')" id="btnRunTest" style="gap: 8px;">
                  🧪 运行测试
                </button>
                <button class="btn btn-primary" onclick="submitEditorCode('${esc(slug)}', ${contestSlug ? `'${esc(contestSlug)}'` : 'null'})" id="btnSubmitCode" style="gap: 8px;">
                  🚀 正式提交
                </button>
              </div>
            </div>
            <div class="ide-terminal" id="terminalCard">
              <div class="ide-terminal-header">
                <div class="term-title">
                  <span style="font-size: 13px;">📟</span>
                  <span>沙箱终端 Console</span>
                </div>
                <div class="term-status">
                  <span id="terminalStatusDot" style="width: 8px; height: 8px; background: var(--text-muted); border-radius: 50%; display: inline-block;"></span>
                  <span style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted);" id="terminalStatusText">READY</span>
                  <button class="btn btn-ghost btn-sm" onclick="$('terminalOutput').innerHTML = '';" style="font-size: 10px; padding: 2px 6px; opacity: 0.6;">清空</button>
                  <button class="btn btn-ghost btn-sm" onclick="copyTerminalText()" style="font-size: 10px; padding: 2px 6px; opacity: 0.6;">复制</button>
                </div>
              </div>
              <pre class="ide-terminal-output" id="terminalOutput"></pre>
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
              <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-sm); border-bottom: var(--border-subtle); padding-bottom: 8px;">
                <h3 class="card-title" style="font-size: 13.5px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
                  <span>🏆</span> 实时评测排行榜
                </h3>
                <button class="btn btn-ghost btn-sm" onclick="loadProblemLeaderboard('${esc(slug)}')" style="font-size: 11px; padding: 4px 10px; display: flex; align-items: center; gap: 4px;">
                  <span>🔄</span> 刷新排行
                </button>
              </div>
              <div id="problemLeaderboard" style="padding-top: var(--space-xs);">
                <div class="loading-overlay" style="min-height: 150px;">
                  <div class="spinner-ring"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Sidebar Actions & Specs -->
        <div class="problem-side" style="display: flex; flex-direction: column; gap: var(--space-md);">
          <!-- Step 1: Download Sample -->
          <div class="card" style="margin-bottom: 0;">
            <h3 class="card-title" style="margin-bottom: var(--space-sm); font-size: 13.5px; color: var(--text-secondary);">1. 研发阶段：下载解答包范例</h3>
            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.5;">下载评测要求的目录规范与数据接口，用于本地编写预测算法。</p>
            <a href="/api/problems/${esc(slug)}/sample-submission" target="_blank" class="btn btn-secondary btn-sm full-width">
              📥 下载示例提交 (.csv)
            </a>
          </div>

          <!-- Step 2: Upload Solution -->
          <div class="card highlight" style="margin-bottom: 0;">
            <h3 class="card-title" style="margin-bottom: var(--space-sm); font-size: 13.5px;">2. 评测阶段：提报解答文件</h3>
            
            <div class="file-upload" id="uploadArea" style="padding: 16px 10px; min-height: unset; margin-bottom: 12px;">
              <input type="file" id="submitFile" accept=".zip,.ipynb" onchange="handleFileSelect(this)" />
              <div class="file-upload-label" style="gap: 4px;">
                <span class="file-upload-icon" style="font-size: 18px;">📁</span>
                <span id="uploadFileName" style="font-weight: 600; color: var(--text-main); font-size: 12px;">选择或拖入解答文件 (.zip / .ipynb)</span>
                <span style="font-size: 10.5px; color: var(--text-muted);">支持 ZIP 压缩包和 Jupyter Notebook</span>
              </div>
            </div>
            
            <button class="btn btn-primary full-width" onclick="submitSolution('${esc(slug)}', ${contestSlug ? `'${esc(contestSlug)}'` : 'null'})">
              🚀 启动容器沙箱评测
            </button>
          </div>

          <!-- Specs details -->
          <div class="card">
            <h3 class="card-title" style="margin-bottom: var(--space-sm); font-size: 13.5px; color: var(--text-secondary);">本题系统环境规格</h3>
            <div class="config-list">
              <div class="config-item">
                <span class="config-label" style="display: flex; align-items: center; gap: 8px;">
                  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.2" fill="none" style="color: var(--color-primary); flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>
                  度量指标
                </span>
                <span style="font-weight: 700; font-family: var(--font-mono); font-size: 12px; color: var(--text-main);">${esc(problem.metric || 'accuracy')}</span>
              </div>
              <div class="config-item">
                <span class="config-label" style="display: flex; align-items: center; gap: 8px;">
                  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.2" fill="none" style="color: var(--color-primary); ${problem.higher_is_better ? '' : 'transform: rotate(180deg);'} flex-shrink: 0;"><polyline points="18 15 12 9 6 15"></polyline></svg>
                  优化方向
                </span>
                <span style="font-size: 12.5px;">${problem.higher_is_better ? '分数越高越好 ↑' : '分数越低越好 ↓'}</span>
              </div>
              <div class="config-item">
                <span class="config-label" style="display: flex; align-items: center; gap: 8px;">
                  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.2" fill="none" style="color: var(--color-primary); flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  运行限时
                </span>
                <span style="font-weight: 600; font-family: var(--font-mono);">${problem.time_limit_sec || 60} 秒</span>
              </div>
              <div class="config-item">
                <span class="config-label" style="display: flex; align-items: center; gap: 8px;">
                  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.2" fill="none" style="color: var(--color-primary); flex-shrink: 0;"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path></svg>
                  运行内存
                </span>
                <span style="font-weight: 600; font-family: var(--font-mono);">${problem.memory_limit_mb || 2048} MB</span>
              </div>
              <div class="config-item">
                <span class="config-label" style="display: flex; align-items: center; gap: 8px;">
                  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.2" fill="none" style="color: var(--color-primary); flex-shrink: 0;"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="15" x2="23" y2="15"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="15" x2="4" y2="15"></line></svg>
                  分配核数
                </span>
                <span style="font-weight: 600; font-family: var(--font-mono);">${problem.cpu_count || 2} 核 CPU</span>
              </div>
              <div class="config-item">
                <span class="config-label" style="display: flex; align-items: center; gap: 8px;">
                  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.2" fill="none" style="color: var(--color-primary); flex-shrink: 0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                  输出限制
                </span>
                <span style="font-weight: 600; font-family: var(--font-mono);">${problem.output_limit_mb || 64} MB</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Load leaderboard
    loadProblemLeaderboard(slug);
    // Init Drag and Drop upload area triggers
    initDragAndDrop();

    // Setup online code editor
    state.activeProblemSlug = slug;
    const textarea = $('codeEditor');
    if (textarea) {
      const savedCode = localStorage.getItem(`aioj_code_${slug}`) || CODE_TEMPLATE;
      textarea.value = savedCode;
      
      // Sync line numbers initially
      initEditorLineNumbers();

      // Save code on edit
      textarea.addEventListener('input', (e) => {
        localStorage.setItem(`aioj_code_${slug}`, e.target.value);
        initEditorLineNumbers();
      });

      // Tab indent listener
      textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = this.selectionStart;
          const end = this.selectionEnd;
          this.value = this.value.substring(0, start) + "    " + this.value.substring(end);
          this.selectionStart = this.selectionEnd = start + 4;
          localStorage.setItem(`aioj_code_${slug}`, this.value);
          initEditorLineNumbers();
        }
      });

      // Drag & Drop for Editor
      const ideContainer = document.querySelector('.ide-container');
      if (ideContainer) {
        ideContainer.addEventListener('dragover', (e) => {
          e.preventDefault();
          ideContainer.style.borderColor = 'var(--color-primary)';
        });
        ideContainer.addEventListener('dragleave', (e) => {
          e.preventDefault();
          ideContainer.style.borderColor = 'hsla(var(--hue-accent), 70%, 65%, 0.18)';
        });
        ideContainer.addEventListener('drop', async (e) => {
          e.preventDefault();
          ideContainer.style.borderColor = 'hsla(var(--hue-accent), 70%, 65%, 0.18)';
          const files = e.dataTransfer.files;
          if (files.length > 0) {
            const file = files[0];
            const name = file.name.toLowerCase();
            const text = await file.text();
            
            if (name.endsWith('.ipynb')) {
              try {
                const cells = parseIpynbJson(text);
                notebookCells = cells;
                switchEditorMode('notebook', slug);
                toast(`成功导入 Notebook: ${file.name}`, 'success');
              } catch (err) {
                toast(err.message, 'danger');
              }
            } else if (name.endsWith('.py')) {
              $('codeEditor').value = text;
              localStorage.setItem(`aioj_code_${slug}`, text);
              switchEditorMode('script', slug);
              toast(`成功导入 Python 脚本: ${file.name}`, 'success');
            } else {
              toast('仅支持拖拽导入 .py 或 .ipynb 文件！', 'warning');
            }
          }
        });
      }
    }
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
    toast('请先选择或拖拽拖入解答文件 (.zip 或 .ipynb)', 'warning');
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
  setPage('竞技比赛');
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

    const getContestStatusBadge = (st) => {
      switch (st) {
        case 'RUNNING':
          return `<span class="pill green" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px;"><span class="pulsing-dot" style="display:inline-block; margin-right:4px;"></span>进行中</span>`;
        case 'UPCOMING':
          return `<span class="pill yellow" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px;">📅 未开启</span>`;
        case 'ENDED':
          return `<span class="pill gray" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px;">🏁 已结束</span>`;
        case 'DRAFT':
          return `<span class="pill gray" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px; opacity:0.5;">📝 调试中</span>`;
        default:
          return `<span class="pill gray" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px;">${esc(st)}</span>`;
      }
    };

    const getContestActionButton = (st, slug) => {
      switch (st) {
        case 'RUNNING':
          return `<a href="/contests/${esc(slug)}" class="btn btn-primary btn-sm" style="font-size: 11px; padding: 6px 14px;" data-link>立即参赛 🚀</a>`;
        case 'UPCOMING':
          return `<a href="/contests/${esc(slug)}" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 14px;" data-link>查看详情</a>`;
        case 'ENDED':
          return `<a href="/contests/${esc(slug)}" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 14px;" data-link>查看排行榜</a>`;
        default:
          return `<a href="/contests/${esc(slug)}" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 14px;" data-link>进入</a>`;
      }
    };

    const renderSection = (title, list) => list.length === 0 ? '' : `
      <h3 class="section-title mb-md" style="font-size: 15px; font-weight: 700; margin-top: var(--space-lg); color: var(--text-main);">${title} (${list.length})</h3>
      <div class="table-wrap mb-lg">
        <table>
          <thead>
            <tr>
              <th style="width: 140px;">赛事状态</th>
              <th>竞赛名称与基本规格</th>
              <th style="width: 150px;">赛题数量</th>
              <th style="width: 320px;">起止时间安排</th>
              <th style="width: 140px; text-align: right;">进入行动</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(c => {
              const st = c.state || c.status || '';
              return `
                <tr class="clickable-row" onclick="if (!event.target.closest('a') && !event.target.closest('button')) navigate('/contests/${esc(c.slug)}')" style="transition: all var(--transition-fast);">
                  <td>
                    ${getContestStatusBadge(st)}
                  </td>
                  <td>
                    <div style="font-weight: 700; font-size: 14.5px; color: var(--text-main); font-family: var(--font-display);">${esc(c.title)}</div>
                    <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-top: 4px;">SLUG: ${esc(c.slug)} &nbsp;·&nbsp; 报名限制: ${esc(c.registration_mode || 'OPEN')}</div>
                  </td>
                  <td>
                    <span class="pill blue" style="font-family: var(--font-mono); font-size: 11px;">${c.problem_count || 0} 道算法题</span>
                  </td>
                  <td style="font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary);">
                    ${c.start_at ? `
                      <div>起: ${formatDate(c.start_at)}</div>
                      <div style="margin-top: 2px;">止: ${formatDate(c.end_at)}</div>
                    ` : '<span class="text-muted">— 未排程 —</span>'}
                  </td>
                  <td style="text-align: right;">
                    ${getContestActionButton(st, c.slug)}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
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
  setPage('载入竞赛中');
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在同步竞赛数据...</span>
    </div>
  `;
  try {
    const results = await Promise.allSettled([
      api(`/api/contests/${slug}`, { headers: authHeaders() }),
      api(`/api/contests/${slug}/access`, { headers: authHeaders() }),
      api(`/api/contests/${slug}/stats`, { headers: authHeaders() }),
      api(`/api/contests/${slug}/announcements`, { headers: authHeaders() }),
      api(`/api/contests/${slug}/questions`, { headers: authHeaders() }).catch(() => ({ items: [] })),
      state.token ? api(`/api/contests/${slug}/submissions?show_all=true`, { headers: authHeaders() }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      api(`/api/contests/${slug}/problem-stats`, { headers: authHeaders() }).catch(() => ({ items: [] })),
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
    const solvedSlugs = new Set();
    const attemptedSlugs = new Set();
    submissions.forEach(s => {
      const pSlug = s.problem_slug || s.problem_title;
      if (!pSlug) return;
      if (s.status === 'ACCEPTED' || s.status === 'RUN_FINISHED') {
        solvedSlugs.add(pSlug);
      } else {
        attemptedSlugs.add(pSlug);
      }
    });

    const canViewProblems = access.can_view_problems !== false;
    const participantStatus = access.participant_status || access.status || null;
    const isParticipant = participantStatus === 'ACCEPTED';

    setPage(contest.title);

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
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style="width: 140px;">我的状态</th>
                      <th>算法题目信息</th>
                      <th style="width: 200px;">过题情况</th>
                      <th style="width: 160px; text-align: right;">挑战行动</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${problems.map(p => {
                      const ps = problemStats.find(s => s.slug === p.slug || s.id === p.id) || {};
                      const isSolved = solvedSlugs.has(p.slug);
                      const isAttempted = attemptedSlugs.has(p.slug);
                      let statusPill = `<span class="pill gray" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px; opacity:0.65;">未尝试</span>`;
                      if (isSolved) {
                        statusPill = `<span class="pill green" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px;">已通过</span>`;
                      } else if (isAttempted) {
                        statusPill = `<span class="pill yellow" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px;">已尝试</span>`;
                      }

                      return `
                        <tr class="clickable-row" onclick="if (!event.target.closest('a') && !event.target.closest('button')) navigate('/contests/${esc(slug)}/problems/${esc(p.slug)}')" style="transition: all var(--transition-fast);">
                          <td>
                            ${statusPill}
                          </td>
                          <td>
                            <div style="font-weight: 700; font-size: 15px; color: var(--text-main); font-family: var(--font-display);">${esc(p.title)}</div>
                            <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-top: 4px;">ID: ${esc(p.slug)}</div>
                          </td>
                          <td style="font-family: var(--font-mono); font-size: 12.5px; color: var(--text-secondary);">
                            <div>💚 已通过: <strong>${ps.solved_users || 0}</strong> 人</div>
                            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">📈 提报次数: ${ps.submissions || 0} 次</div>
                          </td>
                          <td style="text-align: right;">
                            <a href="/contests/${esc(slug)}/problems/${esc(p.slug)}" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 14px;" data-link>立即挑战 🚀</a>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
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
              <div class="card mb-md ${q.is_public ? '' : 'card-private'}" style="padding: var(--space-md);">
                <!-- Header of the Q&A thread -->
                <div class="qa-thread-header" style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border-subtle); padding-bottom: var(--space-sm); margin-bottom: var(--space-md);">
                  <div>
                    <h4 style="font-size: 15px; font-weight: 700; color: var(--text-main);">${esc(q.title)}</h4>
                    <div style="display: flex; flex-wrap: wrap; gap: var(--space-sm); align-items: center; margin-top: 4px; font-size: 11px; color: var(--text-muted);">
                      <span>提问人: <strong>${esc(q.username || '匿名选手')}</strong></span>
                      <span>•</span>
                      <span>时间: ${formatDate(q.created_at)}</span>
                      <span>•</span>
                      ${statusPill(q.status)}
                      ${q.is_public ? '<span class="pill blue btn-sm" style="font-size:9px; padding:1px 6px;">公开回答</span>' : '<span class="pill gray btn-sm" style="font-size:9px; padding:1px 6px;">私密会话</span>'}
                    </div>
                  </div>
                  ${state.user && state.user.role === 'ADMIN' ? `
                    <div style="display: flex; gap: var(--space-xs);">
                      <button class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 11px;" onclick="showAnswerQuestionModal('${esc(slug)}', ${q.id})">进行解答</button>
                      ${q.status !== 'CLOSED' ? `<button class="btn btn-danger btn-sm" style="padding: 4px 8px; font-size: 11px;" onclick="closeQuestion('${esc(slug)}', ${q.id})">关闭问题</button>` : ''}
                    </div>
                  ` : ''}
                </div>

                <!-- Chat bubble flow -->
                ${q.can_view_body !== false ? `
                  <div class="qa-chat-flow" style="display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-sm) 0;">
                    
                    <!-- Question Bubble (Left-aligned) -->
                    <div class="qa-bubble question-bubble" style="align-self: flex-start; max-width: 85%; width: 100%;">
                      <div class="qa-bubble-header" style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                        <span>👤 ${esc(q.username || '选手')} 发起的提问</span>
                      </div>
                      <div class="qa-bubble-body" style="background: var(--bg-mini-card); border: var(--border-light); border-radius: 0px 12px 12px 12px; padding: var(--space-md); font-size: 13.5px; color: var(--text-main); line-height: 1.6;">
                        ${renderMd(q.body_md)}
                      </div>
                    </div>

                    <!-- Answer Bubble (Right-aligned) -->
                    ${q.answer_md ? `
                      <div class="qa-bubble answer-bubble" style="align-self: flex-end; max-width: 85%; width: 100%; display: flex; flex-direction: column; align-items: flex-end;">
                        <div class="qa-bubble-header" style="font-size: 11px; color: var(--color-success); margin-bottom: 4px; display: flex; align-items: center; gap: 4px; font-weight: 600;">
                          <span>📝 官方裁判组回复</span>
                          <span class="pill green" style="font-size: 8px; padding: 1px 4px; border-radius: 4px;">已验证 OFFICIAL</span>
                        </div>
                        <div class="qa-bubble-body" style="background: var(--bg-answer-block); border: 1px solid hsla(var(--hue-success), 84%, 45%, 0.2); border-radius: 12px 0px 12px 12px; padding: var(--space-md); font-size: 13.5px; color: var(--text-main); line-height: 1.6; width: 100%;">
                          ${renderMd(q.answer_md)}
                        </div>
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
            <th style="width: 70px; text-align: center;">排名</th>
            <th>选手名称</th>
            <th style="width: 100px;">通过题数</th>
            <th style="width: 120px;">公开总分</th>
            ${showPrivate ? '<th style="width: 120px;">最终得分</th>' : ''}
            ${(items[0]?.problems || []).map(p => `<th style="text-align: center; min-width: 90px;">${esc(p.slug || p.title || '')}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${items.map(r => {
            const rankVal = parseInt(r.rank);
            const rankDisplay = rankVal === 1 ? '🥇' : rankVal === 2 ? '🥈' : rankVal === 3 ? '🥉' : `<strong>${r.rank || ''}</strong>`;
            return `
              <tr>
                <td style="text-align: center; font-size: 15px;">${rankDisplay}</td>
                <td><strong>${esc(r.username)}</strong></td>
                <td><span class="pill gray" style="padding: 2px 8px; font-family: var(--font-mono);">${r.solved || 0}</span></td>
                <td class="text-accent" style="font-family: var(--font-mono); font-weight: 700;">${scoreDisplay(r.total_public_score)}</td>
                ${showPrivate ? `<td style="font-weight: 700; color: var(--color-success); font-family: var(--font-mono);">${scoreDisplay(r.total_private_score)}</td>` : ''}
                ${(r.problems || []).map(p => `
                  <td class="${p.solved ? 'cell-solved' : p.attempts > 0 ? 'cell-attempted' : ''}" style="text-align: center; font-family: var(--font-mono);">
                    ${p.visible_score != null ? scoreDisplay(p.visible_score) : (p.solved ? '✓' : p.attempts > 0 ? `−${p.attempts}` : '—')}
                  </td>
                `).join('')}
              </tr>
            `;
          }).join('')}
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
            <th style="width: 70px; text-align: center;">排名</th>
            <th>选手名称</th>
            <th style="width: 100px;">通过题数</th>
            <th style="width: 120px;">累计罚时</th>
            ${(items[0]?.problems || []).map(p => `<th style="text-align: center; min-width: 90px;">${esc(p.slug || p.title || '')}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${items.map(r => {
            const rankVal = parseInt(r.rank);
            const rankDisplay = rankVal === 1 ? '🥇' : rankVal === 2 ? '🥈' : rankVal === 3 ? '🥉' : `<strong>${r.rank || ''}</strong>`;
            return `
              <tr>
                <td style="text-align: center; font-size: 15px;">${rankDisplay}</td>
                <td><strong>${esc(r.username)}</strong></td>
                <td><span class="pill gray" style="padding: 2px 8px; font-family: var(--font-mono);">${r.solved || 0}</span></td>
                <td class="text-accent" style="font-family: var(--font-mono); font-weight: 700;">${r.penalty || 0}</td>
                ${(r.problems || []).map(p => `
                  <td class="${p.solved ? 'cell-solved' : p.attempts > 0 ? 'cell-attempted' : ''}" style="text-align: center; font-family: var(--font-mono);">
                    ${p.solved ? `✓ (${p.penalty || 0})` : p.attempts > 0 ? `−${p.attempts}` : '—'}
                  </td>
                `).join('')}
              </tr>
            `;
          }).join('')}
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
  setPage('提交历史');
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
  setPage('提取评测报告');
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
      
      <div class="submission-grid mt-md">
        <!-- Left Side: Terminal Log Console -->
        <div class="submission-main">
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
              <pre class="log-output" id="terminalLog" style="max-height: 600px; height: 600px;"><code>${esc(logContent)}</code></pre>
            </div>
          ` : `
            <div class="empty-state">
              <div class="empty-icon">📂</div>
              <h3>暂无运行日志</h3>
              <p class="text-muted">当评测未开始、已取消或容器运行失败时，可能无日志输出</p>
            </div>
          `}
        </div>

        <!-- Right Side: Diagnostics Report Summary Card -->
        <div class="submission-sidebar" style="display: flex; flex-direction: column; gap: var(--space-md);">
          <div class="card highlight">
            <div class="card-header" style="border-bottom: 1px solid var(--border-subtle); padding-bottom: var(--space-sm); margin-bottom: var(--space-md);">
              <h2 class="card-title">评测提报报告 #${id}</h2>
              ${statusPill(sub.status)}
            </div>
            <div class="card-body" style="padding: 0;">
              <div class="config-list">
                <div class="config-item">
                  <span class="config-label">题目标识</span>
                  <span style="font-family: var(--font-mono); font-weight: 600;">${esc(sub.problem_slug || sub.problem_id || '')}</span>
                </div>
                <div class="config-item">
                  <span class="config-label">参赛选手</span>
                  <span><strong>${esc(sub.username || '—')}</strong></span>
                </div>
                <div class="config-item">
                  <span class="config-label">公开成绩 (Public)</span>
                  <span class="text-accent" style="font-size: 16px;">${scoreDisplay(sub.public_score)}</span>
                </div>
                <div class="config-item">
                  <span class="config-label">最终成绩 (Private)</span>
                  <span style="font-size: 16px; font-weight: 600; color: var(--color-success);">${scoreDisplay(sub.private_score)}</span>
                </div>
                <div class="config-item">
                  <span class="config-label">执行时长</span>
                  <span>${sub.runtime_ms != null ? sub.runtime_ms + 'ms' : '—'}</span>
                </div>
                <div class="config-item">
                  <span class="config-label">内存峰值</span>
                  <span>${sub.memory_peak_mb != null ? sub.memory_peak_mb + 'MB' : '—'}</span>
                </div>
                <div class="config-item">
                  <span class="config-label">提报时间</span>
                  <span class="text-muted" style="font-size: 12px;">${formatDate(sub.created_at)}</span>
                </div>
                <div class="config-item">
                  <span class="config-label">完成时间</span>
                  <span class="text-muted" style="font-size: 12px;">${formatDate(sub.judged_at)}</span>
                </div>
              </div>
              
              ${sub.error_message ? `
                <div style="margin-top: var(--space-md);">
                  <span class="detail-label" style="font-size: 12.5px; font-weight: 600; color: var(--color-danger);">评测核心异常诊断:</span>
                  <div class="notice error" style="margin-top: var(--space-xs); font-size: 12px; line-height: 1.4; padding: var(--space-sm);">${esc(sub.error_message)}</div>
                </div>
              ` : ''}
            </div>
          </div>

          <!-- Actions Card -->
          <div class="card" style="display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-md);">
            ${['QUEUED', 'TEST_QUEUED', 'PENDING'].includes(String(sub.status || '').toUpperCase()) ? `
              <button class="btn btn-danger w-full" onclick="cancelSubmission(${Number(id)})">取消排队提交</button>
            ` : ''}
            ${sub.problem_slug ? `<a href="/problems/${esc(sub.problem_slug)}" class="btn btn-secondary w-full" data-link>回到题目工作区</a>` : ''}
            <button class="btn btn-secondary w-full" onclick="downloadSubmissionArtifact(${Number(id)}, 'source')">下载提交源码 (.zip)</button>
            <button class="btn btn-primary w-full" onclick="downloadSubmissionArtifact(${Number(id)}, 'output')">📥 下载预测输出 (.csv)</button>
          </div>
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

async function cancelSubmission(id) {
  if (!confirm(`确认取消提交 #${id} 吗？仅排队中的任务可以取消。`)) return;
  try {
    await api(`/api/submissions/${id}/cancel`, {
      method: 'POST',
      headers: authHeaders(),
    });
    toast(`提交 #${id} 已取消`, 'success');
    renderSubmissionDetail(id);
  } catch (err) {
    toast(`取消失败: ${err.message}`, 'error');
  }
}

async function downloadSubmissionArtifact(id, kind) {
  const url = kind === 'source' ? `/api/submissions/${id}/source` : `/api/submissions/${id}/output`;
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `${res.status} ${res.statusText}`);
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    a.download = kind === 'source' ? `submission-${id}-source.zip` : `submission-${id}-output.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    toast(`下载失败: ${err.message}`, 'error');
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

// ─── Notifications ──────────────────────────────────────────────────────────
function notificationTypeLabel(kind) {
  return ({
    SUBMISSION_RESULT: '评测结果',
    CONTEST_REGISTRATION: '报名状态',
    CONTEST_ANNOUNCEMENT: '比赛公告',
    QUESTION_ANSWERED: '答疑回复',
  })[kind] || kind || '通知';
}

async function renderNotifications() {
  setPage('通知中心');
  const app = $('app');
  if (!state.user) {
    app.innerHTML = `<div class="notice info">请先 <button class="btn btn-secondary btn-sm" onclick="showAuthModal()">登录账户</button> 查看站内通知。</div>`;
    return;
  }

  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在同步站内通知流...</span>
    </div>
  `;

  try {
    const data = await api('/api/notifications?limit=100', { headers: authHeaders() });
    const items = data.items || [];
    app.innerHTML = `
      <div class="row flex-between mb-lg" style="flex-wrap: wrap;">
        <div>
          <h3 class="section-title">站内通知中心</h3>
          <div class="text-muted" style="font-size: 13px;">未读消息会在右上角铃铛上计数显示。</div>
        </div>
        <button class="btn btn-secondary" onclick="markAllNotificationsRead()">全部标记为已读</button>
      </div>

      ${items.length === 0 ? emptyBox('当前没有新的站内通知') : `
        <div style="display:flex; flex-direction:column; gap: var(--space-md);">
          ${items.map(item => `
            <div class="card ${item.is_read ? '' : 'highlight'}" style="padding: var(--space-lg);">
              <div class="row flex-between gap-md" style="align-items:flex-start; flex-wrap: wrap;">
                <div style="flex:1; min-width: 280px;">
                  <div style="display:flex; align-items:center; gap:8px; flex-wrap: wrap; margin-bottom: 8px;">
                    <strong>${esc(item.title)}</strong>
                    <span class="pill ${item.is_read ? 'gray' : 'green'}">${item.is_read ? 'READ' : 'UNREAD'}</span>
                    <span class="pill blue">${esc(notificationTypeLabel(item.type))}</span>
                  </div>
                  <div class="text-muted" style="font-size: 12px; margin-bottom: 10px;">${formatDate(item.created_at)}</div>
                  <div class="md-content"><p>${esc(item.body_md || '').replace(/\n/g, '<br>')}</p></div>
                </div>
                <div class="row gap-xs" style="justify-content:flex-end; flex-wrap: wrap;">
                  ${item.link ? `<button class="btn btn-primary btn-sm" onclick="openNotificationLink(${item.id}, '${esc(item.link)}')">查看详情</button>` : ''}
                  ${item.is_read ? '' : `<button class="btn btn-secondary btn-sm" onclick="markNotificationRead(${item.id})">标记已读</button>`}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;
    refreshNotificationCount();
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

async function markNotificationRead(notificationId, rerender = true) {
  try {
    await api(`/api/notifications/${notificationId}/read`, {
      method: 'POST',
      headers: authHeaders(),
    });
    await refreshNotificationCount();
    if (rerender && state.currentRoute === '/notifications') {
      renderNotifications();
    }
  } catch (err) {
    toast(`标记通知失败: ${err.message}`, 'error');
  }
}

async function markAllNotificationsRead() {
  try {
    await api('/api/notifications/read-all', {
      method: 'POST',
      headers: authHeaders(),
    });
    toast('所有通知均已标记为已读', 'success');
    await refreshNotificationCount();
    if (state.currentRoute === '/notifications') {
      renderNotifications();
    }
  } catch (err) {
    toast(`批量已读失败: ${err.message}`, 'error');
  }
}

async function openNotificationLink(notificationId, link) {
  await markNotificationRead(notificationId, false);
  if (link) {
    navigate(link);
  } else if (state.currentRoute === '/notifications') {
    renderNotifications();
  }
}

// ─── Direct Messages ───────────────────────────────────────────────────────
function isImageAttachment(contentType) {
  return String(contentType || '').toLowerCase().startsWith('image/');
}

function formatFileSize(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function messagePreview(text, limit = 96, attachmentContentType = '') {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  const attachmentLabel = attachmentContentType
    ? (isImageAttachment(attachmentContentType) ? '[图片]' : '[文件]')
    : '';
  if (!value && attachmentLabel) return attachmentLabel;
  if (value && attachmentLabel) return `${attachmentLabel} ${value.length <= limit ? value : `${value.slice(0, limit - 1)}…`}`;
  if (value.length <= limit) return value || '空消息';
  return `${value.slice(0, limit - 1)}…`;
}

function messagePeerInitial(name) {
  return esc(String(name || '?').slice(0, 1).toUpperCase());
}

function captureMessageViewState() {
  const composer = $('messageComposer');
  const list = $('messageThreadList');
  const scrollGap = list ? list.scrollHeight - list.scrollTop - list.clientHeight : 0;
  return {
    draft: composer ? composer.value : '',
    composerFocused: document.activeElement === composer,
    selectionStart: composer ? composer.selectionStart : 0,
    selectionEnd: composer ? composer.selectionEnd : 0,
    scrollTop: list ? list.scrollTop : 0,
    wasNearBottom: !list || scrollGap < 80,
  };
}

function restoreMessageViewState(viewState) {
  const list = $('messageThreadList');
  if (list) {
    if (!viewState || viewState.wasNearBottom) {
      list.scrollTop = list.scrollHeight;
    } else {
      list.scrollTop = Math.min(viewState.scrollTop, list.scrollHeight);
    }
  }

  const composer = $('messageComposer');
  if (composer && viewState) {
    composer.value = viewState.draft || '';
    if (viewState.composerFocused) {
      composer.focus();
      const start = Math.min(viewState.selectionStart || 0, composer.value.length);
      const end = Math.min(viewState.selectionEnd || start, composer.value.length);
      composer.setSelectionRange(start, end);
    }
  } else if (composer && !viewState) {
    composer.focus();
  }
}

function ensureMessageAutoRefresh() {
  if (state.messageRefreshTimer) return;
  state.messageRefreshTimer = setInterval(async () => {
    if (!state.user || !location.pathname.startsWith('/messages')) {
      stopMessageAutoRefresh();
      return;
    }
    if (state.messageRefreshInFlight) return;

    const match = location.pathname.match(/^\/messages\/(\d+)$/);
    const peerId = match ? Number(match[1]) : null;
    state.messageRefreshInFlight = true;
    try {
      await renderMessages(peerId, { silent: true, auto: true });
    } finally {
      state.messageRefreshInFlight = false;
    }
  }, MESSAGE_REFRESH_INTERVAL_MS);
}

async function renderMessages(peerId = null, options = {}) {
  setPage('私信');
  const app = $('app');
  if (!state.user) {
    app.innerHTML = `<div class="notice info">请先 <button class="btn btn-secondary btn-sm" onclick="showAuthModal()">登录账户</button> 使用私信。</div>`;
    return;
  }

  const silent = !!options.silent || !!app.querySelector('.messages-layout');
  const viewState = silent ? captureMessageViewState() : null;
  if (!silent) {
    app.innerHTML = `
      <div class="loading-overlay">
        <div class="spinner-ring"></div>
        <span class="loading-text">正在同步私信会话...</span>
      </div>
    `;
  }

  try {
    const conversationData = await api('/api/messages/conversations?limit=100', { headers: authHeaders() });
    const conversations = conversationData.items || [];
    const selectedPeerId = peerId ? Number(peerId) : Number(conversations[0]?.peer_id || 0);
    let thread = null;

    if (selectedPeerId) {
      thread = await api(`/api/messages/conversations/${selectedPeerId}?limit=120`, { headers: authHeaders() });
      await refreshMessageCount();
    }

    const activePeer = thread?.peer || conversations.find(c => Number(c.peer_id) === selectedPeerId);
    app.innerHTML = `
      <div class="row flex-between mb-lg" style="flex-wrap: wrap;">
        <div>
          <h3 class="section-title">私信</h3>
          <div class="text-muted" style="font-size: 13px;">与站内用户一对一沟通，打开会话后会自动标记已读。</div>
        </div>
        <button class="btn btn-primary" onclick="showNewMessageModal()">写私信</button>
      </div>

      <div class="messages-layout">
        <aside class="message-conversation-list">
          ${conversations.length === 0 ? `
            <div class="message-empty-panel">
              <div class="empty-icon">✉</div>
              <div class="text-muted" style="font-size: 13px;">暂无会话</div>
              <button class="btn btn-secondary btn-sm mt-md" onclick="showNewMessageModal()">开始私信</button>
            </div>
          ` : conversations.map(c => {
            const active = Number(c.peer_id) === selectedPeerId;
            const incoming = Number(c.last_sender_id) !== Number(state.user.id);
            const unread = Number(c.unread_count || 0);
            return `
              <button class="message-conversation ${active ? 'active' : ''}" onclick="openMessageConversation(${c.peer_id})">
                <span class="message-avatar">${messagePeerInitial(c.peer_username)}</span>
                <span class="message-conversation-body">
                  <span class="message-conversation-top">
                    <strong>${esc(c.peer_username)}</strong>
                    <span>${formatDate(c.last_created_at)}</span>
                  </span>
                  <span class="message-preview">
                    ${incoming ? '' : '我：'}${esc(messagePreview(c.last_body_md, 96, c.last_attachment_content_type || (c.last_has_attachment ? 'application/octet-stream' : '')))}
                  </span>
                </span>
                ${unread > 0 ? `<span class="message-unread-dot">${unread > 99 ? '99+' : unread}</span>` : ''}
              </button>
            `;
          }).join('')}
        </aside>

        <section class="message-thread-panel">
          ${selectedPeerId && activePeer ? renderMessageThread(activePeer, thread?.items || []) : `
            <div class="message-empty-panel">
              <div class="empty-icon">✉</div>
              <div class="text-muted" style="font-size: 13px;">选择一个会话，或新建私信。</div>
            </div>
          `}
        </section>
      </div>
    `;

    setTimeout(() => {
      restoreMessageViewState(viewState);
      hydrateMessageAttachments();
    }, 50);
    ensureMessageAutoRefresh();
  } catch (err) {
    if (silent) {
      toast(`刷新私信失败: ${err.message}`, 'error');
    } else {
      app.innerHTML = errorBox(err);
    }
  }
}

function openMessageConversation(peerId) {
  const path = `/messages/${peerId}`;
  if (location.pathname !== path) {
    history.pushState(null, '', path);
  }
  state.currentRoute = path;
  updateNav();
  renderMessages(peerId, { silent: true });
}

function refreshMessages(peerId) {
  return renderMessages(peerId, { silent: true });
}

function renderMessageThread(peer, messages) {
  const peerId = peer.id || peer.peer_id;
  return `
    <div class="message-thread-header">
      <div class="message-avatar">${messagePeerInitial(peer.username || peer.peer_username)}</div>
      <div>
        <div style="font-weight: 700; color: var(--text-main);">${esc(peer.username || peer.peer_username)}</div>
        <div class="text-muted" style="font-size: 12px;">${esc(peer.role || peer.peer_role || 'USER')}</div>
      </div>
    </div>

    <div class="message-thread-list" id="messageThreadList">
      ${messages.length === 0 ? `
        <div class="message-empty-panel">
          <div class="empty-icon">✉</div>
          <div class="text-muted" style="font-size: 13px;">还没有消息，发送第一条私信。</div>
        </div>
      ` : messages.map(m => {
        const mine = Number(m.sender_id) === Number(state.user.id);
        return `
          <div class="message-row ${mine ? 'mine' : ''}">
            <div class="message-bubble">
              ${m.has_attachment ? renderMessageAttachment(m) : ''}
              ${m.body_md ? renderMd(m.body_md) : ''}
              <div class="message-meta">
                ${mine ? '我' : esc(m.sender_username)} · ${formatDate(m.created_at)}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="message-composer">
      <textarea id="messageComposer" rows="3" maxlength="4000" placeholder="输入私信内容，Enter 发送，Ctrl+Enter 换行" onkeydown="handleMessageComposerKeydown(event, ${peerId})"></textarea>
      <div class="row flex-between gap-sm" style="align-items:center; flex-wrap: wrap;">
        <span class="text-muted" style="font-size: 12px;">最长 4000 字符</span>
        <div class="row gap-sm" style="flex-wrap: wrap;">
          <label class="btn btn-secondary message-file-button" for="messageFileInput">文件</label>
          <input type="file" id="messageFileInput" style="display:none" onchange="sendFileToPeer(${peerId}, this)" />
          <button class="btn btn-primary" id="sendMessageBtn" onclick="sendMessageToPeer(${peerId})">发送</button>
        </div>
      </div>
    </div>
  `;
}

function renderMessageAttachment(message) {
  const attachmentId = message.attachment_id || message.id;
  if (!attachmentId) return '';
  const filename = message.attachment_filename || '附件';
  const contentType = message.attachment_content_type || 'application/octet-stream';
  if (!isImageAttachment(contentType)) {
    return `
      <button class="message-file-card" type="button" onclick="downloadMessageFile(${attachmentId}, ${jsArg(filename)})">
        <span class="message-file-icon">FILE</span>
        <span class="message-file-info">
          <strong>${esc(filename)}</strong>
          <span>${esc(formatFileSize(message.attachment_size_bytes) || contentType)}</span>
        </span>
        <span class="message-file-download">下载</span>
      </button>
    `;
  }
  return `
    <div class="message-image-frame" data-message-attachment-frame="${attachmentId}">
      <div class="message-image-placeholder">图片加载中...</div>
      <img class="message-image" data-message-attachment-id="${attachmentId}" alt="${esc(filename)}" hidden onclick="openMessageImage(this.src)" />
    </div>
  `;
}

async function hydrateMessageAttachments() {
  const images = Array.from(document.querySelectorAll('img[data-message-attachment-id]:not([data-loaded])'));
  for (const img of images) {
    const attachmentId = img.dataset.messageAttachmentId;
    const frame = img.closest('.message-image-frame');
    const placeholder = frame?.querySelector('.message-image-placeholder');
    try {
      const res = await fetch(`/api/messages/${attachmentId}/attachment`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      img.src = url;
      img.hidden = false;
      img.dataset.loaded = '1';
      if (placeholder) placeholder.style.display = 'none';
    } catch {
      if (placeholder) placeholder.textContent = '图片加载失败';
    }
  }
}

async function downloadMessageFile(attachmentId, filename = 'attachment') {
  try {
    const res = await fetch(`/api/messages/${attachmentId}/attachment`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'attachment';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    toast(`下载失败: ${err.message}`, 'error');
  }
}

function openMessageImage(src) {
  if (!src) return;
  openModal({
    title: '图片消息',
    body: `<img src="${esc(src)}" alt="图片消息" class="message-image-preview" />`,
    footer: `<button class="btn btn-secondary" onclick="closeModal()">关闭</button>`,
    wide: true,
  });
}

function insertTextareaNewline(textarea) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = `${textarea.value.slice(0, start)}\n${textarea.value.slice(end)}`;
  textarea.selectionStart = textarea.selectionEnd = start + 1;
}

function handleMessageComposerKeydown(event, peerId) {
  if (event.key !== 'Enter' || event.isComposing) return;
  if (event.ctrlKey) {
    event.preventDefault();
    insertTextareaNewline(event.target);
    return;
  }
  event.preventDefault();
  sendMessageToPeer(peerId);
}

function showNewMessageModal() {
  const body = `
    <input type="hidden" id="newMessageRecipientId" />
    <div class="form-group">
      <label for="messageRecipient">收件人用户名</label>
      <input type="text" id="messageRecipient" placeholder="搜索或输入用户名" autocomplete="off" oninput="searchMessageUsers(this.value)" />
      <div id="messageUserResults" class="message-user-results"></div>
    </div>
    <div class="form-group">
      <label for="newMessageBody">私信内容</label>
      <textarea id="newMessageBody" rows="6" maxlength="4000" placeholder="请输入要发送的内容，Enter 发送，Ctrl+Enter 换行" onkeydown="handleNewMessageKeydown(event)"></textarea>
    </div>
    <div class="form-group">
      <label for="newMessageFile">文件</label>
      <input type="file" id="newMessageFile" onchange="updateNewMessageFileLabel(this)" />
      <div id="newMessageFileLabel" class="text-muted" style="font-size: 12px; margin-top: 6px;">支持任意文件，最大 20 MB；图片会直接预览。</div>
    </div>
    <div id="newMessageError" class="notice error" style="display:none"></div>
  `;
  const footer = `
    <button class="btn btn-secondary" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" id="newMessageSendBtn" onclick="sendNewMessage()">发送私信</button>
  `;
  openModal({ title: '写私信', body, footer });
  setTimeout(() => $('messageRecipient')?.focus(), 50);
}

function updateNewMessageFileLabel(input) {
  const label = $('newMessageFileLabel');
  const file = input?.files?.[0];
  if (!label || !file) return;
  label.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
}

function handleNewMessageKeydown(event) {
  if (event.key !== 'Enter' || event.isComposing) return;
  if (event.ctrlKey) {
    event.preventDefault();
    insertTextareaNewline(event.target);
    return;
  }
  event.preventDefault();
  sendNewMessage();
}

let messageUserSearchTimer = null;

function searchMessageUsers(query) {
  const resultsEl = $('messageUserResults');
  const hidden = $('newMessageRecipientId');
  if (hidden) hidden.value = '';
  if (!resultsEl) return;

  const q = String(query || '').trim();
  if (!q) {
    resultsEl.innerHTML = '';
    return;
  }

  clearTimeout(messageUserSearchTimer);
  messageUserSearchTimer = setTimeout(async () => {
    try {
      const data = await api(`/api/messages/users?q=${encodeURIComponent(q)}&limit=8`, { headers: authHeaders() });
      const users = data.items || [];
      resultsEl.innerHTML = users.length === 0
        ? `<div class="message-user-result muted">未找到匹配用户</div>`
        : users.map(u => `
          <button type="button" class="message-user-result" onclick="selectMessageRecipient(${u.id}, ${jsArg(u.username)})">
            <span class="message-avatar small">${messagePeerInitial(u.username)}</span>
            <span>
              <strong>${esc(u.username)}</strong>
              <span class="text-muted">${esc(u.role || 'USER')}</span>
            </span>
          </button>
        `).join('');
    } catch (err) {
      resultsEl.innerHTML = `<div class="message-user-result muted">${esc(err.message)}</div>`;
    }
  }, 200);
}

function selectMessageRecipient(userId, username) {
  if ($('newMessageRecipientId')) $('newMessageRecipientId').value = userId;
  if ($('messageRecipient')) $('messageRecipient').value = username;
  if ($('messageUserResults')) $('messageUserResults').innerHTML = '';
  $('newMessageBody')?.focus();
}

async function sendNewMessage() {
  const btn = $('newMessageSendBtn');
  const errEl = $('newMessageError');
  const recipientId = $('newMessageRecipientId')?.value;
  const recipient = $('messageRecipient')?.value.trim();
  const body = $('newMessageBody')?.value.trim();
  const attachedFile = $('newMessageFile')?.files?.[0];

  if (!recipient && !recipientId) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = '请填写收件人。'; }
    return;
  }
  if (!body && !attachedFile) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = '请填写私信内容或选择文件。'; }
    return;
  }
  if (attachedFile && !isAllowedMessageFile(attachedFile)) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = '请选择 20 MB 以内的文件。'; }
    return;
  }

  try {
    if (btn) { btn.disabled = true; btn.textContent = '发送中...'; }
    let data;
    if (attachedFile) {
      const fd = new FormData();
      fd.append('body_md', body || '');
      fd.append('file', attachedFile);
      if (recipientId) {
        fd.append('recipient_id', recipientId);
      } else {
        fd.append('recipient', recipient);
      }
      data = await api('/api/messages/files', {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      });
    } else {
      const payload = { body_md: body };
      if (recipientId) {
        payload.recipient_id = Number(recipientId);
      } else {
        payload.recipient = recipient;
      }
      data = await api('/api/messages', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    closeModal();
    toast('私信已发送', 'success');
    const peerId = data.peer?.id || data.message?.recipient_id;
    openMessageConversation(peerId);
  } catch (err) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = err.message; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '发送私信'; }
  }
}

async function sendMessageToPeer(peerId) {
  const textarea = $('messageComposer');
  const btn = $('sendMessageBtn');
  const body = textarea?.value.trim();
  if (!body) {
    toast('请输入私信内容', 'warning');
    return;
  }

  try {
    if (btn) { btn.disabled = true; btn.textContent = '发送中...'; }
    await api('/api/messages', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: Number(peerId), body_md: body }),
    });
    if (textarea) textarea.value = '';
    await refreshMessages(peerId);
  } catch (err) {
    toast(`发送失败: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '发送'; }
  }
}

function isAllowedMessageFile(file) {
  if (!file) return false;
  return file.size > 0 && file.size <= 20 * 1024 * 1024;
}

async function sendFileToPeer(peerId, input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (!isAllowedMessageFile(file)) {
    input.value = '';
    toast('请选择 20 MB 以内的文件。', 'warning');
    return;
  }

  const textarea = $('messageComposer');
  const btn = $('sendMessageBtn');
  const caption = textarea?.value.trim() || '';
  const fd = new FormData();
  fd.append('recipient_id', String(peerId));
  fd.append('body_md', caption);
  fd.append('file', file);

  try {
    if (btn) { btn.disabled = true; btn.textContent = '发送中...'; }
    await api('/api/messages/files', {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    });
    if (textarea) textarea.value = '';
    input.value = '';
    await refreshMessages(peerId);
  } catch (err) {
    toast(`文件发送失败: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '发送'; }
  }
}

// ─── Account Settings ───────────────────────────────────────────────────────
async function renderAccount() {
  setPage('个人中心');
  const app = $('app');
  if (!state.user) {
    app.innerHTML = `<div class="notice info">请先 <button class="btn btn-secondary btn-sm" onclick="showAuthModal()">登录账户</button>。</div>`;
    return;
  }

  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在同步个人中心档案与解题进度...</span>
    </div>
  `;

  let solvedCount = 0;
  let totalCount = 0;
  let solvedPercent = 0;
  let circumference = 0;
  let strokeDashoffset = 0;

  try {
    const [problemsRes, subsRes] = await Promise.allSettled([
      api('/api/problems'),
      api('/api/my/submissions', { headers: authHeaders() }),
    ]);

    const problems = problemsRes.status === 'fulfilled' ? (problemsRes.value.items || []) : [];
    const submissions = subsRes.status === 'fulfilled' ? (subsRes.value.items || []) : [];

    const solvedSlugs = new Set(
      submissions
        .filter(s => s.status === 'ACCEPTED' || s.status === 'RUN_FINISHED')
        .map(s => s.problem_slug || s.problem_title)
        .filter(Boolean)
    );
    solvedCount = solvedSlugs.size;
    totalCount = problems.length;
    solvedPercent = totalCount > 0 ? Math.round((solvedCount / totalCount) * 100) : 0;

    const radius = 48;
    circumference = 2 * Math.PI * radius;
    strokeDashoffset = circumference - (solvedPercent / 100) * circumference;
  } catch (err) {
    console.error('Error fetching profile stats:', err);
  }

  app.innerHTML = `
    <div class="account-layout">
      <!-- Left Sidebar: Profile Avatar Card & Solved Stats -->
      <div class="account-sidebar" style="display: flex; flex-direction: column; gap: var(--space-lg);">
        <div class="card highlight" style="display: flex; flex-direction: column; align-items: center; text-align: center; padding: var(--space-xl) var(--space-lg);">
          <div class="profile-avatar-container" style="width: 80px; height: 80px; border-radius: 50%; background: var(--grad-main); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 32px; font-weight: 700; box-shadow: var(--shadow-accent-glow); margin-bottom: var(--space-md); text-transform: uppercase;">
            ${esc(state.user.username.slice(0, 2))}
          </div>
          <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 6px;">${esc(state.user.username)}</h2>
          <span class="pill blue" style="font-size: 10px; padding: 2px 10px; border-radius: 4px;">${esc(state.user.role)}</span>
          
          <div style="width: 100%; border-top: var(--border-subtle); margin-top: var(--space-lg); padding-top: var(--space-lg); text-align: left; display: flex; flex-direction: column; gap: 12px; font-size: 13px;">
            <div style="display: flex; justify-content: space-between;"><span class="text-muted">关联邮箱</span><span style="font-weight:500;">${esc(state.user.email || '尚未绑定邮箱')}</span></div>
            <div style="display: flex; justify-content: space-between;"><span class="text-muted">安全角色组</span><span style="font-weight:500;">${esc(state.user.role === 'ADMIN' ? '裁判组 / 管理员' : '参赛选手')}</span></div>
            <div style="display: flex; justify-content: space-between;"><span class="text-muted">注册时间</span><span class="text-muted">${state.user.created_at ? formatDate(state.user.created_at) : '—'}</span></div>
          </div>
        </div>

        <!-- Solved Circular Ring -->
        <div class="card" style="display: flex; flex-direction: column; align-items: center; text-align: center; padding: var(--space-lg);">
          <h3 class="card-title" style="margin-bottom: var(--space-md); width: 100%; text-align: left;">解题挑战进度</h3>
          <div style="position: relative; width: 120px; height: 120px; display: flex; align-items: center; justify-content: center; margin-bottom: var(--space-sm);">
            <svg width="120" height="120">
              <circle stroke="var(--border-light)" stroke-width="8" fill="transparent" r="48" cx="60" cy="60"/>
              <circle stroke="var(--color-primary)" stroke-width="8" stroke-dasharray="${circumference}" stroke-dashoffset="${strokeDashoffset}" stroke-linecap="round" fill="transparent" r="48" cx="60" cy="60" style="transform: rotate(-90deg); transform-origin: 60px 60px; transition: stroke-dashoffset 0.5s ease-in-out;"/>
            </svg>
            <span style="position: absolute; font-size: 18px; font-weight: 800; font-family: var(--font-mono); color: var(--text-main);">${solvedPercent}%</span>
          </div>
          <div style="font-size: 13px; color: var(--text-secondary); font-weight: 500;">
            已通过 <strong class="text-accent" style="font-size: 15px;">${solvedCount}</strong> / ${totalCount} 题
          </div>
        </div>
      </div>

      <!-- Right Main: Change Password Form -->
      <div class="account-main">
        <div class="card" style="padding: var(--space-xl) var(--space-lg);">
          <h3 class="card-title" style="margin-bottom: var(--space-lg); display: flex; align-items: center; gap: 10px;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            重设安全密钥密码
          </h3>
          
          <div class="form-group">
            <label for="oldPass">当前验证密码</label>
            <input type="password" id="oldPass" placeholder="请输入当前正在使用的安全验证密码" />
          </div>
          
          <div class="form-group" style="margin-top: var(--space-md);">
            <label for="newPass">设置新安全密码</label>
            <input type="password" id="newPass" placeholder="请输入高强度的数字与字母组合" />
          </div>
          
          <div id="pwdError" class="notice error" style="display:none; margin-top: var(--space-md);"></div>
          <div id="pwdSuccess" class="notice success" style="display:none; margin-top: var(--space-md);"></div>
          
          <button class="btn btn-primary mt-lg" onclick="changePassword()">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            确定修改密码
          </button>
        </div>
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

async function renderAuditLogs() {
  setPage('审计日志');
  if (!requireAdmin()) return;
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在读取管理员操作流水...</span>
    </div>
  `;
  try {
    const data = await api('/api/admin/audit-logs?limit=200', { headers: authHeaders() });
    const items = data.items || [];
    app.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width: 190px;">时间</th>
              <th style="width: 140px;">操作者</th>
              <th>动作</th>
              <th style="width: 160px;">资源</th>
              <th>元数据</th>
            </tr>
          </thead>
          <tbody>
            ${items.length === 0 ? `
              <tr><td colspan="5">${emptyBox('暂无审计记录')}</td></tr>
            ` : items.map(item => `
              <tr>
                <td style="font-size: 12px; color: var(--text-muted);">${formatDate(item.created_at)}</td>
                <td><strong>${esc(item.username || 'system')}</strong></td>
                <td><span class="pill blue" style="font-family: var(--font-mono); text-transform: none;">${esc(item.action)}</span></td>
                <td style="font-family: var(--font-mono); font-size: 12px;">${esc(item.resource_type)}${item.resource_id ? `#${esc(item.resource_id)}` : ''}</td>
                <td><code style="white-space: pre-wrap;">${esc(JSON.stringify(item.metadata || {}, null, 2))}</code></td>
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

// Admin: User Administration
async function renderUsers() {
  setPage('用户管理');
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

function formatAgeFromNow(value) {
  if (!value) return '—';
  const diffMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diffMs)) return '—';
  const totalSec = Math.max(0, Math.floor(diffMs / 1000));
  if (totalSec < 60) return `${totalSec}s 前`;
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}m 前`;
  if (totalSec < 86400) return `${Math.floor(totalSec / 3600)}h 前`;
  return `${Math.floor(totalSec / 86400)}d 前`;
}

function truncateMiddle(text, limit = 72) {
  const value = String(text || '');
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

async function renderJudgeAdmin() {
  setPage('评测运维');
  if (!requireAdmin()) return;
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在汇总评测节点与任务队列...</span>
    </div>
  `;
  try {
    const data = await api('/api/admin/judge/overview', { headers: authHeaders() });
    const summary = data.summary || {};
    const nodes = data.nodes || [];
    const jobs = data.recent_jobs || [];
    const timing = data.timing || {};
    const heartbeatHint = Math.max(1, Math.round((timing.node_heartbeat_ttl_seconds || 90) / 60));
    const staleHint = Math.max(1, Math.round((timing.job_stale_after_seconds || 900) / 60));

    app.innerHTML = `
      <div class="row flex-between mb-lg" style="flex-wrap: wrap;">
        <div>
          <h3 class="section-title" style="margin-bottom: 4px;">Judge Admin / 评测调度运维台</h3>
          <div class="text-muted" style="font-size: 12px;">
            节点心跳超过 ${heartbeatHint} 分钟视为离线，CLAIMED 超过 ${staleHint} 分钟视为卡住任务。
          </div>
        </div>
        <button class="btn btn-secondary" onclick="renderJudgeAdmin()">刷新面板</button>
      </div>

      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-value">${summary.pending_jobs || 0}</div>
          <div class="stat-label">待调度任务</div>
        </div>
        <div class="stat-card" style="border-color: var(--color-primary);">
          <div class="stat-value" style="color: var(--color-primary);">${summary.claimed_jobs || 0}</div>
          <div class="stat-label">执行中任务</div>
        </div>
        <div class="stat-card" style="border-color: ${(summary.stale_jobs || 0) > 0 ? 'var(--color-danger)' : 'var(--border-light)'};">
          <div class="stat-value" style="color: ${(summary.stale_jobs || 0) > 0 ? 'var(--color-danger)' : 'var(--text-main)'};">${summary.stale_jobs || 0}</div>
          <div class="stat-label">卡住任务</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${summary.online_nodes || 0}/${summary.total_nodes || 0}</div>
          <div class="stat-label">在线节点</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${summary.running_submissions || 0}</div>
          <div class="stat-label">运行中提交</div>
        </div>
        <div class="stat-card" style="border-color: var(--color-warning);">
          <div class="stat-value" style="color: var(--color-warning);">${summary.failed_jobs_24h || 0}</div>
          <div class="stat-label">24h 失败任务</div>
        </div>
      </div>

      <div class="judge-admin-layout">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">节点状态</h3>
          </div>
          ${nodes.length === 0 ? emptyBox('尚未有评测节点向内部接口报到') : `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>节点</th>
                    <th>状态</th>
                    <th>活动任务</th>
                    <th>最近心跳</th>
                  </tr>
                </thead>
                <tbody>
                  ${nodes.map((node) => `
                    <tr>
                      <td>
                        <strong style="font-family: var(--font-mono);">${esc(node.name)}</strong>
                        <div class="text-muted" style="font-size: 11px;">并发上限 ${esc(node.max_parallel || 1)}</div>
                      </td>
                      <td>${node.is_online ? '<span class="pill green">ONLINE</span>' : '<span class="pill red">STALE</span>'}</td>
                      <td>${esc(node.active_jobs || 0)}</td>
                      <td>
                        <div>${formatDate(node.last_heartbeat_at)}</div>
                        <div class="text-muted" style="font-size: 11px;">${formatAgeFromNow(node.last_heartbeat_at)}</div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <div class="card ${summary.stale_jobs ? 'highlight' : ''}">
          <div class="card-header">
            <h3 class="card-title">最近任务</h3>
          </div>
          ${jobs.length === 0 ? emptyBox('当前还没有评测任务记录') : `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>提交 / 题目</th>
                    <th>执行状态</th>
                    <th>节点</th>
                    <th>诊断</th>
                    <th style="text-align: right;">操作</th>
                  </tr>
                </thead>
                <tbody>
                  ${jobs.map((job) => `
                    <tr>
                      <td>
                        <div><strong>#${job.id}</strong></div>
                        <div class="text-muted" style="font-size: 11px;">attempt ${esc(job.attempt || 0)}${job.is_test_run ? ' · TEST' : ''}</div>
                      </td>
                      <td>
                        <div>
                          <a href="/submissions/${job.submission_id}" data-link><strong>Submission #${job.submission_id}</strong></a>
                          ${job.contest_id ? '<span class="pill gray" style="margin-left: 6px;">CONTEST</span>' : ''}
                        </div>
                        <div style="font-family: var(--font-mono); font-size: 12px;">${esc(job.problem_slug || `problem-${job.problem_id}`)}</div>
                        <div class="text-muted" style="font-size: 11px;">${esc(job.username || 'anonymous')}</div>
                      </td>
                      <td>
                        <div>${statusPill(job.status)}</div>
                        <div style="margin-top: 6px;">${statusPill(job.submission_status)}</div>
                        ${job.is_stale ? '<div class="text-danger" style="font-size: 11px; margin-top: 6px;">CLAIMED 过久</div>' : ''}
                      </td>
                      <td>
                        <div>${esc(job.node_name || '—')}</div>
                        <div class="text-muted" style="font-size: 11px;">${formatAgeFromNow(job.claimed_at || job.created_at)}</div>
                      </td>
                      <td style="min-width: 240px;">
                        <div class="text-muted" style="font-size: 11px; margin-bottom: 4px;">
                          创建 ${formatDate(job.created_at)}
                        </div>
                        ${job.finished_at ? `
                          <div class="text-muted" style="font-size: 11px; margin-bottom: 4px;">
                            完成 ${formatDate(job.finished_at)}
                          </div>
                        ` : ''}
                        <div style="font-size: 12px; line-height: 1.4;">
                          ${job.error_message ? esc(truncateMiddle(job.error_message, 88)) : '—'}
                        </div>
                        ${(job.public_score != null || job.private_score != null) ? `
                          <div class="text-muted" style="font-size: 11px; margin-top: 6px;">
                            public ${scoreDisplay(job.public_score)} / private ${scoreDisplay(job.private_score)}
                          </div>
                        ` : ''}
                      </td>
                      <td>
                        <div class="row gap-xs" style="justify-content: flex-end; flex-wrap: wrap;">
                          <button class="btn btn-secondary btn-sm" onclick="rejudgeSubmission(${job.submission_id})">重判提交</button>
                          ${job.status === 'FAILED' ? `<button class="btn btn-secondary btn-sm" onclick="retryJudgeJob(${job.id})">重试任务</button>` : ''}
                          ${(job.status === 'CLAIMED' || job.status === 'PENDING') ? `<button class="btn btn-danger btn-sm" onclick="markJudgeJobFailed(${job.id})">标记失败</button>` : ''}
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;

    setTimeout(() => {
      if (location.pathname === '/judge-admin') {
        renderJudgeAdmin();
      }
    }, 10000);
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

async function retryJudgeJob(jobId) {
  if (!confirm(`确认重试评测任务 #${jobId} 吗？`)) return;
  try {
    await api(`/api/admin/judge/jobs/${jobId}/retry`, {
      method: 'POST',
      headers: authHeaders(),
    });
    toast(`任务 #${jobId} 已重新入队`, 'success');
    renderJudgeAdmin();
  } catch (err) {
    toast(`重试任务失败: ${err.message}`, 'error');
  }
}

async function rejudgeSubmission(submissionId) {
  if (!confirm(`确认重新评测提交 #${submissionId} 吗？原有结果会被新结果覆盖。`)) return;
  try {
    await api(`/api/admin/judge/submissions/${submissionId}/rejudge`, {
      method: 'POST',
      headers: authHeaders(),
    });
    toast(`提交 #${submissionId} 已重新入队`, 'success');
    renderJudgeAdmin();
  } catch (err) {
    toast(`重判提交失败: ${err.message}`, 'error');
  }
}

async function markJudgeJobFailed(jobId) {
  const reason = window.prompt('请输入标记失败原因（会写入提交错误信息）：', 'Marked failed by admin');
  if (reason === null) return;
  try {
    await api(`/api/admin/judge/jobs/${jobId}/mark-failed`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() || 'Marked failed by admin' }),
    });
    toast(`任务 #${jobId} 已标记失败`, 'success');
    renderJudgeAdmin();
  } catch (err) {
    toast(`标记任务失败: ${err.message}`, 'error');
  }
}

// Admin: Problem Repository Manager
async function renderProblemAdmin() {
  setPage('题目管理');
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
                  <th>当前生效版本</th>
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
                    <td style="font-family: var(--font-mono); font-size: 12px;">${esc(p.active_version || '未激活')}</td>
                    <td style="font-family: var(--font-mono); font-size: 12px;">${p.versions || '1'}</td>
                    <td>
                      <div class="row gap-xs" style="justify-content: flex-end;">
                        <a href="/problems/${esc(p.slug)}" class="btn btn-secondary btn-sm" data-link>预览</a>
                        <button class="btn btn-secondary btn-sm" onclick="showProblemVersionsModal('${esc(p.slug)}')">版本流水线</button>
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
        <strong>部署成功!</strong> 题目: ${esc(data.slug)} 已经成功装载入库 (版本号: ${esc(data.version || '1')})。
        <div style="margin-top: 8px; font-size: 13px;">
          版本状态: ${esc(data.version_status || 'DRAFT')}，自测结果: ${esc(data.self_test_status || 'PENDING')}${data.activated ? '，已自动激活。' : '。'}
        </div>
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

function renderProblemVersionSelfTestSummary(item) {
  const result = item.self_test_result || {};
  const status = item.self_test_status || 'PENDING';
  if (status === 'PENDING') {
    return '<span class="text-muted" style="font-size: 12px;">尚未完成版本自测</span>';
  }
  if (status === 'FAILED') {
    return `<span style="font-size: 12px; color: var(--color-danger);">${esc(result.error_message || '自测失败')}</span>`;
  }
  return `
    <span style="font-size: 12px; color: var(--text-secondary);">
      Public: <strong>${scoreDisplay(result.public_score)}</strong> ·
      Private: <strong>${scoreDisplay(result.private_score)}</strong>
    </span>
  `;
}

async function showProblemVersionsModal(slug) {
  try {
    const data = await api(`/api/admin/problems/${slug}/versions`, { headers: authHeaders() });
    const items = data.items || [];
    openModal({
      title: `题目版本发布流水线 — ${slug}`,
      wide: true,
      body: `
        <div class="notice info" style="margin-bottom: var(--space-md);">
          这里管理题目版本的自测、激活与回滚。只有激活版本会对选手可见并接收新提交。
        </div>
        ${items.length === 0 ? emptyBox('该题目暂时没有历史版本记录') : `
          <div style="display: flex; flex-direction: column; gap: var(--space-md);">
            ${items.map(item => `
              <div class="card ${item.is_active ? 'highlight' : ''}" style="padding: var(--space-lg);">
                <div class="row flex-between gap-md" style="align-items: flex-start; flex-wrap: wrap;">
                  <div style="flex: 1; min-width: 260px;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap: wrap; margin-bottom: 8px;">
                      <strong style="font-family: var(--font-mono); font-size: 16px;">${esc(item.version)}</strong>
                      ${statusPill(item.status)}
                      ${statusPill(item.self_test_status || 'PENDING')}
                      ${item.is_active ? '<span class="pill blue">CURRENT</span>' : ''}
                    </div>
                    <div class="text-muted" style="font-size: 12px; margin-bottom: 8px;">
                      激活时间: ${formatDate(item.activated_at) || '—'} · 最近自测: ${formatDate(item.last_self_tested_at) || '—'}
                    </div>
                    <div class="text-muted" style="font-size: 12px; margin-bottom: 6px;">
                      Runner: <code>${esc(item.runner_image || '—')}</code> · Tags: <code>${esc((item.required_tags || []).join(', ') || 'none')}</code>
                    </div>
                    ${renderProblemVersionSelfTestSummary(item)}
                  </div>
                  <div class="row gap-xs" style="justify-content: flex-end; flex-wrap: wrap;">
                    <button class="btn btn-secondary btn-sm" onclick="rerunProblemVersionSelfTest('${esc(slug)}', ${item.id})">重新自测</button>
                    <button class="btn btn-primary btn-sm" onclick="activateProblemVersion('${esc(slug)}', ${item.id})">激活/回滚到此版本</button>
                    <button class="btn btn-secondary btn-sm" onclick="setProblemVersionStatus('${esc(slug)}', ${item.id}, 'DRAFT')">置为草稿</button>
                    <button class="btn btn-danger btn-sm" onclick="setProblemVersionStatus('${esc(slug)}', ${item.id}, 'ARCHIVED')">归档版本</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      `,
      footer: `
        <button class="btn btn-secondary" onclick="closeModal()">关闭</button>
        <button class="btn btn-primary" onclick="renderProblemAdmin(); showProblemVersionsModal('${esc(slug)}')">刷新列表</button>
      `,
    });
  } catch (err) {
    toast(`读取版本流水线失败: ${err.message}`, 'error');
  }
}

async function rerunProblemVersionSelfTest(slug, versionId) {
  try {
    await api(`/api/admin/problems/${slug}/versions/${versionId}/self-test`, {
      method: 'POST',
      headers: authHeaders(),
    });
    toast(`版本 #${versionId} 自测完成`, 'success');
    showProblemVersionsModal(slug);
    renderProblemAdmin();
  } catch (err) {
    toast(`版本自测失败: ${err.message}`, 'error');
  }
}

async function activateProblemVersion(slug, versionId, force = false) {
  try {
    await api(`/api/admin/problems/${slug}/versions/${versionId}/activate`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    toast(`版本 #${versionId} 已切换为当前生效版本`, 'success');
    showProblemVersionsModal(slug);
    renderProblemAdmin();
  } catch (err) {
    if (!force && /force=true|自测/i.test(err.message || '')) {
      if (confirm(`该版本当前未通过自测，是否强制激活版本 #${versionId}？`)) {
        return activateProblemVersion(slug, versionId, true);
      }
    }
    toast(`激活版本失败: ${err.message}`, 'error');
  }
}

async function setProblemVersionStatus(slug, versionId, status) {
  try {
    await api(`/api/admin/problems/${slug}/versions/${versionId}/status`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    toast(`版本 #${versionId} 状态已更新为 ${status}`, 'success');
    showProblemVersionsModal(slug);
    renderProblemAdmin();
  } catch (err) {
    toast(`更新版本状态失败: ${err.message}`, 'error');
  }
}

// Admin: Contest Management
async function renderContestAdmin() {
  setPage('比赛管理');
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
  if (state.user) {
    refreshNotificationCount();
    refreshMessageCount();
  }

  const app = $('app');
  app.className = 'content animate-fade-in';

  // Route matching
  if (path === '/') return renderDashboard();
  if (path === '/problems') return renderProblems();
  if (path === '/contests') return renderContests();
  if (path === '/submissions') return renderSubmissions();
  if (path === '/notifications') return renderNotifications();
  if (path === '/messages') return renderMessages();
  if (path === '/account') return renderAccount();
  if (path === '/admin/users' || path === '/users') return renderUsers();
  if (path === '/admin/audit') return renderAuditLogs();
  if (path === '/judge-admin') return renderJudgeAdmin();
  if (path === '/problem-admin') return renderProblemAdmin();
  if (path === '/contest-admin') return renderContestAdmin();

  // Parameterized routes
  let match;
  if ((match = path.match(/^\/contests\/([^/]+)\/problems\/([^/]+)$/))) {
    return renderProblemDetail(match[2], match[1]);
  }
  if ((match = path.match(/^\/messages\/(\d+)$/))) {
    return renderMessages(Number(match[1]));
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
  setPage('异常访问');
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
  $('notificationBtn').addEventListener('click', () => {
    if (!state.user) {
      showAuthModal();
      return;
    }
    navigate('/notifications');
  });
  $('messageBtn').addEventListener('click', () => {
    if (!state.user) {
      showAuthModal();
      return;
    }
    navigate('/messages');
  });

  // User profile dropdown toggle
  const userPill = $('userPill');
  if (userPill) {
    userPill.addEventListener('click', (e) => {
      e.stopPropagation();
      $('userDropdownContainer').classList.toggle('active');
    });
  }
  document.addEventListener('click', () => {
    const container = $('userDropdownContainer');
    if (container) container.classList.remove('active');
  });

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

// ─── Web IDE & Sandbox Test Run Handlers ─────────────────────────────────────
const CODE_TEMPLATE = `import pandas as pd
import numpy as np
import time

def predict():
    print("[AIOJ Web IDE] 开始执行预测代码...")
    print("正在加载测试数据...")
    try:
        test_df = pd.read_csv('/input/test.csv')
    except Exception as e:
        print(f"ERROR: 无法加载输入测试集: {e}")
        return

    print(f"成功加载数据集，样本数: {len(test_df)}")
    print("特征提取与模型前向传播中...")
    time.sleep(1) # 模拟推理耗时

    # ─────────────────────────────────────────────────────────
    # 📝 在此编写您的算法/模型预测逻辑。
    # 默认 Baseline 生成全零预测作为演示。
    # ─────────────────────────────────────────────────────────
    predictions = np.zeros(len(test_df))

    # 组装符合规范的提交格式
    submission = pd.DataFrame({
        'id': test_df['id'],
        'prediction': predictions
    })

    print("预测导出至 /output/submission.csv ...")
    submission.to_csv('/output/submission.csv', index=False)
    print("模型沙箱预测执行完毕！")

if __name__ == '__main__':
    predict()
`;

function appendTerminal(text) {
  const terminal = $('terminalOutput');
  if (!terminal) return;
  terminal.textContent += text + '\n';
  terminal.scrollTop = terminal.scrollHeight;
}

function resetEditorCode(slug) {
  if (confirm('确认将编辑器代码重置为默认机器学习模板吗？您当前未保存的代码将会丢失。')) {
    const textarea = $('codeEditor');
    if (textarea) {
      textarea.value = CODE_TEMPLATE;
      localStorage.setItem(`aioj_code_${slug}`, CODE_TEMPLATE);
    }
  }
}

async function runSandboxTest(slug) {
  const code = $('codeEditor').value.trim();
  if (!code) {
    toast('请输入代码！', 'danger');
    return;
  }
  
  const terminal = $('terminalOutput');
  const dot = $('terminalStatusDot');
  const txt = $('terminalStatusText');
  const btn = $('btnRunTest');
  
  terminal.textContent = '>>> 初始化沙箱评测环境...\n';
  dot.style.background = 'var(--color-warning)';
  txt.textContent = 'QUEUED';
  txt.style.color = 'var(--color-warning)';
  btn.disabled = true;
  
  appendTerminal('>>> 正在打包 predict.py 并发送测试运行请求...');
  
  try {
    const formData = new FormData();
    formData.append('code', code);
    formData.append('is_test_run', 'true');
    
    const res = await api(`/api/problems/${slug}/submissions`, {
      method: 'POST',
      body: formData,
      headers: authHeaders(),
    });
    
    const submissionId = res.submission_id;
    appendTerminal(`>>> 评测任务创建成功。任务 ID: #${submissionId}`);
    appendTerminal('>>> 正在等待可用沙箱节点 claimed...');
    
    pollTestRun(submissionId, slug);
  } catch (err) {
    appendTerminal(`\n[ERROR] 提交测试失败: ${err.message || err}`);
    dot.style.background = 'var(--color-danger)';
    txt.textContent = 'FAILED';
    txt.style.color = 'var(--color-danger)';
    btn.disabled = false;
  }
}

async function pollTestRun(submissionId, slug) {
  const terminal = $('terminalOutput');
  const dot = $('terminalStatusDot');
  const txt = $('terminalStatusText');
  const btn = $('btnRunTest');
  
  let attempts = 0;
  const maxAttempts = 120; // 3 minutes total
  const interval = 1500; // 1.5 seconds
  
  const timer = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(timer);
      appendTerminal('\n[TIMEOUT] 评测超时，系统强制中止。');
      dot.style.background = 'var(--color-danger)';
      txt.textContent = 'TIMEOUT';
      txt.style.color = 'var(--color-danger)';
      btn.disabled = false;
      return;
    }
    
    try {
      const sub = await api(`/api/submissions/${submissionId}`, { headers: authHeaders() });
      const status = sub.status;
      
      if (status === 'RUNNING') {
        dot.style.background = 'var(--color-primary)';
        txt.textContent = 'RUNNING';
        txt.style.color = 'var(--color-primary)';
      } else if (status === 'TEST_QUEUED') {
        dot.style.background = 'var(--color-warning)';
        txt.textContent = 'QUEUED';
        txt.style.color = 'var(--color-warning)';
      }
      
      if (['TEST_ACCEPTED', 'TEST_FAILED', 'TEST_EVALUATION_FAILED', 'RUN_FAILED', 'EVALUATION_FAILED', 'ACCEPTED'].includes(status)) {
        clearInterval(timer);
        btn.disabled = false;
        
        appendTerminal(`\n>>> 评测运行结束。最终状态: [${status}]`);
        appendTerminal('>>> 正在拉取沙箱运行日志...\n');
        
        try {
          const logRes = await api(`/api/submissions/${submissionId}/log`, { headers: authHeaders() });
          appendTerminal('==================== DOCKER SANDBOX LOGS ====================');
          appendTerminal(logRes.log || '（无日志输出）');
          appendTerminal('==============================================================');
        } catch (logErr) {
          appendTerminal(`>>> [ERROR] 无法拉取运行日志: ${logErr.message}`);
        }
        
        if (status === 'TEST_ACCEPTED' || status === 'ACCEPTED') {
          dot.style.background = 'var(--color-success)';
          txt.textContent = 'SUCCESS';
          txt.style.color = 'var(--color-success)';
          
          appendTerminal('\n🎉 评测指标评定完成 (Evaluation Metrics):');
          appendTerminal(`- 公开测试集得分 (Public Score):  ${sub.public_score != null ? sub.public_score.toFixed(6) : 'N/A'}`);
          appendTerminal(`- 私有测试集得分 (Private Score): ${sub.private_score != null ? sub.private_score.toFixed(6) : 'N/A'}`);
          appendTerminal(`- 运行容器耗时 (Runtime):        ${sub.runtime_ms != null ? sub.runtime_ms + ' ms' : 'N/A'}`);
          appendTerminal(`- 峰值内存占用 (Peak Memory):    ${sub.memory_peak_mb != null ? sub.memory_peak_mb + ' MB' : 'N/A'}`);
          appendTerminal('\n>>> 测试运行圆满成功！您可以点击【正式提交】提报此版本至排行榜。');
        } else {
          dot.style.background = 'var(--color-danger)';
          txt.textContent = 'FAILED';
          txt.style.color = 'var(--color-danger)';
          
          appendTerminal(`\n❌ 沙箱运行失败 (Sandbox Failed):`);
          appendTerminal(`- 错误类型/原因: ${sub.error_message || '未知错误 (运行非正常退出)'}`);
          appendTerminal(`- 容器耗时: ${sub.runtime_ms != null ? sub.runtime_ms + ' ms' : 'N/A'}`);
          appendTerminal('\n>>> 请根据上方 DOCKER SANDBOX LOGS 中的报错进行诊断和修改。');
        }
      }
    } catch (err) {
      console.error('Error polling submission:', err);
    }
  }, interval);
}

async function submitEditorCode(slug, contestSlug) {
  const code = $('codeEditor').value.trim();
  if (!code) {
    toast('请输入代码！', 'danger');
    return;
  }
  
  if (!confirm('您确定要将当前编辑器中的代码进行正式提交吗？此提交将正式计入排行榜。')) {
    return;
  }
  
  const btn = $('btnSubmitCode');
  btn.disabled = true;
  btn.textContent = '提交中...';
  
  try {
    const formData = new FormData();
    formData.append('code', code);
    if (contestSlug) {
      formData.append('contest_slug', contestSlug);
    }
    
    const res = await api(`/api/problems/${slug}/submissions`, {
      method: 'POST',
      body: formData,
      headers: authHeaders(),
    });
    
    toast('代码提交成功！容器沙箱已启动评测。', 'success');
    
    // Reload submissions and navigate to submissions tab
    const [problem, subsData] = await Promise.all([
      api(`/api/problems/${slug}`),
      loadProblemSubmissions(slug, contestSlug),
    ]);
    const subs = subsData.items || [];
    
    const tabHeaders = document.querySelectorAll('#problemTabs .tab');
    if (tabHeaders.length >= 3) {
      tabHeaders[2].textContent = `我的提交记录 (${subs.length})`;
    }
    
    const subsPanel = $('tab-submissions');
    if (subsPanel) {
      subsPanel.innerHTML = `
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
      `;
    }
    
    switchProblemTab('submissions');
  } catch (err) {
    toast(`提交失败: ${err.message}`, 'danger');
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 正式提交 (Submit Solution)';
  }
}


let notebookCells = [];

function parseIpynbJson(jsonStr) {
  try {
    const ipynb = JSON.parse(jsonStr);
    if (!ipynb || !Array.isArray(ipynb.cells)) {
      throw new Error('格式不符合标准的 Jupyter Notebook 规范');
    }
    return ipynb.cells.map(c => {
      const type = c.cell_type === 'markdown' ? 'markdown' : 'code';
      const source = Array.isArray(c.source) ? c.source.join('') : (c.source || '');
      return { type, source };
    });
  } catch (err) {
    throw new Error('解析 Notebook JSON 失败: ' + err.message);
  }
}

function parseScriptToCells(scriptText) {
  const fileLines = scriptText.split('\n');
  const cells = [];
  let currentCell = { type: 'code', sourceLines: [] };

  for (let i = 0; i < fileLines.length; i++) {
    const line = fileLines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('# %%')) {
      if (currentCell.sourceLines.length > 0 || cells.length > 0) {
        cells.push({
          type: currentCell.type,
          source: currentCell.sourceLines.join('\n')
        });
      }
      if (trimmed.startsWith('# %% [markdown]')) {
        currentCell = { type: 'markdown', sourceLines: [] };
      } else {
        currentCell = { type: 'code', sourceLines: [] };
      }
    } else {
      if (currentCell.type === 'markdown') {
        if (line.trim().startsWith('#')) {
          let content = line.trim().substring(1);
          if (content.startsWith(' ')) {
            content = content.substring(1);
          }
          currentCell.sourceLines.push(content);
        } else {
          currentCell.sourceLines.push(line);
        }
      } else {
        currentCell.sourceLines.push(line);
      }
    }
  }

  if (currentCell.sourceLines.length > 0 || cells.length === 0) {
    cells.push({
      type: currentCell.type,
      source: currentCell.sourceLines.join('\n')
    });
  }

  return cells;
}

function parseCellsToScript(cells) {
  const parts = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.type === 'markdown') {
      parts.push('# %% [markdown]');
      const cellLines = cell.source.split('\n');
      for (const line of cellLines) {
        parts.push('# ' + line);
      }
    } else {
      parts.push('# %%');
      parts.push(cell.source);
    }
  }
  return parts.join('\n');
}

function initEditorLineNumbers() {
  const textarea = $('codeEditor');
  const lineNumbers = $('lineNumbers');
  if (!textarea || !lineNumbers) return;

  const updateLineNumbers = () => {
    const linesArr = textarea.value.split('\n');
    const count = Math.max(1, linesArr.length);
    let html = '';
    for (let i = 1; i <= count; i++) {
      html += `<span class="ln">${i}</span>`;
    }
    lineNumbers.innerHTML = html;
  };

  const syncScroll = () => {
    lineNumbers.scrollTop = textarea.scrollTop;
  };

  textarea.removeEventListener('input', updateLineNumbers);
  textarea.removeEventListener('scroll', syncScroll);
  textarea.addEventListener('input', updateLineNumbers);
  textarea.addEventListener('scroll', syncScroll);
  
  updateLineNumbers();
  syncScroll();
}

function switchEditorMode(mode, slug) {
  const btnScript = $('modeScript');
  const btnNotebook = $('modeNotebook');
  const editorScript = $('editorScriptMode');
  const editorNotebook = $('editorNotebookMode');
  const fileLabel = $('ideFileLabel');
  
  if (mode === 'notebook') {
    const scriptVal = $('codeEditor').value;
    notebookCells = parseScriptToCells(scriptVal);
    
    btnScript.classList.remove('active');
    btnNotebook.classList.add('active');
    editorScript.style.display = 'none';
    editorNotebook.style.display = 'block';
    fileLabel.textContent = 'predict.ipynb';
    
    renderNotebookCells();
  } else {
    // Save cells to script
    const scriptVal = parseCellsToScript(notebookCells);
    $('codeEditor').value = scriptVal;
    localStorage.setItem(`aioj_code_${slug}`, scriptVal);
    
    btnScript.classList.add('active');
    btnNotebook.classList.remove('active');
    editorScript.style.display = 'flex';
    editorNotebook.style.display = 'none';
    fileLabel.textContent = 'predict.py';
    
    initEditorLineNumbers();
  }
}

function renderNotebookCells() {
  const container = $('nbCellsContainer');
  if (!container) return;

  let html = '';
  notebookCells.forEach((cell, idx) => {
    const cellId = `nb-cell-${idx}`;
    const cellTypeLabel = cell.type === 'code' ? 'Code 单元格' : 'Markdown 单元格';
    const cellClass = cell.type === 'code' ? 'nb-cell code-cell' : 'nb-cell markdown-cell';
    const placeholder = cell.type === 'code' ? '在此编写 Python 代码...' : '在此编写 Markdown 文本...';
    
    html += `
      <div class="${cellClass}" id="${cellId}" data-index="${idx}">
        <div class="nb-cell-header">
          <div class="cell-label">
            <span>${cell.type === 'code' ? '💻' : '📝'}</span>
            <span>[${idx}] ${cellTypeLabel}</span>
          </div>
          <div class="cell-actions">
            <button onclick="moveNbCell(${idx}, -1)" title="上移" ${idx === 0 ? 'disabled style="opacity:0.3; cursor:default;"' : ''}>▲</button>
            <button onclick="moveNbCell(${idx}, 1)" title="下移" ${idx === notebookCells.length - 1 ? 'disabled style="opacity:0.3; cursor:default;"' : ''}>▼</button>
            <button onclick="toggleNbCellType(${idx})" title="切换类型">${cell.type === 'code' ? '⚡ 转 Markdown' : '⚡ 转 Code'}</button>
            <button onclick="removeNbCell(${idx})" title="删除" style="color: var(--color-danger);">🗑️</button>
          </div>
        </div>
        <textarea id="cell-textarea-${idx}" placeholder="${placeholder}" oninput="updateNbCellContent(${idx}, this.value)">${esc(cell.source)}</textarea>
      </div>
    `;
  });

  html += `
    <div style="display: flex; gap: 8px; margin-top: 12px;">
      <button class="nb-add-cell-btn" onclick="addNbCell('code')" style="flex: 1;">➕ 添加 Code 单元格</button>
      <button class="nb-add-cell-btn" onclick="addNbCell('markdown')" style="flex: 1;">➕ 添加 Markdown 单元格</button>
    </div>
  `;

  container.innerHTML = html;

  notebookCells.forEach((cell, idx) => {
    const ta = $(`cell-textarea-${idx}`);
    if (ta) {
      ta.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = this.selectionStart;
          const end = this.selectionEnd;
          this.value = this.value.substring(0, start) + "    " + this.value.substring(end);
          this.selectionStart = this.selectionEnd = start + 4;
          updateNbCellContent(idx, this.value);
        }
      });
      const autoExpand = () => {
        ta.style.height = 'auto';
        ta.style.height = (ta.scrollHeight + 4) + 'px';
      };
      ta.addEventListener('input', autoExpand);
      autoExpand();
    }
  });
}

function updateNbCellContent(idx, value) {
  if (notebookCells[idx]) {
    notebookCells[idx].source = value;
    saveNotebookCellsToLocal();
  }
}

function toggleNbCellType(idx) {
  if (notebookCells[idx]) {
    notebookCells[idx].type = notebookCells[idx].type === 'code' ? 'markdown' : 'code';
    renderNotebookCells();
    saveNotebookCellsToLocal();
  }
}

function removeNbCell(idx) {
  if (confirm('确认删除此单元格吗？此操作不可撤销。')) {
    notebookCells.splice(idx, 1);
    if (notebookCells.length === 0) {
      notebookCells.push({ type: 'code', source: '' });
    }
    renderNotebookCells();
    saveNotebookCellsToLocal();
  }
}

function moveNbCell(idx, direction) {
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= notebookCells.length) return;
  const temp = notebookCells[idx];
  notebookCells[idx] = notebookCells[targetIdx];
  notebookCells[targetIdx] = temp;
  
  renderNotebookCells();
  saveNotebookCellsToLocal();
  
  setTimeout(() => {
    const ta = $(`cell-textarea-${targetIdx}`);
    if (ta) ta.focus();
  }, 50);
}

function addNbCell(type) {
  notebookCells.push({ type: type, source: '' });
  renderNotebookCells();
  saveNotebookCellsToLocal();
  
  setTimeout(() => {
    const ta = $(`cell-textarea-${notebookCells.length - 1}`);
    if (ta) ta.focus();
  }, 50);
}

function saveNotebookCellsToLocal() {
  const scriptVal = parseCellsToScript(notebookCells);
  const slug = state.activeProblemSlug;
  if (slug) {
    localStorage.setItem(`aioj_code_${slug}`, scriptVal);
    // Keep raw textarea value updated too in case user submits from notebook view
    const ta = $('codeEditor');
    if (ta) ta.value = scriptVal;
  }
}


function toggleFullscreenEditor() {
  const container = document.querySelector('.ide-container');
  const btn = $('btnFullscreenEditor');
  if (!container || !btn) return;
  
  const isFull = container.classList.toggle('ide-fullscreen');
  if (isFull) {
    btn.innerHTML = '<span>🗗</span> 退出';
    btn.title = '退出全屏';
    document.body.style.overflow = 'hidden';
  } else {
    btn.innerHTML = '<span>⛶</span> 全屏';
    btn.title = '全屏模式';
    document.body.style.overflow = '';
  }
  
  initEditorLineNumbers();
  
  if (window.notebookCells) {
    window.notebookCells.forEach((_, idx) => {
      const ta = $(`cell-textarea-${idx}`);
      if (ta) {
        ta.style.height = 'auto';
        ta.style.height = (ta.scrollHeight + 4) + 'px';
      }
    });
  }
}

// ─── Window exports for handlers ──────────────────────────────────────────
Object.assign(window, {
  navigate, showAuthModal, switchAuthTab, submitAuth, logout,
  submitSolution, showContestTab, switchProblemTab, handleFileSelect,
  cancelSubmission, downloadSubmissionArtifact, renderAuditLogs,
  joinContest, submitInviteCode, leaveContest,
  showAskQuestionModal, submitQuestion,
  showAnswerQuestionModal, submitAnswer, closeQuestion,
  changePassword, showResetPasswordModal, resetUserPassword,
  renderJudgeAdmin, retryJudgeJob, rejudgeSubmission, markJudgeJobFailed,
  toggleUserRole, toggleUserDisabled,
  importProblem, setProblemStatus, showProblemVersionsModal, rerunProblemVersionSelfTest,
  activateProblemVersion, setProblemVersionStatus,
  showCreateContestModal, createContest,
  showContestSettingsModal, saveContestSettings,
  showRegistrationModal, setRegStatus, bulkAddUsers,
  showAnnouncementModal, publishAnnouncement,
  renderNotifications, markNotificationRead, markAllNotificationsRead, openNotificationLink,
  renderMessages, openMessageConversation, showNewMessageModal, searchMessageUsers, selectMessageRecipient,
  sendNewMessage, sendMessageToPeer, sendFileToPeer, handleMessageComposerKeydown,
  handleNewMessageKeydown, updateNewMessageFileLabel, openMessageImage, downloadMessageFile,
  closeModal, copyTerminalText, toggleTheme,
  resetEditorCode, runSandboxTest, submitEditorCode, toggleFullscreenEditor, switchEditorMode, moveNbCell, toggleNbCellType, removeNbCell, addNbCell, updateNbCellContent
});
