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
const AIOJ_APP_MODES = new Set(['main', 'chat', 'drive']);
const AIOJ_CHAT_HOST = 'hello.yxyx.space';
const AIOJ_DRIVE_HOST = 'drive.yxyx.space';

function appMode() {
  const explicitMode = String(window.AIOJ_APP_MODE || '').trim().toLowerCase();
  if (AIOJ_APP_MODES.has(explicitMode)) return explicitMode;
  const host = window.location.hostname;
  if (host === AIOJ_CHAT_HOST) return 'chat';
  if (host === AIOJ_DRIVE_HOST) return 'drive';
  return 'main';
}

function isChatApp() {
  return appMode() === 'chat';
}

function isDriveApp() {
  return appMode() === 'drive';
}

function sameYxyxSite() {
  const host = window.location.hostname;
  return host === 'yxyx.space' || host.endsWith('.yxyx.space');
}

function messageHomeHref() {
  if (isChatApp()) return '/';
  if (sameYxyxSite()) return `https://${AIOJ_CHAT_HOST}/`;
  return '/messages';
}

function messageTargetHref(target = null) {
  const parsed = parseMessageConversationKey(target);
  if (!parsed.id) return messageHomeHref();
  if (isChatApp() || sameYxyxSite()) {
    const path = parsed.type === 'group' ? `/groups/${parsed.id}` : `/${parsed.id}`;
    return isChatApp() ? path : `https://${AIOJ_CHAT_HOST}${path}`;
  }
  return parsed.type === 'group' ? `/messages/groups/${parsed.id}` : `/messages/${parsed.id}`;
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

function setCookie(name, value, days) {
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    expires = "; expires=" + date.toUTCString();
  }
  const host = window.location.hostname;
  const domain = host.endsWith('yxyx.space') ? "; domain=.yxyx.space" : "";
  document.cookie = name + "=" + (value || "") + expires + "; path=/" + domain + "; SameSite=Lax; Secure";
}

function eraseCookie(name) {
  const host = window.location.hostname;
  const domain = host.endsWith('yxyx.space') ? "; domain=.yxyx.space" : "";
  document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;' + domain + "; SameSite=Lax; Secure";
}

function isDriveHost() {
  return isDriveApp();
}

function driveBasePath() {
  return isDriveApp() ? '/' : '/drive';
}

function cloudDriveHref() {
  if (isDriveApp()) return '/';
  if (sameYxyxSite()) return `https://${AIOJ_DRIVE_HOST}/`;
  return '/drive';
}

function chatHref() {
  if (isChatApp()) return '/';
  if (sameYxyxSite() || isDriveApp()) return `https://${AIOJ_CHAT_HOST}/`;
  return '/messages';
}

const originalSetItem = localStorage.setItem.bind(localStorage);
const originalRemoveItem = localStorage.removeItem.bind(localStorage);

localStorage.setItem = function(key, value) {
  originalSetItem(key, value);
  if (key === 'aioj_token') {
    setCookie('aioj_token', value, 7);
  }
};

localStorage.removeItem = function(key) {
  originalRemoveItem(key);
  if (key === 'aioj_token') {
    eraseCookie('aioj_token');
  }
};

const state = {
  token: (() => {
    const cookieTok = getCookie('aioj_token');
    const localTok = localStorage.getItem('aioj_token');
    const tok = cookieTok || localTok || '';
    if (tok) {
      if (!cookieTok) setCookie('aioj_token', tok, 7);
      if (!localTok) originalSetItem('aioj_token', tok);
    }
    return tok;
  })(),
  user: null,
  healthOk: false,
  currentRoute: '',
  documentTitleBase: document.title || 'AIOJ — AI Olympiad Judge',
  countdownTimer: null,
  activeProblemTab: 'statement', // Default tab in problem detail
  notificationUnreadCount: 0,
  messageUnreadCount: 0,
  messageRefreshTimer: null,
  messageEventAbortController: null,
  messageEventSignature: '',
  messageEventLastRefreshAt: 0,
  messageRefreshInFlight: false,
  messageActivePeerId: 0,
  messageActiveConversationKey: '',
  messageConversationSearch: '',
  messageShowArchived: false,
  messageConversations: [],
  messageConversationHasMore: false,
  messageConversationNextOffset: 0,
  messageTypingUsers: [],
  messageTypingTimer: null,
  messageTypingLastSentAt: 0,
  messagePreferences: null,
  messageSearchResults: [],
  messageAttachmentCache: new Map(),
  messageComposerDrafts: new Map(),
  messageLayoutCleanup: null,
  messageImagePreview: null,
  messageReplyTarget: null,
  messageThreadItems: [],
  messageThreadFirstUnreadId: 0,
  messageDeferredReadConversationKey: '',
  messageTransientItems: new Map(),
  messageActionMenuCleanup: null,
  messageEmojiPanelConversationKey: '',
  newMessagePendingFiles: [],
  newGroupMembers: [],
  messageActiveGroup: null,
  groupSettingsGroup: null,
  groupSettingsPendingMembers: [],
  driveCurrentFolderId: null,
  driveItems: [],
  driveBreadcrumbs: [],
  driveUsage: null,
  driveSearch: '',
  driveUploadInFlight: false,
  driveUploadProgress: null,
  driveSelectedIds: new Set(),
  driveMoveTargetSearchResults: [],
  driveMoveItemIds: [],
  driveShareActiveItemId: null,
  currentProblem: null,
  activeProblemStatementId: '',
  problemStatementPdfPreviewRequestId: 0,
  markdownConfigured: false,
};

let problemEditorState = null;
let problemEditorTempId = 0;

const MESSAGE_REFRESH_INTERVAL_MS = 5000;
const MESSAGE_EVENT_REFRESH_DEBOUNCE_MS = 900;
const MESSAGE_MUTATION_WINDOW_MS = 2 * 60 * 1000;
const MESSAGE_THREAD_PAGE_SIZE = 20;
const MESSAGE_CONVERSATION_PAGE_SIZE = 80;
const MESSAGE_THREAD_TOP_LOAD_THRESHOLD_PX = 32;
const MESSAGE_FILE_SIZE_LIMIT_BYTES = 20 * 1024 * 1024;
const MESSAGE_GIF_FAVORITE_MAX_BYTES = 2 * 1024 * 1024;
const MESSAGE_GIF_FAVORITE_MAX_ITEMS = 18;
const MESSAGE_RECENT_EMOJI_MAX_ITEMS = 24;
const MESSAGE_LAYOUT_STACK_BREAKPOINT_PX = 960;
const MESSAGE_SIDEBAR_STORAGE_KEY = 'aioj_message_sidebar_width';
const MESSAGE_RECENT_EMOJI_STORAGE_KEY = 'aioj_message_recent_emojis';
const MESSAGE_GIF_FAVORITES_STORAGE_KEY = 'aioj_message_gif_favorites';
const MESSAGE_SIDEBAR_MIN_WIDTH_PX = 260;
const MESSAGE_SIDEBAR_MAX_WIDTH_PX = 520;
const MESSAGE_THREAD_MIN_WIDTH_PX = 520;
const MESSAGE_RESIZER_TRACK_PX = 16;
const MESSAGE_IMAGE_PREVIEW_MIN_SCALE = 0.001;
const MESSAGE_IMAGE_PREVIEW_MAX_SCALE = 12;
const MESSAGE_IMAGE_PREVIEW_ZOOM_STEP = 1.18;
const AVATAR_FILE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;
const AVATAR_ACCEPT_ATTRIBUTE = 'image/png,image/jpeg,image/gif,image/webp';
const DRIVE_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const DEFAULT_SIGNATURE = '这只咪很懒，什么也没有留下';
const SIDEBAR_MODE_STORAGE_KEY = 'aioj_sidebar_mode';
const SIDEBAR_MODE_COLLAPSED = 'collapsed';
const SIDEBAR_MODE_EXPANDED = 'expanded';
const MESSAGE_BUILTIN_EMOJIS = [
  // Faces & Expressions
  '😀', '😁', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🫣', '🤭', '🥱', '😴', '🤤', '😪', '😵', '😵‍💫', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🫨', '👀', '👁️', '👄',
  // Hands & Gestures
  '👍', '👎', '👊', '✊', '🤛', '🤜', '🤞', '🫰', '🤘', '🤟', '👌', '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤙', '💪', '🦾', '🙏', '🤝', '👏', '🙌', '👐', '🤲', '✍️', '💅', '🤳', '🫡',
  // Hearts & Symbols
  '❤️', '🩷', '🧡', '💛', '💚', '💙', '🩵', '💜', '🖤', '🩶', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💯', '🔥', '✨', '🌟', '⭐', '💥', '💢', '💫', '💦', '💨', '💬', '💭', '💤', '🌹', '🥀', '🌺',
  // Celebrations & Food
  '🎉', '🎊', '🎈', '🎁', '🎂', '🧁', '🍬', '🍭', '🍫', '🍩', '🍪', '🍺', '🍻', '🥂', '🍷', '🥃', '☕', '🍵', '🥤', '🧋', '🍉', '🍓', '🍒', '🍋', '🍇', '🍉', '🍟', '🍕', '🍔', '🌮', '🍣', '🍙',
  // Tech, Objects & Animals
  '🐱', '🐶', '🐼', '🐨', '🐯', '🦁', '🐰', '🦊', '🐻', '🐒', '🐧', '🐦', '🐣', '🦄', '🐬', '🐋', '🐟', '🐙', '🦋', '💻', '🖥️', '🎮', '📡', '💡', '💰', '🛡️', '🔑', '🚀', '🛸'
];

function unreadDocumentTitlePrefix() {
  const totalUnread = Number(state.notificationUnreadCount || 0) + Number(state.messageUnreadCount || 0);
  return totalUnread > 0 ? `(${totalUnread}) ` : '';
}

function refreshDocumentTitle() {
  document.title = `${unreadDocumentTitlePrefix()}${state.documentTitleBase || 'AIOJ — AI Olympiad Judge'}`;
}

function setPage(title) {
  $('app')?.classList.remove('messages-page');
  $('app')?.classList.remove('drive-page');
  document.body.classList.remove('messages-page-active');
  $('pageTitle').textContent = title || 'AIOJ';
  if ($('pageSubtitle')) {
    $('pageSubtitle').textContent = '';
    $('pageSubtitle').style.display = 'none';
  }
  state.documentTitleBase = title ? `${title} — AIOJ` : 'AIOJ — AI Olympiad Judge';
  refreshDocumentTitle();
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
      clearMessageAttachmentCache();
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
    const err = new Error(detail || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function tryApi(paths, options = {}) {
  let lastErr;
  for (const p of paths) {
    try {
      return await api(p, options);
    } catch (e) {
      lastErr = e;
      if ((e?.status || 0) !== 404) throw e;
    }
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

function safeMdSrc(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const decoded = raw.replaceAll('&amp;', '&');
    if ((decoded.startsWith('/') && !decoded.startsWith('//')) || decoded.startsWith('data:')) return esc(decoded);
    const url = new URL(decoded, window.location.origin);
    if (['http:', 'https:'].includes(url.protocol)) return esc(decoded);
  } catch {
    return '';
  }
  return '';
}

function avatarInitial(name, maxChars = 1) {
  const compact = String(name || '').trim().replace(/\s+/g, '');
  if (!compact) return '?';
  const count = Math.max(1, Number(maxChars) || 1);
  return esc(Array.from(compact).slice(0, count).join('').toUpperCase() || '?');
}

function renderAvatar(name, url = '', className = 'user-avatar', options = {}) {
  const classes = esc(className);
  const src = safeMdSrc(url);
  if (src) {
    const altText = esc(options.alt || `${String(name || '用户').trim() || '用户'}头像`);
    return `<span class="${classes}"><img src="${src}" alt="${altText}" loading="lazy" /></span>`;
  }
  return `<span class="${classes}" aria-hidden="true">${avatarInitial(name, options.initialCount || 1)}</span>`;
}

function userProfilePath(username) {
  const normalized = String(username || '').trim();
  return normalized ? `/users/${encodeURIComponent(normalized)}` : '/account';
}

function displaySignature(value) {
  const signature = String(value || '').trim();
  return signature || DEFAULT_SIGNATURE;
}


function groupNickname(value, fallback = '用户') {
  const nickname = String(
    value?.group_nickname
    || value?.sender_group_nickname
    || value?.current_user_group_nickname
    || value?.nickname
    || ''
  ).trim();
  if (nickname) return nickname;
  const username = String(value?.username || value?.sender_username || fallback || '用户').trim();
  return username || '用户';
}

function contactRemarkName(value) {
  return String(value?.peer_remark_name || value?.remark_name || '').trim();
}

function directContactUsername(value, fallback = '用户') {
  const fallbackName = String(fallback || '').trim();
  const username = String(value?.peer_username || value?.username || value?.sender_username || fallbackName || '').trim();
  return username || fallbackName || '用户';
}

function directContactDisplayName(value, fallback = '用户') {
  return contactRemarkName(value) || directContactUsername(value, fallback);
}

function directContactSubtitle(value) {
  const remark = contactRemarkName(value);
  const username = String(value?.peer_username || value?.username || value?.sender_username || '').trim();
  return [
    remark && username && remark !== username ? `@${username}` : '',
    value?.peer_role || value?.role || 'USER',
    messagePresenceLabel(value),
  ].filter(Boolean).join(' · ');
}

function renderMessageAvatar(name, url = '', extraClass = '', options = {}) {
  const className = ['message-avatar', extraClass].filter(Boolean).join(' ');
  return renderAvatar(name, url, className, options);
}

function openChatUserProfile(event, username) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const normalized = String(username || '').trim();
  if (!normalized) return;
  navigate(userProfilePath(normalized));
}

function handleChatAvatarProfileKeydown(event, username) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  openChatUserProfile(event, username);
}

function renderMessageProfileAvatar(name, url = '', username = '', extraClass = '', options = {}) {
  const normalizedUsername = String(username || '').trim();
  const avatar = renderMessageAvatar(name, url, extraClass, options);
  if (!normalizedUsername) return avatar;
  const titleName = String(name || normalizedUsername).trim() || normalizedUsername;
  return `
    <span
      class="message-avatar-link"
      role="link"
      tabindex="0"
      title="查看 ${esc(titleName)} 的主页"
      onclick="openChatUserProfile(event, ${jsArg(normalizedUsername)})"
      onkeydown="handleChatAvatarProfileKeydown(event, ${jsArg(normalizedUsername)})"
    >${avatar}</span>
  `;
}

function renderConversationAvatar(type, name, url = '', options = {}) {
  if (type === 'group') {
    return `<span class="message-avatar group">${messagePeerInitial(name)}</span>`;
  }
  return renderMessageProfileAvatar(name, url, options.username || name);
}

function isGroupConversationMessage(message) {
  return message?.message_type === 'group' || Number(message?.group_id || 0) > 0;
}

function messageSenderDisplayLabel(message) {
  const mine = Number(message?.sender_id) === Number(state.user?.id || 0);
  if (isGroupConversationMessage(message)) {
    return groupNickname(message, message?.sender_username || '用户');
  }
  return mine ? '我' : (String(message?.sender_remark_name || '').trim() || message?.sender_username || '用户');
}

function messageMetaLabel(message) {
  const timestamp = formatDate(message?.created_at);
  if (!isGroupConversationMessage(message)) {
    return timestamp;
  }
  const username = String(message?.sender_username || '').trim();
  const nickname = String(message?.sender_group_nickname || '').trim();
  if (username && nickname && username !== nickname) {
    return `@${username} · ${timestamp}`;
  }
  return timestamp;
}

function isRecalledMessage(message) {
  return !!message?.is_recalled || !!message?.is_deleted || !!message?.deleted_at;
}

function messageActionWindowOpen(message) {
  const createdAt = Date.parse(message?.created_at || '');
  if (!Number.isFinite(createdAt)) return false;
  return (Date.now() - createdAt) <= MESSAGE_MUTATION_WINDOW_MS;
}

function canEditMessage(message) {
  return Number(message?.sender_id || 0) === Number(state.user?.id || 0)
    && messageActionWindowOpen(message);
}

function canRecallMessage(message) {
  return Number(message?.sender_id || 0) === Number(state.user?.id || 0)
    && !isRecalledMessage(message)
    && messageActionWindowOpen(message);
}

function recallNoticeText(message) {
  if (!message) return '一条消息被撤回';
  const mine = Number(message.sender_id || 0) === Number(state.user?.id || 0);
  return `${mine ? '你' : messageSenderDisplayLabel(message)}撤回了一条消息`;
}

function conversationRecallPreviewText(conversation) {
  if (!conversation?.last_deleted_at) return '';
  const mine = Number(conversation.last_sender_id || 0) === Number(state.user?.id || 0);
  const sender = conversation.conversation_type === 'group'
    ? (conversation.last_sender_group_nickname || conversation.last_sender_username || '成员')
    : directContactDisplayName(conversation, conversation.last_sender_username || '对方');
  return `${mine ? '你' : sender}撤回了一条消息`;
}

function currentThreadMessage(messageId) {
  const target = String(messageId || '').trim();
  return (state.messageThreadItems || []).find((item) => messageActionTargetId(item) === target) || null;
}

function messageActionTargetId(message) {
  return String(message?.local_id || message?.id || '').trim();
}

function transientMessagesForConversation(conversationKey) {
  return state.messageTransientItems.get(parseMessageConversationKey(conversationKey).key) || [];
}

function releaseTransientMessageResources(item) {
  if (item?.attachment_local_url) {
    let isCached = false;
    for (const cached of state.messageAttachmentCache.values()) {
      if (cached.url === item.attachment_local_url) {
        isCached = true;
        break;
      }
    }
    if (!isCached) {
      try {
        URL.revokeObjectURL(item.attachment_local_url);
      } catch {
        // Ignore stale blob URLs during cleanup.
      }
    }
  }
}

function setTransientMessages(conversationKey, items = []) {
  const key = parseMessageConversationKey(conversationKey).key;
  if (!key) return;
  const previous = state.messageTransientItems.get(key) || [];
  const nextIds = new Set(items.map((item) => String(item?.local_id || '')));
  previous.forEach((item) => {
    if (!nextIds.has(String(item?.local_id || ''))) releaseTransientMessageResources(item);
  });
  if (items.length) {
    state.messageTransientItems.set(key, items);
  } else {
    state.messageTransientItems.delete(key);
  }
}

function updateTransientMessage(conversationKey, localId, updater) {
  const key = parseMessageConversationKey(conversationKey).key;
  if (!key) return null;
  const current = transientMessagesForConversation(key);
  const next = current.map((item) => {
    if (String(item?.local_id || '') !== String(localId || '')) return item;
    return typeof updater === 'function' ? updater(item) : { ...item, ...(updater || {}) };
  });
  setTransientMessages(key, next);
  return next.find((item) => String(item?.local_id || '') === String(localId || '')) || null;
}

function removeTransientMessage(conversationKey, localId) {
  const key = parseMessageConversationKey(conversationKey).key;
  if (!key) return;
  const current = transientMessagesForConversation(key);
  setTransientMessages(key, current.filter((item) => String(item?.local_id || '') !== String(localId || '')));
}

function buildTransientMessage({ conversationKey, body = '', files = [], replyTarget = null } = {}) {
  const selectedFiles = normalizeMessageFiles(files);
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const firstFile = selectedFiles[0] || null;
  const contentType = firstFile?.type || '';
  const target = parseMessageConversationKey(conversationKey);
  return {
    local_id: localId,
    local_only: true,
    send_state: 'pending',
    upload_progress: firstFile ? 0 : null,
    conversation_key: target.key,
    message_type: target.type,
    group_id: target.type === 'group' ? Number(target.id) : null,
    sender_id: Number(state.user?.id || 0),
    sender_username: state.user?.username || '我',
    sender_avatar_url: state.user?.avatar_url || '',
    body_md: String(body || ''),
    has_attachment: !!firstFile,
    attachment_id: firstFile ? localId : null,
    attachment_content_type: contentType,
    attachment_filename: firstFile?.name || '',
    attachment_size_bytes: Number(firstFile?.size || 0),
    attachment_local_url: firstFile ? URL.createObjectURL(firstFile) : '',
    created_at: new Date().toISOString(),
    read_at: null,
    edited_at: null,
    deleted_at: null,
    reply_to_message_id: Number(replyTarget?.messageId || 0) || null,
    reply_to_sender_username: replyTarget?.sender || '',
    reply_to_body_md: replyTarget?.body || replyTarget?.attachmentLabel || '',
    reply_to_has_attachment: false,
    reply_to_attachment_filename: '',
    reply_to_attachment_content_type: '',
    retry_payload: {
      body: String(body || ''),
      files: selectedFiles,
      replyTarget,
    },
  };
}

function fileNameFromDataUrl(item, fallback = 'sticker.gif') {
  const name = String(item?.name || '').trim();
  return name || fallback;
}

async function dataUrlToFile(dataUrl, filename = 'sticker.gif') {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || 'image/gif' });
}

function insertComposerText(text) {
  const composer = $('messageComposer');
  if (!composer) return;
  const value = composer.value || '';
  const start = composer.selectionStart ?? value.length;
  const end = composer.selectionEnd ?? value.length;
  const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`;
  if (nextValue.length > Number(composer.maxLength || 4000)) {
    toast('消息内容已达到长度上限', 'warning');
    return;
  }
  composer.value = nextValue;
  const cursor = start + text.length;
  composer.focus({ preventScroll: true });
  composer.setSelectionRange(cursor, cursor);
  saveMessageComposerDraft(currentMessageConversationKey(), composer.value);
}

function isTransientLocalMessage(message) {
  return !!message?.local_only;
}

function isRelativeMdTarget(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('/') || raw.startsWith('data:')) return false;
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw);
}

function problemResourceUrl(problem, resourcePath) {
  const slug = String(problem?.slug || '').trim();
  const normalized = String(resourcePath || '')
    .replace(/^\.?\//, '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
  if (!slug || !normalized) return '';
  return `/api/problems/${encodeURIComponent(slug)}/resource-files/${normalized}`;
}

function rewriteProblemMarkdownAssets(md, problem) {
  const text = String(md || '');
  if (!problem?.slug) return text;
  return text.replace(/(!?\[[^\]]*\])\(([^)]+)\)/g, (match, prefix, target) => {
    if (!isRelativeMdTarget(target)) return match;
    const url = problemResourceUrl(problem, target);
    return url ? `${prefix}(${url})` : match;
  });
}

function jsArg(value) {
  return esc(JSON.stringify(value));
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota failures for optional chat niceties.
  }
}

function storedRecentEmojis() {
  const items = readStoredJson(MESSAGE_RECENT_EMOJI_STORAGE_KEY, []);
  return Array.isArray(items) ? items.filter((item) => typeof item === 'string' && item.trim()) : [];
}

function rememberRecentEmoji(emoji) {
  const value = String(emoji || '').trim();
  if (!value) return;
  const next = [value, ...storedRecentEmojis().filter((item) => item !== value)].slice(0, MESSAGE_RECENT_EMOJI_MAX_ITEMS);
  writeStoredJson(MESSAGE_RECENT_EMOJI_STORAGE_KEY, next);
}

function storedGifFavorites() {
  const items = readStoredJson(MESSAGE_GIF_FAVORITES_STORAGE_KEY, []);
  return Array.isArray(items)
    ? items.filter((item) => item && typeof item.id === 'string' && typeof item.data_url === 'string')
    : [];
}

function saveGifFavorites(items = []) {
  const sliced = items.slice(0, MESSAGE_GIF_FAVORITE_MAX_ITEMS);
  writeStoredJson(MESSAGE_GIF_FAVORITES_STORAGE_KEY, sliced);
  
  if (isChatApp()) {
    const iframe = document.getElementById('storageSyncIframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        action: 'set',
        key: MESSAGE_GIF_FAVORITES_STORAGE_KEY,
        value: JSON.stringify(sliced)
      }, 'https://yxyx.space');
    }
  }
}

// Storage Sync Listener for cross-subdomain local storage sharing
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://yxyx.space' && event.origin !== 'https://www.yxyx.space') return;
  
  const { action, key, value } = event.data || {};
  
  if (action === 'ready') {
    if (isChatApp()) {
      const iframe = document.getElementById('storageSyncIframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          action: 'get',
          key: MESSAGE_GIF_FAVORITES_STORAGE_KEY
        }, 'https://yxyx.space');
      }
    }
  } else if (action === 'get_response' && key === MESSAGE_GIF_FAVORITES_STORAGE_KEY) {
    if (value) {
      try {
        const items = JSON.parse(value);
        if (Array.isArray(items)) {
          localStorage.setItem(MESSAGE_GIF_FAVORITES_STORAGE_KEY, value);
          updateMessageComposerPanel();
        }
      } catch (e) {
        console.error('Failed to parse synchronized GIF favorites:', e);
      }
    }
  }
});

function newGifFavoriteId() {
  return `gif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function messageGifFavoriteSourceKey(message) {
  if (!message?.has_attachment || !isGifMessageAttachment(message)) return '';
  if (isTransientLocalMessage(message)) return `local:${message.local_id || message.attachment_id || ''}`;
  const scope = message.attachment_scope || message.message_type || (message.group_id ? 'group' : 'direct');
  const attachmentId = message.attachment_id || message.id;
  return attachmentId ? `message:${scope === 'group' ? 'group' : 'direct'}:${Number(attachmentId)}` : '';
}

function isGifFavoriteStored({ sourceKey = '', dataUrl = '' } = {}) {
  const normalizedSourceKey = String(sourceKey || '');
  const normalizedDataUrl = String(dataUrl || '');
  return storedGifFavorites().some((item) => (
    (normalizedSourceKey && item.source_key === normalizedSourceKey)
    || (normalizedDataUrl && item.data_url === normalizedDataUrl)
  ));
}

function isGifMessageAttachment(message) {
  return !!message?.has_attachment && isGifAttachment(message.attachment_content_type || '', message.attachment_filename || '');
}

function isMessageGifAlreadyFavorite(message) {
  const sourceKey = messageGifFavoriteSourceKey(message);
  return !!sourceKey && isGifFavoriteStored({ sourceKey });
}

function formatDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  const decimals = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

function configureMarkdownRenderer() {
  if (state.markdownConfigured || !window.marked || typeof window.marked.setOptions !== 'function') return;
  window.marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: false,
    mangle: false,
  });
  state.markdownConfigured = true;
}

function renderLatexToHtml(expr, displayMode = false) {
  const source = String(expr || '').trim();
  if (!source) return '';
  if (window.katex && typeof window.katex.renderToString === 'function') {
    try {
      return window.katex.renderToString(source, {
        displayMode,
        throwOnError: false,
        strict: 'ignore',
        output: 'htmlAndMathml',
      });
    } catch {
      // Fall through to escaped fallback text.
    }
  }
  const wrapped = displayMode ? `$$\n${source}\n$$` : `$${source}$`;
  return `<code class="latex-fallback">${esc(wrapped)}</code>`;
}

function extractMarkdownMath(md) {
  const mathTokens = [];
  const pushMathToken = (expr, displayMode) => {
    const token = `@@AIOJ_MATH_TOKEN_${mathTokens.length}@@`;
    mathTokens.push({ expr, displayMode });
    return token;
  };

  const segments = String(md || '')
    .replace(/\r\n/g, '\n')
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g);

  const prepared = segments.map((segment) => {
    if (segment.startsWith('```') || segment.startsWith('`')) return segment;
    let out = segment;
    out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_, expr) => `\n\n${pushMathToken(expr, true)}\n\n`);
    out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => `\n\n${pushMathToken(expr, true)}\n\n`);
    out = out.replace(
      /(^|\n)\s*(\\begin\{(equation\*?|align\*?|aligned|gather\*?|multline\*?|flalign\*?|split|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix)\}[\s\S]*?\\end\{\3\})/g,
      (match, prefix, expr) => `${prefix}\n\n${pushMathToken(expr, true)}\n\n`,
    );
    out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_, expr) => pushMathToken(expr, false));
    out = out.replace(/(^|[^\\$])\$([^\n$](?:[^$]*?[^\s$])?)\$/g, (match, prefix, expr) => `${prefix}${pushMathToken(expr, false)}`);
    return out;
  }).join('');

  return { prepared, mathTokens };
}

function finalizeMarkdownHtml(html) {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

  doc.body.querySelectorAll('a[href]').forEach((anchor) => {
    const safeHref = safeMdHref(anchor.getAttribute('href'));
    anchor.setAttribute('href', safeHref);
    anchor.classList.add('text-primary');
    anchor.style.textDecoration = 'underline';
    if (!safeHref.startsWith('/') && !safeHref.startsWith('#')) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    } else {
      anchor.removeAttribute('target');
      anchor.removeAttribute('rel');
    }
  });

  doc.body.querySelectorAll('img[src]').forEach((img) => {
    const safeSrc = safeMdSrc(img.getAttribute('src'));
    if (!safeSrc) {
      img.remove();
      return;
    }
    img.setAttribute('src', safeSrc);
    img.setAttribute('loading', 'lazy');
    img.classList.add('md-image');
  });

  doc.body.querySelectorAll('table').forEach((table) => {
    table.classList.add('md-table');
  });

  return doc.body.innerHTML;
}

function restoreMarkdownMath(html, mathTokens) {
  let restored = String(html || '');
  mathTokens.forEach((token, idx) => {
    const placeholder = `@@AIOJ_MATH_TOKEN_${idx}@@`;
    const rendered = renderLatexToHtml(token.expr, token.displayMode);
    const replacement = token.displayMode
      ? `<div class="md-math md-math-block">${rendered}</div>`
      : `<span class="md-math md-math-inline">${rendered}</span>`;

    if (token.displayMode) {
      const wrappedParagraph = new RegExp(`<p>\\s*${escapeRegExp(placeholder)}\\s*</p>`, 'g');
      restored = restored.replace(wrappedParagraph, replacement);
    }
    restored = restored.replaceAll(placeholder, replacement);
  });
  return restored;
}

function renderMd(md) {
  configureMarkdownRenderer();
  const source = String(md || '');

  if (window.marked && typeof window.marked.parse === 'function' && window.DOMPurify) {
    const { prepared, mathTokens } = extractMarkdownMath(source);
    const rawHtml = window.marked.parse(prepared);
    const sanitizedHtml = window.DOMPurify.sanitize(rawHtml);
    const finalizedHtml = finalizeMarkdownHtml(sanitizedHtml);
    return `<div class="md-content">${restoreMarkdownMath(finalizedHtml, mathTokens)}</div>`;
  }

  const fallback = esc(source).replace(/\n/g, '<br>');
  return `<div class="md-content"><p>${fallback}</p></div>`;
}

function problemStatementAssets(problem) {
  const assets = problem && typeof problem.statement_assets === 'object' ? problem.statement_assets : {};
  const markdowns = Array.isArray(assets.markdowns) ? assets.markdowns.filter(item => item && item.content) : [];
  const pdfs = Array.isArray(assets.pdfs) ? assets.pdfs.filter(Boolean) : [];
  const defaultId = assets.default_language || markdowns[0]?.id || pdfs[0]?.id || 'default';
  return { markdowns, pdfs, defaultId };
}

function problemStatementVariantKey(kind, id) {
  return `${kind}:${id}`;
}

function problemStatementVariants(problem = state.currentProblem) {
  const assets = problemStatementAssets(problem);
  const variants = [];
  const seenKeys = new Set();
  const markdownLanguages = new Set();

  assets.markdowns.forEach((item) => {
    const itemId = String(item.id || item.language || 'default');
    const key = problemStatementVariantKey('md', itemId);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    markdownLanguages.add(String(item.language || itemId));
    variants.push({
      key,
      kind: 'markdown',
      itemId,
      language: String(item.language || itemId),
      label: String(item.label || item.language || itemId),
      content: String(item.content || ''),
      source: item,
    });
  });

  assets.pdfs.forEach((item) => {
    const itemId = String(item.id || item.language || 'statement-pdf');
    const key = problemStatementVariantKey('pdf', itemId);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    const language = String(item.language || itemId);
    const hasMarkdown = markdownLanguages.has(language);
    const baseLabel = String(item.label || item.language || itemId);
    variants.push({
      key,
      kind: 'pdf',
      itemId,
      language,
      label: hasMarkdown ? `${baseLabel} · PDF` : baseLabel,
      downloadUrl: String(item.download_url || ''),
      filename: String(item.filename || `${itemId}.pdf`),
      source: item,
    });
  });

  const defaultMarkdown = variants.find(item => item.kind === 'markdown' && item.itemId === assets.defaultId)
    || variants.find(item => item.kind === 'markdown');
  const defaultVariant = defaultMarkdown || variants[0] || null;
  return {
    variants,
    defaultKey: defaultVariant ? defaultVariant.key : '',
  };
}

function problemActiveStatement(problem = state.currentProblem) {
  const { variants, defaultKey } = problemStatementVariants(problem);
  if (variants.length === 0) return null;
  const activeKey = state.activeProblemStatementId || defaultKey;
  return variants.find(item => item.key === activeKey) || variants[0];
}

function statementPdfForLanguage(problem = state.currentProblem, language = '') {
  const assets = problemStatementAssets(problem);
  const target = String(language || '').trim();
  if (!target) return null;
  return assets.pdfs.find(item => String(item.language || item.id || '').trim() === target) || null;
}

function invalidateProblemStatementPdfPreview() {
  state.problemStatementPdfPreviewRequestId += 1;
}

function clearProblemStatementPdfPreviewCache() {
  invalidateProblemStatementPdfPreview();
}

function setProblemStatementPdfStatus(message, tone = 'loading', downloadUrl = '') {
  const status = $('problemStatementPdfStatus');
  if (!status) return;
  if (tone === 'error') {
    status.className = 'notice warning';
    status.innerHTML = `${esc(message)}${downloadUrl ? ` <a href="${esc(downloadUrl)}" target="_blank">新标签打开 PDF</a>` : ''}`;
    status.style.display = '';
    return;
  }
  status.className = 'loading-text';
  status.textContent = message;
  status.style.display = '';
}

async function hydrateProblemStatementPdfPreview(problem = state.currentProblem) {
  const active = problemActiveStatement(problem);
  const frame = $('problemStatementPdfFrame');
  if (!frame || !active || active.kind !== 'pdf' || !active.downloadUrl) return;

  const downloadUrl = String(active.downloadUrl || '').trim();
  if (!downloadUrl) return;

  const requestId = ++state.problemStatementPdfPreviewRequestId;
  frame.onload = null;
  frame.onerror = null;
  frame.hidden = true;
  frame.removeAttribute('src');
  setProblemStatementPdfStatus('正在加载 PDF 页内预览...');
  frame.onload = () => {
    if (requestId !== state.problemStatementPdfPreviewRequestId) return;
    const status = $('problemStatementPdfStatus');
    if (status) status.style.display = 'none';
  };
  frame.onerror = () => {
    if (requestId !== state.problemStatementPdfPreviewRequestId) return;
    frame.hidden = true;
    frame.removeAttribute('src');
    setProblemStatementPdfStatus('页内预览加载失败。', 'error', downloadUrl);
  };
  frame.hidden = false;
  frame.src = `${downloadUrl}#view=FitH`;
}

function renderProblemStatementSwitcher(problem = state.currentProblem) {
  const { variants } = problemStatementVariants(problem);
  if (variants.length <= 1) return '';
  const active = problemActiveStatement(problem);
  return `
    <div class="tabs" id="problemStatementSwitch" style="margin-bottom: var(--space-md); flex-wrap: wrap;">
      ${variants.map(item => `
        <button class="tab ${active && active.key === item.key ? 'active' : ''}" onclick="switchProblemStatement(${jsArg(item.key)})">
          ${esc(item.label)}
        </button>
      `).join('')}
    </div>
  `;
}

function renderProblemStatementActions(problem = state.currentProblem) {
  const actions = [];
  const active = problemActiveStatement(problem);
  const relatedPdf = active?.kind === 'pdf'
    ? active
    : statementPdfForLanguage(problem, active?.language || '');
  if (problem && problem.has_public_resources) {
    actions.push(`
      <a href="/api/problems/${esc(problem.slug)}/resources" target="_blank" class="btn btn-secondary btn-sm">
        公共资源 ZIP
      </a>
    `);
  }
  if (relatedPdf && relatedPdf.downloadUrl) {
    actions.push(`
      <a href="${esc(relatedPdf.downloadUrl)}" target="_blank" class="btn btn-secondary btn-sm">
        打开 PDF
      </a>
    `);
  }
  if (actions.length === 0) return '';
  return `<div class="row gap-sm" style="flex-wrap: wrap; margin-bottom: var(--space-md);">${actions.join('')}</div>`;
}

function renderProblemStatementBody(problem = state.currentProblem) {
  const active = problemActiveStatement(problem);
  if (!active) {
    return emptyBox('该题当前没有可用题面。');
  }
  if (active.kind === 'pdf') {
    if (!active.downloadUrl) {
      return emptyBox('当前语言的 PDF 题面暂不可用。');
    }
    return `
      <div class="statement-viewer">
        <div class="statement-viewer-header">
          <div>
            <div class="statement-viewer-title">${esc(active.label)}</div>
            <div class="statement-viewer-subtitle">当前语言以 PDF 形式提供，支持页内预览。</div>
          </div>
          <a href="${esc(active.downloadUrl)}" target="_blank" class="btn btn-secondary btn-sm">新标签打开</a>
        </div>
        <div id="problemStatementPdfStatus" class="loading-text" style="margin-bottom: var(--space-sm);">正在加载 PDF 页内预览...</div>
        <iframe
          id="problemStatementPdfFrame"
          class="statement-pdf-frame"
          title="${esc(active.label)} PDF"
          loading="lazy"
          hidden
        ></iframe>
      </div>
    `;
  }
  return renderMd(rewriteProblemMarkdownAssets(active.content || '', problem));
}

function switchProblemStatement(statementId) {
  invalidateProblemStatementPdfPreview();
  state.activeProblemStatementId = statementId;
  const switcher = $('problemStatementSwitchWrap');
  if (switcher) switcher.innerHTML = renderProblemStatementSwitcher(state.currentProblem);
  const actions = $('problemStatementActions');
  if (actions) actions.innerHTML = renderProblemStatementActions(state.currentProblem);
  const body = $('problemStatementBody');
  if (body) body.innerHTML = renderProblemStatementBody(state.currentProblem);
  hydrateProblemStatementPdfPreview(state.currentProblem);
}

function problemSampleSubmissionLabel(problem) {
  const name = String(problem?.sample_submission_filename || '').trim();
  if (!name) return '下载示例提交';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  return ext ? `下载示例提交 (${ext})` : `下载示例提交 (${name})`;
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
function openModal({ title, body, footer = '', wide = false, image = false }) {
  destroyMessageImagePreview();
  $('modalTitle').textContent = title || '';
  $('modalBody').innerHTML = body || '';
  $('modalFooter').innerHTML = footer || '';
  const root = $('modalRoot');
  const modal = root.querySelector('.modal');
  modal.classList.toggle('wide', !!wide);
  modal.classList.toggle('image-modal', !!image);
  root.classList.add('open');
}

function closeModal() {
  destroyMessageImagePreview();
  $('modalRoot').classList.remove('open');
  $('modalBody').innerHTML = '';
  $('modalFooter').innerHTML = '';
}

// ─── Navigation & App Shell ────────────────────────────────────────────────
function syncSidebarToggleButton(collapsed) {
  const btn = $('sidebarCollapseBtn');
  if (!btn) return;
  const label = collapsed ? '展开侧边栏' : '收起侧边栏';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', String(collapsed));
  btn.title = label;
}

function setSidebarCollapsed(collapsed, persist = true) {
  const shell = $('appShell');
  if (!shell) return;
  shell.classList.toggle('sidebar-collapsed', collapsed);
  syncSidebarToggleButton(collapsed);
  if (persist) {
    localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, collapsed ? SIDEBAR_MODE_COLLAPSED : SIDEBAR_MODE_EXPANDED);
  }
}

function syncSidebarNavTitles() {
  document.querySelectorAll('.sidebar .nav-link').forEach((link) => {
    const label = link.querySelector('.nav-text')?.textContent?.trim();
    if (label) link.setAttribute('title', label);
  });
}

function initSidebarMode() {
  const savedMode = localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY);
  setSidebarCollapsed(savedMode === SIDEBAR_MODE_COLLAPSED, false);
  syncSidebarNavTitles();

  const btn = $('sidebarCollapseBtn');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const collapsed = !$('appShell').classList.contains('sidebar-collapsed');
    setSidebarCollapsed(collapsed);
    toast(`已${collapsed ? '收起' : '展开'}侧边栏`, 'info');
  });
}

function clearPageState() {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
  clearProblemStatementPdfPreviewCache();
  state.currentProblem = null;
  state.activeProblemStatementId = '';
  destroyMessageLayoutInteractions();
  stopMessageAutoRefresh();
  $('sidebar').classList.remove('open');
  $('sidebarOverlay').classList.remove('open');
}

function stopMessageAutoRefresh(options = {}) {
  stopMessageEventStream();
  if (options.clearTimer && state.messageRefreshTimer) {
    clearInterval(state.messageRefreshTimer);
    state.messageRefreshTimer = null;
  }
  if (state.messageTypingTimer) {
    clearTimeout(state.messageTypingTimer);
    state.messageTypingTimer = null;
  }
  state.messageRefreshInFlight = false;
  state.messageActivePeerId = 0;
  state.messageActiveConversationKey = '';
  state.messageActiveGroup = null;
  state.messageReplyTarget = null;
  state.messageTypingUsers = [];
}

function updateNav() {
  refreshDocumentTitle();
  const path = location.pathname || '/';
  const isHello = isChatApp();
  const isSpace = isDriveHost();
  const cloudLink = $('cloudDriveLink');
  if (cloudLink) {
    cloudLink.href = cloudDriveHref();
  }
  document.querySelectorAll('.nav-link').forEach((a) => {
    const route = a.dataset.route || '/';
    let active;
    if (isHello) {
      active = (route === '/messages');
    } else if (isSpace) {
      active = a.id === 'cloudDriveLink' || route === '/drive';
    } else {
      active = route === '/' ? path === '/' : path.startsWith(route);
    }
    a.classList.toggle('active', active);
  });
  
  const isAdmin = state.user && state.user.role === 'ADMIN';
  $('adminNav').style.display = isAdmin && !isSpace ? '' : 'none';

  const quotaEl = $('cloudDriveQuota');
  if (quotaEl) {
    const quota = state.driveUsage?.quota_bytes
      ? formatBytes(state.driveUsage.quota_bytes).replace(' ', '')
      : (isAdmin ? '20G' : '5G');
    quotaEl.textContent = `(${quota})`;
  }

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

  const profileHomeLink = $('profileHomeLink');
  if (profileHomeLink) {
    profileHomeLink.href = userProfilePath(state.user?.username);
  }

  const userPill = $('userPill');
  if (state.user) {
    userPill.innerHTML = `
      ${renderAvatar(state.user.username, state.user.avatar_url, 'user-avatar')}
      <span class="user-name">${esc(state.user.username)}</span>
      <svg class="dropdown-arrow" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 6px;">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
  }

  const footerEl = $('sidebarUser');
  if (state.user) {
    const profilePath = userProfilePath(state.user.username);
    footerEl.innerHTML = `
      <a class="sidebar-user-link" href="${esc(profilePath)}" data-link title="进入个人主页">
        ${renderAvatar(state.user.username, state.user.avatar_url, 'user-avatar')}
        <div class="sidebar-user-meta" style="flex: 1; min-width: 0;">
        <div style="font-weight: 600; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(state.user.username)}</div>
        <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">${esc(state.user.role)}</div>
        </div>
      </a>
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
    clearMessageAttachmentCache();
    stopMessageAutoRefresh({ clearTimer: true });
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
    ensureMessageAutoRefresh();
    updateNav();
  } catch {
    clearMessageAttachmentCache();
    stopMessageAutoRefresh({ clearTimer: true });
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
        <label for="regEmail">邮箱地址</label>
        <input type="email" id="regEmail" placeholder="email@address.com" autocomplete="email" required />
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
      const email = $('regEmail').value.trim();
      if (!email) {
        throw new Error('请输入邮箱地址。');
      }
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username: $('regUser').value.trim(),
          email,
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
  clearMessageAttachmentCache();
  stopMessageAutoRefresh({ clearTimer: true });
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
    state.currentProblem = problem;
    state.activeProblemStatementId = problemStatementVariants(problem).defaultKey;

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
                <div id="problemStatementSwitchWrap">${renderProblemStatementSwitcher(problem)}</div>
                <div id="problemStatementActions">${renderProblemStatementActions(problem)}</div>
                <div id="problemStatementBody">${renderProblemStatementBody(problem)}</div>
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
              📥 ${esc(problemSampleSubmissionLabel(problem))}
            </a>
            ${problem.has_public_resources ? `
              <a href="/api/problems/${esc(slug)}/resources" target="_blank" class="btn btn-secondary btn-sm full-width mt-sm">
                🗂 下载公共资源包
              </a>
            ` : ''}
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

    hydrateProblemStatementPdfPreview(problem);

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
            <a class="lb-name" href="${esc(userProfilePath(e.username))}" data-link>${esc(e.username)}</a>
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
                      const isSubmittable = p.is_submittable !== false;
                      const isSolved = solvedSlugs.has(p.slug);
                      const isAttempted = attemptedSlugs.has(p.slug);
                      let statusPill = `<span class="pill gray" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px; opacity:0.65;">未尝试</span>`;
                      if (isSolved) {
                        statusPill = `<span class="pill green" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px;">已通过</span>`;
                      } else if (isAttempted) {
                        statusPill = `<span class="pill yellow" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px;">已尝试</span>`;
                      }

                      return `
                        <tr class="${isSubmittable ? 'clickable-row' : ''}" ${isSubmittable ? `onclick="if (!event.target.closest('a') && !event.target.closest('button')) navigate('/contests/${esc(slug)}/problems/${esc(p.slug)}')"` : ''} style="transition: all var(--transition-fast);">
                          <td>
                            ${statusPill}
                          </td>
                          <td>
                            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                              <div style="font-weight: 700; font-size: 15px; color: var(--text-main); font-family: var(--font-display);">${esc(p.title)}</div>
                              ${!isSubmittable ? `<span class="pill red" style="font-size:10.5px; padding: 3px 10px; border-radius: 6px;">无法提交</span>` : ''}
                            </div>
                            <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-top: 4px;">ID: ${esc(p.slug)}</div>
                          </td>
                          <td style="font-family: var(--font-mono); font-size: 12.5px; color: var(--text-secondary);">
                            <div>💚 已通过: <strong>${ps.solved_users || 0}</strong> 人</div>
                            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">📈 提报次数: ${ps.submissions || 0} 次</div>
                          </td>
                          <td style="text-align: right;">
                            ${isSubmittable
                              ? `<a href="/contests/${esc(slug)}/problems/${esc(p.slug)}" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 14px;" data-link>立即挑战 🚀</a>`
                              : `<span class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 14px; opacity: 0.55; pointer-events: none;">无法提交</span>`}
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
            <button class="btn btn-primary w-full" onclick="downloadSubmissionArtifact(${Number(id)}, 'output')">📥 下载预测输出</button>
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
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/i);
    a.download = match?.[1] || (kind === 'source' ? `submission-${id}-source.zip` : `submission-${id}-output.csv`);
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
    ADMIN_BROADCAST: '管理员广播',
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
    if (/^https?:\/\//i.test(link)) {
      window.location.href = link;
      return;
    }
    navigate(link);
  } else if (state.currentRoute === '/notifications') {
    renderNotifications();
  }
}

// ─── Direct Messages ───────────────────────────────────────────────────────
function isImageAttachment(contentType) {
  return String(contentType || '').toLowerCase().startsWith('image/');
}

function isGifAttachment(contentType = '', filename = '') {
  const type = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  return type === 'image/gif' || /\.gif$/i.test(String(filename || '').split(/[?#]/, 1)[0]);
}

function attachmentPreviewLabel(contentType = '', filename = '') {
  if (!contentType && !filename) return '';
  if (isGifAttachment(contentType, filename)) return '[GIF]';
  return isImageAttachment(contentType) ? '[图片]' : '[文件]';
}

function formatFileSize(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeMessageFiles(files) {
  return Array.from(files || []).filter((file) => file && typeof file.size === 'number');
}

function extractMessageFiles(transfer) {
  const directFiles = normalizeMessageFiles(transfer?.files);
  if (directFiles.length) return directFiles;
  return Array.from(transfer?.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

function summarizeMessageFiles(files) {
  const selectedFiles = normalizeMessageFiles(files);
  if (!selectedFiles.length) return '';
  if (selectedFiles.length === 1) {
    const [file] = selectedFiles;
    return `${file.name || '未命名文件'} (${formatFileSize(file.size) || '0 B'})`;
  }
  const totalBytes = selectedFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
  return `已选择 ${selectedFiles.length} 个文件 (${formatFileSize(totalBytes) || '0 B'})`;
}

function getInvalidMessageFile(files) {
  return normalizeMessageFiles(files).find((file) => !isAllowedMessageFile(file));
}

function messageFileValidationError(files) {
  const invalidFile = getInvalidMessageFile(files);
  if (!invalidFile) return '';
  if (invalidFile.size <= 0) return `文件 ${invalidFile.name || '未命名文件'} 为空。`;
  if (invalidFile.size > MESSAGE_FILE_SIZE_LIMIT_BYTES) return `文件 ${invalidFile.name || '未命名文件'} 超过 20 MB。`;
  return '请选择 20 MB 以内的文件。';
}

function setInputFiles(input, files) {
  if (!input) return;
  try {
    const dt = new DataTransfer();
    normalizeMessageFiles(files).forEach((file) => dt.items.add(file));
    input.files = dt.files;
  } catch {
    // Older browsers may not allow synthetic FileList assignment.
  }
}

function bindMessageDropZone(element, onFiles) {
  if (!element) return;
  let dragDepth = 0;
  const show = () => element.classList.add('dragover');
  const hide = () => element.classList.remove('dragover');

  element.addEventListener('dragenter', (event) => {
    const files = extractMessageFiles(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth += 1;
    show();
  });

  element.addEventListener('dragover', (event) => {
    const files = extractMessageFiles(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    show();
  });

  element.addEventListener('dragleave', (event) => {
    if (!event.dataTransfer) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) hide();
  });

  element.addEventListener('drop', (event) => {
    const files = extractMessageFiles(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    hide();
    onFiles(files);
  });
}

function updateMessageUploadProgressDom(localId, progress) {
  const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(String(localId || ''))
    : String(localId || '').replace(/["\\]/g, '\\$&');
  const bar = document.querySelector(`[data-message-upload-progress="${escapedId}"] span`);
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(progress || 0)))}%`;
}

function uploadFormDataWithProgress(url, formData, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    Object.entries(authHeaders()).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== 'function') return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      const contentType = xhr.getResponseHeader('content-type') || '';
      let payload = xhr.responseText || '';
      if (contentType.includes('application/json')) {
        try {
          payload = JSON.parse(xhr.responseText || '{}');
        } catch {
          payload = {};
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
        return;
      }
      reject(new Error(typeof payload === 'object' ? (payload.detail || payload.message || `${xhr.status} ${xhr.statusText}`) : payload || `${xhr.status} ${xhr.statusText}`));
    };
    xhr.onerror = () => reject(new Error('网络连接失败'));
    xhr.onabort = () => reject(new Error('上传已取消'));
    xhr.send(formData);
  });
}

async function compressMessageImageFile(file) {
  const type = String(file?.type || '').toLowerCase();
  if (typeof createImageBitmap !== 'function') return file;
  if (!file || !type.startsWith('image/') || type === 'image/gif' || Number(file.size || 0) < 900 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size < 1.6 * 1024 * 1024) {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86));
    if (!blob || blob.size >= file.size) return file;
    const suffix = type === 'image/png' ? '.png' : '.jpg';
    const baseName = String(file.name || 'image').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}${suffix}`, { type: blob.type || (type === 'image/png' ? 'image/png' : 'image/jpeg') });
  } catch {
    return file;
  }
}

async function uploadMessageFiles({
  conversationType = 'direct',
  recipientId = null,
  recipient = '',
  groupId = null,
  body = '',
  replyToMessageId = null,
  files = [],
  conversationKey = '',
  localId = '',
}) {
  const selectedFiles = await Promise.all(normalizeMessageFiles(files).map(compressMessageImageFile));
  if (!selectedFiles.length) throw new Error('请选择要发送的文件。');

  let lastResponse = null;
  for (const [index, file] of selectedFiles.entries()) {
    const fd = new FormData();
    const reportProgress = (rawProgress) => {
      if (!localId) return;
      const segment = 100 / selectedFiles.length;
      const progress = Math.round((index * segment) + (Number(rawProgress || 0) * segment / 100));
      updateTransientMessage(conversationKey, localId, { upload_progress: progress });
      updateMessageUploadProgressDom(localId, progress);
    };
    if (conversationType === 'group') {
      fd.append('body_md', index === 0 ? body : '');
      if (index === 0 && replyToMessageId) fd.append('reply_to_message_id', String(replyToMessageId));
      fd.append('file', file);
      lastResponse = await uploadFormDataWithProgress(`/api/messages/groups/${Number(groupId)}/files`, fd, { onProgress: reportProgress });
    } else {
      if (recipientId) {
        fd.append('recipient_id', String(recipientId));
      } else {
        fd.append('recipient', recipient);
      }
      fd.append('body_md', index === 0 ? body : '');
      if (index === 0 && replyToMessageId) fd.append('reply_to_message_id', String(replyToMessageId));
      fd.append('file', file);
      lastResponse = await uploadFormDataWithProgress('/api/messages/files', fd, { onProgress: reportProgress });
    }
    reportProgress(100);
  }
  return lastResponse;
}

async function uploadDirectMessageFiles({ recipientId = null, recipient = '', body = '', files = [] }) {
  return uploadMessageFiles({ conversationType: 'direct', recipientId, recipient, body, files });
}

function messagePreview(text, limit = 96, attachmentContentType = '') {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  const attachmentLabel = attachmentPreviewLabel(attachmentContentType);
  if (!value && attachmentLabel) return attachmentLabel;
  if (value && attachmentLabel) return `${attachmentLabel} ${value.length <= limit ? value : `${value.slice(0, limit - 1)}…`}`;
  if (value.length <= limit) return value || '空消息';
  return `${value.slice(0, limit - 1)}…`;
}

function messagePresenceLabel(value = {}) {
  const presence = value.peer_presence || value;
  if (presence?.is_online || value.is_online) return '在线';
  const raw = presence?.last_seen_at || value.last_seen_at || '';
  if (!raw) return '离线';
  return `最后在线 ${formatDate(raw)}`;
}

function messagePeerInitial(name) {
  return avatarInitial(name, 1);
}

function messageConversationKey(type, id) {
  const normalizedType = type === 'group' ? 'group' : 'direct';
  const normalizedId = Number(id || 0);
  return normalizedId ? `${normalizedType}:${normalizedId}` : '';
}

function parseMessageConversationKey(value, fallbackType = 'direct') {
  if (value && typeof value === 'object') {
    const type = value.type || value.conversationType || value.conversation_type || fallbackType;
    const id = value.id || value.group_id || value.groupId || value.peer_id || value.peerId;
    return parseMessageConversationKey(messageConversationKey(type, id), fallbackType);
  }

  if (typeof value === 'string') {
    const raw = value.trim();
    const match = raw.match(/^(direct|group):(\d+)$/);
    if (match) {
      const id = Number(match[2]);
      return { type: match[1], id, key: `${match[1]}:${id}` };
    }
    if (/^\d+$/.test(raw)) {
      const id = Number(raw);
      return { type: fallbackType, id, key: messageConversationKey(fallbackType, id) };
    }
  }

  const id = Number(value || 0);
  if (id) {
    return { type: fallbackType, id, key: messageConversationKey(fallbackType, id) };
  }
  return { type: fallbackType, id: 0, key: '' };
}

function messageConversationItemKey(item) {
  if (!item) return '';
  return item.conversation_key || messageConversationKey(item.conversation_type, item.group_id || item.peer_id);
}

function mergeMessageConversations(primary = [], secondary = []) {
  const merged = [];
  const seen = new Set();
  const push = (item) => {
    const key = messageConversationItemKey(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  };
  (primary || []).forEach(push);
  (secondary || []).forEach(push);
  return merged;
}

function messageConversationFromState() {
  return parseMessageConversationKey(state.messageActiveConversationKey || state.messageActivePeerId || '');
}

function isMessagesActivePath() {
  if (isChatApp()) {
    return true;
  }
  return location.pathname.startsWith('/messages');
}

function messageConversationFromPath(path = location.pathname, { fallbackToState = false } = {}) {
  const isHello = isChatApp();
  if (isHello) {
    let match = String(path || '').match(/^\/groups\/(\d+)$/);
    if (match) return parseMessageConversationKey(`group:${match[1]}`);
    match = String(path || '').match(/^\/(\d+)$/);
    if (match) return parseMessageConversationKey(`direct:${match[1]}`);
  }
  let match = String(path || '').match(/^\/messages\/groups\/(\d+)$/);
  if (match) return parseMessageConversationKey(`group:${match[1]}`);
  match = String(path || '').match(/^\/messages\/(\d+)$/);
  if (match) return parseMessageConversationKey(`direct:${match[1]}`);
  return fallbackToState ? messageConversationFromState() : parseMessageConversationKey('');
}

function currentMessageConversationKey(options = {}) {
  return messageConversationFromPath(location.pathname, options).key;
}

function shouldMarkMessageConversationRead(options = {}) {
  if (typeof options.markRead === 'boolean') return options.markRead;
  return !document.hidden;
}

function setDeferredMessageConversationRead(conversationKey = '', shouldDefer = false) {
  const key = parseMessageConversationKey(conversationKey).key;
  if (!key) {
    state.messageDeferredReadConversationKey = '';
    return;
  }
  if (shouldDefer) {
    state.messageDeferredReadConversationKey = key;
  } else if (state.messageDeferredReadConversationKey === key) {
    state.messageDeferredReadConversationKey = '';
  }
}

function messageConversationPath(target) {
  const parsed = parseMessageConversationKey(target);
  const isHello = isChatApp();
  if (!parsed.id) return isHello ? '/' : '/messages';
  if (isHello) {
    return parsed.type === 'group' ? `/groups/${parsed.id}` : `/${parsed.id}`;
  }
  return parsed.type === 'group' ? `/messages/groups/${parsed.id}` : `/messages/${parsed.id}`;
}

function messageConversationApiPath(target, { beforeId = null, markRead = null } = {}) {
  const parsed = parseMessageConversationKey(target);
  if (!parsed.id) return '';
  const base = parsed.type === 'group'
    ? `/api/messages/groups/${parsed.id}`
    : `/api/messages/conversations/${parsed.id}`;
  const params = new URLSearchParams({ limit: String(MESSAGE_THREAD_PAGE_SIZE) });
  if (beforeId) params.set('before_id', String(beforeId));
  if (typeof markRead === 'boolean') params.set('mark_read', markRead ? '1' : '0');
  return `${base}?${params.toString()}`;
}

function messageConversationListApiPath(limit = 100) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (state.messageConversationSearch) params.set('q', state.messageConversationSearch);
  if (state.messageShowArchived) params.set('include_archived', '1');
  return `/api/messages/conversations?${params.toString()}`;
}

function currentMessagePeerId() {
  const isHello = isChatApp();
  const regex = isHello ? /^\/(\d+)$/ : /^\/messages\/(\d+)$/;
  const match = location.pathname.match(regex);
  return match ? Number(match[1]) : Number(state.messageActivePeerId || 0);
}

function normalizeMessagePeerId(peerId) {
  return Number(peerId || 0);
}

function saveMessageComposerDraft(peerId, value = '') {
  const key = parseMessageConversationKey(peerId).key;
  if (!key) return;
  const draft = String(value || '');
  if (draft) {
    state.messageComposerDrafts.set(key, draft);
  } else {
    state.messageComposerDrafts.delete(key);
  }
}

function clearMessageComposerDraft(peerId) {
  const key = parseMessageConversationKey(peerId).key;
  if (key) state.messageComposerDrafts.delete(key);
}

function captureMessageComposerState() {
  const composer = $('messageComposer');
  if (!composer) return null;
  const value = composer.value || '';
  const key = parseMessageConversationKey(
    composer.dataset.messageComposerKey ||
    composer.dataset.messageComposerPeerId ||
    state.messageActiveConversationKey ||
    state.messageActivePeerId ||
    currentMessageConversationKey(),
  ).key;
  return {
    peerId: parseMessageConversationKey(key).type === 'direct' ? parseMessageConversationKey(key).id : 0,
    conversationKey: key,
    value,
    focused: document.activeElement === composer,
    selectionStart: composer.selectionStart ?? value.length,
    selectionEnd: composer.selectionEnd ?? value.length,
    scrollTop: composer.scrollTop || 0,
  };
}

function restoreMessageComposerState(peerId, snapshot = null, options = {}) {
  const composer = $('messageComposer');
  const key = parseMessageConversationKey(peerId).key;
  if (!composer || !key) return;

  const preserve = options.preserve !== false;
  const snapshotMatches = snapshot && parseMessageConversationKey(snapshot.conversationKey || snapshot.peerId).key === key;
  const value = preserve
    ? (snapshotMatches ? snapshot.value : (state.messageComposerDrafts.get(key) || ''))
    : '';

  composer.value = value || '';
  if (preserve) {
    saveMessageComposerDraft(key, composer.value);
  } else {
    clearMessageComposerDraft(key);
  }

  const fallbackCursor = composer.value.length;
  const selectionStart = snapshotMatches
    ? Math.min(snapshot.selectionStart ?? fallbackCursor, fallbackCursor)
    : fallbackCursor;
  const selectionEnd = snapshotMatches
    ? Math.min(snapshot.selectionEnd ?? selectionStart, fallbackCursor)
    : fallbackCursor;

  composer.setSelectionRange(selectionStart, selectionEnd);
  if (snapshotMatches) composer.scrollTop = snapshot.scrollTop || 0;

  if (options.focus) {
    setTimeout(() => {
      if (!document.body.contains(composer)) return;
      composer.focus({ preventScroll: true });
      composer.setSelectionRange(selectionStart, selectionEnd);
    }, 0);
  }
}

function updateMessageThreadUnreadBadge(count) {
  const badge = $('messageThreadUnreadBadge');
  if (!badge) return;
  const unread = Number(count || 0);
  badge.hidden = unread <= 0;
  badge.textContent = unread > 99 ? '99+' : String(unread);
}

function scrollMessageThreadToBottom() {
  const list = $('messageThreadList');
  if (list) list.scrollTop = list.scrollHeight;
  updateMessageScrollBottomButton(list);
}

function scrollMessageThreadToFirstUnread(messageId = state.messageThreadFirstUnreadId) {
  const list = $('messageThreadList');
  const marker = list?.querySelector(`[data-message-unread-marker-for="${String(messageId || '')}"]`);
  if (!list || !marker) return false;
  const offset = Math.max(0, marker.offsetTop - Math.max(32, Math.round(list.clientHeight * 0.18)));
  list.scrollTop = offset;
  updateMessageScrollBottomButton(list);
  return true;
}

function messageThreadIsNearBottom(list = $('messageThreadList')) {
  return !list || (list.scrollHeight - list.scrollTop - list.clientHeight < 80);
}

function oldestRenderedMessageId(list = $('messageThreadList')) {
  const row = list?.querySelector('[data-server-message-id]');
  const id = Number(row?.dataset.serverMessageId || 0);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function newestRenderedMessageId(list = $('messageThreadList')) {
  const rows = list?.querySelectorAll('[data-server-message-id]');
  const row = rows?.length ? rows[rows.length - 1] : null;
  const id = Number(row?.dataset.serverMessageId || 0);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function renderUnreadDivider(messageId) {
  return `
    <div class="message-unread-divider" data-message-unread-marker-for="${esc(messageId)}">
      <span>以下是新消息</span>
    </div>
  `;
}

function renderMessageHistoryLoader() {
  return `<div class="message-history-loader" data-message-history-loader hidden></div>`;
}

function setMessageHistoryLoader(list, text = '') {
  const loader = list?.querySelector('[data-message-history-loader]');
  if (!loader) return;
  if (!text) {
    loader.hidden = true;
    loader.textContent = '';
    return;
  }
  loader.hidden = false;
  loader.textContent = text;
}

function clearMessageAttachmentCache() {
  for (const entry of state.messageAttachmentCache.values()) {
    if (entry?.url) {
      try {
        URL.revokeObjectURL(entry.url);
      } catch {}
    }
  }
  state.messageAttachmentCache.clear();
  for (const items of state.messageTransientItems.values()) {
    items.forEach(releaseTransientMessageResources);
  }
  state.messageTransientItems.clear();
  void AttachmentDB.clear();
}

function destroyMessageLayoutInteractions() {
  document.body.classList.remove('message-layout-resizing');
  if (typeof state.messageLayoutCleanup === 'function') {
    state.messageLayoutCleanup();
  }
  state.messageLayoutCleanup = null;
}

function readStoredMessageSidebarWidth() {
  const raw = Number(localStorage.getItem(MESSAGE_SIDEBAR_STORAGE_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function clampMessageSidebarWidth(layout, width) {
  const layoutWidth = Number(layout?.clientWidth || 0);
  const safeWidth = Number(width || 0);
  if (!layoutWidth || !safeWidth) return null;
  const maxAllowed = Math.min(
    MESSAGE_SIDEBAR_MAX_WIDTH_PX,
    Math.max(
      MESSAGE_SIDEBAR_MIN_WIDTH_PX,
      layoutWidth - MESSAGE_THREAD_MIN_WIDTH_PX - MESSAGE_RESIZER_TRACK_PX,
    ),
  );
  return Math.max(
    MESSAGE_SIDEBAR_MIN_WIDTH_PX,
    Math.min(maxAllowed, Math.round(safeWidth)),
  );
}

function defaultMessageSidebarWidth(layout) {
  return clampMessageSidebarWidth(layout, Number(layout?.clientWidth || 0) * 0.28) || 320;
}

function applyMessageSidebarWidth(layout, width, { persist = false } = {}) {
  if (!layout || window.innerWidth <= MESSAGE_LAYOUT_STACK_BREAKPOINT_PX) {
    layout?.style?.removeProperty('--message-sidebar-size');
    delete layout?.dataset?.sidebarWidth;
    return null;
  }

  const resolvedWidth = clampMessageSidebarWidth(layout, width || defaultMessageSidebarWidth(layout));
  if (!resolvedWidth) return null;
  layout.style.setProperty('--message-sidebar-size', `${resolvedWidth}px`);
  layout.dataset.sidebarWidth = String(resolvedWidth);
  if (persist) localStorage.setItem(MESSAGE_SIDEBAR_STORAGE_KEY, String(resolvedWidth));
  return resolvedWidth;
}

function resetMessageSidebarWidth(layout) {
  localStorage.removeItem(MESSAGE_SIDEBAR_STORAGE_KEY);
  return applyMessageSidebarWidth(layout, defaultMessageSidebarWidth(layout));
}

function initMessageLayoutInteractions() {
  destroyMessageLayoutInteractions();

  const app = $('app');
  const layout = app?.querySelector('.messages-layout');
  const resizer = app?.querySelector('[data-message-layout-resizer]');
  if (!app || !layout || !resizer) return;

  const syncLayout = () => {
    if (window.innerWidth <= MESSAGE_LAYOUT_STACK_BREAKPOINT_PX) {
      layout.style.removeProperty('--message-sidebar-size');
      delete layout.dataset.sidebarWidth;
      resizer.tabIndex = -1;
      resizer.setAttribute('aria-hidden', 'true');
      return;
    }

    resizer.tabIndex = 0;
    resizer.removeAttribute('aria-hidden');
    const currentWidth = Number(layout.dataset.sidebarWidth || 0);
    const targetWidth = currentWidth || readStoredMessageSidebarWidth() || defaultMessageSidebarWidth(layout);
    const appliedWidth = applyMessageSidebarWidth(layout, targetWidth);
    if (appliedWidth) {
      resizer.setAttribute('aria-valuenow', String(appliedWidth));
    }
  };

  let activePointerId = null;
  let dragStartX = 0;
  let dragStartWidth = 0;

  const stopDrag = () => {
    activePointerId = null;
    document.body.classList.remove('message-layout-resizing');
    resizer.classList.remove('is-dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };

  const onPointerMove = (event) => {
    if (event.pointerId !== activePointerId) return;
    const resolvedWidth = applyMessageSidebarWidth(layout, dragStartWidth + event.clientX - dragStartX);
    if (resolvedWidth) resizer.setAttribute('aria-valuenow', String(resolvedWidth));
  };

  const onPointerUp = (event) => {
    if (event.pointerId !== activePointerId) return;
    const resolvedWidth = Number(layout.dataset.sidebarWidth || 0);
    if (resolvedWidth > 0) {
      localStorage.setItem(MESSAGE_SIDEBAR_STORAGE_KEY, String(resolvedWidth));
      resizer.setAttribute('aria-valuenow', String(resolvedWidth));
    }
    stopDrag();
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || window.innerWidth <= MESSAGE_LAYOUT_STACK_BREAKPOINT_PX) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartWidth = Number(layout.dataset.sidebarWidth || readStoredMessageSidebarWidth() || defaultMessageSidebarWidth(layout));
    document.body.classList.add('message-layout-resizing');
    resizer.classList.add('is-dragging');
    resizer.setAttribute('aria-valuenow', String(dragStartWidth));
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const onKeyDown = (event) => {
    if (window.innerWidth <= MESSAGE_LAYOUT_STACK_BREAKPOINT_PX) return;
    const currentWidth = Number(layout.dataset.sidebarWidth || readStoredMessageSidebarWidth() || defaultMessageSidebarWidth(layout));
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' ? -24 : 24;
      const resolvedWidth = applyMessageSidebarWidth(layout, currentWidth + delta, { persist: true });
      if (resolvedWidth) resizer.setAttribute('aria-valuenow', String(resolvedWidth));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      const resolvedWidth = applyMessageSidebarWidth(layout, MESSAGE_SIDEBAR_MIN_WIDTH_PX, { persist: true });
      if (resolvedWidth) resizer.setAttribute('aria-valuenow', String(resolvedWidth));
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      const resolvedWidth = applyMessageSidebarWidth(layout, MESSAGE_SIDEBAR_MAX_WIDTH_PX, { persist: true });
      if (resolvedWidth) resizer.setAttribute('aria-valuenow', String(resolvedWidth));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const resolvedWidth = resetMessageSidebarWidth(layout);
      if (resolvedWidth) resizer.setAttribute('aria-valuenow', String(resolvedWidth));
    }
  };

  const onDoubleClick = () => {
    const resolvedWidth = resetMessageSidebarWidth(layout);
    if (resolvedWidth) resizer.setAttribute('aria-valuenow', String(resolvedWidth));
  };

  syncLayout();
  window.addEventListener('resize', syncLayout);
  resizer.addEventListener('pointerdown', onPointerDown);
  resizer.addEventListener('keydown', onKeyDown);
  resizer.addEventListener('dblclick', onDoubleClick);

  state.messageLayoutCleanup = () => {
    stopDrag();
    window.removeEventListener('resize', syncLayout);
    resizer.removeEventListener('pointerdown', onPointerDown);
    resizer.removeEventListener('keydown', onKeyDown);
    resizer.removeEventListener('dblclick', onDoubleClick);
  };
}

const AttachmentDB = {
  dbName: 'aioj_attachments_cache',
  storeName: 'attachments',
  version: 1,

  _getDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  async get(key) {
    try {
      const db = await this._getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB get failed:', err);
      return null;
    }
  },

  async set(key, blob) {
    try {
      const db = await this._getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const req = store.put(blob, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB set failed:', err);
    }
  },

  async clear() {
    try {
      const db = await this._getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB clear failed:', err);
    }
  }
};

function normalizeMessageAttachmentTarget(scopeOrId, maybeId = null) {
  if (maybeId == null) {
    return { scope: 'direct', id: Number(scopeOrId || 0), key: messageAttachmentCacheKey('direct', scopeOrId) };
  }
  const scope = scopeOrId === 'group' ? 'group' : 'direct';
  const id = Number(maybeId || 0);
  return { scope, id, key: messageAttachmentCacheKey(scope, id) };
}

function messageAttachmentCacheKey(scope, attachmentId) {
  const normalizedScope = scope === 'group' ? 'group' : 'direct';
  return `${normalizedScope}:${Number(attachmentId || 0)}`;
}

function getMessageAttachmentCacheEntry(scopeOrId, maybeId = null) {
  const target = normalizeMessageAttachmentTarget(scopeOrId, maybeId);
  if (!target.id) return null;
  return state.messageAttachmentCache.get(target.key) || null;
}

function messageAttachmentUrlPath(scope, attachmentId) {
  return scope === 'group'
    ? `/api/messages/group-messages/${Number(attachmentId)}/attachment`
    : `/api/messages/${Number(attachmentId)}/attachment`;
}

async function loadMessageAttachmentUrl(scopeOrId, maybeId = null) {
  const target = normalizeMessageAttachmentTarget(scopeOrId, maybeId);
  if (!target.id) throw new Error('Missing attachment id');

  const cached = getMessageAttachmentCacheEntry(target.scope, target.id);
  if (cached?.url) return cached.url;
  if (cached?.promise) return cached.promise;

  const promise = (async () => {
    // Check IndexedDB cache first
    const cachedBlob = await AttachmentDB.get(target.key);
    if (cachedBlob) {
      const url = URL.createObjectURL(cachedBlob);
      state.messageAttachmentCache.set(target.key, { url });
      return url;
    }

    // Otherwise fetch from server
    const res = await fetch(messageAttachmentUrlPath(target.scope, target.id), { headers: authHeaders() });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const blob = await res.blob();
    
    // Save to IndexedDB cache
    void AttachmentDB.set(target.key, blob);

    const url = URL.createObjectURL(blob);
    state.messageAttachmentCache.set(target.key, { url });
    return url;
  })();

  state.messageAttachmentCache.set(target.key, { promise });

  try {
    return await promise;
  } catch (err) {
    if (state.messageAttachmentCache.get(target.key)?.promise === promise) {
      state.messageAttachmentCache.delete(target.key);
    }
    throw err;
  }
}

function waitForImageReady(img) {
  if (!img) return Promise.resolve();
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Image load failed'));
    };
    const cleanup = () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
    };
    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onError, { once: true });
  });
}

function renderMessageConversationEmpty() {
  return `
    <div class="message-empty-panel">
      <div class="empty-icon">✉</div>
      <div class="text-muted" style="font-size: 13px;">${state.messageConversationSearch ? '没有匹配的会话' : '暂无会话'}</div>
      <div class="row gap-sm mt-md" style="flex-wrap: wrap; justify-content: center;">
        <button class="btn btn-secondary btn-sm" onclick="showCreateMessageGroupModal()">新建群聊</button>
        <button class="btn btn-primary btn-sm" onclick="showNewMessageModal()">开始私信</button>
      </div>
    </div>
  `;
}

function renderMessageConversationButton(c, selectedKey = '') {
  const conversationType = c.conversation_type === 'group' ? 'group' : 'direct';
  const conversationId = conversationType === 'group' ? c.group_id : c.peer_id;
  const conversationKey = c.conversation_key || messageConversationKey(conversationType, conversationId);
  const active = conversationKey === selectedKey;
  const incoming = Number(c.last_sender_id) !== Number(state.user?.id || 0);
  const unread = Number(c.unread_count || 0);
  const title = conversationType === 'group' ? c.group_name : directContactDisplayName(c, c.peer_username);
  const subtitle = conversationType === 'group'
    ? `${Number(c.group_member_count || 0)} 位成员`
    : directContactSubtitle(c);
  const stateBits = [c.is_pinned ? 'PIN' : '', c.is_muted ? 'MUTE' : '', c.is_archived ? 'ARCH' : ''].filter(Boolean).join(' · ');
  const previewPrefix = c.last_deleted_at
    ? ''
    : c.last_message_id
    ? (conversationType === 'group'
      ? (incoming ? `${c.last_sender_group_nickname || c.last_sender_username || '成员'}：` : '我：')
      : (incoming ? '' : '我：'))
    : '';
  const previewText = c.last_deleted_at
    ? conversationRecallPreviewText(c)
    : c.last_message_id
    ? messagePreview(c.last_body_md, 96, c.last_attachment_content_type || (c.last_has_attachment ? 'application/octet-stream' : ''))
    : (conversationType === 'group' ? '群聊已创建' : '空消息');

  return `
    <button class="message-conversation ${active ? 'active' : ''}" data-message-conversation-key="${esc(conversationKey)}" onclick="openMessageConversation(${jsArg(conversationKey)})">
      ${renderConversationAvatar(conversationType, title, c.peer_avatar_url, { username: conversationType === 'direct' ? c.peer_username : '' })}
      <span class="message-conversation-body">
        <span class="message-conversation-top">
          <strong>${esc(title)}</strong>
          <span>${formatDate(c.last_created_at || c.sort_at)}</span>
        </span>
        <span class="message-conversation-subtitle">${esc(subtitle)}${stateBits ? ` · ${esc(stateBits)}` : ''}</span>
        <span class="message-preview">
          ${esc(previewPrefix)}${esc(previewText)}
        </span>
      </span>
      ${unread > 0 ? `<span class="message-unread-dot">${unread > 99 ? '99+' : unread}</span>` : ''}
    </button>
  `;
}

function renderMessageConversationItems(conversations = [], selectedKey = '') {
  return conversations.length
    ? conversations.map((c) => renderMessageConversationButton(c, selectedKey)).join('')
    : renderMessageConversationEmpty();
}

function updateMessageConversationSidebar(conversations = [], selectedKey = currentMessageConversationKey()) {
  const container = $('messageConversationItems');
  if (!container) return;
  const key = parseMessageConversationKey(selectedKey).key;
  container.dataset.messageSelectedConversationKey = key;
  container.innerHTML = renderMessageConversationItems(conversations, key);
  const loadMoreBtn = $('messageLoadMoreConversationsBtn');
  if (loadMoreBtn) loadMoreBtn.hidden = !state.messageConversationHasMore;
}

async function loadMoreMessageConversations() {
  const btn = $('messageLoadMoreConversationsBtn');
  const container = $('messageConversationItems');
  if (!container || !state.messageConversationHasMore) return;
  const previousText = btn?.textContent || '';
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '加载中...';
    }
    const data = await ChatApi.listConversations({
      limit: MESSAGE_CONVERSATION_PAGE_SIZE,
      offset: Number(state.messageConversationNextOffset || 0),
      query: state.messageConversationSearch,
      includeArchived: state.messageShowArchived,
    });
    const items = data.items || [];
    const selectedKey = container.dataset.messageSelectedConversationKey || currentMessageConversationKey();
    state.messageConversations = mergeMessageConversations(state.messageConversations, items);
    updateMessageConversationSidebar(state.messageConversations, selectedKey);
    state.messageConversationHasMore = !!data.has_more;
    state.messageConversationNextOffset = Number(data.next_offset || (Number(state.messageConversationNextOffset || 0) + items.length));
    if (btn) btn.hidden = !state.messageConversationHasMore;
  } catch (err) {
    toast(`加载会话失败: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = previousText || '加载更多会话';
    }
  }
}

function stopMessageEventStream() {
  if (state.messageEventAbortController) {
    state.messageEventAbortController.abort();
    state.messageEventAbortController = null;
  }
}

function parseSseEventBlock(block = '') {
  const event = { type: 'message', data: '' };
  String(block || '').split(/\r?\n/).forEach((line) => {
    if (line.startsWith('event:')) {
      event.type = line.slice(6).trim() || 'message';
      return;
    }
    if (line.startsWith('data:')) {
      event.data += `${line.slice(5).trim()}\n`;
    }
  });
  event.data = event.data.trim();
  return event;
}

function updateMessageTypingIndicator(users = []) {
  const indicator = $('messageTypingIndicator');
  if (!indicator) return;
  const names = (users || []).map((item) => item.username || item.group_nickname || '').filter(Boolean);
  if (!names.length) {
    indicator.hidden = true;
    indicator.textContent = '';
    return;
  }
  indicator.hidden = false;
  indicator.textContent = `${names.slice(0, 3).join('、')} 正在输入...`;
}

function handleMessageRealtimeState(payload = {}) {
  const unread = payload.unread || {};
  if (Number.isFinite(Number(unread.unread_count))) {
    state.messageUnreadCount = Number(unread.unread_count || 0);
    updateNav();
  }
  state.messageTypingUsers = payload.activity?.typing || [];
  updateMessageTypingIndicator(state.messageTypingUsers);

  const signature = JSON.stringify(payload.activity || {});
  const now = Date.now();
  const changed = signature && signature !== state.messageEventSignature;
  state.messageEventSignature = signature || state.messageEventSignature;
  if (!changed || now - Number(state.messageEventLastRefreshAt || 0) < MESSAGE_EVENT_REFRESH_DEBOUNCE_MS) return;
  state.messageEventLastRefreshAt = now;

  if (isMessagesActivePath()) {
    void pollMessageUnreadState();
  }
}

async function startMessageEventStream() {
  if (!state.user || state.messageEventAbortController || !isMessagesActivePath()) return;
  const parsed = messageConversationFromPath(location.pathname, { fallbackToState: true });
  const controller = new AbortController();
  state.messageEventAbortController = controller;

  try {
    const response = await fetch(ChatApi.messageEvents({
      conversationType: parsed.id ? parsed.type : '',
      conversationId: parsed.id || 0,
    }), {
      headers: authHeaders(),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`${response.status} ${response.statusText}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!controller.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || '';
      parts.forEach((part) => {
        const event = parseSseEventBlock(part);
        if (event.type !== 'message-state' || !event.data) return;
        try {
          handleMessageRealtimeState(JSON.parse(event.data));
        } catch {
          // Ignore malformed transient events; the polling fallback will catch up.
        }
      });
    }
  } catch {
    // The interval fallback below remains active for browsers or proxies that block streaming.
  } finally {
    if (state.messageEventAbortController === controller) {
      state.messageEventAbortController = null;
    }
  }
}

async function pollMessageUnreadState() {
  const [countData, conversationData] = await Promise.all([
    api('/api/messages/unread-count', { headers: authHeaders() }),
    ChatApi.listConversations({
      limit: MESSAGE_CONVERSATION_PAGE_SIZE,
      query: state.messageConversationSearch,
      includeArchived: state.messageShowArchived,
    }),
  ]);

  state.messageUnreadCount = Number(countData.unread_count || 0);
  updateNav();

  const conversationKey = currentMessageConversationKey();
  const incomingConversations = conversationData.items || [];
  const hadLoadedAdditionalConversations = state.messageConversations.length > incomingConversations.length;
  const hadReachedConversationEnd = !state.messageConversationHasMore;
  const conversations = mergeMessageConversations(incomingConversations, state.messageConversations);
  state.messageConversations = conversations;
  state.messageConversationHasMore = hadLoadedAdditionalConversations && hadReachedConversationEnd
    ? false
    : !!conversationData.has_more;
  state.messageConversationNextOffset = hadLoadedAdditionalConversations
    ? Math.max(Number(state.messageConversationNextOffset || 0), conversations.length, Number(conversationData.next_offset || 0))
    : Number(conversationData.next_offset || conversations.length || 0);
  updateMessageConversationSidebar(conversations, conversationKey);
  if (!conversationKey) return;
  const active = conversations.find(c => (c.conversation_key || messageConversationKey(c.conversation_type, c.group_id || c.peer_id)) === conversationKey);
  const activeUnreadCount = Number(active?.unread_count || 0);
  if (document.hidden) {
    setDeferredMessageConversationRead(conversationKey, activeUnreadCount > 0);
    updateMessageThreadUnreadBadge(activeUnreadCount);
    return;
  }
  if (state.messageDeferredReadConversationKey === conversationKey && activeUnreadCount > 0) {
    await refreshMessages(conversationKey, {
      preserveComposer: true,
      focusComposer: false,
      scrollToBottom: false,
      markRead: true,
    });
    updateMessageThreadUnreadBadge(0);
    return;
  }
  const list = $('messageThreadList');
  const currentNewestId = newestRenderedMessageId(list);
  const currentNewestMessage = currentThreadMessage(currentNewestId);
  const nextNewestId = Number(active?.last_message_id || 0);
  const activeSummaryChanged = !!active && nextNewestId === currentNewestId && (
    String(active?.last_deleted_at || '') !== String(currentNewestMessage?.deleted_at || '')
    || String(active?.last_body_md || '') !== String(currentNewestMessage?.body_md || '')
    || String(active?.last_attachment_filename || '') !== String(currentNewestMessage?.attachment_filename || '')
    || Boolean(active?.last_has_attachment) !== Boolean(currentNewestMessage?.has_attachment)
  );
  const shouldRefreshThread = !!active && (
    (nextNewestId > currentNewestId && (messageThreadIsNearBottom(list) || Number(active?.last_sender_id) === Number(state.user?.id || 0)))
    || activeSummaryChanged
  );
  if (shouldRefreshThread) {
    await refreshMessages(conversationKey, {
      preserveComposer: true,
      focusComposer: false,
      scrollToBottom: true,
      markRead: true,
    });
    updateMessageThreadUnreadBadge(0);
    return;
  }
  updateMessageThreadUnreadBadge(activeUnreadCount);
}

function ensureMessageAutoRefresh() {
  if (isMessagesActivePath()) {
    void startMessageEventStream();
  } else {
    stopMessageEventStream();
  }
  if (state.messageRefreshTimer) return;
  state.messageRefreshTimer = setInterval(async () => {
    if (!state.user) {
      stopMessageAutoRefresh({ clearTimer: true });
      return;
    }
    if (state.messageRefreshInFlight) return;

    state.messageRefreshInFlight = true;
    try {
      if (isMessagesActivePath()) {
        await pollMessageUnreadState();
      } else {
        await Promise.allSettled([refreshNotificationCount(), refreshMessageCount()]);
      }
    } catch {
      // Keep the timer quiet; normal navigation or manual actions will surface errors.
    } finally {
      state.messageRefreshInFlight = false;
    }
  }, MESSAGE_REFRESH_INTERVAL_MS);
}

async function renderMessages(target = null, options = {}) {
  setPage('聊天');
  document.body.classList.add('messages-page-active');
  closeMessageActionMenu();
  const app = $('app');
  app.classList.add('messages-page');
  if (!state.user) {
    app.innerHTML = `<div class="notice info">请先 <button class="btn btn-secondary btn-sm" onclick="showAuthModal()">登录账户</button> 使用聊天。</div>`;
    return;
  }

  const layoutPresent = !!app.querySelector('.messages-layout');
  const silent = !!options.silent || layoutPresent;
  const composerSnapshot = captureMessageComposerState();
  if (composerSnapshot && options.preserveComposer !== false) {
    saveMessageComposerDraft(composerSnapshot.conversationKey || composerSnapshot.peerId, composerSnapshot.value);
  }
  if (!silent) {
    app.innerHTML = `
      <div class="loading-overlay">
        <div class="spinner-ring"></div>
        <span class="loading-text">正在同步聊天会话...</span>
      </div>
    `;
  }

  try {
    let conversations = [];
    if (options.localOnly && state.messageConversations) {
      conversations = state.messageConversations;
    } else {
      const conversationData = await ChatApi.listConversations({
        limit: MESSAGE_CONVERSATION_PAGE_SIZE,
        query: state.messageConversationSearch,
        includeArchived: state.messageShowArchived,
      });
      conversations = conversationData.items || [];
      state.messageConversations = conversations;
      state.messageConversationHasMore = !!conversationData.has_more;
      state.messageConversationNextOffset = Number(conversationData.next_offset || conversations.length || 0);
    }

    const requested = target ? parseMessageConversationKey(target) : messageConversationFromPath();
    const hasExplicitSelection = !!target || (
      isChatApp()
        ? /^\/(?:groups\/)?\d+$/.test(location.pathname || '')
        : /^\/messages\/(?:groups\/\d+|\d+)$/.test(location.pathname || '')
    );
    const selectedKey = requested.key || (hasExplicitSelection ? (
      conversations[0]?.conversation_key ||
      messageConversationKey(conversations[0]?.conversation_type, conversations[0]?.group_id || conversations[0]?.peer_id)
    ) : '') || '';
    const selected = parseMessageConversationKey(selectedKey);
    if (selected.key !== state.messageActiveConversationKey) {
      stopMessageEventStream();
      state.messageEventSignature = '';
    }
    let thread = null;
    const shouldMarkRead = !!selected.id && shouldMarkMessageConversationRead(options);

    if (selected.id) {
      if (options.localOnly && state.messageServerThreadItems) {
        // use local
      } else {
        thread = await api(messageConversationApiPath(selected.key, { markRead: shouldMarkRead }), { headers: authHeaders() });
        state.messageServerThreadItems = thread?.items || [];
        state.messageThreadHasMore = !!thread?.has_more;
        state.messageThreadFirstUnreadId = Number(thread?.first_unread_message_id || 0);
        if (shouldMarkRead) {
          conversations.forEach((item) => {
            const itemKey = item.conversation_key || messageConversationKey(item.conversation_type, item.group_id || item.peer_id);
            if (itemKey === selected.key) item.unread_count = 0;
          });
          setDeferredMessageConversationRead(selected.key, false);
          await refreshMessageCount();
        }
      }
    }

    const activeConversationSummary = conversations.find((item) => {
      const itemKey = item.conversation_key || messageConversationKey(item.conversation_type, item.group_id || item.peer_id);
      return itemKey === selected.key;
    });
    const activeConversation = thread?.peer || thread?.group || activeConversationSummary;
    const activeUnreadCount = Number(activeConversationSummary?.unread_count || 0);
    setDeferredMessageConversationRead(
      selected.key,
      !!selected.id && !shouldMarkRead && (activeUnreadCount > 0 || (thread ? Number(thread.first_unread_message_id || 0) : state.messageThreadFirstUnreadId) > 0),
    );
    const threadItems = state.messageServerThreadItems || [];
    const combinedThreadItems = [...threadItems, ...transientMessagesForConversation(selected.key)];
    state.messageThreadItems = combinedThreadItems;

    const isSameConversation = (selected.key === state.messageActiveConversationKey);

    if (layoutPresent && isSameConversation) {
      const convList = $('messageConversationItems');
      if (convList) {
        convList.innerHTML = renderMessageConversationItems(conversations, selected.key);
      }
      const toggleArchivedBtn = app.querySelector('.message-conversation-list button[onclick="toggleMessageArchivedFilter()"]');
      if (toggleArchivedBtn) {
        toggleArchivedBtn.textContent = state.messageShowArchived ? '隐藏归档' : '显示归档';
      }
      const loadMoreBtn = $('messageLoadMoreConversationsBtn');
      if (loadMoreBtn) {
        loadMoreBtn.hidden = !state.messageConversationHasMore;
      }
      const threadPanel = app.querySelector('.message-thread-panel');
      const list = $('messageThreadList');
      if (selected.id && activeConversation && threadPanel && list) {
        const badge = $('messageThreadUnreadBadge');
        if (badge) {
          const count = shouldMarkRead ? 0 : activeUnreadCount;
          badge.textContent = String(count);
          badge.hidden = count <= 0;
        }
        list.innerHTML = renderMessageHistoryLoader() + (combinedThreadItems.length === 0 ? `
          <div class="message-empty-panel">
            <div class="empty-icon">✉</div>
            <div class="text-muted" style="font-size: 13px;">还没有消息，发送第一条${selected.type === 'group' ? '群聊消息' : '私信'}。</div>
          </div>
        ` : renderMessageRows(combinedThreadItems, { firstUnreadMessageId: state.messageThreadFirstUnreadId }));
      } else if (threadPanel) {
        threadPanel.innerHTML = selected.id && activeConversation ? renderMessageThread(activeConversation, combinedThreadItems, {
          hasMore: state.messageThreadHasMore,
          conversationType: selected.type,
          firstUnreadMessageId: state.messageThreadFirstUnreadId,
        }) : `
          <div class="message-empty-panel">
            <div class="empty-icon">✉</div>
            <div class="text-muted" style="font-size: 13px;">选择一个会话，或新建私信/群聊。</div>
          </div>
        `;
      }
    } else {
      app.innerHTML = `
        <div class="row flex-between mb-lg" style="flex-wrap: wrap; align-items: center; gap: var(--space-md);">
          <div>
            <h3 class="section-title">聊天</h3>
            <div class="text-muted" style="font-size: 13px;">支持站内私聊和群聊，打开会话后会标记已读；置顶、归档、静音与拉黑会即时生效。</div>
          </div>
          <div class="row gap-sm" style="flex-wrap: wrap;">
            <button class="btn btn-secondary" onclick="showMessagePreferencesModal()">聊天设置</button>
            <button class="btn btn-secondary" onclick="showMessageFavoritesModal()">收藏</button>
            <button class="btn btn-secondary" onclick="showJoinGroupInviteModal()">邀请码</button>
            ${state.user?.role === 'ADMIN' ? '<button class="btn btn-secondary" onclick="showAdminMessageReportsModal()">举报队列</button>' : ''}
            <button class="btn btn-secondary" onclick="showMessageBlocksModal()">拉黑名单</button>
            <button class="btn btn-secondary" onclick="showCreateMessageGroupModal()">新建群聊</button>
            <button class="btn btn-primary" onclick="showNewMessageModal()">写私信</button>
          </div>
        </div>

        <div class="messages-layout">
          <aside class="message-conversation-list">
            <div class="row gap-sm mb-md" style="align-items: center; flex-wrap: wrap;">
              <input
                type="search"
                value="${esc(state.messageConversationSearch)}"
                placeholder="搜索会话"
                style="flex: 1 1 180px;"
                oninput="setMessageConversationSearch(this.value)"
              />
              <button class="btn btn-secondary btn-sm" type="button" onclick="toggleMessageArchivedFilter()">
                ${state.messageShowArchived ? '隐藏归档' : '显示归档'}
              </button>
            </div>
            <div id="messageConversationItems" data-message-selected-conversation-key="${esc(selected.key)}">
              ${renderMessageConversationItems(conversations, selected.key)}
            </div>
            <button
              class="btn btn-secondary btn-sm message-load-more-conversations"
              id="messageLoadMoreConversationsBtn"
              type="button"
              onclick="loadMoreMessageConversations()"
              ${state.messageConversationHasMore ? '' : 'hidden'}
            >加载更多会话</button>
          </aside>

          <div
            class="message-layout-resizer"
            data-message-layout-resizer
            role="separator"
            aria-label="调整会话列表宽度"
            aria-orientation="vertical"
            tabindex="0"
            title="拖动调整会话列表宽度，双击恢复默认宽度"
          ></div>

          <section class="message-thread-panel">
            ${selected.id && activeConversation ? renderMessageThread(activeConversation, combinedThreadItems, {
              hasMore: state.messageThreadHasMore,
              conversationType: selected.type,
              firstUnreadMessageId: state.messageThreadFirstUnreadId,
            }) : `
              <div class="message-empty-panel">
                <div class="empty-icon">✉</div>
                <div class="text-muted" style="font-size: 13px;">选择一个会话，或新建私信/群聊。</div>
              </div>
            `}
          </section>
        </div>
      `;
      initMessageLayoutInteractions();
    }

    if (selected.id && activeConversation) {
      if (!layoutPresent || !isSameConversation) {
        initMessageThreadPagination(selected.key, state.messageThreadHasMore);
        initMessageComposerInteractions(selected.key);
      }
      updateMessageTypingIndicator(state.messageTypingUsers);
      if (!layoutPresent || !isSameConversation) {
        restoreMessageComposerState(selected.key, composerSnapshot, {
          preserve: options.preserveComposer !== false,
          focus: !!options.focusComposer || (
            !!composerSnapshot?.focused &&
            parseMessageConversationKey(composerSnapshot.conversationKey || composerSnapshot.peerId).key === selected.key
          ),
        });
      } else if (options.focusComposer) {
        const comp = $('messageComposer');
        if (comp) comp.focus();
      }
    }
    state.messageActiveConversationKey = selected.key;
    state.messageActivePeerId = selected.type === 'direct' ? selected.id : 0;
    state.messageActiveGroup = selected.type === 'group' ? activeConversation : null;
    if (!selected.id) {
      state.messageThreadItems = [];
      state.messageThreadFirstUnreadId = 0;
    }
    if (!selected.key) state.messageReplyTarget = null;
    updateMessageReplyBanner();

    updateMessageThreadUnreadBadge(shouldMarkRead ? 0 : activeUnreadCount);
    if (selected.id && activeConversation) {
      const scrolledToUnread = state.messageThreadFirstUnreadId
        && options.preferUnread !== false
        && !options.focusComposer
        && options.scrollToBottom !== true
        && scrollMessageThreadToFirstUnread(state.messageThreadFirstUnreadId);
      if (!scrolledToUnread && options.scrollToBottom !== false) {
        scrollMessageThreadToBottom();
      }
      updateMessageScrollBottomButton();
    }
    hydrateMessageAttachments();
    ensureMessageAutoRefresh();
  } catch (err) {
    if (silent) {
      toast(`刷新聊天失败: ${err.message}`, 'error');
    } else {
      app.innerHTML = errorBox(err);
    }
  }
}

let messageConversationSearchTimer = null;

function setMessageConversationSearch(value = '') {
  state.messageConversationSearch = String(value || '').trim();
  clearTimeout(messageConversationSearchTimer);
  messageConversationSearchTimer = setTimeout(() => {
    void renderMessages(currentMessageConversationKey() || null, {
      silent: true,
      preserveComposer: true,
      scrollToBottom: false,
    });
  }, 160);
}

function toggleMessageArchivedFilter() {
  state.messageShowArchived = !state.messageShowArchived;
  void renderMessages(currentMessageConversationKey() || null, {
    silent: true,
    preserveComposer: true,
    scrollToBottom: false,
  });
}

async function updateMessageConversationPreferences(conversationKey, changes = {}) {
  const parsed = parseMessageConversationKey(conversationKey);
  if (!parsed.id) return null;
  const data = await api(`/api/messages/conversation-preferences/${parsed.type}/${parsed.id}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  return data.preferences || null;
}

async function toggleMessageConversationPinned(conversationKey, nextValue) {
  try {
    await updateMessageConversationPreferences(conversationKey, { is_pinned: !!nextValue });
    await refreshMessages(conversationKey, { preserveComposer: true, scrollToBottom: false });
  } catch (err) {
    toast(`更新会话置顶失败: ${err.message}`, 'error');
  }
}

async function toggleMessageConversationMuted(conversationKey, nextValue) {
  try {
    await updateMessageConversationPreferences(conversationKey, { is_muted: !!nextValue });
    await refreshMessages(conversationKey, { preserveComposer: true, scrollToBottom: false });
  } catch (err) {
    toast(`更新会话静音失败: ${err.message}`, 'error');
  }
}

async function toggleMessageConversationArchived(conversationKey, nextValue) {
  try {
    await updateMessageConversationPreferences(conversationKey, { is_archived: !!nextValue });
    if (nextValue && !state.messageShowArchived) {
      const messagesHomePath = isChatApp() ? '/' : '/messages';
      history.pushState(null, '', messagesHomePath);
      state.currentRoute = messagesHomePath;
      await renderMessages(null, { silent: true, preserveComposer: false, scrollToBottom: false });
    } else {
      await refreshMessages(conversationKey, { preserveComposer: true, scrollToBottom: false });
    }
  } catch (err) {
    toast(`更新会话归档失败: ${err.message}`, 'error');
  }
}

function showContactRemarkModal(peerId, currentRemark = '', username = '') {
  const normalizedPeerId = Number(peerId || 0);
  if (!normalizedPeerId) return;
  const body = `
    <div class="form-group">
      <label for="contactRemarkInput">备注名</label>
      <input
        type="text"
        id="contactRemarkInput"
        maxlength="50"
        value="${esc(currentRemark || '')}"
        placeholder="留空恢复用户名"
        onkeydown="if(event.key==='Enter'){submitContactRemark(${normalizedPeerId})}"
      />
      <div class="text-muted" style="font-size: 12px; margin-top: 6px;">原用户名：${esc(username || '用户')}</div>
    </div>
    <div id="contactRemarkError" class="notice error" style="display:none"></div>
  `;
  openModal({
    title: '设置备注',
    body,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="contactRemarkSubmitBtn" onclick="submitContactRemark(${normalizedPeerId})">保存</button>
    `,
  });
  setTimeout(() => $('contactRemarkInput')?.focus(), 0);
}

async function submitContactRemark(peerId) {
  const normalizedPeerId = Number(peerId || 0);
  const input = $('contactRemarkInput');
  const errEl = $('contactRemarkError');
  const btn = $('contactRemarkSubmitBtn');
  const remarkName = input?.value ?? '';
  if (remarkName.trim().length > 50) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = '备注名不能超过 50 个字符。'; }
    return;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
    await ChatApi.updateContactRemark(normalizedPeerId, { remark_name: remarkName });
    closeModal();
    toast(remarkName.trim() ? '备注已更新' : '已恢复默认用户名', 'success');
    await refreshMessages(messageConversationKey('direct', normalizedPeerId), {
      preserveComposer: true,
      scrollToBottom: false,
    });
  } catch (err) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = err.message; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  }
}

async function toggleDirectConversationBlock(peerId, shouldBlock = true) {
  const normalizedPeerId = Number(peerId || 0);
  if (!normalizedPeerId) return;
  try {
    if (shouldBlock) {
      if (!confirm('确认拉黑该用户吗？拉黑后双方将无法继续发送私信。')) return;
      await api('/api/messages/blocks', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked_user_id: normalizedPeerId }),
      });
    } else {
      await api(`/api/messages/blocks/${normalizedPeerId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
    }
    await refreshMessages(messageConversationKey('direct', normalizedPeerId), { preserveComposer: true, scrollToBottom: false });
  } catch (err) {
    toast(`更新拉黑状态失败: ${err.message}`, 'error');
  }
}

function renderMessageBlocksModalBody(items = []) {
  if (!items.length) {
    return `<div class="text-muted" style="font-size: 13px;">当前没有拉黑任何用户。</div>`;
  }
  return `
    <div class="message-block-list">
      ${items.map((user) => `
        <div class="message-block-item">
          <div class="message-block-item-main">
            ${renderConversationAvatar('direct', user.username || '用户', user.avatar_url)}
            <div class="message-block-item-copy">
              <strong>${esc(user.username || '用户')}</strong>
              <div class="text-muted" style="font-size: 12px;">${esc(user.role || 'USER')} · 拉黑于 ${esc(formatDate(user.blocked_at))}</div>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" onclick="unblockMessageUser(${Number(user.id)})">解除拉黑</button>
        </div>
      `).join('')}
    </div>
  `;
}

async function showMessageBlocksModal() {
  openModal({
    title: '拉黑名单',
    body: `<div class="text-muted" style="font-size: 13px;">正在加载...</div>`,
    footer: `<button class="btn btn-secondary" onclick="closeModal()">关闭</button>`,
  });

  try {
    const data = await api('/api/messages/blocks', { headers: authHeaders() });
    $('modalBody').innerHTML = renderMessageBlocksModalBody(data.items || []);
  } catch (err) {
    $('modalBody').innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
  }
}

async function unblockMessageUser(userId) {
  const normalizedUserId = Number(userId || 0);
  if (!normalizedUserId) return;
  try {
    await api(`/api/messages/blocks/${normalizedUserId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    toast('已解除拉黑', 'success');
    await showMessageBlocksModal();
    const conversationKey = messageConversationKey('direct', normalizedUserId);
    if (currentMessageConversationKey() === conversationKey) {
      await refreshMessages(conversationKey, { preserveComposer: true, scrollToBottom: false });
    } else if (location.pathname === (isChatApp() ? '/' : '/messages')) {
      await renderMessages(null, { silent: true, preserveComposer: true, scrollToBottom: false });
    }
  } catch (err) {
    toast(`解除拉黑失败: ${err.message}`, 'error');
  }
}

async function showMessagePreferencesModal() {
  openModal({
    title: '聊天设置',
    body: '<div class="text-muted">正在加载...</div>',
    footer: '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>',
  });
  try {
    const data = await ChatApi.getPreferences();
    const prefs = data.preferences || {};
    state.messagePreferences = prefs;
    $('modalBody').innerHTML = `
      <div class="form-grid">
        <div class="form-group">
          <label for="messageDmPolicy">私信接收</label>
          <select id="messageDmPolicy">
            <option value="EVERYONE" ${prefs.dm_policy === 'NOBODY' ? '' : 'selected'}>允许所有人</option>
            <option value="NOBODY" ${prefs.dm_policy === 'NOBODY' ? 'selected' : ''}>不接收新私信</option>
          </select>
        </div>
        <label class="form-check">
          <input id="messageAllowGroupInvites" type="checkbox" ${prefs.allow_group_invites === false ? '' : 'checked'} />
          <span>允许加入群邀请</span>
        </label>
        <div class="form-group">
          <label for="messageDndStart">免打扰开始</label>
          <input id="messageDndStart" type="time" value="${esc(String(prefs.dnd_start_time || '').slice(0, 5))}" />
        </div>
        <div class="form-group">
          <label for="messageDndEnd">免打扰结束</label>
          <input id="messageDndEnd" type="time" value="${esc(String(prefs.dnd_end_time || '').slice(0, 5))}" />
        </div>
      </div>
      <div id="messagePreferencesError" class="notice error" style="display:none"></div>
    `;
    $('modalFooter').innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="saveMessagePreferences()">保存</button>
    `;
  } catch (err) {
    $('modalBody').innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
  }
}

async function saveMessagePreferences() {
  const errEl = $('messagePreferencesError');
  try {
    const data = await ChatApi.updatePreferences({
      dm_policy: $('messageDmPolicy')?.value || 'EVERYONE',
      allow_group_invites: !!$('messageAllowGroupInvites')?.checked,
      dnd_start_time: $('messageDndStart')?.value || null,
      dnd_end_time: $('messageDndEnd')?.value || null,
    });
    state.messagePreferences = data.preferences || null;
    closeModal();
    toast('聊天设置已保存', 'success');
  } catch (err) {
    if (errEl) {
      errEl.style.display = '';
      errEl.textContent = err.message;
    }
  }
}

function renderMessageFavorites(items = []) {
  if (!items.length) return `<div class="message-empty-panel"><div class="text-muted">还没有收藏消息</div></div>`;
  return `
    <div class="message-search-results">
      ${items.map((item) => `
        <button class="message-search-result" type="button" onclick="openMessageFavorite(${jsArg(item.conversation_type)}, ${Number(item.message_id)}, ${Number(item.conversation_id || 0)})">
          <span class="message-search-result-main">
            <strong>${esc(item.conversation_type === 'group' ? '群消息' : '私信')}</strong>
            <span>${esc(messagePreview(item.body_md, 160, item.attachment_filename ? 'application/octet-stream' : ''))}</span>
          </span>
          <span class="text-muted">${esc(formatDate(item.favorited_at))}</span>
        </button>
      `).join('')}
    </div>
  `;
}

async function showMessageFavoritesModal() {
  openModal({
    title: '收藏消息',
    body: '<div class="text-muted">正在加载...</div>',
    footer: '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>',
    wide: true,
  });
  try {
    const data = await ChatApi.listFavorites();
    $('modalBody').innerHTML = renderMessageFavorites(data.items || []);
  } catch (err) {
    $('modalBody').innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
  }
}

function openMessageFavorite(conversationType, messageId, conversationId = 0) {
  closeModal();
  if (scrollToMessageId(messageId)) return;
  const targetKey = messageConversationKey(conversationType, conversationId);
  if (targetKey) {
    openMessageConversation(targetKey);
    toast('已打开收藏所在会话，可加载历史后定位。', 'info');
    return;
  }
  toast('收藏消息不在当前已加载范围内。', 'info');
}

function showJoinGroupInviteModal() {
  openModal({
    title: '加入群聊',
    body: `
      <div class="form-group">
        <label for="groupInviteCodeInput">邀请码</label>
        <input id="groupInviteCodeInput" type="text" autocomplete="off" placeholder="输入群聊邀请码" />
      </div>
      <div id="groupInviteJoinError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="joinGroupInvite()">加入</button>
    `,
  });
  setTimeout(() => $('groupInviteCodeInput')?.focus(), 0);
}

async function joinGroupInvite() {
  const code = $('groupInviteCodeInput')?.value.trim() || '';
  const errEl = $('groupInviteJoinError');
  if (!code) {
    if (errEl) {
      errEl.style.display = '';
      errEl.textContent = '请输入邀请码。';
    }
    return;
  }
  try {
    const data = await ChatApi.joinGroupInvite(code);
    closeModal();
    toast('已加入群聊', 'success');
    openMessageConversation(messageConversationKey('group', data.group?.id || data.group?.group_id));
  } catch (err) {
    if (errEl) {
      errEl.style.display = '';
      errEl.textContent = err.message;
    }
  }
}

async function showAdminMessageReportsModal(status = 'OPEN') {
  openModal({
    title: '消息举报队列',
    body: '<div class="text-muted">正在加载...</div>',
    footer: '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>',
    wide: true,
  });
  try {
    const data = await ChatApi.listReports(status);
    const items = data.items || [];
    $('modalBody').innerHTML = `
      <div class="row gap-sm mb-md" style="flex-wrap: wrap;">
        ${['OPEN', 'REVIEWED', 'DISMISSED', 'ALL'].map((item) => `
          <button class="btn btn-secondary btn-sm" type="button" onclick="showAdminMessageReportsModal(${jsArg(item)})">${item}</button>
        `).join('')}
      </div>
      ${items.length ? `
        <div class="message-report-list">
          ${items.map((item) => `
            <div class="message-report-item">
              <div>
                <strong>${esc(item.reason || '未填写原因')}</strong>
                <div class="text-muted">${esc(item.conversation_type)} · 举报人 ${esc(item.reporter_username || '')} · 发送者 ${esc(item.message_sender_username || '')}</div>
                <div>${esc(messagePreview(item.message_body_md, 220))}</div>
                ${item.details ? `<div class="text-muted">${esc(item.details)}</div>` : ''}
              </div>
              <div class="message-report-actions">
                <button class="btn btn-secondary btn-sm" onclick="resolveMessageReport(${Number(item.id)}, 'REVIEWED', 'NONE')">标记已审</button>
                <button class="btn btn-secondary btn-sm" onclick="resolveMessageReport(${Number(item.id)}, 'REVIEWED', 'WARN_SENDER')">提醒发送者</button>
                <button class="btn btn-secondary btn-sm text-danger" onclick="resolveMessageReport(${Number(item.id)}, 'DISMISSED', 'NONE')">驳回</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : '<div class="message-empty-panel"><div class="text-muted">当前没有举报</div></div>'}
    `;
  } catch (err) {
    $('modalBody').innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
  }
}

async function resolveMessageReport(reportId, status, actionTaken) {
  const note = actionTaken === 'WARN_SENDER' ? '请遵守平台聊天规则。' : '';
  try {
    await ChatApi.updateReport(reportId, {
      status,
      action_taken: actionTaken,
      resolution_note: note,
    });
    toast('举报已处理', 'success');
    await showAdminMessageReportsModal();
  } catch (err) {
    toast(`处理举报失败: ${err.message}`, 'error');
  }
}

function openMessageConversation(target) {
  const parsed = parseMessageConversationKey(target);
  if (!parsed.id) return;
  const path = messageConversationPath(parsed.key);
  if (location.pathname !== path) {
    history.pushState(null, '', path);
  }
  state.currentRoute = path;
  updateNav();
  renderMessages(parsed.key, { silent: true });
}

function refreshMessages(target, options = {}) {
  return renderMessages(target, { silent: true, ...options });
}

async function refreshMessageThreadNow(target = null) {
  const key = parseMessageConversationKey(target || currentMessageConversationKey()).key;
  if (!key) return;
  await refreshMessages(key);
  updateMessageThreadUnreadBadge(0);
}

function scrollToMessageId(messageId) {
  const row = document.querySelector(`[data-server-message-id="${String(messageId || '')}"]`);
  if (!row) return false;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.add('message-row-highlight');
  setTimeout(() => row.classList.remove('message-row-highlight'), 1800);
  return true;
}

function renderMessageSearchResults(items = []) {
  if (!items.length) return `<div class="message-empty-panel"><div class="text-muted">没有匹配消息</div></div>`;
  return `
    <div class="message-search-results">
      ${items.map((item) => {
        const type = isGroupConversationMessage(item) ? 'group' : 'direct';
        const sender = messageSenderDisplayLabel(item);
        const preview = messagePreview(item.body_md, 160, item.attachment_content_type || (item.has_attachment ? 'application/octet-stream' : ''));
        return `
          <button class="message-search-result" type="button" onclick="openMessageSearchResult(${Number(item.id)}, ${jsArg(type)})">
            <span class="message-search-result-main">
              <strong>${esc(sender)}</strong>
              <span>${esc(preview)}</span>
            </span>
            <span class="text-muted">${esc(formatDate(item.created_at))}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function showMessageSearchModal(conversationKey = currentMessageConversationKey()) {
  const target = parseMessageConversationKey(conversationKey);
  if (!target.key) return;
  openModal({
    title: '搜索消息',
    body: `
      <div class="form-group">
        <label for="messageSearchInput">关键词</label>
        <input id="messageSearchInput" type="search" autocomplete="off" placeholder="搜索正文或附件名" onkeydown="handleMessageSearchKeydown(event, ${jsArg(target.key)})" />
      </div>
      <div id="messageSearchError" class="notice error" style="display:none"></div>
      <div id="messageSearchResults" class="message-search-results-wrap"></div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">关闭</button>
      <button class="btn btn-primary" onclick="submitMessageSearch(${jsArg(target.key)})">搜索</button>
    `,
    wide: true,
  });
  setTimeout(() => $('messageSearchInput')?.focus(), 0);
}

function handleMessageSearchKeydown(event, conversationKey) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  submitMessageSearch(conversationKey);
}

async function submitMessageSearch(conversationKey) {
  const target = parseMessageConversationKey(conversationKey);
  const input = $('messageSearchInput');
  const errEl = $('messageSearchError');
  const resultsEl = $('messageSearchResults');
  const query = input?.value.trim() || '';
  if (!query) {
    if (errEl) {
      errEl.style.display = '';
      errEl.textContent = '请输入关键词。';
    }
    return;
  }
  try {
    if (errEl) errEl.style.display = 'none';
    if (resultsEl) resultsEl.innerHTML = '<div class="text-muted">正在搜索...</div>';
    const data = await ChatApi.searchMessages({
      query,
      conversationType: target.type,
      conversationId: target.id,
    });
    state.messageSearchResults = data.items || [];
    if (resultsEl) resultsEl.innerHTML = renderMessageSearchResults(state.messageSearchResults);
  } catch (err) {
    if (errEl) {
      errEl.style.display = '';
      errEl.textContent = err.message;
    }
  }
}

function openMessageSearchResult(messageId) {
  closeModal();
  if (!scrollToMessageId(messageId)) {
    toast('该消息不在当前已加载范围内，可向上加载历史后再次定位。', 'info');
  }
}

function messageAttachmentQuoteLabel(message) {
  if (!message?.has_attachment) return '';
  const filename = message.attachment_filename || '附件';
  const contentType = message.attachment_content_type || '';
  return isImageAttachment(contentType) ? `[图片：${filename}]` : `[文件：${filename}]`;
}

function buildQuotedMessage(sender, body = '', attachmentLabel = '') {
  const senderLabel = String(sender || '用户').trim() || '用户';
  const bodyText = String(body || '').trim();
  const pieces = [attachmentLabel, bodyText].filter(Boolean);
  const quoteBody = (pieces.join('\n') || '空消息').slice(0, 900);
  const clipped = quoteBody.length < pieces.join('\n').length ? `${quoteBody}...` : quoteBody;
  const lines = clipped.split(/\r?\n/);
  return [`> ${senderLabel}：${lines.shift() || ''}`, ...lines.map(line => `> ${line}`)].join('\n');
}

function quoteMessage(sender, body = '', attachmentLabel = '') {
  const textarea = $('messageComposer');
  if (!textarea) return;

  const quote = buildQuotedMessage(sender, body, attachmentLabel);
  const value = textarea.value || '';
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const beforeGap = !before ? '' : (before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n');
  const afterGap = !after ? '' : (after.startsWith('\n') ? '' : '\n');
  const insert = `${beforeGap}${quote}\n\n`;
  const nextValue = `${before}${insert}${afterGap}${after}`;

  if (nextValue.length > Number(textarea.maxLength || 4000)) {
    toast('引用后内容会超过 4000 字符', 'warning');
    return;
  }

  textarea.value = nextValue;
  textarea.focus();
  const cursor = before.length + insert.length;
  textarea.setSelectionRange(cursor, cursor);
  saveMessageComposerDraft(currentMessageConversationKey(), textarea.value);
}

function replyPreviewText(sender, body = '', attachmentLabel = '', deleted = false) {
  const senderLabel = String(sender || '用户').trim() || '用户';
  if (deleted) return `${senderLabel}：消息已撤回`;
  const pieces = [String(attachmentLabel || '').trim(), String(body || '').trim()].filter(Boolean);
  const content = (pieces.join(' ') || '空消息').replace(/\s+/g, ' ').trim();
  const clipped = content.length > 120 ? `${content.slice(0, 119)}…` : content;
  return `${senderLabel}：${clipped}`;
}

function replyAttachmentLabel(contentType = '', filename = '') {
  if (!contentType) return '';
  const base = attachmentPreviewLabel(contentType, filename) || '[文件]';
  return filename ? `${base} ${filename}` : base;
}

function renderMessageReplyPreview(message) {
  if (!Number(message?.reply_to_message_id || 0)) return '';
  const preview = replyPreviewText(
    message.reply_to_sender_username || '用户',
    message.reply_to_body_md || '',
    message.reply_to_has_attachment ? replyAttachmentLabel(message.reply_to_attachment_content_type || '', message.reply_to_attachment_filename || '') : '',
    !!message.reply_to_deleted_at,
  );
  return `<div class="message-reply-preview">${esc(preview)}</div>`;
}

function currentMessageReplyTarget(conversationKey = currentMessageConversationKey()) {
  const target = state.messageReplyTarget;
  if (!target) return null;
  return parseMessageConversationKey(target.conversationKey || '').key === parseMessageConversationKey(conversationKey).key
    ? target
    : null;
}

function clearMessageReplyTarget(conversationKey = currentMessageConversationKey()) {
  const target = currentMessageReplyTarget(conversationKey);
  if (!target) return;
  state.messageReplyTarget = null;
  updateMessageReplyBanner();
}

function replyToMessage(messageId, sender, body = '', attachmentLabel = '', deleted = false) {
  const conversationKey = currentMessageConversationKey();
  if (!conversationKey || !Number(messageId || 0)) return;
  state.messageReplyTarget = {
    conversationKey,
    messageId: Number(messageId),
    sender: String(sender || '用户'),
    body: String(body || ''),
    attachmentLabel: String(attachmentLabel || ''),
    deleted: !!deleted,
  };
  updateMessageReplyBanner();
  $('messageComposer')?.focus({ preventScroll: true });
}

function updateMessageReplyBanner() {
  const banner = $('messageReplyBanner');
  if (!banner) return;
  const target = currentMessageReplyTarget();
  if (!target) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }
  banner.hidden = false;
  banner.innerHTML = `
    <div class="message-reply-banner-body">
      <strong>回复中</strong>
      <span>${esc(replyPreviewText(target.sender, target.body, target.attachmentLabel, target.deleted))}</span>
    </div>
    <button class="message-reply-banner-close" type="button" onclick="clearMessageReplyTarget(${jsArg(target.conversationKey)})" aria-label="取消回复">×</button>
  `;
}

function closeMessageActionMenu() {
  const cleanup = state.messageActionMenuCleanup;
  if (typeof cleanup === 'function') cleanup();
  state.messageActionMenuCleanup = null;
}

function messageMenuCopyText(message) {
  const parts = [];
  const attachmentLabel = messageAttachmentQuoteLabel(message);
  if (attachmentLabel) parts.push(attachmentLabel);
  if (message?.body_md) parts.push(String(message.body_md));
  return parts.join('\n').trim();
}

function positionMessageActionMenu(menu, left, top) {
  const padding = 12;
  const rect = menu.getBoundingClientRect();
  const nextLeft = Math.max(padding, Math.min(left, window.innerWidth - rect.width - padding));
  const nextTop = Math.max(padding, Math.min(top, window.innerHeight - rect.height - padding));
  menu.style.left = `${nextLeft}px`;
  menu.style.top = `${nextTop}px`;
}

function openMessageActionMenu(event, messageId) {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  const message = currentThreadMessage(messageId);
  if (!message) return;

  closeMessageActionMenu();

  const menu = document.createElement('div');
  menu.className = 'message-action-menu';
  if ((event?.clientX || 0) > window.innerWidth - 260) {
    menu.classList.add('submenu-left');
  }
  menu.innerHTML = renderMessageActionMenu(message);
  document.body.appendChild(menu);

  const targetRect = event?.currentTarget?.getBoundingClientRect?.();
  const preferredLeft = Number.isFinite(event?.clientX)
    ? event.clientX
    : Math.max(12, (targetRect?.right || 0) - 16);
  const preferredTop = Number.isFinite(event?.clientY)
    ? event.clientY
    : Math.max(12, (targetRect?.bottom || 0) + 6);
  positionMessageActionMenu(menu, preferredLeft, preferredTop);

  const onPointerDown = (nextEvent) => {
    if (!menu.contains(nextEvent.target)) closeMessageActionMenu();
  };
  const onEscape = (nextEvent) => {
    if (nextEvent.key === 'Escape') closeMessageActionMenu();
  };
  const onWindowChange = () => closeMessageActionMenu();

  const cleanup = () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onEscape, true);
    window.removeEventListener('resize', onWindowChange);
    window.removeEventListener('scroll', onWindowChange, true);
    menu.remove();
    if (state.messageActionMenuCleanup === cleanup) {
      state.messageActionMenuCleanup = null;
    }
  };

  state.messageActionMenuCleanup = cleanup;
  window.setTimeout(() => {
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onEscape, true);
    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);
  }, 0);
}

function renderMessageActionMenu(message) {
  if (isTransientLocalMessage(message)) {
    const canFavoriteGif = isGifMessageAttachment(message) && !isMessageGifAlreadyFavorite(message);
    return `
      ${canFavoriteGif ? `<button class="message-menu-item" type="button" onclick="addMessageGifFavoriteFromMessage(${jsArg(messageActionTargetId(message))})">添加到表情</button>` : ''}
      ${message.send_state === 'failed' ? `<button class="message-menu-item" type="button" onclick="retryTransientMessage(${jsArg(message.local_id)})">重发</button>` : ''}
      <button class="message-menu-item danger" type="button" onclick="dismissTransientMessage(${jsArg(message.local_id)})">移除</button>
    `;
  }
  const senderLabel = messageSenderDisplayLabel(message);
  const attachmentLabel = messageAttachmentQuoteLabel(message);
  const conversationType = isGroupConversationMessage(message) ? 'group' : 'direct';
  const recalled = isRecalledMessage(message);
  const mine = Number(message?.sender_id || 0) === Number(state.user?.id || 0);
  const copyText = messageMenuCopyText(message);
  const canFavoriteGif = !recalled && isGifMessageAttachment(message) && !isMessageGifAlreadyFavorite(message);
  const nestedItems = [
    `<button class="message-menu-item danger" type="button" onclick="deleteMessageAction(${Number(message.id)}, ${jsArg(conversationType)})">删除</button>`,
    !mine && !recalled
      ? `<button class="message-menu-item" type="button" onclick="showMessageReportModal(${Number(message.id)}, ${jsArg(conversationType)})">举报</button>`
      : '',
  ].filter(Boolean).join('');

  return `
    ${!recalled ? `<button class="message-menu-item" type="button" onclick="closeMessageActionMenu(); replyToMessage(${Number(message.id)}, ${jsArg(senderLabel)}, ${jsArg(message.body_md || '')}, ${jsArg(attachmentLabel)}, false)">回复</button>` : ''}
    ${!recalled ? `<button class="message-menu-item" type="button" onclick="toggleMessageFavorite(${Number(message.id)}, ${jsArg(conversationType)}, ${message.is_favorited ? 'false' : 'true'})">${message.is_favorited ? '取消收藏' : '收藏消息'}</button>` : ''}
    ${canFavoriteGif ? `<button class="message-menu-item" type="button" onclick="addMessageGifFavoriteFromMessage(${jsArg(messageActionTargetId(message))})">添加到表情</button>` : ''}
    ${copyText ? `<button class="message-menu-item" type="button" onclick="copyMessageText(${Number(message.id)})">复制</button>` : ''}
    ${canEditMessage(message) ? `<button class="message-menu-item" type="button" onclick="showMessageEditModal(${Number(message.id)}, ${jsArg(conversationType)}, ${jsArg(message.body_md || '')}, ${message.has_attachment ? 'true' : 'false'}, ${recalled ? 'true' : 'false'})">编辑</button>` : ''}
    ${canRecallMessage(message) ? `<button class="message-menu-item" type="button" onclick="recallMessageAction(${Number(message.id)}, ${jsArg(conversationType)})">撤回</button>` : ''}
    ${nestedItems ? `
      <div class="message-menu-submenu">
        <button class="message-menu-item has-submenu" type="button">
          更多
          <span aria-hidden="true">›</span>
        </button>
        <div class="message-menu-submenu-panel">
          ${nestedItems}
        </div>
      </div>
    ` : ''}
  `;
}

function renderMessageReactions(message) {
  if (isTransientLocalMessage(message) || isRecalledMessage(message)) return '';
  const conversationType = isGroupConversationMessage(message) ? 'group' : 'direct';
  const existing = Array.isArray(message.reactions) ? message.reactions : [];
  const buttons = existing.map((item) => `
      <button
        class="message-reaction-chip ${item.reacted_by_me ? 'active' : ''}"
        type="button"
        onclick="toggleMessageReaction(${Number(message.id)}, ${jsArg(conversationType)}, ${jsArg(item.emoji)}, ${item.reacted_by_me ? 'false' : 'true'})"
      >${esc(item.emoji)} <span>${Number(item.count || 0)}</span></button>
    `).join('');
  return buttons ? `<div class="message-reactions">${buttons}</div>` : '';
}

function renderMessageUploadProgress(message) {
  if (!isTransientLocalMessage(message) || !message.has_attachment || message.send_state !== 'pending') return '';
  const progress = Math.max(0, Math.min(100, Number(message.upload_progress || 0)));
  return `
    <div class="message-upload-progress" data-message-upload-progress="${esc(message.local_id || '')}">
      <span style="width:${progress}%"></span>
    </div>
  `;
}

function renderMessageRow(message) {
  const mine = Number(message.sender_id) === Number(state.user.id);
  const senderLabel = messageSenderDisplayLabel(message);
  const groupMessage = isGroupConversationMessage(message);
  const avatarName = groupMessage ? senderLabel : (message.sender_username || senderLabel || '用户');
  const avatarUsername = message.sender_username || (mine ? state.user?.username || '' : '');
  const avatarUrl = message.sender_avatar_url || (mine ? state.user?.avatar_url || '' : '');
  const deleted = isRecalledMessage(message);
  const localOnly = isTransientLocalMessage(message);
  const actionTargetId = messageActionTargetId(message);
  const metaBits = [messageMetaLabel(message)];
  if (!groupMessage && mine && message.read_at) metaBits.push('已读');
  if (groupMessage && mine && Number(message.read_count || 0) > 0) metaBits.push(`${Number(message.read_count || 0)} 已读`);
  if (message.is_favorited) metaBits.push('已收藏');
  if (message.attachment_scan_status && message.has_attachment) metaBits.push(`附件 ${message.attachment_scan_status}`);
  if (message.edited_at && !deleted) metaBits.push('已编辑');
  if (message.send_state === 'pending') metaBits.push('发送中...');
  if (message.send_state === 'failed') metaBits.push('发送失败');
  const hasBody = String(message.body_md || '').trim().length > 0;
  const attachmentOnly = message.has_attachment && !hasBody && !Number(message.reply_to_message_id || 0);
  const menuBtn = `
    <button
      class="message-menu-btn"
      type="button"
      aria-label="消息操作"
      onclick="openMessageActionMenu(event, ${jsArg(actionTargetId)})"
    >···</button>
  `;
  if (deleted) {
    return `
      <div
        class="message-system-row"
        data-message-id="${esc(actionTargetId)}"
        ${localOnly ? '' : `data-server-message-id="${esc(message.id)}"`}
        oncontextmenu="openMessageActionMenu(event, ${jsArg(actionTargetId)})"
      >
        <span>${esc(recallNoticeText(message))}</span>
        ${menuBtn}
      </div>
    `;
  }
  return `
    <div
      class="message-row ${mine ? 'mine' : ''} ${message.send_state === 'failed' ? 'failed' : ''} ${message.send_state === 'pending' ? 'pending' : ''}"
      data-message-id="${esc(actionTargetId)}"
      ${localOnly ? '' : `data-server-message-id="${esc(message.id)}"`}
      oncontextmenu="openMessageActionMenu(event, ${jsArg(actionTargetId)})"
    >
      ${renderMessageProfileAvatar(avatarName, avatarUrl, avatarUsername)}
      <div class="message-content">
        ${groupMessage ? `<div class="message-sender-name">${esc(mine ? `${senderLabel}（我）` : senderLabel)}</div>` : ''}
        <div class="message-bubble${attachmentOnly ? ' attachment-only' : ''}">
          ${renderMessageReplyPreview(message)}
          ${message.has_attachment ? renderMessageAttachment(message) : ''}
          ${hasBody ? renderMd(message.body_md) : ''}
          ${renderMessageUploadProgress(message)}
          ${renderMessageReactions(message)}
          <div class="message-meta">
            <span>${esc(metaBits.join(' · '))}</span>
            <span class="message-action-row">
              ${message.send_state === 'failed' ? `<button class="message-inline-action" type="button" onclick="retryTransientMessage(${jsArg(message.local_id)})">重发</button>` : ''}
              ${menuBtn}
            </span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderMessageRows(messages = [], options = {}) {
  const firstUnreadMessageId = String(options.firstUnreadMessageId || '').trim();
  let insertedUnreadDivider = false;
  return messages.map((message) => {
    let html = '';
    if (
      firstUnreadMessageId
      && !insertedUnreadDivider
      && String(message?.id || '') === firstUnreadMessageId
    ) {
      insertedUnreadDivider = true;
      html += renderUnreadDivider(firstUnreadMessageId);
    }
    html += renderMessageRow(message);
    return html;
  }).join('');
}

async function toggleMessageReaction(messageId, conversationType, emoji, active = true) {
  const normalizedId = Number(messageId || 0);
  if (!normalizedId || !emoji) return;
  try {
    await ChatApi.setReaction({
      conversation_type: conversationType,
      message_id: normalizedId,
      emoji,
      active: !!active,
    });
    await refreshMessages(currentMessageConversationKey(), {
      preserveComposer: true,
      scrollToBottom: false,
      preferUnread: false,
    });
  } catch (err) {
    toast(`更新表情失败: ${err.message}`, 'error');
  }
}

async function toggleMessageFavorite(messageId, conversationType, active = true) {
  const normalizedId = Number(messageId || 0);
  if (!normalizedId) return;
  closeMessageActionMenu();
  try {
    if (active) {
      await ChatApi.addFavorite({ conversation_type: conversationType, message_id: normalizedId });
      toast('已收藏消息', 'success');
    } else {
      await ChatApi.deleteFavorite(conversationType, normalizedId);
      toast('已取消收藏', 'success');
    }
    await refreshMessages(currentMessageConversationKey(), {
      preserveComposer: true,
      scrollToBottom: false,
      preferUnread: false,
    });
  } catch (err) {
    toast(`更新收藏失败: ${err.message}`, 'error');
  }
}

function renderMessageThread(peer, messages, options = {}) {
  const conversationType = options.conversationType === 'group' || peer.group_id ? 'group' : 'direct';
  const conversationId = conversationType === 'group'
    ? (peer.id || peer.group_id)
    : (peer.id || peer.peer_id);
  const conversationKey = messageConversationKey(conversationType, conversationId);
  const firstUnreadMessageId = Number(options.firstUnreadMessageId || 0);
  const hasMore = !!options.hasMore;
  const canMessage = conversationType === 'group' ? true : !!peer.can_message;
  const directBlockNotice = conversationType === 'direct' && !canMessage
    ? (peer.is_blocked_by_me ? '你已拉黑对方，当前无法继续发送消息。' : '对方已阻止你发送消息。')
    : '';
  const title = conversationType === 'group'
    ? (peer.name || peer.group_name)
    : directContactDisplayName(peer, peer.username || peer.peer_username);
  const subtitle = conversationType === 'group'
    ? `${Number(peer.member_count || peer.group_member_count || peer.members?.length || 0)} 位成员`
    : directContactSubtitle(peer);
  return `
    <div class="message-thread-header">
      ${renderConversationAvatar(conversationType, title, peer.avatar_url || peer.peer_avatar_url, { username: conversationType === 'direct' ? (peer.username || peer.peer_username) : '' })}
      <div class="message-thread-title">
        <div class="message-thread-title-text">${esc(title)}</div>
        <div class="text-muted" style="font-size: 12px;">${esc(subtitle)}${peer.is_pinned ? ' · PIN' : ''}${peer.is_muted ? ' · MUTE' : ''}${peer.is_archived ? ' · ARCH' : ''}</div>
      </div>
      <button class="message-thread-unread-badge" id="messageThreadUnreadBadge" type="button" hidden onclick="refreshMessageThreadNow(${jsArg(conversationKey)})" aria-label="查看新消息">0</button>
      <button class="btn btn-secondary btn-sm message-thread-action" type="button" onclick="showMessageSearchModal(${jsArg(conversationKey)})">搜索</button>
      <button class="btn btn-secondary btn-sm message-thread-action" type="button" onclick="toggleMessageConversationPinned(${jsArg(conversationKey)}, ${peer.is_pinned ? 'false' : 'true'})">${peer.is_pinned ? '取消置顶' : '置顶'}</button>
      <button class="btn btn-secondary btn-sm message-thread-action" type="button" onclick="toggleMessageConversationMuted(${jsArg(conversationKey)}, ${peer.is_muted ? 'false' : 'true'})">${peer.is_muted ? '取消静音' : '静音'}</button>
      <button class="btn btn-secondary btn-sm message-thread-action" type="button" onclick="toggleMessageConversationArchived(${jsArg(conversationKey)}, ${peer.is_archived ? 'false' : 'true'})">${peer.is_archived ? '取消归档' : '归档'}</button>
      ${conversationType === 'direct' ? `<button class="btn btn-secondary btn-sm message-thread-action" type="button" onclick="showContactRemarkModal(${conversationId}, ${jsArg(peer.peer_remark_name || '')}, ${jsArg(peer.username || peer.peer_username || '')})">备注</button>` : ''}
      ${conversationType === 'direct' ? `<button class="btn btn-secondary btn-sm message-thread-action" type="button" onclick="toggleDirectConversationBlock(${conversationId}, ${peer.is_blocked_by_me ? 'false' : 'true'})">${peer.is_blocked_by_me ? '解除拉黑' : '拉黑'}</button>` : ''}
      ${conversationType === 'group' ? `<button class="btn btn-secondary btn-sm message-thread-action" type="button" onclick="showMessageGroupSettings(${conversationId})">群设置</button>` : ''}
    </div>

    <div class="message-thread-list" id="messageThreadList" data-message-conversation-key="${esc(conversationKey)}" data-message-peer-id="${conversationType === 'direct' ? esc(conversationId) : ''}" data-has-more="${hasMore ? '1' : '0'}" data-loading-older="0">
      ${renderMessageHistoryLoader()}
      ${messages.length === 0 ? `
        <div class="message-empty-panel">
          <div class="empty-icon">✉</div>
          <div class="text-muted" style="font-size: 13px;">还没有消息，发送第一条${conversationType === 'group' ? '群聊消息' : '私信'}。</div>
        </div>
      ` : renderMessageRows(messages, { firstUnreadMessageId })}
    </div>
    <div class="message-typing-indicator" id="messageTypingIndicator" hidden></div>
    <button class="message-scroll-bottom-btn" id="messageScrollBottomBtn" type="button" hidden onclick="scrollMessageThreadToBottom()">回到底部</button>

    <div class="message-composer" id="messageComposerWrap">
      <div id="messageReplyBanner" class="message-reply-banner" hidden></div>
      ${directBlockNotice ? `<div class="notice warning" style="margin-bottom: 0;">${esc(directBlockNotice)}</div>` : ''}
      ${renderMessageComposerPanel(conversationKey)}
      <textarea id="messageComposer" rows="3" maxlength="4000" data-message-composer-key="${esc(conversationKey)}" data-message-composer-peer-id="${conversationType === 'direct' ? esc(conversationId) : ''}" placeholder="输入消息内容，Enter 发送，Ctrl+Enter 换行" onkeydown="handleMessageComposerKeydown(event, ${jsArg(conversationKey)})" ${canMessage ? '' : 'disabled'}></textarea>
      <div class="message-drop-banner">松开以上传文件</div>
      <div class="row flex-between gap-sm" style="align-items:center; flex-wrap: wrap;">
        <span class="text-muted message-composer-hint">最长 4000 字符 · 支持拖拽或粘贴文件，单个最大 20 MB</span>
        <div class="row gap-sm" style="flex-wrap: wrap;">
          ${conversationType === 'group' ? `<button class="btn btn-secondary" type="button" onclick="showGroupMentionModal(${conversationId})">@</button>` : ''}
          <button class="btn btn-secondary" type="button" onclick="toggleMessageEmojiPanel(${jsArg(conversationKey)})" ${canMessage ? '' : 'disabled'}>表情</button>
          <label class="btn btn-secondary message-file-button${canMessage ? '' : ' disabled'}" for="messageFileInput">文件</label>
          <input type="file" id="messageFileInput" style="display:none" multiple onchange="sendFileToPeer(${jsArg(conversationKey)}, this)" ${canMessage ? '' : 'disabled'} />
          <button class="btn btn-primary" id="sendMessageBtn" onclick="sendMessageToPeer(${jsArg(conversationKey)})" ${canMessage ? '' : 'disabled'}>发送</button>
        </div>
      </div>
    </div>
  `;
}

function initMessageThreadPagination(target, hasMore = false) {
  const list = $('messageThreadList');
  const key = parseMessageConversationKey(target).key;
  if (!list || !key) return;

  list.dataset.messageConversationKey = key;
  list.dataset.hasMore = hasMore ? '1' : '0';
  list.dataset.loadingOlder = '0';

  list.addEventListener('scroll', () => {
    updateMessageScrollBottomButton(list);
    if (list.scrollTop <= MESSAGE_THREAD_TOP_LOAD_THRESHOLD_PX) {
      void loadOlderMessages(key);
    }
  }, { passive: true });

  setTimeout(() => {
    if (!document.body.contains(list)) return;
    if (list.scrollHeight <= list.clientHeight + 2) {
      void loadOlderMessages(key);
    }
  }, 0);
  updateMessageScrollBottomButton(list);
}

async function loadOlderMessages(target = null) {
  const key = parseMessageConversationKey(target || currentMessageConversationKey()).key;
  const list = $('messageThreadList');
  if (!key || !list) return;
  if ((list.dataset.messageConversationKey || '') !== key) return;
  if (list.dataset.hasMore !== '1' || list.dataset.loadingOlder === '1') return;

  const beforeId = oldestRenderedMessageId(list);
  if (!beforeId) {
    list.dataset.hasMore = '0';
    return;
  }

  const previousHeight = list.scrollHeight;
  const previousTop = list.scrollTop;
  list.dataset.loadingOlder = '1';
  setMessageHistoryLoader(list, '正在加载更早消息...');

  try {
    const data = await api(messageConversationApiPath(key, { beforeId }), { headers: authHeaders() });
    if (!document.body.contains(list) || (list.dataset.messageConversationKey || '') !== key) return;

    const items = data.items || [];
    if (items.length) {
      const firstMessageRow = list.querySelector('[data-server-message-id]');
      const emptyPanel = list.querySelector('.message-empty-panel');
      if (emptyPanel) emptyPanel.remove();
      if (firstMessageRow) {
        firstMessageRow.insertAdjacentHTML('beforebegin', renderMessageRows(items));
      } else {
        list.insertAdjacentHTML('beforeend', renderMessageRows(items));
      }
      state.messageThreadItems = [
        ...items,
        ...state.messageThreadItems.filter((message) => !items.some((incoming) => Number(incoming?.id || 0) === Number(message?.id || 0))),
      ];
    }

    list.dataset.hasMore = data.has_more ? '1' : '0';
    setMessageHistoryLoader(list, '');
    list.scrollTop = previousTop + (list.scrollHeight - previousHeight);
    hydrateMessageAttachments({ preserveScrollAbove: true });
  } catch (err) {
    if (document.body.contains(list)) {
      setMessageHistoryLoader(list, '');
      toast(`加载更早消息失败: ${err.message}`, 'error');
    }
  } finally {
    if (document.body.contains(list)) {
      list.dataset.loadingOlder = '0';
      if (list.dataset.hasMore !== '1') setMessageHistoryLoader(list, '');
    }
  }
}

function updateMessageScrollBottomButton(list = $('messageThreadList')) {
  const button = $('messageScrollBottomBtn');
  if (!button) return;
  button.hidden = messageThreadIsNearBottom(list);
}

function renderMessageAttachment(message) {
  if (message?.attachment_local_url) {
    const filename = message.attachment_filename || '附件';
    const contentType = message.attachment_content_type || 'application/octet-stream';
    if (!isImageAttachment(contentType)) {
      return `
        <button class="message-file-card" type="button" onclick="downloadLocalMessageFile(${jsArg(message.local_id)})">
          <span class="message-file-icon">FILE</span>
          <span class="message-file-info">
            <strong>${esc(filename)}</strong>
            <span>${esc(formatFileSize(message.attachment_size_bytes) || contentType)}</span>
          </span>
          <span class="message-file-download">下载</span>
        </button>
      `;
    }
    if (isGifAttachment(contentType, filename)) {
      return `
        <div class="message-image-frame message-gif-frame">
          <img class="message-image message-gif-sticker" src="${esc(message.attachment_local_url)}" alt="${esc(filename)}" data-loaded="1" />
        </div>
      `;
    }
    return `
      <div class="message-image-frame">
        <img class="message-image" src="${esc(message.attachment_local_url)}" alt="${esc(filename)}" data-loaded="1" onclick="openMessageImage(${jsArg(message.attachment_local_url)})" />
      </div>
    `;
  }
  const attachmentId = message.attachment_id || message.id;
  if (!attachmentId) return '';
  const attachmentScope = message.attachment_scope || message.message_type || (message.group_id ? 'group' : 'direct');
  const filename = message.attachment_filename || '附件';
  const contentType = message.attachment_content_type || 'application/octet-stream';
  if (!isImageAttachment(contentType)) {
    return `
      <button class="message-file-card" type="button" onclick="downloadMessageFile(${jsArg(attachmentScope)}, ${attachmentId}, ${jsArg(filename)})">
        <span class="message-file-icon">FILE</span>
        <span class="message-file-info">
          <strong>${esc(filename)}</strong>
          <span>${esc(formatFileSize(message.attachment_size_bytes) || contentType)}</span>
        </span>
        <span class="message-file-download">下载</span>
      </button>
    `;
  }
  const cachedUrl = getMessageAttachmentCacheEntry(attachmentScope, attachmentId)?.url || '';
  const attachmentKey = messageAttachmentCacheKey(attachmentScope, attachmentId);
  const isGif = isGifAttachment(contentType, filename);
  return `
    <div class="message-image-frame${isGif ? ' message-gif-frame' : ''}" data-message-attachment-frame="${esc(attachmentKey)}">
      <div class="message-image-placeholder"${cachedUrl ? ' style="display:none"' : ''}>${isGif ? 'GIF 加载中...' : '图片加载中...'}</div>
      <img class="message-image${isGif ? ' message-gif-sticker' : ''}" data-message-attachment-id="${attachmentId}" data-message-attachment-scope="${esc(attachmentScope)}" alt="${esc(filename)}"${cachedUrl ? ` src="${esc(cachedUrl)}" data-loaded="1"` : ' hidden'}${isGif ? '' : ` onclick="openMessageImageFromAttachment(${jsArg(attachmentScope)}, ${attachmentId}, this.src)"`} />
    </div>
  `;
}

function downloadLocalMessageFile(localId) {
  const match = findTransientMessageByLocalId(localId);
  if (!match?.item?.attachment_local_url) return;
  const link = document.createElement('a');
  link.href = match.item.attachment_local_url;
  link.download = match.item.attachment_filename || 'attachment';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function hydrateMessageAttachments(options = {}) {
  const images = Array.from(document.querySelectorAll('img[data-message-attachment-id]:not([data-loaded])'));
  const list = $('messageThreadList');
  const stickToBottom = !options.preserveScrollAbove && messageThreadIsNearBottom(list);
  for (const img of images) {
    const attachmentId = img.dataset.messageAttachmentId;
    const attachmentScope = img.dataset.messageAttachmentScope || 'direct';
    const frame = img.closest('.message-image-frame');
    const placeholder = frame?.querySelector('.message-image-placeholder');
    const preserveScroll = !!options.preserveScrollAbove &&
      !!list &&
      img.getBoundingClientRect().top < list.getBoundingClientRect().top;
    const previousHeight = preserveScroll ? list.scrollHeight : 0;
    try {
      const url = await loadMessageAttachmentUrl(attachmentScope, attachmentId);
      img.src = url;
      await waitForImageReady(img);
      img.hidden = false;
      img.dataset.loaded = '1';
      if (placeholder) placeholder.style.display = 'none';
      if (preserveScroll) list.scrollTop += list.scrollHeight - previousHeight;
      if (stickToBottom) scrollMessageThreadToBottom();
    } catch {
      if (placeholder) placeholder.textContent = '图片加载失败';
      if (preserveScroll) list.scrollTop += list.scrollHeight - previousHeight;
      if (stickToBottom) scrollMessageThreadToBottom();
    }
  }
}

async function downloadMessageFile(scopeOrId, attachmentIdOrFilename = null, filenameValue = 'attachment') {
  const target = typeof scopeOrId === 'string' && ['direct', 'group'].includes(scopeOrId)
    ? normalizeMessageAttachmentTarget(scopeOrId, attachmentIdOrFilename)
    : normalizeMessageAttachmentTarget(scopeOrId);
  const filename = typeof scopeOrId === 'string' && ['direct', 'group'].includes(scopeOrId)
    ? filenameValue
    : (attachmentIdOrFilename || 'attachment');
  try {
    let blob = null;
    const cached = getMessageAttachmentCacheEntry(target.scope, target.id);
    if (cached?.url) {
      const res = await fetch(cached.url);
      if (res.ok) blob = await res.blob();
    }
    if (!blob) {
      const dbBlob = await AttachmentDB.get(target.key);
      if (dbBlob) blob = dbBlob;
    }
    if (!blob) {
      const res = await fetch(messageAttachmentUrlPath(target.scope, target.id), { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      blob = await res.blob();
      void AttachmentDB.set(target.key, blob);
    }
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

function clampMessageImagePreviewValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function destroyMessageImagePreview() {
  const preview = state.messageImagePreview;
  if (!preview) return;
  if (typeof preview.cleanup === 'function') preview.cleanup();
  document.body.classList.remove('message-image-panning');
  state.messageImagePreview = null;
}

function collectMessageImagePreviewItems() {
  const root = $('messageThreadList') || document;
  return Array.from(root.querySelectorAll('img[data-message-attachment-id]'))
    .map((img) => {
      const attachmentId = Number(img.dataset.messageAttachmentId || 0);
      const attachmentScope = img.dataset.messageAttachmentScope || 'direct';
      const cachedUrl = getMessageAttachmentCacheEntry(attachmentScope, attachmentId)?.url || '';
      return {
        attachmentScope,
        attachmentId,
        src: img.currentSrc || img.src || cachedUrl,
        alt: img.alt || '图片消息',
      };
    })
    .filter((item) => item.attachmentId || item.src);
}

function findMessageImagePreviewIndex(items, attachmentId = 0, src = '', attachmentScope = 'direct') {
  const normalizedId = Number(attachmentId || 0);
  const normalizedScope = attachmentScope === 'group' ? 'group' : 'direct';
  if (normalizedId) {
    const byId = items.findIndex((item) => Number(item.attachmentId || 0) === normalizedId && (item.attachmentScope || 'direct') === normalizedScope);
    if (byId >= 0) return byId;
  }
  if (src) {
    const bySrc = items.findIndex((item) => item.src === src);
    if (bySrc >= 0) return bySrc;
  }
  return 0;
}

function updateMessageImagePreviewControls(preview = state.messageImagePreview) {
  if (!preview) return;
  const count = preview.items.length;
  const hasPrevious = preview.index > 0;
  const hasNext = preview.index < count - 1;
  if (preview.counter) {
    preview.counter.textContent = count > 1 ? `${preview.index + 1} / ${count}` : '1 / 1';
  }
  [preview.previousButton, preview.overlayPreviousButton].forEach((button) => {
    if (!button) return;
    button.disabled = !hasPrevious;
    button.hidden = count <= 1;
  });
  [preview.nextButton, preview.overlayNextButton].forEach((button) => {
    if (!button) return;
    button.disabled = !hasNext;
    button.hidden = count <= 1;
  });
}

function getMessageImagePreviewFitScale(preview = state.messageImagePreview) {
  if (!preview?.stage || !preview.naturalWidth || !preview.naturalHeight) return 1;
  const stageWidth = preview.stage.clientWidth || 1;
  const stageHeight = preview.stage.clientHeight || 1;
  const fitScale = Math.min(
    stageWidth / preview.naturalWidth,
    stageHeight / preview.naturalHeight,
    1,
  );
  return Math.max(MESSAGE_IMAGE_PREVIEW_MIN_SCALE, fitScale || 1);
}

function getMessageImagePreviewScaleBounds(preview = state.messageImagePreview) {
  const fitScale = preview?.fitScale || getMessageImagePreviewFitScale(preview);
  return {
    min: Math.max(MESSAGE_IMAGE_PREVIEW_MIN_SCALE, Math.min(0.25, fitScale * 0.5)),
    max: Math.max(MESSAGE_IMAGE_PREVIEW_MAX_SCALE, fitScale * 16, 1),
  };
}

function clampMessageImagePreviewOffset(preview = state.messageImagePreview) {
  if (!preview?.stage || !preview.naturalWidth || !preview.naturalHeight) return;
  const stageWidth = preview.stage.clientWidth || 1;
  const stageHeight = preview.stage.clientHeight || 1;
  const scaledWidth = preview.naturalWidth * preview.scale;
  const scaledHeight = preview.naturalHeight * preview.scale;
  const maxOffsetX = Math.max(0, (scaledWidth - stageWidth) / 2);
  const maxOffsetY = Math.max(0, (scaledHeight - stageHeight) / 2);
  preview.offsetX = maxOffsetX
    ? clampMessageImagePreviewValue(preview.offsetX, -maxOffsetX, maxOffsetX)
    : 0;
  preview.offsetY = maxOffsetY
    ? clampMessageImagePreviewValue(preview.offsetY, -maxOffsetY, maxOffsetY)
    : 0;
}

function renderMessageImagePreviewTransform(preview = state.messageImagePreview) {
  if (!preview?.img || !preview.stage || !preview.naturalWidth || !preview.naturalHeight) return;
  clampMessageImagePreviewOffset(preview);
  const stageWidth = preview.stage.clientWidth || 1;
  const stageHeight = preview.stage.clientHeight || 1;
  const x = (stageWidth - preview.naturalWidth * preview.scale) / 2 + preview.offsetX;
  const y = (stageHeight - preview.naturalHeight * preview.scale) / 2 + preview.offsetY;
  preview.img.style.width = `${preview.naturalWidth}px`;
  preview.img.style.height = `${preview.naturalHeight}px`;
  preview.img.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${preview.scale})`;
  preview.stage.classList.toggle('is-zoomed', preview.scale > (preview.fitScale || 1) * 1.02);
  if (preview.zoomLabel) {
    preview.zoomLabel.textContent = `${Math.round(preview.scale * 100)}%`;
  }
}

function setMessageImagePreviewScale(scale, anchor = null) {
  const preview = state.messageImagePreview;
  if (!preview?.naturalWidth || !preview.naturalHeight) return;

  const oldScale = preview.scale || preview.fitScale || 1;
  const bounds = getMessageImagePreviewScaleBounds(preview);
  const nextScale = clampMessageImagePreviewValue(scale, bounds.min, bounds.max);
  const stageWidth = preview.stage.clientWidth || 1;
  const stageHeight = preview.stage.clientHeight || 1;
  const anchorX = Number.isFinite(anchor?.x) ? anchor.x : stageWidth / 2;
  const anchorY = Number.isFinite(anchor?.y) ? anchor.y : stageHeight / 2;
  const oldImageX = (anchorX - ((stageWidth - preview.naturalWidth * oldScale) / 2 + preview.offsetX)) / oldScale;
  const oldImageY = (anchorY - ((stageHeight - preview.naturalHeight * oldScale) / 2 + preview.offsetY)) / oldScale;

  preview.scale = nextScale;
  preview.offsetX = anchorX - (stageWidth - preview.naturalWidth * nextScale) / 2 - oldImageX * nextScale;
  preview.offsetY = anchorY - (stageHeight - preview.naturalHeight * nextScale) / 2 - oldImageY * nextScale;
  renderMessageImagePreviewTransform(preview);
}

function fitMessageImagePreview() {
  const preview = state.messageImagePreview;
  if (!preview?.naturalWidth || !preview.naturalHeight) return;
  preview.fitScale = getMessageImagePreviewFitScale(preview);
  preview.scale = preview.fitScale;
  preview.offsetX = 0;
  preview.offsetY = 0;
  renderMessageImagePreviewTransform(preview);
}

function zoomMessageImagePreview(direction) {
  const preview = state.messageImagePreview;
  if (!preview?.naturalWidth || !preview.naturalHeight) return;
  const factor = direction > 0 ? MESSAGE_IMAGE_PREVIEW_ZOOM_STEP : 1 / MESSAGE_IMAGE_PREVIEW_ZOOM_STEP;
  setMessageImagePreviewScale(preview.scale * factor);
}

async function setMessageImagePreviewIndex(index) {
  const preview = state.messageImagePreview;
  if (!preview || !preview.items.length) return;
  const nextIndex = clampMessageImagePreviewValue(Number(index || 0), 0, preview.items.length - 1);
  const item = preview.items[nextIndex];
  const token = (preview.loadToken || 0) + 1;

  preview.index = nextIndex;
  preview.loadToken = token;
  preview.naturalWidth = 0;
  preview.naturalHeight = 0;
  preview.fitScale = 1;
  preview.scale = 1;
  preview.offsetX = 0;
  preview.offsetY = 0;
  preview.img.hidden = true;
  preview.img.removeAttribute('src');
  preview.img.alt = item.alt || '图片消息';
  if (preview.loading) {
    preview.loading.textContent = '图片加载中...';
    preview.loading.style.display = 'flex';
  }
  updateMessageImagePreviewControls(preview);

  try {
    const src = item.src || (item.attachmentId ? await loadMessageAttachmentUrl(item.attachmentScope || 'direct', item.attachmentId) : '');
    if (state.messageImagePreview !== preview || preview.loadToken !== token) return;
    if (!src) throw new Error('Missing image source');

    item.src = src;
    preview.img.src = src;
    await waitForImageReady(preview.img);
    if (state.messageImagePreview !== preview || preview.loadToken !== token) return;

    preview.naturalWidth = preview.img.naturalWidth || 1;
    preview.naturalHeight = preview.img.naturalHeight || 1;
    if (preview.loading) preview.loading.style.display = 'none';
    preview.img.hidden = false;
    fitMessageImagePreview();
  } catch {
    if (state.messageImagePreview !== preview || preview.loadToken !== token) return;
    if (preview.loading) preview.loading.textContent = '图片加载失败';
  }
}

function showMessageImagePreviewOffset(delta) {
  const preview = state.messageImagePreview;
  if (!preview) return;
  const nextIndex = preview.index + delta;
  if (nextIndex < 0 || nextIndex >= preview.items.length) return;
  setMessageImagePreviewIndex(nextIndex);
}

function showPreviousMessageImage() {
  showMessageImagePreviewOffset(-1);
}

function showNextMessageImage() {
  showMessageImagePreviewOffset(1);
}

function initMessageImagePreview({ items = [], index = 0 } = {}) {
  const stage = $('messageImageStage');
  const img = $('messageImagePreview');
  if (!stage || !img) return;

  const previewItems = items.length ? items : collectMessageImagePreviewItems();
  if (!previewItems.length) return;
  const preview = {
    stage,
    img,
    loading: $('messageImageLoading'),
    zoomLabel: $('messageImageZoomLabel'),
    counter: $('messageImageCounter'),
    previousButton: $('messageImagePreviousBtn'),
    nextButton: $('messageImageNextBtn'),
    overlayPreviousButton: $('messageImageOverlayPreviousBtn'),
    overlayNextButton: $('messageImageOverlayNextBtn'),
    items: previewItems,
    index: clampMessageImagePreviewValue(Number(index || 0), 0, previewItems.length - 1),
    loadToken: 0,
    naturalWidth: 0,
    naturalHeight: 0,
    fitScale: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    pointerId: null,
    dragStartX: 0,
    dragStartY: 0,
    dragStartOffsetX: 0,
    dragStartOffsetY: 0,
  };
  state.messageImagePreview = preview;

  const stopPan = () => {
    if (preview.pointerId !== null) {
      try {
        preview.stage.releasePointerCapture(preview.pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
    }
    preview.pointerId = null;
    preview.stage.classList.remove('is-panning');
    document.body.classList.remove('message-image-panning');
  };

  const onWheel = (event) => {
    if (!preview.naturalWidth || !preview.naturalHeight) return;
    event.preventDefault();
    const rect = preview.stage.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * 0.0016);
    setMessageImagePreviewScale(preview.scale * factor, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };

  const onPointerDown = (event) => {
    if (event.target?.closest?.('.message-image-nav-btn')) return;
    if (event.button !== 0 || !preview.naturalWidth || !preview.naturalHeight) return;
    event.preventDefault();
    preview.pointerId = event.pointerId;
    preview.dragStartX = event.clientX;
    preview.dragStartY = event.clientY;
    preview.dragStartOffsetX = preview.offsetX;
    preview.dragStartOffsetY = preview.offsetY;
    preview.stage.setPointerCapture(event.pointerId);
    preview.stage.classList.add('is-panning');
    document.body.classList.add('message-image-panning');
  };

  const onPointerMove = (event) => {
    if (event.pointerId !== preview.pointerId) return;
    event.preventDefault();
    preview.offsetX = preview.dragStartOffsetX + event.clientX - preview.dragStartX;
    preview.offsetY = preview.dragStartOffsetY + event.clientY - preview.dragStartY;
    renderMessageImagePreviewTransform(preview);
  };

  const onPointerUp = (event) => {
    if (event.pointerId === preview.pointerId) stopPan();
  };

  const onResize = () => {
    if (!preview.naturalWidth || !preview.naturalHeight) return;
    const oldFitScale = preview.fitScale;
    const wasFitToWindow = Math.abs(preview.scale - oldFitScale) < 0.01;
    preview.fitScale = getMessageImagePreviewFitScale(preview);
    if (wasFitToWindow || preview.scale < preview.fitScale) {
      preview.scale = preview.fitScale;
      preview.offsetX = 0;
      preview.offsetY = 0;
    }
    renderMessageImagePreviewTransform(preview);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showPreviousMessageImage();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      showNextMessageImage();
    }
  };

  preview.cleanup = () => {
    stopPan();
    preview.stage.removeEventListener('wheel', onWheel);
    preview.stage.removeEventListener('pointerdown', onPointerDown);
    preview.stage.removeEventListener('pointermove', onPointerMove);
    preview.stage.removeEventListener('pointerup', onPointerUp);
    preview.stage.removeEventListener('pointercancel', onPointerUp);
    preview.stage.removeEventListener('lostpointercapture', stopPan);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onResize);
  };

  preview.stage.addEventListener('wheel', onWheel, { passive: false });
  preview.stage.addEventListener('pointerdown', onPointerDown);
  preview.stage.addEventListener('pointermove', onPointerMove);
  preview.stage.addEventListener('pointerup', onPointerUp);
  preview.stage.addEventListener('pointercancel', onPointerUp);
  preview.stage.addEventListener('lostpointercapture', stopPan);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  setMessageImagePreviewIndex(preview.index);
}

function openMessageImageFromAttachment(scopeOrId, attachmentIdOrSrc = '', srcValue = '') {
  if (typeof scopeOrId === 'string' && ['direct', 'group'].includes(scopeOrId)) {
    openMessageImage(srcValue, { attachmentScope: scopeOrId, attachmentId: Number(attachmentIdOrSrc || 0) });
    return;
  }
  openMessageImage(attachmentIdOrSrc, { attachmentScope: 'direct', attachmentId: Number(scopeOrId || 0) });
}

function openMessageImage(src, options = {}) {
  if (!src && !options.attachmentId) return;
  const attachmentId = Number(options.attachmentId || 0);
  const attachmentScope = options.attachmentScope === 'group' ? 'group' : 'direct';
  const items = collectMessageImagePreviewItems();
  if (!items.length) {
    items.push({ attachmentScope, attachmentId, src, alt: '图片消息' });
  }
  const index = findMessageImagePreviewIndex(items, attachmentId, src, attachmentScope);
  openModal({
    title: '图片消息',
    body: `
      <div class="message-image-preview-shell">
        <button class="message-image-nav-btn previous" id="messageImageOverlayPreviousBtn" type="button" aria-label="上一张图片" title="上一张" onclick="showPreviousMessageImage()">‹</button>
        <div class="message-image-stage" id="messageImageStage" aria-label="图片预览" tabindex="0">
          <div class="message-image-loading" id="messageImageLoading">图片加载中...</div>
          <img id="messageImagePreview" alt="图片消息" class="message-image-preview" draggable="false" hidden />
        </div>
        <button class="message-image-nav-btn next" id="messageImageOverlayNextBtn" type="button" aria-label="下一张图片" title="下一张" onclick="showNextMessageImage()">›</button>
      </div>
    `,
    footer: `
      <div class="message-image-toolbar" aria-label="图片缩放控制">
        <button class="btn btn-secondary btn-sm message-image-zoom-btn" id="messageImagePreviousBtn" type="button" aria-label="上一张图片" title="上一张" onclick="showPreviousMessageImage()">‹</button>
        <span class="message-image-count" id="messageImageCounter">--</span>
        <button class="btn btn-secondary btn-sm message-image-zoom-btn" id="messageImageNextBtn" type="button" aria-label="下一张图片" title="下一张" onclick="showNextMessageImage()">›</button>
        <button class="btn btn-secondary btn-sm" type="button" onclick="fitMessageImagePreview()">适应窗口</button>
        <button class="btn btn-secondary btn-sm message-image-zoom-btn" type="button" aria-label="缩小" title="缩小" onclick="zoomMessageImagePreview(-1)">-</button>
        <span class="message-image-zoom-label" id="messageImageZoomLabel">--</span>
        <button class="btn btn-secondary btn-sm message-image-zoom-btn" type="button" aria-label="放大" title="放大" onclick="zoomMessageImagePreview(1)">+</button>
        <button class="btn btn-secondary btn-sm" type="button" onclick="setMessageImagePreviewScale(1)">1:1</button>
      </div>
      <button class="btn btn-secondary" onclick="closeModal()">关闭</button>
    `,
    image: true,
  });
  initMessageImagePreview({ items, index });
}

function insertTextareaNewline(textarea) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = `${textarea.value.slice(0, start)}\n${textarea.value.slice(end)}`;
  textarea.selectionStart = textarea.selectionEnd = start + 1;
  if (textarea.id === 'messageComposer') {
    saveMessageComposerDraft(textarea.dataset.messageComposerKey || textarea.dataset.messageComposerPeerId || currentMessageConversationKey(), textarea.value);
  }
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
  state.newMessagePendingFiles = [];
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
    <div class="form-group message-modal-dropzone" id="newMessageDropZone">
      <label for="newMessageFile">文件</label>
      <input type="file" id="newMessageFile" multiple onchange="updateNewMessageFileLabel(this)" />
      <div id="newMessageFileLabel" class="text-muted" style="font-size: 12px; margin-top: 6px;">支持任意文件，最大 20 MB；可拖拽到此处，或在输入框里粘贴文件。</div>
      <div class="message-drop-banner">松开以附加文件</div>
    </div>
    <div id="newMessageError" class="notice error" style="display:none"></div>
  `;
  const footer = `
    <button class="btn btn-secondary" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" id="newMessageSendBtn" onclick="sendNewMessage()">发送私信</button>
  `;
  openModal({ title: '写私信', body, footer });
  setTimeout(() => {
    $('messageRecipient')?.focus();
    initNewMessageComposerInteractions();
  }, 50);
}

function showCreateMessageGroupModal() {
  state.newGroupMembers = [];
  const body = `
    <div class="form-group">
      <label for="newGroupName">群聊名称</label>
      <input type="text" id="newGroupName" maxlength="80" placeholder="例如：竞赛讨论组" autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="newGroupMemberSearch">添加成员</label>
      <input type="text" id="newGroupMemberSearch" placeholder="搜索用户名" autocomplete="off" oninput="searchMessageGroupUsers(this.value)" />
      <div id="newGroupSelectedMembers" class="message-selected-users"></div>
      <div id="messageGroupUserResults" class="message-user-results"></div>
    </div>
    <div id="newGroupError" class="notice error" style="display:none"></div>
  `;
  const footer = `
    <button class="btn btn-secondary" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" id="newGroupCreateBtn" onclick="createMessageGroup()">创建群聊</button>
  `;
  openModal({ title: '新建群聊', body, footer });
  setTimeout(() => {
    renderSelectedMessageGroupMembers();
    $('newGroupName')?.focus();
  }, 50);
}

function renderSelectedMessageGroupMembers() {
  const wrap = $('newGroupSelectedMembers');
  if (!wrap) return;
  const members = state.newGroupMembers || [];
  wrap.innerHTML = members.length
    ? members.map(member => `
      <span class="message-selected-user">
        ${renderMessageAvatar(member.username, member.avatar_url, 'small')}
        <span>${esc(member.username)}</span>
        <button type="button" aria-label="移除成员" title="移除成员" onclick="removeMessageGroupMember(${member.id})">×</button>
      </span>
    `).join('')
    : '<span class="text-muted" style="font-size: 12px;">至少选择 1 位成员，当前用户会自动加入。</span>';
}

let messageGroupUserSearchTimer = null;

function searchMessageGroupUsers(query) {
  const resultsEl = $('messageGroupUserResults');
  if (!resultsEl) return;

  const q = String(query || '').trim();
  if (!q) {
    resultsEl.innerHTML = '';
    return;
  }

  clearTimeout(messageGroupUserSearchTimer);
  messageGroupUserSearchTimer = setTimeout(async () => {
    try {
      const selectedIds = new Set((state.newGroupMembers || []).map(member => Number(member.id)));
      const data = await api(`/api/messages/users?q=${encodeURIComponent(q)}&limit=10`, { headers: authHeaders() });
      const users = (data.items || []).filter(user => !selectedIds.has(Number(user.id)));
      resultsEl.innerHTML = users.length === 0
        ? `<div class="message-user-result muted">未找到可添加用户</div>`
        : users.map(u => `
          <button type="button" class="message-user-result" onclick="selectMessageGroupMember(${u.id}, ${jsArg(u.username)}, ${jsArg(u.role || 'USER')}, ${jsArg(u.avatar_url || '')})">
            ${renderMessageAvatar(u.username, u.avatar_url, 'small')}
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

function selectMessageGroupMember(userId, username, role = 'USER', avatarUrl = '') {
  const id = Number(userId || 0);
  if (!id || id === Number(state.user?.id || 0)) return;
  if (!(state.newGroupMembers || []).some(member => Number(member.id) === id)) {
    state.newGroupMembers.push({ id, username, role, avatar_url: avatarUrl });
  }
  if ($('newGroupMemberSearch')) $('newGroupMemberSearch').value = '';
  if ($('messageGroupUserResults')) $('messageGroupUserResults').innerHTML = '';
  renderSelectedMessageGroupMembers();
  $('newGroupMemberSearch')?.focus();
}

function removeMessageGroupMember(userId) {
  const id = Number(userId || 0);
  state.newGroupMembers = (state.newGroupMembers || []).filter(member => Number(member.id) !== id);
  renderSelectedMessageGroupMembers();
}

async function createMessageGroup() {
  const btn = $('newGroupCreateBtn');
  const errEl = $('newGroupError');
  const name = $('newGroupName')?.value.trim();
  const memberIds = (state.newGroupMembers || []).map(member => Number(member.id)).filter(Boolean);

  if (!name) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = '请填写群聊名称。'; }
    return;
  }
  if (memberIds.length === 0) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = '请至少添加 1 位成员。'; }
    return;
  }

  try {
    if (btn) { btn.disabled = true; btn.textContent = '创建中...'; }
    const data = await api('/api/messages/groups', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, member_ids: memberIds }),
    });
    closeModal();
    state.newGroupMembers = [];
    toast('群聊已创建', 'success');
    openMessageConversation(messageConversationKey('group', data.group?.id));
  } catch (err) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = err.message; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '创建群聊'; }
  }
}

async function loadMessageGroupSettings(groupId) {
  const data = await api(`/api/messages/groups/${Number(groupId)}/members`, { headers: authHeaders() });
  state.groupSettingsGroup = data.group || {};
  state.groupSettingsPendingMembers = [];
  return state.groupSettingsGroup;
}

function groupRoleLabel(role) {
  if (role === 'OWNER') return '群主';
  if (role === 'ADMIN') return '管理员';
  return '成员';
}

function renderGroupSettingsPendingMembers() {
  const wrap = $('groupSettingsPendingMembers');
  if (!wrap) return;
  const members = state.groupSettingsPendingMembers || [];
  wrap.innerHTML = members.length
    ? members.map(member => `
      <span class="message-selected-user">
        ${renderMessageAvatar(member.username, member.avatar_url, 'small')}
        <span>${esc(member.username)}</span>
        <button type="button" aria-label="移除待添加成员" title="移除" onclick="removeGroupSettingsPendingMember(${member.id})">×</button>
      </span>
    `).join('')
    : '<span class="text-muted" style="font-size: 12px;">搜索并选择要加入群聊的用户。</span>';
}

function renderMessageGroupSettingsModal(group) {
  const members = group.members || [];
  const canManage = !!group.can_manage;
  const groupId = Number(group.id || group.group_id || 0);
  const body = `
    <div class="message-group-settings">
      <div class="form-group">
        <label for="messageGroupNameInput">群聊名称</label>
        <div class="row gap-sm" style="align-items: center;">
          <input type="text" id="messageGroupNameInput" maxlength="80" value="${esc(group.name || group.group_name || '')}" ${canManage ? '' : 'disabled'} />
          ${canManage ? `<button class="btn btn-secondary" type="button" onclick="saveMessageGroupName(${groupId})">保存</button>` : ''}
        </div>
      </div>

      <div class="form-group">
        <label for="messageGroupNicknameInput">我的群昵称</label>
        <div class="row gap-sm" style="align-items: center;">
          <input type="text" id="messageGroupNicknameInput" maxlength="50" value="${esc(group.current_user_group_nickname || state.user?.username || '')}" placeholder="留空恢复为用户名" />
          <button class="btn btn-secondary" type="button" onclick="saveMessageGroupNickname(${groupId})">保存</button>
        </div>
      </div>

      ${canManage ? `
        <div class="form-group">
          <label for="groupSettingsMemberSearch">添加成员</label>
          <input type="text" id="groupSettingsMemberSearch" placeholder="搜索用户名" autocomplete="off" oninput="searchGroupSettingsUsers(this.value)" />
          <div id="groupSettingsPendingMembers" class="message-selected-users"></div>
          <div id="groupSettingsUserResults" class="message-user-results"></div>
          <button class="btn btn-primary btn-sm mt-sm" type="button" onclick="addGroupSettingsMembers(${groupId})">加入群聊</button>
        </div>
      ` : ''}

      <div class="message-group-tools">
        <button class="btn btn-secondary btn-sm" type="button" onclick="showGroupAnnouncementsModal(${groupId})">群公告</button>
        ${canManage ? `<button class="btn btn-secondary btn-sm" type="button" onclick="createGroupInviteFromSettings(${groupId})">生成邀请</button>` : ''}
      </div>

      <div class="message-group-member-list">
        ${members.map(member => {
          const isSelf = Number(member.id) === Number(state.user?.id || 0);
          const isOwner = member.member_role === 'OWNER';
          const displayName = groupNickname(member, member.username);
          const detailText = [
            displayName !== member.username ? `@${member.username}` : '',
            groupRoleLabel(member.member_role),
            messagePresenceLabel(member),
            member.role || 'USER',
          ].filter(Boolean).join(' · ');
          return `
            <div class="message-group-member">
              ${renderMessageAvatar(displayName, member.avatar_url, `small${isOwner ? ' group' : ''}`)}
              <span class="message-group-member-main">
                <strong>${esc(displayName)}${isSelf ? '（我）' : ''}</strong>
                <span>${esc(detailText)}</span>
              </span>
              <span class="message-group-member-actions">
                <button class="btn btn-secondary btn-sm" type="button" onclick="insertGroupMention(${jsArg(member.username)})">@</button>
                ${group.can_transfer_owner && !isSelf && !isOwner ? `
                  <select class="message-member-role-select" onchange="updateMessageGroupMemberRoleFromSettings(${groupId}, ${member.id}, this.value)">
                    <option value="MEMBER" ${member.member_role === 'MEMBER' ? 'selected' : ''}>成员</option>
                    <option value="ADMIN" ${member.member_role === 'ADMIN' ? 'selected' : ''}>管理员</option>
                  </select>
                  <button class="btn btn-secondary btn-sm" type="button" onclick="transferMessageGroupOwnerFromSettings(${groupId}, ${member.id}, ${jsArg(displayName)})">转让</button>
                ` : ''}
                ${canManage && !isSelf && !isOwner ? `<button class="btn btn-secondary btn-sm text-danger" type="button" onclick="removeMessageGroupMemberFromSettings(${groupId}, ${member.id}, ${jsArg(displayName)})">移除</button>` : ''}
              </span>
            </div>
          `;
        }).join('')}
      </div>
      <div id="messageGroupSettingsError" class="notice error" style="display:none"></div>
    </div>
  `;
  const footer = `
    <button class="btn btn-secondary" onclick="closeModal()">关闭</button>
    <button class="btn btn-secondary text-danger" onclick="leaveMessageGroup(${groupId})">退出群聊</button>
    ${canManage ? `<button class="btn btn-secondary text-danger" onclick="deleteMessageGroup(${groupId})">解散群聊</button>` : ''}
  `;
  openModal({ title: '群设置', body, footer, wide: true });
  renderGroupSettingsPendingMembers();
}

async function showMessageGroupSettings(groupId = null) {
  const target = groupId ? messageConversationKey('group', groupId) : currentMessageConversationKey();
  const parsed = parseMessageConversationKey(target, 'group');
  if (parsed.type !== 'group' || !parsed.id) return;
  openModal({
    title: '群设置',
    body: '<div class="message-empty-panel"><div class="spinner-ring"></div><div class="text-muted mt-md">正在加载群设置...</div></div>',
    footer: '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>',
    wide: true,
  });
  try {
    const group = await loadMessageGroupSettings(parsed.id);
    renderMessageGroupSettingsModal(group);
  } catch (err) {
    $('modalBody').innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
  }
}

function setMessageGroupSettingsError(message = '') {
  const el = $('messageGroupSettingsError');
  if (!el) return;
  el.style.display = message ? '' : 'none';
  el.textContent = message;
}

async function refreshMessageGroupSettings(groupId) {
  const group = await loadMessageGroupSettings(groupId);
  renderMessageGroupSettingsModal(group);
  await refreshMessages(messageConversationKey('group', groupId), { preserveComposer: true });
}

async function saveMessageGroupName(groupId) {
  const name = $('messageGroupNameInput')?.value.trim();
  if (!name) {
    setMessageGroupSettingsError('请填写群聊名称。');
    return;
  }
  try {
    await api(`/api/messages/groups/${Number(groupId)}`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    toast('群聊名称已更新', 'success');
    await refreshMessageGroupSettings(groupId);
  } catch (err) {
    setMessageGroupSettingsError(err.message);
  }
}

async function saveMessageGroupNickname(groupId) {
  const nicknameInput = $('messageGroupNicknameInput');
  const rawValue = nicknameInput?.value ?? '';
  try {
    await api(`/api/messages/groups/${Number(groupId)}`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_nickname: rawValue }),
    });
    toast(rawValue.trim() ? '群昵称已更新' : '已恢复默认群昵称', 'success');
    await refreshMessageGroupSettings(groupId);
  } catch (err) {
    setMessageGroupSettingsError(err.message);
  }
}

let groupSettingsUserSearchTimer = null;

function searchGroupSettingsUsers(query) {
  const resultsEl = $('groupSettingsUserResults');
  if (!resultsEl) return;
  const q = String(query || '').trim();
  if (!q) {
    resultsEl.innerHTML = '';
    return;
  }
  clearTimeout(groupSettingsUserSearchTimer);
  groupSettingsUserSearchTimer = setTimeout(async () => {
    try {
      const group = state.groupSettingsGroup || {};
      const existingIds = new Set((group.members || []).map(member => Number(member.id)));
      const pendingIds = new Set((state.groupSettingsPendingMembers || []).map(member => Number(member.id)));
      const data = await api(`/api/messages/users?q=${encodeURIComponent(q)}&limit=10`, { headers: authHeaders() });
      const users = (data.items || []).filter(user => !existingIds.has(Number(user.id)) && !pendingIds.has(Number(user.id)));
      resultsEl.innerHTML = users.length === 0
        ? `<div class="message-user-result muted">未找到可添加用户</div>`
        : users.map(u => `
          <button type="button" class="message-user-result" onclick="selectGroupSettingsMember(${u.id}, ${jsArg(u.username)}, ${jsArg(u.role || 'USER')}, ${jsArg(u.avatar_url || '')})">
            ${renderMessageAvatar(u.username, u.avatar_url, 'small')}
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

function selectGroupSettingsMember(userId, username, role = 'USER', avatarUrl = '') {
  const id = Number(userId || 0);
  if (!id) return;
  if (!(state.groupSettingsPendingMembers || []).some(member => Number(member.id) === id)) {
    state.groupSettingsPendingMembers.push({ id, username, role, avatar_url: avatarUrl });
  }
  if ($('groupSettingsMemberSearch')) $('groupSettingsMemberSearch').value = '';
  if ($('groupSettingsUserResults')) $('groupSettingsUserResults').innerHTML = '';
  renderGroupSettingsPendingMembers();
}

function removeGroupSettingsPendingMember(userId) {
  const id = Number(userId || 0);
  state.groupSettingsPendingMembers = (state.groupSettingsPendingMembers || []).filter(member => Number(member.id) !== id);
  renderGroupSettingsPendingMembers();
}

async function addGroupSettingsMembers(groupId) {
  const memberIds = (state.groupSettingsPendingMembers || []).map(member => Number(member.id)).filter(Boolean);
  if (!memberIds.length) {
    setMessageGroupSettingsError('请选择要添加的成员。');
    return;
  }
  try {
    await api(`/api/messages/groups/${Number(groupId)}/members`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_ids: memberIds }),
    });
    toast('成员已加入群聊', 'success');
    await refreshMessageGroupSettings(groupId);
  } catch (err) {
    setMessageGroupSettingsError(err.message);
  }
}

async function removeMessageGroupMemberFromSettings(groupId, memberId, username) {
  const reason = prompt(`确认将 ${username} 移出群聊吗？可填写原因：`, '') ?? null;
  if (reason === null) return;
  try {
    await ChatApi.removeGroupMember(groupId, memberId, reason);
    toast('成员已移除', 'success');
    await refreshMessageGroupSettings(groupId);
  } catch (err) {
    setMessageGroupSettingsError(err.message);
  }
}

async function updateMessageGroupMemberRoleFromSettings(groupId, memberId, role) {
  try {
    await ChatApi.updateGroupMemberRole(groupId, memberId, role);
    toast('成员角色已更新', 'success');
    await refreshMessageGroupSettings(groupId);
  } catch (err) {
    setMessageGroupSettingsError(err.message);
    await refreshMessageGroupSettings(groupId);
  }
}

async function transferMessageGroupOwnerFromSettings(groupId, memberId, username) {
  if (!confirm(`确认将群主转让给 ${username} 吗？转让后你将不再拥有群管理权限。`)) return;
  try {
    await api(`/api/messages/groups/${Number(groupId)}/transfer-owner`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_owner_id: Number(memberId) }),
    });
    toast('群主已转让', 'success');
    await refreshMessageGroupSettings(groupId);
  } catch (err) {
    setMessageGroupSettingsError(err.message);
  }
}

function renderGroupAnnouncements(items = [], groupId = 0, canManage = false) {
  return `
    ${canManage ? `
      <div class="form-group">
        <label for="groupAnnouncementBody">发布公告</label>
        <textarea id="groupAnnouncementBody" rows="4" maxlength="4000" placeholder="输入群公告内容"></textarea>
        <button class="btn btn-primary btn-sm mt-sm" onclick="createGroupAnnouncement(${Number(groupId)})">发布</button>
      </div>
    ` : ''}
    <div class="message-announcement-list">
      ${items.length ? items.map((item) => `
        <div class="message-announcement-item">
          <div>
            <strong>${esc(item.author_username || '成员')}</strong>
            <div class="text-muted">${esc(formatDate(item.created_at))}</div>
            <div>${renderMd(item.body_md || '')}</div>
          </div>
          ${canManage ? `<button class="btn btn-secondary btn-sm text-danger" onclick="deleteGroupAnnouncement(${Number(groupId)}, ${Number(item.id)})">删除</button>` : ''}
        </div>
      `).join('') : '<div class="message-empty-panel"><div class="text-muted">暂无群公告</div></div>'}
    </div>
    <div id="groupAnnouncementError" class="notice error" style="display:none"></div>
  `;
}

async function showGroupAnnouncementsModal(groupId) {
  const group = state.groupSettingsGroup || state.messageActiveGroup || {};
  const canManage = !!group.can_manage;
  openModal({
    title: '群公告',
    body: '<div class="text-muted">正在加载...</div>',
    footer: '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>',
    wide: true,
  });
  try {
    const data = await ChatApi.listAnnouncements(groupId);
    $('modalBody').innerHTML = renderGroupAnnouncements(data.items || [], groupId, canManage);
  } catch (err) {
    $('modalBody').innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
  }
}

async function createGroupAnnouncement(groupId) {
  const body = $('groupAnnouncementBody')?.value.trim() || '';
  const errEl = $('groupAnnouncementError');
  if (!body) {
    if (errEl) {
      errEl.style.display = '';
      errEl.textContent = '请输入公告内容。';
    }
    return;
  }
  try {
    await ChatApi.createAnnouncement(groupId, { body_md: body, is_pinned: true });
    toast('群公告已发布', 'success');
    await showGroupAnnouncementsModal(groupId);
  } catch (err) {
    if (errEl) {
      errEl.style.display = '';
      errEl.textContent = err.message;
    }
  }
}

async function deleteGroupAnnouncement(groupId, announcementId) {
  if (!confirm('确认删除这条群公告吗？')) return;
  try {
    await ChatApi.deleteAnnouncement(groupId, announcementId);
    toast('群公告已删除', 'success');
    await showGroupAnnouncementsModal(groupId);
  } catch (err) {
    toast(`删除群公告失败: ${err.message}`, 'error');
  }
}

async function createGroupInviteFromSettings(groupId) {
  try {
    const data = await ChatApi.createGroupInvite(groupId, { expires_minutes: 1440, max_uses: 20 });
    const inviteCode = data.invite?.invite_code || data.invite_code || '';
    await navigator.clipboard?.writeText?.(inviteCode);
    toast(inviteCode ? `邀请已生成：${inviteCode}` : '邀请已生成', 'success');
  } catch (err) {
    setMessageGroupSettingsError(err.message);
  }
}

async function leaveMessageGroup(groupId) {
  if (!confirm('确认退出该群聊吗？')) return;
  try {
    await api(`/api/messages/groups/${Number(groupId)}/leave`, {
      method: 'POST',
      headers: authHeaders(),
    });
    closeModal();
    toast('已退出群聊', 'success');
    history.pushState(null, '', isChatApp() ? '/' : '/messages');
    await renderMessages(null, { silent: true, preserveComposer: false });
  } catch (err) {
    setMessageGroupSettingsError(err.message);
  }
}

async function deleteMessageGroup(groupId) {
  if (!confirm('确认解散该群聊吗？此操作会移除所有成员并删除群会话。')) return;
  try {
    await api(`/api/messages/groups/${Number(groupId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    closeModal();
    toast('群聊已解散', 'success');
    history.pushState(null, '', isChatApp() ? '/' : '/messages');
    await renderMessages(null, { silent: true, preserveComposer: false });
  } catch (err) {
    setMessageGroupSettingsError(err.message);
  }
}

function insertGroupMention(username) {
  const composer = $('messageComposer');
  if (!composer) {
    closeModal();
    return;
  }
  const mention = username === 'all' ? '@all ' : `@${username} `;
  const value = composer.value || '';
  const start = composer.selectionStart ?? value.length;
  const end = composer.selectionEnd ?? value.length;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const gap = before && !/\s$/.test(before) ? ' ' : '';
  composer.value = `${before}${gap}${mention}${after}`;
  const cursor = before.length + gap.length + mention.length;
  composer.focus();
  composer.setSelectionRange(cursor, cursor);
  saveMessageComposerDraft(currentMessageConversationKey(), composer.value);
  closeModal();
}

async function showGroupMentionModal(groupId = null) {
  const parsed = parseMessageConversationKey(groupId ? messageConversationKey('group', groupId) : currentMessageConversationKey(), 'group');
  if (parsed.type !== 'group' || !parsed.id) return;
  let group = state.messageActiveGroup && Number(state.messageActiveGroup.id || state.messageActiveGroup.group_id) === Number(parsed.id)
    ? state.messageActiveGroup
    : null;
  if (!Array.isArray(group?.members)) {
    try {
      group = await loadMessageGroupSettings(parsed.id);
    } catch (err) {
      openModal({
        title: '@ 成员',
        body: `<div class="notice error">${esc(err.message)}</div>`,
        footer: '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>',
      });
      return;
    }
  }
  const members = group.members || [];
  openModal({
    title: '@ 成员',
    body: `
      <div class="message-group-member-list">
        <button type="button" class="message-user-result" onclick="insertGroupMention('all')">
          <span class="message-avatar small group">@</span>
          <span><strong>@all</strong><span class="text-muted">通知所有群成员</span></span>
        </button>
        ${members.map(member => {
          const displayName = groupNickname(member, member.username);
          const detailText = [
            displayName !== member.username ? `@${member.username}` : '',
            groupRoleLabel(member.member_role),
          ].filter(Boolean).join(' · ');
          return `
            <button type="button" class="message-user-result" onclick="insertGroupMention(${jsArg(member.username)})">
              ${renderMessageAvatar(displayName, member.avatar_url, 'small')}
              <span><strong>${esc(displayName)}</strong><span class="text-muted">${esc(detailText)}</span></span>
            </button>
          `;
        }).join('')}
      </div>
    `,
    footer: '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>',
  });
}

function updateNewMessageFileLabel(input, explicitFiles = null) {
  const label = $('newMessageFileLabel');
  const files = normalizeMessageFiles(explicitFiles || input?.files);
  state.newMessagePendingFiles = files;
  if (!label) return;
  label.textContent = summarizeMessageFiles(files) || '支持任意文件，最大 20 MB；可拖拽到此处，或在输入框里粘贴文件。';
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
            ${renderMessageAvatar(u.username, u.avatar_url, 'small')}
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
  const attachedFiles = normalizeMessageFiles(state.newMessagePendingFiles.length ? state.newMessagePendingFiles : $('newMessageFile')?.files);

  if (!recipient && !recipientId) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = '请填写收件人。'; }
    return;
  }
  if (!body && !attachedFiles.length) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = '请填写私信内容或选择文件。'; }
    return;
  }
  const fileError = messageFileValidationError(attachedFiles);
  if (fileError) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = fileError; }
    return;
  }

  try {
    if (btn) { btn.disabled = true; btn.textContent = '发送中...'; }
    let data;
    if (attachedFiles.length) {
      data = await uploadDirectMessageFiles({
        recipientId: recipientId ? Number(recipientId) : null,
        recipient,
        body: body || '',
        files: attachedFiles,
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
    state.newMessagePendingFiles = [];
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
  const target = parseMessageConversationKey(peerId);
  const textarea = $('messageComposer');
  const body = textarea?.value.trim();
  const replyTarget = currentMessageReplyTarget(target.key);
  if (!body) {
    toast('请输入消息内容', 'warning');
    return;
  }

  if (textarea) textarea.value = '';
  clearMessageComposerDraft(target.key);
  clearMessageReplyTarget(target.key);
  closeMessageEmojiPanel();
  await queueTransientMessage(target.key, {
    body,
    files: [],
    replyTarget,
    focusComposer: true,
  });
}

function isAllowedMessageFile(file) {
  if (!file) return false;
  return file.size > 0 && file.size <= MESSAGE_FILE_SIZE_LIMIT_BYTES;
}

async function sendFileToPeer(peerId, input) {
  const target = parseMessageConversationKey(peerId);
  const files = normalizeMessageFiles(input?.files);
  if (!files.length) return;
  const fileError = messageFileValidationError(files);
  if (fileError) {
    input.value = '';
    toast(fileError, 'warning');
    return;
  }

  await sendFilesToPeer(target.key, files, { input });
}

function scheduleMessageTyping(conversationKey) {
  const target = parseMessageConversationKey(conversationKey);
  if (!target.key || !state.user) return;
  const send = async () => {
    state.messageTypingTimer = null;
    state.messageTypingLastSentAt = Date.now();
    try {
      await ChatApi.sendTyping({
        conversation_type: target.type,
        conversation_id: target.id,
      });
    } catch {
      // Typing state is opportunistic; message sending remains the source of truth.
    }
  };
  const elapsed = Date.now() - Number(state.messageTypingLastSentAt || 0);
  if (elapsed > 2500) {
    if (state.messageTypingTimer) {
      clearTimeout(state.messageTypingTimer);
      state.messageTypingTimer = null;
    }
    void send();
    return;
  }
  if (!state.messageTypingTimer) {
    state.messageTypingTimer = setTimeout(send, Math.max(400, 2500 - elapsed));
  }
}

function initMessageComposerInteractions(peerId) {
  const target = parseMessageConversationKey(peerId);
  const composer = $('messageComposer');
  const composerWrap = $('messageComposerWrap');
  if (!composer || !composerWrap) return;

  composer.addEventListener('input', () => {
    saveMessageComposerDraft(target.key, composer.value);
    if (composer.value.trim()) scheduleMessageTyping(target.key);
  });

  composer.addEventListener('paste', (event) => {
    const files = extractMessageFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    void sendFilesToPeer(target.key, files);
  });

  bindMessageDropZone(composerWrap, (files) => {
    void sendFilesToPeer(target.key, files);
  });
}

function initNewMessageComposerInteractions() {
  const composer = $('newMessageBody');
  const dropZone = $('newMessageDropZone');
  const input = $('newMessageFile');
  if (!composer || !dropZone || !input) return;

  composer.addEventListener('paste', (event) => {
    const files = extractMessageFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    setInputFiles(input, files);
    updateNewMessageFileLabel(input, files);
  });

  bindMessageDropZone(dropZone, (files) => {
    setInputFiles(input, files);
    updateNewMessageFileLabel(input, files);
  });
}

function renderMessageComposerPanel(conversationKey) {
  const key = parseMessageConversationKey(conversationKey).key;
  if (!key || state.messageEmojiPanelConversationKey !== key) return '';
  const recentEmojis = storedRecentEmojis();
  const gifFavorites = storedGifFavorites();
  return `
    <div class="message-composer-panel" id="messageComposerPanel">
      ${recentEmojis.length ? `
        <div class="message-composer-panel-section">
          <div class="message-composer-panel-title">最近使用</div>
          <div class="message-emoji-grid">
            ${recentEmojis.map((emoji) => `<button class="message-emoji-btn recent" type="button" onclick="insertMessageEmoji(${jsArg(emoji)})">${emoji}</button>`).join('')}
          </div>
        </div>
      ` : ''}
      <div class="message-composer-panel-section">
        <div class="message-composer-panel-title">Emoji</div>
        <div class="message-emoji-grid">
          ${MESSAGE_BUILTIN_EMOJIS.map((emoji) => `<button class="message-emoji-btn" type="button" onclick="insertMessageEmoji(${jsArg(emoji)})">${emoji}</button>`).join('')}
        </div>
      </div>
      <div class="message-composer-panel-section">
        <div class="message-composer-panel-title">GIF 收藏</div>
        <div class="message-gif-grid">
          <div class="message-gif-tile">
            <label class="message-gif-btn message-gif-add" for="messageGifFavoriteInput" title="添加 GIF" aria-label="添加 GIF">
              <span aria-hidden="true">+</span>
            </label>
            <input type="file" id="messageGifFavoriteInput" accept="image/gif" multiple style="display:none" onchange="addMessageGifFavorites(${jsArg(key)}, this)" />
          </div>
          ${gifFavorites.map((item) => `
            <div class="message-gif-tile">
              <button class="message-gif-btn" type="button" onclick="sendFavoriteGif(${jsArg(key)}, ${jsArg(item.id)})">
                <img src="${esc(item.data_url)}" alt="${esc(item.name || 'GIF 表情')}" loading="lazy" />
              </button>
              <button class="message-gif-remove" type="button" aria-label="移除 GIF" onclick="removeMessageGifFavorite(${jsArg(item.id)})">×</button>
            </div>
          `).join('')}
        </div>
        ${gifFavorites.length ? '' : `<div class="text-muted" style="font-size: 12px;">还没有收藏 GIF，点加号就能放进来。</div>`}
      </div>
    </div>
  `;
}

function updateMessageComposerPanel() {
  const wrap = $('messageComposerWrap');
  if (!wrap) return;
  const currentKey = currentMessageConversationKey();
  const nextHtml = renderMessageComposerPanel(currentKey);
  const currentPanel = $('messageComposerPanel');
  if (!nextHtml) {
    if (currentPanel) currentPanel.remove();
    return;
  }
  if (currentPanel) {
    currentPanel.outerHTML = nextHtml;
    return;
  }
  const replyBanner = $('messageReplyBanner');
  if (replyBanner) {
    replyBanner.insertAdjacentHTML('afterend', nextHtml);
  } else {
    wrap.insertAdjacentHTML('afterbegin', nextHtml);
  }
}

function closeMessageEmojiPanel() {
  state.messageEmojiPanelConversationKey = '';
  updateMessageComposerPanel();
}

function toggleMessageEmojiPanel(conversationKey) {
  const key = parseMessageConversationKey(conversationKey).key;
  state.messageEmojiPanelConversationKey = state.messageEmojiPanelConversationKey === key ? '' : key;
  updateMessageComposerPanel();
}

function insertMessageEmoji(emoji) {
  rememberRecentEmoji(emoji);
  insertComposerText(String(emoji || ''));
  updateMessageComposerPanel();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取 GIF 失败'));
    reader.readAsDataURL(file);
  });
}

async function addMessageGifFavorites(conversationKey, input) {
  const files = normalizeMessageFiles(input?.files).filter((file) => (file.type || '').includes('gif'));
  if (input) input.value = '';
  if (!files.length) {
    toast('请选择 GIF 文件', 'warning');
    return;
  }
  const tooLarge = files.find((file) => Number(file.size || 0) > MESSAGE_GIF_FAVORITE_MAX_BYTES);
  if (tooLarge) {
    toast(`GIF ${tooLarge.name || '未命名文件'} 超过 2 MB，暂时不建议加入收藏。`, 'warning');
    return;
  }
  try {
    const existing = storedGifFavorites();
    const rawAdditions = await Promise.all(files.slice(0, MESSAGE_GIF_FAVORITE_MAX_ITEMS).map(async (file) => ({
      id: newGifFavoriteId(),
      name: file.name || 'sticker.gif',
      data_url: await fileToDataUrl(file),
      size_bytes: Number(file.size || 0),
      content_type: 'image/gif',
      added_at: new Date().toISOString(),
    })));
    const seenDataUrls = new Set(existing.map((item) => item.data_url).filter(Boolean));
    const additions = rawAdditions.filter((entry) => {
      if (!entry.data_url || seenDataUrls.has(entry.data_url)) return false;
      seenDataUrls.add(entry.data_url);
      return true;
    });
    if (!additions.length) {
      toast('所选 GIF 已在表情里', 'info');
      return;
    }
    saveGifFavorites([...additions, ...existing].slice(0, MESSAGE_GIF_FAVORITE_MAX_ITEMS));
    state.messageEmojiPanelConversationKey = parseMessageConversationKey(conversationKey).key;
    updateMessageComposerPanel();
    toast(`已加入 ${additions.length} 个 GIF 收藏`, 'success');
  } catch (err) {
    toast(`添加 GIF 失败: ${err.message}`, 'error');
  }
}

function removeMessageGifFavorite(gifId) {
  saveGifFavorites(storedGifFavorites().filter((item) => item.id !== gifId));
  updateMessageComposerPanel();
}

async function sendFavoriteGif(conversationKey, gifId) {
  const item = storedGifFavorites().find((entry) => entry.id === gifId);
  if (!item) return;
  try {
    const file = await dataUrlToFile(item.data_url, fileNameFromDataUrl(item));
    await sendFilesToPeer(conversationKey, [file], { fromFavoriteGif: true });
  } catch (err) {
    toast(`发送 GIF 失败: ${err.message}`, 'error');
  }
}

async function addMessageGifFavoriteFromMessage(messageId) {
  const message = currentThreadMessage(messageId);
  closeMessageActionMenu();
  if (!message || !isGifMessageAttachment(message)) return;

  const sourceKey = messageGifFavoriteSourceKey(message);
  if (isGifFavoriteStored({ sourceKey })) {
    toast('这个 GIF 已在表情里', 'info');
    return;
  }

  const knownSize = Number(message.attachment_size_bytes || 0);
  if (knownSize > MESSAGE_GIF_FAVORITE_MAX_BYTES) {
    toast(`GIF 超过 ${formatFileSize(MESSAGE_GIF_FAVORITE_MAX_BYTES)}，无法加入表情。`, 'warning');
    return;
  }

  try {
    let url = message.attachment_local_url || '';
    if (!url) {
      const scope = message.attachment_scope || message.message_type || (message.group_id ? 'group' : 'direct');
      const attachmentId = message.attachment_id || message.id;
      url = await loadMessageAttachmentUrl(scope, attachmentId);
    }
    if (!url) throw new Error('找不到 GIF 附件');

    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const blob = await response.blob();
    if (blob.size > MESSAGE_GIF_FAVORITE_MAX_BYTES) {
      toast(`GIF 超过 ${formatFileSize(MESSAGE_GIF_FAVORITE_MAX_BYTES)}，无法加入表情。`, 'warning');
      return;
    }

    const dataUrl = await fileToDataUrl(blob);
    if (isGifFavoriteStored({ sourceKey, dataUrl })) {
      toast('这个 GIF 已在表情里', 'info');
      return;
    }

    const existing = storedGifFavorites();
    saveGifFavorites([
      {
        id: newGifFavoriteId(),
        name: message.attachment_filename || 'sticker.gif',
        data_url: dataUrl,
        source_key: sourceKey,
        size_bytes: Number(blob.size || knownSize || 0),
        content_type: 'image/gif',
        added_at: new Date().toISOString(),
      },
      ...existing,
    ]);
    updateMessageComposerPanel();
    toast('已添加到表情', 'success');
  } catch (err) {
    toast(`添加 GIF 失败: ${err.message}`, 'error');
  }
}

function findTransientMessageByLocalId(localId) {
  const targetId = String(localId || '');
  for (const [conversationKey, items] of state.messageTransientItems.entries()) {
    const index = items.findIndex((item) => String(item?.local_id || '') === targetId);
    if (index >= 0) {
      return { conversationKey, index, item: items[index] };
    }
  }
  return null;
}

function dismissTransientMessage(localId) {
  const match = findTransientMessageByLocalId(localId);
  if (!match) return;
  closeMessageActionMenu();
  removeTransientMessage(match.conversationKey, localId);
  if (currentMessageConversationKey() === match.conversationKey) {
    void refreshMessages(match.conversationKey, { preserveComposer: true, scrollToBottom: false, preferUnread: false });
  }
}

async function performTransientSend(item, { focusComposer = false } = {}) {
  const target = parseMessageConversationKey(item?.conversation_key || '');
  if (!target.key) return;
  try {
    if (item.has_attachment) {
      const response = await uploadMessageFiles({
        conversationType: target.type,
        recipientId: target.type === 'direct' ? Number(target.id) : null,
        groupId: target.type === 'group' ? Number(target.id) : null,
        body: item.retry_payload?.body || '',
        replyToMessageId: item.retry_payload?.replyTarget?.messageId || null,
        files: item.retry_payload?.files || [],
        conversationKey: target.key,
        localId: item.local_id,
      });

      // Seed the caches (in-memory URL and persistent IndexedDB blob) with the local file
      if (response && response.message && item.attachment_local_url) {
        const msg = response.message;
        const scope = msg.group_id ? 'group' : 'direct';
        const attachmentId = msg.attachment_id || msg.id;
        if (attachmentId) {
          const cacheKey = messageAttachmentCacheKey(scope, attachmentId);
          state.messageAttachmentCache.set(cacheKey, { url: item.attachment_local_url });
          if (item.retry_payload?.files?.[0]) {
            void AttachmentDB.set(cacheKey, item.retry_payload.files[0]);
          }
        }
      }
    } else if (target.type === 'group') {
      await api(`/api/messages/groups/${target.id}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body_md: item.retry_payload?.body || '',
          reply_to_message_id: item.retry_payload?.replyTarget?.messageId || null,
        }),
      });
    } else {
      await api('/api/messages', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_id: Number(target.id),
          body_md: item.retry_payload?.body || '',
          reply_to_message_id: item.retry_payload?.replyTarget?.messageId || null,
        }),
      });
    }
    removeTransientMessage(target.key, item.local_id);
    if (currentMessageConversationKey() === target.key) {
      await refreshMessages(target.key, {
        preserveComposer: true,
        focusComposer,
        scrollToBottom: true,
        preferUnread: false,
      });
    }
  } catch (err) {
    updateTransientMessage(target.key, item.local_id, { send_state: 'failed', send_error: err.message });
    if (currentMessageConversationKey() === target.key) {
      await refreshMessages(target.key, {
        preserveComposer: true,
        focusComposer,
        scrollToBottom: true,
        preferUnread: false,
      });
    }
    toast(`发送失败: ${err.message}`, 'error');
  }
}

async function queueTransientMessage(conversationKey, { body = '', files = [], replyTarget = null, focusComposer = true } = {}) {
  const key = parseMessageConversationKey(conversationKey).key;
  if (!key) return;
  const transient = buildTransientMessage({ conversationKey: key, body, files, replyTarget });
  setTransientMessages(key, [...transientMessagesForConversation(key), transient]);
  void performTransientSend(transient, { focusComposer });
  if (currentMessageConversationKey() === key) {
    await refreshMessages(key, {
      preserveComposer: true,
      focusComposer,
      scrollToBottom: true,
      preferUnread: false,
      localOnly: true,
    });
  }
}

async function retryTransientMessage(localId) {
  const match = findTransientMessageByLocalId(localId);
  if (!match) return;
  closeMessageActionMenu();
  updateTransientMessage(match.conversationKey, localId, { send_state: 'pending', send_error: '' });
  await performTransientSend(match.item, { focusComposer: true });
}

async function sendFilesToPeer(peerId, files, options = {}) {
  const target = parseMessageConversationKey(peerId);
  const selectedFiles = normalizeMessageFiles(files);
  if (!selectedFiles.length) return;
  const fileError = messageFileValidationError(selectedFiles);
  if (fileError) {
    if (options.input) options.input.value = '';
    toast(fileError, 'warning');
    return;
  }

  const textarea = $('messageComposer');
  const input = options.input || $('messageFileInput');
  const caption = textarea?.value.trim() || '';
  const replyTarget = currentMessageReplyTarget(target.key);

  if (textarea) textarea.value = '';
  if (input) input.value = '';
  clearMessageComposerDraft(target.key);
  clearMessageReplyTarget(target.key);
  if (options.fromFavoriteGif) {
    closeMessageEmojiPanel();
  }
  await queueTransientMessage(target.key, {
    body: caption,
    files: selectedFiles,
    replyTarget,
    focusComposer: true,
  });
}

function showMessageEditModal(messageId, conversationType, currentBody = '', allowEmpty = false, wasRecalled = false) {
  closeMessageActionMenu();
  openModal({
    title: '编辑消息',
    body: `
      <div class="form-group">
        <label for="messageEditBody">消息内容</label>
        <textarea id="messageEditBody" rows="6" maxlength="4000" data-allow-empty="${allowEmpty ? '1' : '0'}">${esc(currentBody)}</textarea>
      </div>
      <div class="text-muted" style="font-size: 12px;">发送后 2 分钟内可编辑。${wasRecalled ? '保存后这条消息会重新显示。' : ''}</div>
      <div id="messageEditError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="messageEditSubmitBtn" onclick="submitMessageEdit(${Number(messageId)}, ${jsArg(conversationType)})">保存</button>
    `,
  });
}

async function submitMessageEdit(messageId, conversationType) {
  const btn = $('messageEditSubmitBtn');
  const errEl = $('messageEditError');
  const input = $('messageEditBody');
  const body = input?.value.trim() || '';
  const allowEmpty = String(input?.dataset?.allowEmpty || '') === '1';
  if (!body && !allowEmpty) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = '请输入消息内容。'; }
    return;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
    const endpoint = conversationType === 'group'
      ? `/api/messages/group-messages/${Number(messageId)}`
      : `/api/messages/direct-messages/${Number(messageId)}`;
    await api(endpoint, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body_md: body }),
    });
    closeModal();
    await refreshMessageThreadNow();
  } catch (err) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = err.message; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  }
}

async function copyMessageText(messageId) {
  const message = currentThreadMessage(messageId);
  const text = messageMenuCopyText(message);
  closeMessageActionMenu();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制消息', 'success');
  } catch {
    toast('复制失败，请重试', 'error');
  }
}

async function recallMessageAction(messageId, conversationType) {
  closeMessageActionMenu();
  try {
    const endpoint = conversationType === 'group'
      ? `/api/messages/group-messages/${Number(messageId)}/recall`
      : `/api/messages/direct-messages/${Number(messageId)}/recall`;
    await api(endpoint, {
      method: 'POST',
      headers: authHeaders(),
    });
    await refreshMessageThreadNow();
  } catch (err) {
    toast(`撤回消息失败: ${err.message}`, 'error');
  }
}

async function deleteMessageAction(messageId, conversationType) {
  closeMessageActionMenu();
  try {
    const endpoint = conversationType === 'group'
      ? `/api/messages/group-messages/${Number(messageId)}`
      : `/api/messages/direct-messages/${Number(messageId)}`;
    await api(endpoint, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    await refreshMessageThreadNow();
  } catch (err) {
    toast(`删除消息失败: ${err.message}`, 'error');
  }
}

function showMessageReportModal(messageId, conversationType) {
  closeMessageActionMenu();
  openModal({
    title: '举报消息',
    body: `
      <div class="form-group">
        <label for="messageReportReason">举报原因</label>
        <input id="messageReportReason" type="text" maxlength="80" placeholder="例如：骚扰、垃圾信息、违规内容" />
      </div>
      <div class="form-group">
        <label for="messageReportDetails">补充说明</label>
        <textarea id="messageReportDetails" rows="5" maxlength="2000" placeholder="可选，补充上下文帮助管理员判断"></textarea>
      </div>
      <div id="messageReportError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="messageReportSubmitBtn" onclick="submitMessageReport(${Number(messageId)}, ${jsArg(conversationType)})">提交举报</button>
    `,
  });
}

async function submitMessageReport(messageId, conversationType) {
  const btn = $('messageReportSubmitBtn');
  const errEl = $('messageReportError');
  const reason = $('messageReportReason')?.value.trim() || '';
  const details = $('messageReportDetails')?.value.trim() || '';
  if (!reason) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = '请填写举报原因。'; }
    return;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '提交中...'; }
    await api('/api/messages/reports', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_type: conversationType,
        message_id: Number(messageId),
        reason,
        details,
      }),
    });
    closeModal();
    toast('举报已提交', 'success');
  } catch (err) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = err.message; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '提交举报'; }
  }
}

// ─── Public User Profile ───────────────────────────────────────────────────
async function renderUserProfile(username) {
  setPage('个人主页');
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在同步选手主页...</span>
    </div>
  `;

  try {
    const data = await api(`/api/users/${encodeURIComponent(username)}/profile`);
    const profile = data.user || {};
    const stats = data.stats || {};
    const bestResults = data.best_results || [];
    const recentSubmissions = data.recent_submissions || [];
    const isOwnProfile = Number(state.user?.id || 0) === Number(profile.id || 0);
    const totalPublicProblems = Number(stats.total_public_problems || 0);
    const solvedCount = Number(stats.solved_count || 0);
    const submissionCount = Number(stats.submission_count || 0);
    const acceptedCount = Number(stats.accepted_submission_count || 0);
    const solvedPercent = totalPublicProblems > 0 ? Math.round((solvedCount / totalPublicProblems) * 100) : 0;

    setPage(`${profile.username || '用户'} 的主页`);
    app.innerHTML = `
      <div class="profile-home-layout">
        <aside class="profile-summary card highlight">
          ${renderAvatar(profile.username, profile.avatar_url, 'profile-avatar-container', { initialCount: 2 })}
          <h2>${esc(profile.username || '用户')}</h2>
          <span class="pill blue">${esc(profile.role || 'USER')}</span>
          <p class="profile-signature">${esc(displaySignature(profile.signature))}</p>
          <div class="profile-summary-meta">
            <div>
              <span class="text-muted">加入时间</span>
              <strong>${profile.created_at ? formatDate(profile.created_at) : '—'}</strong>
            </div>
            <div>
              <span class="text-muted">最近提交</span>
              <strong>${stats.last_submission_at ? formatDate(stats.last_submission_at) : '暂无记录'}</strong>
            </div>
          </div>
          <div class="profile-actions">
            ${isOwnProfile ? `<a class="btn btn-secondary btn-sm" href="/account" data-link>账户设置</a>` : ''}
            ${state.user && !isOwnProfile ? `<a class="btn btn-primary btn-sm" href="${esc(messageTargetHref(`direct:${Number(profile.id)}`))}" data-link>发送私信</a>` : ''}
          </div>
        </aside>

        <section class="profile-home-content">
          <div class="stats-row profile-stats">
            <div class="stat-card">
              <div class="stat-value">${solvedCount}</div>
              <div class="stat-label">通过题目</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${solvedPercent}%</div>
              <div class="stat-label">题库进度</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${submissionCount}</div>
              <div class="stat-label">公开提交</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${acceptedCount}</div>
              <div class="stat-label">通过提交</div>
            </div>
          </div>

          <div class="profile-table-grid">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title">榜单成绩</h3>
              </div>
              ${bestResults.length === 0 ? emptyBox('暂无公开榜单成绩') : `
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>题目</th>
                        <th>公开分</th>
                        <th>更新时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${bestResults.map(item => `
                        <tr>
                          <td>
                            <a href="/problems/${esc(item.problem_slug)}" data-link style="font-weight: 700;">${esc(item.problem_title || item.problem_slug)}</a>
                            <div class="text-muted" style="font-size: 12px; font-family: var(--font-mono);">${esc(item.problem_slug || '')}</div>
                          </td>
                          <td class="text-accent" style="font-family: var(--font-mono); font-weight: 700;">${scoreDisplay(item.public_score)}</td>
                          <td style="font-size: 12px; color: var(--text-muted);">${formatDate(item.updated_at)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `}
            </div>

            <div class="card">
              <div class="card-header">
                <h3 class="card-title">最近提交</h3>
              </div>
              ${recentSubmissions.length === 0 ? emptyBox('暂无公开提交记录') : `
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>题目</th>
                        <th>状态</th>
                        <th>公开分</th>
                        <th>提交时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${recentSubmissions.map(item => `
                        <tr ${isOwnProfile ? `class="clickable-row" onclick="navigate('/submissions/${Number(item.id)}')"` : ''}>
                          <td>
                            <a href="/problems/${esc(item.problem_slug)}" style="font-weight: 700;" onclick="event.stopPropagation(); navigate(${jsArg(`/problems/${item.problem_slug || ''}`)}); return false;">${esc(item.problem_title || item.problem_slug)}</a>
                            <div class="text-muted" style="font-size: 12px; font-family: var(--font-mono);">#${Number(item.id)} · ${esc(item.problem_slug || '')}</div>
                          </td>
                          <td>${statusPill(item.status)}</td>
                          <td class="text-accent" style="font-family: var(--font-mono); font-weight: 700;">${scoreDisplay(item.public_score)}</td>
                          <td style="font-size: 12px; color: var(--text-muted);">${formatDate(item.created_at)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `}
            </div>
          </div>
        </section>
      </div>
    `;
  } catch (err) {
    app.innerHTML = errorBox(err);
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

  const profilePath = userProfilePath(state.user.username);

  app.innerHTML = `
    <div class="account-layout">
      <!-- Left Sidebar: Profile Avatar Card & Solved Stats -->
      <div class="account-sidebar" style="display: flex; flex-direction: column; gap: var(--space-lg);">
        <div class="card highlight" style="display: flex; flex-direction: column; align-items: center; text-align: center; padding: var(--space-xl) var(--space-lg);">
          ${renderAvatar(state.user.username, state.user.avatar_url, 'profile-avatar-container', { initialCount: 2 })}
          <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 6px;">${esc(state.user.username)}</h2>
          <span class="pill blue" style="font-size: 10px; padding: 2px 10px; border-radius: 4px;">${esc(state.user.role)}</span>
          <div class="avatar-upload-actions">
            <input type="file" id="avatarInput" accept="${AVATAR_ACCEPT_ATTRIBUTE}" style="display:none" onchange="handleAvatarFileChange(this)" />
            <button class="btn btn-secondary btn-sm" id="avatarUploadBtn" onclick="showAvatarPicker()">更换头像</button>
            <div class="text-muted avatar-help-text">支持 PNG / JPG / GIF / WebP，最大 5 MB</div>
            <div id="avatarError" class="notice error" style="display:none; width:100%; margin-top: var(--space-xs);"></div>
          </div>
          <a class="btn btn-secondary btn-sm mt-md" href="${esc(profilePath)}" data-link>查看个人主页</a>
          
          <div style="width: 100%; border-top: var(--border-subtle); margin-top: var(--space-lg); padding-top: var(--space-lg); text-align: left; display: flex; flex-direction: column; gap: 12px; font-size: 13px;">
            <div style="display: flex; justify-content: space-between;"><span class="text-muted">关联邮箱</span><span style="font-weight:500;">${esc(state.user.email || '尚未绑定邮箱')}</span></div>
            <div style="display: flex; justify-content: space-between;"><span class="text-muted">安全角色组</span><span style="font-weight:500;">${esc(state.user.role === 'ADMIN' ? '裁判组 / 管理员' : '参赛选手')}</span></div>
            <div style="display: flex; flex-direction: column; gap: 4px;"><span class="text-muted">个性签名</span><span style="font-weight:500; overflow-wrap:anywhere;">${esc(displaySignature(state.user.signature))}</span></div>
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

      <!-- Right Main: Account Forms -->
      <div class="account-main" style="display: flex; flex-direction: column; gap: var(--space-lg);">
        <div class="card" style="padding: var(--space-xl) var(--space-lg);">
          <h3 class="card-title" style="margin-bottom: var(--space-lg); display: flex; align-items: center; gap: 10px;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            修改用户名
          </h3>

          <div class="form-group">
            <label for="usernameInput">新的用户名</label>
            <input type="text" id="usernameInput" value="${esc(state.user.username)}" placeholder="3-50 位英文字母、数字、下划线、点或横线" autocomplete="username" />
          </div>

          <div id="usernameError" class="notice error" style="display:none; margin-top: var(--space-md);"></div>
          <div id="usernameSuccess" class="notice success" style="display:none; margin-top: var(--space-md);"></div>

          <button class="btn btn-primary mt-lg" id="usernameSaveBtn" onclick="changeUsername()">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            保存用户名
          </button>
        </div>

        <div class="card" style="padding: var(--space-xl) var(--space-lg);">
          <h3 class="card-title" style="margin-bottom: var(--space-lg); display: flex; align-items: center; gap: 10px;">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>
              <path d="M8 9h8"></path>
              <path d="M8 13h5"></path>
            </svg>
            个性签名
          </h3>

          <div class="form-group">
            <label for="signatureInput">主页签名</label>
            <textarea id="signatureInput" maxlength="160" rows="3" placeholder="写一句会展示在个人主页上的签名">${esc(state.user.signature || '')}</textarea>
          </div>

          <div class="row flex-between" style="gap: var(--space-md); align-items: center; flex-wrap: wrap;">
            <span class="text-muted" style="font-size: 12px;">最多 160 个字符</span>
            <button class="btn btn-primary" id="signatureSaveBtn" onclick="changeSignature()">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              保存签名
            </button>
          </div>
          <div id="signatureError" class="notice error" style="display:none; margin-top: var(--space-md);"></div>
          <div id="signatureSuccess" class="notice success" style="display:none; margin-top: var(--space-md);"></div>
        </div>

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


function showAvatarPicker() {
  $('avatarInput')?.click();
}

async function handleAvatarFileChange(input) {
  const file = input?.files?.[0];
  const errEl = $('avatarError');
  if (errEl) {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }
  if (!file) return;

  if (file.size > AVATAR_FILE_SIZE_LIMIT_BYTES) {
    const message = '头像文件不能超过 5 MB。';
    if (errEl) {
      errEl.style.display = '';
      errEl.textContent = message;
    }
    toast(message, 'warning');
    input.value = '';
    return;
  }

  const btn = $('avatarUploadBtn');
  const originalLabel = btn?.dataset.originalLabel || btn?.textContent || '更换头像';
  if (btn) {
    btn.dataset.originalLabel = originalLabel;
    btn.disabled = true;
    btn.textContent = '上传中...';
  }

  try {
    const formData = new FormData();
    formData.append('avatar', file);
    const data = await tryApi(
      ['/api/auth/avatar', '/api/account/avatar'],
      {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      }
    );
    state.user = { ...(state.user || {}), ...((data && data.user) || {}) };
    updateNav();
    if (location.pathname === '/account') {
      await renderAccount();
    }
    toast('头像已更新。', 'success');
  } catch (err) {
    if (errEl) {
      errEl.style.display = '';
      errEl.textContent = err.message;
    }
    toast(`头像更新失败: ${err.message}`, 'danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
    if (input) input.value = '';
  }
}


async function changeUsername() {
  const input = $('usernameInput');
  const username = (input?.value || '').trim();
  const errEl = $('usernameError');
  const sucEl = $('usernameSuccess');
  const btn = $('usernameSaveBtn');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  if (sucEl) { sucEl.style.display = 'none'; sucEl.textContent = ''; }

  if (!username) {
    toast('请填写新的用户名。', 'warning');
    return;
  }

  const originalLabel = btn?.dataset.originalLabel || btn?.innerHTML || '保存用户名';
  if (btn) {
    btn.dataset.originalLabel = originalLabel;
    btn.disabled = true;
    btn.textContent = '保存中...';
  }

  try {
    const data = await tryApi(
      ['/api/auth/change-username', '/api/account/username'],
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      }
    );
    if (data.token || data.access_token) {
      state.token = data.token || data.access_token;
      localStorage.setItem('aioj_token', state.token);
    }
    state.user = { ...(state.user || {}), ...((data && data.user) || {}) };
    updateNav();
    if (input) input.value = state.user.username || username;
    if (sucEl) {
      sucEl.style.display = '';
      sucEl.textContent = '用户名已更新，个人主页地址也已同步。';
    }
    toast('用户名已更新。', 'success');
  } catch (err) {
    if (errEl) {
      errEl.style.display = '';
      errEl.textContent = err.message;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalLabel || '保存用户名';
    }
  }
}


async function changeSignature() {
  const input = $('signatureInput');
  const signature = (input?.value || '').trim();
  const errEl = $('signatureError');
  const sucEl = $('signatureSuccess');
  const btn = $('signatureSaveBtn');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  if (sucEl) { sucEl.style.display = 'none'; sucEl.textContent = ''; }

  if (signature.length > 160) {
    const message = '个性签名不能超过 160 个字符。';
    if (errEl) { errEl.style.display = ''; errEl.textContent = message; }
    toast(message, 'warning');
    return;
  }

  const originalLabel = btn?.dataset.originalLabel || btn?.innerHTML || '保存签名';
  if (btn) {
    btn.dataset.originalLabel = originalLabel;
    btn.disabled = true;
    btn.textContent = '保存中...';
  }

  try {
    const data = await tryApi(
      ['/api/auth/signature', '/api/account/signature'],
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature }),
      }
    );
    state.user = { ...(state.user || {}), ...((data && data.user) || {}) };
    updateNav();
    if (input) input.value = state.user.signature || '';
    if (sucEl) {
      sucEl.style.display = '';
      sucEl.textContent = '个性签名已保存。';
    }
    toast('个性签名已更新。', 'success');
  } catch (err) {
    if (errEl) {
      errEl.style.display = '';
      errEl.textContent = err.message;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalLabel || '保存签名';
    }
  }
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
        <div class="card-header row flex-between gap-sm" style="flex-wrap: wrap;">
          <h3 class="card-title">系统注册选手列表 (${items.length} 个记录)</h3>
          <button class="btn btn-primary" onclick="showAdminBroadcastModal()">发送管理员广播</button>
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
                  <td><a href="${esc(userProfilePath(u.username))}" data-link style="font-weight: 700;">${esc(u.username)}</a></td>
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

function showAdminBroadcastModal() {
  openModal({
    title: '发送管理员广播通知',
    body: `
      <div class="notice info" style="margin-bottom: var(--space-md);">
        广播会写入所有未被停权账号的站内通知中心，管理员本人也会收到一份。
      </div>
      <div class="form-group">
        <label for="broadcastTitle">广播标题</label>
        <input type="text" id="broadcastTitle" placeholder="如：平台维护窗口调整通知" />
      </div>
      <div class="form-group">
        <label for="broadcastBody">广播内容</label>
        <textarea id="broadcastBody" rows="6" placeholder="请填写需要通知全站用户的内容..."></textarea>
      </div>
      <div class="form-group">
        <label for="broadcastLink">跳转链接（可选，站内路径，以 / 开头）</label>
        <input type="text" id="broadcastLink" placeholder="/contests 或 /notifications" />
      </div>
      <div id="broadcastError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="publishAdminBroadcast()">发送广播</button>
    `,
  });
}

async function publishAdminBroadcast() {
  const title = $('broadcastTitle')?.value?.trim();
  const body = $('broadcastBody')?.value?.trim();
  const link = $('broadcastLink')?.value?.trim();
  if (!title) { toast('请输入广播标题', 'warning'); return; }
  if (!body) { toast('请输入广播内容', 'warning'); return; }
  if (link && !link.startsWith('/')) { toast('跳转链接必须以 / 开头', 'warning'); return; }
  try {
    const data = await api('/api/admin/notifications/broadcast', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body_md: body, link: link || null }),
    });
    closeModal();
    await refreshNotificationCount();
    toast(`管理员广播已发送，覆盖 ${Number(data.notified_users || 0)} 个账号。`, 'success');
  } catch (err) {
    const el = $('broadcastError');
    if (el) { el.style.display = ''; el.textContent = err.message; }
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
function updateProblemPackagePickerLabel(inputId, labelId, mode = 'file') {
  const input = $(inputId);
  const label = $(labelId);
  if (!input || !label) return;
  const files = Array.from(input.files || []);
  if (!files.length) {
    label.textContent = mode === 'folder' ? '选择题包文件夹' : '选择 ZIP 题包';
    return;
  }
  if (mode === 'folder') {
    const root = findProblemPackageRoot(files);
    label.textContent = root
      ? `${root.split('/').pop()} (${files.length} 个文件)`
      : `已选择 ${files.length} 个文件`;
    return;
  }
  label.textContent = files[0].name;
}

function fileRelativePath(file) {
  return String(file?.webkitRelativePath || file?.relativePath || file?.name || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function findProblemPackageRoot(files) {
  const roots = [];
  Array.from(files || []).forEach((file) => {
    const path = fileRelativePath(file);
    const parts = path.split('/').filter(Boolean);
    if (parts.length && parts[parts.length - 1].toLowerCase() === 'problem.yaml') {
      roots.push(parts.slice(0, -1).join('/'));
    }
  });
  roots.sort((a, b) => a.split('/').filter(Boolean).length - b.split('/').filter(Boolean).length);
  return roots[0] || '';
}

async function buildProblemPackageZipFromFolder(files, resultEl = null) {
  if (!window.JSZip) {
    throw new Error('浏览器未加载 JSZip，无法把文件夹打包为题包 ZIP');
  }
  const list = Array.from(files || []).filter(file => file && !String(file.name || '').startsWith('._'));
  const root = findProblemPackageRoot(list);
  if (!root && !list.some(file => fileRelativePath(file).toLowerCase() === 'problem.yaml')) {
    throw new Error('所选文件夹里没有 problem.yaml，无法识别为标准题包');
  }
  const rootPrefix = root ? `${root}/` : '';
  const archive = new JSZip();
  let included = 0;
  list.forEach((file) => {
    const path = fileRelativePath(file);
    if (rootPrefix && !path.startsWith(rootPrefix)) return;
    const rel = rootPrefix ? path.slice(rootPrefix.length) : path;
    if (!rel || rel.startsWith('__MACOSX/')) return;
    archive.file(rel, file);
    included++;
  });
  if (!included) {
    throw new Error('所选文件夹没有可上传的题包文件');
  }
  const zipName = `${(root || 'problem-package').split('/').pop() || 'problem-package'}.zip`;
  const blob = await archive.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => {
      if (resultEl && meta.percent != null) {
        resultEl.innerHTML = `
          <div class="problem-import-progress">
            <div class="spinner-ring" style="width:16px; height:16px; border-width:2px;"></div>
            <span>正在打包文件夹：${Math.round(meta.percent)}%</span>
          </div>
        `;
      }
    },
  );
  return new File([blob], zipName, { type: 'application/zip' });
}

async function prepareProblemPackageUpload({ zipInputId = 'problemZip', folderInputId = 'problemFolder', resultEl = null } = {}) {
  const zipInput = $(zipInputId);
  const folderInput = $(folderInputId);
  const zipFile = zipInput?.files?.[0] || null;
  if (zipFile) {
    if (!zipFile.name.toLowerCase().endsWith('.zip')) {
      throw new Error('请选择 .zip 题包，或改用文件夹上传');
    }
    return zipFile;
  }
  const folderFiles = Array.from(folderInput?.files || []);
  if (folderFiles.length) {
    return buildProblemPackageZipFromFolder(folderFiles, resultEl);
  }
  throw new Error('请先选择 ZIP 题包或题包文件夹');
}

async function uploadProblemPackageFromControls({
  zipInputId = 'problemZip',
  folderInputId = 'problemFolder',
  resultId = 'importResult',
  refreshAdmin = true,
} = {}) {
  const resultEl = $(resultId);
  if (!resultEl) return null;
  resultEl.innerHTML = `
    <div class="problem-import-progress">
      <div class="spinner-ring" style="width:16px; height:16px; border-width:2px;"></div>
      <span>正在准备题包上传...</span>
    </div>
  `;
  try {
    const uploadFile = await prepareProblemPackageUpload({ zipInputId, folderInputId, resultEl });
    resultEl.innerHTML = `
      <div class="problem-import-progress">
        <div class="spinner-ring" style="width:16px; height:16px; border-width:2px;"></div>
        <span>正在验证并部署 ${esc(uploadFile.name)}，部署可能需要 3-10 秒...</span>
      </div>
    `;
    const fd = new FormData();
    fd.append('file', uploadFile);
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
    if (refreshAdmin && state.currentRoute === '/problem-admin') {
      setTimeout(() => renderProblemAdmin(), 1800);
    }
    return data;
  } catch (err) {
    resultEl.innerHTML = `<div class="notice error">部署导入失败: ${esc(err.message)}</div>`;
    return null;
  }
}

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
          <p class="text-muted" style="font-size: 13.5px; margin-bottom: 12px;">上传标准 ZIP 题目包。基础格式包含 <code>problem.yaml</code>、<code>public/</code>、<code>private/</code>；题面可放 <code>statement.md</code> 或 <code>statements/*.md|*.pdf</code>。</p>
          <p class="text-muted" style="font-size: 12px; margin-bottom: 12px;">artifact 题包请将运行期输入放到 <code>private/input/</code>，将仅评分器可见的隐藏材料放到 <code>private/scoring/</code>。</p>
          <div class="problem-package-upload-grid">
            <label class="file-upload problem-package-picker">
              <span class="file-upload-icon">ZIP</span>
              <span class="file-upload-label"><span id="problemZipLabel">选择 ZIP 题包</span></span>
              <input type="file" id="problemZip" accept=".zip,application/zip" onchange="updateProblemPackagePickerLabel('problemZip', 'problemZipLabel')" />
            </label>
            <label class="file-upload problem-package-picker">
              <span class="file-upload-icon">DIR</span>
              <span class="file-upload-label"><span id="problemFolderLabel">选择题包文件夹</span></span>
              <input type="file" id="problemFolder" webkitdirectory directory multiple onchange="updateProblemPackagePickerLabel('problemFolder', 'problemFolderLabel', 'folder')" />
            </label>
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
                        <a href="/edit/${esc(p.slug)}" class="btn btn-primary btn-sm" data-link>可视化编辑</a>
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
  return uploadProblemPackageFromControls();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function problemEditorAssets() {
  const assets = problemEditorState?.editableVersion?.statement_assets || {};
  if (!Array.isArray(assets.markdowns)) assets.markdowns = [];
  if (!Array.isArray(assets.pdfs)) assets.pdfs = [];
  if (!assets.default_language) assets.default_language = 'default';
  return assets;
}

function problemEditorCanEdit() {
  return !!problemEditorState?.editableVersion && String(problemEditorState.editableVersion.status || '').toUpperCase() === 'DRAFT';
}

function problemEditorVariantKey(kind, item) {
  return `${kind}:${item?._draftKey || item?.id || 'new'}`;
}

function problemEditorVariants() {
  const assets = problemEditorAssets();
  return [
    ...assets.markdowns.map(item => ({ kind: 'markdown', item })),
    ...assets.pdfs.map(item => ({ kind: 'pdf', item })),
  ];
}

function problemEditorCurrentAsset() {
  const key = problemEditorState?.selectedKey || '';
  return problemEditorVariants().find(entry => problemEditorVariantKey(entry.kind, entry.item) === key) || null;
}

function problemEditorEnsureSelection(preferred = null) {
  const variants = problemEditorVariants();
  if (variants.length === 0) {
    problemEditorState.selectedKey = '';
    return;
  }
  if (preferred?.kind && preferred?.id) {
    const match = variants.find(entry => entry.kind === preferred.kind && ((entry.item.id || '') === preferred.id || (entry.item._draftKey || '') === preferred.id));
    if (match) {
      problemEditorState.selectedKey = problemEditorVariantKey(match.kind, match.item);
      return;
    }
  }
  const current = problemEditorCurrentAsset();
  if (current) return;
  problemEditorState.selectedKey = problemEditorVariantKey(variants[0].kind, variants[0].item);
}

function loadProblemEditorState(data, preferred = null) {
  const editableVersion = data?.editable_version ? cloneJson(data.editable_version) : null;
  if (editableVersion?.statement_assets) {
    editableVersion.statement_assets.markdowns = (editableVersion.statement_assets.markdowns || []).map(item => ({ ...item }));
    editableVersion.statement_assets.pdfs = (editableVersion.statement_assets.pdfs || []).map(item => ({ ...item }));
  }
  problemEditorState = {
    slug: data?.problem?.slug || '',
    problem: cloneJson(data?.problem || {}),
    activeVersion: cloneJson(data?.active_version || null),
    draftVersion: cloneJson(data?.draft_version || null),
    editableVersion,
    versions: cloneJson(data?.versions || []),
    selectedKey: '',
  };
  problemEditorEnsureSelection(preferred);
}

function captureProblemEditorCurrentAsset() {
  const current = problemEditorCurrentAsset();
  if (!current) return null;
  const item = current.item;
  const idInput = $('problemEditorAssetId');
  const languageInput = $('problemEditorAssetLanguage');
  const labelInput = $('problemEditorAssetLabel');
  const filenameInput = $('problemEditorAssetFilename');
  const makeDefaultInput = $('problemEditorAssetMakeDefault');
  if (idInput) item.id = idInput.value.trim();
  if (languageInput) item.language = languageInput.value.trim();
  if (labelInput) item.label = labelInput.value.trim();
  if (filenameInput) item.filename = filenameInput.value.trim();
  if (current.kind === 'markdown') {
    const contentInput = $('problemEditorMarkdownContent');
    if (contentInput) item.content = contentInput.value;
  }
  item._makeDefault = !!makeDefaultInput?.checked;
  return current;
}

function problemEditorMarkdownPreviewHtml(content) {
  const slug = problemEditorState?.problem?.slug || '';
  return renderMd(rewriteProblemMarkdownAssets(content || '', { slug }));
}

function syncProblemEditorMarkdownPreview() {
  const preview = $('problemEditorMarkdownPreview');
  const content = $('problemEditorMarkdownContent')?.value || '';
  if (preview) preview.innerHTML = problemEditorMarkdownPreviewHtml(content);
}

function problemEditorIsStandaloneRoute() {
  return /^\/edit\/[^/]+$/.test(state.currentRoute || location.pathname || '');
}

function problemEditorRenderTargets() {
  if (problemEditorIsStandaloneRoute()) {
    return { bodyId: 'problemEditorPageBody', footerId: 'problemEditorPageFooter', standalone: true };
  }
  return { bodyId: 'modalBody', footerId: 'modalFooter', standalone: false };
}

function refreshProblemAdminIfVisible() {
  if (state.currentRoute === '/problem-admin') {
    renderProblemAdmin();
  }
}

function statementAssetIdFromLabel(value) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[._-]+|[._-]+$/g, '');
  return normalized || `pdf-${Date.now()}`;
}

function cleanTranslationPdfLabel(value) {
  return String(value || '')
    .replace(/\.[^.]+$/g, '')
    .replaceAll('_', ' ')
    .replace(/\bindividual contest day[12]\b/gi, ' ')
    .replace(/\bgaite day[12]\b/gi, ' ')
    .replace(/\bteamleadertranslate\b/gi, ' ')
    .replace(/\bteamleadtranslate\b/gi, ' ')
    .replace(/\bmachine(?:\s+|)translate\b/gi, ' ')
    .replace(/\bteam leader translate\b/gi, ' ')
    .replace(/\bteam lead translate\b/gi, ' ')
    .replace(/\bold\d*\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-_\s]+|[-_\s]+$/g, '');
}

function translationDocumentLabelForFile(file) {
  const path = fileRelativePath(file);
  const parts = path.split('/').filter(Boolean);
  const parent = parts.length > 1 ? cleanTranslationPdfLabel(parts[parts.length - 2]) : '';
  const descriptor = cleanTranslationPdfLabel(file?.name || '');
  if (!parent) return descriptor || 'Translation';
  if (!descriptor) return parent;
  const parentNorm = parent.toLocaleLowerCase();
  const descriptorNorm = descriptor.toLocaleLowerCase();
  if (descriptorNorm === parentNorm || descriptorNorm.includes(parentNorm)) return descriptor;
  return `${parent} · ${descriptor}`;
}

function translationDocumentGroupKey(file) {
  const path = fileRelativePath(file);
  const parts = path.split('/').filter(Boolean);
  const parent = parts.length > 1 ? cleanTranslationPdfLabel(parts[parts.length - 2]) : '';
  return statementAssetIdFromLabel(parent || cleanTranslationPdfLabel(file?.name || ''));
}

function statementDocumentKind(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  return '';
}

function selectProblemEditorStatementDocuments(files) {
  const chosen = new Map();
  (files || [])
    .filter(file => file && !String(file.name || '').startsWith('._') && !String(file.name || '').startsWith('~$'))
    .filter(file => !fileRelativePath(file).toLowerCase().includes('__macosx/'))
    .forEach((file) => {
      const kind = statementDocumentKind(file);
      if (!kind) return;
      const key = translationDocumentGroupKey(file);
      const current = chosen.get(key);
      if (!current || (kind === 'pdf' && statementDocumentKind(current) !== 'pdf')) {
        chosen.set(key, file);
      }
    });
  return Array.from(chosen.values());
}

function problemEditorPdfBatchFiles() {
  const directFiles = Array.from($('problemEditorPdfBatchFiles')?.files || []);
  const folderFiles = Array.from($('problemEditorPdfFolder')?.files || []);
  return selectProblemEditorStatementDocuments([...directFiles, ...folderFiles]);
}

function renderProblemEditorDataImportPanel() {
  if (!problemEditorIsStandaloneRoute()) return '';
  return `
    <div class="card highlight mb-lg">
      <div class="card-header">
        <h3 class="card-title">GUI 数据上传 / 完整题包更新</h3>
      </div>
      <div class="card-body">
        <p class="text-muted" style="font-size: 13px; margin-bottom: 12px;">选择 ZIP 或包含 <code>problem.yaml</code>、<code>public/</code>、<code>private/</code> 的题包文件夹；导入会创建新版本并跑版本自测。</p>
        <div class="problem-package-upload-grid">
          <label class="file-upload problem-package-picker">
            <span class="file-upload-icon">ZIP</span>
            <span class="file-upload-label"><span id="editorProblemZipLabel">选择 ZIP 题包</span></span>
            <input type="file" id="editorProblemZip" accept=".zip,application/zip" onchange="updateProblemPackagePickerLabel('editorProblemZip', 'editorProblemZipLabel')" />
          </label>
          <label class="file-upload problem-package-picker">
            <span class="file-upload-icon">DIR</span>
            <span class="file-upload-label"><span id="editorProblemFolderLabel">选择题包文件夹</span></span>
            <input type="file" id="editorProblemFolder" webkitdirectory directory multiple onchange="updateProblemPackagePickerLabel('editorProblemFolder', 'editorProblemFolderLabel', 'folder')" />
          </label>
          <button class="btn btn-primary" onclick="importProblemFromEditorPage()">上传数据并生成版本</button>
        </div>
        <div id="editorImportResult" class="mt-md"></div>
      </div>
    </div>
  `;
}

function renderProblemEditorPdfBatchPanel(canEdit) {
  if (!problemEditorIsStandaloneRoute()) return '';
  const disabledAttr = canEdit ? '' : 'disabled';
  return `
    <div class="card mb-lg">
      <div class="card-header">
        <h3 class="card-title">PDF / DOCX 语言包批量上传</h3>
      </div>
      <div class="card-body">
        <p class="text-muted" style="font-size: 13px; margin-bottom: 12px;">可直接选择一批 PDF/DOCX，或选择翻译包文件夹；同一国家同时存在 PDF 与 DOCX 时保留 PDF，只有 DOCX 时由服务器转成 PDF。</p>
        <div class="problem-package-upload-grid">
          <label class="file-upload problem-package-picker">
            <span class="file-upload-icon">DOC</span>
            <span class="file-upload-label"><span id="problemEditorPdfBatchLabel">选择 PDF/DOCX 文件</span></span>
            <input type="file" id="problemEditorPdfBatchFiles" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onchange="updateProblemPackagePickerLabel('problemEditorPdfBatchFiles', 'problemEditorPdfBatchLabel')" ${disabledAttr} />
          </label>
          <label class="file-upload problem-package-picker">
            <span class="file-upload-icon">DIR</span>
            <span class="file-upload-label"><span id="problemEditorPdfFolderLabel">选择语言包文件夹</span></span>
            <input type="file" id="problemEditorPdfFolder" webkitdirectory directory multiple onchange="updateProblemPackagePickerLabel('problemEditorPdfFolder', 'problemEditorPdfFolderLabel', 'folder')" ${disabledAttr} />
          </label>
          <button class="btn btn-primary" onclick="uploadProblemEditorPdfBatch()" ${disabledAttr}>批量上传语言包</button>
        </div>
        <div id="problemEditorPdfBatchResult" class="mt-md"></div>
      </div>
    </div>
  `;
}

async function importProblemFromEditorPage() {
  const data = await uploadProblemPackageFromControls({
    zipInputId: 'editorProblemZip',
    folderInputId: 'editorProblemFolder',
    resultId: 'editorImportResult',
    refreshAdmin: false,
  });
  if (data?.slug) {
    setTimeout(() => navigate(`/edit/${encodeURIComponent(data.slug)}`), 1200);
  }
}

async function uploadProblemEditorPdfBatch() {
  if (!problemEditorCanEdit()) return;
  const versionId = problemEditorState?.editableVersion?.id;
  if (!versionId) return;
  const files = problemEditorPdfBatchFiles();
  const resultEl = $('problemEditorPdfBatchResult');
  if (!files.length) {
    toast('请先选择 PDF/DOCX 文件或语言包文件夹', 'warning');
    if (resultEl) resultEl.innerHTML = '<div class="notice warning">没有识别到可上传的 PDF/DOCX 文件。</div>';
    return;
  }

  const usedIds = new Set();
  let latestData = null;
  let uploaded = 0;
  for (const file of files) {
    const label = translationDocumentLabelForFile(file);
    const baseId = statementAssetIdFromLabel(label);
    let assetId = baseId;
    let suffix = 2;
    while (usedIds.has(assetId)) {
      assetId = `${baseId}-${suffix}`;
      suffix++;
    }
    usedIds.add(assetId);
    if (resultEl) {
      resultEl.innerHTML = `
        <div class="problem-import-progress">
          <div class="spinner-ring" style="width:16px; height:16px; border-width:2px;"></div>
          <span>正在上传 ${uploaded + 1}/${files.length}: ${esc(file.name)}${statementDocumentKind(file) === 'docx' ? '（服务器转 PDF）' : ''}</span>
        </div>
      `;
    }
    const fd = new FormData();
    fd.append('asset_id', assetId);
    fd.append('language', assetId);
    fd.append('label', label || assetId);
    fd.append('file', file);
    latestData = await api(`/api/admin/problems/${problemEditorState.slug}/versions/${versionId}/statement-pdfs`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    });
    uploaded++;
  }

  if (latestData) {
    loadProblemEditorState(latestData);
    renderProblemEditorModalContent();
  }
  const finalResultEl = $('problemEditorPdfBatchResult') || resultEl;
  if (finalResultEl) {
    finalResultEl.innerHTML = `<div class="notice success">已上传 ${uploaded} 个语言包。</div>`;
  }
  toast(`已上传 ${uploaded} 个语言包`, 'success');
}

function renderProblemEditorModalContent() {
  if (!problemEditorState) return;
  problemEditorEnsureSelection();
  const targets = problemEditorRenderTargets();
  const bodyEl = $(targets.bodyId);
  const footerEl = $(targets.footerId);
  if (!bodyEl || !footerEl) return;
  const canEdit = problemEditorCanEdit();
  const assets = problemEditorAssets();
  const variants = problemEditorVariants();
  const current = problemEditorCurrentAsset();
  const selectedItem = current?.item || null;
  const currentDefaultLanguage = String(assets.default_language || '');
  const defaultLanguageOptions = (assets.markdowns || []).length
    ? assets.markdowns.map(item => `
        <option value="${esc(item.id || item.language || '')}" ${(item.id || item.language || '') === currentDefaultLanguage ? 'selected' : ''}>
          ${esc(item.label || item.language || item.id || 'Markdown')}
        </option>
      `).join('')
    : `<option value="${esc(currentDefaultLanguage || 'default')}">${esc(currentDefaultLanguage || 'default')}</option>`;
  const disabledAttr = canEdit ? '' : 'disabled';
  const sidebarButtons = `
    <div class="row gap-xs" style="flex-wrap: wrap;">
      <button class="btn btn-secondary btn-sm" onclick="addProblemEditorMarkdownAsset()" ${disabledAttr}>+ Markdown</button>
      <button class="btn btn-secondary btn-sm" onclick="addProblemEditorPdfAsset()" ${disabledAttr}>+ PDF 语言包</button>
    </div>
  `;
  const sidebarItems = variants.length === 0
    ? emptyBox('当前版本还没有题面资产')
    : variants.map(entry => {
        const active = current && problemEditorVariantKey(entry.kind, entry.item) === problemEditorState.selectedKey;
        const title = entry.item.label || entry.item.language || entry.item.id || (entry.kind === 'markdown' ? 'Markdown' : 'PDF');
        const meta = entry.kind === 'markdown'
          ? `Markdown · ${entry.item.language || entry.item.id || 'default'}`
          : `PDF · ${entry.item.language || entry.item.id || 'default'}`;
        return `
          <button
            class="btn ${active ? 'btn-primary' : 'btn-secondary'}"
            style="width: 100%; justify-content: flex-start; text-align: left; display: flex; flex-direction: column; align-items: flex-start; gap: 2px;"
            onclick="selectProblemEditorAsset(${jsArg(problemEditorVariantKey(entry.kind, entry.item))})"
          >
            <strong>${esc(title)}</strong>
            <span style="font-size: 11px; opacity: 0.85;">${esc(meta)}</span>
          </button>
        `;
      }).join('');

  let workspace = emptyBox('请选择或创建一个题面资产');
  if (current && selectedItem) {
    const itemId = selectedItem.id || '';
    const itemLanguage = selectedItem.language || '';
    const itemLabel = selectedItem.label || '';
    const itemFilename = selectedItem.filename || (current.kind === 'markdown' ? 'statement.md' : `${itemId || 'statement'}.pdf`);
    const isDefault = current.kind === 'markdown' && (itemId === currentDefaultLanguage || itemLanguage === currentDefaultLanguage);
    if (current.kind === 'markdown') {
      workspace = `
        <div class="form-row problem-editor-asset-form">
          <div class="form-group">
            <label for="problemEditorAssetId">资产 ID</label>
            <input id="problemEditorAssetId" type="text" value="${esc(itemId)}" placeholder="如: en / zh-cn" ${disabledAttr} />
          </div>
          <div class="form-group">
            <label for="problemEditorAssetLanguage">语言标识</label>
            <input id="problemEditorAssetLanguage" type="text" value="${esc(itemLanguage)}" placeholder="如: English / zh-CN" ${disabledAttr} />
          </div>
          <div class="form-group">
            <label for="problemEditorAssetLabel">显示名称</label>
            <input id="problemEditorAssetLabel" type="text" value="${esc(itemLabel)}" placeholder="如: English / 简体中文" ${disabledAttr} />
          </div>
          <div class="form-group">
            <label for="problemEditorAssetFilename">文件名</label>
            <input id="problemEditorAssetFilename" type="text" value="${esc(itemFilename)}" placeholder="statement.md" ${disabledAttr} />
          </div>
        </div>
        <div class="problem-editor-markdown-grid">
          <div class="form-group" style="min-width: 0;">
            <label for="problemEditorMarkdownContent">Markdown / LaTeX 题面</label>
            <textarea id="problemEditorMarkdownContent" rows="22" oninput="syncProblemEditorMarkdownPreview()" ${disabledAttr}>${esc(selectedItem.content || '')}</textarea>
          </div>
          <div style="min-width: 0;">
            <label style="display:block; margin-bottom: 6px; font-size: 12px; color: var(--text-secondary);">实时预览</label>
            <div id="problemEditorMarkdownPreview" style="min-height: 520px; padding: var(--space-md); border: var(--border-light); border-radius: var(--radius-md); background: hsla(0, 0%, 0%, 0.08); overflow: auto;">
              ${problemEditorMarkdownPreviewHtml(selectedItem.content || '')}
            </div>
          </div>
        </div>
        <div class="row gap-sm mt-md" style="flex-wrap: wrap;">
          <label class="row gap-xs" style="font-size: 12px; color: var(--text-secondary);">
            <input id="problemEditorAssetMakeDefault" type="checkbox" ${isDefault ? 'checked' : ''} ${disabledAttr} />
            <span>保存后设为默认语言</span>
          </label>
          <button class="btn btn-primary btn-sm" onclick="saveProblemEditorMarkdownAsset()" ${disabledAttr}>保存 Markdown 题面</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProblemEditorSelectedAsset()" ${disabledAttr}>删除此语言</button>
        </div>
      `;
    } else {
      workspace = `
        <div class="form-row problem-editor-asset-form">
          <div class="form-group">
            <label for="problemEditorAssetId">资产 ID</label>
            <input id="problemEditorAssetId" type="text" value="${esc(itemId)}" placeholder="如: zh-cn-pdf" ${disabledAttr} />
          </div>
          <div class="form-group">
            <label for="problemEditorAssetLanguage">语言标识</label>
            <input id="problemEditorAssetLanguage" type="text" value="${esc(itemLanguage)}" placeholder="如: zh-CN" ${disabledAttr} />
          </div>
          <div class="form-group">
            <label for="problemEditorAssetLabel">显示名称</label>
            <input id="problemEditorAssetLabel" type="text" value="${esc(itemLabel)}" placeholder="如: 简体中文 PDF" ${disabledAttr} />
          </div>
          <div class="form-group">
            <label for="problemEditorAssetFilename">文件名</label>
            <input id="problemEditorAssetFilename" type="text" value="${esc(itemFilename)}" placeholder="statement.pdf" ${disabledAttr} />
          </div>
        </div>
        <div class="row gap-sm mb-md" style="flex-wrap: wrap;">
          <input id="problemEditorPdfFile" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="width: auto; max-width: 360px;" ${disabledAttr} />
          <button class="btn btn-primary btn-sm" onclick="uploadProblemEditorPdf()" ${disabledAttr}>上传 / 替换 PDF/DOCX</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProblemEditorSelectedAsset()" ${disabledAttr}>删除此语言</button>
          ${selectedItem.download_url ? `<a class="btn btn-secondary btn-sm" target="_blank" href="${esc(selectedItem.download_url)}">新标签打开</a>` : ''}
        </div>
        ${selectedItem.download_url ? `
          <iframe
            class="statement-pdf-frame"
            src="${esc(selectedItem.download_url)}#view=FitH"
            title="${esc(itemLabel || itemLanguage || itemId || 'PDF')} PDF"
            loading="lazy"
          ></iframe>
        ` : `
          <div class="empty-state">
            <div class="loading-text">上传 PDF/DOCX 后可在此页内预览</div>
          </div>
        `}
      `;
    }
  }

  bodyEl.innerHTML = `
    <div class="notice info">
      ZIP 题包导入仍保留；这里用于基于现有版本做小改动，例如编辑 Markdown/LaTeX 题面，或单独上传某个语言包 PDF/DOCX，而不必整包重传。
    </div>
    ${canEdit ? '' : `
      <div class="notice warning">
        当前只存在生效版本。为了避免小改动直接影响线上题面，请先创建一个草稿版本，再在草稿上增量编辑并通过现有版本流水线激活。
      </div>
    `}
    ${renderProblemEditorDataImportPanel()}
    ${renderProblemEditorPdfBatchPanel(canEdit)}
    <div class="problem-editor-meta-grid">
      <div class="form-group">
        <label for="problemEditorTitle">题目标题</label>
        <input id="problemEditorTitle" type="text" value="${esc(problemEditorState.problem?.title || '')}" ${disabledAttr} />
      </div>
      <div class="form-group">
        <label for="problemEditorDefaultLanguage">默认 Markdown 语言</label>
        <select id="problemEditorDefaultLanguage" ${disabledAttr}>${defaultLanguageOptions}</select>
      </div>
      <div style="padding: 12px; border: var(--border-light); border-radius: var(--radius-md); background: hsla(0, 0%, 100%, 0.02);">
        <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">当前编辑版本</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <strong style="font-family: var(--font-mono);">${esc(problemEditorState.editableVersion?.version || '—')}</strong>
          ${statusPill(problemEditorState.editableVersion?.status || 'UNKNOWN')}
          ${statusPill(problemEditorState.editableVersion?.self_test_status || 'PENDING')}
        </div>
      </div>
    </div>
    <div class="problem-editor-workspace-grid">
      <div class="problem-editor-asset-sidebar">
        ${sidebarButtons}
        <div style="display:flex; flex-direction:column; gap: var(--space-sm); max-height: 620px; overflow: auto;">
          ${sidebarItems}
        </div>
      </div>
      <div class="problem-editor-workspace-panel">
        ${workspace}
      </div>
    </div>
  `;
  footerEl.innerHTML = `
    ${targets.standalone ? '<a class="btn btn-secondary" href="/problem-admin" data-link>返回题目管理</a>' : '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>'}
    <button class="btn btn-secondary" onclick="refreshProblemEditorModal()">刷新</button>
    <button class="btn btn-secondary" onclick="showProblemVersionsModal(${jsArg(problemEditorState.slug)})">版本流水线</button>
    ${canEdit
      ? '<button class="btn btn-primary" onclick="saveProblemEditorMeta()">保存基本信息</button>'
      : '<button class="btn btn-primary" onclick="createProblemEditorDraft()">创建编辑草稿</button>'}
  `;
}

function showProblemEditorModal(slug) {
  navigate(`/edit/${encodeURIComponent(slug)}`);
}

async function renderProblemEditIndex() {
  setPage('题目编辑');
  if (!requireAdmin()) return;
  const app = $('app');
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在加载可编辑题目列表...</span>
    </div>
  `;
  try {
    const data = await tryApi(['/api/admin/problems', '/api/problems'], { headers: authHeaders() });
    const items = data.items || [];
    app.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">选择要编辑的题目</h3>
        </div>
        ${items.length === 0 ? emptyBox('平台尚未部署题目') : `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>题目标识</th>
                  <th>题目名称</th>
                  <th>状态</th>
                  <th>当前版本</th>
                  <th style="text-align:right;">操作</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(item => `
                  <tr>
                    <td><strong style="font-family: var(--font-mono);">${esc(item.slug)}</strong></td>
                    <td>${esc(item.title)}</td>
                    <td>${statusPill(item.status)}</td>
                    <td style="font-family: var(--font-mono); font-size: 12px;">${esc(item.active_version || '未激活')}</td>
                    <td style="text-align:right;">
                      <a class="btn btn-primary btn-sm" href="/edit/${esc(item.slug)}" data-link>打开编辑页</a>
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

async function renderProblemEditorPage(slug) {
  setPage(`编辑题目 · ${slug}`);
  if (!requireAdmin()) return;
  problemEditorState = null;
  const app = $('app');
  app.className = 'content animate-fade-in problem-editor-content';
  app.innerHTML = `
    <div class="problem-editor-page">
      <div class="problem-editor-page-top">
        <a class="btn btn-secondary btn-sm" href="/problem-admin" data-link>返回题目管理</a>
        <a class="btn btn-secondary btn-sm" href="/problems/${esc(slug)}" data-link>预览题目</a>
      </div>
      <div id="problemEditorPageBody">
        <div class="loading-overlay">
          <div class="spinner-ring"></div>
          <span class="loading-text">正在加载题目编辑上下文...</span>
        </div>
      </div>
      <div class="problem-editor-page-actions" id="problemEditorPageFooter"></div>
    </div>
  `;
  try {
    const data = await api(`/api/admin/problems/${slug}/editor`, { headers: authHeaders() });
    loadProblemEditorState(data);
    setPage(`编辑题目 · ${data?.problem?.title || slug}`);
    renderProblemEditorModalContent();
  } catch (err) {
    app.innerHTML = errorBox(err);
  }
}

async function refreshProblemEditorModal() {
  if (!problemEditorState?.slug) return;
  const current = captureProblemEditorCurrentAsset();
  const preferred = current ? { kind: current.kind, id: current.item.id || current.item._draftKey || '' } : null;
  try {
    const data = await api(`/api/admin/problems/${problemEditorState.slug}/editor`, { headers: authHeaders() });
    loadProblemEditorState(data, preferred);
    renderProblemEditorModalContent();
  } catch (err) {
    toast(`刷新题目编辑器失败: ${err.message}`, 'error');
  }
}

function selectProblemEditorAsset(key) {
  captureProblemEditorCurrentAsset();
  problemEditorState.selectedKey = key;
  renderProblemEditorModalContent();
}

function addProblemEditorMarkdownAsset() {
  if (!problemEditorCanEdit()) return;
  captureProblemEditorCurrentAsset();
  const tempKey = `tmp-md-${++problemEditorTempId}`;
  problemEditorAssets().markdowns.push({
    _draftKey: tempKey,
    _localOnly: true,
    id: '',
    language: '',
    label: '',
    filename: 'statement.md',
    content: '',
  });
  problemEditorState.selectedKey = `markdown:${tempKey}`;
  renderProblemEditorModalContent();
}

function addProblemEditorPdfAsset() {
  if (!problemEditorCanEdit()) return;
  captureProblemEditorCurrentAsset();
  const tempKey = `tmp-pdf-${++problemEditorTempId}`;
  problemEditorAssets().pdfs.push({
    _draftKey: tempKey,
    _localOnly: true,
    id: '',
    language: '',
    label: '',
    filename: 'statement.pdf',
    download_url: '',
  });
  problemEditorState.selectedKey = `pdf:${tempKey}`;
  renderProblemEditorModalContent();
}

async function createProblemEditorDraft() {
  if (!problemEditorState?.slug) return;
  try {
    const data = await api(`/api/admin/problems/${problemEditorState.slug}/draft`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    loadProblemEditorState(data);
    renderProblemEditorModalContent();
    refreshProblemAdminIfVisible();
    toast('已基于当前版本生成可编辑草稿', 'success');
  } catch (err) {
    toast(`创建编辑草稿失败: ${err.message}`, 'error');
  }
}

async function saveProblemEditorMeta() {
  if (!problemEditorCanEdit()) return;
  const versionId = problemEditorState?.editableVersion?.id;
  if (!versionId) return;
  try {
    const data = await api(`/api/admin/problems/${problemEditorState.slug}/meta`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_id: versionId,
        title: $('problemEditorTitle')?.value?.trim() || '',
        default_language: $('problemEditorDefaultLanguage')?.value || '',
      }),
    });
    loadProblemEditorState(data, problemEditorCurrentAsset() ? { kind: problemEditorCurrentAsset().kind, id: problemEditorCurrentAsset().item.id || '' } : null);
    renderProblemEditorModalContent();
    refreshProblemAdminIfVisible();
    toast('题目基本信息已保存', 'success');
  } catch (err) {
    toast(`保存题目基本信息失败: ${err.message}`, 'error');
  }
}

async function saveProblemEditorMarkdownAsset() {
  if (!problemEditorCanEdit()) return;
  const current = captureProblemEditorCurrentAsset();
  if (!current || current.kind !== 'markdown') return;
  const item = current.item;
  const assetId = (item.id || '').trim();
  if (!assetId) { toast('请填写 Markdown 语言资产 ID', 'warning'); return; }
  if (!(item.content || '').trim()) { toast('Markdown 题面不能为空', 'warning'); return; }
  try {
    const data = await api(`/api/admin/problems/${problemEditorState.slug}/versions/${problemEditorState.editableVersion.id}/statement-markdowns/${encodeURIComponent(assetId)}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: item.language || assetId,
        label: item.label || item.language || assetId,
        filename: item.filename || `${assetId}.md`,
        content: item.content || '',
        make_default: !!item._makeDefault,
      }),
    });
    loadProblemEditorState(data, { kind: 'markdown', id: assetId });
    renderProblemEditorModalContent();
    refreshProblemAdminIfVisible();
    toast('Markdown 题面已保存', 'success');
  } catch (err) {
    toast(`保存 Markdown 题面失败: ${err.message}`, 'error');
  }
}

async function uploadProblemEditorPdf() {
  if (!problemEditorCanEdit()) return;
  const current = captureProblemEditorCurrentAsset();
  if (!current || current.kind !== 'pdf') return;
  const item = current.item;
  const assetId = (item.id || '').trim();
  const fileInput = $('problemEditorPdfFile');
  if (!assetId) { toast('请填写语言资产 ID', 'warning'); return; }
  if (!fileInput || !fileInput.files.length) { toast('请先选择 PDF 或 DOCX 文件', 'warning'); return; }
  try {
    const fd = new FormData();
    fd.append('asset_id', assetId);
    fd.append('language', item.language || assetId);
    fd.append('label', item.label || item.language || assetId);
    fd.append('file', fileInput.files[0]);
    const data = await api(`/api/admin/problems/${problemEditorState.slug}/versions/${problemEditorState.editableVersion.id}/statement-pdfs`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    });
    loadProblemEditorState(data, { kind: 'pdf', id: assetId });
    renderProblemEditorModalContent();
    toast('语言包已上传', 'success');
  } catch (err) {
    toast(`上传语言包失败: ${err.message}`, 'error');
  }
}

async function deleteProblemEditorSelectedAsset() {
  const current = captureProblemEditorCurrentAsset();
  if (!current) return;
  if (!confirm(`确认删除当前${current.kind === 'markdown' ? ' Markdown 题面' : ' PDF 语言包'}吗？`)) return;
  if (current.item._localOnly) {
    const bucket = current.kind === 'markdown' ? problemEditorAssets().markdowns : problemEditorAssets().pdfs;
    const idx = bucket.findIndex(item => (item._draftKey || item.id) === (current.item._draftKey || current.item.id));
    if (idx >= 0) bucket.splice(idx, 1);
    problemEditorEnsureSelection();
    renderProblemEditorModalContent();
    return;
  }
  if (!problemEditorCanEdit()) return;
  const assetId = (current.item.id || '').trim();
  if (!assetId) return;
  try {
    const data = await api(`/api/admin/problems/${problemEditorState.slug}/versions/${problemEditorState.editableVersion.id}/statement-assets/${current.kind === 'markdown' ? 'markdown' : 'pdf'}/${encodeURIComponent(assetId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    loadProblemEditorState(data);
    renderProblemEditorModalContent();
    toast('题面资产已删除', 'success');
  } catch (err) {
    toast(`删除题面资产失败: ${err.message}`, 'error');
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
                      <button class="btn btn-secondary btn-sm" onclick="setContestStatus('${esc(c.slug)}', 'PUBLIC')">发布公开</button>
                      <button class="btn btn-secondary btn-sm" onclick="setContestStatus('${esc(c.slug)}', 'DRAFT')">草稿锁定</button>
                      <button class="btn btn-danger btn-sm" onclick="setContestStatus('${esc(c.slug)}', 'ARCHIVED')">封存归档</button>
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
        <div class="form-group" style="flex: 1; min-width: 220px;">
          <label for="cStatus">竞赛发布状态</label>
          <select id="cStatus">
            <option value="PUBLIC">PUBLIC (立即可见)</option>
            <option value="DRAFT">DRAFT (仅后台可见)</option>
            <option value="ARCHIVED">ARCHIVED (封存)</option>
          </select>
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
  const status = ($('cStatus')?.value || 'PUBLIC').trim().toUpperCase();
  const problemSlugs = ($('cProblems')?.value || '').split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  const desc = $('cDesc')?.value || '';
  try {
    await api('/api/admin/contests/upsert', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug, title, status, description_md: desc,
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

async function setContestStatus(slug, status) {
  try {
    await api(`/api/admin/contests/${slug}/status`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    toast(`竞赛状态已切换为 ${status}`, 'success');
    renderContestAdmin();
  } catch (err) {
    toast(err.message, 'error');
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

// ─── Cloud Drive ───────────────────────────────────────────────────────────
function driveFolderUrl(folderId = null) {
  const id = Number(folderId || 0);
  return `${driveBasePath()}${id ? `?folder=${id}` : ''}`;
}

function currentDriveFolderIdFromLocation() {
  const raw = new URLSearchParams(location.search || '').get('folder');
  const id = Number(raw || 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function driveUsagePercent(usage = {}) {
  const used = Number(usage.used_bytes || 0);
  const quota = Number(usage.quota_bytes || 0);
  if (!quota) return 0;
  return Math.max(0, Math.min(100, (used / quota) * 100));
}

function driveIconSvg(name) {
  const icons = {
    folder: '<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>',
    file: '<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
    upload: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>',
    plusFolder: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><line x1="12" y1="10" x2="12" y2="16"></line><line x1="9" y1="13" x2="15" y2="13"></line></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.5 9a9 9 0 0 1 14.8-3.4L23 10"></path><path d="M20.5 15a9 9 0 0 1-14.8 3.4L1 14"></path></svg>',
    download: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
    edit: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
    trash: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>',
    search: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
    share: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="M8.6 13.5l6.8 4"></path><path d="M15.4 6.5l-6.8 4"></path></svg>',
    move: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l-3 3 3 3"></path><path d="M9 5l3-3 3 3"></path><path d="M15 19l-3 3-3-3"></path><path d="M19 9l3 3-3 3"></path><path d="M2 12h20"></path><path d="M12 2v20"></path></svg>',
    eye: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    check: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>',
  };
  return icons[name] || icons.file;
}

function driveItemIcon(item) {
  if (item.kind === 'FOLDER') {
    return `<span class="drive-item-icon folder">${driveIconSvg('folder')}</span>`;
  }
  const ext = String(item.name || '').split('.').pop();
  const label = ext && ext !== item.name ? ext.slice(0, 4).toUpperCase() : 'FILE';
  return `<span class="drive-item-icon file">${driveIconSvg('file')}<span>${esc(label)}</span></span>`;
}

function driveFilteredItems() {
  const query = String(state.driveSearch || '').trim().toLowerCase();
  if (!query) return state.driveItems || [];
  return (state.driveItems || []).filter((item) => String(item.name || '').toLowerCase().includes(query));
}

function driveCanPreview(item) {
  if (!item || item.kind !== 'FILE') return false;
  const type = String(item.content_type || '').split(';', 1)[0].toLowerCase();
  return type.startsWith('image/')
    || type.startsWith('text/')
    || ['application/pdf', 'application/json', 'application/javascript', 'application/xml', 'application/x-javascript', 'image/svg+xml'].includes(type);
}

function driveSelectedIds() {
  return Array.from(state.driveSelectedIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0);
}

function pruneDriveSelection() {
  const ids = new Set((state.driveItems || []).map((item) => Number(item.id)));
  state.driveSelectedIds = new Set(driveSelectedIds().filter((id) => ids.has(id)));
}

function renderDriveBatchBar() {
  const selected = driveSelectedIds();
  if (!selected.length) return '';
  return `
    <div class="drive-batch-bar" id="driveBatchBar">
      <span>${selected.length} 项已选择</span>
      <button class="btn btn-secondary btn-sm" type="button" onclick="downloadSelectedDriveItems()">${driveIconSvg('download')}打包下载</button>
      <button class="btn btn-secondary btn-sm" type="button" onclick="showDriveMoveModal()">${driveIconSvg('move')}移动到</button>
      <button class="btn btn-secondary btn-sm" type="button" onclick="clearDriveSelection()">取消选择</button>
      <button class="btn btn-danger btn-sm" type="button" onclick="deleteSelectedDriveItems()">${driveIconSvg('trash')}删除</button>
    </div>
  `;
}

function renderDriveBreadcrumbs() {
  const crumbs = state.driveBreadcrumbs?.length ? state.driveBreadcrumbs : [{ id: null, name: 'My Drive' }];
  return crumbs.map((crumb, idx) => `
    <button
      class="drive-crumb ${idx === crumbs.length - 1 ? 'active' : ''}"
      type="button"
      onclick="openDriveFolder(${crumb.id ? Number(crumb.id) : 'null'})"
      title="${esc(crumb.name)}"
    >${esc(idx === 0 ? '我的云盘' : crumb.name)}</button>
  `).join('<span class="drive-crumb-separator">/</span>');
}

function renderDriveItemsList() {
  const items = driveFilteredItems();
  if (!items.length) {
    const emptyText = state.driveSearch ? '没有匹配的文件' : '此文件夹为空';
    return `
      <div class="drive-empty">
        <div class="drive-empty-icon">${driveIconSvg('folder')}</div>
        <strong>${emptyText}</strong>
        <span>${state.driveSearch ? '当前关键词没有结果' : '当前目录还没有内容'}</span>
      </div>
    `;
  }

  return `
    <div class="drive-table" role="table" aria-label="云盘文件列表">
      <div class="drive-row drive-head" role="row">
        <div><input type="checkbox" aria-label="全选" ${items.length && items.every((item) => state.driveSelectedIds.has(Number(item.id))) ? 'checked' : ''} onchange="toggleAllDriveItems(this.checked)" /></div>
        <div>名称</div>
        <div>大小</div>
        <div>更新时间</div>
        <div>操作</div>
      </div>
      ${items.map((item) => {
        const isFolder = item.kind === 'FOLDER';
        const rowAction = isFolder ? `onclick="openDriveFolder(${Number(item.id)})"` : '';
        const rowClass = isFolder ? 'drive-row folder' : 'drive-row file';
        const selected = state.driveSelectedIds.has(Number(item.id));
        return `
          <div class="${rowClass} ${selected ? 'selected' : ''}" role="row" ${rowAction} title="${esc(item.name)}">
            <div class="drive-select-cell">
              <input type="checkbox" ${selected ? 'checked' : ''} onclick="event.stopPropagation()" onchange="toggleDriveItemSelection(${Number(item.id)}, this.checked)" aria-label="选择 ${esc(item.name)}" />
            </div>
            <div class="drive-name-cell">
              ${driveItemIcon(item)}
              <div class="drive-name-text">
                <strong>${esc(item.name)}</strong>
                <span>${isFolder ? '文件夹' : esc(item.content_type || 'application/octet-stream')}</span>
              </div>
            </div>
            <div class="drive-meta-cell">${isFolder ? '-' : formatBytes(item.size_bytes)}</div>
            <div class="drive-meta-cell">${formatDate(item.updated_at || item.created_at) || '-'}</div>
            <div class="drive-actions-cell">
              ${driveCanPreview(item) ? `<button class="drive-icon-btn" type="button" onclick="event.stopPropagation(); previewDriveFile(${Number(item.id)})" title="预览" aria-label="预览 ${esc(item.name)}">${driveIconSvg('eye')}</button>` : ''}
              <button class="drive-icon-btn" type="button" onclick="event.stopPropagation(); downloadDriveFile(${Number(item.id)})" title="${isFolder ? '打包下载' : '下载'}" aria-label="下载 ${esc(item.name)}">${driveIconSvg('download')}</button>
              <button class="drive-icon-btn" type="button" onclick="event.stopPropagation(); showDriveShareModal(${Number(item.id)})" title="分享" aria-label="分享 ${esc(item.name)}">${driveIconSvg('share')}</button>
              <button class="drive-icon-btn" type="button" onclick="event.stopPropagation(); showDriveMoveModal(${Number(item.id)})" title="移动" aria-label="移动 ${esc(item.name)}">${driveIconSvg('move')}</button>
              <button class="drive-icon-btn" type="button" onclick="event.stopPropagation(); showDriveRenameModal(${Number(item.id)})" title="重命名" aria-label="重命名 ${esc(item.name)}">${driveIconSvg('edit')}</button>
              <button class="drive-icon-btn danger" type="button" onclick="event.stopPropagation(); deleteDriveItem(${Number(item.id)})" title="删除" aria-label="删除 ${esc(item.name)}">${driveIconSvg('trash')}</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function filterDriveItems(value) {
  state.driveSearch = String(value || '');
  const list = $('driveItemsList');
  if (list) list.innerHTML = renderDriveItemsList();
  const count = $('driveVisibleCount');
  if (count) count.textContent = `${driveFilteredItems().length} 项`;
  const batch = $('driveBatchMount');
  if (batch) batch.innerHTML = renderDriveBatchBar();
}

function refreshDriveListChrome() {
  const list = $('driveItemsList');
  if (list) list.innerHTML = renderDriveItemsList();
  const batch = $('driveBatchMount');
  if (batch) batch.innerHTML = renderDriveBatchBar();
  const count = $('driveVisibleCount');
  if (count) count.textContent = `${driveFilteredItems().length} 项`;
}

function toggleDriveItemSelection(itemId, checked) {
  const id = Number(itemId);
  if (!Number.isFinite(id) || id <= 0) return;
  if (!state.driveSelectedIds) state.driveSelectedIds = new Set();
  if (checked) state.driveSelectedIds.add(id);
  else state.driveSelectedIds.delete(id);
  refreshDriveListChrome();
}

function toggleAllDriveItems(checked) {
  if (!state.driveSelectedIds) state.driveSelectedIds = new Set();
  for (const item of driveFilteredItems()) {
    const id = Number(item.id);
    if (checked) state.driveSelectedIds.add(id);
    else state.driveSelectedIds.delete(id);
  }
  refreshDriveListChrome();
}

function clearDriveSelection() {
  state.driveSelectedIds = new Set();
  refreshDriveListChrome();
}

function renderDriveUploadProgress() {
  const progress = state.driveUploadProgress;
  if (!progress) return '';
  const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
  return `
    <div class="drive-upload-progress">
      <div class="drive-upload-progress-top">
        <strong>${esc(progress.fileName || '正在上传')}</strong>
        <span>${Number(progress.index || 0)} / ${Number(progress.total || 0)} · ${percent.toFixed(percent >= 10 ? 0 : 1)}%</span>
      </div>
      <div class="drive-quota-bar"><span style="width:${percent.toFixed(2)}%"></span></div>
    </div>
  `;
}

function updateDriveUploadProgress(progress) {
  state.driveUploadProgress = progress;
  const mount = $('driveUploadProgressMount');
  if (mount) mount.innerHTML = renderDriveUploadProgress();
}

function xhrUploadDriveFile(file, parentId, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('file', file);
    if (parentId) fd.append('parent_id', String(parentId));
    xhr.open('POST', '/api/drive/files');
    const headers = authHeaders();
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.max(0, Math.min(100, (event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      let payload = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        payload = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
      } else {
        const message = payload && typeof payload === 'object'
          ? (payload.detail || payload.message || JSON.stringify(payload))
          : (payload || `${xhr.status} ${xhr.statusText}`);
        const err = new Error(message);
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error('上传连接失败'));
    xhr.send(fd);
  });
}

function renderDriveBrowser(data) {
  const app = $('app');
  state.driveItems = Array.isArray(data.items) ? data.items : [];
  state.driveBreadcrumbs = Array.isArray(data.breadcrumbs) ? data.breadcrumbs : [];
  state.driveUsage = data.usage || null;
  state.driveCurrentFolderId = data.parent?.id || currentDriveFolderIdFromLocation();
  pruneDriveSelection();
  updateNav();

  const usage = state.driveUsage || {};
  const used = Number(usage.used_bytes || 0);
  const quota = Number(usage.quota_bytes || 0);
  const percent = driveUsagePercent(usage);

  app.innerHTML = `
    <div class="drive-shell" id="driveShell">
      <section class="drive-toolbar" id="driveDropZone" ondragover="handleDriveDragOver(event)" ondragleave="handleDriveDragLeave(event)" ondrop="handleDriveDrop(event)">
        <div class="drive-toolbar-main">
          <div class="drive-title-block">
            <span class="drive-title-icon">${driveIconSvg('folder')}</span>
            <div>
              <h2>我的云盘</h2>
              <span>${formatBytes(used)} / ${quota ? formatBytes(quota) : '-'}</span>
            </div>
          </div>
          <div class="drive-actions">
            <div class="drive-search">
              ${driveIconSvg('search')}
              <input id="driveSearchInput" type="search" placeholder="搜索当前文件夹" value="${esc(state.driveSearch)}" oninput="filterDriveItems(this.value)" />
            </div>
            <label class="btn btn-primary btn-sm drive-upload-btn" for="driveUploadInput">
              ${driveIconSvg('upload')}
              上传
              <input id="driveUploadInput" type="file" multiple onchange="uploadDriveFiles(this.files)" />
            </label>
            <button class="btn btn-secondary btn-sm" type="button" onclick="showDriveFolderModal()">${driveIconSvg('plusFolder')}新建文件夹</button>
            <button class="btn btn-secondary btn-sm" type="button" onclick="renderCloudDrive()">${driveIconSvg('refresh')}刷新</button>
          </div>
        </div>
        <div class="drive-quota">
          <div class="drive-quota-bar"><span style="width:${percent.toFixed(2)}%"></span></div>
          <span>${percent.toFixed(percent >= 10 ? 0 : 1)}%</span>
        </div>
        <div id="driveUploadProgressMount">${renderDriveUploadProgress()}</div>
      </section>

      <section class="drive-browser" id="driveBrowser">
        <div class="drive-browser-top">
          <div class="drive-breadcrumbs">${renderDriveBreadcrumbs()}</div>
          <span id="driveVisibleCount" class="text-muted">${driveFilteredItems().length} 项</span>
        </div>
        <div id="driveBatchMount">${renderDriveBatchBar()}</div>
        <div id="driveItemsList">${renderDriveItemsList()}</div>
      </section>
    </div>
  `;
}

async function renderCloudDrive() {
  setPage('云盘');
  const app = $('app');
  app.className = 'content animate-fade-in drive-page';

  if (!state.user) {
    app.innerHTML = `
      <div class="empty-state drive-login-state">
        <div class="empty-icon">${driveIconSvg('folder')}</div>
        <h2 style="font-family: var(--font-display); font-size: 20px; font-weight:700; margin-bottom: 6px;">登录后访问云盘</h2>
        <p class="text-muted" style="margin-bottom: 16px;">文件会保存在你的个人空间中，并与主站账号同步。</p>
        <button class="btn btn-primary" onclick="showAuthModal('login')">登录 / 注册</button>
      </div>
    `;
    return;
  }

  const parentId = currentDriveFolderIdFromLocation();
  state.driveCurrentFolderId = parentId;
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在加载云盘...</span>
    </div>
  `;

  try {
    const params = new URLSearchParams();
    if (parentId) params.set('parent_id', String(parentId));
    const data = await api(`/api/drive/items${params.toString() ? `?${params.toString()}` : ''}`, {
      headers: authHeaders(),
    });
    renderDriveBrowser(data);
  } catch (err) {
    if (err.status === 404 && parentId) {
      history.replaceState(null, '', driveFolderUrl(null));
      toast('文件夹不存在，已返回云盘根目录。', 'warning');
      return renderCloudDrive();
    }
    app.innerHTML = `
      <div class="notice error">${esc(err.message || '云盘加载失败')}</div>
      <button class="btn btn-secondary mt-md" onclick="renderCloudDrive()">重试</button>
    `;
  }
}

function openDriveFolder(folderId = null) {
  state.driveSearch = '';
  navigate(driveFolderUrl(folderId));
}

function showDriveFolderModal() {
  if (!state.user) {
    showAuthModal('login');
    return;
  }
  openModal({
    title: '新建文件夹',
    body: `
      <div class="form-group">
        <label for="driveFolderName">文件夹名称</label>
        <input id="driveFolderName" type="text" maxlength="180" placeholder="例如：资料" />
      </div>
      <div id="driveFolderError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="driveFolderSubmit" onclick="createDriveFolder()">创建</button>
    `,
  });
  setTimeout(() => $('driveFolderName')?.focus(), 50);
}

async function createDriveFolder() {
  const name = $('driveFolderName')?.value?.trim();
  if (!name) {
    toast('请输入文件夹名称', 'warning');
    return;
  }
  const btn = $('driveFolderSubmit');
  if (btn) btn.disabled = true;
  try {
    await api('/api/drive/folders', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parent_id: state.driveCurrentFolderId || null }),
    });
    closeModal();
    toast('文件夹已创建', 'success');
    await renderCloudDrive();
  } catch (err) {
    const el = $('driveFolderError');
    if (el) {
      el.style.display = '';
      el.textContent = err.message;
    } else {
      toast(err.message, 'danger');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function driveItemById(itemId) {
  const id = Number(itemId || 0);
  return (state.driveItems || []).find((item) => Number(item.id) === id) || null;
}

function showDriveRenameModal(itemId) {
  const item = driveItemById(itemId);
  if (!item) return;
  openModal({
    title: '重命名',
    body: `
      <div class="form-group">
        <label for="driveRenameInput">名称</label>
        <input id="driveRenameInput" type="text" maxlength="180" value="${esc(item.name)}" />
      </div>
      <div id="driveRenameError" class="notice error" style="display:none"></div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="driveRenameSubmit" onclick="saveDriveRename(${Number(item.id)})">保存</button>
    `,
  });
  setTimeout(() => {
    const input = $('driveRenameInput');
    input?.focus();
    input?.select();
  }, 50);
}

async function saveDriveRename(itemId) {
  const name = $('driveRenameInput')?.value?.trim();
  if (!name) {
    toast('请输入名称', 'warning');
    return;
  }
  const btn = $('driveRenameSubmit');
  if (btn) btn.disabled = true;
  try {
    await api(`/api/drive/items/${Number(itemId)}`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    closeModal();
    toast('名称已更新', 'success');
    await renderCloudDrive();
  } catch (err) {
    const el = $('driveRenameError');
    if (el) {
      el.style.display = '';
      el.textContent = err.message;
    } else {
      toast(err.message, 'danger');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteDriveItem(itemId) {
  const item = driveItemById(itemId);
  if (!item) return;
  const message = item.kind === 'FOLDER'
    ? `删除文件夹“${item.name}”及其中所有内容？`
    : `删除文件“${item.name}”？`;
  if (!confirm(message)) return;
  try {
    await api(`/api/drive/items/${Number(itemId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    toast('已删除', 'success');
    await renderCloudDrive();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

function filenameFromContentDisposition(disposition, fallback) {
  const value = String(disposition || '');
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return fallback;
    }
  }
  const asciiMatch = value.match(/filename="([^"]+)"/i);
  return asciiMatch ? asciiMatch[1] : fallback;
}

async function downloadDriveFile(itemId) {
  const item = driveItemById(itemId);
  if (!item) return;
  try {
    const res = await fetch(`/api/drive/items/${Number(itemId)}/download`, { headers: authHeaders() });
    await saveDriveDownloadResponse(res, item.kind === 'FOLDER' ? `${item.name || 'folder'}.zip` : (item.name || 'download'));
  } catch (err) {
    toast(err.message || '下载失败', 'danger');
  }
}

async function saveDriveDownloadResponse(res, fallbackName) {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const payload = await res.json();
      message = payload.detail || payload.message || message;
    } catch {
      message = await res.text() || message;
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFromContentDisposition(res.headers.get('content-disposition'), fallbackName || 'download');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function downloadSelectedDriveItems() {
  const ids = driveSelectedIds();
  if (!ids.length) return;
  try {
    const res = await fetch('/api/drive/batch/download', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_ids: ids }),
    });
    await saveDriveDownloadResponse(res, 'drive-selection.zip');
  } catch (err) {
    toast(err.message || '打包下载失败', 'danger');
  }
}

async function deleteSelectedDriveItems() {
  const ids = driveSelectedIds();
  if (!ids.length) return;
  if (!confirm(`删除选中的 ${ids.length} 项及其中所有内容？`)) return;
  try {
    await api('/api/drive/batch/delete', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_ids: ids }),
    });
    clearDriveSelection();
    toast('已删除选中项目', 'success');
    await renderCloudDrive();
  } catch (err) {
    toast(err.message || '批量删除失败', 'danger');
  }
}

async function previewDriveFile(itemId) {
  const item = driveItemById(itemId);
  if (!item || !driveCanPreview(item)) return;
  const type = String(item.content_type || '').split(';', 1)[0].toLowerCase();
  openModal({
    title: item.name,
    wide: true,
    body: `<div id="drivePreviewMount" class="drive-preview-loading">正在加载预览...</div>`,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">关闭</button>
      <button class="btn btn-primary" onclick="downloadDriveFile(${Number(itemId)})">${driveIconSvg('download')}下载</button>
    `,
  });
  try {
    const res = await fetch(`/api/drive/items/${Number(itemId)}/preview`, { headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text() || '预览失败');
    const mount = $('drivePreviewMount');
    if (!mount) return;
    if (type.startsWith('image/') || type === 'application/pdf') {
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      mount.innerHTML = type.startsWith('image/')
        ? `<img class="drive-preview-media" alt="${esc(item.name)}" src="${objectUrl}" />`
        : `<iframe class="drive-preview-frame" src="${objectUrl}" title="${esc(item.name)}"></iframe>`;
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10 * 60 * 1000);
    } else {
      const text = await res.text();
      mount.innerHTML = `<pre class="drive-preview-text"></pre>`;
      const pre = mount.querySelector('pre');
      if (pre) pre.textContent = text.slice(0, 200000);
    }
  } catch (err) {
    const mount = $('drivePreviewMount');
    if (mount) mount.textContent = err.message || '预览失败';
  }
}

function renderDriveSharesList(shares = []) {
  if (!shares.length) {
    return '<div class="drive-share-empty">还没有分享链接</div>';
  }
  return shares.map((share) => `
    <div class="drive-share-row">
      <div>
        <strong>${esc(share.active ? '可访问' : '已失效')}</strong>
        <span>${esc(share.page_url || '')}</span>
        <small>${share.requires_password ? '需要密码 · ' : ''}${share.expires_at ? `到期 ${formatDate(share.expires_at)} · ` : '永久有效 · '}下载 ${Number(share.download_count || 0)}${share.max_downloads ? `/${Number(share.max_downloads)}` : ''}</small>
      </div>
      <button class="drive-icon-btn" type="button" onclick="copyDriveShareLink('${esc(share.page_url || '')}')" title="复制">${driveIconSvg('share')}</button>
      <button class="drive-icon-btn danger" type="button" onclick="revokeDriveShare(${Number(share.id)})" title="撤销">${driveIconSvg('trash')}</button>
    </div>
  `).join('');
}

async function copyDriveShareLink(url) {
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    toast('分享链接已复制', 'success');
  } catch {
    prompt('复制分享链接', url);
  }
}

async function showDriveShareModal(itemId) {
  const item = driveItemById(itemId);
  if (!item) return;
  state.driveShareActiveItemId = Number(item.id);
  openModal({
    title: `分享：${item.name}`,
    wide: true,
    body: `
      <div class="drive-share-panel">
        <div class="drive-share-form">
          <div class="form-group">
            <label for="driveShareDays">有效期</label>
            <select id="driveShareDays">
              <option value="">永久有效</option>
              <option value="1">1 天</option>
              <option value="7" selected>7 天</option>
              <option value="30">30 天</option>
              <option value="365">365 天</option>
            </select>
          </div>
          <div class="form-group">
            <label for="driveShareMaxDownloads">下载次数上限</label>
            <input id="driveShareMaxDownloads" type="number" min="1" max="100000" placeholder="不限" />
          </div>
          <div class="form-group">
            <label for="driveSharePassword">访问密码</label>
            <input id="driveSharePassword" type="text" maxlength="80" placeholder="可选" />
          </div>
        </div>
        <div id="driveShareError" class="notice error" style="display:none"></div>
        <div id="driveShareList" class="drive-share-list">正在加载...</div>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">关闭</button>
      <button class="btn btn-primary" id="driveShareCreateBtn" onclick="createDriveShare(${Number(item.id)})">${driveIconSvg('share')}生成链接</button>
    `,
  });
  await refreshDriveShares(item.id);
}

async function refreshDriveShares(itemId) {
  const list = $('driveShareList');
  if (list) list.textContent = '正在加载...';
  try {
    const data = await api(`/api/drive/items/${Number(itemId)}/shares`, { headers: authHeaders() });
    if (list) list.innerHTML = renderDriveSharesList(data.shares || []);
  } catch (err) {
    if (list) list.innerHTML = `<div class="notice error">${esc(err.message || '加载分享失败')}</div>`;
  }
}

async function createDriveShare(itemId) {
  const btn = $('driveShareCreateBtn');
  if (btn) btn.disabled = true;
  const error = $('driveShareError');
  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }
  try {
    const days = $('driveShareDays')?.value || null;
    const maxDownloads = $('driveShareMaxDownloads')?.value || null;
    const password = $('driveSharePassword')?.value || '';
    const data = await api(`/api/drive/items/${Number(itemId)}/shares`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expires_in_days: days,
        max_downloads: maxDownloads,
        password,
      }),
    });
    await refreshDriveShares(itemId);
    await copyDriveShareLink(data.share?.page_url || '');
  } catch (err) {
    if (error) {
      error.style.display = '';
      error.textContent = err.message || '生成分享失败';
    } else {
      toast(err.message || '生成分享失败', 'danger');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function revokeDriveShare(shareId) {
  if (!confirm('撤销这个分享链接？')) return;
  try {
    await api(`/api/drive/shares/${Number(shareId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    toast('分享链接已撤销', 'success');
    const itemId = state.driveShareActiveItemId;
    if (itemId) await refreshDriveShares(itemId);
  } catch (err) {
    toast(err.message || '撤销失败', 'danger');
  }
}

function showDriveMoveModal(itemId = null) {
  const ids = itemId ? [Number(itemId)] : driveSelectedIds();
  if (!ids.length) {
    toast('请先选择要移动的项目', 'warning');
    return;
  }
  state.driveMoveItemIds = ids;
  state.driveMoveTargetSearchResults = [];
  openModal({
    title: `移动 ${ids.length} 项`,
    wide: true,
    body: `
      <div class="drive-move-panel">
        <div class="drive-move-quick">
          <button class="btn btn-secondary btn-sm" onclick="moveDriveItemsTo(null)">移动到根目录</button>
          <button class="btn btn-secondary btn-sm" onclick="moveDriveItemsTo(${state.driveCurrentFolderId ? Number(state.driveCurrentFolderId) : 'null'})">移动到当前目录</button>
        </div>
        <div class="form-group">
          <label for="driveMoveSearch">搜索目标文件夹</label>
          <input id="driveMoveSearch" type="search" placeholder="输入文件夹名称" oninput="searchDriveMoveTargets(this.value)" />
        </div>
        <div id="driveMoveError" class="notice error" style="display:none"></div>
        <div id="driveMoveTargets" class="drive-move-targets">
          <div class="drive-share-empty">搜索后选择目标文件夹</div>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
    `,
  });
  setTimeout(() => $('driveMoveSearch')?.focus(), 50);
}

let driveMoveSearchTimer = null;
function searchDriveMoveTargets(value) {
  clearTimeout(driveMoveSearchTimer);
  const query = String(value || '').trim();
  const mount = $('driveMoveTargets');
  if (!query) {
    if (mount) mount.innerHTML = '<div class="drive-share-empty">搜索后选择目标文件夹</div>';
    return;
  }
  driveMoveSearchTimer = setTimeout(async () => {
    if (mount) mount.textContent = '正在搜索...';
    try {
      const data = await api(`/api/drive/search?q=${encodeURIComponent(query)}`, { headers: authHeaders() });
      const moving = new Set((state.driveMoveItemIds || []).map(Number));
      const folders = (data.items || []).filter((item) => item.kind === 'FOLDER' && !moving.has(Number(item.id)));
      state.driveMoveTargetSearchResults = folders;
      if (!mount) return;
      if (!folders.length) {
        mount.innerHTML = '<div class="drive-share-empty">没有匹配的文件夹</div>';
        return;
      }
      mount.innerHTML = folders.map((folder) => `
        <button class="drive-move-target" type="button" onclick="moveDriveItemsTo(${Number(folder.id)})">
          ${driveIconSvg('folder')}
          <span>${esc(folder.name)}</span>
        </button>
      `).join('');
    } catch (err) {
      if (mount) mount.innerHTML = `<div class="notice error">${esc(err.message || '搜索失败')}</div>`;
    }
  }, 250);
}

async function moveDriveItemsTo(parentId) {
  const ids = (state.driveMoveItemIds || []).map(Number).filter(Boolean);
  if (!ids.length) return;
  const error = $('driveMoveError');
  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }
  try {
    await api('/api/drive/batch/move', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_ids: ids, parent_id: parentId || null }),
    });
    closeModal();
    clearDriveSelection();
    toast('已移动', 'success');
    await renderCloudDrive();
  } catch (err) {
    if (error) {
      error.style.display = '';
      error.textContent = err.message || '移动失败';
    } else {
      toast(err.message || '移动失败', 'danger');
    }
  }
}

async function uploadDriveFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (!state.user) {
    showAuthModal('login');
    return;
  }
  const tooLarge = files.find((file) => Number(file.size || 0) > DRIVE_MAX_UPLOAD_BYTES);
  if (tooLarge) {
    toast(`${tooLarge.name} 超过 100 MB 单文件限制`, 'warning');
    return;
  }
  if (state.driveUploadInFlight) return;
  state.driveUploadInFlight = true;
  const input = $('driveUploadInput');
  if (input) input.disabled = true;
  let uploaded = 0;
  try {
    for (const file of files) {
      updateDriveUploadProgress({
        fileName: file.name,
        index: uploaded + 1,
        total: files.length,
        percent: 0,
      });
      await xhrUploadDriveFile(file, state.driveCurrentFolderId, (percent) => updateDriveUploadProgress({
        fileName: file.name,
        index: uploaded + 1,
        total: files.length,
        percent,
      }));
      uploaded++;
      toast(`已上传 ${uploaded}/${files.length}: ${file.name}`, 'success');
    }
    await renderCloudDrive();
  } catch (err) {
    toast(err.message || '上传失败', 'danger');
    await renderCloudDrive();
  } finally {
    state.driveUploadInFlight = false;
    updateDriveUploadProgress(null);
    if (input) {
      input.disabled = false;
      input.value = '';
    }
  }
}

function handleDriveDragOver(event) {
  event.preventDefault();
  $('driveDropZone')?.classList.add('dragover');
}

function handleDriveDragLeave(event) {
  event.preventDefault();
  $('driveDropZone')?.classList.remove('dragover');
}

function handleDriveDrop(event) {
  event.preventDefault();
  $('driveDropZone')?.classList.remove('dragover');
  uploadDriveFiles(event.dataTransfer?.files);
}

async function renderPublicDriveShare(token) {
  setPage('文件分享');
  const app = $('app');
  app.className = 'content animate-fade-in drive-page';
  app.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner-ring"></div>
      <span class="loading-text">正在加载分享...</span>
    </div>
  `;
  try {
    const data = await api(`/api/drive/shares/${encodeURIComponent(token)}`);
    const share = data.share || {};
    const isFolder = share.kind === 'FOLDER';
    app.innerHTML = `
      <div class="drive-public-share">
        <section class="drive-toolbar">
          <div class="drive-toolbar-main">
            <div class="drive-title-block">
              <span class="drive-title-icon">${driveIconSvg(isFolder ? 'folder' : 'file')}</span>
              <div>
                <h2>${esc(share.name || '分享文件')}</h2>
                <span>${esc(share.owner_username || '用户')} 分享 · ${isFolder ? '文件夹' : formatBytes(share.size_bytes || 0)}</span>
              </div>
            </div>
            <div class="drive-actions">
              ${share.requires_password ? '<input id="publicSharePassword" type="text" placeholder="访问密码" style="max-width:160px" />' : ''}
              ${share.previewable ? `<button class="btn btn-secondary btn-sm" onclick="previewPublicDriveShare('${esc(token)}')">${driveIconSvg('eye')}预览</button>` : ''}
              <button class="btn btn-primary btn-sm" onclick="downloadPublicDriveShare('${esc(token)}')">${driveIconSvg('download')}${isFolder ? '下载 ZIP' : '下载'}</button>
            </div>
          </div>
          <div class="drive-public-meta">
            <span>${share.expires_at ? `有效期至 ${formatDate(share.expires_at)}` : '永久有效'}</span>
            <span>下载 ${Number(share.download_count || 0)}${share.max_downloads ? `/${Number(share.max_downloads)}` : ''}</span>
          </div>
        </section>
        <section class="drive-browser">
          <div id="publicSharePreview" class="drive-empty">
            <div class="drive-empty-icon">${driveIconSvg(isFolder ? 'folder' : 'file')}</div>
            <strong>${isFolder ? '文件夹分享' : '文件分享'}</strong>
            <span>${share.requires_password ? '输入访问密码后下载或预览。' : '可以直接下载。'}</span>
          </div>
        </section>
      </div>
    `;
  } catch (err) {
    app.innerHTML = `
      <div class="empty-state drive-login-state">
        <div class="empty-icon">${driveIconSvg('share')}</div>
        <h2 style="font-family: var(--font-display); font-size: 20px; font-weight:700; margin-bottom: 6px;">分享不可访问</h2>
        <p class="text-muted" style="margin-bottom: 16px;">${esc(err.message || '链接不存在或已失效')}</p>
      </div>
    `;
  }
}

function publicSharePasswordQuery() {
  const password = $('publicSharePassword')?.value || '';
  return password ? `?password=${encodeURIComponent(password)}` : '';
}

async function downloadPublicDriveShare(token) {
  try {
    const res = await fetch(`/api/drive/shares/${encodeURIComponent(token)}/download${publicSharePasswordQuery()}`);
    await saveDriveDownloadResponse(res, 'shared-file');
  } catch (err) {
    toast(err.message || '下载失败', 'danger');
  }
}

async function previewPublicDriveShare(token) {
  const mount = $('publicSharePreview');
  if (!mount) return;
  mount.textContent = '正在加载预览...';
  try {
    const meta = await api(`/api/drive/shares/${encodeURIComponent(token)}`);
    const share = meta.share || {};
    const type = String(share.content_type || '').split(';', 1)[0].toLowerCase();
    const res = await fetch(`/api/drive/shares/${encodeURIComponent(token)}/preview${publicSharePasswordQuery()}`);
    if (!res.ok) throw new Error(await res.text() || '预览失败');
    if (type.startsWith('image/') || type === 'application/pdf') {
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      mount.innerHTML = type.startsWith('image/')
        ? `<img class="drive-preview-media" alt="${esc(share.name || 'preview')}" src="${objectUrl}" />`
        : `<iframe class="drive-preview-frame" src="${objectUrl}" title="${esc(share.name || 'preview')}"></iframe>`;
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10 * 60 * 1000);
    } else {
      const text = await res.text();
      mount.innerHTML = '<pre class="drive-preview-text"></pre>';
      const pre = mount.querySelector('pre');
      if (pre) pre.textContent = text.slice(0, 200000);
    }
  } catch (err) {
    mount.innerHTML = `<div class="notice error">${esc(err.message || '预览失败')}</div>`;
  }
}

// ─── SPA Router ─────────────────────────────────────────────────────────────
function route() {
  clearPageState();
  let path = location.pathname || '/';
  const isSpace = isDriveHost();

  // Support legacy hash routers redirects
  if (location.hash.startsWith('#/')) {
    const newPath = location.hash.slice(1);
    history.replaceState(null, '', newPath);
    path = newPath;
  }

  const shareMatch = path.match(/^\/share\/([^/]+)$/);
  if (shareMatch) {
    return renderPublicDriveShare(decodeURIComponent(shareMatch[1]));
  }

  if (isSpace) {
    if (path === '/drive') {
      history.replaceState(null, '', `/${location.search || ''}`);
      path = '/';
    } else if (path !== '/') {
      history.replaceState(null, '', `/${location.search || ''}`);
      path = '/';
    }
  } else if (isChatApp()) {
    if (path === '/messages') {
      history.replaceState(null, '', '/');
      path = '/';
    } else if (path.startsWith('/messages/')) {
      const newPath = path.replace(/^\/messages/, '');
      history.replaceState(null, '', newPath);
      path = newPath;
    }
    const isMessagesPath = path === '/' || /^\/(?:groups\/)?\d+$/.test(path);
    if (!isMessagesPath) {
      history.replaceState(null, '', '/');
      path = '/';
    }
  } else {
    // If we are on the main site (e.g. yxyx.space), clicking messages should redirect to hello.yxyx.space
    if (sameYxyxSite() && (path === '/messages' || path.startsWith('/messages/'))) {
      const targetPath = path === '/messages' ? '/' : path.replace(/^\/messages/, '');
      window.location.href = `https://${AIOJ_CHAT_HOST}${targetPath}`;
      return;
    }
    if (sameYxyxSite() && (path === '/drive' || path.startsWith('/drive/'))) {
      const targetPath = path === '/drive' ? '/' : path.replace(/^\/drive/, '');
      window.location.href = `https://${AIOJ_DRIVE_HOST}${targetPath}${location.search || ''}`;
      return;
    }
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
  if (path === '/') {
    if (isSpace) {
      return renderCloudDrive();
    }
    if (isChatApp()) {
      return renderMessages();
    }
    return renderDashboard();
  }
  if (path === '/drive') return renderCloudDrive();
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
  if (path === '/edit') return renderProblemEditIndex();
  if (path === '/contest-admin') return renderContestAdmin();

  // Parameterized routes
  let match;
  if (isChatApp()) {
    if ((match = path.match(/^\/groups\/(\d+)$/))) {
      return renderMessages(`group:${match[1]}`);
    }
    if ((match = path.match(/^\/(\d+)$/))) {
      return renderMessages(`direct:${match[1]}`);
    }
  } else {
    if ((match = path.match(/^\/messages\/groups\/(\d+)$/))) {
      return renderMessages(`group:${match[1]}`);
    }
    if ((match = path.match(/^\/messages\/(\d+)$/))) {
      return renderMessages(`direct:${match[1]}`);
    }
  }
  if ((match = path.match(/^\/edit\/([^/]+)$/))) {
    return renderProblemEditorPage(decodeURIComponent(match[1]));
  }
  if ((match = path.match(/^\/contests\/([^/]+)\/problems\/([^/]+)$/))) {
    return renderProblemDetail(match[2], match[1]);
  }
  if ((match = path.match(/^\/users\/([^/]+)$/))) {
    return renderUserProfile(decodeURIComponent(match[1]));
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
  const cloudLink = $('cloudDriveLink');
  if (cloudLink) cloudLink.href = cloudDriveHref();
  const chatLink = $('chatLink');
  if (chatLink) chatLink.href = chatHref();
  const storageSync = $('storageSyncIframe');
  if (storageSync && isChatApp() && storageSync.dataset.src) {
    storageSync.src = storageSync.dataset.src;
  }

  if (isChatApp()) {
    document.body.classList.add('chat-only-mode');
    const brandTitle = document.querySelector('.brand-title');
    if (brandTitle) brandTitle.textContent = 'Chat';
    const brandSubtitle = document.querySelector('.brand-subtitle');
    if (brandSubtitle) brandSubtitle.textContent = '在线聊天';
    const brand = document.querySelector('.brand');
    if (brand) brand.title = 'Chat';
    document.title = 'Chat — 在线聊天系统';
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', '一个简洁、智能、安全的在线聊天系统。');
  } else if (isDriveHost()) {
    document.body.classList.add('drive-only-mode');
    const logoContainer = document.querySelector('.brand-logo-container');
    if (logoContainer) {
      logoContainer.innerHTML = `
        <svg class="brand-logo-svg" viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
        </svg>
      `;
    }
    const brandTitle = document.querySelector('.brand-title');
    if (brandTitle) brandTitle.textContent = 'Space';
    const brandSubtitle = document.querySelector('.brand-subtitle');
    if (brandSubtitle) brandSubtitle.textContent = '云盘';
    const brand = document.querySelector('.brand');
    if (brand) {
      brand.title = 'Space';
      brand.href = '/';
    }
    document.title = 'Space — 云盘';
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', 'Space 云盘用于安全保存、整理和下载个人文件。');
  }

  initSidebarMode();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !state.user || !isMessagesActivePath() || state.messageRefreshInFlight) return;
    state.messageRefreshInFlight = true;
    void pollMessageUnreadState().finally(() => {
      state.messageRefreshInFlight = false;
    });
  });

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
    const href = messageHomeHref();
    if (href.startsWith('http')) {
      window.location.href = href;
      return;
    }
    navigate(href);
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
  showAvatarPicker, handleAvatarFileChange,
  submitSolution, showContestTab, switchProblemTab, handleFileSelect,
  cancelSubmission, downloadSubmissionArtifact, renderAuditLogs,
  joinContest, submitInviteCode, leaveContest,
  showAskQuestionModal, submitQuestion,
  showAnswerQuestionModal, submitAnswer, closeQuestion,
  changeUsername, changeSignature, changePassword, showResetPasswordModal, resetUserPassword,
  renderJudgeAdmin, retryJudgeJob, rejudgeSubmission, markJudgeJobFailed,
  toggleUserRole, toggleUserDisabled, showAdminBroadcastModal, publishAdminBroadcast,
  importProblem, updateProblemPackagePickerLabel, importProblemFromEditorPage,
  setProblemStatus, showProblemVersionsModal, rerunProblemVersionSelfTest,
  showProblemEditorModal, refreshProblemEditorModal, selectProblemEditorAsset,
  addProblemEditorMarkdownAsset, addProblemEditorPdfAsset, createProblemEditorDraft,
  saveProblemEditorMeta, saveProblemEditorMarkdownAsset, uploadProblemEditorPdf,
  uploadProblemEditorPdfBatch, deleteProblemEditorSelectedAsset, syncProblemEditorMarkdownPreview,
  selectProblemEditorStatementDocuments, statementDocumentKind,
  translationDocumentLabelForFile, translationDocumentGroupKey,
  activateProblemVersion, setProblemVersionStatus,
  showCreateContestModal, createContest, setContestStatus,
  showContestSettingsModal, saveContestSettings,
  showRegistrationModal, setRegStatus, bulkAddUsers,
  showAnnouncementModal, publishAnnouncement,
  renderNotifications, markNotificationRead, markAllNotificationsRead, openNotificationLink,
  renderMessages, openMessageConversation, showNewMessageModal, searchMessageUsers, selectMessageRecipient,
  showCreateMessageGroupModal, searchMessageGroupUsers, selectMessageGroupMember, removeMessageGroupMember, createMessageGroup,
  showMessageGroupSettings, saveMessageGroupName, saveMessageGroupNickname, searchGroupSettingsUsers, selectGroupSettingsMember,
  removeGroupSettingsPendingMember, addGroupSettingsMembers, removeMessageGroupMemberFromSettings,
  transferMessageGroupOwnerFromSettings, leaveMessageGroup, deleteMessageGroup, insertGroupMention, showGroupMentionModal,
  setMessageConversationSearch, toggleMessageArchivedFilter, toggleMessageConversationPinned, toggleMessageConversationMuted,
  toggleMessageConversationArchived, showContactRemarkModal, submitContactRemark,
  toggleDirectConversationBlock, showMessageBlocksModal, unblockMessageUser,
  loadMoreMessageConversations, showMessagePreferencesModal, saveMessagePreferences,
  showMessageFavoritesModal, openMessageFavorite, showJoinGroupInviteModal, joinGroupInvite,
  showAdminMessageReportsModal, resolveMessageReport,
  sendNewMessage, sendMessageToPeer, sendFileToPeer, handleMessageComposerKeydown,
  scrollMessageThreadToBottom, toggleMessageEmojiPanel, insertMessageEmoji, addMessageGifFavorites,
  addMessageGifFavoriteFromMessage, removeMessageGifFavorite, sendFavoriteGif, dismissTransientMessage, retryTransientMessage,
  toggleMessageReaction, toggleMessageFavorite, showMessageSearchModal, handleMessageSearchKeydown,
  submitMessageSearch, openMessageSearchResult,
  handleNewMessageKeydown, updateNewMessageFileLabel, openMessageImage, openMessageImageFromAttachment,
  showPreviousMessageImage, showNextMessageImage, downloadMessageFile, downloadLocalMessageFile,
  refreshMessageThreadNow, quoteMessage, replyToMessage, clearMessageReplyTarget,
  showGroupAnnouncementsModal, createGroupAnnouncement, deleteGroupAnnouncement,
  createGroupInviteFromSettings, updateMessageGroupMemberRoleFromSettings,
  openChatUserProfile, handleChatAvatarProfileKeydown, openMessageActionMenu, closeMessageActionMenu, copyMessageText, recallMessageAction,
  showMessageEditModal, submitMessageEdit, deleteMessageAction, showMessageReportModal, submitMessageReport,
  renderCloudDrive, openDriveFolder, filterDriveItems, showDriveFolderModal, createDriveFolder,
  showDriveRenameModal, saveDriveRename, deleteDriveItem, downloadDriveFile, uploadDriveFiles,
  handleDriveDragOver, handleDriveDragLeave, handleDriveDrop, toggleDriveItemSelection, toggleAllDriveItems,
  clearDriveSelection, downloadSelectedDriveItems, deleteSelectedDriveItems, previewDriveFile,
  showDriveShareModal, createDriveShare, revokeDriveShare, copyDriveShareLink,
  showDriveMoveModal, searchDriveMoveTargets, moveDriveItemsTo,
  renderPublicDriveShare, downloadPublicDriveShare, previewPublicDriveShare,
  closeModal, copyTerminalText, toggleTheme,
  resetEditorCode, runSandboxTest, submitEditorCode, toggleFullscreenEditor, switchEditorMode, moveNbCell, toggleNbCellType, removeNbCell, addNbCell, updateNbCellContent
});
