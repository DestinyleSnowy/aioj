(function initChatApi(global) {
  function authHeaders() {
    return typeof global.authHeaders === 'function' ? global.authHeaders() : {};
  }

  function api(path, options = {}) {
    if (typeof global.api !== 'function') {
      return Promise.reject(new Error('API client is not ready'));
    }
    return global.api(path, options);
  }

  function jsonHeaders() {
    return { ...authHeaders(), 'Content-Type': 'application/json' };
  }

  global.ChatApi = {
    listConversations({ limit = 100, offset = 0, query = '', includeArchived = false } = {}) {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (query) params.set('q', query);
      if (includeArchived) params.set('include_archived', '1');
      return api(`/api/messages/conversations?${params.toString()}`, { headers: authHeaders() });
    },

    messageEvents({ conversationType = '', conversationId = 0 } = {}) {
      const params = new URLSearchParams();
      if (conversationType && conversationId) {
        params.set('conversation_type', conversationType);
        params.set('conversation_id', String(conversationId));
      }
      return `/api/messages/events${params.toString() ? `?${params.toString()}` : ''}`;
    },

    heartbeatPresence() {
      return api('/api/messages/presence/heartbeat', { method: 'POST', headers: authHeaders() });
    },

    getPreferences() {
      return api('/api/messages/preferences', { headers: authHeaders() });
    },

    updatePreferences(payload) {
      return api('/api/messages/preferences', {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify(payload || {}),
      });
    },

    updateContactRemark(contactUserId, payload) {
      return api(`/api/messages/contact-remarks/${Number(contactUserId)}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify(payload || {}),
      });
    },

    sendTyping(payload) {
      return api('/api/messages/typing', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(payload || {}),
      });
    },

    searchMessages({ query, conversationType, conversationId, limit = 30 }) {
      const params = new URLSearchParams({
        q: query,
        conversation_type: conversationType,
        conversation_id: String(conversationId),
        limit: String(limit),
      });
      return api(`/api/messages/search?${params.toString()}`, { headers: authHeaders() });
    },

    setReaction(payload) {
      return api('/api/messages/reactions', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(payload || {}),
      });
    },

    listFavorites() {
      return api('/api/messages/favorites', { headers: authHeaders() });
    },

    addFavorite(payload) {
      return api('/api/messages/favorites', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(payload || {}),
      });
    },

    deleteFavorite(conversationType, messageId) {
      return api(`/api/messages/favorites/${conversationType}/${Number(messageId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
    },

    listAnnouncements(groupId) {
      return api(`/api/messages/groups/${Number(groupId)}/announcements`, { headers: authHeaders() });
    },

    createAnnouncement(groupId, payload) {
      return api(`/api/messages/groups/${Number(groupId)}/announcements`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(payload || {}),
      });
    },

    deleteAnnouncement(groupId, announcementId) {
      return api(`/api/messages/groups/${Number(groupId)}/announcements/${Number(announcementId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
    },

    createGroupInvite(groupId, payload) {
      return api(`/api/messages/groups/${Number(groupId)}/invites`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(payload || {}),
      });
    },

    joinGroupInvite(inviteCode) {
      return api('/api/messages/group-invites/join', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ invite_code: inviteCode }),
      });
    },

    updateGroupMemberRole(groupId, memberId, role) {
      return api(`/api/messages/groups/${Number(groupId)}/members/${Number(memberId)}/role`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ role }),
      });
    },

    removeGroupMember(groupId, memberId, reason = '') {
      return api(`/api/messages/groups/${Number(groupId)}/members/${Number(memberId)}/remove`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ reason }),
      });
    },

    listReports(status = 'OPEN') {
      const params = new URLSearchParams({ status });
      return api(`/api/admin/messages/reports?${params.toString()}`, { headers: authHeaders() });
    },

    updateReport(reportId, payload) {
      return api(`/api/admin/messages/reports/${Number(reportId)}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify(payload || {}),
      });
    },
  };
})(window);
