'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const C = require('../domain/core.cjs');
const H = require('../domain/history-core.cjs');
const S = require('../domain/player-stats.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const player = state => state.roster.find(person => person.id === 'injae');

function legacy() {
  const state = C.createDefaultState();
  const teams = [
    [{ id: 'injae', role: 'top' }, { id: 'seongpyo', role: 'jungle' }, { id: 'haeram', role: 'mid' }, { id: 'jongwon', role: 'adc' }, { id: 'seungju', role: 'support' }],
    [{ id: 'dongin', role: 'top' }, { id: 'changwoo', role: 'jungle' }, { id: 'junhyeok', role: 'mid' }, { id: 'minjae', role: 'adc' }, { id: 'sejun', role: 'support' }]
  ];
  state.draw = { teams, metrics: C.summarize(teams, state.roster), createdAt: '2026-10-07T12:00:00.000Z', mode: 'balanced' };
  state.drawNumber = 1;
  return state;
}
function fixture() { return H.upgrade(legacy()); }
function setNickname(state, currentNickname, nicknameAliases = []) {
  return H.updatePlayerNicknames(state, 'injae', { currentNickname, nicknameAliases });
}

test('nickname normalization is exact NFKC/case/space matching and retains Riot tags', () => {
  assert.equal(C.normalizeNickname(' Ｐlayer　 Name＃ＫＲ１ '), 'player name#kr1');
  assert.notEqual(C.normalizeNickname('Player#KR1'), C.normalizeNickname('Player#KR2'));
  assert.notEqual(C.normalizeNickname('신인제'), C.normalizeNickname('신인재'));
  for (const value of [null, undefined, 1, {}, '', '   ', 'a\nb', 'a\u007fb', 'x'.repeat(101)]) assert.equal(C.normalizeNickname(value), '');
});

test('legacy identity fields become null/empty without inventing match nicknames', () => {
  const raw = legacy();
  raw.roster.forEach(person => { delete person.currentNickname; delete person.nicknameAliases; });
  raw.results = [0, 0];
  const current = H.syncCurrent(H.upgrade(raw));
  current.roster.concat(current.history[0].roster).forEach(person => {
    assert.equal(person.currentNickname, null);
    assert.deepEqual(person.nicknameAliases, []);
  });
  current.games.concat(current.history[0].games).flatMap(game => game.players).forEach(person => assert.equal(person.nicknameAtMatch, null));
  const named = setNickname(fixture(), 'Now#KR1');
  assert.equal(H.recordGame(named, 0).games[0].players.find(person => person.id === 'injae').nicknameAtMatch, null);
  assert.notEqual(C.createDefaultState().roster[0].nicknameAliases, C.createDefaultState().roster[0].nicknameAliases);
});

test('renaming keeps the stable player and all scores, statistics, lineups and frozen history intact', () => {
  let state = setNickname(fixture(), 'Old#KR1', ['Older#KR1']);
  state = H.recordGame(H.recordGame(state, 0), 0);
  const before = clone(state), totals = S.selectPlayer(state, 'injae').totals;
  const renamed = setNickname(state, 'New#KR1', player(state).nicknameAliases);
  assert.deepEqual(player(renamed).nicknameAliases, ['Older#KR1', 'Old#KR1']);
  assert.equal(player(renamed).currentNickname, 'New#KR1');
  for (const key of ['draw', 'drawNumber', 'results', 'games', 'history', 'seriesId', 'bestOf', 'matchDate']) assert.deepEqual(renamed[key], before[key]);
  assert.deepEqual(S.selectPlayer(renamed, 'injae').totals, totals);
  assert.deepEqual(state, before);
});

test('alias updates deduplicate normalized keys, omit the current nickname and allow explicit removal', () => {
  const state = setNickname(fixture(), 'Old#KR1', ['Discard#KR1']);
  const next = setNickname(state, ' New#KR1 ', ['NEW#KR1', 'Alias#KR1', ' Ａlias＃ＫＲ１ ']);
  assert.equal(player(next).currentNickname, 'New#KR1');
  assert.deepEqual(player(next).nicknameAliases, ['Alias#KR1', 'Old#KR1']);
  assert.deepEqual(player(setNickname(next, 'new#kr1', [])).nicknameAliases, []);
  const cleared = setNickname(next, null, []);
  assert.equal(player(cleared).currentNickname, null);
  assert.deepEqual(player(cleared).nicknameAliases, ['New#KR1']);
});

test('confirmed nickname associations append aliases only and never implicitly change the current name', () => {
  const state = setNickname(fixture(), 'Current#KR1', ['Known#KR1']);
  const before = clone(state);
  const next = H.rememberPlayerNicknames(state, [
    { playerId: 'injae', nickname: '신인재' },
    { playerId: 'injae', nickname: ' CURRENT#kr1 ' },
    { playerId: 'injae', nickname: 'KNOWN#KR1' },
    { playerId: 'injae', nickname: 'Observed#KR1' }
  ]);
  assert.equal(player(next).currentNickname, 'Current#KR1');
  assert.deepEqual(player(next).nicknameAliases, ['Known#KR1', 'Observed#KR1']);
  assert.deepEqual(state, before);
  for (const key of ['draw', 'results', 'games', 'history', 'seriesId', 'drawNumber']) assert.deepEqual(next[key], before[key]);
  assert.throws(() => H.rememberPlayerNicknames(state, [{ playerId: 'missing', nickname: 'New' }]), RangeError);
  assert.throws(() => H.rememberPlayerNicknames(state, [{ playerId: 'injae', nickname: null }]), RangeError);
});

test('cross-player nickname collisions remain representable but per-player canonical duplicates reject', () => {
  let state = setNickname(fixture(), 'Shared#KR1');
  state = H.updatePlayerNicknames(state, 'haeram', { currentNickname: 'SHARED#kr1', nicknameAliases: [] });
  assert.ok(H.validate(state));
  const invalid = clone(state);
  player(invalid).nicknameAliases = ['Alias', 'ＡLIAS'];
  assert.equal(H.validate(invalid), false);
  assert.equal(C.validateState(invalid), false);
  player(invalid).nicknameAliases = ['shared#kr1'];
  assert.equal(H.validate(invalid), false);
});

test('malformed identity metadata, control characters and overlength values reject without silent repair', () => {
  const good = H.recordGame(fixture(), 0);
  const mutations = [
    state => { player(state).currentNickname = undefined; },
    state => { player(state).currentNickname = ''; },
    state => { player(state).currentNickname = 'bad\nname'; },
    state => { player(state).currentNickname = 'x'.repeat(101); },
    state => { player(state).nicknameAliases = null; },
    state => { player(state).nicknameAliases = [undefined]; },
    state => { player(state).nicknameAliases = Array(1); },
    state => { player(state).nicknameAliases = ['x\u0000']; },
    state => { player(state).nicknameAliases = Array.from({ length: 31 }, (_, i) => 'alias' + i); },
    state => { state.games[0].players[0].nicknameAtMatch = undefined; },
    state => { state.games[0].players[0].nicknameAtMatch = ''; },
    state => { state.games[0].players[0].nicknameAtMatch = 'x'.repeat(101); },
    state => { state.games[0].players[0].nicknameAtMatch = '\tbad'; }
  ];
  mutations.forEach(mutate => {
    const bad = clone(good); mutate(bad);
    assert.equal(H.validate(bad), false);
    assert.throws(() => H.upgrade(bad), RangeError);
  });
  const boundary = setNickname(fixture(), 'x'.repeat(100), Array.from({ length: 30 }, (_, i) => 'alias' + i));
  assert.ok(H.validate(boundary));
  assert.throws(() => setNickname(boundary, 'new', player(boundary).nicknameAliases), RangeError);
  assert.throws(() => H.rememberPlayerNicknames(boundary, [{ playerId: 'injae', nickname: 'new' }]), RangeError);
  assert.equal(player(boundary).currentNickname, 'x'.repeat(100));
});

test('unsafe identity records and getters are rejected without executing accessors', () => {
  const state = fixture();
  let calls = 0;
  const identity = { nicknameAliases: [] };
  Object.defineProperty(identity, 'currentNickname', { enumerable: true, get() { calls += 1; return 'bad'; } });
  assert.throws(() => H.updatePlayerNicknames(state, 'injae', identity), RangeError);
  const bad = clone(state);
  Object.defineProperty(player(bad), 'currentNickname', { enumerable: true, get() { calls += 1; return 'bad'; } });
  assert.equal(C.validateState(bad), false);
  assert.equal(H.validate(bad), false);
  assert.equal(calls, 0);
  assert.throws(() => H.updatePlayerNicknames(state, 'injae', JSON.parse('{"currentNickname":"safe","nicknameAliases":[],"__proto__":{}}')), RangeError);
  assert.throws(() => H.rememberPlayerNicknames(state, [Object.assign(Object.create({ inherited: true }), { playerId: 'injae', nickname: 'bad' })]), RangeError);
});

test('observed match nickname survives score corrections, archives, backup and restoration', () => {
  let state = setNickname(fixture(), 'Old#KR1');
  const details = { players: state.draw.teams.flat().map(slot => ({ id: slot.id, nicknameAtMatch: slot.id === 'injae' ? 'Observed#KR1' : null })) };
  state = H.recordGame(H.recordGame(state, 0, details), 0);
  const archived = H.cloneSnapshot(state.history[0]);
  assert.equal(archived.games[0].players.find(person => person.id === 'injae').nicknameAtMatch, 'Observed#KR1');
  state = setNickname(state, 'New#KR1', []);
  const restored = H.replaceSnapshot(H.upgrade(clone(state)), archived);
  assert.equal(player(restored).currentNickname, 'New#KR1');
  assert.deepEqual(player(restored).nicknameAliases, ['Old#KR1']);
  assert.equal(restored.history[0].roster.find(person => person.id === 'injae').currentNickname, 'Old#KR1');
  assert.equal(restored.games[0].players.find(person => person.id === 'injae').nicknameAtMatch, 'Observed#KR1');
  const corrected = H.replaceGame(restored, 0, { notes: 'corrected' });
  assert.equal(corrected.games[0].players.find(person => person.id === 'injae').nicknameAtMatch, 'Observed#KR1');
  archived.roster[0].nicknameAliases.push('Mutation');
  assert.deepEqual(restored.history[0].roster[0].nicknameAliases, []);
});

test('legacy backup fingerprint stays byte-compatible after adding identity defaults or aliases', () => {
  const raw = legacy(); raw.results = [0, 0];
  raw.roster.forEach(person => { delete person.currentNickname; delete person.nicknameAliases; });
  const first = H.syncCurrent(H.upgrade(raw));
  assert.equal(first.seriesId, 'legacy-53acd5483bb60214f9cf778e91d5a0d2');
  const enriched = clone(raw);
  enriched.roster.forEach(person => { person.currentNickname = person.id + '#KR1'; person.nicknameAliases = ['Old' + person.id]; });
  const second = H.syncCurrent(H.upgrade(enriched));
  assert.equal(second.seriesId, first.seriesId);
  assert.equal(H.mergeHistory(first.history, second.history).length, 1);
});

test('sync and re-archive preserve archived nickname identity after current registry changes', () => {
  for (const completed of [true, false]) {
    let state = setNickname(fixture(), 'Old#KR1', ['Older#KR1']);
    state = H.recordGame(state, 0);
    state = completed ? H.recordGame(state, 0) : H.archiveCurrent(state);
    const before = clone(state.history[0]);
    state = setNickname(state, 'New#KR1', []);
    player(state).name = '신인재 수정';
    for (const save of completed ? [H.syncCurrent, H.archiveCurrent] : [H.archiveCurrent]) {
      const saved = save(state);
      const historical = saved.history[0].roster.find(person => person.id === 'injae');
      assert.equal(historical.currentNickname, 'Old#KR1');
      assert.deepEqual(historical.nicknameAliases, ['Older#KR1']);
      assert.equal(historical.name, '신인재 수정');
      assert.equal(player(saved).currentNickname, 'New#KR1');
      assert.deepEqual(saved.history[0].games, before.games);
      assert.equal(saved.history[0].endedAt, before.endedAt);
      historical.nicknameAliases.push('detached');
      assert.deepEqual(state.history[0].roster.find(person => person.id === 'injae').nicknameAliases, ['Older#KR1']);
    }
  }
});

test('current-series detail correction updates observed nickname without rewriting archived registry', () => {
  let state = setNickname(fixture(), 'Old#KR1', ['Older#KR1']);
  state = H.recordGame(H.recordGame(state, 0), 0);
  state = setNickname(state, 'New#KR1', []);
  const players = clone(state.games[0].players);
  players.find(person => person.id === 'injae').nicknameAtMatch = 'Played#KR1';
  const corrected = H.replaceGame(state, 0, { players, notes: 'JSON detail correction' });
  const historical = corrected.history[0].roster.find(person => person.id === 'injae');
  assert.equal(historical.currentNickname, 'Old#KR1');
  assert.deepEqual(historical.nicknameAliases, ['Older#KR1']);
  assert.equal(corrected.history[0].games[0].players.find(person => person.id === 'injae').nicknameAtMatch, 'Played#KR1');
  assert.equal(corrected.history[0].games[0].notes, 'JSON detail correction');
  assert.equal(player(corrected).currentNickname, 'New#KR1');
});

test('intentional archived identity correction remains authoritative through later synchronization', () => {
  let state = setNickname(fixture(), 'Old#KR1', ['Older#KR1']);
  state = H.recordGame(H.recordGame(state, 0), 0);
  state = setNickname(state, 'New#KR1', []);
  const edited = H.cloneSnapshot(state.history[0]);
  const historical = edited.roster.find(person => person.id === 'injae');
  historical.currentNickname = 'CorrectedPast#KR1';
  historical.nicknameAliases = ['CorrectedAlias#KR1'];
  const corrected = H.replaceSnapshot(state, edited);
  assert.equal(player(corrected).currentNickname, 'New#KR1');
  for (const saved of [corrected, H.syncCurrent(corrected), H.archiveCurrent(corrected)]) {
    const identity = saved.history[0].roster.find(person => person.id === 'injae');
    assert.equal(identity.currentNickname, 'CorrectedPast#KR1');
    assert.deepEqual(identity.nicknameAliases, ['CorrectedAlias#KR1']);
  }
});
