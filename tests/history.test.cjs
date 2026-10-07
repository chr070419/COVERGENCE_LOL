'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const C = require('../domain/core.cjs');
const H = require('../domain/history-core.cjs');
const clone = value => JSON.parse(JSON.stringify(value));

function legacy(results = []) {
  const state = C.createDefaultState();
  state.draw = C.makeTeams(state.roster);
  state.draw.createdAt = '2026-10-06T16:00:00.000Z';
  state.drawNumber = 1;
  state.results = results.slice();
  return state;
}
function archive(results = [0, 1, 0]) {
  return H.archiveCurrent(H.upgrade(legacy(results)));
}

test('legacy migration preserves current data and derives known match date in Korea', () => {
  const raw = legacy([0, 1]);
  const before = clone(raw);
  const state = H.upgrade(raw);
  assert.equal(state.version, 1);
  assert.equal(state.archiveVersion, 1);
  assert.equal(state.matchDate, '2026-10-07');
  assert.match(state.seriesId, /^legacy-[a-f0-9]{32}$/);
  assert.deepEqual(state.history, []);
  assert.ok(H.validate(state));
  assert.ok(C.validateState(state));
  assert.deepEqual(raw, before);
  state.roster[0].name = '변경';
  assert.equal(raw.roster[0].name, '신인재');
  assert.equal(H.upgrade({ ...raw, matchDate: '2026-09-30' }).matchDate, '2026-09-30');
  const upgraded = H.upgrade(raw);
  assert.deepEqual(H.upgrade(upgraded), upgraded);
});

test('manual team adjustment metadata survives migration, synchronization and archives', () => {
  for (const adjusted of [false, true]) {
    const raw = legacy([0, 0]);
    raw.draw.adjusted = adjusted;
    const state = H.syncCurrent(H.upgrade(raw));
    assert.equal(state.draw.adjusted, adjusted);
    assert.equal(state.history[0].draw.adjusted, adjusted);
    assert.equal(H.newSeries(state).draw.adjusted, adjusted);
  }
  const invalid = legacy([0, 0]);
  invalid.draw.adjusted = 'true';
  assert.throws(() => H.upgrade(invalid), RangeError);
});

test('repeated imports of the same scored legacy backup deduplicate by stable content ID', () => {
  const raw = legacy([0, 1, 0]);
  const first = H.syncCurrent(H.upgrade(raw));
  const repeated = H.syncCurrent(H.upgrade(clone(raw)));
  assert.equal(repeated.seriesId, first.seriesId);
  const merged = H.mergeHistory(first.history, repeated.history);
  assert.equal(merged.length, 1);
  assert.deepEqual([H.summarize(merged).matches, H.summarize(merged).games], [1, 3]);
  assert.equal(H.syncCurrent({ ...repeated, history: merged }).history.length, 1);
  const distinct = clone(raw);
  distinct.drawNumber += 1;
  assert.notEqual(H.upgrade(distinct).seriesId, first.seriesId);
  const blank = C.createDefaultState();
  assert.notEqual(H.upgrade(blank).seriesId, H.upgrade(blank).seriesId);
  assert.match(H.upgrade(blank).seriesId, /^[a-f0-9-]{36}$/);
});

test('Korean dates cross midnight at 15:00 UTC and reject invalid dates', () => {
  assert.equal(H.today('2026-10-07T14:59:59.999Z'), '2026-10-07');
  assert.equal(H.today('2026-10-07T15:00:00.000Z'), '2026-10-08');
  assert.equal(H.today(new Date('2026-12-31T15:00:00.000Z')), '2027-01-01');
  assert.throws(() => H.today('invalid'), RangeError);
  const state = H.upgrade(legacy());
  for (const value of ['2026-02-29', '2026-04-31', '1999-12-31', '2101-01-01', '2026-1-01']) {
    assert.equal(H.validate({ ...state, matchDate: value }), false);
  }
  assert.equal(H.validate({ ...state, matchDate: '2028-02-29' }), true);
});

test('completion auto-saves once and undo removes only the active archive', () => {
  let state = archive();
  const oldId = state.seriesId;
  state = H.newSeries(state);
  state = H.recordGame(H.recordGame(state, 1), 1);
  assert.equal(state.history.length, 2);
  const archivedAt = state.history.find(item => item.id === state.seriesId).endedAt;
  state = H.syncCurrent(state);
  assert.equal(state.history.length, 2);
  assert.equal(state.history.find(item => item.id === state.seriesId).endedAt, archivedAt);
  state = H.undoGame(state);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].id, oldId);
});

test('new series and archive snapshots remain detached from future edits', () => {
  const state = archive();
  const before = clone(state);
  const next = H.newSeries(state);
  assert.notEqual(next.seriesId, state.seriesId);
  assert.deepEqual(next.results, []);
  assert.equal(next.matchDate, state.matchDate);
  assert.deepEqual(next.draw, state.draw);
  next.roster[0].name = '다음 경기 이름';
  next.roster[0].secondary.push('adc');
  next.draw.teams[0][0].role = 'mid';
  assert.deepEqual(state, before);
  assert.equal(next.history[0].roster[0].name, '신인재');
  assert.deepEqual(next.history[0].draw, before.draw);
});

test('stopped series count games and appearances without fabricated series winner', () => {
  const state = archive([0]);
  const item = state.history[0];
  assert.equal(item.status, 'stopped');
  assert.deepEqual(H.archiveCurrent(state), state);
  const summary = H.summarize(state.history);
  assert.deepEqual([summary.matches, summary.completed, summary.stopped, summary.games, summary.days], [1, 0, 1, 1, 1]);
  assert.deepEqual(summary.teams.map(team => [team.seriesWins, team.seriesLosses, team.gameWins, team.gameLosses]), [[0, 0, 1, 0], [0, 0, 0, 1]]);
  assert.equal(summary.players.length, 10);
  assert.equal(summary.players.filter(player => player.winRate === 100).length, 5);
  summary.players.forEach(player => { assert.equal(player.matches, 1); assert.equal(player.seriesWins, 0); assert.equal(player.seriesLosses, 0); });
  const empty = H.upgrade(legacy());
  assert.deepEqual(H.archiveCurrent(empty), empty);
});

test('completed series stats follow archived rosters and latest names', () => {
  let state = archive([0, 1, 0]);
  state.history[0].endedAt = '2026-10-07T10:00:00.000Z';
  state = H.newSeries(state);
  state.matchDate = '2026-10-08';
  state.roster.find(person => person.id === 'jongwon').name = '종원 새 이름';
  state = H.archiveCurrent(H.recordGame(H.recordGame(state, 1), 1));
  state.history.find(item => item.id === state.seriesId).endedAt = '2026-10-08T10:00:00.000Z';
  const summary = H.summarize(state.history);
  assert.deepEqual([summary.matches, summary.completed, summary.games, summary.days], [2, 2, 5, 2]);
  assert.deepEqual(summary.teams.map(team => [team.seriesWins, team.seriesLosses, team.gameWins, team.gameLosses]), [[1, 1, 2, 3], [1, 1, 3, 2]]);
  const captain = summary.players.find(person => person.id === 'jongwon');
  assert.equal(captain.name, '종원 새 이름');
  assert.deepEqual([captain.matches, captain.seriesWins, captain.seriesLosses, captain.gameWins, captain.gameLosses, captain.winRate], [2, 1, 1, 2, 3, 40]);
  assert.equal(state.history.find(item => item.id !== state.seriesId).roster.find(person => person.id === 'jongwon').name, '이종원');
});

test('history validation rejects malformed, duplicated and inconsistent archives', () => {
  const original = archive();
  const mutations = [
    state => { state.archiveVersion = 2; },
    state => { state.seriesId = ''; },
    state => { state.seriesId = '__proto__'; },
    state => { state.seriesId = 'x'.repeat(101); },
    state => { state.history.push(clone(state.history[0])); },
    state => { state.history[0].date = '2026-02-30'; },
    state => { state.history[0].endedAt = '2026-10-07'; },
    state => { state.history[0].status = 'stopped'; },
    state => { state.history[0].results = []; },
    state => { state.history[0].results.push(0); },
    state => { state.history[0].draw.teams[0][0].id = 'missing'; },
    state => { state.history[0].draw.metrics.offRole += 1; },
    state => { state.history[0].roster[0].name = 'unsafe\u0000'; },
    state => { state.history[0].teamNames = ['only one']; },
    state => { state.history[0].teamNames = new Array(2); },
    state => { state.history = new Array(1); },
    state => { state.history = Array.from({length: H.MAX_HISTORY + 1}, (_, i) => ({ ...clone(state.history[0]), id: 'series-' + i })); }
  ];
  mutations.forEach(mutate => {
    const bad = clone(original); mutate(bad);
    assert.equal(H.validate(bad), false);
    assert.throws(() => H.upgrade(bad), RangeError);
  });
  for (const invalid of [null, undefined, {}, [], 1]) assert.equal(H.validate(invalid), false);
  const poisoned = clone(original);
  Object.defineProperty(poisoned.history[0], '__proto__', { value: {}, enumerable: true });
  assert.equal(H.validate(poisoned), false);
});

test('backup history merges preserve existing archives and use incoming corrections by ID', () => {
  const first = archive();
  const other = archive([1]);
  const correction = clone(first.history[0]);
  correction.results = [1, 1];
  correction.games = correction.games.slice(0, 2).map(game => ({ ...game, winner: 1 }));
  const merged = H.mergeHistory(first.history, other.history.concat(correction));
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.find(item => item.id === correction.id).results, [1, 1]);
  assert.deepEqual(first.history[0].results, [0, 1, 0]);
  const legacyBackup = H.upgrade(legacy());
  assert.deepEqual(H.mergeHistory(merged, legacyBackup.history), merged);
  merged[0].roster[0].name = 'changed';
  assert.equal(first.history[0].roster[0].name, '신인재');
  assert.equal(other.history[0].roster[0].name, '신인재');
});
