'use strict';
(() => {
  const C = globalThis.LoLCore;
  const H = globalThis.LoLHistory;
  const D = globalThis.SiteData;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const roleName = id => id === 'fill' ? '상관없음' : C.ROLES.find(role => role.id === id)?.label || id;
  const tierName = id => C.TIERS.find(tier => tier.id === id)?.label || id;
  const ruleName = bestOf => bestOf === 1 ? '단판' : `${bestOf}판 ${Math.ceil(bestOf / 2)}선승`;
  const formatDate = date => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(`${date}T12:00:00+09:00`));
  const fullDate = date => `${date.slice(0, 4)}년 ${formatDate(date)}`;
  const formatTime = iso => new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(iso));
  let state = null;
  let loadStatus = 'loading';
  let revision = -1;
  let pendingLoad = null;
  let backupBusy = false;
  const query = new URLSearchParams(window.location.search);
  let selectedDate = query.get('date') || 'all';
  const linkedRecordId = query.get('record');
  const linkedGame = query.get('game');
  let deepLinkHandled = false;
  let highlightedRecordId = null;
  let highlightedGameNumber = null;
  let toastTimer;
  let session = { canEdit: false, canManageAdmins: false, user: null, role: 'viewer' };
  let editDraft = null;
  let editBaseRevision = -1;
  let editReviewed = null;
  let saving = false;
  let auditEntries = [];
  let restoreEntry = null;
  let restoreBaseRevision = -1;
  let auditRequest = 0;
  let editorStats = [];
  let deleteRecordId = null;
  let deleteBaseRevision = -1;
  const clone = value => JSON.parse(JSON.stringify(value));
  const hasOpenDialog = () => !!document.querySelector('dialog[open]');
  const matchGames = match => match.games || match.results.map(winner => ({ winner, draw: match.draw, players: [] }));

  function flash(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    $('liveStatus').textContent = message;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4800);
  }

  function preferences(player) {
    if (player.primary === 'fill') return player.excluded.length ? `${player.excluded.map(roleName).join('·')} 제외 모든 라인` : '모든 라인 가능';
    return `주 ${roleName(player.primary)}${player.secondary.length ? ` · 부 ${player.secondary.map(roleName).join(' / ')}` : ''}`;
  }

  function showAccess(identity) {
    session = identity;
    const roles = { owner: '소유자', admin: '관리자', viewer: '보기 전용' };
    $('accessStrip').classList.remove('is-error');
    $('accessBadge').textContent = roles[session.role];
    $('accessBadge').dataset.role = session.role;
    $('accessIdentity').textContent = session.user ? session.user.email || session.user.name || '로그인한 계정' : '보기 전용으로 이용 중';
    $('accessMessage').textContent = session.canEdit ? '종료 기록을 수정·삭제하고 변경 이력에서 복구할 수 있습니다.' : '관리자가 저장한 공용 경기 기록을 조회합니다. 경기 편집은 관리자만 가능합니다.';
    $('accessLogin').hidden = !!session.user;
    $('adminNav').hidden = !session.canManageAdmins;
    $('historyAuditBtn').hidden = !session.canEdit;
    if (!session.canEdit) {
      auditRequest += 1;
      for (const id of ['recordEditDialog', 'restoreDialog', 'auditDialog', 'deleteRecordDialog']) if ($(id).open) $(id).close();
    }
  }

  function load() {
    if (pendingLoad) return pendingLoad;
    if (saving) return Promise.resolve(false);
    $('historyRefreshBtn').disabled = true;
    $('historyBackupBtn').disabled = true;
    pendingLoad = (async () => {
      try {
        const result = await D.load();
        if (result.state !== null && !H.validate(result.state)) throw new Error('서버의 경기 기록 형식을 확인할 수 없습니다. 관리자에게 확인을 요청해 주세요.');
        const changed = loadStatus !== 'ready' || result.revision !== revision || result.session.canEdit !== session.canEdit;
        state = result.state === null ? null : H.upgrade(result.state);
        revision = result.revision;
        loadStatus = 'ready';
        showAccess(result.session);
        $('historyError').hidden = true;
        $('historyStorageStatus').textContent = `공용 경기 기록 · ${formatTime(new Date().toISOString())} 확인`;
        if (changed) render();
        return true;
      } catch (error) {
        session = { canEdit: false, canManageAdmins: false, user: null, role: 'viewer' };
        state = null;
        loadStatus = 'error';
        $('historyError').textContent = `${error.message} 새로고침을 눌러 다시 불러올 수 있습니다.`;
        $('historyError').hidden = false;
        $('historyStorageStatus').textContent = '공용 기록 연결 실패';
        $('accessStrip').classList.add('is-error');
        $('accessBadge').textContent = '연결 확인';
        delete $('accessBadge').dataset.role;
        $('accessIdentity').textContent = '최신 기록을 확인하지 못했습니다.';
        $('accessMessage').textContent = '네트워크와 로그인 상태를 확인한 후 다시 불러와 주세요.';
        $('adminNav').hidden = true;
        $('historyAuditBtn').hidden = true;
        $('accessLogin').hidden = error.status !== 401;
        render();
        return false;
      } finally {
        pendingLoad = null;
        $('historyRefreshBtn').disabled = false;
        $('historyBackupBtn').disabled = backupBusy || loadStatus !== 'ready' || state === null;
      }
    })();
    return pendingLoad;
  }

  function renderOverview(summary) {
    const byName = new Map(summary.teams.map(team => [team.name, team]));
    const names = C.TEAM_NAMES;
    $('archiveOverview').innerHTML = `
      <div class="archive-stat"><span class="archive-stat-label">총 경기일</span><div class="archive-stat-value">${summary.days}<small>일</small></div><span class="archive-stat-sub">함께한 내전의 날</span></div>
      <div class="archive-stat"><span class="archive-stat-label">누적 시리즈</span><div class="archive-stat-value">${summary.matches}<small>회</small></div><span class="archive-stat-sub">완료 ${summary.completed} · 중도종료 ${summary.stopped}</span></div>
      <div class="archive-stat"><span class="archive-stat-label">플레이한 세트</span><div class="archive-stat-value">${summary.games}<small>세트</small></div><span class="archive-stat-sub">진행한 세트만 집계</span></div>
      <div class="archive-stat rivalry"><span class="archive-stat-label">팀 시리즈 승수</span><div class="rivalry-score"><div class="rivalry-side"><span>${esc(names[0])}</span><b>${byName.get(names[0])?.seriesWins || 0}</b></div><span class="rivalry-divider">:</span><div class="rivalry-side"><b>${byName.get(names[1])?.seriesWins || 0}</b><span>${esc(names[1])}</span></div></div><span class="archive-stat-sub">완료된 시리즈 기준</span></div>`;
  }

  function renderTeamHistory(summary) {
    const teams = summary.teams.length ? summary.teams : C.TEAM_NAMES.map(name => ({ name, seriesWins: 0, seriesLosses: 0, gameWins: 0, gameLosses: 0 }));
    $('teamHistory').innerHTML = teams.map((team, index) => {
      const games = team.gameWins + team.gameLosses;
      const rate = games ? `${Math.round(team.gameWins / games * 100)}%` : '—';
      return `<article class="team-history-card team-${index}"><h3>${esc(team.name)}</h3><dl><div><dt>시리즈 전적</dt><dd><b>${team.seriesWins}승</b> ${team.seriesLosses}패</dd></div><div><dt>세트 전적</dt><dd><b>${team.gameWins}승</b> ${team.gameLosses}패</dd></div><div><dt>세트 승률</dt><dd><b>${rate}</b></dd></div></dl></article>`;
    }).join('');
  }

  function snapshot(match, game) {
    const people = new Map(match.roster.map(player => [player.id, player]));
    const performances = new Map((game?.players || []).map(player => [player.id, player]));
    return (game?.draw || match.draw).teams.map((team, index) => `<section class="snapshot-team"><h4>${esc(match.teamNames[index])}</h4>${C.ROLES.map(role => {
      const slot = team.find(slot => slot.role === role.id);
      const player = people.get(slot.id);
      const detail = performances.get(slot.id);
      const numbers = detail?.kills != null && detail?.deaths != null && detail?.assists != null ? ` · ${detail.kills}/${detail.deaths}/${detail.assists}` : '';
      return `<div class="snapshot-player"><span class="snapshot-role">${esc(role.label)}</span><div class="snapshot-person"><a class="snapshot-name snapshot-profile-link" href="./players.html?player=${encodeURIComponent(player.id)}">${esc(player.name)}</a>${detail?.nicknameAtMatch ? `<span class="snapshot-nickname">당시 닉네임 · ${esc(detail.nicknameAtMatch)}</span>` : ''}<span class="snapshot-pref">${esc(preferences(player))}</span>${detail?.champion || numbers ? `<span class="snapshot-game-stat">${esc(detail?.champion || '챔피언 미입력')}${esc(numbers)}</span>` : ''}</div><span class="tier-badge tier-${esc(player.tier)}">${esc(tierName(player.tier))}</span></div>`;
    }).join('')}</section>`).join('');
  }

  function matchCard(match, dayIndex) {
    const score = C.seriesStatus(match.bestOf, match.results);
    const completed = match.status === 'completed';
    return `<article class="archive-match${highlightedRecordId === match.id ? ' is-linked-record' : ''}" id="record-${esc(match.id)}" tabindex="-1">
      <div class="archive-match-top"><span class="archive-rule">BO${match.bestOf} · ${ruleName(match.bestOf)}</span><span class="archive-status${completed ? '' : ' stopped'}">${completed ? '시리즈 완료' : '중도종료'}</span><span class="archive-time">${dayIndex}번째 시리즈 · 보관 ${esc(formatTime(match.endedAt))}</span></div>
      <div class="archive-match-score"><div class="archive-match-team first"><span>TEAM JONGWON</span><strong>${esc(match.teamNames[0])}</strong></div><div class="archive-match-scoreline" aria-label="${esc(match.teamNames[0])} ${score.wins[0]}승, ${esc(match.teamNames[1])} ${score.wins[1]}승"><b${completed && score.winner === 0 ? ' class="winner"' : ''}>${score.wins[0]}</b><i>:</i><b${completed && score.winner === 1 ? ' class="winner"' : ''}>${score.wins[1]}</b></div><div class="archive-match-team second"><span>TEAM MINJAE</span><strong>${esc(match.teamNames[1])}</strong></div></div>
      <p class="archive-outcome">${completed ? `<strong>${esc(match.teamNames[score.winner])} 최종 승리</strong> · ${match.results.length}세트 진행` : `${match.results.length}세트 진행 후 종료 · 시리즈 승패 미집계`}</p>
      <div class="archive-sets" aria-label="세트별 승리 팀">${match.results.map((winner, index) => `<div class="archive-set team-${winner}"><span>SET ${String(index + 1).padStart(2, '0')}</span><b>${esc(match.teamNames[winner])} 승</b></div>`).join('')}</div>
      <details class="archive-lineup"${highlightedRecordId === match.id ? ' open' : ''}><summary>세트별 실제 라인업<small>티어 · 라인 · 챔피언 · K/D/A</small></summary><div class="snapshot-sets">${matchGames(match).map((game,index) => `<div class="snapshot-set${highlightedRecordId === match.id && highlightedGameNumber === index + 1 ? ' is-linked-game' : ''}" id="record-${esc(match.id)}-game-${index + 1}" tabindex="-1"><h4>${index + 1}세트 · ${esc(match.teamNames[game.winner])} 승</h4><div class="snapshot-grid">${snapshot(match,game)}</div></div>`).join('')}</div><p class="snapshot-caption">${match.drawNumber}회차 편성 · ${match.draw.adjusted ? '직접 조정' : match.draw.mode === 'random' ? '랜덤 편성' : '균형 편성'} · 기록 당시 정보를 표시합니다.</p></details>
      <div class="record-actions-bar"><button type="button" class="btn" data-share="${esc(match.id)}">결과 카드</button>${session.canEdit ? `<button type="button" class="btn" data-edit-record="${esc(match.id)}">기록 수정</button><button type="button" class="btn" data-audit="${esc(match.id)}">변경 이력</button><button type="button" class="btn record-delete-btn" data-delete-record="${esc(match.id)}">기록 삭제</button>` : ''}</div>
    </article>`;
  }

  function renderMatches(records) {
    if (!records.length) {
      $('historyMatches').innerHTML = `<div class="archive-empty"><span class="archive-empty-icon" aria-hidden="true">▤</span><h3>${loadStatus === 'ready' ? '아직 저장된 내전 기록이 없어요' : '경기 기록을 불러오지 못했어요'}</h3><p>${loadStatus === 'ready' ? '관리자가 매치 센터에서 시리즈를 마치면 이곳에서 날짜별 결과와 당시 라인업을 확인할 수 있습니다.' : '연결 상태를 확인하고 새로고침해 주세요. 서버에 저장된 기록은 변경되지 않았습니다.'}</p><a class="btn" href="./index.html">매치 센터로 이동 ↗</a></div>`;
      return;
    }
    const byDate = new Map();
    records.slice().sort((a, b) => b.endedAt.localeCompare(a.endedAt)).forEach(match => {
      if (!byDate.has(match.date)) byDate.set(match.date, []);
      byDate.get(match.date).push(match);
    });
    $('historyMatches').innerHTML = Array.from(byDate.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([date, matches]) => `<section class="archive-day"><div class="archive-day-heading"><h3>${esc(fullDate(date))}</h3><span>${matches.length}시리즈 · ${matches.reduce((total, match) => total + match.results.length, 0)}세트</span></div>${matches.map((match, index) => matchCard(match, matches.length - index)).join('')}</section>`).join('');
  }

  function render() {
    const records = state?.history || [];
    let deepLinkTarget = null;
    if (loadStatus === 'ready' && !deepLinkHandled && linkedRecordId) {
      deepLinkHandled = true;
      const linked = records.find(record => record.id === linkedRecordId);
      const gameNumber = linkedGame === null ? null : /^[1-7]$/.test(linkedGame) ? Number(linkedGame) : NaN;
      const error = !linked ? '연결된 경기 기록을 찾을 수 없습니다. 삭제되었거나 아직 보관되지 않은 기록입니다.' : (gameNumber !== null && (!Number.isInteger(gameNumber) || gameNumber > linked.results.length)) ? '연결된 세트를 찾을 수 없습니다. 경기 기록과 세트 번호를 확인해 주세요.' : '';
      $('historyLinkStatus').textContent = error;
      $('historyLinkStatus').hidden = !error;
      if (!error) {
        selectedDate = linked.date;
        highlightedRecordId = linked.id;
        highlightedGameNumber = gameNumber;
        deepLinkTarget = `record-${linked.id}${gameNumber === null ? '' : `-game-${gameNumber}`}`;
      }
    }
    if (loadStatus === 'ready' && highlightedRecordId && !records.some(record => record.id === highlightedRecordId)) {
      $('historyLinkStatus').textContent = '연결된 경기 기록이 삭제되었습니다. 관리자에게 복구 여부를 확인해 주세요.';
      $('historyLinkStatus').hidden = false;
    }
    const dates = Array.from(new Set(records.map(match => match.date))).sort().reverse();
    if (selectedDate !== 'all' && !dates.includes(selectedDate)) selectedDate = 'all';
    $('historyDate').innerHTML = '<option value="all">전체 경기일</option>' + dates.map(date => `<option value="${esc(date)}">${esc(fullDate(date))}</option>`).join('');
    $('historyDate').value = selectedDate;
    $('historyDate').disabled = !dates.length;
    const filtered = selectedDate === 'all' ? records : records.filter(match => match.date === selectedDate);
    const summary = H.summarize(filtered);
    $('filterSummary').textContent = loadStatus === 'error' ? '최신 기록을 확인할 수 없습니다.' : `${selectedDate === 'all' ? '전체 기록' : fullDate(selectedDate)} · ${summary.matches}시리즈 · ${summary.games}세트`;
    renderOverview(summary);
    renderTeamHistory(summary);
    renderMatches(filtered);
    if (deepLinkTarget) {
      const target = document.getElementById(deepLinkTarget);
      if (target) { target.scrollIntoView({ block: 'start' }); target.focus({ preventScroll: true }); }
    }
  }

  const statFields = [ ['kills', 'K', 1000], ['deaths', 'D', 1000], ['assists', 'A', 1000], ['damage', '딜량', 10000000], ['cs', 'CS', 100000], ['gold', '골드', 10000000], ['vision', '시야', 100000] ];
  function nullableNumber(value) {
    if (String(value).trim() === '') return null;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error('수치는 0 이상의 정수로 입력하고, 확인할 수 없으면 빈칸으로 두세요.');
    return number;
  }
  function invalidatePreview() {
    editReviewed = null;
    $('recordPreview').hidden = true;
    $('saveRecordEdit').disabled = true;
    $('saveRecordEdit').textContent = '검토 후 저장';
  }
  function renderEditor() {
    editorStats = editDraft.games.map(game => new Map(game.players.map(player => [player.id, clone(player)])));
    $('editMatchDate').value = editDraft.date;
    $('editBestOf').value = String(editDraft.bestOf);
    $('editSets').innerHTML = editDraft.games.map((game, gameIndex) => {
      const performance = new Map(game.players.map(player => [player.id, player]));
      return `<section class="editor-set"><div class="editor-set-heading"><strong>${gameIndex + 1}세트</strong><label>승리 팀 <select class="select-input" data-winner="${gameIndex}">${editDraft.teamNames.map((name, index) => `<option value="${index}"${game.winner === index ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>${gameIndex === editDraft.games.length - 1 && editDraft.games.length > 1 ? '<button type="button" class="text-btn" data-remove-set="true">마지막 세트 제거</button>' : ''}</div><div class="editor-meta"><label>경기 시간(초) <input class="text-input" type="number" inputmode="numeric" min="1" max="21600" data-duration="${gameIndex}" value="${game.durationSeconds ?? ''}" placeholder="미입력"></label><label class="editor-notes">메모 <input class="text-input" maxlength="1000" data-notes="${gameIndex}" value="${esc(game.notes || '')}" placeholder="선택 입력"></label></div>${game.draw.teams.map((team, teamIndex) => `<section class="editor-team"><h4>${esc(editDraft.teamNames[teamIndex])}</h4><div class="editor-table-wrap"><table class="editor-table"><caption class="sr-only">${gameIndex + 1}세트 ${esc(editDraft.teamNames[teamIndex])} 라인업 및 개인 수치 편집</caption><thead><tr><th scope="col">라인</th><th scope="col">선수</th><th scope="col">당시 닉네임</th><th scope="col">챔피언</th>${statFields.map(field => `<th scope="col">${field[1]}</th>`).join('')}</tr></thead><tbody>${C.ROLES.map(role => {
        const slot = team.find(slot => slot.role === role.id);
        const detail = performance.get(slot.id) || {};
        const label = `${gameIndex + 1}세트 ${editDraft.teamNames[teamIndex]} ${role.label}`;
        return `<tr data-player-row data-game="${gameIndex}" data-team="${teamIndex}" data-role="${role.id}" data-person="${esc(slot.id)}"><td>${esc(role.label)}</td><td><select class="select-input" data-field="id" aria-label="${esc(label)} 선수">${editDraft.roster.map(player => `<option value="${esc(player.id)}"${player.id === slot.id ? ' selected' : ''}>${esc(player.name)}</option>`).join('')}</select></td><td><input class="text-input" data-field="nicknameAtMatch" maxlength="100" aria-label="${esc(label)} 당시 닉네임" value="${esc(detail.nicknameAtMatch || '')}" placeholder="미입력"></td><td><input class="text-input" data-field="champion" maxlength="80" aria-label="${esc(label)} 챔피언" value="${esc(detail.champion || '')}" placeholder="미입력"></td>${statFields.map(([key, name, max]) => `<td><input class="text-input" type="number" inputmode="numeric" min="0" max="${max}" data-field="${key}" aria-label="${esc(label)} ${name}" value="${detail[key] ?? ''}" placeholder="—"></td>`).join('')}</tr>`;
      }).join('')}</tbody></table></div></section>`).join('')}</section>`;
    }).join('');
    $('addRecordSet').disabled = editDraft.games.length >= 7;
    invalidatePreview();
  }
  function readEditor(validateDraft = true) {
    const readNumber = value => validateDraft ? nullableNumber(value) : String(value).trim() === '' ? null : Number(value);
    const next = clone(editDraft);
    next.date = $('editMatchDate').value;
    next.bestOf = Number($('editBestOf').value);
    next.games.forEach((game, index) => {
      game.winner = Number(document.querySelector(`[data-winner="${index}"]`).value);
      game.durationSeconds = readNumber(document.querySelector(`[data-duration="${index}"]`).value);
      game.notes = document.querySelector(`[data-notes="${index}"]`).value.trim();
      game.players = [];
      const teams = [[], []];
      document.querySelectorAll(`[data-player-row][data-game="${index}"]`).forEach(row => {
        const playerId = row.querySelector('[data-field="id"]').value;
        teams[Number(row.dataset.team)].push({ id: playerId, role: row.dataset.role });
        const observedNickname = row.querySelector('[data-field="nicknameAtMatch"]').value;
        const details = { id: playerId, nicknameAtMatch: observedNickname.trim() ? observedNickname : null, champion: row.querySelector('[data-field="champion"]').value.trim() || null };
        statFields.forEach(([key]) => { details[key] = readNumber(row.querySelector(`[data-field="${key}"]`).value); });
        game.players.push(details);
      });
      const constraints = C.normalizeShuffleOptions(game.draw.constraints, next.roster);
      if (constraints.captainsLocked && teams.some((team, teamIndex) => !team.some(slot => slot.id === C.CAPTAINS[teamIndex]))) constraints.captainsLocked = false;
      constraints.separatePairs = constraints.separatePairs.filter(pair => !teams.some(team => pair.every(id => team.some(slot => slot.id === id))));
      game.draw.constraints = constraints;
      game.draw.teams = teams;
      game.draw.adjusted = true;
      if (validateDraft) game.draw.metrics = C.summarize(teams, next.roster, game.draw.constraints);
    });
    next.results = next.games.map(game => game.winner);
    next.draw = clone(next.games[next.games.length - 1].draw);
    next.status = validateDraft ? (C.seriesStatus(next.bestOf, next.results).complete ? 'completed' : 'stopped') : next.status;
    return next;
  }
  function scoreLabel(record) {
    if (!record) return '기록 없음';
    const score = C.seriesStatus(record.bestOf, record.results);
    return `${record.date} · BO${record.bestOf} · ${record.teamNames[0]} ${score.wins[0]} : ${score.wins[1]} ${record.teamNames[1]} · ${record.status === 'completed' ? '완료' : '중도종료'}`;
  }
  function changeDescription(before, after) {
    const changes = [];
    if (before.date !== after.date) changes.push(`경기일: ${before.date} → ${after.date}`);
    if (before.bestOf !== after.bestOf) changes.push(`경기 규칙: BO${before.bestOf} → BO${after.bestOf}`);
    if (before.results.length !== after.results.length) changes.push(`진행 세트: ${before.results.length} → ${after.results.length}`);
    after.games.forEach((game, index) => {
      const previous = before.games[index];
      if (!previous) changes.push(`${index + 1}세트 추가: ${after.teamNames[game.winner]} 승`);
      else {
        if (previous.winner !== game.winner) changes.push(`${index + 1}세트 승리: ${after.teamNames[previous.winner]} → ${after.teamNames[game.winner]}`);
        if (JSON.stringify(previous.draw.teams) !== JSON.stringify(game.draw.teams)) changes.push(`${index + 1}세트 팀 / 라인 배정 변경`);
        if (JSON.stringify(previous.draw.constraints) !== JSON.stringify(game.draw.constraints)) changes.push(`${index + 1}세트 실제 편성에 맞춰 팀장 고정 / 선수 분리 조건 해제`);
        if (JSON.stringify(previous.players.slice().sort((a,b) => a.id.localeCompare(b.id))) !== JSON.stringify(game.players.slice().sort((a,b) => a.id.localeCompare(b.id)))) changes.push(`${index + 1}세트 당시 닉네임 / 챔피언 / 개인 수치 변경`);
        if (previous.durationSeconds !== game.durationSeconds || previous.notes !== game.notes) changes.push(`${index + 1}세트 시간 / 메모 변경`);
      }
    });
    return changes;
  }
  function auditChanges(entry) {
    if (!entry.beforeRecord || !entry.afterRecord) return '';
    const before = H.cloneSnapshot(entry.beforeRecord);
    const after = H.cloneSnapshot(entry.afterRecord);
    const changes = changeDescription(before, after);
    const names = new Map(after.roster.map(player => [player.id, player.name]));
    const display = value => value === null || value === undefined || value === '' ? '미입력' : String(value);
    after.games.forEach((game, index) => {
      const previous = before.games[index];
      if (!previous) return;
      const oldSlots = new Map(previous.draw.teams.flatMap((team, teamIndex) => team.map(slot => [slot.id, `${before.teamNames[teamIndex]} ${roleName(slot.role)}`])));
      game.draw.teams.forEach((team, teamIndex) => team.forEach(slot => {
        const nextSlot = `${after.teamNames[teamIndex]} ${roleName(slot.role)}`;
        if (oldSlots.get(slot.id) !== nextSlot) changes.push(`${index + 1}세트 ${names.get(slot.id)} 배정: ${oldSlots.get(slot.id) || '없음'} → ${nextSlot}`);
      }));
      const oldStats = new Map(previous.players.map(player => [player.id, player]));
      game.players.forEach(player => {
        const old = oldStats.get(player.id);
        if (!old) return;
        [['nicknameAtMatch', '당시 닉네임'], ['champion', '챔피언'], ...statFields].forEach(([key, label]) => {
          if (old[key] !== player[key]) changes.push(`${index + 1}세트 ${names.get(player.id)} ${label}: ${display(old[key])} → ${display(player[key])}`);
        });
      });
    });
    return changes.length ? `<details class="audit-change-details"><summary>변경 상세 보기</summary><ul>${changes.map(change => `<li>${esc(change)}</li>`).join('')}</ul></details>` : '';
  }
  function openEditor(recordId) {
    if (!session.canEdit || !state || saving) { flash('기록 수정은 관리자만 가능합니다.'); return; }
    const original = state.history.find(item => item.id === recordId);
    if (!original) return;
    editDraft = H.cloneSnapshot(original);
    editBaseRevision = revision;
    $('editReason').value = '';
    $('recordEditError').textContent = '';
    renderEditor();
    $('recordEditDialog').showModal();
  }
  function reviewEditor() {
    try {
      if (!session.canEdit || !editDraft) throw new Error('관리자 권한을 확인해 주세요.');
      if (!$('recordEditForm').reportValidity()) return false;
      const draft = readEditor();
      if (!H.validateSnapshot(draft)) throw new Error('경기 규칙과 세트 결과, 라인업을 확인해 주세요. 각 세트는 선수 중복 없이 10명·팀별 5개 라인이 필요하며, 선승 이후 결과를 추가할 수 없습니다.');
      const next = H.cloneSnapshot(draft);
      const original = state.history.find(item => item.id === next.id);
      const changes = changeDescription(original, next);
      if (!changes.length) throw new Error('변경된 내용이 없습니다.');
      const reason = $('editReason').value.trim();
      if (!reason || reason.length > 300) throw new Error('변경 사유를 1~300자로 입력해 주세요.');
      editReviewed = { record: next, reason };
      $('recordPreview').innerHTML = `<h3>저장할 내용</h3><p>이전: ${esc(scoreLabel(original))}</p><p>변경: ${esc(scoreLabel(next))}</p><ul>${changes.map(change => `<li>${esc(change)}</li>`).join('')}</ul><p><strong>사유:</strong> ${esc(reason)}</p>${next.id === state.seriesId && next.status === 'stopped' ? '<p><strong>현재 시리즈가 중도종료 기록으로 바뀝니다.</strong> 수정 기록은 보관하고 매치 센터는 새 시리즈를 준비합니다.</p>' : ''}`;
      $('recordPreview').hidden = false;
      $('saveRecordEdit').disabled = false;
      $('saveRecordEdit').textContent = '검토한 내용 저장';
      $('recordEditError').textContent = '';
      return true;
    } catch (error) { invalidatePreview(); $('recordEditError').textContent = error.message; return false; }
  }
  function setSaveBusy(value) {
    saving = value;
    $('historyRefreshBtn').disabled = value;
    $('historyBackupBtn').disabled = value || backupBusy || loadStatus !== 'ready' || !state;
    for (const id of ['recordEditForm', 'restoreForm', 'deleteRecordForm']) {
      $(id).querySelectorAll('button,input,select').forEach(element => { element.disabled = value; });
    }
    if (!value) $('saveRecordEdit').disabled = !editReviewed;
  }
  async function persistRecord(record, expectedRevision, reason, errorId) {
    return persistChange(() => H.replaceSnapshot(state, record), expectedRevision, reason, errorId);
  }
  async function persistChange(buildState, expectedRevision, reason, errorId) {
    if (!session.canEdit || !state || saving) return false;
    setSaveBusy(true);
    try {
      const next = buildState();
      const result = await D.save(next, expectedRevision, reason);
      state = H.upgrade(result.state);
      revision = result.revision;
      loadStatus = 'ready';
      $('historyStorageStatus').textContent = '공용 경기 기록 · 변경 저장 완료';
      render();
      return true;
    } catch (error) {
      if ([401, 403, 409].includes(error.status)) {
        // Refetch before allowing another edit. The rejected draft is never merged
        // automatically into a newer state or written after permission was revoked.
        setSaveBusy(false);
        for (const id of ['recordEditDialog','restoreDialog','auditDialog','deleteRecordDialog']) if ($(id).open) $(id).close();
        await load();
        flash(error.status === 409 ? '다른 관리자가 먼저 변경했습니다. 내 수정은 저장되지 않았습니다. 최신 기록을 확인하고 다시 수정해 주세요.' : '관리자 권한을 다시 확인해 주세요. 수정 내용은 저장되지 않았습니다.');
      } else { $(errorId).textContent = `저장하지 못했습니다. ${error.message} 입력 내용은 창에 유지됩니다. 다시 저장하기 전 새로고침하면 서버의 최신 기록을 확인할 수 있습니다.`; }
      return false;
    } finally { setSaveBusy(false); }
  }
  async function openAudit(recordId) {
    if (!session.canEdit || saving) return;
    const requestId = ++auditRequest;
    auditEntries = [];
    $('auditList').innerHTML = '<p class="detail-empty">변경 이력을 불러오는 중입니다.</p>';
    $('auditError').textContent = '';
    $('auditDialog').showModal();
    try {
      const response = await D.listAudit(recordId);
      if (requestId !== auditRequest || !$('auditDialog').open) return;
      auditEntries = response.entries || [];
      $('auditList').innerHTML = auditEntries.length ? auditEntries.map((entry, index) => `<article class="audit-entry"><div class="audit-entry-top"><strong>${esc(entry.actorName || '관리자')}</strong><span>${esc(new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(entry.createdAt)))}</span></div><p class="audit-entry-reason">${esc(entry.reason || '경기 기록 저장')}</p><div class="audit-entry-change"><p>이전: ${esc(scoreLabel(entry.beforeRecord))}</p><p>변경: ${entry.afterRecord ? esc(scoreLabel(entry.afterRecord)) : '기록 삭제'}</p><p>현재: ${esc(scoreLabel(state?.history.find(record => record.id === entry.recordId)))}</p></div>${auditChanges(entry)}${entry.beforeRecord ? `<button type="button" class="btn" data-restore="${index}">${state?.history.some(record => record.id === entry.recordId) ? '이 변경 전으로 복구' : '삭제된 기록 복구'}</button>` : ''}</article>`).join('') : '<p class="detail-empty">아직 변경 이력이 없습니다. 이 기능 적용 이후 저장한 변경부터 표시됩니다.</p>';
    } catch (error) { if (requestId !== auditRequest || !$('auditDialog').open) return; $('auditList').innerHTML = ''; $('auditError').textContent = error.message; }
  }
  function openRestore(index) {
    if (!session.canEdit || !state || saving) return;
    const entry = auditEntries[index];
    if (!entry?.beforeRecord) return;
    restoreEntry = entry;
    restoreBaseRevision = revision;
    const current = state.history.find(record => record.id === entry.recordId);
    $('restorePreview').innerHTML = `<h3>복구할 기록 확인</h3><p>현재: ${esc(scoreLabel(current))}</p><p>복구: ${esc(scoreLabel(entry.beforeRecord))}</p><p>${current ? '해당 시점의 전체 라인업·챔피언·개인 수치도 함께 복구됩니다.' : '삭제된 경기와 전체 라인업·개인 수치를 복구합니다. 개인 성적에도 다시 반영됩니다.'}</p>`;
    $('restoreReason').value = '';
    $('restoreError').textContent = '';
    $('restoreDialog').showModal();
  }
  function openDelete(recordId) {
    if (!session.canEdit || !state || saving) return;
    const record = state.history.find(item => item.id === recordId);
    if (!record) { flash('삭제할 기록을 찾을 수 없습니다. 최신 기록을 확인해 주세요.'); return; }
    deleteRecordId = recordId;
    deleteBaseRevision = revision;
    $('deleteRecordPreview').innerHTML = `<h3>삭제할 경기</h3><p>${esc(scoreLabel(record))}</p><p>${record.results.length}개 세트와 해당 선수들의 개인 성적 집계에서 이 기록이 제외됩니다.</p>${record.id === state.seriesId ? '<p>매치 센터에 표시 중인 같은 시리즈도 비우고 새 시리즈를 준비합니다.</p>' : ''}<p>삭제 내역과 이전 기록은 변경 이력에 남으며 관리자가 복구할 수 있습니다.</p>`;
    $('deleteRecordReason').value = '';
    $('deleteRecordConfirm').checked = false;
    $('deleteRecordError').textContent = '';
    $('deleteRecordDialog').showModal();
  }

  $('historyMatches').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || saving) return;
    if (button.dataset.editRecord) openEditor(button.dataset.editRecord);
    if (button.dataset.audit) openAudit(button.dataset.audit);
    if (button.dataset.deleteRecord) openDelete(button.dataset.deleteRecord);
    if (button.dataset.share) {
      const match = state?.history.find(item => item.id === button.dataset.share);
      if (match) {
        try { globalThis.ResultCard.open(match); }
        catch (error) { flash(`결과 카드를 열지 못했습니다. ${error.message}`); }
      }
    }
  });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => {
    if (!saving) $(button.dataset.close).close();
  }));
  ['recordEditDialog', 'restoreDialog', 'deleteRecordDialog'].forEach(id => $(id).addEventListener('cancel', event => { if (saving) event.preventDefault(); }));
  $('historyAuditBtn').addEventListener('click', () => openAudit());
  $('deleteRecordForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!session.canEdit || !state || !deleteRecordId || saving || !$('deleteRecordDialog').open) return;
    const reason = $('deleteRecordReason').value.trim();
    if (!reason || reason.length > 300) { $('deleteRecordError').textContent = '삭제 사유를 1~300자로 입력해 주세요.'; return; }
    if (!$('deleteRecordConfirm').checked) { $('deleteRecordError').textContent = '삭제할 경기와 개인 성적 반영 내용을 확인해 주세요.'; return; }
    if (await persistChange(() => H.removeSnapshot(state, deleteRecordId), deleteBaseRevision, reason, 'deleteRecordError')) {
      $('deleteRecordDialog').close();
      deleteRecordId = null;
      flash('경기를 삭제하고 개인 성적에서 제외했습니다. 삭제 기록은 변경 이력에서 복구할 수 있습니다.');
    }
  });
  function rememberRowStats(row) {
    const values = { id: row.dataset.person };
    ['nicknameAtMatch', 'champion', ...statFields.map(field => field[0])].forEach(key => { values[key] = row.querySelector(`[data-field="${key}"]`).value; });
    editorStats[Number(row.dataset.game)].set(row.dataset.person, values);
  }
  $('recordEditForm').addEventListener('input', event => {
    invalidatePreview(); $('recordEditError').textContent = '';
    if (event.target.dataset.field && event.target.dataset.field !== 'id') rememberRowStats(event.target.closest('[data-player-row]'));
  });
  $('recordEditForm').addEventListener('change', event => {
    invalidatePreview();
    if (event.target.dataset.field === 'id') {
      // Remember unsaved values before moving a participant, including a swap
      // that temporarily selects the same participant in two slots.
      const row = event.target.closest('[data-player-row]');
      rememberRowStats(row);
      row.dataset.person = event.target.value;
      const previous = editorStats[Number(row.dataset.game)].get(event.target.value);
      ['nicknameAtMatch', 'champion', ...statFields.map(field => field[0])].forEach(key => { row.querySelector(`[data-field="${key}"]`).value = previous?.[key] ?? ''; });
    }
  });
  $('addRecordSet').addEventListener('click', () => {
    if (!session.canEdit || saving || !editDraft) return;
    try {
      const next = readEditor(false);
      if (next.games.length >= 7) return;
      const previous = next.games[next.games.length - 1];
      const game = clone(previous);
      game.winner = 0; game.durationSeconds = null; game.externalId = null; game.notes = '';
      game.players = game.players.map(player => ({ id: player.id, nicknameAtMatch: null, champion: null, ...Object.fromEntries(statFields.map(([key]) => [key, null])) }));
      next.games.push(game);
      editDraft = next;
      renderEditor();
      $('recordEditError').textContent = '';
    } catch (error) { $('recordEditError').textContent = error.message; }
  });
  $('editSets').addEventListener('click', event => {
    if (!event.target.closest('[data-remove-set]') || !session.canEdit || saving) return;
    try {
      const next = readEditor(false);
      if (next.games.length <= 1) return;
      next.games.pop();
      editDraft = next;
      renderEditor();
      $('recordEditError').textContent = '';
    } catch (error) { $('recordEditError').textContent = error.message; }
  });
  $('previewRecordEdit').addEventListener('click', reviewEditor);
  $('recordEditForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!editReviewed || saving || !session.canEdit) return;
    const { record, reason } = editReviewed;
    if (await persistRecord(record, editBaseRevision, reason, 'recordEditError')) {
      $('recordEditDialog').close();
      editReviewed = null;
      flash('기록을 수정했습니다. 변경 이력에 이전 기록과 사유를 함께 보관했습니다.');
    }
  });
  $('auditList').addEventListener('click', event => {
    const button = event.target.closest('[data-restore]');
    if (button) openRestore(Number(button.dataset.restore));
  });
  $('restoreForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!restoreEntry?.beforeRecord || saving || !session.canEdit || !$('restoreDialog').open) return;
    const reason = $('restoreReason').value.trim();
    if (!reason || reason.length > 300) { $('restoreError').textContent = '복구 사유를 1~300자로 입력해 주세요.'; return; }
    if (await persistRecord(restoreEntry.beforeRecord, restoreBaseRevision, reason, 'restoreError')) {
      $('restoreDialog').close();
      $('auditDialog').close();
      flash('선택한 이전 기록으로 복구했습니다. 복구 내역도 변경 이력에 저장했습니다.');
      restoreEntry = null;
    }
  });

  $('historyDate').addEventListener('change', event => { selectedDate = event.target.value; render(); });
  $('historyBackupBtn').addEventListener('click', async () => {
    if (backupBusy) return;
    backupBusy = true;
    $('historyBackupBtn').disabled = true;
    try {
      // Backups include the latest shared match and all archives, regardless of the filter.
      if (!(await load()) || !state) return;
      const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `진인프라_롤내전_전체백업_${date}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash('공용 매치와 전체 경기 기록을 백업했습니다.');
    } catch (error) { flash(`백업 파일을 만들지 못했습니다. ${error.message}`); }
    finally {
      backupBusy = false;
      $('historyBackupBtn').disabled = loadStatus !== 'ready' || state === null;
    }
  });
  $('historyRefreshBtn').addEventListener('click', load);
  window.addEventListener('pageshow', event => { if (event.persisted && !hasOpenDialog() && !saving) load(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !hasOpenDialog() && !saving) load(); });
  setInterval(() => { if (!document.hidden && !hasOpenDialog() && !saving) load(); }, 15000);
  load();
})();
