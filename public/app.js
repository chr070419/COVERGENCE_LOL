'use strict';
(() => {
  const C = globalThis.LoLCore;
  const H = globalThis.LoLHistory;
  const D = globalThis.SiteData;
  const $ = id => document.getElementById(id);
  const KEY = 'jininfra-lol-inhouse-v1';
  const roleName = id => id === 'fill' ? '상관없음' : C.ROLES.find(r => r.id === id)?.label || id;
  const tierName = id => C.TIERS.find(t => t.id === id)?.label || id;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state = H.upgrade(C.createDefaultState()), storageOK = false, toastTimer, editingId, pendingAction, busy = true;
  let session = {user:null,role:'viewer',canEdit:false,canManageAdmins:false}, revision = 0, ready = false, polling = false;
  let confirmed = null, legacyRaw = null, legacyMoved = false;
  let draftPairs = [], candidates = [], candidateOptions = null;
  let nicknameEditingId = null, nicknameRevision = null, nicknameCollisionAccepted = null;
  const editable = () => ready && session.canEdit && !busy;
  const clone = value => JSON.parse(JSON.stringify(value));
  const person = id => state.roster.find(p => p.id === id);
  const names = C.TEAM_NAMES;
  const rule = n => n === 1 ? '단판' : `${n}판 ${Math.ceil(n / 2)}선승`;
  const icons = {
    top:'M4 4h16v16H4z M4 4l5 5h6V4 M4 20l5-5V9 M15 15h5',
    jungle:'M4 3l7 7v10L5 15z M20 3l-7 7v10l6-5z M12 3v4',
    mid:'M4 4h16v16H4z M5 19L19 5 M4 12V4h8 M12 20h8v-8',
    adc:'M4 4h16v16H4z M20 20l-5-5H9v5 M20 4l-5 5v6 M9 9H4',
    support:'M4 7l8 4 8-4-3 8h-3l-2 6-2-6H7z M9 3h6l-3 5z'
  };
  const icon = role => `<span class="role-icon" title="${esc(roleName(role))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="${icons[role]}"/></svg><small>${esc(roleName(role))}</small></span>`;
  function flash(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; $('liveStatus').textContent = message; toastTimer = setTimeout(() => $('toast').hidden = true, 4800); }
  function storageStatus(message = '') {
    $('storageStatus').textContent = storageOK ? '공용 경기·누적 기록 저장 완료' : ready ? '공용 저장 확인 필요' : '공용 데이터 연결 중';
    $('storageStatus').classList.toggle('warning', !storageOK);
    $('storageWarning').hidden = !message;
    $('storageWarning').textContent = message;
  }
  function applyAccess() {
    document.body.classList.toggle('is-loading', !ready);
    document.body.classList.toggle('is-viewer', !session.canEdit);
    $('accessBadge').dataset.role = session.role;
    $('accessBadge').textContent = !ready ? '연결 확인 중' : session.role === 'owner' ? '소유자 · 관리자' : session.canEdit ? '관리자' : '뷰어';
    $('accessIdentity').textContent = session.user ? (session.user.name || session.user.email || '로그인된 계정') : '경기 현황과 기록을 볼 수 있습니다.';
    $('accessMessage').textContent = session.canEdit ? (busy ? '변경 사항을 저장하고 있습니다.' : '팀 편성·점수·참가자 정보를 편집할 수 있습니다.') : '읽기 전용 · 경기 현황은 15초마다 갱신됩니다.';
    $('accessLogin').hidden = !!session.user;
    $('adminNav').hidden = !session.canManageAdmins;
    $('viewerPanel').hidden = !!session.canEdit;
    $('viewerMatchDate').textContent = state.matchDate;
    $('rosterHelp').textContent = session.canEdit ? '이름은 개인 성적 · 닉네임 관리는 게임 계정 연결입니다.' : '이름을 눌러 개인 성적을 확인하세요.';
    document.querySelectorAll('[data-edit-only]').forEach(el => el.hidden = !session.canEdit);
    document.querySelectorAll('[data-edit]').forEach(el => el.disabled = !editable());
    document.querySelectorAll('[data-nickname]').forEach(el => el.disabled = !editable());
    ['nicknameCurrent','nicknameAliases','nicknameSave'].forEach(id => $(id).disabled = !editable());
    document.querySelectorAll('[data-close]').forEach(el => { if (el.dataset.close === 'nicknameDialog') el.disabled = busy; });
    ['shuffleBtn','bestOf','matchDate','swapBtn','loadBtn','migrateBtn','confirmAction','makeCandidatesBtn','addPairBtn'].forEach(id => $(id).disabled = !editable());
    document.querySelectorAll('[name="mode"]').forEach(el => el.disabled = !editable());
    document.querySelectorAll('[data-win]').forEach(el => el.disabled = !editable() || !state.draw || C.seriesStatus(state.bestOf,state.results).complete);
    ['undoBtn','resetSeriesBtn','endDayBtn'].forEach(id => $(id).disabled = !editable() || !state.results.length);
    $('legacyNotice').hidden = !session.canEdit || !legacyRaw || legacyMoved;
    $('refreshBtn').disabled = busy || polling;
    $('copyBtn').disabled = !ready || !state.draw;
    $('shareCardBtn').disabled = !ready || !state.draw;
    $('swapBtn').disabled = !editable() || !state.draw || C.seriesStatus(state.bestOf,state.results).complete;
    $('saveBtn').disabled = !ready || !confirmed;
  }
  async function refresh({initial = false, quiet = false} = {}) {
    if (polling || (!initial && busy)) return;
    polling = true; busy = true; applyAccess();
    try {
      const data = await D.load();
      session = data.session; revision = data.revision;
      state = data.state ? H.upgrade(data.state) : H.upgrade(C.createDefaultState());
      confirmed = data.state ? clone(state) : null;
      ready = true; storageOK = true;
      if (session.canEdit) { try { legacyRaw = localStorage.getItem(KEY); } catch {} }
      if (!session.canEdit) { pendingAction = null; ['confirmDialog','editDialog','swapDialog','shuffleDialog','nicknameDialog'].forEach(id => $(id).close()); }
      busy = false; storageStatus();
      if (!data.state && session.canEdit) {
        state.draw = generate(); state.drawNumber = 1;
        await commit('공용 경기 화면을 준비했습니다.');
      }
      if (!quiet && !initial) flash('최신 경기 현황을 불러왔습니다.');
    } catch (e) {
      busy = false; storageOK = false; session = D.getSession();
      if (!session.canEdit) $('nicknameDialog').close();
      storageStatus(e.message || '공용 데이터를 불러오지 못했습니다. 새로고침을 눌러 다시 연결해 주세요.');
      if (!quiet) flash('공용 데이터 연결을 확인해 주세요.');
    } finally { polling = false; render(); }
  }
  async function commit(message, {syncCurrent = true} = {}) {
    if (!editable()) return false;
    busy = true; render();
    try {
      const result = await D.save(syncCurrent ? H.syncCurrent(state) : state, revision, message);
      state = H.upgrade(result.state); revision = result.revision; confirmed = clone(state);
      storageOK = true; storageStatus();
      if (message) flash(message);
      return true;
    } catch (e) {
      // Never keep an optimistic result on screen as if the server saved it.
      state = confirmed ? H.upgrade(clone(confirmed)) : H.upgrade(C.createDefaultState());
      storageOK = false;
      let message = e.message || '저장하지 못했습니다. 다시 연결한 뒤 시도해 주세요.';
      if ([401,403,409].includes(e.status)) {
        let reloaded = false;
        try {
          const current = await D.load(); session = current.session; revision = current.revision;
          state = current.state ? H.upgrade(current.state) : H.upgrade(C.createDefaultState());
          confirmed = current.state ? clone(state) : null; reloaded = true;
        } catch { session = D.getSession(); }
        if (!session.canEdit) { pendingAction = null; ['confirmDialog','editDialog','swapDialog','shuffleDialog','nicknameDialog'].forEach(id => $(id).close()); }
        message = e.status === 409 ? (reloaded ? '다른 관리자가 먼저 변경했습니다. 최신 내용을 불러왔습니다. 확인 후 다시 적용해 주세요.' : '다른 관리자가 먼저 변경했습니다. 최신 내용을 불러오지 못했으니 새로고침 후 다시 적용해 주세요.') : '편집 권한이 없습니다. 관리자 계정을 확인해 주세요.';
      }
      storageStatus(message); flash(message); return false;
    } finally { busy = false; render(); }
  }
  function startNextSeries() { state = H.newSeries(H.archiveCurrent(state)); }
  function ask(title, text, action, button = '확인') {
    if (!editable()) return;
    pendingAction = action; $('confirmTitle').textContent = title; $('confirmText').textContent = text;
    $('confirmAction').textContent = button; $('confirmDialog').showModal();
  }
  function guardReset(title, action, message = '현재 결과를 경기 기록에 보관하고 새 시리즈로 시작합니다. 계속할까요?') {
    if (!editable()) return;
    if (state.results.length) ask(title, message, action, '보관하고 적용'); else action();
  }
  function tierBadge(p) { return `<span class="tier-badge tier-${esc(p.tier)}">${esc(tierName(p.tier))}</span>`; }
  function preferences(p) {
    if (p.primary === 'fill') return p.excluded.length ? `${p.excluded.map(roleName).join('·')} 제외 모든 라인` : '모든 라인 가능';
    return `주 ${roleName(p.primary)}${p.secondary.length ? ' · 부 ' + p.secondary.map(roleName).join(' / ') : ''}`;
  }
  function renderScore() {
    const s = C.seriesStatus(state.bestOf, state.results);
    $('matchDate').value = state.matchDate;
    $('historyCount').textContent = state.history.length;
    $('archiveHint').textContent = s.complete ? (storageOK ? '이 시리즈는 경기 기록에 자동 보관됐습니다.' : '공용 저장 상태를 확인해 주세요.') : '완료된 시리즈는 자동 보관됩니다. 도중에 종료하면 중도종료로 남습니다.';
    $('endDayBtn').disabled = !state.results.length;
    $('bestOf').value = state.bestOf;
    $('ruleBadge').textContent = `BO${state.bestOf} · ${rule(state.bestOf)}`;
    $('ruleHint').textContent = `먼저 ${s.target}승을 달성한 팀이 승리합니다.`;
    $('scoreA').textContent = s.wins[0]; $('scoreB').textContent = s.wins[1];
    ['A','B'].forEach((side,i) => $('dots'+side).innerHTML = Array.from({length:s.target},(_,n) => `<span class="win-dot${n < s.wins[i] ? ' is-won' : ''}" aria-hidden="true"></span>`).join(''));
    $('matchState').textContent = s.complete ? '시리즈 종료' : state.results.length ? '진행 중' : '경기 대기';
    $('matchState').classList.toggle('complete', s.complete);
    $('progressText').textContent = s.complete ? `${names[s.winner]} 최종 승리 · ${s.wins[s.winner]}승 ${s.wins[1-s.winner]}패` : `${s.target}승을 먼저 달성하면 시리즈 승리`;
    $('nextGame').textContent = s.complete ? 'GG, 다음 내전에서 만나요' : `${s.nextGame}세트 대기`;
    $('seriesGames').innerHTML = Array.from({length:state.bestOf}, (_, i) => {
      const win = state.results[i], played = win === 0 || win === 1;
      const className = played ? (win === 0 ? 'won-a' : 'won-b') : s.complete ? 'skipped' : i === state.results.length ? 'current' : '';
      return `<button type="button" ${played ? 'data-game="'+i+'"' : 'disabled'} class="game-chip ${className}"><span class="game-label">SET ${String(i+1).padStart(2,'0')}</span><span class="game-result">${played ? names[win]+' 승' : s.complete ? '미진행' : i === state.results.length ? '다음 경기' : '대기'}</span></button>`;
    }).join('');
    $('recordHint').textContent = s.complete ? `${names[s.winner]}이 시리즈를 가져갑니다.` : `${s.nextGame}세트가 끝나면 승리한 팀을 선택하세요.`;
    document.querySelectorAll('[data-win]').forEach(b => b.disabled = s.complete || !state.draw || busy);
    $('undoBtn').disabled = !state.results.length; $('resetSeriesBtn').disabled = !state.results.length;
    document.querySelectorAll('[name="mode"]').forEach(r => r.checked = r.value === state.mode);
  }
  function renderTeams() {
    if (!state.draw) { $('teamsArea').innerHTML = '<div class="empty-panel">관리자가 공용 경기를 준비하면 라인업이 표시됩니다.</div>'; $('drawMeta').textContent = '편성 대기'; $('balanceSummary').innerHTML = ''; return; }
    $('drawTag').textContent = state.draw.adjusted ? '직접 조정' : state.draw.mode === 'random' ? '랜덤 편성' : '균형 편성';
    $('drawMeta').textContent = `${state.drawNumber}회차 · 5 vs 5`;
    const m = C.summarize(state.draw.teams, state.roster, state.draw.constraints);
    $('teamsArea').innerHTML = state.draw.teams.map((team, i) => `<article class="team-card team-${i === 0 ? 'a' : 'b'}"><header class="team-header"><div class="team-heading"><span class="team-label">TEAM ${i === 0 ? 'JONGWON' : 'MINJAE'}</span><h3>${names[i]}</h3></div><div class="team-total"><strong>${m.totals[i]}</strong><small>티어 합산</small></div></header><div class="player-list">${C.ROLES.map(r => {
      const slot = team.find(p => p.role === r.id), p = person(slot.id), fit = C.fit(p, r.id), captain = state.draw.constraints?.captainsLocked !== false && C.CAPTAINS.includes(p.id);
      return `<div class="player-row">${icon(r.id)}<div class="player-main"><div class="player-name"><a class="player-profile-link" href="./players.html?player=${encodeURIComponent(p.id)}">${esc(p.name)}</a>${captain ? '<span class="captain-badge" title="팀장">C</span>' : ''}</div><div class="player-preference">${esc(preferences(p))}</div></div><div class="player-meta">${tierBadge(p)}<span class="fit-tag fit-${fit.kind}">${esc(fit.label)}</span></div></div>`;
    }).join('')}</div><footer class="team-footer"><span>5 PLAYERS</span><span>${state.draw.constraints?.captainsLocked === false ? '팀장 고정 해제' : '팀장 '+esc(person(C.CAPTAINS[i]).name)}</span></footer></article>`).join('');
    $('balanceSummary').innerHTML = `<span class="balance-pill"><span class="status-dot"></span>티어 합산 차이 <b>${m.difference}</b></span><span>주 라인 <b>${m.primary}/10</b></span><span class="${m.offRole ? 'warning' : ''}">비선호 배정 <b>${m.offRole}명</b></span>`;
    const hasSupport = state.roster.some(p => p.primary === 'support' || p.secondary.includes('support'));
    document.querySelector('.line-note strong').textContent = hasSupport ? '라인업은 직접 조정할 수 있어요' : '서포터 배정을 확인하세요';
    document.querySelector('.line-note p').textContent = hasSupport ? '배정된 라인과 선호도를 확인하고, 필요하면 두 자리를 교환하세요.' : '현재 서포터 주·부 라인 인원이 없습니다. ‘상관없음’ 또는 비선호 라인으로 배정될 수 있습니다.';
    document.querySelector('.captain-lock span:last-child').textContent = state.draw.constraints?.captainsLocked === false ? '팀장 고정 해제 · 자유 배치' : `${person(C.CAPTAINS[0]).name} · ${person(C.CAPTAINS[1]).name} 각 팀 고정`;
    document.querySelectorAll('.captain-caption').forEach((el,i) => el.textContent = state.draw.constraints?.captainsLocked === false ? 'FREE LINEUP' : `CAPTAIN ${person(C.CAPTAINS[i]).name}`);
  }
  function renderRoster() {
    $('rosterArea').innerHTML = state.roster.map(p => `<article class="roster-card"><div class="roster-card-top"><span class="player-name"><a class="player-profile-link" href="./players.html?player=${encodeURIComponent(p.id)}">${esc(p.name)}</a>${C.CAPTAINS.includes(p.id) ? '<span class="captain-badge" title="팀장">C</span>' : ''}</span>${tierBadge(p)}</div><span class="roster-nickname">${p.currentNickname ? esc(p.currentNickname) : '닉네임 미등록'}${p.nicknameAliases?.length ? `<small>이전·추가 ${p.nicknameAliases.length}개</small>` : ''}</span><span class="preference-line"><b>주</b> ${p.primary === 'fill' ? '모든 라인' : esc(roleName(p.primary))}</span><span class="preference-line"><b>부</b> ${p.secondary.length ? esc(p.secondary.map(roleName).join(' · ')) : '—'}</span>${p.excluded.length ? `<span class="roster-exclusion">${esc(p.excluded.map(roleName).join(' · '))} 제외</span>` : ''}${session.canEdit ? `<div class="roster-actions"><button type="button" class="text-btn roster-edit" data-edit="${esc(p.id)}" aria-label="${esc(p.name)} 정보 수정" ${editable() ? '' : 'disabled'}>정보 수정</button><button type="button" class="text-btn roster-edit" data-nickname="${esc(p.id)}" aria-label="${esc(p.name)} 닉네임 관리" ${editable() ? '' : 'disabled'}>닉네임 관리</button></div>` : ''}</article>`).join('');
    const changwoo = person('changwoo');
    document.querySelector('.roster-notes > span:last-child').textContent = changwoo ? `${changwoo.name}: ${preferences(changwoo)}` : '';
  }
  function render() { renderScore(); renderTeams(); renderRoster(); applyAccess(); }
  function generate(mode = state.mode, roster = state.roster) {
    return C.makeTeams(roster, mode, state.draw, state.shuffleOptions);
  }
  function renderPairs() {
    $('pairList').innerHTML = draftPairs.map((pair,index) => `<span class="pair-tag">${pair.map(id=>esc(person(id).name)).join(' ↔ ')} <button type="button" data-remove-pair="${index}" aria-label="분리 조건 삭제">×</button></span>`).join('');
  }
  function clearCandidates() { candidates = []; candidateOptions = null; $('candidateList').innerHTML = ''; $('candidateError').textContent = '조건이 바뀌었습니다. 후보를 다시 만들어 주세요.'; }
  function makeCandidates() {
    if (!editable()) return;
    try {
      candidateOptions = C.normalizeShuffleOptions({captainsLocked:$('lockCaptains').checked,avoidRepeat:$('avoidRepeat').checked,separatePairs:draftPairs},state.roster);
      candidates = C.makeCandidates(state.roster,state.mode,state.draw,candidateOptions,3);
      $('candidateError').textContent = '';
      $('candidateList').innerHTML = candidates.map((draw,index)=>`<article class="candidate-card"><div class="candidate-heading"><h3>후보 ${index+1}</h3><span>티어 차이 ${draw.metrics.difference}</span></div><p class="candidate-summary">주 라인 ${draw.metrics.primary}/10 · 비선호 ${draw.metrics.offRole}명${state.draw ? ' · 이전 동료 조합 '+C.repeatPairs(draw,state.draw)+'/20' : ''}</p>${draw.teams.map((team,ti)=>`<div class="candidate-team"><strong>${names[ti]}</strong>${C.ROLES.map(role=>{const slot=team.find(p=>p.role===role.id);return `<div><span>${role.label}</span><b>${esc(person(slot.id).name)}</b><small>${tierName(person(slot.id).tier)}</small></div>`;}).join('')}</div>`).join('')}<button class="btn primary" data-candidate="${index}">이 편성 적용</button></article>`).join('');
    } catch (e) { candidates=[]; $('candidateList').innerHTML=''; $('candidateError').textContent=e.message; }
  }
  function shuffle() {
    if (!editable()) return;
    const options = C.normalizeShuffleOptions(state.shuffleOptions,state.roster);
    draftPairs = options.separatePairs.map(pair=>pair.slice());
    $('lockCaptains').checked=options.captainsLocked; $('avoidRepeat').checked=options.avoidRepeat;
    const choices = state.roster.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    $('pairA').innerHTML=choices; $('pairB').innerHTML=choices; $('pairB').selectedIndex=1;
    renderPairs(); $('shuffleDialog').showModal(); makeCandidates();
  }
  function chooseCandidate(index) {
    if (!editable() || !candidates[index] || !candidateOptions) return;
    const draw=clone(candidates[index]),options=clone(candidateOptions);
    $('shuffleDialog').close();
    guardReset('선택한 편성을 적용할까요?',()=>{startNextSeries();state.draw=draw;state.shuffleOptions=options;state.drawNumber++;return commit('선택한 라인업을 편성했습니다. 1세트부터 시작합니다.');});
  }
  function showGame(index) {
    const game=state.games?.[index]; if(!game)return;
    $('gameDialogTitle').textContent=`${index+1}세트 · ${names[game.winner]} 승리`;
    $('gameDialogContent').innerHTML=`<p class="dialog-description">이 세트에서 사용한 라인업입니다.${game.durationSeconds ? ' · '+Math.floor(game.durationSeconds/60)+'분 '+game.durationSeconds%60+'초' : ''}</p><div class="set-lineup-grid">${game.draw.teams.map((team,ti)=>`<section><h3>${names[ti]}</h3>${C.ROLES.map(role=>{const slot=team.find(p=>p.role===role.id),p=person(slot.id),detail=game.players.find(p=>p.id===slot.id);return `<div class="set-player"><span>${role.label}</span><b>${esc(p.name)}</b><small>${esc(detail?.champion||'챔피언 미입력')} · ${[detail?.kills,detail?.deaths,detail?.assists].map(v=>v??'—').join(' / ')}</small></div>`;}).join('')}</section>`).join('')}</div>`;
    $('gameDialog').showModal();
  }
  function recordWin(winner) {
    if (!editable()) return;
    const s = C.seriesStatus(state.bestOf, state.results);
    if (s.complete || !state.draw) return;
    ask(`${s.nextGame}세트 결과 기록`, `${names[winner]}의 승리로 기록할까요? 기록 후에도 ‘최근 기록 취소’로 되돌릴 수 있습니다.`, () => {
      state = H.recordGame(state, winner); return commit(`${s.nextGame}세트 · ${names[winner]} 승리`);
    }, '승리 기록');
  }
  function showEdit(id) {
    if (!editable()) return;
    const p = person(id); if (!p) return; editingId = id;
    $('playerName').value = p.name; $('playerName').readOnly = C.CAPTAINS.includes(p.id); $('playerName').title = C.CAPTAINS.includes(p.id) ? '팀장 이름은 팀과 함께 고정됩니다.' : ''; $('playerTier').value = p.tier; $('playerPrimary').value = p.primary;
    $('playerSecondary1').value = p.secondary[0] || ''; $('playerSecondary2').value = p.secondary[1] || '';
    document.querySelectorAll('[name="excluded"]').forEach(c => c.checked = p.excluded.includes(c.value));
    $('editError').textContent = ''; $('editDialog').showModal();
  }
  function showNicknames(id) {
    if (!editable()) return;
    const p = person(id); if (!p) return;
    nicknameEditingId = id; nicknameRevision = revision; nicknameCollisionAccepted = null;
    $('nicknameTitle').textContent = `${p.name} · 닉네임 관리`;
    $('nicknameCurrent').value = p.currentNickname || '';
    $('nicknameAliases').value = (p.nicknameAliases || []).join('\n');
    $('nicknameError').textContent = ''; $('nicknameWarning').textContent = ''; $('nicknameWarning').hidden = true;
    $('nicknameSave').textContent = '닉네임 저장';
    $('nicknameDialog').showModal();
  }
  function resetNicknameWarning() {
    nicknameCollisionAccepted = null; $('nicknameSave').textContent = '닉네임 저장';
    $('nicknameWarning').hidden = true; $('nicknameWarning').textContent = ''; $('nicknameError').textContent = '';
  }
  async function submitNicknames(event) {
    event.preventDefault();
    if (!editable() || !nicknameEditingId || !$('nicknameDialog').open) return;
    if (nicknameRevision !== revision) {
      $('nicknameError').textContent = '다른 관리자의 변경을 불러왔습니다. 대화상자를 닫고 다시 열어 최신 닉네임을 확인해 주세요.'; return;
    }
    try {
      const next = H.updatePlayerNicknames(state, nicknameEditingId, {
        currentNickname: $('nicknameCurrent').value.trim() || null,
        nicknameAliases: $('nicknameAliases').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
      });
      const updated = next.roster.find(p => p.id === nicknameEditingId);
      const keys = new Set([updated.currentNickname, ...updated.nicknameAliases].filter(Boolean).map(C.normalizeNickname));
      const collisions = next.roster.filter(p => p.id !== nicknameEditingId && [p.name, p.currentNickname, ...p.nicknameAliases].some(value => keys.has(C.normalizeNickname(value))));
      const signature = JSON.stringify([updated.currentNickname, updated.nicknameAliases, collisions.map(p => p.id)]);
      if (collisions.length && nicknameCollisionAccepted !== signature) {
        nicknameCollisionAccepted = signature;
        $('nicknameWarning').textContent = `${collisions.map(p => p.name).join(', ')} 선수와 겹치는 이름·닉네임이 있습니다. JSON 등록 시 자동 연결되지 않으며 관리자가 선수를 확인해야 합니다. 의도한 중복이면 ‘중복 확인 후 저장’을 눌러 주세요.`;
        $('nicknameWarning').hidden = false; $('nicknameSave').textContent = '중복 확인 후 저장'; return;
      }
      state = next;
      // Account labels never change this series or its frozen historical roster.
      const saved = await commit(`${updated.name} 선수의 게임 닉네임을 변경했습니다.`, {syncCurrent:false});
      if (saved) { $('nicknameDialog').close(); nicknameEditingId = null; }
      else if ($('nicknameDialog').open) $('nicknameError').textContent = '닉네임을 저장하지 못했습니다. 화면 상단 안내를 확인한 뒤 다시 시도해 주세요.';
    } catch (error) { $('nicknameError').textContent = error.message || '닉네임을 확인해 주세요.'; }
  }
  function submitEdit(event) {
    event.preventDefault();
    if (!editable()) return;
    const p = {...person(editingId), name:$('playerName').value.trim(), tier:$('playerTier').value, primary:$('playerPrimary').value,
      secondary:[$('playerSecondary1').value,$('playerSecondary2').value].filter(Boolean), excluded:[...document.querySelectorAll('[name="excluded"]:checked')].map(c=>c.value)};
    if (!p.name) { $('editError').textContent = '이름을 입력해 주세요.'; return; }
    if (new Set(p.secondary).size !== p.secondary.length || p.secondary.includes(p.primary)) { $('editError').textContent = '주·부 라인은 중복해서 선택할 수 없습니다.'; return; }
    if (p.excluded.includes(p.primary) || p.secondary.some(r => p.excluded.includes(r))) { $('editError').textContent = '선호 라인과 제외 라인이 겹칩니다.'; return; }
    if (p.primary === 'fill' && p.secondary.length) { $('editError').textContent = '주 라인이 상관없음일 때는 부 라인을 비워 주세요.'; return; }
    const roster = state.roster.map(old => old.id === p.id ? p : old);
    try {
      const draw = generate(state.mode, roster);
      $('editDialog').close();
      guardReset('명단을 수정할까요?', () => { startNextSeries(); state.roster = roster; state.draw = draw; state.drawNumber++; state.results = []; return commit('참가자 정보를 수정하고 팀을 새로 편성했습니다.'); });
    } catch (e) { $('editError').textContent = e.message; }
  }
  function showSwap() {
    if (!editable()) return;
    if (!state.draw || C.seriesStatus(state.bestOf,state.results).complete) return;
    const options = state.draw.teams.flatMap((team,ti) => team.map((slot,si) => `<option value="${ti}:${si}">${names[ti]} · ${roleName(slot.role)} · ${esc(person(slot.id).name)}</option>`)).join('');
    $('swapFrom').innerHTML = options; $('swapTo').innerHTML = options; $('swapTo').selectedIndex = 1; $('swapError').textContent = ''; $('swapDialog').showModal();
  }
  function submitSwap(event) {
    event.preventDefault();
    if (!editable()) return;
    const [ta,ia] = $('swapFrom').value.split(':').map(Number), [tb,ib] = $('swapTo').value.split(':').map(Number);
    if (ta === tb && ia === ib) { $('swapError').textContent = '서로 다른 두 자리를 선택해 주세요.'; return; }
    const teams = state.draw.teams.map(t => t.map(s => ({...s}))), a = teams[ta][ia], b = teams[tb][ib];
    if (state.draw.constraints?.captainsLocked !== false && ta !== tb && (C.CAPTAINS.includes(a.id) || C.CAPTAINS.includes(b.id))) { $('swapError').textContent = '팀장은 다른 팀으로 이동할 수 없습니다. 같은 팀 안에서는 라인을 바꿀 수 있습니다.'; return; }
    if (person(a.id).excluded.includes(b.role) || person(b.id).excluded.includes(a.role)) { $('swapError').textContent = '배정 제외 라인으로 이동할 수 없습니다.'; return; }
    [a.id,b.id] = [b.id,a.id];
    try {
      const draw={...state.draw,adjusted:true,teams,metrics:C.summarize(teams,state.roster,state.draw.constraints),createdAt:new Date().toISOString()};
      const apply=()=>{state=H.setNextDraw(state,draw);return commit('완료한 세트는 유지하고 다음 세트 라인업을 변경했습니다.');};
      $('swapDialog').close();
      if(state.results.length)ask('다음 세트 라인업 변경','이미 진행한 세트의 점수와 라인업은 유지합니다. 다음 세트부터 이 교환을 적용할까요?',apply,'다음 세트에 적용');else return apply();
    } catch(e) { $('swapError').textContent=e.message; }
  }

  function summary() {
    const s = C.seriesStatus(state.bestOf,state.results);
    return ['[진인프라 융합본부 LoL 내전]', state.matchDate,`${rule(state.bestOf)} · ${names[0]} ${s.wins[0]} : ${s.wins[1]} ${names[1]}`,s.complete ? `최종 승리: ${names[s.winner]}` : `${s.nextGame}세트 대기`,'',...state.draw.teams.flatMap((team,ti) => [`[${names[ti]}]`,...C.ROLES.map(r=>{const p=person(team.find(s=>s.role===r.id).id);return `${r.label}: ${p.name} (${tierName(p.tier)}) · ${preferences(p)}`;}),'']),state.results.length ? '경기 기록: '+state.results.map((w,i)=>`${i+1}세트 ${names[w]} 승`).join(' / ') : '아직 경기 기록이 없습니다.'].join('\n');
  }
  function download(raw, prefix) {
    const blob = new Blob([raw],{type:'application/json'}), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${prefix}_${H.today()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function backup() {
    if (!ready || !confirmed) return;
    download(JSON.stringify(confirmed,null,2),'융합본부_롤내전');
    flash('공용 경기와 날짜별 전체 기록을 백업했습니다.');
  }
  function prepareImport(data, migration = false) {
    if (!H.validate(data) || data.roster.length !== 10 || !data.draw) throw new Error('올바른 롤 내전 백업 파일이 아닙니다.');
    ask(migration ? '기존 기록을 공용으로 이전할까요?' : '백업 불러오기', '현재 매치 화면을 이전 기록으로 교체하고 과거 기록은 합칩니다. 현재 진행 결과도 보관하며, 같은 시리즈는 불러온 결과로 갱신합니다.', async () => {
      const prior = H.archiveCurrent(state); data.history = H.mergeHistory(prior.history, data.history); state = data;
      const saved = await commit('이전 데이터와 누적 경기 기록을 공용으로 저장했습니다.');
      if (saved && migration) { legacyMoved = true; applyAccess(); }
      return saved;
    }, migration ? '공용으로 이전' : '불러오기');
  }
  async function importBackup(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!editable() || !file) return;
    try {
      if (file.size > 10000000) throw new Error('파일이 너무 큽니다. 이 사이트에서 저장한 JSON을 선택해 주세요.');
      const data = H.upgrade(JSON.parse(await file.text()));
      if (editable()) prepareImport(data);
    } catch (e) { flash(e.message); }
  }
  function initForms() {
    $('playerTier').innerHTML = C.TIERS.map(t=>`<option value="${t.id}">${esc(t.label)}</option>`).join('');
    const opts = C.ROLES.map(r=>`<option value="${r.id}">${esc(r.label)}</option>`).join('')+'<option value="fill">상관없음</option>';
    $('playerPrimary').innerHTML = opts;
    ['playerSecondary1','playerSecondary2'].forEach(id=>$(id).innerHTML='<option value="">없음</option>'+opts);
    $('excludedChoices').innerHTML = C.ROLES.map(r=>`<label><input type="checkbox" name="excluded" value="${r.id}">${esc(r.label)}</label>`).join('');
    $('tierScale').textContent = '티어 상대 점수: '+C.TIERS.map(t=>`${t.label} ${t.score}`).join(' · ');
  }
  $('matchDate').addEventListener('change', event => {
    if (!editable()) return;
    const date = event.target.value; event.target.value = state.matchDate;
    try {
      H.upgrade({...state, matchDate:date});
      const apply = () => { state.matchDate = date; return commit('경기 기록 날짜를 변경했습니다.'); };
      if (state.results.length) ask('경기 날짜 변경', '현재 시리즈의 결과를 선택한 날짜로 보관합니다. 점수는 유지됩니다.', apply, '날짜 변경'); else apply();
    } catch { flash('올바른 경기 날짜를 선택해 주세요.'); }
  });
  $('endDayBtn').addEventListener('click', () => {
    if (!editable() || !state.results.length) return;
    const date = state.matchDate, complete = C.seriesStatus(state.bestOf,state.results).complete;
    ask('내전을 종료할까요?', complete ? '종료된 결과와 당시 라인업을 보관하고 날짜별 기록으로 이동합니다.' : '현재 결과를 중도종료로 보관합니다. 시리즈 승리 팀은 정하지 않고, 진행한 세트의 승패만 전적에 반영합니다.', async () => {
      startNextSeries();
      if (await commit('내전 결과를 보관했습니다.')) location.href = './history.html?date=' + encodeURIComponent(date);
    }, '보관하고 기록 보기');
  });
  $('shuffleBtn').addEventListener('click',shuffle);
  $('makeCandidatesBtn').addEventListener('click',makeCandidates);
  ['lockCaptains','avoidRepeat'].forEach(id=>$(id).addEventListener('change',()=>{if(editable())clearCandidates();}));
  $('addPairBtn').addEventListener('click',()=>{if(!editable())return;try{const pairs=[...draftPairs,[$('pairA').value,$('pairB').value]];draftPairs=C.normalizeShuffleOptions({separatePairs:pairs},state.roster).separatePairs;renderPairs();clearCandidates();}catch(e){$('candidateError').textContent=e.message;}});
  $('pairList').addEventListener('click',event=>{const button=event.target.closest('[data-remove-pair]');if(!editable()||!button)return;draftPairs.splice(Number(button.dataset.removePair),1);renderPairs();clearCandidates();});
  $('candidateList').addEventListener('click',event=>{const button=event.target.closest('[data-candidate]');if(button)chooseCandidate(Number(button.dataset.candidate));});
  $('seriesGames').addEventListener('click',event=>{const button=event.target.closest('[data-game]');if(button)showGame(Number(button.dataset.game));});
  $('shareCardBtn').addEventListener('click',async()=>{if(!ready||!state.draw)return;try{await globalThis.ResultCard.open(clone(state));}catch(e){flash(e.message||'공유 카드를 만들지 못했습니다.');}});
  document.querySelectorAll('[data-win]').forEach(b=>b.addEventListener('click',()=>recordWin(Number(b.dataset.win))));
  $('undoBtn').addEventListener('click',()=>{if(!editable()||!state.results.length)return;ask('최근 기록을 취소할까요?',`${state.results.length}세트 승리 기록을 되돌립니다.`,()=>{state = H.undoGame(state);return commit('최근 세트 기록을 취소했습니다.');},'기록 취소');});
  $('resetSeriesBtn').addEventListener('click',()=>{if(!editable()||!state.results.length)return;ask('같은 팀으로 새 시리즈', '현재 결과를 경기 기록에 보관하고 같은 팀으로 새 시리즈를 시작합니다.',()=>{startNextSeries();return commit('같은 팀으로 새 시리즈를 시작합니다.');},'새 시리즈 시작');});
  $('bestOf').addEventListener('change',e=>{if(!editable())return;const value=Number(e.target.value);e.target.value=state.bestOf;guardReset('경기 방식을 바꿀까요?',()=>{startNextSeries();state.bestOf=value;state.results=[];return commit(`${rule(value)}으로 변경했습니다.`);});});
  document.querySelectorAll('[name="mode"]').forEach(r=>r.addEventListener('change',()=>{if(!editable())return;state.mode=r.value;return commit('다음 팀 셔플부터 선택한 방식을 적용합니다.');}));
  $('rosterArea').addEventListener('click',e=>{const nickname=e.target.closest('[data-nickname]');if(nickname?.dataset.nickname){showNicknames(nickname.dataset.nickname);return;}const b=e.target.closest('[data-edit]');if(b)showEdit(b.dataset.edit);});
  $('editForm').addEventListener('submit',submitEdit); $('swapBtn').addEventListener('click',showSwap); $('swapForm').addEventListener('submit',submitSwap);
  $('nicknameForm').addEventListener('submit', submitNicknames);
  ['nicknameCurrent','nicknameAliases'].forEach(id => $(id).addEventListener('input', resetNicknameWarning));
  $('nicknameDialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.close==='nicknameDialog'&&busy)return;$(b.dataset.close).close();}));
  $('cancelAction').addEventListener('click',()=>{pendingAction=null;$('confirmDialog').close();});
  $('confirmDialog').addEventListener('cancel',()=>pendingAction=null);
  $('confirmAction').addEventListener('click',async()=>{if(!editable())return;const action=pendingAction;pendingAction=null;$('confirmDialog').close();if(action){try{await action();}catch(e){flash(e.message);}}});
  $('copyBtn').addEventListener('click',async()=>{if(!ready||!state.draw)return;try{await navigator.clipboard.writeText(summary());flash('팀 편성과 경기 현황을 복사했습니다.');}catch{$('copyText').value=summary();$('copyDialog').showModal();$('copyText').select();}});
  $('saveBtn').addEventListener('click',backup); $('loadBtn').addEventListener('click',()=>{if(editable())$('loadFile').click();}); $('loadFile').addEventListener('change',importBackup);
  $('refreshBtn').addEventListener('click', () => refresh());
  $('legacyBackupBtn').addEventListener('click', () => { if (session.canEdit && legacyRaw) download(legacyRaw, '융합본부_이전원본'); });
  $('migrateBtn').addEventListener('click', () => { if (!editable() || !legacyRaw) return; try { prepareImport(H.upgrade(JSON.parse(legacyRaw)),true); } catch { flash('이전 기록을 읽지 못했습니다. 기존 기록 백업으로 원본을 보관해 주세요.'); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !document.querySelector('dialog[open]')) refresh({quiet:true}); });
  setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) refresh({quiet:true}); },15000);
  initForms(); render(); refresh({initial:true});
})();
