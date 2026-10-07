'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../domain/core.cjs');
const S = require('../domain/player-stats.cjs');

const person = (id, name = id, extra = {}) => ({ id, name, tier: 'silver', primary: 'mid', secondary: ['top'], excluded: [], active: true, ...extra });
function game({ winner = 0, role = 'mid', detail = {}, players, durationSeconds = 1800, teams, ...extra } = {}) {
  return { winner, durationSeconds, externalId: null, draw: { createdAt: '2026-10-01T10:00:00.000Z', teams: teams || [[{ id: 'a', role }], [{ id: 'opponent', role: 'mid' }]] }, players: players || [{ id: 'a', champion: 'Ahri', kills: 1, deaths: 1, assists: 1, cs: 100, ...detail }, { id: 'opponent' }], ...extra };
}
function series(id, games, extra = {}) {
  return { id, date: '2026-10-01', endedAt: '2026-10-01T10:30:00.000Z', bestOf: 1, status: 'completed', roster: [person('a', '선수 A'), person('opponent')], results: games.map(item => item.winner), games, teamNames: ['A 팀', 'B 팀'], ...extra };
}
function fixture() {
  const kills = [8, 6, 5, 4, 2, 1, 7, 9, 3, 10];
  const deaths = [0, 2, 4, 2, 5, 3, 1, 6, 2, 5];
  const assists = [11, 8, 6, 7, 2, 4, 9, 3, 5, 6];
  const cs = [184, 170, 120, 150, 100, 80, 200, 210, 90, null];
  const seconds = [1934, 1800, 1500, null, 1200, 1000, 2000, 2100, 900, 1800];
  const winners = [0, 0, 1, 0, 1, 0, 1, 0, 1, 0];
  const history = kills.map((kill, index) => {
    const date = `2026-10-${String(index + 1).padStart(2, '0')}`;
    const match = game({ winner: winners[index], role: [4, 6, 8].includes(index) ? 'top' : 'mid', durationSeconds: seconds[index], detail: { kills: kill, deaths: deaths[index], assists: assists[index], cs: cs[index], champion: ['Ahri', 'Orianna', 'Lux'][index % 3] } });
    if (index === 0) { match.draw.teams[0].push({ id: 'b', role: 'support' }); match.players.push({ id: 'b', champion: 'Lulu', kills: 0, deaths: 0, assists: 11, cs: 0 }); }
    return series(`series-${index}`, [match], { date, endedAt: `${date}T10:30:00.000Z` });
  });
  return { roster: [person('a', '선수 A'), person('b', '선수 B'), person('c', '선수 C')], history };
}

// A manually specified ten-game scenario: six wins, four losses, three
// champions, two actual positions, one deathless game, and incomplete old data.
test('A ten-game fixture computes exact totals, paired CS/min, profiles, and sample sizes', () => {
  const detail = S.selectPlayer(fixture(), 'a');
  assert.equal(detail.totals.games, 10);
  assert.equal(detail.totals.wins, 6);
  assert.equal(detail.totals.losses, 4);
  assert.equal(detail.totals.winRate, 60);
  assert.deepEqual(detail.totals.kda, { games: 10, kills: 55, deaths: 30, assists: 61, ratio: 116 / 30, perfect: false });
  assert.equal(detail.totals.averages.kills, 5.5);
  assert.equal(detail.totals.averages.deaths, 3);
  assert.equal(detail.totals.averages.assists, 6.1);
  assert.equal(detail.totals.averages.cs, 1304 / 9);
  assert.equal(detail.totals.samples.cs, 9);
  assert.equal(detail.totals.csPerMinute, 1154 / (12434 / 60));
  assert.equal(detail.totals.csPerMinuteGames, 8);
  assert.equal(detail.totals.averages.damage, null);
  assert.equal(detail.totals.samples.damage, 0);
  assert.equal(detail.seriesCount, 10);
  assert.equal(detail.totals.seriesWins, 6);
  assert.equal(detail.totals.seriesLosses, 4);
  assert.equal(detail.profile.primary, 'mid');
});

test('position groups use played slots; champions rank by games without invented missing groups', () => {
  const detail = S.selectPlayer(fixture(), 'a');
  assert.deepEqual(detail.positions.map(value => value.id), ['top', 'jungle', 'mid', 'adc', 'support']);
  const top = detail.positions.find(value => value.id === 'top');
  const mid = detail.positions.find(value => value.id === 'mid');
  assert.deepEqual([top.games, top.wins, top.losses], [3, 0, 3]);
  assert.deepEqual([mid.games, mid.wins, mid.losses], [7, 6, 1]);
  assert.equal(top.kda.ratio, (2 + 7 + 3 + 2 + 9 + 5) / (5 + 1 + 2));
  assert.equal(top.averages.cs, 130);
  assert.equal(top.csPerMinute, 390 / (4100 / 60));
  assert.equal(detail.positions.find(value => value.id === 'adc').winRate, null);
  assert.deepEqual(detail.champions.map(value => [value.name, value.games]), [['Ahri', 4], ['Orianna', 3], ['Lux', 3]]);
  assert.equal(detail.champions[0].wins, 3);
});

test('latest-first recent games, full history, last five form, and full streak are stable', () => {
  const detail = S.selectPlayer(fixture(), 'a');
  assert.equal(detail.recent.length, 10);
  assert.deepEqual(detail.recent.map(row => row.date), ['2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07', '2026-10-06', '2026-10-05', '2026-10-04', '2026-10-03', '2026-10-02', '2026-10-01']);
  assert.deepEqual(detail.form, { games: 5, wins: 3, losses: 2, results: [true, false, true, false, true], streak: { won: true, count: 1 } });
  assert.deepEqual(S.getRecentForm(Array.from({ length: 8 }, (_, i) => ({ won: false, date: `2026-10-${String(i + 1).padStart(2, '0')}` }))).streak, { won: false, count: 8 });
  assert.equal(detail.recent[9].kda.perfect, true);
  assert.equal(detail.recent[9].kda.ratio, null);
  assert.equal(detail.recent[9].teamName, 'A 팀');
  assert.equal(detail.recent[9].archived, true);
});

test('one game and zero-game registered players display genuine zeroes and missing values separately', () => {
  const state = fixture(), b = S.selectPlayer(state, 'b'), c = S.selectPlayer(state, 'c');
  assert.equal(b.totals.games, 1);
  assert.equal(b.totals.winRate, 100);
  assert.equal(b.totals.kda.perfect, true);
  assert.equal(b.totals.averages.kills, 0);
  assert.equal(b.totals.averages.cs, 0);
  assert.equal(b.totals.csPerMinute, 0);
  assert.equal(b.form.games, 1);
  assert.deepEqual(c.form, { games: 0, wins: 0, losses: 0, results: [], streak: { won: null, count: 0 } });
  assert.equal(c.totals.winRate, null);
  assert.equal(c.totals.averages.cs, null);
  assert.equal(c.totals.csPerMinute, null);
  assert.deepEqual(c.totals.kda, { games: 0, kills: null, deaths: null, assists: null, ratio: null, perfect: false });
  assert.equal(c.profile.registered, true);
  assert.equal(S.selectPlayer(state, 'missing'), null);
});

test('partial KDA triples use per-metric averages but only complete games for aggregate KDA', () => {
  const rows = [{ won: true, kills: 10, deaths: null, assists: 8, cs: 0, durationSeconds: 1200 }, { won: false, kills: 2, deaths: 2, assists: 6, cs: null, durationSeconds: 2000 }, { won: true, deaths: 0, assists: 0 }];
  const totals = S.aggregateStats(rows);
  assert.deepEqual(totals.kda, { games: 1, kills: 2, deaths: 2, assists: 6, ratio: 4, perfect: false });
  assert.deepEqual(totals.samples, { kills: 2, deaths: 2, assists: 3, cs: 1, damage: 0, gold: 0, vision: 0 });
  assert.equal(totals.averages.kills, 6);
  assert.equal(totals.averages.deaths, 1);
  assert.equal(totals.averages.assists, 14 / 3);
  assert.equal(totals.csPerMinute, 0);
});

test('CS/min sums paired values and durations and never averages per-game ratios', () => {
  const result = S.calculateCsPerMinute([{ cs: 100, durationSeconds: 600 }, { cs: 100, durationSeconds: 1800 }, { cs: 400, durationSeconds: null }, { cs: null, durationSeconds: 100 }, { cs: 500, durationSeconds: 0 }]);
  assert.deepEqual(result, { value: 5, games: 2, totalCs: 200, totalDurationSeconds: 2400 });
  assert.deepEqual(S.calculateCsPerMinute([]), { value: null, games: 0, totalCs: null, totalDurationSeconds: null });
  assert.deepEqual(S.calculateKDA(0, 0, 0), { ratio: null, perfect: true });
  assert.deepEqual(S.calculateKDA(null, 0, 1), { ratio: null, perfect: false });
  assert.equal(S.calculateWinRate(5, 9), 5 / 9 * 100);
  assert.equal(S.calculateWinRate(0, 0), null);
});

test('unknown actual position/champion still counts overall without a guessed main-position group', () => {
  const state = { roster: [person('a')], history: [series('unknown', [game({ role: null, detail: { champion: null } })])] };
  const detail = S.selectPlayer(state, 'a');
  assert.equal(detail.totals.games, 1);
  assert.equal(detail.positions.reduce((total, value) => total + value.games, 0), 0);
  assert.deepEqual(detail.champions, []);
  assert.deepEqual(detail.missing, { position: 1, champion: 1 });
  assert.equal(detail.recent[0].position, null);
});

test('legacy results-only matches include participation and leave all uncollected measurements null', () => {
  const old = series('old', [game()]);
  old.draw = old.games[0].draw;
  delete old.games;
  const detail = S.selectPlayer({ roster: [], history: [old] }, 'a');
  assert.equal(detail.totals.games, 1);
  assert.equal(detail.totals.wins, 1);
  assert.equal(detail.totals.kda.games, 0);
  assert.equal(detail.recent[0].champion, null);
  assert.equal(detail.recent[0].cs, null);
  assert.equal(detail.recent[0].durationSeconds, null);
  assert.deepEqual(detail.positions.find(value => value.id === 'mid').samples, { kills: 0, deaths: 0, assists: 0, cs: 0, damage: 0, gold: 0, vision: 0 });
});

test('current unarchived games immediately appear and archived copy is replaced rather than counted twice', () => {
  const first = game(), second = game({ winner: 1, detail: { kills: 5 } });
  const state = { roster: [person('a')], seriesId: 'live', matchDate: '2026-10-02', bestOf: 3, results: [0], games: [first], draw: first.draw, history: [] };
  let detail = S.selectPlayer(state, 'a');
  assert.equal(detail.totals.games, 1);
  assert.equal(detail.recent[0].ongoing, true);
  assert.equal(detail.recent[0].archived, false);
  state.history = [series('live', [first, second], { bestOf: 3, status: 'stopped' })];
  detail = S.selectPlayer(state, 'a');
  assert.equal(detail.totals.games, 1);
  assert.equal(detail.recent[0].archived, false);
  state.results = [0, 0]; state.games = [first, first];
  detail = S.selectPlayer(state, 'a');
  assert.equal(detail.totals.games, 2);
  assert.equal(detail.totals.seriesWins, 1);
  assert.equal(detail.recent[0].archived, true);
  assert.equal(detail.recent[0].setNumber, 2);
  state.results = []; state.games = [];
  assert.equal(S.selectPlayer(state, 'a').totals.games, 0);
});

test('record correction and deletion recompute all totals and groups without cached derived storage', () => {
  const state = fixture();
  const before = S.selectPlayer(state, 'a');
  state.history[0].results[0] = 1;
  state.history[0].games[0].winner = 1;
  state.history[0].games[0].players[0].champion = 'Orianna';
  state.history[0].games[0].draw.teams[0][0].role = 'top';
  const corrected = S.selectPlayer(state, 'a');
  assert.equal(before.totals.wins, 6);
  assert.equal(corrected.totals.wins, 5);
  assert.equal(corrected.totals.winRate, 50);
  assert.equal(corrected.positions.find(value => value.id === 'top').games, 4);
  assert.equal(corrected.champions.find(value => value.name === 'Orianna').games, 4);
  state.history.splice(0, 1);
  const deleted = S.selectPlayer(state, 'a');
  assert.equal(deleted.totals.games, 9);
  assert.equal(deleted.totals.wins, 5);
  assert.equal(deleted.champions.find(value => value.name === 'Orianna').games, 3);
  assert.equal(S.selectPlayer(state, 'b').totals.games, 0);
});

test('cancelled or invalid games and series do not contribute; stopped valid games remain eligible', () => {
  const history = [series('stopped', [game()], { bestOf: 3, status: 'stopped' }), series('canceled-series', [game()], { status: 'cancelled' })];
  ['cancelled', 'canceled', 'invalid'].forEach(flag => history.push(series(flag, [game({ [flag]: true })])));
  history.push(series('void', [game({ status: 'void' })]), series('invalid-winner', [game({ winner: null })]), series('invalid-valid', [game({ valid: false })]));
  const detail = S.selectPlayer({ roster: [], history }, 'a');
  assert.equal(detail.totals.games, 1);
  assert.equal(detail.totals.seriesWins, 0);
});

test('duplicate player input invalidates the game instead of double-counting or choosing arbitrary stats', () => {
  const duplicateStats = game(); duplicateStats.players.push({ ...duplicateStats.players[0], kills: 90 });
  const duplicateSlot = game(); duplicateSlot.draw.teams[1].push({ id: 'a', role: 'top' });
  const unassigned = game(); unassigned.players.push({ id: 'intruder' });
  const mismatch = series('mismatch', [game()]); mismatch.results[0] = 1;
  const malformedGames = series('malformed', [game()]); malformedGames.games = null;
  const history = [series('stats', [duplicateStats]), series('slot', [duplicateSlot]), series('extra', [unassigned]), mismatch, malformedGames];
  assert.equal(S.selectPlayer({ roster: [person('a')], history }, 'a').totals.games, 0);
});

test('same-series team changes preserve per-game W/L and avoid fabricated series wins', () => {
  const first = game();
  const second = game({ teams: [[{ id: 'opponent', role: 'mid' }], [{ id: 'a', role: 'top' }]] });
  const detail = S.selectPlayer({ roster: [], history: [series('mixed', [first, second], { bestOf: 3 })] }, 'a');
  assert.equal(detail.totals.wins, 1);
  assert.equal(detail.totals.losses, 1);
  assert.equal(detail.totals.mixedSeries, 1);
  assert.equal(detail.totals.seriesWins, 0);
  assert.equal(detail.totals.seriesLosses, 0);
  assert.equal(detail.recent[0].role, 'top');
});

test('date filtering preserves all current profiles including players with no games that day', () => {
  const state = fixture();
  const players = S.selectPlayers(state, { date: '2026-10-10' });
  assert.equal(players.find(value => value.profile.id === 'a').totals.games, 1);
  assert.equal(players.find(value => value.profile.id === 'b').totals.games, 0);
  assert.equal(players.find(value => value.profile.id === 'c').totals.games, 0);
  assert.equal(S.selectGames(state, { date: '2026-10-10' }).length, 1);
});

test('current profile wins over historical names; historical-only profiles use latest known roster', () => {
  const old = series('old', [game()], { date: '2026-09-01', roster: [person('a', '과거 A'), person('retired', '옛 이름')] });
  const recent = series('new', [game()], { date: '2026-10-01', roster: [person('a', '최근 A'), person('retired', '최신 이름')] });
  const state = { roster: [person('a', '현재 A', { tier: 'diamond' }), person('c', '신규 C')], history: [recent, old] };
  assert.equal(S.selectPlayer(state, 'a').profile.name, '현재 A');
  assert.equal(S.selectPlayer(state, 'a').profile.tier, 'diamond');
  assert.equal(S.selectPlayer(state, 'retired').profile.name, '최신 이름');
  assert.equal(S.selectPlayer(state, 'retired').profile.registered, false);
  assert.equal(S.selectPlayer(state, 'c').totals.games, 0);
  assert.equal(S.selectPlayers(null).length, 10);
  assert.ok(S.selectPlayers(null).every(value => value.totals.games === 0 && value.profile.registered));
});

test('same day ordering uses series time then descending set number, never array insertion order', () => {
  const one = series('later', [game(), game({ winner: 1 })], { bestOf: 3, endedAt: '2026-10-01T12:00:00.000Z' });
  const two = series('earlier', [game()], { endedAt: '2026-10-01T11:00:00.000Z' });
  assert.deepEqual(S.selectPlayer({ roster: [], history: [one, two] }, 'a').recent.map(row => [row.seriesId, row.setNumber]), [['later', 2], ['later', 1], ['earlier', 1]]);
});

test('known zero is distinct from missing optional legacy fields, invalid numbers are not zero-coerced', () => {
  const partial = game({ players: [{ id: 'a', kills: 0, deaths: -1, assists: '4', cs: NaN }, { id: 'opponent' }] });
  delete partial.durationSeconds;
  const detail = S.selectPlayer({ roster: [], history: [series('partial', [partial])] }, 'a');
  assert.equal(detail.totals.averages.kills, 0);
  assert.equal(detail.totals.averages.deaths, null);
  assert.equal(detail.totals.averages.assists, null);
  assert.equal(detail.totals.averages.cs, null);
  assert.equal(detail.totals.csPerMinute, null);
  assert.equal(detail.recent[0].champion, null);
});

test('champion grouping safely supports arbitrary strings and normalizes only whitespace and case', () => {
  const groups = S.aggregateByChampion([{ won: true, champion: ' Ahri ' }, { won: false, champion: 'ahri' }, { won: true, champion: '__proto__' }, { won: false, champion: null }]);
  assert.equal(groups[0].name, 'Ahri');
  assert.equal(groups[0].games, 2);
  assert.equal(groups[1].name, '__proto__');
  assert.equal(groups.length, 2);
});

test('teammates preserve stable IDs and calculate same-team game outcomes', () => {
  const detail = S.selectPlayer(fixture(), 'a');
  assert.deepEqual(detail.teammates, [{ id: 'b', name: '선수 B', games: 1, wins: 1, losses: 0, winRate: 100 }]);
});

test('selectors do not mutate source state and expose no invented performance/MMR measurements', () => {
  const state = fixture(), serialized = JSON.stringify(state);
  const result = S.selectPlayer(state, 'a');
  S.selectPlayers(state); S.selectGames(state);
  assert.equal(JSON.stringify(state), serialized);
  assert.equal(Object.hasOwn(result.totals, 'performanceScore'), false);
  assert.equal(Object.hasOwn(result.profile, 'internalMMR'), false);
  result.profile.secondary.push('jungle');
  assert.equal(JSON.stringify(state), serialized);
});

test('browser UMD export and CommonJS expose the same pure selector behavior', () => {
  const context = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../domain/core.cjs'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../domain/player-stats.cjs'), 'utf8'), context);
  assert.equal(context.LoLPlayerStats.selectPlayers(null).length, 10);
  assert.equal(context.LoLPlayerStats.calculateWinRate(6, 10), 60);
});

test('structurally inconsistent series are wholly excluded instead of exposing a plausible partial score', () => {
  const afterClinch = series('after-clinch', [game(), game(), game({ winner: 1 })], { bestOf: 3 });
  const tooFew = series('too-few', [game(), game({ winner: 1 })], { bestOf: 3 }); tooFew.games.pop();
  const tooMany = series('too-many', [game()], { bestOf: 3 }); tooMany.games.push(game({ winner: 1 }));
  const conflict = series('conflict', [game(), game({ winner: 1 })], { bestOf: 3 }); conflict.results[1] = 0;
  const missingResults = series('missing-results', [game()]); delete missingResults.results;
  const stopped = series('stopped', [game(), game({ winner: 1 })], { bestOf: 3, status: 'stopped' });
  const state = { roster: [person('a')], history: [afterClinch, tooFew, tooMany, conflict, missingResults, stopped] };
  const result = S.selectPlayer(state, 'a');
  assert.deepEqual(result.recent.map(row => row.seriesId), ['stopped', 'stopped']);
  assert.equal(result.totals.games, 2);
  assert.equal(result.totals.wins, 1);
  assert.equal(result.totals.losses, 1);
  assert.equal(result.totals.seriesWins, 0);
  assert.equal(result.totals.seriesLosses, 0);
});

test('omitting a cancelled set cannot turn a remaining completed-looking sequence into a series win', () => {
  const archived = series('cancelled-set', [game(), game({ winner: 1, cancelled: true }), game()], { bestOf: 3 });
  const result = S.selectPlayer({ roster: [], history: [archived] }, 'a');
  assert.equal(result.totals.games, 2);
  assert.equal(result.totals.wins, 2);
  assert.equal(result.totals.seriesWins, 0);
  assert.equal(result.totals.seriesLosses, 0);
  assert.equal(result.recent[0].seriesComplete, false);
  assert.equal(result.recent[0].seriesWinner, null);
});
