'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const C = require('../domain/core.cjs');
const H = require('../domain/history-core.cjs');
const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const state = C.createDefaultState();
  const teams = [
    [{ id: 'injae', role: 'top' }, { id: 'seongpyo', role: 'jungle' }, { id: 'haeram', role: 'mid' }, { id: 'jongwon', role: 'adc' }, { id: 'seungju', role: 'support' }],
    [{ id: 'dongin', role: 'top' }, { id: 'changwoo', role: 'jungle' }, { id: 'junhyeok', role: 'mid' }, { id: 'minjae', role: 'adc' }, { id: 'sejun', role: 'support' }]
  ];
  const constraints = C.normalizeShuffleOptions();
  state.draw = { teams, metrics: C.summarize(teams, state.roster, constraints), createdAt: '2026-10-07T12:00:00.000Z', mode: 'balanced', constraints };
  state.drawNumber = 1;
  return H.upgrade(state);
}
function swapTop(state) {
  const draw = clone(state.draw);
  [draw.teams[0][0].id, draw.teams[1][0].id] = [draw.teams[1][0].id, draw.teams[0][0].id];
  draw.metrics = C.summarize(draw.teams, state.roster, draw.constraints);
  draw.adjusted = true;
  return draw;
}
function details(state, values = {}) {
  return { durationSeconds: 1800, externalId: null, notes: '', players: state.draw.teams.flat().map(slot => ({ id: slot.id, champion: null, kills: null, deaths: null, assists: null, damage: null, cs: null, gold: null, vision: null, ...(slot.id === 'injae' ? values : {}) })) };
}

test('legacy current and archived results synthesize detached set lineups without invented stats', () => {
  let state = H.recordGame(H.recordGame(fixture(), 0), 0);
  const raw = clone(state);
  delete raw.games;
  delete raw.history[0].games;
  const upgraded = H.upgrade(raw);
  assert.equal(upgraded.games.length, 2);
  assert.equal(upgraded.history[0].games.length, 2);
  for (const game of upgraded.games.concat(upgraded.history[0].games)) {
    assert.deepEqual(game.draw, raw.draw);
    assert.equal(game.durationSeconds, null);
    assert.equal(game.externalId, null);
    assert.equal(game.notes, '');
    assert.equal(game.players.length, 10);
    game.players.forEach(player => {
      assert.equal(player.champion, null);
      Object.keys(H.STAT_LIMITS).forEach(key => assert.equal(player[key], null));
    });
  }
  upgraded.games[0].draw.teams[0][0].id = 'changed';
  assert.equal(upgraded.games[1].draw.teams[0][0].id, 'injae');
  assert.equal(upgraded.history[0].games[0].draw.teams[0][0].id, 'injae');
  assert.ok(H.validate(state));
});

test('setNextDraw preserves series, scores, all played lineups and original inputs', () => {
  const initial = fixture();
  const first = H.recordGame(initial, 0, details(initial, { champion: '제이스', kills: 4, deaths: 2, assists: 8 }));
  const before = clone(first);
  const draw = swapTop(first);
  const next = H.setNextDraw(first, draw);
  assert.equal(next.seriesId, first.seriesId);
  assert.deepEqual(next.results, [0]);
  assert.deepEqual(next.games, before.games);
  assert.equal(next.draw.teams[1][0].id, 'injae');
  assert.equal(next.games[0].draw.teams[0][0].id, 'injae');
  assert.equal(next.drawNumber, first.drawNumber + 1);
  draw.teams[0][0].id = 'mutated';
  assert.equal(next.draw.teams[0][0].id, 'dongin');
  assert.deepEqual(first, before);
});

test('recording and undo preserve the played draw and coherent completion archive', () => {
  let state = H.recordGame(fixture(), 0);
  state = H.setNextDraw(state, swapTop(state));
  state = H.recordGame(state, 0);
  const complete = clone(state);
  assert.equal(state.history.length, 1);
  assert.deepEqual(state.history[0].games, state.games);
  assert.throws(() => H.setNextDraw(state, swapTop(state)), RangeError);
  assert.throws(() => H.recordGame(state, 1), RangeError);
  state = H.undoGame(state);
  assert.deepEqual(state.results, [0]);
  assert.equal(state.games.length, 1);
  assert.equal(state.history.length, 0);
  assert.deepEqual(state.draw, complete.games[1].draw);
  assert.deepEqual(state.games[0], complete.games[0]);
  state = H.undoGame(state);
  assert.deepEqual(state.results, []);
  assert.deepEqual(state.games, []);
  assert.deepEqual(state.draw, complete.games[0].draw);
  assert.deepEqual(H.undoGame(state), state);
});

test('game-level win/loss, roles, champions and teammates follow each played lineup', () => {
  let state = fixture();
  state = H.recordGame(state, 0, details(state, { champion: '제이스', kills: 4, deaths: 2, assists: 8 }));
  state = H.setNextDraw(state, swapTop(state));
  state = H.recordGame(state, 1, details(state, { champion: '제이스', kills: 8, deaths: 0, assists: 2 }));
  state = H.recordGame(state, 0);
  const summary = H.summarize(state.history);
  const person = summary.players.find(player => player.id === 'injae');
  assert.deepEqual([person.gameWins, person.gameLosses, person.seriesWins, person.seriesLosses, person.mixedSeries], [2, 1, 0, 0, 1]);
  const captain = summary.players.find(player => player.id === 'jongwon');
  assert.deepEqual([captain.gameWins, captain.gameLosses, captain.seriesWins, captain.seriesLosses, captain.mixedSeries], [2, 1, 1, 0, 0]);
  const stats = H.playerDetails(state.history, 'injae');
  assert.deepEqual([stats.games, stats.wins, stats.losses, stats.unknownChampions], [3, 2, 1, 1]);
  assert.deepEqual(stats.kda, { kills: 12, deaths: 2, assists: 10, games: 2, ratio: 11, perfect: false });
  assert.deepEqual(stats.roles[0], { id: 'top', name: '탑', games: 3, wins: 2, losses: 1, winRate: 2 / 3 * 100 });
  assert.deepEqual(stats.champions[0], { name: '제이스', games: 2, wins: 2, losses: 0, winRate: 100 });
  assert.deepEqual(stats.recent.map(game => [game.setNumber, game.teamIndex, game.won]), [[3, 1, false], [2, 1, true], [1, 0, true]]);
  assert.equal(stats.teammates.find(player => player.id === 'jongwon').games, 1);
  assert.equal(stats.teammates.find(player => player.id === 'minjae').games, 2);
  assert.equal(stats.teammates.some(player => player.id === 'injae'), false);
  assert.deepEqual(H.playerDetails([], 'injae').recent, []);
});

test('missing and partial KDA stays unknown; confirmed zero deaths are marked perfect', () => {
  let state = fixture();
  state = H.recordGame(state, 0, details(state, { kills: 10, deaths: null, assists: 10 }));
  state = H.recordGame(state, 0, details(state, { kills: 0, deaths: 0, assists: 3 }));
  const stats = H.playerDetails(state.history, 'injae');
  assert.deepEqual(stats.kda, { kills: 0, deaths: 0, assists: 3, games: 1, ratio: null, perfect: true });
  assert.equal(stats.recent[1].deaths, null);
  assert.equal(stats.recent[0].deaths, 0);
});

test('explicit malformed games, unsafe numbers, duplicate players and IDs are rejected', () => {
  const initial = fixture();
  const state = H.recordGame(initial, 0, details(initial));
  const mutations = [
    value => { value.games = []; },
    value => { value.games[0].status = 'cancelled'; },
    value => { value.games[0].invalid = true; },
    value => { value.games[0].winner = 1; },
    value => { value.games[0].durationSeconds = 0; },
    value => { value.games[0].durationSeconds = 21601; },
    value => { value.games[0].players.pop(); },
    value => { value.games[0].players[1].id = value.games[0].players[0].id; },
    value => { value.games[0].players[0].kills = -1; },
    value => { value.games[0].players[0].kills = 1001; },
    value => { value.games[0].players[0].deaths = 1.5; },
    value => { value.games[0].players[0].damage = Infinity; },
    value => { value.games[0].players[0].champion = ''; },
    value => { value.games[0].players[0].vision = '2'; },
    value => { value.games[0].externalId = ''; },
    value => { value.games[0].notes = 'x'.repeat(1001); },
    value => { value.games[0].notes = 'null\u0000'; },
    value => { value.games[0].draw.teams[0][0].id = 'missing'; },
    value => { value.games[0].draw.metrics.primary += 1; },
    value => { value.roster.push({ ...value.roster[0], id: 'extra', active: false }); }
  ];
  for (const mutate of mutations) {
    const bad = clone(state); mutate(bad);
    assert.equal(H.validate(bad), false);
    assert.throws(() => H.upgrade(bad), RangeError);
  }
  const withId = H.replaceGame(state, 0, { externalId: 'match-01' });
  assert.throws(() => H.recordGame(withId, 0, { externalId: 'match-01' }), RangeError);
  assert.throws(() => H.recordGame(initial, 0, { draw: initial.draw }), RangeError);
});

test('replaceGame attaches canonical detail to an existing set while preserving frozen lineup', () => {
  let state = H.recordGame(fixture(), 0);
  state = H.setNextDraw(state, swapTop(state));
  const nextDraw = clone(state.draw);
  const playedDraw = clone(state.games[0].draw);
  const before = clone(state);
  state = H.replaceGame(state, 0, { ...details(state, { champion: '아리', kills: 2, deaths: 0, assists: 10 }), winner: 1, externalId: 'set-001' });
  assert.deepEqual(state.results, [1]);
  assert.equal(state.games.length, 1);
  assert.deepEqual(state.draw, nextDraw);
  assert.deepEqual(state.games[0].draw, playedDraw);
  assert.equal(state.games[0].players.find(player => player.id === 'injae').champion, '아리');
  assert.deepEqual(before.results, [0]);
  assert.throws(() => H.replaceGame(state, 1, {}), RangeError);
});

test('snapshot correction syncs the active series and can restore a valid deleted record', () => {
  let state = H.recordGame(H.recordGame(fixture(), 0), 0);
  const correction = H.cloneSnapshot(state.history[0]);
  correction.games.forEach(game => { game.winner = 1; });
  correction.results = [1, 1];
  correction.date = '2026-10-08';
  correction.games[1].draw = swapTop(state);
  assert.ok(H.validateSnapshot(correction));
  const next = H.replaceSnapshot(state, correction);
  assert.deepEqual(next.results, [1, 1]);
  assert.deepEqual(next.games, correction.games);
  assert.deepEqual(next.draw, correction.games[1].draw);
  assert.deepEqual(next.history[0].draw, correction.games[1].draw);
  assert.equal(next.matchDate, '2026-10-08');
  assert.deepEqual(state.results, [0, 0]);
  const invalid = H.cloneSnapshot(correction);
  invalid.id = 'missing';
  const restored = H.replaceSnapshot(state, invalid);
  assert.equal(restored.history.length, 2);
  assert.deepEqual(restored.results, state.results);
  invalid.games[0].winner = 0;
  assert.equal(H.validateSnapshot(invalid), false);
  assert.throws(() => H.cloneSnapshot(invalid), RangeError);
});

test('editing historical snapshot leaves another active series intact and clones all fields', () => {
  const archived = H.recordGame(H.recordGame(fixture(), 0), 0);
  const current = H.newSeries(archived);
  const correction = H.cloneSnapshot(current.history[0]);
  correction.games[0].notes = '승리 화면 재확인';
  correction.games[0].players[0].champion = '레넥톤';
  const next = H.replaceSnapshot(current, correction);
  assert.equal(next.seriesId, current.seriesId);
  assert.deepEqual(next.games, []);
  assert.deepEqual(next.results, []);
  correction.games[0].notes = 'changed';
  assert.equal(next.history[0].games[0].notes, '승리 화면 재확인');
  assert.equal(current.history[0].games[0].notes, '');
});

test('draw constraints and future shuffle settings survive all canonical snapshots', () => {
  let state = fixture();
  const draw = clone(state.draw);
  draw.constraints = { captainsLocked: false, separatePairs: [['injae', 'dongin']], avoidRepeat: false };
  [draw.teams[0][3].id, draw.teams[1][3].id] = [draw.teams[1][3].id, draw.teams[0][3].id];
  draw.metrics = C.summarize(draw.teams, state.roster, draw.constraints);
  state.shuffleOptions = { captainsLocked: false, separatePairs: [['injae', 'dongin']], avoidRepeat: false };
  state = H.setNextDraw(state, draw);
  state = H.recordGame(H.recordGame(state, 0), 0);
  assert.equal(state.draw.constraints.captainsLocked, false);
  assert.equal(state.games[0].draw.constraints.captainsLocked, false);
  assert.equal(state.history[0].games[0].draw.constraints.captainsLocked, false);
  assert.deepEqual(state.shuffleOptions.separatePairs, [['dongin', 'injae']]);
  assert.deepEqual(H.upgrade(state), state);
  assert.deepEqual(H.newSeries(state).shuffleOptions, state.shuffleOptions);
});

test('stopped record summary uses last played draw instead of an unplayed next lineup', () => {
  let state = H.recordGame(fixture(), 0);
  const played = clone(state.games[0].draw);
  state = H.setNextDraw(state, swapTop(state));
  state = H.archiveCurrent(state);
  assert.deepEqual(state.history[0].draw, played);
  assert.notDeepEqual(state.draw, played);
  assert.equal(H.summarize(state.history).players.find(player => player.id === 'injae').gameWins, 1);
});


test('active completed-to-stopped correction survives future active series saves', () => {
  const state = H.recordGame(H.recordGame(fixture(), 0), 0);
  const correction = H.cloneSnapshot(state.history[0]);
  correction.results = [0, 1];
  correction.games[1].winner = 1;
  correction.status = 'stopped';
  const corrected = H.replaceSnapshot(state, correction);
  assert.notEqual(corrected.seriesId, state.seriesId);
  assert.deepEqual(corrected.results, []);
  assert.deepEqual(corrected.games, []);
  assert.deepEqual(corrected.draw, correction.games[1].draw);
  assert.equal(corrected.history[0].status, 'stopped');
  assert.deepEqual(corrected.history[0].results, [0, 1]);
  const saved = H.syncCurrent(corrected);
  assert.equal(saved.history.length, 1);
  const withNextResult = H.recordGame(saved, 1);
  assert.equal(withNextResult.history.length, 1);
  assert.deepEqual(withNextResult.history[0].results, [0, 1]);
});


test('optional legacy measurements are canonical null while explicit bad values and identity stay invalid', () => {
  let state = H.recordGame(H.recordGame(fixture(), 0), 0);
  for (const game of state.games.concat(state.history[0].games)) {
    delete game.durationSeconds; delete game.externalId; delete game.notes;
    game.players.forEach(player => { delete player.champion; Object.keys(H.STAT_LIMITS).forEach(key => { delete player[key]; }); });
    game.players[0].cs = 0;
  }
  assert.ok(H.validate(state));
  const normalized = H.upgrade(state);
  assert.equal(normalized.games[0].durationSeconds, null);
  assert.equal(normalized.games[0].players[0].cs, 0);
  assert.equal(normalized.games[0].players[0].kills, null);
  assert.equal(normalized.history[0].games[0].players[0].gold, null);
  assert.equal(normalized.games[0].notes, '');
  const invalid = clone(state); invalid.games[0].players[0].cs = '0';
  assert.equal(H.validate(invalid), false);
  const missingId = clone(state); delete missingId.games[0].players[0].id;
  assert.equal(H.validate(missingId), false);
});

test('deleting a current archive detaches its live mirror and restoring never resurrects by accident', () => {
  let state = H.recordGame(H.recordGame(fixture(), 0), 0);
  const snapshot = clone(state.history[0]); const original = clone(state);
  const removed = H.removeSnapshot(state, snapshot.id);
  assert.equal(removed.history.length, 0);
  assert.deepEqual(removed.results, []); assert.deepEqual(removed.games, []);
  assert.notEqual(removed.seriesId, snapshot.id);
  assert.equal(H.syncCurrent(removed).history.length, 0);
  assert.deepEqual(state, original);
  assert.throws(() => H.removeSnapshot(removed, snapshot.id), /찾을 수 없습니다/);
  const restored = H.replaceSnapshot(removed, snapshot);
  assert.equal(restored.history.length, 1);
  assert.deepEqual(restored.results, []);
  assert.equal(restored.seriesId, removed.seriesId);
  const active = H.recordGame(restored, 1);
  const olderRemoved = H.removeSnapshot(active, snapshot.id);
  assert.deepEqual(olderRemoved.results, [1]); assert.equal(olderRemoved.history.length, 0);
});
