(function (root) {
  'use strict';

  // Season recap and achievements. Everything here is a count, maximum or
  // ordering of recorded games: no rating, score, MMR, MVP or ACE is derived.
  // Achievements are milestones with their rule written next to them; a missing
  // value (null) never counts toward a milestone and K/D/A milestones show
  // "미수집" instead of 0 progress when no complete K/D/A game exists.
  const insights = () => root.LoLPlayerInsights;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const complete = game => [game?.kills, game?.deaths, game?.assists].every(integer);
  const fmt = (value, digits = 0) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  const shortDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.slice(5).replace('-', '.') : '날짜 미입력';
  const fullDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.replaceAll('-', '.') : '날짜 미입력';
  const ROLE = Object.freeze({ top: 'TOP', jungle: 'JUNGLE', mid: 'MID', adc: 'ADC', support: 'SUPPORT' });
  const ROLE_KO = Object.freeze({ top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서포터' });
  const keyAttr = game => esc(encodeURIComponent(insights().gameKey(game)));

  const ICON = Object.freeze({
    flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>',
    games: '<rect x="4" y="4" width="16" height="16"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    flame: '<path d="M12 2.5c.6 3.2 5.4 5.6 5.4 10.5a5.4 5.4 0 0 1-10.8 0c0-2.5 1.3-4.2 2.6-5.4.1 1.8.9 3.1 2.1 3.8-.4-3.7.1-6.6.7-8.9Z"/>',
    sword: '<path d="M14.5 3H21v6.5l-9.3 9.3-2.2-2.2 9.3-9.3-2.1-2.1-9.3 9.3-2.2-2.2Z"/><path d="m4 15 5 5m-6.5-1.5 3-3 3 3-3 3Z"/>',
    hands: '<path d="M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8 0a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM1.5 20c.6-4 3.2-6 6.5-6s5.9 2 6.5 6m-2-5.2c1-.6 2.2-.8 3.5-.8 3.3 0 5.9 2 6.5 6"/>',
    shield: '<path d="M12 2 20 5v6.5c0 5-3.4 8.7-8 10.5-4.6-1.8-8-5.5-8-10.5V5Z"/><path d="m8.2 12.2 2.6 2.6 5-5.3"/>',
    pool: '<path d="M12 2 21 7v10l-9 5-9-5V7Z"/><path d="M12 22V12m9-5-9 5-9-5"/>',
    map: '<path d="M4 20V4h16v16Z"/><path d="m4 20 16-16M4 4h7M20 20h-7"/>',
    star: '<path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9Z"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15"/><path d="M3.5 10h17M8 3v4m8-4v4m-7.5 7 2 2 4-4"/>'
  });
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ICON.star}</svg>`;

  function chronological(detail) {
    return insights().buildModel(detail || { recent: [] }).allGames;
  }

  // Walks games oldest to newest and records the first game that satisfies each
  // milestone, so an unlocked achievement can open the exact game.
  const DEFS = Object.freeze([
    { id: 'first-win', icon: 'flag', title: '첫 승리', rule: '승리 1회', target: 1, value: s => s.wins },
    { id: 'games-10', icon: 'games', title: '10경기 출전', rule: '경기 10회', target: 10, value: s => s.games },
    { id: 'streak-3', icon: 'flame', title: '3연승', rule: '연속 승리 3회', target: 3, value: s => s.bestStreak, streak: true },
    { id: 'kills-10', unit: '킬', icon: 'sword', title: '한 판 10킬', rule: '한 경기 킬 10 이상', target: 10, value: s => s.maxKills, kda: true },
    { id: 'assists-20', unit: '어시스트', icon: 'hands', title: '한 판 20어시스트', rule: '한 경기 어시스트 20 이상', target: 20, value: s => s.maxAssists, kda: true },
    { id: 'deathless', icon: 'shield', title: '무데스', rule: '데스 0으로 끝낸 경기', target: 1, value: s => s.deathless, kda: true },
    { id: 'champions-5', unit: '종', icon: 'pool', title: '챔피언 5종', rule: '서로 다른 챔피언 5종', target: 5, value: s => s.champions },
    { id: 'one-champion-5', unit: '경기', icon: 'star', title: '한 챔피언 5경기', rule: '같은 챔피언 5경기', target: 5, value: s => s.maxChampionGames },
    { id: 'day-3-wins', unit: '승', icon: 'calendar', title: '하루 3승', rule: '같은 경기일 승리 3회', target: 3, value: s => s.maxDayWins },
    { id: 'lanes-3', unit: '곳', icon: 'map', title: '세 라인 경험', rule: '서로 다른 라인 3곳', target: 3, value: s => s.lanes },
    { id: 'streak-5', icon: 'flame', title: '5연승', rule: '연속 승리 5회', target: 5, value: s => s.bestStreak, streak: true },
    { id: 'games-30', icon: 'games', title: '30경기 출전', rule: '경기 30회', target: 30, value: s => s.games }
  ]);

  function walk(games) {
    const s = { games: 0, wins: 0, streak: 0, bestStreak: 0, maxKills: 0, maxAssists: 0, deathless: 0, kdaGames: 0, champions: 0, lanes: 0, maxChampionGames: 0, maxDayWins: 0 };
    const championGames = new Map(), lanes = new Set(), dayWins = new Map();
    const unlocked = new Map();
    for (const game of games) {
      s.games += 1;
      if (game.won === true) { s.wins += 1; s.streak += 1; } else s.streak = 0;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      if (complete(game)) {
        s.kdaGames += 1;
        s.maxKills = Math.max(s.maxKills, game.kills);
        s.maxAssists = Math.max(s.maxAssists, game.assists);
        if (game.deaths === 0) s.deathless += 1;
      }
      const champion = String(game.champion || '').trim().toLocaleLowerCase('en-US');
      if (champion) { championGames.set(champion, (championGames.get(champion) || 0) + 1); s.maxChampionGames = Math.max(s.maxChampionGames, championGames.get(champion)); }
      s.champions = championGames.size;
      if (ROLE[game.position]) lanes.add(game.position);
      s.lanes = lanes.size;
      if (game.won === true && game.date) { dayWins.set(game.date, (dayWins.get(game.date) || 0) + 1); s.maxDayWins = Math.max(s.maxDayWins, dayWins.get(game.date)); }
      for (const def of DEFS) if (!unlocked.has(def.id) && def.value(s) >= def.target) unlocked.set(def.id, game);
    }
    return { stats: s, unlocked };
  }

  function achievements(detail) {
    const games = chronological(detail);
    const { stats, unlocked } = walk(games);
    const latest = games.at(-1);
    const currentWinStreak = stats.streak;
    return DEFS.map(def => {
      const game = unlocked.get(def.id) || null;
      const unknown = def.kda && stats.kdaGames === 0;
      const value = unknown ? null : Math.min(def.value(stats), def.target);
      let hint = '';
      if (!game && !unknown) {
        const left = def.target - value;
        if (def.streak) hint = currentWinStreak > 0 && def.target - currentWinStreak === 1 && latest?.won === true ? '다음 경기를 이기면 달성' : `연속 승리 ${def.target}회 필요 · 최장 ${stats.bestStreak}연승`;
        else if (def.id.startsWith('games')) hint = `${left}경기 더 출전하면 달성`;
        else if (def.id === 'first-win') hint = '첫 승리를 기다리는 중';
        else if (def.id === 'deathless') hint = '데스 0 경기를 기다리는 중';
        else hint = `${fmt(value)} / ${def.target} · ${fmt(left)}${def.unit || ''} 더`;
      }
      return { id: def.id, icon: def.icon, title: def.title, rule: def.rule, target: def.target, value, unknown, unlocked: !!game, game, hint, progress: value == null ? null : value / def.target };
    });
  }

  function longestWinStreak(games) {
    let best = null, run = [];
    for (const game of games) {
      if (game.won === true) { run.push(game); if (!best || run.length >= best.count) best = { count: run.length, start: run[0], end: game }; }
      else run = [];
    }
    return best;
  }
  function bestDay(games) {
    const days = new Map();
    for (const game of games) {
      if (!game.date) continue;
      const day = days.get(game.date) || { date: game.date, wins: 0, losses: 0, games: [] };
      if (game.won === true) day.wins += 1; else day.losses += 1;
      day.games.push(game);
      days.set(game.date, day);
    }
    return [...days.values()].filter(day => day.wins > 0).sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.date.localeCompare(a.date))[0] || null;
  }

  function recap(detail, options = {}) {
    const games = chronological(detail);
    if (!games.length) return null;
    const totals = detail.totals || {};
    const lanes = (detail.positions || []).filter(item => item.games > 0).sort((a, b) => b.games - a.games || b.wins - a.wins);
    const champions = (detail.champions || []).filter(item => item.games > 0);
    const mostWins = champions.slice().sort((a, b) => b.wins - a.wins || b.games - a.games || a.name.localeCompare(b.name, 'ko'))[0] || null;
    const model = insights().buildModel(detail);
    const kdaRows = games.filter(complete);
    const sum = field => kdaRows.reduce((total, game) => total + game[field], 0);
    const list = achievements(detail);
    const next = list.filter(item => !item.unlocked && !item.unknown && item.progress != null).sort((a, b) => b.progress - a.progress)[0] || null;
    const teammate = options.teammates && detail.teammates?.length ? detail.teammates.slice().sort((a, b) => b.games - a.games || b.wins - a.wins)[0] : null;
    return {
      name: detail.profile?.name || '', games: games.length, wins: totals.wins ?? games.filter(game => game.won === true).length, losses: totals.losses ?? games.filter(game => game.won !== true).length, winRate: totals.winRate ?? null,
      first: games[0], last: games.at(-1), all: games,
      lane: lanes[0] ? { id: lanes[0].id, games: lanes[0].games, share: lanes[0].games / games.length * 100 } : null, laneCounts: lanes,
      champion: champions[0] || null, mostWins: mostWins && champions[0] && mostWins.id !== champions[0].id && mostWins.wins > (champions[0].wins || 0) ? mostWins : null, championCount: champions.length,
      bestDay: bestDay(games), streak: longestWinStreak(games), current: detail.form?.streak || null,
      highs: kdaRows.length ? { games: kdaRows.length, kills: model.highlightGames.maxKills, assists: model.highlightGames.maxAssists, deathless: kdaRows.filter(game => game.deaths === 0).length, totalKills: sum('kills'), totalAssists: sum('assists') } : null,
      achievements: { unlocked: list.filter(item => item.unlocked).length, total: list.length, next },
      teammate
    };
  }

  function renderAchievements(list, options = {}) {
    if (!list?.length) return '';
    const done = list.filter(item => item.unlocked).length;
    const tiles = list.map((item, index) => {
      const pct = item.progress == null ? 0 : Math.round(item.progress * 100);
      const near = !item.unlocked && item.progress != null && item.progress >= .75;
      const status = item.unlocked ? `${fullDate(item.game.date)} ${item.game.champion || '챔피언 미입력'} 경기에서 달성` : item.unknown ? 'K/D/A 미수집' : item.hint;
      const body = `<span class="ac-icon" aria-hidden="true">${icon(item.icon)}</span><strong>${esc(item.title)}</strong><small class="ac-rule">${esc(item.rule)}</small>${item.unlocked ? `<em class="ac-when">${esc(shortDate(item.game.date))} · ${esc(item.game.champion || '챔피언 미입력')} <i aria-hidden="true">↗</i></em>` : `<span class="ac-progress" aria-hidden="true"><i data-bar-key="achievement-${item.id}" style="--bar:${pct}%"></i></span><em class="ac-hint">${esc(item.unknown ? 'K/D/A 미수집' : item.hint)}</em>`}`;
      const label = `${item.title}, ${item.rule}, ${item.unlocked ? '달성' : '미달성'}. ${status}`;
      return item.unlocked
        ? `<li style="--i:${index}"><button type="button" class="ac-tile is-unlocked" data-hero-game="${keyAttr(item.game)}" data-achievement="${item.id}" aria-label="${esc(label)}. 그 경기 보기">${body}</button></li>`
        : `<li style="--i:${index}"><div class="ac-tile is-locked${near ? ' is-near' : ''}${item.unknown ? ' is-unknown' : ''}" data-achievement="${item.id}" role="group" aria-label="${esc(label)}">${body}</div></li>`;
    }).join('');
    return `<section class="ac-wall" aria-labelledby="achievementHeading"><div class="ac-head"><div><span class="ac-kicker">ACHIEVEMENTS</span><h3 id="achievementHeading">업적 <b><span data-count-key="achievements-done" data-count-value="${done}" data-count-digits="0">${done}</span></b> / ${list.length}</h3></div><p>${options.scope ? `${esc(options.scope)} · ` : ''}경기 기록에서 조건을 처음 만족한 경기를 찾아 표시합니다. 달성한 업적을 누르면 그 경기로 이동합니다.</p></div><ol class="ac-grid">${tiles}</ol></section>`;
  }

  // Story slides for the recap dialog. Count-up targets carry the exact text.
  const counted = (key, value, digits = 0, suffix = '') => typeof value === 'number' && Number.isFinite(value) ? `<span data-count-key="${key}" data-count-value="${Number(value.toFixed(digits))}" data-count-digits="${digits}"${suffix ? ` data-count-suffix="${suffix}"` : ''}>${fmt(value, digits)}${suffix}</span>` : '—';
  function renderStory(data, options = {}) {
    if (!data) return [];
    const I = insights();
    const token = (name, cls = 'pt-token-lg') => I.championToken(name, cls);
    const ribbon = (games, cls = '') => `<div class="rc-ribbon ${cls}" aria-hidden="true">${games.map((game, index) => `<i class="${game.won === true ? 'is-win' : 'is-loss'}" style="--i:${index}"></i>`).join('')}</div>`;
    // CHR_Web brand corner (design-tokens.json frame.corner polygons) on light slides.
    const corner = '<svg class="rc-corner" viewBox="0 0 520 321" aria-hidden="true"><path class="rc-corner-blue" d="M0 40 310 50 0 321Z"/><path class="rc-corner-navy" d="M0 0h330l-20 50L0 115Z"/><path class="rc-corner-aux" d="M330 0h190L310 50Z"/></svg>';
    const LIGHT = new Set(['intro', 'lane', 'day', 'achievements']);
    const slides = [];
    const add = (kind, kicker, html, note = '', celebrate = false) => slides.push(`<section class="rc-slide rc-${kind}${LIGHT.has(kind) ? ' rc-light' : ''}" aria-roledescription="slide"${celebrate ? ' data-celebrate=""' : ''}>${LIGHT.has(kind) ? corner : ''}<span class="rc-kicker">${kicker}</span>${html}${note ? `<p class="rc-note">${note}</p>` : ''}</section>`);
    add('intro', options.demo ? 'SEASON RECAP · 가상 데이터' : 'SEASON RECAP', `<h3 class="rc-title">${esc(data.name)}의<br>내전 리캡</h3><p class="rc-sub">${esc(fullDate(data.first.date))} – ${esc(fullDate(data.last.date))}</p><p class="rc-big">${counted('rc-games', data.games)}<small>경기의 기록</small></p>${ribbon(data.all, 'rc-ribbon-intro')}`, '화면을 누르거나 → 키로 넘깁니다.');
    add('first', 'WHERE IT STARTED', `<p class="rc-lead">모든 건 이 경기에서 시작됐습니다</p><div class="rc-hero-row">${token(data.first.champion)}<div><p class="rc-big rc-big-sm">${esc(data.first.champion || '챔피언 미입력')}</p><p class="rc-sub">${esc(fullDate(data.first.date))} · ${ROLE[data.first.position] || '포지션 미입력'} · <b class="${data.first.won === true ? 'rc-win' : 'rc-loss'}">${data.first.won === true ? '승리' : '패배'}</b></p></div></div>`);
    add('record', 'RECORD', `<p class="rc-big rc-record"><span class="rc-win">${counted('rc-wins', data.wins)}<small>승</small></span><span class="rc-slash">/</span><span class="rc-loss">${counted('rc-losses', data.losses)}<small>패</small></span></p><div class="rc-meter" aria-hidden="true"><i style="--bar:${data.games ? data.wins / data.games * 100 : 0}%"></i></div><p class="rc-sub">승률 <b>${data.winRate == null ? '—' : counted('rc-rate', data.winRate, 1, '%')}</b></p>`);
    if (data.lane) add('lane', 'YOUR LANE', `<p class="rc-lead">가장 많이 선 라인은</p><p class="rc-big rc-huge">${ROLE[data.lane.id]}</p><p class="rc-sub">${data.lane.games}경기 · 전체의 ${counted('rc-lane-share', data.lane.share, 1, '%')}</p><ul class="rc-bars">${data.laneCounts.map(item => `<li><span>${ROLE_KO[item.id]}</span><i style="--bar:${item.games / data.games * 100}%"></i><b>${item.games}</b></li>`).join('')}</ul>`);
    if (data.champion) add('champion', 'MOST PICKED', `<p class="rc-lead">가장 자주 꺼낸 챔피언</p><div class="rc-hero-row">${token(data.champion.name, 'pt-token-xl')}<div><p class="rc-big rc-big-sm">${esc(data.champion.name)}</p><p class="rc-sub">${counted('rc-champion-games', data.champion.games)}경기 · ${data.champion.wins}승 ${data.champion.losses}패</p></div></div><p class="rc-sub">플레이한 챔피언 ${data.championCount}종</p>${data.mostWins ? `<p class="rc-sub">가장 많이 이긴 챔피언은 <b>${esc(data.mostWins.name)}</b> · ${data.mostWins.wins}승</p>` : ''}`);
    if (data.bestDay) add('day', 'BEST DAY', `<p class="rc-lead">가장 많이 이긴 날</p><p class="rc-big rc-big-sm">${esc(fullDate(data.bestDay.date))}</p><p class="rc-big rc-record"><span class="rc-win">${counted('rc-day-wins', data.bestDay.wins)}<small>승</small></span><span class="rc-slash">/</span><span class="rc-loss">${data.bestDay.losses}<small>패</small></span></p>${ribbon(data.bestDay.games, 'rc-ribbon-day')}`);
    if (data.streak) {
      const ongoing = data.current?.won === true && data.current.count === data.streak.count && I.gameKey(data.streak.end) === I.gameKey(data.last);
      add('streak', 'LONGEST WIN STREAK', `<p class="rc-lead">가장 길게 이어간 연승</p><p class="rc-big rc-huge">${counted('rc-streak', data.streak.count)}<small>연승</small></p><p class="rc-sub">${esc(shortDate(data.streak.start.date))} – ${esc(shortDate(data.streak.end.date))}</p>${ongoing ? '<p class="rc-flag">그리고 아직 진행 중</p>' : data.current?.won === true ? `<p class="rc-sub">지금은 ${data.current.count}연승 중</p>` : ''}`, '', true);
    }
    if (data.highs) add('highs', 'CAREER HIGHS', `<p class="rc-lead">K/D/A가 모두 기록된 ${data.highs.games}경기에서</p><dl class="rc-highs"><div><dt>한 판 최다 킬</dt><dd>${counted('rc-max-kills', data.highs.kills?.kills)}</dd><small>${esc(data.highs.kills?.champion || '')} · ${esc(shortDate(data.highs.kills?.date))}</small></div><div><dt>한 판 최다 어시스트</dt><dd>${counted('rc-max-assists', data.highs.assists?.assists)}</dd><small>${esc(data.highs.assists?.champion || '')} · ${esc(shortDate(data.highs.assists?.date))}</small></div><div><dt>무데스 경기</dt><dd>${counted('rc-deathless', data.highs.deathless)}</dd><small>누적 킬 ${fmt(data.highs.totalKills)} · 어시스트 ${fmt(data.highs.totalAssists)}</small></div></dl>`);
    if (data.teammate) add('mate', 'BEST DUO', `<p class="rc-lead">가장 많이 같은 팀이 된 동료</p><p class="rc-big rc-big-sm">${esc(data.teammate.name)}</p><p class="rc-sub">${data.teammate.games}경기 · ${data.teammate.wins}승 ${data.teammate.losses}패</p>`);
    add('achievements', 'ACHIEVEMENTS', `<p class="rc-lead">달성한 업적</p><p class="rc-big rc-huge">${counted('rc-achievements', data.achievements.unlocked)}<small>/ ${data.achievements.total}</small></p>${data.achievements.next ? `<p class="rc-next"><span>다음 목표</span><b>${esc(data.achievements.next.title)}</b><em>${esc(data.achievements.next.hint)}</em></p>` : '<p class="rc-flag">모든 업적 달성</p>'}`);
    add('outro', 'YOUR TURN', `<h3 class="rc-title">이제 한 판씩<br>직접 파고들 차례</h3><p class="rc-sub">라인·챔피언을 고르고 그래프를 끌어 보세요.</p><div class="rc-actions"><button type="button" class="rc-cta" data-recap-explore="">플레이 탐색하기 →</button><button type="button" class="rc-again" data-recap-again="">처음부터 다시</button></div>`);
    return slides;
  }

  const api = Object.freeze({ achievements, recap, renderAchievements, renderStory, DEFS });
  root.LoLPlayerRecap = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
