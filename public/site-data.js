(function (root) {
  'use strict';

  const VIEWER = Object.freeze({ user: null, role: 'viewer', canEdit: false, canManageAdmins: false });
  let session = VIEWER;

  function failure(message, status, code) {
    const error = new Error(message);
    error.status = status || 0;
    error.code = code || 'REQUEST_FAILED';
    return error;
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, {
        method: options.method || 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        signal: controller.signal,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
      });
      let data;
      try { data = await response.json(); }
      catch (_error) {
        throw failure('서버 응답을 확인할 수 없습니다. 로그인 상태를 확인한 뒤 다시 시도해 주세요.', response.status, 'INVALID_RESPONSE');
      }
      if (!response.ok) {
        const detail = data?.error;
        const message = data?.message || (typeof detail === 'string' ? detail : detail?.message);
        throw failure(message || '요청을 처리하지 못했습니다. 다시 시도해 주세요.', response.status, detail?.code || data?.code || (typeof detail === 'string' ? detail : undefined));
      }
      return data;
    } catch (error) {
      if (error.status !== undefined) throw error;
      throw failure(error.name === 'AbortError' ? '서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.' : '서버에 연결하지 못했습니다. 네트워크 연결을 확인해 주세요.', 0, error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
    } finally { clearTimeout(timeout); }
  }

  function checkedSession(value) {
    if (!value || !['owner', 'admin', 'viewer'].includes(value.role) || typeof value.canEdit !== 'boolean' || typeof value.canManageAdmins !== 'boolean' || (value.user !== null && (!value.user || typeof value.user.id !== 'string'))) {
      throw failure('접근 권한을 확인할 수 없습니다. 새로고침해 주세요.', 200, 'INVALID_SESSION');
    }
    if ((!value.user && (value.role !== 'viewer' || value.canEdit || value.canManageAdmins)) || (value.canEdit && !['owner', 'admin'].includes(value.role)) || (value.canManageAdmins && value.role !== 'owner')) {
      throw failure('접근 권한을 확인할 수 없습니다. 새로고침해 주세요.', 200, 'INVALID_SESSION');
    }
    return Object.freeze({
      user: value.user ? Object.freeze({ id: value.user.id, email: value.user.email || '', name: value.user.name || '' }) : null,
      role: value.role,
      canEdit: value.canEdit,
      canManageAdmins: value.canManageAdmins
    });
  }

  function checkedState(value) {
    if (!value || !Object.prototype.hasOwnProperty.call(value, 'state') || !Number.isSafeInteger(value.revision) || value.revision < 0 || (value.state !== null && (typeof value.state !== 'object' || Array.isArray(value.state)))) {
      throw failure('경기 데이터 응답이 올바르지 않습니다. 새로고침해 주세요.', 200, 'INVALID_STATE');
    }
    return { state: value.state, revision: value.revision };
  }

  async function getState() { return checkedState(await request('/api/state')); }

  async function load() {
    try {
      const [identity, snapshot] = await Promise.all([request('/api/session'), getState()]);
      session = checkedSession(identity);
      return { session, ...snapshot };
    } catch (error) {
      session = VIEWER;
      throw error;
    }
  }

  root.SiteData = Object.freeze({
    load,
    getSession: () => session,
    getState,
    save: async (state, expectedRevision, reason) => checkedState(await request('/api/state', { method: 'PUT', body: { state, expectedRevision, ...(reason ? {reason} : {}) } })),
    listAudit: recordId => request('/api/audit' + (recordId ? '?recordId=' + encodeURIComponent(recordId) : '')),
    listAdmins: () => request('/api/admins'),
    grantAdmin: email => request('/api/admins', { method: 'POST', body: { email: String(email).trim().toLowerCase() } }),
    revokeAdmin: email => request('/api/admins', { method: 'DELETE', body: { email: String(email).trim().toLowerCase() } })
  });
})(globalThis);
