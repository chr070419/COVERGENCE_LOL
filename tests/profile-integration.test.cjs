'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const C = require('../domain/core.cjs');
const H = require('../domain/history-core.cjs');
const I = require('../domain/import-core.cjs');
const S = require('../domain/player-stats.cjs');
const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const state = H.upgrade(C.createDefaultState());
  state.matchDate = '2026-10-06';
  const teams = [
    [{ id: 'injae', role: 'top' }, { id: 'seongpyo', role: 'jungle' }, { id: 'haeram', role: 'mid' }, { id: 'jongwon', role: 'adc' }, { id: 'seungju', role: 'support' }],
    [{ id: 'dongin', role: 'top' }, { id: 'changwoo', role: 'jungle' }, { id: 'junhyeok', role: 'mid' }, { id: 'minjae', role: 'adc' }, { id: 'sejun', role: 'support' }]
  ];
  const constraints = C.normalizeShuffleOptions();
  state.draw = { teams, constraints, mode: 'balanced', createdAt: '2026-10-06T10:00:00.000Z', metrics: C.summarize(teams, state.roster, constraints) };
  state.drawNumber = 1;
  return state;
}
function payload(state, values = {}, gameNumber = state.results.length + 1) {
  const context = I.context(state, gameNumber);
  return {
    schemaVersion: 1, seriesId: state.seriesId, matchDate: state.matchDate, gameNumber,
    externalId: null, winner: 0, durationSeconds: 1800, notes: '',
    players: context.players.map(person => ({
      playerId: person.playerId, nickname: person.name, team: person.team, role: person.role,
      champion: null, kills: null, deaths: null, assists: null, damage: null, cs: null, gold: null, vision: null,
      ...(person.playerId === 'injae' ? values : {})
    }))
  };
}
function register(state, data) { return I.applyFor(state, I.prepareFor(state, data.seriesId, data)); }
function moveToMid(state) {
  const draw = clone(state.draw);
  [draw.teams[0][0].id, draw.teams[0][2].id] = [draw.teams[0][2].id, draw.teams[0][0].id];
  draw.metrics = C.summarize(draw.teams, state.roster, draw.constraints);
  return H.setNextDraw(state, draw);
}
function threeGames() {
  let state = fixture();
  const first = payload(state, { champion: 'Ahri', kills: 4, deaths: 2, assists: 6, cs: 180 });
  // A name-only capture must end up using the existing immutable player ID.
  first.players.find(person => person.nickname === '신인재').playerId = null;
  state = register(state, first);
  state = moveToMid(state);
  const second = payload(state, { champion: 'Orianna', kills: 8, deaths: 0, assists: 12, cs: 240 });
  second.durationSeconds = null;
  state = register(state, second);
  state = H.newSeries(state);
  state.matchDate = '2026-10-07';
  const third = payload(state, { champion: 'Ahri', kills: null, deaths: 4, assists: 9, cs: null });
  third.winner = 1;
  third.durationSeconds = 1200;
  return register(state, third);
}

test('JSON registration joins live and archived games once and preserves independently known sample counts', () => {
  const state = threeGames(), before = clone(state);
  const result = S.selectPlayer(state, 'injae');
  assert.deepEqual([result.totals.games, result.totals.wins, result.totals.losses], [3, 2, 1]);
  assert.ok(Math.abs(result.totals.winRate - 66.66666666666667) < 1e-12);
  assert.deepEqual(result.totals.kda, { games: 2, kills: 12, deaths: 2, assists: 18, ratio: 15, perfect: false });
  assert.deepEqual([result.totals.averages.kills, result.totals.averages.deaths, result.totals.averages.assists, result.totals.averages.cs], [6, 2, 9, 210]);
  assert.deepEqual([result.totals.samples.kills, result.totals.samples.deaths, result.totals.samples.cs], [2, 3, 2]);
  assert.equal(result.totals.csPerMinute, 6);
  assert.equal(result.totals.csPerMinuteGames, 1);
  assert.equal(result.totals.averages.damage, null);
  assert.deepEqual(result.form.results, [false, true, true]);
  assert.deepEqual(result.form.streak, { won: false, count: 1 });
  assert.deepEqual(result.recent.map(row => [row.date, row.setNumber]), [['2026-10-07', 1], ['2026-10-06', 2], ['2026-10-06', 1]]);
  assert.equal(result.profile.primary, 'top');
  assert.deepEqual(result.positions.filter(position => position.games).map(position => [position.id, position.games, position.wins, position.losses]), [['top', 1, 1, 0], ['mid', 2, 1, 1]]);
  assert.deepEqual(result.champions.map(champion => [champion.name, champion.games, champion.wins]), [['Ahri', 2, 1], ['Orianna', 1, 1]]);
  assert.deepEqual(state, before, 'selectors must not change match, roster or shuffle inputs');
});

test('re-import of an existing game changes totals immediately, retaining measured zero separately from null', () => {
  const state = threeGames();
  const next = register(state, payload(state, { champion: 'Zed', kills: 0, deaths: 0, assists: 0, cs: 0 }, 1));
  // Change duration from the helper default to 10 minutes through the same import path.
  const corrected = payload(next, { champion: 'Zed', kills: 0, deaths: 0, assists: 0, cs: 0 }, 1);
  corrected.durationSeconds = 600;
  const final = register(next, corrected), result = S.selectPlayer(final, 'injae');
  assert.deepEqual([result.totals.games, result.totals.wins, result.totals.losses], [3, 3, 0]);
  assert.equal(result.totals.averages.cs, 140);
  assert.equal(result.totals.averages.kills, 4);
  assert.equal(result.totals.csPerMinute, 4.5, '180 CS / (30 + 10) minutes; the missing-duration game contributes neither numerator nor denominator');
  assert.equal(result.totals.csPerMinuteGames, 2);
  assert.equal(result.totals.kda.ratio, 15);
  assert.deepEqual(result.recent[0].kda, { ratio: null, perfect: true });
  assert.equal(result.recent[0].cs, 0);
  assert.deepEqual(S.selectPlayer(state, 'injae').form.results, [false, true, true], 're-import is immutable');
});

test('historical winner correction, deletion and restoration recalculate without overwriting the live series', () => {
  let state = threeGames();
  const recordId = state.history[0].id;
  const savedCurrent = clone({ seriesId: state.seriesId, results: state.results, games: state.games });
  const target = I.targetState(state, recordId);
  const data = payload(target, { champion: 'Orianna', kills: 8, deaths: 0, assists: 12, cs: 240 }, 2);
  data.winner = 1; data.durationSeconds = null;
  state = register(state, data);
  assert.deepEqual([S.selectPlayer(state, 'injae').totals.wins, S.selectPlayer(state, 'injae').totals.losses], [1, 2]);
  assert.deepEqual({ seriesId: state.seriesId, results: state.results, games: state.games }, savedCurrent);
  const archived = H.cloneSnapshot(state.history.find(record => record.id === recordId));
  assert.equal(archived.status, 'stopped');
  state = H.removeSnapshot(state, recordId);
  assert.equal(S.selectPlayer(state, 'injae').totals.games, 1);
  state = H.syncCurrent(state);
  assert.equal(S.selectPlayer(state, 'injae').totals.games, 1);
  assert.equal(state.history.length, 0);
  state = H.replaceSnapshot(state, archived);
  assert.deepEqual([S.selectPlayer(state, 'injae').totals.games, S.selectPlayer(state, 'injae').totals.wins, S.selectPlayer(state, 'injae').totals.losses], [3, 1, 2]);
  assert.deepEqual({ seriesId: state.seriesId, results: state.results, games: state.games }, savedCurrent);
});

test('deleting the current completed archive prevents resurrection on sync and restores once through its snapshot', () => {
  let state = fixture();
  state = H.recordGame(H.recordGame(state, 0), 0);
  const archived = H.cloneSnapshot(state.history[0]);
  assert.equal(S.selectPlayer(state, 'injae').totals.games, 2, 'current plus archive mirror must not count twice');
  state = H.removeSnapshot(state, archived.id);
  assert.notEqual(state.seriesId, archived.id);
  assert.deepEqual(state.results, []);
  assert.deepEqual(state.games, []);
  state = H.syncCurrent(state);
  assert.equal(state.history.length, 0);
  assert.equal(S.selectPlayer(state, 'injae').totals.games, 0);
  state = H.replaceSnapshot(state, archived);
  state = H.syncCurrent(state);
  assert.equal(state.history.length, 1);
  assert.equal(S.selectPlayer(state, 'injae').totals.games, 2);
});

test('legacy absent metrics stay null and a current display-name change keeps all statistics on the original ID', () => {
  let state = threeGames();
  for (const game of state.games.concat(state.history.flatMap(record => record.games))) {
    delete game.durationSeconds;
    game.players.forEach(player => { delete player.kills; delete player.deaths; delete player.assists; delete player.cs; delete player.champion; });
  }
  state.roster.find(person => person.id === 'injae').name = '신인재 · 변경 이름';
  state = H.upgrade(state);
  assert.ok(H.validate(state));
  const result = S.selectPlayer(state, 'injae');
  assert.equal(result.profile.name, '신인재 · 변경 이름');
  assert.equal(result.totals.games, 3);
  assert.equal(result.totals.averages.kills, null);
  assert.equal(result.totals.averages.cs, null);
  assert.equal(result.totals.csPerMinute, null);
  assert.equal(result.totals.kda.ratio, null);
  assert.equal(result.totals.kda.games, 0);
  assert.equal(result.totals.kda.perfect, false);
  assert.equal(result.missing.champion, 3);
  assert.equal(S.selectPlayer(state, '신인재'), null);
});

test('typo and duplicate capture IDs fail registration without creating a player or polluting statistics', () => {
  const state = fixture(), before = clone(state);
  const badName = payload(state);
  const person = badName.players.find(player => player.playerId === 'injae');
  person.playerId = null; person.nickname = '신인제';
  assert.throws(() => register(state, badName), /신인제.*후보:.*신인재/);
  const duplicate = payload(state);
  duplicate.players[1].playerId = duplicate.players[0].playerId;
  duplicate.players[1].nickname = duplicate.players[0].nickname;
  assert.throws(() => register(state, duplicate), /중복/);
  assert.deepEqual(state, before);
  assert.equal(S.selectPlayer(state, 'injae').totals.games, 0);
  assert.equal(S.selectPlayers(state).length, 10);
});
