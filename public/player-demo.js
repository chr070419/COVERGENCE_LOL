(function (root) {
  'use strict';

  const C = root.LoLCore || (typeof require === 'function' ? require('../domain/core.cjs') : null);
  const H = root.LoLHistory || (typeof require === 'function' ? require('../domain/history-core.cjs') : null);
  if (!C || !H) throw new Error('데모 성적을 불러오기 전에 경기 규칙과 기록 모듈을 불러와주세요.');

  const PLAYER_ID = 'haeram';
  // A detached, read-only preview source. It never reads or writes SiteData,
  // storage, or a server. All displayed totals still use the normal selectors.
  const DAYS = Object.freeze(['2026-09-23', '2026-09-25', '2026-09-27', '2026-09-29', '2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07']);
  // Oldest first: champion, actual role, result, K/D/A, CS, seconds, damage.
  const MATCHES = Object.freeze([
    ['Gnar', 'top', true, 5, 3, 9, 207, 1980, null],
    ['Ahri', 'mid', false, 4, 6, 7, null, 1830, 18200],
    ['Orianna', 'mid', true, 6, 2, 14, 228, null, 26400],
    ['Renekton', 'top', false, 3, 7, 5, 186, 2010, 21800],
    ['Sylas', 'mid', true, 9, 4, 11, 192, 1740, 29700],
    ['Ahri', 'mid', false, 5, 5, 8, 215, 1920, null],
    ['Ornn', 'top', true, 2, 3, 18, 180, 1800, 18700],
    ['Orianna', 'mid', false, 4, 4, 12, 242, 2130, 27800],
    ['Ahri', 'mid', false, 6, 6, 9, 205, 1860, 23100],
    ['Gnar', 'top', true, 7, 3, 10, 236, 2040, 28400],
    ['Sylas', 'mid', true, 10, 4, 8, 201, 1770, 32900],
    ['Orianna', 'mid', false, 3, 5, 11, 249, 2160, null],
    ['Renekton', 'top', true, 8, 3, 7, 225, 1890, 27600],
    ['Ahri', 'mid', false, 5, 5, 9, 218, 1950, 24300],
    ['Orianna', 'mid', true, 7, 2, 16, 257, 2100, 31100],
    ['Ornn', 'top', true, 3, 2, 21, 198, 1920, 22400],
    ['Sylas', 'mid', false, 8, 7, 6, 187, 1800, 29100],
    ['Ahri', 'mid', true, 9, 2, 13, 233, 1860, 31800],
    ['Gnar', 'top', true, 6, 3, 12, 241, 2070, 26800],
    ['Orianna', 'mid', false, 6, 4, 10, 263, 2190, 30100],
    ['Ahri', 'mid', true, 11, 2, 9, 245, 1950, 34400],
    ['Renekton', 'top', true, 8, 2, 11, 238, 1980, 30600],
    ['Sylas', 'mid', true, 14, 0, 11, 221, 1830, 38700],
    ['Ahri', 'mid', true, 10, 2, 15, 252, 2010, 35600]
  ].map(Object.freeze));

  function roster() {
    const haeram = C.DEFAULT_ROSTER.find(person => person.id === PLAYER_ID);
    return [
      { ...haeram, secondary: haeram.secondary.slice(), excluded: haeram.excluded.slice(), currentNickname: null, nicknameAliases: [] },
      ...['demo-01', 'demo-02', 'demo-03', 'demo-04', 'demo-05', 'demo-06', 'demo-07', 'jongwon', 'minjae'].map((id, index) => ({
        id, name: '데모 참가자 ' + String(index + 1).padStart(2, '0'), tier: 'silver', primary: 'fill', secondary: [], excluded: [], active: true,
        currentNickname: null, nicknameAliases: []
      }))
    ];
  }

  function draw(people, role, createdAt) {
    const teams = [
      [{ id: role === 'top' ? PLAYER_ID : 'demo-01', role: 'top' }, { id: 'demo-02', role: 'jungle' }, { id: role === 'mid' ? PLAYER_ID : 'demo-01', role: 'mid' }, { id: 'jongwon', role: 'adc' }, { id: 'demo-03', role: 'support' }],
      [{ id: 'demo-04', role: 'top' }, { id: 'demo-05', role: 'jungle' }, { id: 'demo-06', role: 'mid' }, { id: 'minjae', role: 'adc' }, { id: 'demo-07', role: 'support' }]
    ];
    const constraints = C.normalizeShuffleOptions();
    return { teams, constraints, mode: 'balanced', createdAt, metrics: C.summarize(teams, people, constraints) };
  }

  function createState() {
    const state = {
      version: 1, archiveVersion: 1, roster: roster(), mode: 'balanced', shuffleOptions: C.normalizeShuffleOptions(),
      bestOf: 1, draw: null, results: [], games: [], drawNumber: 0, seriesId: 'demo-haeram-preview', matchDate: '2026-10-07', history: []
    };
    state.history = MATCHES.map((entry, index) => {
      const [champion, role, won, kills, deaths, assists, cs, durationSeconds, damage] = entry;
      const date = DAYS[Math.floor(index / 3)], hour = String(10 + index % 3).padStart(2, '0');
      const people = roster(), composition = draw(people, role, date + 'T' + hour + ':00:00.000Z');
      const players = people.map(person => ({ id: person.id, champion: null, nicknameAtMatch: null, kills: null, deaths: null, assists: null, cs: null, damage: null, gold: null, vision: null }));
      Object.assign(players.find(person => person.id === PLAYER_ID), { champion, kills, deaths, assists, cs, damage, gold: 11200 + index * 125 + kills * 180, vision: 15 + (index % 6) * 3 });
      const winner = won ? 0 : 1;
      return {
        id: 'demo-haeram-' + String(index + 1).padStart(2, '0'), date, endedAt: date + 'T' + hour + ':45:00.000Z', status: 'completed',
        bestOf: 1, results: [winner], drawNumber: index + 1, roster: people, draw: composition, teamNames: ['데모 블루', '데모 레드'],
        games: [{ winner, draw: composition, durationSeconds, externalId: null, notes: '화면 체험용 가상 경기입니다. 실제 전적에 포함되지 않습니다.', players }]
      };
    });
    // Use the same validation and canonical cloning as real imported matches.
    // Fixed IDs and dates prevent upgrade() from requesting time or random IDs.
    return H.upgrade(state);
  }

  const api = Object.freeze({ PLAYER_ID, createState });
  root.LoLPlayerDemo = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
