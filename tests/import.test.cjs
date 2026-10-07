'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const C = require('../domain/core.cjs');
const H = require('../domain/history-core.cjs');
const I = require('../domain/import-core.cjs');
const clone = value => JSON.parse(JSON.stringify(value));

function start() {
  const state = H.upgrade(C.createDefaultState());
  state.matchDate = '2026-10-07';
  state.draw = C.makeTeams(state.roster);
  state.drawNumber = 1;
  return state;
}
function payload(state, gameNumber = state.results.length + 1) {
  const target = I.context(state, gameNumber);
  return {
    schemaVersion: 1, seriesId: target.seriesId, matchDate: target.matchDate, gameNumber,
    externalId: null, winner: 0, durationSeconds: 1835, notes: '',
    players: target.players.map((player, index) => ({ playerId: player.playerId, nickname: `플레이어${index + 1}`, team: player.team, role: player.role, champion: index === 0 ? '아리' : null, kills: index, deaths: null, assists: 0, damage: null, cs: null, gold: null, vision: null }))
  };
}
function imported(state, input = payload(state)) { return I.applyFor(state, I.prepareFor(state, state.seriesId, input)); }

test('strict import parsing preserves null rather than inventing zero and rejects hostile structures', () => {
  const data = payload(start());
  const parsed = I.parse(JSON.stringify(data));
  assert.equal(parsed.players[0].deaths, null);
  assert.equal(parsed.players[0].assists, 0);
  for (const bad of [
    { ...data, schemaVersion: '1' }, { ...data, unknown: 1 }, { ...data, winner: 2 },
    { ...data, durationSeconds: 0 }, { ...data, durationSeconds: 21601 },
    { ...data, players: data.players.slice(1) }, { ...data, players: data.players.concat(data.players[0]) }
  ]) assert.throws(() => I.parse(JSON.stringify(bad)));
  assert.throws(() => I.parse(JSON.stringify(data).replace('"schemaVersion":1', '"schemaVersion":1,"__proto__":{"polluted":true}')));
  assert.equal({}.polluted, undefined);
  assert.throws(() => I.validate(Object.assign(Object.create({}), data)));
  const getter = clone(data);
  Object.defineProperty(getter, 'notes', { enumerable: true, get() { throw new Error('executed getter'); } });
  assert.throws(() => I.validate(getter), /필수 항목/);
  assert.throws(() => I.parse(' '.repeat(I.MAX_BYTES + 1)));
  assert.throws(() => I.parse('```json\n' + JSON.stringify(data) + '\n```'));
});

test('numeric stats reject negative, fractional, string, and out-of-bounds values', () => {
  const data = payload(start());
  for (const value of [-1, 1.5, '2', 1001]) {
    const bad = clone(data);
    bad.players[0].kills = value;
    assert.throws(() => I.validate(bad));
  }
  const bad = clone(data);
  bad.players[0].damage = 10000001;
  assert.throws(() => I.validate(bad));
});

test('new import records one winner, frozen lineup and 10 stat entries without changing source', () => {
  const state = start();
  const before = clone(state);
  const data = payload(state);
  data.externalId = 'screenshot-game-1';
  const next = imported(state, data);
  assert.deepEqual(state, before);
  assert.deepEqual(next.results, [0]);
  assert.deepEqual(next.games[0].draw, before.draw);
  assert.equal(next.games[0].players.length, 10);
  assert.equal(next.games[0].players[0].champion, '아리');
  assert.equal(next.games[0].players[0].deaths, null);
  assert.equal(next.games[0].externalId, 'screenshot-game-1');
  assert.ok(H.validate(next));
});

test('unknown participant, team, role and winner require explicit valid mapping', () => {
  const state = start();
  const data = payload(state);
  const first = clone(data.players[0]);
  data.players[0].playerId = null;
  data.players[0].team = null;
  data.players[0].role = null;
  data.winner = null;
  assert.doesNotThrow(() => I.validate(data));
  assert.throws(() => I.prepareFor(state, state.seriesId, data), /승리 팀/);
  assert.throws(() => I.prepareFor(state, state.seriesId, data, { winner: 0 }), /실제 참가자/);
  const corrections = {
    winner: 0, playerIds: data.players.map((player, index) => index === 0 ? first.playerId : player.playerId),
    teams: data.players.map((player, index) => index === 0 ? first.team : player.team),
    roles: data.players.map((player, index) => index === 0 ? first.role : player.role)
  };
  assert.ok(I.prepareFor(state, state.seriesId, data, corrections));
  corrections.playerIds[1] = first.playerId;
  assert.throws(() => I.prepareFor(state, state.seriesId, data, corrections), /중복/);
});

test('team and frozen-role mismatches cannot pass validation', () => {
  const state = start();
  const data = payload(state);
  data.players[0].team = 1 - data.players[0].team;
  assert.throws(() => I.prepareFor(state, state.seriesId, data), /팀/);
  data.players[0].team = 1 - data.players[0].team;
  data.players[0].role = C.ROLES.find(role => role.id !== data.players[0].role).id;
  assert.throws(() => I.prepareFor(state, state.seriesId, data), /라인/);
});

test('missing IDs resolve only unique normalized exact names to existing players', () => {
  const state = start();
  const data = payload(state);
  const target = I.context(state, 1);
  data.players.forEach((player, index) => { player.playerId = null; player.nickname = `  ${target.players[index].name.normalize('NFD')}  `; });
  const before = clone(data);
  const prepared = I.prepareFor(state, state.seriesId, data);
  assert.deepEqual(prepared.detail.players.map(player => player.id), target.players.map(player => player.playerId));
  assert.deepEqual(data, before);
  assert.equal(I.normalizePlayerName(' Ａlice  Smith '), 'alice smith');
  assert.equal(I.resolveParticipant({ playerId: null, nickname: 'unknown' }, target.players).playerId, null);
});

test('typo names are suggested but never silently linked or used to create a player', () => {
  const state = start();
  const data = payload(state);
  const player = data.players.find(item => item.playerId === 'injae');
  player.playerId = null;
  player.nickname = '신인제';
  const result = I.resolveParticipant(player, I.context(state, 1).players);
  assert.equal(result.status, 'unknown_name');
  assert.equal(result.playerId, null);
  assert.ok(result.candidates.some(candidate => candidate.playerId === 'injae'));
  assert.match(result.message, /신인제.*찾을 수 없습니다.*후보:.*신인재/);
  assert.throws(() => I.prepareFor(state, state.seriesId, data), /신인제.*후보:.*신인재/);
  assert.equal(state.roster.length, 10);
});

test('unknown IDs and ID/name conflicts require explicit correction while game nicknames keep known IDs', () => {
  const state = start();
  const data = payload(state);
  const target = I.context(state, 1).players;
  const originalId = data.players[0].playerId;
  data.players[0].playerId = 'unregistered-id';
  data.players[0].nickname = target[0].name;
  assert.equal(I.resolveParticipant(data.players[0], target).status, 'unknown_id');
  assert.throws(() => I.prepareFor(state, state.seriesId, data), /unregistered-id.*찾을 수 없습니다/);
  assert.doesNotThrow(() => I.prepareFor(state, state.seriesId, data, { playerIds: data.players.map((player, index) => index === 0 ? originalId : player.playerId) }));
  data.players[0].playerId = originalId;
  data.players[0].nickname = target[1].name;
  assert.equal(I.resolveParticipant(data.players[0], target).status, 'conflict');
  assert.throws(() => I.prepareFor(state, state.seriesId, data), /playerId.*다른 선수/);
  assert.doesNotThrow(() => I.prepareFor(state, state.seriesId, data, { playerIds: data.players.map(player => player.playerId) }));
  data.players[0].nickname = '내 게임 닉네임';
  assert.equal(I.resolveParticipant(data.players[0], target).playerId, originalId);
  assert.doesNotThrow(() => I.prepareFor(state, state.seriesId, data));
});

test('ambiguous names and duplicate resolved identities are blocked', () => {
  const state = start();
  state.roster[1].name = state.roster[0].name;
  const data = payload(state);
  const index = data.players.findIndex(player => player.playerId === state.roster[0].id);
  data.players[index].playerId = null;
  data.players[index].nickname = state.roster[0].name;
  const resolved = I.resolveParticipant(data.players[index], I.context(state, 1).players);
  assert.equal(resolved.status, 'ambiguous_name');
  assert.equal(resolved.playerId, null);
  assert.equal(resolved.candidates.length, 2);
  assert.throws(() => I.prepareFor(state, state.seriesId, data), /여러 명/);
  const original = start();
  const duplicate = payload(original);
  duplicate.players[1].playerId = null;
  duplicate.players[1].nickname = I.context(original, 1).players[0].name;
  assert.throws(() => I.prepareFor(original, original.seriesId, duplicate), /중복/);
});

test('wrong day, wrong series, skipped games and stale prepared context are rejected', () => {
  const state = start();
  const data = payload(state);
  assert.throws(() => I.prepareFor(state, state.seriesId, { ...data, seriesId: 'other' }), /시리즈/);
  assert.throws(() => I.prepareFor(state, state.seriesId, { ...data, matchDate: '2026-10-08' }), /경기일/);
  assert.throws(() => I.prepareFor(state, state.seriesId, { ...data, gameNumber: 3 }), /세트/);
  const prepared = I.prepareFor(state, state.seriesId, data);
  assert.throws(() => I.applyFor(H.recordGame(state, 1), prepared), /변경/);
});

test('existing game enriches exactly one set and uses its lineup after next-lineup changes', () => {
  let state = imported(start());
  const firstDraw = clone(state.games[0].draw);
  state = H.setNextDraw(state, C.makeTeams(state.roster, 'balanced', state.draw));
  const data = payload(state, 1);
  data.players[0].kills = 12;
  const prepared = I.prepareFor(state, state.seriesId, data);
  assert.equal(prepared.updating, true);
  assert.equal(prepared.winnerChanged, false);
  const next = I.applyFor(state, prepared);
  assert.equal(next.results.length, 1);
  assert.deepEqual(next.games[0].draw, firstDraw);
  assert.equal(next.games[0].players[0].kills, 12);
});

test('duplicate external ID is rejected across sets and history, while same target may update', () => {
  let state = start();
  const first = payload(state);
  first.externalId = 'unique-game';
  state = imported(state, first);
  const duplicate = payload(state);
  duplicate.externalId = first.externalId;
  assert.throws(() => I.prepareFor(state, state.seriesId, duplicate), /externalId/);
  const update = payload(state, 1);
  update.externalId = first.externalId;
  assert.doesNotThrow(() => I.prepareFor(state, state.seriesId, update));
  state = H.newSeries(H.archiveCurrent(state));
  const historicalDuplicate = payload(state);
  historicalDuplicate.externalId = first.externalId;
  assert.throws(() => I.prepareFor(state, state.seriesId, historicalDuplicate), /externalId/);
});

test('winner correction rejects an impossible remaining sequence and appending to complete series', () => {
  let state = start();
  state = H.recordGame(H.recordGame(H.recordGame(state, 0), 1), 0);
  const data = payload(state, 2);
  data.winner = 0;
  assert.throws(() => I.prepareFor(state, state.seriesId, data), /衝突|충돌/);
  assert.throws(() => I.context(state, 4), /종료/);
});

test('archived import enriches old set while preserving live match, archive date, and scores', () => {
  let state = imported(start());
  const oldId = state.seriesId;
  state = H.newSeries(H.archiveCurrent(state));
  const oldEnd = state.history[0].endedAt;
  state = H.recordGame(state, 1);
  const liveBefore = clone(state);
  const oldTarget = I.targetState(state, oldId);
  const data = payload(oldTarget, 1);
  data.players[0].champion = '르블랑';
  const prepared = I.prepareFor(state, oldId, data);
  assert.equal(prepared.historical, true);
  const next = I.applyFor(state, prepared);
  assert.equal(next.seriesId, liveBefore.seriesId);
  assert.deepEqual(next.games, liveBefore.games);
  assert.deepEqual(next.results, liveBefore.results);
  assert.equal(next.history[0].id, oldId);
  assert.equal(next.history[0].endedAt, oldEnd);
  assert.equal(next.history[0].games[0].players[0].champion, '르블랑');
  assert.ok(H.validate(next));
  assert.throws(() => I.prepareFor(state, oldId, { ...data, gameNumber: 2 }), /새로운 세트/);
});

test('historical import rejects external ID already used by an unarchived ongoing game', () => {
  let state = imported(start());
  const oldId = state.seriesId;
  state = H.newSeries(H.archiveCurrent(state));
  const data = payload(state);
  data.externalId = 'ongoing';
  state = imported(state, data);
  const oldData = payload(I.targetState(state, oldId), 1);
  oldData.externalId = 'ongoing';
  assert.throws(() => I.prepareFor(state, oldId, oldData), /현재 경기/);
});

test('prompt includes exact series, date, frozen participants and no-guessing instructions', () => {
  const state = start();
  const output = I.prompt(state, 1);
  assert.ok(output.includes(state.seriesId));
  assert.ok(output.includes(state.matchDate));
  assert.ok(output.includes('파랑·빨강 진영'));
  assert.ok(output.includes('추측하지'));
  assert.ok(output.includes('null'));
  for (const player of state.roster) {
    assert.ok(output.includes(player.id));
    assert.ok(output.includes(player.name));
  }
});

test('current and previous nicknames resolve by the full normalized value, including Riot tag', () => {
  const state = start();
  const person = state.roster.find(player => player.id === 'injae');
  person.currentNickname = 'New Player#KR1';
  person.nicknameAliases = ['Old Player#KR1'];
  const participants = I.contextFor(state, state.seriesId, 1).players;
  for (const nickname of ['new player#kr1', '  Ｎｅｗ  Player#KR1  ', 'OLD PLAYER#kr1', '신인재']) {
    assert.equal(I.resolveParticipant({ playerId: null, nickname }, participants).playerId, 'injae');
  }
  for (const nickname of ['New Player', 'Old Player#KR2', '신인제']) {
    assert.equal(I.resolveParticipant({ playerId: null, nickname }, participants).playerId, null);
  }
});

test('nickname collisions block implicit mapping even when a supplied ID matches one owner', () => {
  const state = start();
  state.roster[0].currentNickname = 'shared#KR1';
  state.roster[1].nicknameAliases = ['SHARED#kr1'];
  const participants = I.contextFor(state, state.seriesId, 1).players;
  for (const playerId of [null, state.roster[0].id, state.roster[1].id]) {
    const result = I.resolveParticipant({ playerId, nickname: 'shared#kr1' }, participants);
    assert.equal(result.playerId, null);
    assert.equal(result.status, 'ambiguous_name');
  }
  const data = payload(state);
  const index = data.players.findIndex(player => player.playerId === state.roster[0].id);
  data.players[index].nickname = 'shared#KR1';
  assert.throws(() => I.prepareFor(state, state.seriesId, data), /여러 명/);
  assert.doesNotThrow(() => I.prepareFor(state, state.seriesId, data, { playerIds: data.players.map(player => player.playerId) }));
  data.players[index].playerId = 'unregistered';
  assert.equal(I.resolveParticipant(data.players[index], participants).status, 'unknown_id');
});

test('nickname mismatching a known ID requires review while an unknown new nickname accepts a known ID', () => {
  const state = start();
  state.roster[0].currentNickname = 'One#KR1';
  state.roster[1].nicknameAliases = ['Two#KR1'];
  const participants = I.contextFor(state, state.seriesId, 1).players;
  assert.equal(I.resolveParticipant({ playerId: state.roster[0].id, nickname: 'Two#KR1' }, participants).status, 'conflict');
  assert.equal(I.resolveParticipant({ playerId: state.roster[0].id, nickname: 'New#KR1' }, participants).playerId, state.roster[0].id);
});

test('imports preserve exactly observed nicknames and never synthesize them from the registry', () => {
  const state = start();
  state.roster.forEach(player => { player.currentNickname = `${player.id}#KR1`; });
  const data = payload(state);
  data.players[0].nickname = '  VisibleＮame#KR1  ';
  data.players[1].nickname = null;
  const before = clone(state.roster);
  const next = imported(state, data);
  assert.equal(next.games[0].players[0].nicknameAtMatch, '  VisibleＮame#KR1  ');
  assert.equal(next.games[0].players[1].nicknameAtMatch, null);
  assert.deepEqual(next.roster, before);
  const replacement = payload(next, 1);
  replacement.players.forEach(player => { player.nickname = null; });
  const corrected = imported(next, replacement);
  assert.ok(corrected.games[0].players.every(player => player.nicknameAtMatch === null));
});

test('remembering confirmed nicknames is opt-in, appends aliases and allows the next import to resolve', () => {
  const state = start();
  const data = payload(state);
  state.roster.forEach(player => { player.currentNickname = `Current ${player.id}#KR1`; });
  const without = I.applyFor(state, I.prepareFor(state, state.seriesId, data));
  assert.ok(without.roster.every(player => player.nicknameAliases.length === 0));
  const withAliases = I.applyFor(state, I.prepareFor(state, state.seriesId, data, { rememberNicknames: true }));
  assert.ok(withAliases.roster.every(player => player.currentNickname === `Current ${player.id}#KR1`));
  for (const player of data.players) assert.ok(withAliases.roster.find(person => person.id === player.playerId).nicknameAliases.includes(player.nickname));
  const nextData = payload(withAliases);
  nextData.players.forEach(player => { player.playerId = null; });
  assert.doesNotThrow(() => I.prepareFor(withAliases, withAliases.seriesId, nextData));
  assert.throws(() => I.prepareFor(without, without.seriesId, nextData), /찾을 수 없습니다/);
});

test('archived imports use the current registry without rewriting frozen roster or resurrecting removed aliases', () => {
  let state = start();
  state.roster.find(player => player.id === 'injae').nicknameAliases = ['Removed#KR1'];
  state = imported(state);
  const oldId = state.seriesId;
  state = H.newSeries(H.archiveCurrent(state));
  const frozen = clone(state.history.find(record => record.id === oldId).roster);
  const current = state.roster.find(player => player.id === 'injae');
  current.currentNickname = 'Current#KR1';
  current.nicknameAliases = ['Previous#KR1'];
  const target = I.contextFor(state, oldId, 1);
  assert.equal(I.resolveParticipant({ playerId: null, nickname: 'Current#KR1' }, target.players).playerId, 'injae');
  assert.equal(I.resolveParticipant({ playerId: null, nickname: 'Previous#KR1' }, target.players).playerId, 'injae');
  assert.equal(I.resolveParticipant({ playerId: null, nickname: 'Removed#KR1' }, target.players).playerId, null);
  const data = payload(I.targetState(state, oldId), 1);
  const row = data.players.find(player => player.playerId === 'injae');
  row.playerId = null; row.nickname = 'Current#KR1';
  const prepared = I.prepareFor(state, oldId, data, { rememberNicknames: true });
  const next = I.applyFor(state, prepared);
  assert.deepEqual(next.history.find(record => record.id === oldId).roster, frozen);
  assert.equal(next.roster.find(player => player.id === 'injae').currentNickname, 'Current#KR1');
  assert.equal(next.history.find(record => record.id === oldId).games[0].players.find(player => player.id === 'injae').nicknameAtMatch, 'Current#KR1');
  const stale = clone(state);
  stale.roster.find(player => player.id === 'injae').currentNickname = 'Changed#KR1';
  assert.throws(() => I.applyFor(stale, prepared), /변경/);
  const prompt = I.promptFor(state, oldId, 1);
  assert.ok(prompt.includes('Current#KR1'));
  assert.ok(prompt.includes('Previous#KR1'));
  assert.ok(!prompt.includes('Removed#KR1'));
  assert.match(prompt, /닉네임이 없으면 반드시 null/);
});

test('remembering an archived retired player gives an actionable atomic error and permits game-only registration', () => {
  let state = imported(start());
  const oldId = state.seriesId;
  state = H.newSeries(H.archiveCurrent(state));
  const retired = state.roster.find(player => player.id === 'injae');
  retired.id = 'new-player';
  retired.name = '새 선수';
  state.draw = C.makeTeams(state.roster);
  assert.ok(H.validate(state));
  const data = payload(I.targetState(state, oldId), 1);
  const row = data.players.find(player => player.playerId === 'injae');
  row.nickname = 'Old player#KR1';
  const before = clone(state);
  const prepared = I.prepareFor(state, oldId, data, { rememberNicknames: true });
  assert.throws(() => I.applyFor(state, prepared), /신인재 \(injae\).*현재 선수 명단.*선택을 해제하고 경기 기록만 등록/);
  assert.deepEqual(state, before);
  const next = I.applyFor(state, I.prepareFor(state, oldId, data, { rememberNicknames: false }));
  assert.deepEqual(next.roster, before.roster);
  assert.ok(!next.roster.some(player => player.id === 'injae'));
  assert.equal(next.history.find(record => record.id === oldId).games[0].players.find(player => player.id === 'injae').nicknameAtMatch, 'Old player#KR1');
});

// Event-flow integration through a minimal DOM adapter. This is not a browser/layout test.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settle = () => new Promise(resolve => setImmediate(resolve));
class ImportElement {
  constructor(id, tag = 'div') {
    Object.assign(this, { id, tag, value: '', hidden: false, disabled: false, checked: false, open: false, dataset: {}, listeners: {}, children: [], textContent: '' });
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  set innerHTML(value) {
    this.markup = value;
    const options = [...value.matchAll(/<option\b([^>]*)>/g)];
    if (options.length) {
      const chosen = options.find(option => /\bselected\b/.test(option[1])) || options[0];
      this.value = chosen[1].match(/value="([^"]*)"/)?.[1] || '';
    }
    this.children = [...value.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].map(match => {
      const child = new ImportElement('', 'select');
      child.dataset = Object.fromEntries([...match[1].matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(attribute => [attribute[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), attribute[2]]));
      child.innerHTML = match[2];
      return child;
    });
  }
  get innerHTML() { return this.markup || ''; }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  async emit(name, extra = {}) { for (const listener of this.listeners[name] || []) await listener({ target: this, preventDefault() {}, ...extra }); await settle(); }
  matches(selector) {
    return selector.split(',').some(part => {
      const match = part.match(/^(select)?\[data-([a-z-]+)\]$/);
      const key = match?.[2].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return match && (!match[1] || this.tag === match[1]) && Object.hasOwn(this.dataset, key);
    });
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  scrollIntoView() {}
  focus() {}
  select() { this.selected = true; }
  setSelectionRange() {}
  reportValidity() { return !!this.value.trim(); }
}
async function importApp(options = {}) {
  const html = fs.readFileSync(path.join(__dirname, '../public/import.html'), 'utf8');
  const elements = Object.fromEntries([...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)].map(match => [match[2], new ImportElement(match[2], match[1])]));
  const server = { state: options.state || start(), revision: 1, saves: [], session: options.viewer ? { user: null, role: 'viewer', canEdit: false, canManageAdmins: false } : { user: { id: 'owner-id', email: 'owner@example.test' }, role: 'owner', canEdit: true, canManageAdmins: true } };
  const document = {
    getElementById(id) { assert.ok(elements[id], `Missing #${id}`); return elements[id]; },
    querySelectorAll(selector) { return Object.values(elements).concat(elements.previewPlayers.children).filter(element => element.matches(selector)); }
  };
  const context = vm.createContext({
    document, TextEncoder, crypto: webcrypto,
    window: { addEventListener() {} }, navigator: { clipboard: { async writeText(text) { if (options.clipboardFail) throw new Error('clipboard denied'); context.copied = text; } } },
    async hostLoad() { return JSON.stringify({ state: server.state, revision: server.revision, session: server.session }); },
    async hostSave(raw, revision, reason) {
      assert.equal(revision, server.revision);
      assert.ok(server.session.canEdit);
      server.saves.push({ raw, revision, reason });
      server.state = JSON.parse(raw); server.revision++;
      return JSON.stringify({ state: server.state, revision: server.revision });
    }
  });
  vm.runInContext(`globalThis.SiteData={load:async()=>JSON.parse(await hostLoad()),save:async(state,revision,reason)=>JSON.parse(await hostSave(JSON.stringify(state),revision,reason))};`, context);
  for (const file of ['domain/core.cjs', 'domain/history-core.cjs', 'domain/import-core.cjs', 'public/import-page.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  await settle();
  return { elements, server, context };
}

test('import page previews ten rows, blocks until reviewed, then persists with audit reason', async () => {
  const app = await importApp();
  const el = app.elements;
  el.jsonText.value = JSON.stringify(payload(app.server.state));
  await el.previewBtn.emit('click');
  assert.equal(el.previewPanel.hidden, false);
  assert.equal(el.previewPlayers.children.filter(child => Object.hasOwn(child.dataset, 'playerId')).length, 10);
  assert.match(el.mappingStatus.textContent, /10명 모두/);
  assert.equal(el.registerBtn.disabled, true);
  assert.equal(app.server.saves.length, 0);
  el.reviewConfirmed.checked = true;
  await el.reviewConfirmed.emit('change');
  assert.equal(el.registerBtn.disabled, false);
  await el.registerBtn.emit('click');
  assert.equal(el.confirmDialog.open, true);
  await el.confirmSave.emit('click');
  assert.equal(app.server.saves.length, 1);
  assert.match(app.server.saves[0].reason, /JSON/);
  assert.deepEqual(app.server.state.results, [0]);
  assert.equal(el.jsonText.value, '');
});

test('viewers cannot import even with forged clicks and clipboard fallback exposes selectable prompt', async () => {
  const viewer = await importApp({ viewer: true });
  viewer.elements.jsonText.value = JSON.stringify(payload(viewer.server.state));
  for (const id of ['previewBtn', 'registerBtn', 'confirmSave']) await viewer.elements[id].emit('click');
  assert.equal(viewer.elements.importContent.hidden, true);
  assert.equal(viewer.server.saves.length, 0);
  const admin = await importApp({ clipboardFail: true });
  await admin.elements.copyPromptBtn.emit('click');
  assert.equal(admin.elements.promptDetails.open, true);
  assert.equal(admin.elements.promptText.selected, true);
  assert.ok(admin.elements.promptText.value.includes(admin.server.state.seriesId));
});

test('import preview auto-selects exact names and blocks typo, unknown ID and conflicting name until corrected', async () => {
  for (const mode of ['exact', 'typo', 'unknown-id', 'conflict']) {
    const app = await importApp();
    const el = app.elements;
    const data = payload(app.server.state);
    const target = I.context(app.server.state, 1).players;
    const index = data.players.findIndex(player => player.playerId === 'injae');
    const person = data.players[index];
    person.nickname = mode === 'typo' ? '신인제' : mode === 'conflict' ? target.find(player => player.playerId !== 'injae').name : '신인재';
    person.playerId = mode === 'unknown-id' ? 'bad-id' : mode === 'conflict' ? 'injae' : null;
    el.jsonText.value = JSON.stringify(data);
    await el.previewBtn.emit('click');
    const selector = el.previewPlayers.children.filter(child => Object.hasOwn(child.dataset, 'playerId'))[index];
    assert.equal(selector.value, mode === 'exact' ? 'injae' : '');
    el.reviewConfirmed.checked = true;
    await el.reviewConfirmed.emit('change');
    assert.equal(el.registerBtn.disabled, mode !== 'exact');
    if (mode !== 'exact') {
      assert.match(el.mappingStatus.textContent, mode === 'typo' ? /신인제.*후보:.*신인재/ : mode === 'unknown-id' ? /bad-id.*찾을 수 없습니다/ : /playerId.*다른 선수/);
      selector.value = 'injae';
      await el.previewPlayers.emit('change', { target: selector });
      assert.equal(el.reviewConfirmed.checked, false);
      assert.match(el.mappingStatus.textContent, /10명 모두/);
      el.reviewConfirmed.checked = true;
      await el.reviewConfirmed.emit('change');
      assert.equal(el.registerBtn.disabled, false);
    }
    assert.equal(app.server.saves.length, 0);
  }
});

test('import page refuses stale revision and newly revoked permission without losing JSON text', async () => {
  for (const revoke of [false, true]) {
    const app = await importApp();
    const el = app.elements;
    const raw = JSON.stringify(payload(app.server.state));
    el.jsonText.value = raw;
    await el.previewBtn.emit('click');
    el.rememberNicknames.checked = true;
    await el.rememberNicknames.emit('change');
    el.reviewConfirmed.checked = true;
    await el.reviewConfirmed.emit('change');
    await el.registerBtn.emit('click');
    if (revoke) app.server.session = { user: { id: 'owner-id' }, role: 'viewer', canEdit: false, canManageAdmins: false };
    else app.server.revision++;
    await el.confirmSave.emit('click');
    assert.equal(app.server.saves.length, 0);
    assert.equal(el.jsonText.value, raw);
    assert.equal(el.previewPanel.hidden, true);
    assert.ok(app.server.state.roster.every(player => player.nicknameAliases.length === 0));
    assert.match(el.importError.textContent, /변경/);
  }
});

test('import page nickname remembering defaults off and persists only a reviewed opt-in with the game', async () => {
  for (const remember of [false, true]) {
    const app = await importApp();
    const el = app.elements;
    const data = payload(app.server.state);
    el.jsonText.value = JSON.stringify(data);
    await el.previewBtn.emit('click');
    assert.equal(el.rememberNicknames.checked, false);
    el.reviewConfirmed.checked = true;
    if (remember) {
      el.rememberNicknames.checked = true;
      await el.rememberNicknames.emit('change');
      assert.equal(el.reviewConfirmed.checked, false);
    }
    el.reviewConfirmed.checked = true;
    await el.reviewConfirmed.emit('change');
    await el.registerBtn.emit('click');
    assert.equal(el.confirmDescription.textContent.includes('추가 닉네임으로 함께 저장'), remember);
    assert.ok(app.server.state.roster.every(player => player.nicknameAliases.length === 0));
    await el.confirmSave.emit('click');
    assert.equal(app.server.saves.length, 1);
    assert.equal(app.server.state.games[0].players[0].nicknameAtMatch, data.players[0].nickname);
    assert.equal(app.server.state.roster.some(player => player.nicknameAliases.length > 0), remember);
    assert.equal(el.rememberNicknames.checked, false);
    const next = payload(app.server.state);
    next.players.forEach(player => { player.playerId = null; });
    el.targetGame.value = String(next.gameNumber);
    await el.targetGame.emit('change');
    el.jsonText.value = JSON.stringify(next);
    await el.previewBtn.emit('click');
    const mappings = el.previewPlayers.children.filter(child => Object.hasOwn(child.dataset, 'playerId'));
    assert.equal(mappings.every(input => input.value !== ''), remember);
  }
});

test('import preview requires manual collision confirmation and escapes nicknames in all HTML output', async () => {
  const state = start();
  state.roster[0].currentNickname = '<img src=x onerror=alert(1)>#KR1';
  state.roster[1].nicknameAliases = [state.roster[0].currentNickname];
  const app = await importApp({ state });
  const el = app.elements;
  const data = payload(state);
  const index = data.players.findIndex(player => player.playerId === state.roster[0].id);
  data.players[index].nickname = state.roster[0].currentNickname;
  el.jsonText.value = JSON.stringify(data);
  await el.previewBtn.emit('click');
  const selector = el.previewPlayers.children.filter(child => Object.hasOwn(child.dataset, 'playerId'))[index];
  assert.equal(selector.value, '');
  assert.match(el.mappingStatus.textContent, /여러 명/);
  assert.ok(!el.previewPlayers.innerHTML.includes('<img'));
  assert.ok(el.previewPlayers.innerHTML.includes('&lt;img'));
  selector.value = state.roster[0].id;
  await el.previewPlayers.emit('change', { target: selector });
  assert.match(el.mappingStatus.textContent, /10명 모두/);
});
