'use strict';
(() => {
  const D = globalThis.SiteData;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const roles = { owner: '소유자', admin: '관리자', viewer: '보기 전용' };
  let session = null;
  let busy = false;
  let pendingEmail = null;

  function showAccess(identity) {
    $('accessBadge').textContent = roles[identity.role];
    $('accessBadge').dataset.role = identity.role;
    $('accessIdentity').textContent = identity.user ? identity.user.email || identity.user.name || '로그인한 계정' : '로그인하지 않은 상태';
    $('accessMessage').textContent = identity.canManageAdmins ? '소유자 계정으로 관리자 권한을 지정할 수 있습니다.' : identity.canEdit ? '경기 정보는 편집할 수 있으며, 관리자 지정은 소유자만 가능합니다.' : '현재 계정은 경기 정보와 기록을 조회할 수 있습니다.';
    $('accessLogin').hidden = !!identity.user;
    $('adminNav').hidden = !identity.canManageAdmins;
  }

  function setBusy(value) {
    busy = value;
    $('adminEmail').disabled = value || !session?.canManageAdmins;
    $('grantButton').disabled = value || !session?.canManageAdmins;
    document.querySelectorAll('[data-revoke]').forEach(button => { button.disabled = value || !session?.canManageAdmins; });
    $('revokeConfirm').disabled = value;
  }

  function feedback(message, error = false) {
    $('adminFeedback').textContent = message;
    $('adminFeedback').classList.toggle('is-error', error);
  }

  function renderAdmins(data) {
    if (!data || !data.owner || !Array.isArray(data.admins)) throw new Error('관리자 목록의 형식이 올바르지 않습니다. 다시 불러와 주세요.');
    $('ownerEmail').textContent = data.owner.email || '사이트 소유자';
    $('adminCount').textContent = `소유자 1명 · 관리자 ${data.admins.length}명`;
    $('adminEmpty').hidden = data.admins.length > 0;
    $('adminList').innerHTML = data.admins.map(admin => `<li><div><span class="admin-person-role">관리자</span><p class="admin-person-email">${esc(admin.email)}</p><p class="admin-person-detail">${admin.userId ? '계정 연결 완료 · 경기 편집 가능' : '첫 로그인 시 계정에 연결됩니다.'}</p></div><button class="btn" type="button" data-revoke="${esc(admin.email)}" aria-label="${esc(admin.email)} 관리자 권한 해제">권한 해제</button></li>`).join('');
  }

  async function load() {
    if (busy) return;
    setBusy(true);
    $('adminLoading').hidden = false;
    $('adminContent').hidden = true;
    $('adminDenied').hidden = true;
    $('adminError').hidden = true;
    try {
      const result = await D.load();
      session = result.session;
      showAccess(session);
      if (!session.canManageAdmins) {
        $('adminDenied').hidden = false;
        $('deniedMessage').textContent = session.user ? '경기 관리자는 매치 센터에서 팀과 경기 결과를 편집할 수 있습니다. 관리자 지정은 사이트 소유자에게 요청해 주세요.' : '소유자의 ChatGPT 계정으로 로그인해 주세요. 다른 계정은 관리자 목록을 볼 수 없습니다.';
        return;
      }
      renderAdmins(await D.listAdmins());
      $('adminContent').hidden = false;
    } catch (error) {
      session = null;
      $('accessBadge').textContent = '확인 필요';
      delete $('accessBadge').dataset.role;
      $('accessIdentity').textContent = '관리 권한을 확인하지 못했습니다.';
      $('accessMessage').textContent = '연결 상태를 확인한 후 다시 불러와 주세요.';
      $('accessLogin').hidden = true;
      $('adminNav').hidden = true;
      $('adminErrorMessage').textContent = error.message;
      $('adminError').hidden = false;
    } finally {
      $('adminLoading').hidden = true;
      setBusy(false);
    }
  }

  async function mutate(action, successMessage) {
    if (busy || !session?.canManageAdmins) return false;
    setBusy(true);
    feedback('변경 사항을 저장하는 중입니다.');
    try {
      await action();
      renderAdmins(await D.listAdmins());
      feedback(successMessage);
      return true;
    } catch (error) {
      feedback(error.message, true);
      if (error.status === 401 || error.status === 403) {
        session = null;
        $('adminContent').hidden = true;
        $('adminErrorMessage').textContent = error.message;
        $('adminError').hidden = false;
        $('accessBadge').textContent = '확인 필요';
        delete $('accessBadge').dataset.role;
        $('accessMessage').textContent = '접근 권한이 변경되었습니다. 다시 불러와 주세요.';
        $('adminNav').hidden = true;
      }
      return false;
    } finally { setBusy(false); }
  }

  $('grantForm').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('adminEmail');
    input.value = input.value.trim();
    if (!input.reportValidity()) return;
    const email = input.value;
    if (await mutate(() => D.grantAdmin(email), `${email} 계정을 관리자로 등록했습니다.`)) input.value = '';
  });
  $('adminList').addEventListener('click', event => {
    const button = event.target.closest('[data-revoke]');
    if (!button || busy || !session?.canManageAdmins) return;
    pendingEmail = button.dataset.revoke;
    $('revokeDescription').textContent = `${pendingEmail} 계정의 관리자 권한을 해제할까요? 이후 이 계정은 경기와 기록을 조회만 할 수 있습니다.`;
    $('revokeDialog').showModal();
  });
  const closeRevoke = () => { $('revokeDialog').close(); pendingEmail = null; };
  $('revokeCancel').addEventListener('click', closeRevoke);
  $('revokeClose').addEventListener('click', closeRevoke);
  $('revokeDialog').addEventListener('close', () => { pendingEmail = null; });
  $('revokeConfirm').addEventListener('click', async () => {
    const email = pendingEmail;
    if (!email || busy) return;
    closeRevoke();
    await mutate(() => D.revokeAdmin(email), `${email} 계정을 보기 전용으로 변경했습니다.`);
  });
  $('adminRetry').addEventListener('click', load);
  window.addEventListener('pageshow', event => { if (event.persisted) load(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('revokeDialog').open) load(); });
  load();
})();
