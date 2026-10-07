'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../domain/core.cjs');
const H = require('../domain/history-core.cjs');
const I = require('../domain/import-core.cjs');
const S = require('../domain/player-stats.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const person = state => state.roster.find(player => player.id === 'injae');
function fixture() {
  const state = H.upgrade(C.createDefaultState());
  const teams = [
    [{id:'injae',role:'top'}, {id:'seongpyo',role:'jungle'}, {id:'haeram',role:'mid'}, {id:'jongwon',role:'adc'}, {id:'seungju',role:'support'}],
    [{id:'dongin',role:'top'}, {id:'changwoo',role:'jungle'}, {id:'junhyeok',role:'mid'}, {id:'minjae',role:'adc'}, {id:'sejun',role:'support'}]
  ];
  state.draw = {teams, metrics:C.summarize(teams,state.roster), mode:'balanced', createdAt:'2026-10-07T12:00:00.000Z'};
  state.drawNumber = 1;
  state.matchDate = '2026-10-07';
  return state;
}
function rename(state, nickname, aliases = person(state).nicknameAliases) {
  return H.updatePlayerNicknames(state, 'injae', {currentNickname:nickname, nicknameAliases:aliases});
}
function payload(state, nickname, gameNumber = state.results.length + 1, seriesId = state.seriesId) {
  const context = I.contextFor(state, seriesId, gameNumber);
  return {
    schemaVersion:1, seriesId, matchDate:context.matchDate, gameNumber,
    externalId:null, winner:0, durationSeconds:1800, notes:'',
    players:context.players.map(player => ({
      playerId:player.playerId === 'injae' ? null : player.playerId,
      nickname:player.playerId === 'injae' ? nickname : null,
      team:player.team, role:player.role, champion:'아리',
      kills:4, deaths:2, assists:8, damage:null, cs:180, gold:null, vision:null
    }))
  };
}
function register(state, data, corrections) {
  return I.applyFor(state, I.prepareFor(state, data.seriesId, data, corrections));
}

test('old and new nicknames import to one stable profile with independent at-match names', () => {
  let state = rename(fixture(), 'Old#KR1');
  state = register(state, payload(state, 'Old#KR1'));
  const played = clone(state.games), draw = clone(state.draw), id = state.seriesId;
  state = rename(state, 'New#KR1');
  assert.equal(state.seriesId, id);
  assert.deepEqual(state.games, played);
  assert.deepEqual(state.draw, draw);
  assert.deepEqual(person(state).nicknameAliases, ['Old#KR1']);
  state = register(state, payload(state, 'New#KR1'));
  state = H.upgrade(clone(state));
  const stats = S.selectPlayer(state, 'injae');
  assert.equal(S.selectPlayers(state).length, 10);
  assert.equal(stats.profile.currentNickname, 'New#KR1');
  assert.deepEqual([stats.totals.games,stats.totals.wins,stats.totals.losses], [2,2,0]);
  assert.equal(stats.totals.kda.ratio, 6);
  assert.equal(stats.totals.csPerMinute, 6);
  assert.deepEqual(stats.recent.map(game => game.nicknameAtMatch), ['New#KR1','Old#KR1']);
  const archive = clone(state.history[0]);
  state = rename(state, 'Newest#KR1');
  state = H.replaceSnapshot(state, archive);
  assert.equal(S.selectPlayer(state, 'injae').profile.currentNickname, 'Newest#KR1');
  assert.deepEqual(S.selectPlayer(state, 'injae').recent.map(game => game.nicknameAtMatch), ['New#KR1','Old#KR1']);
  state = H.removeSnapshot(state, archive.id);
  assert.equal(S.selectPlayer(state, 'injae').totals.games, 0);
  assert.equal(person(state).currentNickname, 'Newest#KR1');
  state = H.replaceSnapshot(state, archive);
  assert.equal(S.selectPlayer(state, 'injae').totals.games, 2);
  assert.equal(person(state).currentNickname, 'Newest#KR1');
});

test('an archived import uses corrected current identity while preserving the frozen roster', () => {
  let state = rename(fixture(), 'Old#KR1', ['Mistake#KR1']);
  state = register(state, payload(state, 'Old#KR1'));
  const oldId = state.seriesId;
  state = H.newSeries(H.archiveCurrent(state));
  const archivedRoster = clone(state.history[0].roster);
  state = rename(state, 'New#KR1', []);
  const before = clone(state);
  assert.throws(() => register(state, payload(state, 'Mistake#KR1', 1, oldId)), /찾을 수 없습니다/);
  const next = register(state, payload(state, 'New#KR1', 1, oldId));
  assert.deepEqual(state, before);
  assert.deepEqual(next.history[0].roster, archivedRoster);
  assert.deepEqual(next.games, before.games);
  assert.equal(next.seriesId, before.seriesId);
  assert.equal(S.selectPlayer(next, 'injae').recent[0].nicknameAtMatch, 'New#KR1');
  assert.equal(S.selectPlayer(next, 'injae').totals.games, 1);
});

test('a screenshot without names needs human mapping and retains null rather than inventing a nickname', () => {
  const state = rename(fixture(), 'Current#KR1');
  const data = payload(state, null);
  data.players.forEach(player => {player.playerId = null; player.nickname = null;});
  assert.throws(() => register(state, data), /실제 참가자/);
  const ids = I.contextFor(state, state.seriesId, 1).players.map(player => player.playerId);
  const next = register(state, data, {playerIds:ids, rememberNicknames:true});
  assert.ok(next.games[0].players.every(player => player.nicknameAtMatch === null));
  assert.deepEqual(person(next).nicknameAliases, []);
  assert.equal(S.selectPlayer(next, 'injae').recent[0].nicknameAtMatch, null);
  assert.equal(S.selectPlayer(next, 'injae').totals.games, 1);
  assert.equal(S.selectPlayer(state, 'injae').totals.games, 0);
});
