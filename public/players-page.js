'use strict';
(() => {
  const C = globalThis.LoLCore;
  const H = globalThis.LoLHistory;
  const S = globalThis.LoLPlayerStats;
  const V = globalThis.LoLPlayerVisuals;
  const D = globalThis.SiteData;
  const Demo = globalThis.LoLPlayerDemo;
  const Insights = globalThis.LoLPlayerInsights;
  // Optional presentation layer; every call is skipped when it is absent.
  const M = globalThis.LoLPlayerMotion || null;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const roleName = id => id === 'fill' ? '상관없음' : C.ROLES.find(role => role.id === id)?.label || '미입력';
  const roleShort = id => ({ top: 'TOP', jungle: 'JUNGLE', mid: 'MID', adc: 'ADC', support: 'SUPPORT', fill: 'ALL' }[id] || '미입력');
  const tierName = id => C.TIERS.find(tier => tier.id === id)?.label || '미입력';
  const number = (value, decimals = 0) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const percent = value => value == null ? '—' : `${number(value, 1)}%`;
  const kda = value => !value || value.games === 0 ? '—' : value.perfect ? 'Perfect' : number(value.ratio, 2);
  const rawKda = game => [game.kills, game.deaths, game.assists].map(value => number(value)).join(' / ');
  const avgKda = totals => [totals.averages.kills, totals.averages.deaths, totals.averages.assists].map(value => number(value, 1)).join(' / ');
  const duration = seconds => seconds == null ? '미입력' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const fullDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date.replaceAll('-', '.') : '날짜 미입력';
  const shortDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date.slice(5).replace('-', '.') : '날짜 미입력';
  const formatTime = iso => new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(iso));
  let state = null;
  let liveState = null;
  let demoState = null;
  let demoMode = false;
  let routeEpoch = 0;
  let pendingEpoch = -1;
  let selectedMetric = 'kda';
  let selectedGameKey = null;
  let selectedWindowStart;
  let selectedChampion = '';
  let explorerView = 'explore';
  let unbindInsights = null;
  let demoReturnFocus = null;
  let loadStatus = 'loading';
  let revision = -1;
  let pendingLoad = null;
  let selectedDate = 'all';
  let selectedPlayer = '';
  let searchText = '';
  let visibleGames = 20;
  let details = [];
  let selectedRole = '';
  let lastProfileKey = '';
  let replayTimer = null;
  let motionPreference = null;
  try { motionPreference = window.localStorage?.getItem('lol-player-motion'); } catch (_) { /* The page works when local preferences are unavailable. */ }
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const motionEnabled = () => motionPreference !== 'off' && !reducedMotion?.matches;
  function showMotionPreference() {
    const enabled = motionEnabled();
    $('playersMotionToggle').textContent = enabled ? '모션 켜짐' : '모션 꺼짐';
    $('playersMotionToggle').setAttribute('aria-pressed', String(enabled));
    $('playersMotionToggle').disabled = !!reducedMotion?.matches;
    $('playersMotionToggle').title = reducedMotion?.matches ? '기기의 동작 줄이기 설정에 따라 모션이 꺼져 있습니다.' : '개인 성적의 등장 애니메이션을 켜거나 끕니다.';
    if (document.documentElement) {
      document.documentElement.dataset.playerMotion = enabled ? 'on' : 'off';
      document.documentElement.classList[enabled ? 'remove' : 'add']('is-motion-off');
    }
    if (!enabled) {
      $('playerDetail').classList.remove('is-animated');
      $('playerDetail').querySelector('.pi-panel')?.classList.remove('is-animated');
      stopReplay();
    }
  }
  // Lets the stylesheet compact the page chrome while a profile is open, so the
  // player card is what a phone shows first.
  function markView() {
    if (document.documentElement?.dataset) document.documentElement.dataset.playerView = selectedPlayer ? 'profile' : 'directory';
  }

  function readRoute() {
    const params = new URLSearchParams(window.location.search);
    selectedDate = params.get('date') || 'all';
    selectedPlayer = params.get('player') || '';
    demoMode = params.get('demo') === '1' && selectedPlayer === Demo.PLAYER_ID;
    visibleGames = 20;
    selectedRole = '';
    selectedMetric = 'kda';
    selectedGameKey = null; selectedWindowStart = undefined; selectedChampion = ''; explorerView = 'explore';
  }
  function profileUrl(id = '', date = selectedDate) {
    const params = new URLSearchParams();
    if (id) params.set('player', id);
    if (demoMode && id === Demo.PLAYER_ID) params.set('demo', '1');
    if (date !== 'all') params.set('date', date);
    return './players.html' + (params.size ? `?${params.toString()}` : '');
  }
  function updateUrl() {
    const next = profileUrl(selectedPlayer);
    window.history.pushState(null, '', next);
  }
  function choosePlayer(id, shouldFocus = true) {
    if (demoMode) { switchDemo(false, id); return; }
    if (selectedPlayer !== id) { selectedRole = ''; selectedMetric = 'kda'; selectedGameKey = null; selectedWindowStart = undefined; selectedChampion = ''; explorerView = 'explore'; }
    selectedPlayer = id;
    visibleGames = 20;
    updateUrl();
    render();
    if (shouldFocus && id) {
      $('playerDetailHeading')?.focus({ preventScroll: true });
      $('playerProfile').scrollIntoView({ behavior: motionEnabled() ? 'smooth' : 'auto', block: 'start' });
    }
  }
  function showAccess(session) {
    const roles = { owner: '소유자', admin: '관리자', viewer: '보기 전용' };
    $('accessStrip').classList.remove('is-error');
    $('accessBadge').textContent = roles[session.role] || '보기 전용';
    $('accessBadge').dataset.role = session.role;
    $('accessIdentity').textContent = session.user ? session.user.email || session.user.name || '로그인한 계정' : '보기 전용으로 이용 중';
    $('accessMessage').textContent = session.canEdit ? '개인 성적은 자동 집계됩니다. 원본 경기의 수정·삭제는 대전 기록에서 할 수 있습니다.' : '저장된 경기에서 자동 집계한 개인 성적을 누구나 조회할 수 있습니다.';
    $('accessLogin').hidden = !!session.user;
    $('adminNav').hidden = !session.canManageAdmins;
  }
  function renderUnavailable() {
    $('playersDate').disabled = true;
    $('detailPlayer').disabled = true;
    $('playerSearch').disabled = true;
    $('filterSummary').textContent = '최신 개인 성적을 확인할 수 없습니다.';
    $('playerHistory').innerHTML = '<p class="profile-empty">연결 상태를 확인하고 새로고침해 주세요.</p>';
    $('playerDetail').innerHTML = '<div class="profile-empty"><h2 id="playerDetailHeading" tabindex="-1">개인 성적 연결 실패</h2><p>최신 개인 성적을 불러오지 못했습니다. 새로고침을 눌러 다시 시도해 주세요.</p></div>';
    $('playerDirectory').hidden = !!selectedPlayer;
    $('playerProfile').hidden = !selectedPlayer;
    $('directoryCount').textContent = '';
    markView();
  }
  function showMode() {
    $('playerDemoBanner').hidden = !demoMode;
    $('playersDemoEntry').hidden = demoMode;
    $('playerSourceNote').hidden = demoMode;
    $('matchHistoryLink').hidden = demoMode;
    $('playerDemoExit').href = './players.html?player=haeram';
    if (demoMode) {
      $('accessStrip').classList.remove('is-error');
      $('accessBadge').textContent = '가상 데이터';
      $('accessBadge').dataset.role = 'viewer';
      $('accessIdentity').textContent = '최해람 데모 · 읽기 전용';
      $('accessMessage').textContent = '24경기 샘플로 화면을 체험합니다. 실제 전적·팀 편성에는 반영되지 않습니다.';
      $('accessLogin').hidden = true;
      $('adminNav').hidden = true;
      $('playersRefreshBtn').hidden = true;
      $('playersError').hidden = true;
      $('playersStorageStatus').textContent = '가상 데이터 · 서버에 저장되지 않는 데모';
    } else {
      $('playersRefreshBtn').hidden = false;
    }
  }
  function closeDemoGame() {
    const dialog = $('demoGameDialog');
    if (dialog.open) dialog.close();
  }
  function loadDemo() {
    if (!demoState) demoState = Demo.createState();
    state = demoState;
    loadStatus = 'ready';
    showMode();
    render();
    return Promise.resolve(true);
  }
  function switchDemo(enabled, id = Demo.PLAYER_ID) {
    if (demoMode === enabled && selectedPlayer === id) return;
    routeEpoch += 1;
    demoMode = enabled;
    selectedPlayer = enabled ? Demo.PLAYER_ID : id;
    selectedDate = 'all';
    selectedRole = '';
    selectedMetric = 'kda';
    selectedGameKey = null; selectedWindowStart = undefined; selectedChampion = ''; explorerView = 'explore';
    visibleGames = 20;
    closeDemoGame();
    updateUrl();
    if (demoMode) { loadDemo(); $('playerDetailHeading')?.focus({ preventScroll: true }); }
    else {
      state = null;
      loadStatus = 'loading';
      showMode();
      renderLoading();
      $('playerDetailHeading')?.focus({ preventScroll: true });
      const transitionEpoch = routeEpoch;
      load().then(() => { if (!demoMode && routeEpoch === transitionEpoch) $('playerDetailHeading')?.focus({ preventScroll: true }); });
    }
  }
  function renderLoading() {
    $('playersDate').disabled = true;
    $('detailPlayer').disabled = true;
    $('playerSearch').disabled = true;
    $('playerDetail').innerHTML = '<div class="profile-empty"><h2 id="playerDetailHeading" tabindex="-1">실제 개인 성적을 불러오는 중입니다.</h2></div>';
    $('playerHistory').innerHTML = '<p class="profile-empty">실제 개인 성적을 불러오는 중입니다.</p>';
    $('playerDirectory').hidden = !!selectedPlayer;
    $('playerProfile').hidden = !selectedPlayer;
    $('accessIdentity').textContent = '실제 개인 성적을 불러오고 있습니다.';
    $('accessMessage').textContent = '저장된 대전 기록을 기준으로 집계합니다.';
    $('accessBadge').textContent = '확인 중';
    $('playersStorageStatus').textContent = '공용 개인 성적 · 연결 중';
    $('filterSummary').textContent = '실제 개인 성적을 불러오는 중입니다.';
    document.title = '개인 성적 · 융합본부 롤 내전';
    markView();
  }
  function load() {
    if (demoMode) return loadDemo();
    const epoch = routeEpoch;
    if (pendingLoad && pendingEpoch === epoch) return pendingLoad;
    pendingEpoch = epoch;
    $('playersRefreshBtn').disabled = true;
    pendingLoad = (async () => {
      try {
        const result = await D.load();
        if (demoMode || epoch !== routeEpoch) return false;
        if (result.state !== null && !H.validate(result.state)) throw new Error('서버의 경기 기록 형식을 확인할 수 없습니다. 관리자에게 확인을 요청해 주세요.');
        const changed = loadStatus !== 'ready' || result.revision !== revision;
        liveState = result.state === null ? null : H.upgrade(result.state);
        state = liveState;
        revision = result.revision;
        loadStatus = 'ready';
        showMode();
        showAccess(result.session);
        $('playersError').hidden = true;
        $('playersStorageStatus').textContent = `공용 개인 성적 · ${formatTime(new Date().toISOString())} 확인`;
        if (changed) render();
        return true;
      } catch (error) {
        if (demoMode || epoch !== routeEpoch) return false;
        state = null;
        liveState = null;
        details = [];
        loadStatus = 'error';
        $('playersError').textContent = `${error.message} 새로고침을 눌러 다시 불러올 수 있습니다.`;
        $('playersError').hidden = false;
        $('playersStorageStatus').textContent = '공용 성적 연결 실패';
        $('accessStrip').classList.add('is-error');
        $('accessBadge').textContent = '연결 확인';
        delete $('accessBadge').dataset.role;
        $('accessIdentity').textContent = '최신 개인 성적을 확인하지 못했습니다.';
        $('accessMessage').textContent = '네트워크와 로그인 상태를 확인한 후 다시 불러와 주세요.';
        $('adminNav').hidden = true;
        $('accessLogin').hidden = error.status !== 401;
        renderUnavailable();
        return false;
      } finally {
        if (pendingEpoch === epoch) {
          pendingLoad = null;
          $('playersRefreshBtn').disabled = false;
        }
      }
    })();
    return pendingLoad;
  }
  function render() {
    if (loadStatus !== 'ready') return;
    const allGames = S.selectGames(state);
    const dates = [...new Set(allGames.map(game => game.date).filter(Boolean))].sort().reverse();
    // An old shared date link may have no remaining games after a deletion. Keep the filter honest.
    if (selectedDate !== 'all' && !dates.includes(selectedDate)) dates.push(selectedDate);
    $('playersDate').innerHTML = '<option value="all">전체 경기일</option>' + dates.map(date => `<option value="${esc(date)}">${esc(fullDate(date))}</option>`).join('');
    $('playersDate').value = selectedDate;
    $('playersDate').disabled = !dates.length;
    const options = selectedDate === 'all' ? {} : { date: selectedDate };
    details = S.selectPlayers(state, options).filter(detail => !demoMode || detail.profile.id === Demo.PLAYER_ID);
    $('detailPlayer').innerHTML = '<option value="">전체 선수</option>' + details.map(detail => `<option value="${esc(detail.profile.id)}">${esc(detail.profile.name)}${detail.profile.registered ? '' : ' · 이전 선수'}</option>`).join('');
    if (selectedPlayer && !details.some(detail => detail.profile.id === selectedPlayer)) $('detailPlayer').innerHTML += `<option value="${esc(selectedPlayer)}">찾을 수 없는 선수</option>`;
    $('detailPlayer').value = selectedPlayer;
    $('detailPlayer').disabled = demoMode || !details.length;
    $('playerSearch').disabled = false;
    $('filterSummary').textContent = `${demoMode ? '가상 데이터 · ' : ''}${selectedDate === 'all' ? '전체 경기일' : fullDate(selectedDate)} · ${details.length}명 · 세트 단위 집계`;
    $('matchHistoryLink').href = selectedDate === 'all' ? './history.html' : `./history.html?date=${encodeURIComponent(selectedDate)}`;
    $('allPlayersLink').href = profileUrl();
    $('allPlayersLink').hidden = demoMode || !selectedPlayer;
    $('accessLogin').href = `/signin-with-chatgpt?return_to=${encodeURIComponent(profileUrl(selectedPlayer).replace('./', '/'))}`;
    $('playerDirectory').hidden = !!selectedPlayer;
    $('playerProfile').hidden = !selectedPlayer;
    markView();
    renderDirectory();
    if (selectedPlayer) renderProfile(S.selectPlayer(state, selectedPlayer, options));
    else { stopReplay(false); document.title = '개인 성적 · 융합본부 롤 내전'; lastProfileKey = ''; }
  }
  function directoryForm(form) {
    if (!form.games) return '<span class="directory-form-empty">첫 기록을 기다리는 중</span>';
    const label = `최근 ${form.games}경기, 최신순: ${form.results.map(won => won ? '승리' : '패배').join(', ')}`;
    return `<span class="directory-form" role="img" aria-label="${esc(label)}"><small aria-hidden="true">RECENT</small>${form.results.map(won => `<i class="${won ? 'form-win' : 'form-loss'}" aria-hidden="true">${won ? 'W' : 'L'}</i>`).join('')}</span>`;
  }
  function renderDirectory() {
    const query = searchText.trim().toLocaleLowerCase('ko-KR');
    const list = details.filter(({ profile }) => [profile.name, profile.currentNickname, ...(profile.nicknameAliases || [])].some(value => value?.toLocaleLowerCase('ko-KR').includes(query)));
    $('playerHistory').innerHTML = list.length ? list.map(({ profile, totals, form }) => `<a class="directory-row" data-player="${esc(profile.id)}" href="${esc(profileUrl(profile.id))}"><span class="directory-person"><span class="directory-role-mark" aria-hidden="true">${esc(roleShort(profile.primary))}</span><strong>${esc(profile.name)} <span aria-hidden="true">↗</span></strong>${profile.currentNickname ? `<span class="directory-nickname">${esc(profile.currentNickname)}</span>` : ''}<small>${esc(tierName(profile.tier))} · ${esc(roleShort(profile.primary))}${profile.registered ? '' : ' · 이전 선수'}</small>${directoryForm(form)}</span><span><small class="mobile-label">경기</small><b>${number(totals.games)}</b></span><span><small class="mobile-label">승 / 패</small><b>${number(totals.wins)}승 ${number(totals.losses)}패</b></span><span class="directory-rate"><small class="mobile-label">승률</small><b>${percent(totals.winRate)}</b><span class="directory-rate-track" aria-hidden="true">${totals.winRate == null ? '' : `<i style="width:${Math.min(100, Math.max(0, totals.winRate))}%"></i>`}</span></span><span><small class="mobile-label">KDA</small><b>${kda(totals.kda)}</b></span></a>`).join('') : `<p class="profile-empty">${searchText ? '일치하는 선수가 없습니다. 실명 또는 닉네임을 다시 확인해 주세요.' : '등록된 선수가 없습니다.'}</p>`;
    $('directoryCount').textContent = `${list.length}명 표시 · 이름을 선택하면 개인 성적으로 이동합니다.`;
  }
  function metric(label, value, note, className = '') {
    return `<div class="profile-metric ${className}"><dt>${label}</dt><dd>${value}</dd><small>${note}</small></div>`;
  }
  function samples(totals) {
    return `K ${totals.samples.kills} · D ${totals.samples.deaths} · A ${totals.samples.assists}경기`;
  }
  function matchLink(game) {
    if (demoMode) return '#demoGameDialog';
    return game.archived ? `./history.html?date=${encodeURIComponent(game.date)}&record=${encodeURIComponent(game.seriesId)}&game=${game.setNumber}#record-${encodeURIComponent(game.seriesId)}` : './index.html';
  }
  function recentRows(recent, fullRecent = recent) {
    return recent.slice(0, visibleGames).map((game, index) => `<li><a class="recent-game ${game.won ? 'is-win' : 'is-loss'}" href="${esc(matchLink(game))}"${demoMode ? ` data-demo-game="${fullRecent.findIndex(source => gameKey(source) === gameKey(game))}" aria-haspopup="dialog"` : ''}><div class="recent-result"><b>${game.won ? '승리' : '패배'}</b><span>${esc(fullDate(game.date))}</span><small>${game.setNumber}세트${demoMode ? ' · 가상 경기' : game.archived ? '' : ' · 진행 중'}</small></div><div class="recent-champion"><strong>${esc(game.champion || '챔피언 미입력')}</strong><span>${esc(roleShort(game.position))} · ${esc(game.teamName)}</span>${game.nicknameAtMatch ? `<span class="recent-nickname">당시 닉네임 · ${esc(game.nicknameAtMatch)}</span>` : ''}</div><div class="recent-combat"><strong>${rawKda(game)}</strong><span>KDA ${kda(game.kda)}</span></div><div class="recent-farm"><strong>CS ${number(game.cs)}</strong><span>경기 시간 ${duration(game.durationSeconds)}</span></div><span class="recent-arrow" aria-hidden="true">↗</span><span class="sr-only">${demoMode ? '가상 경기 상세' : game.archived ? '대전 기록' : '현재 매치'} 보기</span></a></li>`).join('');
  }
  function breakdownRows(items, type) {
    return items.map(item => `<div class="breakdown-row"><div class="breakdown-identity"><strong>${esc(type === 'position' ? roleShort(item.id) : item.name)}</strong><small>${item.games}경기 · ${item.wins}승 ${item.losses}패</small></div><div><span>승률</span><b>${percent(item.winRate)}</b></div><div><span>KDA</span><b>${kda(item.kda)}</b><small>${item.kda.games}경기 수집</small></div><div class="breakdown-averages"><span>평균 K / D / A</span><b>${avgKda(item)}</b><small>${samples(item)}</small></div>${type === 'position' ? `<div><span>평균 CS</span><b>${number(item.averages.cs, 1)}</b><small>${item.samples.cs}경기 수집</small></div><div><span>CS/min</span><b>${number(item.csPerMinute, 1)}</b><small>${item.csPerMinuteGames}경기 수집</small></div>` : ''}</div>`).join('');
  }
  function renderProfile(detail) {
    unbindInsights?.();
    unbindInsights = null;
    if (!detail) {
      $('playerDetail').classList.remove('is-animated');
      document.title = '선수를 찾을 수 없음 · 융합본부 롤 내전';
      $('playerDetail').innerHTML = `<div class="profile-empty"><h2 id="playerDetailHeading" tabindex="-1">선수를 찾을 수 없습니다.</h2><p>이 링크의 선수 ID는 현재 명단과 경기 기록에 없습니다.</p><a class="btn" href="${esc(profileUrl())}" data-player="">전체 선수 보기</a></div>`;
      return;
    }
    const { profile, totals } = detail;
    const profileKey = `${demoMode ? 'demo' : 'live'}:${selectedPlayer}:${selectedDate}`;
    const sameProfile = lastProfileKey === profileKey;
    const openPanels = sameProfile ? new Set([...$('playerDetail').querySelectorAll('details[data-profile-panel][open]')].map(panel => panel.dataset.profilePanel)) : new Set();
    const panelAttribute = key => `data-profile-panel="${key}"${openPanels.has(key) ? ' open' : ''}`;
    const focusSelector = sameProfile ? focusedControl() : null;
    const animate = !sameProfile && motionEnabled();
    // Numbers and bars glide from what was on screen when only the scope changes.
    const before = sameProfile && M && motionEnabled() ? M.snapshot($('playerDetail')) : null;
    if (!sameProfile) stopReplay(false);
    lastProfileKey = profileKey;
    $('playerDetail').classList.remove('is-animated');
    if (animate) $('playerDetail').classList.add('is-animated');
    document.title = `${demoMode ? '가상 데이터 · ' : ''}${profile.name} · 개인 성적 · 융합본부 롤 내전`;
    const seconds = Array.isArray(profile.secondary) ? profile.secondary.map(roleName).join(' / ') : '';
    const profileHead = `<div class="player-stage" data-ripple-scope>${heroWatermark(detail)}<header class="profile-heading"><div><div class="eyebrow">${demoMode ? 'DEMO PLAYER PROFILE · 가상 데이터' : 'PLAYER PROFILE'}${profile.registered ? '' : ' · 이전 선수'}</div><h2 id="playerDetailHeading" tabindex="-1">${esc(profile.name)}</h2>${profile.currentNickname ? `<p class="profile-nickname"><span>현재 닉네임</span><strong>${esc(profile.currentNickname)}</strong></p>` : ''}${profile.nicknameAliases?.length ? `<details class="profile-aliases" ${panelAttribute('aliases')}><summary>이전 닉네임 ${profile.nicknameAliases.length}개</summary><ul>${profile.nicknameAliases.map(alias => `<li>${esc(alias)}</li>`).join('')}</ul></details>` : ''}<p><span class="tier-badge tier-${esc(profile.tier)}">${esc(tierName(profile.tier))}</span><span>주 <b>${esc(roleName(profile.primary))}</b></span><span>부 <b>${esc(seconds || '없음')}</b></span>${profile.excluded?.length ? `<span>제외 ${esc(profile.excluded.map(roleName).join(' / '))}</span>` : ''}</p></div><div class="profile-scope">${demoMode ? '가상 성적 · ' : ''}${selectedDate === 'all' ? '누적 내전 성적' : esc(fullDate(selectedDate))}<small>${detail.seriesCount}시리즈 · ${demoMode ? '샘플 경기' : '실제 플레이 세트'} 기준<br>라인·챔피언 필터 적용 전</small><button type="button" class="pe-jump" data-explorer-jump>내 플레이 탐색하기 <span aria-hidden="true">↓</span></button></div></header><div class="player-stage-overview">${V.renderOverview(detail)}</div>${heroStrip(detail)}</div>`;
    const summary = `<dl class="profile-totals">${metric('KDA', countedKda(totals.kda, 'total-kda'), `K/D/A 모두 수집된 ${totals.kda.games}경기`)}${metric('평균 K / D / A', avgKda(totals), samples(totals), 'kda-metric')}${metric('평균 CS', V.counted('total-cs', totals.averages.cs, 1), `CS가 수집된 ${totals.samples.cs}경기`)}${metric('CS/min', V.counted('total-cspm', totals.csPerMinute, 1), `CS·시간이 모두 있는 ${totals.csPerMinuteGames}경기`)}</dl>`;
    const empty = totals.games ? '' : `<div class="profile-empty"><h3>${selectedDate === 'all' ? '아직 기록된 내전이 없습니다.' : '선택한 경기일에 기록된 내전이 없습니다.'}</h3><p>경기 기록이 등록되면 개인 성적이 자동으로 집계됩니다.</p></div>`;
    const notes = `<details class="profile-method" ${panelAttribute('method')}><summary>통계 계산 기준</summary><p>1경기는 시리즈 전체가 아닌 1세트를 뜻합니다. KDA는 K/D/A가 모두 기록된 경기의 (총 Kill + 총 Assist) ÷ 총 Death이며, Death 합계가 0이면 Perfect로 표시합니다. 평균 K/D/A와 평균 CS는 각 항목이 수집된 경기만 계산하므로 수집 경기 수가 서로 다를 수 있습니다.</p><p>CS/min은 CS와 경기 시간이 모두 기록된 경기의 총 CS ÷ 총 경기 시간(분)입니다. 알 수 없는 값은 ‘—’로 표시합니다. 경기 기록을 수정하거나 삭제하면 다음 새로고침에 다시 집계됩니다.</p>${totals.seriesWins == null ? '' : `<p>현재 경기일 전체 기준 · 완료 시리즈 ${totals.seriesWins}승 ${totals.seriesLosses}패 · 시리즈 내 팀 이동 ${totals.mixedSeries}회. 팀을 옮긴 시리즈는 세트 승패만 집계합니다.</p>`}</details>`;
    $('playerDetail').innerHTML = profileHead + summary + empty + renderExplorer(detail, panelAttribute, notes, animate);
    mountInsights();
    if (M && (animate || before)) M.play($('playerDetail'), animate ? null : before, { enabled: motionEnabled() });
    if (focusSelector) focusControl($('playerDetail'), focusSelector);
  }
  const FLAME = '<svg class="ps-flame" viewBox="0 0 24 24" aria-hidden="true"><path class="ps-flame-outer" d="M12 1.5c.7 3.6 6.2 6.3 6.2 12A6.2 6.2 0 0 1 12 19.7a6.2 6.2 0 0 1-6.2-6.2c0-2.9 1.5-4.8 3-6.2.1 2.1 1 3.6 2.4 4.4-.4-4.3.1-7.6.8-10.2Z"/><path class="ps-flame-inner" d="M12 10.2c.4 2 3.1 3.4 3.1 6.2a3.1 3.1 0 0 1-6.2 0c0-1.4.7-2.4 1.4-3.2.1 1 .6 1.7 1.1 2-.1-1.9.2-3.5.6-5Z"/></svg>';
  const TROPHY = '<svg class="ps-trophy" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v4a5 5 0 0 1-10 0Z"/><path d="M7 5H3.5c0 3 1.6 4.6 3.8 4.9M17 5h3.5c0 3-1.6 4.6-3.8 4.9M12 12v5m-4 4h8m-6.5-4h5l.8 4H8.7Z"/></svg>';
  function streakBadge(form) {
    const count = form?.streak?.count || 0;
    if (!count) return '';
    const won = form.streak.won === true;
    return `<span class="ps-streak ps-streak-${won ? 'win' : 'loss'}">${won ? FLAME : ''}<span>현재 <strong>${count}${won ? '연승' : '연패'}</strong>${won && count >= 3 ? ' 중' : ''}</span></span>`;
  }
  function heroWatermark(detail) {
    const top = detail.positions.filter(item => item.games > 0).sort((a, b) => b.games - a.games || b.wins - a.wins)[0];
    const role = top?.id || (C.ROLES.some(item => item.id === detail.profile.primary) ? detail.profile.primary : '');
    return role ? `<span class="ps-watermark" aria-hidden="true">${esc(roleShort(role))}</span>` : '';
  }
  // Recent results as cards and three source facts, each of which jumps into the
  // explorer with a matching scope or game. None of them is a rating.
  function heroStrip(detail) {
    const recent = detail.recent.slice(0, 5), total = detail.totals.games;
    const form = recent.length ? `<div class="ps-form"><div class="ps-strip-head"><span class="ps-kicker">RECENT ${recent.length}</span>${streakBadge(detail.form)}<small>왼쪽이 최신 · 눌러서 그 경기 보기</small></div><ol class="ps-form-cards">${recent.map((game, index) => `<li style="--i:${index}"><button type="button" class="ps-form-card ${game.won ? 'is-win' : 'is-loss'}" data-hero-game="${esc(encodeURIComponent(gameKey(game)))}" aria-label="${esc(`${index === 0 ? '가장 최근 경기, ' : ''}${fullDate(game.date)} ${game.setNumber}세트, ${game.won ? '승리' : '패배'}, ${game.champion || '챔피언 미입력'}. 그래프에서 이 경기 보기`)}"><b>${game.won ? 'W' : 'L'}</b>${Insights.championToken(game.champion, 'pt-token-sm')}<small>${esc(game.champion || '미입력')}</small></button></li>`).join('')}</ol></div>` : '<div class="ps-form ps-form-empty"><div class="ps-strip-head"><span class="ps-kicker">RECENT FORM</span></div><p>첫 경기가 등록되면 최근 승패 카드가 이곳에 펼쳐집니다.</p></div>';
    if (!total) return `<div class="ps-strip">${form}</div>`;
    const position = detail.positions.filter(item => item.games > 0).sort((a, b) => b.games - a.games || b.wins - a.wins)[0];
    const champion = detail.champions[0];
    const best = Insights.buildModel(detail).highlightGames.maxKills;
    const facts = [];
    if (position) facts.push(`<button type="button" class="ps-fact" data-hero-filter="role:${esc(position.id)}" data-tilt aria-label="${esc(`주 무대 ${roleName(position.id)}, ${position.games}경기. 이 라인으로 탐색`)}"><span class="ps-fact-icon ps-fact-role" aria-hidden="true">${esc(({ jungle: 'JGL', support: 'SUP' })[position.id] || roleShort(position.id))}</span><span class="ps-fact-kicker">주 무대</span><strong>${esc(roleShort(position.id))}</strong><small>${position.games}경기 · 전체의 ${percent(position.games / total * 100)}</small><i class="ps-fact-go" aria-hidden="true">이 라인만 보기 →</i></button>`);
    if (champion) facts.push(`<button type="button" class="ps-fact" data-hero-filter="champion:${esc(encodeURIComponent(champion.id))}" data-tilt aria-label="${esc(`최다 픽 ${champion.name}, ${champion.games}경기. 이 챔피언으로 탐색`)}">${Insights.championToken(champion.name, 'ps-fact-icon')}<span class="ps-fact-kicker">최다 픽</span><strong>${esc(champion.name)}</strong><small>${champion.games}경기 · ${champion.wins}승 ${champion.losses}패</small><i class="ps-fact-go" aria-hidden="true">이 챔피언만 보기 →</i></button>`);
    if (best) facts.push(`<button type="button" class="ps-fact ps-fact-gold" data-hero-game="${esc(encodeURIComponent(gameKey(best)))}" data-tilt aria-label="${esc(`한 판 최다 킬 ${best.kills}, ${fullDate(best.date)} ${best.champion || '챔피언 미입력'} 경기 보기`)}"><span class="ps-fact-icon" aria-hidden="true">${TROPHY}</span><span class="ps-fact-kicker">한 판 최다 킬</span><strong>${V.counted('hero-best-kills', best.kills)}<em>킬</em></strong><small>${esc(shortDate(best.date))} ·${esc(best.champion || '챔피언 미입력')}</small><i class="ps-fact-go" aria-hidden="true">그 경기 보기 →</i></button>`);
    return `<div class="ps-strip">${form}<div class="ps-facts" role="group" aria-label="대표 기록에서 바로 탐색">${facts.join('')}</div></div>`;
  }
  function countedKda(value, key) {
    return value && value.games && !value.perfect ? V.counted(key, value.ratio, 2) : kda(value);
  }
  function gameKey(game) {
    return Insights.gameKey ? Insights.gameKey(game) : JSON.stringify([game.seriesId, game.gameId || `set:${game.setNumber}`]);
  }
  function championKey(value) { return String(value || '').trim().toLocaleLowerCase('en-US'); }
  function focusControl(container, selector) {
    if (!container || !selector) return;
    const visible = [...container.querySelectorAll(selector)].find(element => element.getClientRects?.().length);
    (visible || container.querySelector(selector))?.focus({ preventScroll: true });
  }
  function focusedControl() {
    const element = document.activeElement;
    for (const [attribute, property] of [['insight-replay', 'insightReplay'], ['insight-metric', 'insightMetric'], ['insight-key', 'insightKey'], ['insight-game', 'insightGame'], ['insight-range', 'insightRange'], ['visual-role', 'visualRole'], ['explorer-champion', 'explorerChampion'], ['explorer-view', 'explorerView'], ['explorer-all-roles', 'explorerAllRoles'], ['explorer-reset', 'explorerReset'], ['explorer-clear', 'explorerClear']]) {
      if (element?.dataset?.[property] != null) return `[data-${attribute}="${element.dataset[property]}"]`;
    }
    return null;
  }
  function scopedDetail(detail) {
    const recent = detail.recent.filter(game => (!selectedRole || game.position === selectedRole) && (!selectedChampion || championKey(game.champion) === selectedChampion));
    const teammateNames = new Map((detail.teammates || []).map(person => [person.id, person.name]));
    const teammates = [...new Set(recent.flatMap(game => game.teammates || []))].map(id => {
      const totals = S.aggregateStats(recent.filter(game => game.teammates?.includes(id)));
      return { id, name: teammateNames.get(id) || id, games: totals.games, wins: totals.wins, losses: totals.losses, winRate: totals.winRate };
    }).sort((a, b) => b.games - a.games || b.wins - a.wins || a.name.localeCompare(b.name, 'ko'));
    return { ...detail, recent, totals: S.aggregateStats(recent), positions: S.aggregateByPosition(recent), champions: S.aggregateByChampion(recent), form: S.getRecentForm(recent), seriesCount: new Set(recent.map(game => game.seriesId)).size, teammates, missing: { position: recent.filter(game => !game.position).length, champion: recent.filter(game => !game.champion).length } };
  }
  function insightModel(detail) {
    const model = Insights.buildModel(detail, selectedMetric, { selectedKey: selectedGameKey, windowStart: selectedWindowStart });
    const selected = model.selectedKey || (model.games.length ? gameKey(model.games[Insights.selectedIndex(model)]) : null);
    selectedGameKey = selected;
    selectedWindowStart = model.windowStart;
    return model;
  }
  function insightAction(detail) {
    const game = detail.recent.find(row => gameKey(row) === selectedGameKey);
    if (!game) return '';
    const index = selectedDetail()?.recent.findIndex(row => gameKey(row) === selectedGameKey);
    return `<a class="pe-game-link" href="${esc(matchLink(game))}"${demoMode ? ` data-demo-game="${index}" aria-haspopup="dialog"` : ''}>${demoMode ? '선택한 가상 경기 상세' : '선택한 경기 기록'} <span aria-hidden="true">↗</span></a>`;
  }
  function mountInsights() {
    unbindInsights?.();
    unbindInsights = null;
    const container = $('playerInsights');
    if (container && Insights.bind) unbindInsights = Insights.bind(container, { onSelect(key, selection = {}) {
      stopReplay(false);
      selectedGameKey = key;
      selectedWindowStart = selection.windowStart;
      updateInsights();
    } });
  }
  function updateInsights(focusSelector = focusedControl(), options = {}) {
    const original = selectedDetail();
    if (!original) return;
    const scoped = scopedDetail(original);
    insightModel(scoped);
    const container = $('playerInsights');
    if (!container) return;
    const motion = motionEnabled();
    const before = motion && Insights.snapshot ? Insights.snapshot(container) : null;
    $('playerDetail').classList.remove('is-animated');
    unbindInsights?.();
    unbindInsights = null;
    container.innerHTML = Insights.render(scoped, { metric: selectedMetric, selectedKey: selectedGameKey, windowStart: selectedWindowStart, fresh: motion, replaying: replayTimer !== null });
    $('playerInsightsAction').innerHTML = insightAction(scoped);
    mountInsights();
    Insights.morph?.(container, before, { enabled: motion, duration: options.duration });
    if (options.celebrate && M) {
      const card = container.querySelector?.('.pi-selection');
      if (card && (options.celebrate === 'always' || card.querySelector?.('.pi-badge'))) M.burst(card, { enabled: motion, tone: 'gold' });
    }
    if (focusSelector) focusControl(container, focusSelector);
  }
  // A user-started walk through every game in scope, oldest to newest. Any other
  // interaction, a route change, or turning motion off stops it.
  function stopReplay(rerender = true) {
    if (replayTimer === null) return false;
    clearTimeout(replayTimer);
    replayTimer = null;
    if (rerender && loadStatus === 'ready' && selectedPlayer) updateInsights();
    return true;
  }
  function startReplay() {
    const original = selectedDetail();
    if (!original || !motionEnabled()) return;
    const games = Insights.buildModel(scopedDetail(original), selectedMetric).allGames;
    if (games.length < 2) return;
    const keys = games.map(gameKey);
    const delay = Math.max(170, Math.min(460, Math.round(9000 / keys.length)));
    let index = 0;
    const tick = () => {
      selectedGameKey = keys[index];
      selectedWindowStart = undefined;
      index += 1;
      replayTimer = index < keys.length ? setTimeout(tick, delay) : null;
      // setTimeout may be unavailable (or a stub) outside a browser.
      if (replayTimer === undefined) replayTimer = null;
      updateInsights(focusedControl(), { duration: Math.min(320, delay - 40), celebrate: true });
    };
    tick();
  }
  function comparison(value, baseline, unit, digits) {
    if (!selectedRole && !selectedChampion) return '<small class="pe-comparison-neutral">현재 경기일의 전체 성적</small>';
    if (value == null || baseline == null) return '<small class="pe-comparison-neutral">수치형 데이터가 없어 차이 미표시</small>';
    const delta = value - baseline;
    return `<small class="pe-comparison-${delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral'}">전체 대비 ${delta > 0 ? '+' : ''}${number(delta, digits)}${unit}</small>`;
  }
  function renderExplorer(detail, panelAttribute, notes, animate) {
    const scoped = scopedDetail(detail), totals = scoped.totals;
    insightModel(scoped);
    const champion = detail.champions.find(item => item.id === selectedChampion);
    const scopeLabel = [selectedRole ? roleShort(selectedRole) : '모든 라인', selectedChampion ? champion?.name || selectedChampion : '모든 챔피언'].join(' · ');
    const filters = `<aside class="pe-filters" aria-label="플레이 탐색 범위"><div class="pe-filter-heading"><h4>어느 라인에서?</h4><button class="pe-all-button" type="button" data-explorer-all-roles="" aria-pressed="${!selectedRole}">전체 라인</button></div><div id="playerPositionVisual">${V.renderPositions(detail, selectedRole, { allowAll: true })}</div><div class="pe-role-strip" role="group" aria-label="라인 필터">${detail.positions.map(item => `<button type="button" data-visual-role="${item.id}" aria-pressed="${selectedRole === item.id}" aria-label="${esc(roleName(item.id))} 필터, ${item.games}경기"><b>${esc(({ jungle: 'JGL', support: 'SUP' })[item.id] || roleShort(item.id))}</b><small>${item.games}경기</small></button>`).join('')}</div><div class="pe-filter-heading"><h4>어떤 챔피언으로?</h4><span>${detail.champions.length}종</span></div><div class="pe-champion-pool" role="group" aria-label="챔피언 필터"><button type="button" data-explorer-champion="" aria-pressed="${!selectedChampion}"><span>전체 챔피언</span><small>${detail.totals.games}경기</small></button>${detail.champions.map(item => `<button type="button" data-explorer-champion="${esc(encodeURIComponent(item.id))}" aria-pressed="${selectedChampion === item.id}" data-tilt class="pe-champion-card">${Insights.championToken(item.name)}<span>${esc(item.name)}</span><small>${item.games}경기<span class="sr-only"> · ${item.wins}승 ${item.losses}패</span></small><i class="pe-champion-meter" aria-hidden="true"><i data-bar-key="champion-${esc(encodeURIComponent(item.id))}" style="--bar:${item.games ? Number((item.wins / item.games * 100).toFixed(1)) : 0}%"></i></i></button>`).join('')}</div><p class="pe-filter-note">실제로 플레이한 라인·챔피언으로 아래 성적을 좁힙니다.</p></aside>`;
    const winShare = totals.games ? Number((totals.wins / totals.games * 100).toFixed(1)) : 0;
    const totalsMarkup = `<dl class="pe-scope-stats"><div data-count-flash><dt>선택 범위</dt><dd>${V.counted('scope-games', totals.games)}<small>경기</small></dd><small>${totals.wins}승 ${totals.losses}패 · 전체 ${detail.totals.games}경기 중</small><span class="pe-scope-meter" aria-hidden="true"><i class="pe-scope-meter-win" data-bar-key="scope-win" style="--bar:${winShare}%"></i></span></div><div data-count-flash><dt>승률</dt><dd>${totals.winRate == null ? percent(totals.winRate) : V.counted('scope-rate', totals.winRate, 1, '%')}</dd>${comparison(totals.winRate, detail.totals.winRate, '%p', 1)}<small>선택 ${totals.games} / 전체 ${detail.totals.games}경기</small></div><div data-count-flash><dt>KDA</dt><dd>${countedKda(totals.kda, 'scope-kda')}</dd>${(selectedRole || selectedChampion) && (totals.kda.perfect || detail.totals.kda.perfect) ? '<small class="pe-comparison-neutral">Perfect KDA는 수치 차이 미표시</small>' : comparison(totals.kda.ratio, detail.totals.kda.ratio, '', 2)}<small>K/D/A 수집 ${totals.kda.games} / 전체 ${detail.totals.kda.games}경기</small></div><div data-count-flash><dt>CS / 분</dt><dd>${V.counted('scope-cspm', totals.csPerMinute, 1)}</dd><small>CS·시간 수집 ${totals.csPerMinuteGames}경기</small></div></dl>`;
    const chips = `<div class="pe-scope-chips">${selectedRole ? `<button type="button" data-explorer-clear="role">${esc(roleShort(selectedRole))} <span aria-hidden="true">×</span><span class="sr-only"> 필터 해제</span></button>` : ''}${selectedChampion ? `<button type="button" data-explorer-clear="champion">${esc(champion?.name || selectedChampion)} <span aria-hidden="true">×</span><span class="sr-only"> 필터 해제</span></button>` : ''}</div>`;
    const empty = !totals.games && (selectedRole || selectedChampion) ? '<div class="pe-empty"><strong>이 조합의 경기가 없습니다.</strong><p>다른 라인이나 챔피언을 선택해 보세요.</p><button class="btn" type="button" data-explorer-reset="">전체 경기로 돌아가기</button></div>' : '';
    const exploration = `<section class="pe-view pe-explore-view"${explorerView === 'explore' ? '' : ' hidden'} aria-label="선택 범위 그래프"><div id="playerInsights">${Insights.render(scoped, { metric: selectedMetric, selectedKey: selectedGameKey, windowStart: selectedWindowStart, animate })}</div><div id="playerInsightsAction">${insightAction(scoped)}</div></section>`;
    const recent = `<section class="pe-view pe-matches-view"${explorerView === 'matches' ? '' : ' hidden'} aria-labelledby="recentHeading"><div class="section-heading"><h3 id="recentHeading" tabindex="-1">선택 범위 경기 목록</h3><span class="subtle">최신순 · ${Math.min(visibleGames, scoped.recent.length)} / ${scoped.recent.length}경기</span></div>${V.renderForm(scoped, demoMode ? null : matchLink)}${demoMode ? '<p class="stat-footnote">경기를 누르면 가상 경기의 세부 수치를 볼 수 있습니다.</p>' : ''}${scoped.recent.length ? `<ol class="recent-games">${recentRows(scoped.recent, detail.recent)}</ol>${visibleGames < scoped.recent.length ? '<button class="btn more-games" type="button" data-more-games>이전 경기 더 보기</button>' : ''}` : '<p class="profile-empty compact">선택 범위에 최근 경기 기록이 없습니다.</p>'}</section>`;
    const positions = `<details class="profile-breakdown-details" ${panelAttribute('positions')}><summary>포지션별 상세 수치 <span>선택 범위 · 5개 라인</span></summary><div class="breakdown-list position-breakdown">${breakdownRows(scoped.positions, 'position')}</div></details><p class="stat-footnote">포지션 미입력 ${scoped.missing.position}경기는 전체 라인에만 포함됩니다. 등록된 주·부 포지션으로 대신 분류하지 않습니다.</p>`;
    const champions = `<details class="profile-breakdown-details" ${panelAttribute('champions')}><summary>챔피언별 상세 수치 <span>선택 범위 · ${scoped.champions.length}종</span></summary><div class="breakdown-list champion-breakdown">${scoped.champions.length ? breakdownRows(scoped.champions, 'champion') : '<p class="profile-empty compact">챔피언 기록이 없습니다.</p>'}</div></details><p class="stat-footnote">챔피언 미입력 ${scoped.missing.champion}경기는 전체 챔피언에만 포함됩니다.</p>`;
    const scopedTeammates = !demoMode && scoped.teammates.length ? `<details class="profile-teammates" ${panelAttribute('teammates')}><summary>함께한 동료 <span>선택 범위에서 같은 팀으로 플레이한 성적</span></summary><div class="teammate-list">${scoped.teammates.map(item => `<a href="${esc(profileUrl(item.id))}" data-player="${esc(item.id)}"><strong>${esc(item.name)}</strong><span>${item.games}경기 · ${item.wins}승 ${item.losses}패</span><b>${percent(item.winRate)}</b></a>`).join('')}</div></details>` : '';
    const detailed = `<section class="pe-view pe-details-view"${explorerView === 'details' ? '' : ' hidden'} aria-label="선택 범위 상세 통계"><div class="section-heading"><h3>선택 범위 상세 통계</h3></div>${positions}${champions}${scopedTeammates}${notes}</section>`;
    return `<section class="pe-workspace" aria-labelledby="explorerHeading" data-ripple-scope><div class="pe-heading"><div><span class="eyebrow">PLAY EXPLORER</span><h3 id="explorerHeading" tabindex="-1">플레이 탐색</h3></div><p>라인과 챔피언을 고르고, 경기 흐름을 직접 움직여 보세요.</p></div><div class="pe-toolbar" role="group" aria-label="개인 성적 보기 방식">${[['explore', '탐색'], ['matches', '경기 목록'], ['details', '상세 통계']].map(([id, label]) => `<button type="button" data-explorer-view="${id}" aria-pressed="${explorerView === id}">${label}</button>`).join('')}</div><div class="pe-scope-line"><p aria-live="polite">${esc(scopeLabel)} · <b>${totals.games}경기</b></p>${chips}<button type="button" class="pe-reset" data-explorer-reset=""${selectedRole || selectedChampion ? '' : ' disabled'}>필터 초기화</button></div><div class="pe-layout">${filters}<div class="pe-content">${totalsMarkup}${empty}${exploration}${recent}${detailed}</div></div></section>`;
  }

  function selectedDetail() {
    return S.selectPlayer(state, selectedPlayer, selectedDate === 'all' ? {} : { date: selectedDate });
  }
  function openDemoGame(index, trigger) {
    if (!demoMode || !Number.isInteger(index) || index < 0) return;
    const game = selectedDetail()?.recent[index];
    if (!game) return;
    demoReturnFocus = trigger;
    $('demoGameContent').innerHTML = `<div class="demo-game-result ${game.won ? 'is-win' : 'is-loss'}"><strong>${game.won ? '승리' : '패배'}</strong><span>${esc(fullDate(game.date))} · ${game.setNumber}세트</span></div><h3>${esc(game.champion || '챔피언 미입력')} <small>${esc(roleShort(game.position))}</small></h3><dl class="demo-game-metrics"><div><dt>K / D / A</dt><dd>${rawKda(game)}</dd></div><div><dt>KDA</dt><dd>${kda(game.kda)}</dd></div><div><dt>CS</dt><dd>${number(game.cs)}</dd></div><div><dt>경기 시간</dt><dd>${duration(game.durationSeconds)}</dd></div><div><dt>챔피언 대상 피해량</dt><dd>${number(game.damage)}</dd></div></dl><p>화면 체험을 위해 만든 가상 경기입니다. 실제 기록에 저장되지 않습니다.</p>`;
    $('demoGameDialog').showModal();
    $('demoGameClose').focus();
  }
  function navigateClick(event) {
    const link = event.target.closest('[data-player]');
    if (!link || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    choosePlayer(link.dataset.player);
  }
  $('detailPlayer').addEventListener('change', event => choosePlayer(event.target.value));
  $('playerHistory').addEventListener('click', navigateClick);
  $('playerDetail').addEventListener('click', event => {
    if (event.target.closest('[data-insight-replay]')) { if (!stopReplay()) startReplay(); return; }
    stopReplay();
    const demoGame = event.target.closest('[data-demo-game]');
    if (demoGame && demoMode) { event.preventDefault(); openDemoGame(Number(demoGame.dataset.demoGame), demoGame); return; }
    const heroFilter = event.target.closest('[data-hero-filter]');
    const heroGame = event.target.closest('[data-hero-game]');
    if (heroFilter || heroGame) {
      const detail = selectedDetail();
      if (!detail) return;
      if (heroFilter) {
        const value = String(heroFilter.dataset.heroFilter || ''), split = value.indexOf(':');
        const kind = value.slice(0, split), id = value.slice(split + 1);
        if (kind === 'role' && C.ROLES.some(role => role.id === id)) { selectedRole = id; selectedChampion = ''; }
        else if (kind === 'champion') {
          let champion;
          try { champion = decodeURIComponent(id); } catch (_) { return; }
          if (!detail.champions.some(item => item.id === champion)) return;
          selectedChampion = champion; selectedRole = '';
        } else return;
      } else {
        let key;
        try { key = decodeURIComponent(heroGame.dataset.heroGame); } catch (_) { return; }
        if (!detail.recent.some(game => gameKey(game) === key)) return;
        // The hero shows unfiltered games; widen the scope if the game is outside it.
        if (!scopedDetail(detail).recent.some(game => gameKey(game) === key)) { selectedRole = ''; selectedChampion = ''; }
        selectedGameKey = key;
      }
      explorerView = 'explore';
      visibleGames = 20;
      selectedWindowStart = undefined;
      renderProfile(detail);
      const destination = heroGame ? $('playerInsights') : $('explorerHeading');
      $('explorerHeading')?.focus({ preventScroll: true });
      destination?.scrollIntoView({ behavior: motionEnabled() ? 'smooth' : 'auto', block: heroGame ? 'center' : 'start' });
      M?.flash($('playerDetail').querySelector('.pe-scope-line'), 'pm-pulse', motionEnabled());
      if (heroGame && M) M.burst($('playerInsights')?.querySelector?.('.pi-selection'), { enabled: motionEnabled(), tone: 'gold' });
      return;
    }
    if (event.target.closest('[data-explorer-jump]')) {
      $('explorerHeading')?.focus({ preventScroll: true });
      $('explorerHeading')?.scrollIntoView({ behavior: motionEnabled() ? 'smooth' : 'auto', block: 'start' });
      return;
    }
    const metricButton = event.target.closest('[data-insight-metric]');
    const keyButton = event.target.closest('[data-insight-key]');
    const gameButton = event.target.closest('[data-insight-game]');
    if (metricButton || keyButton || gameButton) {
      let focusSelector;
      if (metricButton && ['kda', 'csPerMinute', 'damage'].includes(metricButton.dataset.insightMetric)) {
        selectedMetric = metricButton.dataset.insightMetric;
        focusSelector = `[data-insight-metric="${selectedMetric}"]`;
      } else {
        const original = selectedDetail();
        if (!original) return;
        const scoped = scopedDetail(original);
        if (keyButton) {
          let key;
          try { key = decodeURIComponent(keyButton.dataset.insightKey); } catch (_) { return; }
          if (!scoped.recent.some(game => gameKey(game) === key)) return;
          selectedGameKey = key;
          focusSelector = `[data-insight-key="${encodeURIComponent(key)}"]`;
        } else if (gameButton && /^\d+$/.test(gameButton.dataset.insightGame)) {
          const model = Insights.buildModel(scoped, selectedMetric, { selectedKey: selectedGameKey, windowStart: selectedWindowStart });
          const game = model.games[Number(gameButton.dataset.insightGame)];
          if (!game) return;
          selectedGameKey = gameKey(game);
          focusSelector = `[data-insight-game="${gameButton.dataset.insightGame}"]`;
        } else return;
        if (explorerView !== 'explore') { explorerView = 'explore'; renderProfile(original); }
      }
      const highlight = !!keyButton?.dataset?.highlight;
      updateInsights(focusSelector, { celebrate: highlight ? 'always' : false });
      // Highlights sit below the chart; bring the game they opened into view.
      if (highlight) $('playerInsights')?.querySelector?.('.pi-selection')?.scrollIntoView?.({ behavior: motionEnabled() ? 'smooth' : 'auto', block: 'center' });
      return;
    }
    const viewButton = event.target.closest('[data-explorer-view]');
    if (viewButton && ['explore', 'matches', 'details'].includes(viewButton.dataset.explorerView)) {
      const changed = explorerView !== viewButton.dataset.explorerView;
      explorerView = viewButton.dataset.explorerView;
      renderProfile(selectedDetail());
      if (changed) M?.flash($('playerDetail').querySelector(`.pe-${explorerView}-view`), 'pe-view-fresh', motionEnabled());
      focusControl($('playerDetail'), `[data-explorer-view="${explorerView}"]`);
      return;
    }
    const roleButton = event.target.closest('[data-visual-role]');
    const allRoles = event.target.closest('[data-explorer-all-roles]');
    const championButton = event.target.closest('[data-explorer-champion]');
    const clearButton = event.target.closest('[data-explorer-clear]');
    const resetButton = event.target.closest('[data-explorer-reset]');
    if (roleButton || allRoles || championButton || clearButton || resetButton) {
      const detail = selectedDetail();
      if (!detail) return;
      let focusSelector;
      if (roleButton && C.ROLES.some(role => role.id === roleButton.dataset.visualRole)) {
        selectedRole = selectedRole === roleButton.dataset.visualRole ? '' : roleButton.dataset.visualRole;
        focusSelector = `[data-visual-role="${roleButton.dataset.visualRole}"]`;
      } else if (allRoles) {
        selectedRole = '';
        focusSelector = '[data-explorer-all-roles=""]';
      } else if (championButton) {
        let champion;
        try { champion = decodeURIComponent(championButton.dataset.explorerChampion); } catch (_) { return; }
        if (champion && !detail.champions.some(item => item.id === champion)) return;
        selectedChampion = selectedChampion === champion ? '' : champion;
        focusSelector = `[data-explorer-champion="${encodeURIComponent(champion)}"]`;
      } else if (clearButton?.dataset.explorerClear === 'role') {
        selectedRole = ''; focusSelector = '[data-explorer-all-roles=""]';
      } else if (clearButton?.dataset.explorerClear === 'champion') {
        selectedChampion = ''; focusSelector = '[data-explorer-champion=""]';
      } else if (resetButton) {
        selectedRole = ''; selectedChampion = ''; focusSelector = '[data-explorer-all-roles=""]';
      } else return;
      visibleGames = 20;
      selectedWindowStart = undefined;
      renderProfile(detail);
      M?.flash($('playerDetail').querySelector('.pe-scope-line'), 'pm-pulse', motionEnabled());
      focusControl($('playerDetail'), focusSelector);
      return;
    }
    if (event.target.closest('[data-more-games]')) {
      visibleGames += 20;
      renderProfile(S.selectPlayer(state, selectedPlayer, selectedDate === 'all' ? {} : { date: selectedDate }));
      if ($('playerDetail').querySelector('[data-more-games]')) focusControl($('playerDetail'), '[data-more-games]');
      else $('recentHeading')?.focus({ preventScroll: true });
      return;
    }
    navigateClick(event);
  });
  $('allPlayersLink').addEventListener('click', event => { if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); choosePlayer('', false); });
  $('playerSearch').addEventListener('input', event => { searchText = event.target.value; renderDirectory(); });
  $('playersDate').addEventListener('change', event => { selectedDate = event.target.value; visibleGames = 20; selectedRole = ''; selectedMetric = 'kda'; selectedGameKey = null; selectedWindowStart = undefined; selectedChampion = ''; explorerView = 'explore'; closeDemoGame(); updateUrl(); render(); });
  $('playersRefreshBtn').addEventListener('click', load);
  $('playersDemoEntry').addEventListener('click', event => { if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); switchDemo(true); });
  $('playerDemoExit').addEventListener('click', event => { if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); switchDemo(false); });
  $('demoGameClose').addEventListener('click', closeDemoGame);
  $('demoGameDialog').addEventListener('click', event => { if (event.target === $('demoGameDialog')) closeDemoGame(); });
  $('demoGameDialog').addEventListener('close', () => { if (demoMode) demoReturnFocus?.focus({ preventScroll: true }); demoReturnFocus = null; });
  $('playersMotionToggle').addEventListener('click', () => {
    motionPreference = motionEnabled() ? 'off' : 'on';
    try { window.localStorage?.setItem('lol-player-motion', motionPreference); } catch (_) { /* Preferences are optional; statistics never write to the server. */ }
    showMotionPreference();
  });
  reducedMotion?.addEventListener?.('change', showMotionPreference);
  window.addEventListener('popstate', () => {
    const previousMode = demoMode;
    readRoute(); closeDemoGame();
    if (previousMode !== demoMode) {
      routeEpoch += 1;
      state = null; loadStatus = 'loading';
      showMode();
      if (!demoMode) renderLoading();
      load();
    } else render();
  });
  window.addEventListener('pageshow', event => { if (event.persisted && !demoMode) load(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopReplay(); else if (!demoMode) load(); });
  setInterval(() => { if (!document.hidden && !demoMode) load(); }, 15000);
  showMotionPreference();
  readRoute();
  M?.tilt($('playerDetail'), motionEnabled);
  M?.ripple($('playerDetail'), motionEnabled);
  load();
})();
