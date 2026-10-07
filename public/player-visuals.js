(function (root) {
  'use strict';

  // A read-only presentation layer. All statistics come from LoLPlayerStats;
  // percentages below only describe the size of a displayed distribution.
  const ROLES = Object.freeze([
    { id: 'top', name: '탑', short: 'TOP' },
    { id: 'jungle', name: '정글', short: 'JGL' },
    { id: 'mid', name: '미드', short: 'MID' },
    { id: 'adc', name: '원딜', short: 'ADC' },
    { id: 'support', name: '서포터', short: 'SUP' }
  ]);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const number = (value, digits = 0) => finite(value) ? value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  const percent = value => finite(value) ? `${number(value, 1)}%` : '—';
  const kda = value => !value || value.games === 0 ? '—' : value.perfect ? 'Perfect' : number(value.ratio, 2);
  const share = (part, total) => total > 0 ? Math.max(0, Math.min(100, count(part) / total * 100)) : 0;
  const list = value => Array.isArray(value) ? value : [];
  const statLine = stats => `${number(stats.wins)}승 ${number(stats.losses)}패`;
  const safeHref = value => typeof value === 'string' && /^(?:\.\/)?(?:history|index)\.html(?:[?#][^\u0000-\u0020\\]*)?$/.test(value) ? value : null;
  const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.slice(5).replace('-', '.') : '날짜 미입력';
  const star = '<svg class="pv-spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 5 14h6l-1 8 9-13h-6l0-7Z"/></svg>';

  function renderOverview(detail) {
    const totals = detail?.totals || {};
    const games = count(totals.games), wins = count(totals.wins), losses = count(totals.losses);
    const measured = games > 0 && finite(totals.winRate);
    const winShare = measured ? share(wins, games) : 0;
    const lossShare = measured ? share(losses, games) : 0;
    const ring = `<svg class="pv-ring" viewBox="0 0 220 220" aria-hidden="true"><circle class="pv-ring-guide" cx="110" cy="110" r="103"/><path class="pv-ring-ticks" d="M110 1v7m109 102h-7M110 219v-7M1 110h7"/><circle class="pv-ring-track" cx="110" cy="110" r="86"/>${measured ? `<circle class="pv-ring-loss" cx="110" cy="110" r="86" pathLength="100" stroke-dasharray="${lossShare} ${100 - lossShare}" stroke-dashoffset="${-winShare}" style="--pv-ring-segment:${lossShare};--pv-ring-rest:${100 - lossShare}"/><circle class="pv-ring-win" cx="110" cy="110" r="86" pathLength="100" stroke-dasharray="${winShare} ${100 - winShare}" style="--pv-ring-segment:${winShare};--pv-ring-rest:${100 - winShare}"/>` : ''}</svg>`;
    return `<div class="pv-overview${games ? '' : ' pv-is-empty'}"><div class="pv-ring-wrap">${ring}<div class="pv-ring-copy"><span class="pv-kicker">${games ? 'WIN RATE' : 'YOUR NEXT GAME'}</span><strong>${measured ? percent(totals.winRate) : '—'}</strong><span>${games ? `${number(games)}경기 누적` : '첫 기록을 기다리는 중'}</span></div></div><div class="pv-record"><span class="pv-kicker">MATCH RECORD</span><div class="pv-record-line"><span class="pv-win"><b>${number(wins)}</b> 승</span><i aria-hidden="true">/</i><span class="pv-loss"><b>${number(losses)}</b> 패</span></div><p>${games ? '한 판씩 쌓이는 나의 내전 기록' : '경기 등록 후 그래프가 채워집니다.'}</p><span class="pv-record-caption"><i class="pv-key pv-key-win" aria-hidden="true"></i>승리<i class="pv-key pv-key-loss" aria-hidden="true"></i>패배</span></div></div>`;
  }

  function renderForm(detail, matchLinkFn) {
    const form = detail?.form || {};
    const recent = list(detail?.recent).slice(0, 5);
    if (!recent.length) return '<div class="pv-form pv-form-empty"><span class="pv-kicker">RECENT FORM</span><strong>다음 경기에서 시작될 흐름</strong><p>첫 경기가 등록되면 이곳에 최근 승패가 펼쳐집니다.</p></div>';
    const streakCount = count(form.streak?.count);
    const streakWon = form.streak?.won === true;
    let hasMatchLinks = false;
    const tiles = recent.map((game, index) => {
      let href = null;
      if (typeof matchLinkFn === 'function') href = safeHref(matchLinkFn(game));
      if (href) hasMatchLinks = true;
      const won = game.won === true, label = won ? '승리' : '패배';
      const content = `<span class="pv-form-order">${index === 0 ? 'LATEST' : `0${index + 1}`}</span><b>${won ? 'W' : 'L'}</b><strong>${esc(game.champion || '챔피언 미입력')}</strong><small>${esc(dateLabel(game.date))} · ${count(game.setNumber)}세트</small>`;
      const accessible = `${index === 0 ? '가장 최근 경기, ' : ''}${esc(label)} · ${esc(game.champion || '챔피언 미입력')} · ${esc(game.date || '날짜 미입력')} · ${count(game.setNumber)}세트`;
      return `<li class="pv-form-step pv-form-${won ? 'win' : 'loss'}">${href ? `<a class="pv-form-tile" href="${esc(href)}" aria-label="${accessible}, 경기 보기">${content}<span class="pv-form-open" aria-hidden="true">↗</span></a>` : `<div class="pv-form-tile" aria-label="${accessible}">${content}</div>`}</li>`;
    }).join('');
    return `<div class="pv-form"><div class="pv-form-head"><div><span class="pv-kicker">RECENT FORM</span><h4>최근 ${recent.length}경기의 흐름</h4><p>${number(form.wins)}승 ${number(form.losses)}패 <span>· 왼쪽부터 최신순</span></p></div>${streakCount ? `<div class="pv-streak pv-streak-${streakWon ? 'win' : 'loss'}">${star}<span>현재 <strong>${number(streakCount)}${streakWon ? '연승' : '연패'}</strong></span></div>` : ''}</div><ol class="pv-form-ribbon" aria-label="최근 최대 5경기, 왼쪽부터 최신순">${tiles}</ol>${hasMatchLinks ? '<p class="pv-form-hint">경기를 누르면 해당 기록으로 이동합니다.</p>' : ''}</div>`;
  }

  function renderPositions(detail, selectedRole, options = {}) {
    const total = count(detail?.totals?.games);
    const positions = ROLES.map(role => ({ ...role, stats: list(detail?.positions).find(item => item.id === role.id) || { games: 0, wins: 0, losses: 0, winRate: null, kda: null } }));
    const mostPlayed = positions.slice().sort((a, b) => count(b.stats.games) - count(a.stats.games))[0];
    const fallback = mostPlayed.stats.games > 0 ? mostPlayed.id : ROLES.some(role => role.id === detail?.profile?.primary) ? detail.profile.primary : 'top';
    const selected = positions.find(role => role.id === selectedRole) || (options.allowAll ? { id: '', short: 'ALL', name: '전체 포지션', stats: detail?.totals || { games: 0, wins: 0, losses: 0, winRate: null, kda: null } } : positions.find(role => role.id === fallback));
    const map = `<div class="pv-map"><svg class="pv-map-art" viewBox="0 0 280 280" aria-hidden="true"><path class="pv-map-ground" d="M20 12h240l8 8v240l-8 8H20l-8-8V20Z"/><path class="pv-map-river" d="m50 28 14 48 39 21 10 40 39 16 15 37 47 18 24 43"/><path class="pv-map-groves" d="m59 135 11-17 11 17Zm29 24 11-17 11 17ZM141 68l11-17 11 17Zm25 24 11-17 11 17Zm-20 130 11-17 11 17Zm47-76 11-17 11 17Z"/><path class="pv-map-lane${selected.id === 'top' ? ' pv-map-active' : ''}" d="M31 246V34h213"/><path class="pv-map-lane${['adc', 'support'].includes(selected.id) ? ' pv-map-active' : ''}" d="M34 246h212V33"/><path class="pv-map-lane${selected.id === 'mid' ? ' pv-map-active' : ''}" d="m35 244 210-210"/><path class="pv-map-jungle${selected.id === 'jungle' ? ' pv-map-active' : ''}" d="m66 187 28-48 34-35 59-37"/><path class="pv-map-base" d="m18 234 16-10 21 20-14 20H18Zm223-218h23v24l-17 14-19-20Z"/></svg><div class="pv-map-label"><span>THE RIFT</span><small>포지션을 눌러 보세요</small></div>${positions.map(role => `<button type="button" class="pv-map-role pv-map-role-${role.id}" data-visual-role="${role.id}" aria-pressed="${role.id === selected.id}" aria-label="${role.name} 성적 보기, ${count(role.stats.games)}경기"><b>${role.short}</b><span>${count(role.stats.games)}경기</span></button>`).join('')}</div>`;
    const bars = `<div class="pv-position-distribution"><div class="pv-distribution-heading"><h4>어느 라인에서 뛰었을까?</h4><p>전체 ${number(total)}경기 중 실제 플레이 비중</p></div><ul class="pv-position-bars">${positions.map(role => `<li class="${role.id === selected.id ? 'pv-is-selected' : ''}"><span class="pv-position-name">${role.short}</span><div class="pv-bar-track" aria-hidden="true"><span class="pv-bar-fill" style="--pv-fill:${share(role.stats.games, total)}%"></span></div><span class="pv-position-count"><b>${count(role.stats.games)}경기</b><small>${total ? percent(share(role.stats.games, total)) : '—'}</small></span></li>`).join('')}</ul></div>`;
    const stats = selected.stats;
    const selectedStats = `<div class="pv-position-selected" aria-live="polite"><div class="pv-position-selected-title"><span class="pv-kicker">SELECTED POSITION</span><h4>${selected.short} <span>${selected.name}</span></h4></div><dl><div><dt>경기</dt><dd>${count(stats.games)}<small>${statLine(stats)}</small></dd></div><div><dt>승률</dt><dd>${percent(stats.winRate)}</dd></div><div><dt>KDA</dt><dd>${kda(stats.kda)}</dd></div></dl>${count(stats.games) ? '' : '<p class="pv-position-empty">이 포지션으로 기록된 경기가 없습니다.</p>'}</div>`;
    return `<div class="pv-positions">${map}${bars}${selectedStats}</div><p class="pv-note">포지션 미입력 ${count(detail?.missing?.position)}경기는 분포에서 제외됩니다. 실제 플레이 기록을 기준으로 표시합니다.</p>`;
  }

  function renderChampions(detail) {
    const champions = list(detail?.champions).filter(champion => count(champion.games) > 0).slice().sort((a, b) => b.games - a.games).slice(0, 3);
    if (!champions.length) return '<div class="pv-champions-empty"><span class="pv-kicker">MOST PLAYED</span><strong>나의 챔피언 컬렉션</strong><p>챔피언이 기록되면 자주 플레이한 챔피언이 여기에 나타납니다.</p></div>';
    const total = count(detail?.totals?.games);
    const cards = champions.map((champion, index) => {
      const initial = Array.from(String(champion.name || '?')).slice(0, 2).join('');
      return `<article class="pv-champion pv-champion-${index + 1}"><span class="pv-champion-order">MOST PLAYED <b>0${index + 1}</b></span><div class="pv-champion-emblem" aria-hidden="true"><svg viewBox="0 0 108 108"><path class="pv-emblem-outer" d="m54 3 44 25v51L54 105 10 79V28Z"/><path class="pv-emblem-inner" d="m54 13 35 20v41L54 95 19 74V33Z"/><path class="pv-emblem-line" d="m54 3 0 10M10 28l9 5m70 0 9-5M10 79l9-5m70 0 9 5M54 95v10"/></svg><span>${esc(initial)}</span></div><div class="pv-champion-title"><h4>${esc(champion.name)}</h4><p><b>${number(champion.games)}</b>경기 <span>${statLine(champion)}</span></p></div><dl class="pv-champion-metrics"><div><dt>승률</dt><dd>${percent(champion.winRate)}</dd></div><div><dt>KDA</dt><dd>${kda(champion.kda)}</dd></div></dl><div class="pv-champion-share"><div class="pv-champion-track" aria-hidden="true"><span class="pv-champion-win" style="--pv-fill:${share(champion.wins, total)}%"></span><span class="pv-champion-loss" style="--pv-fill:${share(champion.losses, total)}%"></span></div><p>전체 경기의 <b>${total ? percent(share(champion.games, total)) : '—'}</b></p></div></article>`;
    }).join('');
    return `<div class="pv-champions-heading"><span class="pv-kicker">MY CHAMPION POOL</span><p>경기 수 순 · 전체 ${number(total)}경기 기준 <span><i class="pv-key pv-key-win" aria-hidden="true"></i>승리<i class="pv-key pv-key-loss" aria-hidden="true"></i>패배</span></p></div><div class="pv-champions">${cards}</div><p class="pv-note">챔피언 미입력 ${count(detail?.missing?.champion)}경기는 컬렉션에서 제외됩니다. 플레이 비중은 미입력 경기를 포함한 전체 경기 기준입니다.</p>`;
  }

  const api = Object.freeze({ renderOverview, renderForm, renderPositions, renderChampions });
  root.LoLPlayerVisuals = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
