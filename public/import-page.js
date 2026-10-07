'use strict';
(() => {
  const C = globalThis.LoLCore;
  const H = globalThis.LoLHistory;
  const I = globalThis.LoLImport;
  const D = globalThis.SiteData;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const show = value => value === null || value === undefined ? '—' : String(value);
  const roleLabel = role => C.ROLES.find(item => item.id === role)?.label || '미확인';
  let session = null;
  let state = null;
  let revision = 0;
  let busy = false;
  let parsed = null;
  let prepared = null;
  let promptText = '';

  function status(message, error = false) {
    $('importStatus').textContent = error ? '' : message;
    $('importError').textContent = error ? message : '';
    $('importError').hidden = !error;
  }
  function access() {
    const identity = session;
    $('accessBadge').textContent = identity ? ({ owner: '소유자', admin: '관리자', viewer: '보기 전용' })[identity.role] : '확인 필요';
    if (identity) $('accessBadge').dataset.role = identity.role; else delete $('accessBadge').dataset.role;
    $('accessIdentity').textContent = identity?.user ? identity.user.email || identity.user.name || '로그인한 계정' : '로그인하지 않은 상태';
    $('accessMessage').textContent = identity?.canEdit ? 'JSON을 검토한 뒤 공용 경기 기록에 반영할 수 있습니다.' : '관리자로 지정된 계정으로 로그인해야 경기 결과를 등록할 수 있습니다.';
    $('accessLogin').hidden = !!identity?.user;
    $('adminNav').hidden = !identity?.canManageAdmins;
    $('importContent').hidden = !identity?.canEdit;
    $('importDenied').hidden = !identity || identity.canEdit;
  }
  function setBusy(value) {
    busy = value;
    ['targetSeries', 'targetGame', 'copyPromptBtn', 'jsonText', 'jsonFile', 'previewBtn', 'previewWinner', 'importReason', 'reviewConfirmed', 'rememberNicknames'].forEach(id => { $(id).disabled = value || !session?.canEdit || !state; });
    $('refreshBtn').disabled = value;
    $('confirmSave').disabled = value || !session?.canEdit;
    document.querySelectorAll('select[data-player-id],select[data-role],select[data-team-select]').forEach(input => { input.disabled = value || !session?.canEdit; });
    $('registerBtn').disabled = value || !session?.canEdit || !prepared || !$('reviewConfirmed').checked;
    $('copyPromptBtn').disabled = value || !session?.canEdit || !promptText;
  }
  function invalidate() {
    parsed = null;
    prepared = null;
    $('previewPanel').hidden = true;
    $('reviewConfirmed').checked = false;
    $('rememberNicknames').checked = false;
    $('registerBtn').disabled = true;
  }
  function renderTarget() {
    invalidate();
    promptText = '';
    $('promptText').value = '';
    try {
      if (!state || !$('targetGame').value) throw new Error('매치 센터에서 공용 경기와 팀 편성을 준비해 주세요.');
      const target = I.contextFor(state, $('targetSeries').value, Number($('targetGame').value));
      promptText = I.promptFor(state, $('targetSeries').value, target.gameNumber);
      $('promptText').value = promptText;
      $('targetSummary').textContent = `${target.matchDate} · ${target.gameNumber}세트 · ${target.existing ? '기존 승패에 상세 결과를 연결·수정합니다.' : '승패와 상세 결과를 함께 추가합니다.'}`;
    } catch (error) { $('targetSummary').textContent = error.message; }
    setBusy(busy);
  }
  function renderTargets() {
    const previous = Number($('targetGame').value);
    const selected = state ? I.targetState(state, $('targetSeries').value || state.seriesId) : null;
    const historical = selected && selected.seriesId !== state.seriesId;
    const options = selected ? selected.results.map((winner, index) => ({ value: index + 1, text: `${index + 1}세트 · ${C.TEAM_NAMES[winner]} 승 · 상세 결과 등록/수정` })) : [];
    if (selected?.draw && !historical && !C.seriesStatus(selected.bestOf, selected.results).complete) options.push({ value: selected.results.length + 1, text: `${selected.results.length + 1}세트 · 새 경기 결과 등록` });
    $('targetGame').innerHTML = options.length ? options.map(option => `<option value="${option.value}">${esc(option.text)}</option>`).join('') : '<option value="">등록 가능한 세트가 없습니다.</option>';
    if (options.length) $('targetGame').value = String(options.some(option => option.value === previous) ? previous : options[options.length - 1].value);
    renderTarget();
  }
  function renderSeries() {
    const previous = $('targetSeries').value;
    const options = state ? [{ id: state.seriesId, text: `현재 · ${state.matchDate} · ${state.results.length}세트 진행` }].concat(state.history.filter(item => item.id !== state.seriesId).map((item, index) => ({ id: item.id, text: `${item.date} · ${item.status === 'completed' ? '종료' : '중도 종료'} · ${item.results.length}세트 · 기록 ${index + 1}` }))) : [];
    $('targetSeries').innerHTML = options.map(option => `<option value="${esc(option.id)}">${esc(option.text)}</option>`).join('');
    if (options.length) $('targetSeries').value = options.some(option => option.id === previous) ? previous : state.seriesId;
  }
  function acceptSnapshot(result) {
    session = result.session;
    state = result.state ? H.upgrade(result.state) : null;
    revision = result.revision;
    access();
    renderSeries();
    renderTargets();
  }
  async function load() {
    if (busy) return;
    setBusy(true);
    try {
      acceptSnapshot(await D.load());
      status(session.canEdit ? state ? '최신 공용 경기 정보를 불러왔습니다. 입력한 JSON 텍스트는 유지됩니다.' : '매치 센터에서 먼저 공용 경기를 준비해 주세요.' : '현재 계정은 보기 전용입니다.');
    } catch (error) {
      session = null;
      state = null;
      invalidate();
      access();
      status(error.message, true);
    } finally { setBusy(false); }
  }
  function corrections() {
    const winner = $('previewWinner').value;
    return {
      winner: winner === '' ? null : Number(winner),
      rememberNicknames: $('rememberNicknames').checked,
      playerIds: Array.from(document.querySelectorAll('[data-player-id]'), input => input.value || null),
      roles: Array.from(document.querySelectorAll('select[data-role]'), input => input.value || null),
      teams: Array.from(document.querySelectorAll('[data-team-select]'), input => input.value === '' ? null : Number(input.value))
    };
  }
  function checkPreview() {
    prepared = null;
    if (!parsed || !state) return;
    try {
      prepared = I.prepareFor(state, $('targetSeries').value, parsed, corrections());
      $('mappingStatus').textContent = prepared.winnerChanged ? '10명 연결 완료. 기존 승리 팀도 변경됩니다. 최종 확인 화면에서 한 번 더 확인해 주세요.' : '10명 모두 이 세트의 라인업과 일치합니다. 원본 사진과 수치를 확인해 주세요.';
      $('mappingStatus').classList.remove('is-error');
    } catch (error) {
      $('mappingStatus').textContent = error.message;
      $('mappingStatus').classList.add('is-error');
    }
    document.querySelectorAll('select[data-player-id],select[data-role],select[data-team-select]').forEach(input => { input.classList.toggle('is-unresolved', !input.value); });
    setBusy(busy);
  }
  function preview() {
    if (busy || !session?.canEdit || !state) return;
    invalidate();
    try {
      const input = I.parse($('jsonText').value);
      if (input.gameNumber !== Number($('targetGame').value)) throw new Error('JSON의 gameNumber와 선택한 등록 대상 세트가 다릅니다. 대상 세트를 먼저 맞춰 주세요.');
      const target = I.contextFor(state, $('targetSeries').value, input.gameNumber);
      if (input.seriesId !== target.seriesId || input.matchDate !== target.matchDate) throw new Error('현재 시리즈 또는 경기일과 다른 JSON입니다. 현재 세트용 프롬프트를 다시 복사해 주세요.');
      parsed = input;
      $('previewAction').textContent = target.existing ? '기존 세트 상세 결과 수정' : '새 세트 추가';
      $('previewSummary').textContent = `${target.matchDate} · ${target.gameNumber}세트 · 경기 시간 ${input.durationSeconds === null ? '미확인' : `${Math.floor(input.durationSeconds / 60)}분 ${input.durationSeconds % 60}초`} · 경기 ID ${input.externalId || '미제공'}${target.existing ? ` · 기존 승리 팀: ${C.TEAM_NAMES[target.winner]}` : ''}`;
      $('previewWinner').value = input.winner === null ? '' : String(input.winner);
      $('importReason').value = target.existing ? '결과 사진 JSON으로 세트 상세 기록 수정' : '결과 사진 JSON 등록';
      $('previewPlayers').innerHTML = input.players.map((player, index) => {
        const teamPlayers = target.players;
        const resolved = I.resolveParticipant(player, teamPlayers);
        const options = '<option value="">참가자 선택</option>' + teamPlayers.map(candidate => `<option value="${esc(candidate.playerId)}"${candidate.playerId === resolved.playerId ? ' selected' : ''}>${esc(candidate.name)}${candidate.currentNickname ? ` (${esc(candidate.currentNickname)})` : ''} · ${esc(C.TEAM_NAMES[candidate.team])} · ${esc(roleLabel(candidate.role))}</option>`).join('');
        const roleOptions = '<option value="">라인 확인</option>' + C.ROLES.map(role => `<option value="${role.id}"${role.id === player.role ? ' selected' : ''}>${role.label}</option>`).join('');
        return `<tr data-team="${player.team}"><td>${esc(player.nickname || '미확인')}${resolved.message ? `<br><small>${esc(resolved.message)}</small>` : ''}</td><td><select data-player-id="${index}" aria-label="${index + 1}번째 선수 참가자 연결">${options}</select></td><td><select class="team-select" data-team-select="${index}" aria-label="${index + 1}번째 선수 팀"><option value="">팀 확인</option>${C.TEAM_NAMES.map((name, team) => `<option value="${team}"${team === player.team ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></td><td><select data-role="${index}" aria-label="${index + 1}번째 선수 라인">${roleOptions}</select></td><td>${esc(show(player.champion))}</td><td>${['kills', 'deaths', 'assists'].map(key => esc(show(player[key]))).join(' / ')}</td>${['damage', 'cs', 'gold', 'vision'].map(key => `<td>${esc(show(player[key]))}</td>`).join('')}</tr>`;
      }).join('');
      $('previewNotes').textContent = input.notes ? `분석 메모: ${input.notes}` : '분석 메모 없음';
      $('previewPanel').hidden = false;
      checkPreview();
      status('JSON을 불러왔습니다. 참가자 연결과 원본 사진의 수치를 확인해 주세요.');
      $('previewPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { status(error.message, true); }
  }
  async function copyPrompt() {
    if (busy || !session?.canEdit || !promptText) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(promptText);
      status('분석 프롬프트를 복사했습니다. 외부 AI에 결과 사진과 함께 전달하세요.');
    } catch (_) {
      $('promptDetails').open = true;
      $('promptText').focus();
      $('promptText').select();
      $('promptText').setSelectionRange(0, $('promptText').value.length);
      status('프롬프트 전체를 선택했습니다. 복사 메뉴 또는 Ctrl/Cmd+C로 복사해 주세요.');
    }
  }
  function confirmRegistration() {
    if (busy || !session?.canEdit || !parsed || !$('reviewConfirmed').checked) return;
    checkPreview();
    if (!prepared) return;
    const reason = $('importReason');
    reason.value = reason.value.trim();
    if (!reason.reportValidity()) return;
    const target = prepared.context;
    const winner = C.TEAM_NAMES[prepared.detail.winner];
    const previous = C.TEAM_NAMES[target.winner];
    $('confirmTitle').textContent = target.existing ? '기존 세트 기록 수정' : '새 경기 기록 등록';
    $('confirmDescription').textContent = `${target.matchDate} ${target.gameNumber}세트를 ${winner} 승리로 ${target.existing ? '수정' : '추가'}합니다. ${prepared.winnerChanged ? `기존 ${previous} 승리에서 승패가 바뀌며, 시리즈 점수와 개인 전적도 다시 계산됩니다. ` : ''}${target.existing ? '이 세트의 기존 상세 수치는 검토한 JSON 값으로 교체됩니다. ' : ''}미확인 값은 비워서 저장합니다. ${prepared.rememberNicknames ? '확인한 사진 속 닉네임도 각 선수의 추가 닉네임으로 함께 저장해 다음 등록에서 연결합니다. 현재 닉네임은 바꾸지 않습니다. ' : ''}공용 기록에 반영할까요?`;
    $('confirmDialog').showModal();
  }
  async function save() {
    if (busy || !session?.canEdit || !prepared || !$('reviewConfirmed').checked) return;
    const pending = prepared;
    const expectedRevision = revision;
    const reason = $('importReason').value.trim();
    if (!reason || reason.length > 200) return;
    $('confirmDialog').close();
    setBusy(true);
    try {
      const latest = await D.load();
      if (!latest.session.canEdit) {
        acceptSnapshot(latest);
        throw new Error('관리자 권한이 변경되어 저장하지 않았습니다.');
      }
      if (latest.revision !== expectedRevision || !latest.state) {
        acceptSnapshot(latest);
        throw new Error('다른 관리자가 경기 정보를 변경했습니다. 최신 정보를 불러왔으니 입력한 JSON을 다시 검토해 주세요.');
      }
      const next = I.applyFor(H.upgrade(latest.state), pending);
      const saved = await D.save(next, expectedRevision, reason);
      session = latest.session;
      state = H.upgrade(saved.state);
      revision = saved.revision;
      const gameNumber = pending.context.gameNumber;
      invalidate();
      $('jsonText').value = '';
      renderSeries();
      renderTargets();
      status(`${gameNumber}세트 ${pending.updating ? '상세 기록을 수정' : '결과를 등록'}했습니다. 경기 기록에서 전적을 확인할 수 있습니다.`);
    } catch (error) {
      if ([401, 403, 409].includes(error.status)) {
        try { acceptSnapshot(await D.load()); } catch (_) { session = null; state = null; invalidate(); access(); }
      }
      status(`${error.message}${[401, 403, 409].includes(error.status) ? ' 입력한 JSON은 그대로 유지됩니다. 다시 검토해 주세요.' : ''}`, true);
    } finally { setBusy(false); }
  }

  $('refreshBtn').addEventListener('click', load);
  $('targetSeries').addEventListener('change', () => { $('targetGame').value = ''; renderTargets(); });
  $('targetGame').addEventListener('change', renderTarget);
  $('copyPromptBtn').addEventListener('click', copyPrompt);
  $('selectPromptBtn').addEventListener('click', () => { $('promptText').focus(); $('promptText').select(); $('promptText').setSelectionRange(0, $('promptText').value.length); });
  $('jsonText').addEventListener('input', invalidate);
  $('previewBtn').addEventListener('click', preview);
  $('jsonFile').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy || !session?.canEdit) return;
    invalidate();
    if (file.size > I.MAX_BYTES) { status('JSON 파일은 256KB 이하여야 합니다.', true); return; }
    setBusy(true);
    try { $('jsonText').value = await file.text(); status(`${file.name}을 불러왔습니다. 검토 화면을 열어 확인해 주세요.`); }
    catch (_) { status('파일을 읽지 못했습니다. JSON 텍스트를 직접 붙여넣어 주세요.', true); }
    finally { setBusy(false); }
  });
  $('previewPlayers').addEventListener('change', event => {
    if (!event.target.matches('select[data-player-id],select[data-role],select[data-team-select]')) return;
    $('reviewConfirmed').checked = false;
    checkPreview();
  });
  $('previewWinner').addEventListener('change', () => { $('reviewConfirmed').checked = false; checkPreview(); });
  $('rememberNicknames').addEventListener('change', () => { $('reviewConfirmed').checked = false; checkPreview(); });
  $('reviewConfirmed').addEventListener('change', () => setBusy(busy));
  $('registerBtn').addEventListener('click', confirmRegistration);
  $('confirmSave').addEventListener('click', save);
  ['confirmCancel', 'confirmClose'].forEach(id => $(id).addEventListener('click', () => $('confirmDialog').close()));
  window.addEventListener('pageshow', event => { if (event.persisted && !busy) load(); });
  load();
})();
