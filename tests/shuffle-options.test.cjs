'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const C = require('../domain/core.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const membershipKey = draw => draw.teams.map(team => team.map(slot => slot.id).sort().join('|')).sort().join('/');
const teamOf = (draw, id) => draw.teams.findIndex(team => team.some(slot => slot.id === id));

function flatRoster() {
  return C.createDefaultState().roster.map(person => ({ ...person, tier: 'gold', primary: 'fill', secondary: [], excluded: [] }));
}

function assertDraw(draw, roster) {
  assert.equal(new Set(draw.teams.flat().map(slot => slot.id)).size, 10);
  assert.deepEqual(draw.metrics, C.summarize(draw.teams, roster, draw.constraints));
  const state = { ...C.createDefaultState(), roster, draw, drawNumber: 1 };
  assert.equal(C.validateState(state), true);
}

test('shuffle options default to legacy captains and canonicalize unordered separation pairs', () => {
  assert.deepEqual(C.normalizeShuffleOptions(), { captainsLocked: true, separatePairs: [], avoidRepeat: true });
  const source = { captainsLocked: false, separatePairs: [['jongwon','injae'], ['seungju','dongin']], avoidRepeat: false };
  const before = clone(source);
  assert.deepEqual(C.normalizeShuffleOptions(source, C.DEFAULT_ROSTER), { captainsLocked: false, separatePairs: [['dongin','seungju'], ['injae','jongwon']], avoidRepeat: false });
  assert.deepEqual(source, before);
  for (const invalid of [null, [], {captainsLocked: 1}, {avoidRepeat: 'yes'}, {separatePairs: [['injae','injae']]}, {separatePairs: [['injae','missing']]}, {separatePairs: [['injae','jongwon'],['jongwon','injae']]}, {separatePairs: Array(11).fill(['injae','jongwon'])}, {separatePairs: [new Array(2)]}]) {
    assert.throws(() => C.normalizeShuffleOptions(invalid, C.DEFAULT_ROSTER));
  }
});

test('unlocking captains permits a forced same-team pair while separation remains a hard constraint', () => {
  const roster = C.createDefaultState().roster;
  const options = { captainsLocked: false, separatePairs: [['jongwon','injae'], ['minjae','injae']] };
  const draw = C.makeTeams(roster, 'balanced', null, options);
  assert.equal(teamOf(draw, 'jongwon'), teamOf(draw, 'minjae'));
  assert.notEqual(teamOf(draw, 'injae'), teamOf(draw, 'minjae'));
  assert.equal(draw.constraints.captainsLocked, false);
  assertDraw(draw, roster);
  assert.throws(() => C.summarize(draw.teams, roster), /팀장/);
  assert.throws(() => C.makeTeams(roster, 'balanced', null, {...options, captainsLocked: true}), /만들 수 없습니다/);
  const broken = clone(draw);
  broken.constraints.captainsLocked = true;
  assert.equal(C.validateState({...C.createDefaultState(), draw: broken, drawNumber: 1}), false);
});

test('separation constraints reject impossible graphs and invalid stored lineups', () => {
  const roster = C.createDefaultState().roster;
  const triangle = [['injae','seungju'], ['seungju','dongin'], ['dongin','injae']];
  assert.throws(() => C.makeTeams(roster, 'random', null, {captainsLocked: false, separatePairs: triangle}), /만들 수 없습니다/);
  const draw = C.makeTeams(roster);
  const pair = draw.teams[0].slice(0,2).map(slot => slot.id);
  assert.throws(() => C.summarize(draw.teams, roster, {separatePairs: [pair]}), /같은 팀/);
  draw.constraints.separatePairs = [pair];
  assert.equal(C.validateState({...C.createDefaultState(), draw, drawNumber: 1}), false);
});

test('candidate previews have distinct memberships, cloned data, and legal roles for both modes', () => {
  const roster = flatRoster();
  for (const mode of ['balanced','random']) {
    const before = clone(roster);
    const draws = C.makeCandidates(roster, mode, null, {captainsLocked: false}, 3);
    assert.equal(draws.length, 3);
    assert.equal(new Set(draws.map(membershipKey)).size, 3);
    draws.forEach(draw => assertDraw(draw, roster));
    assert.deepEqual(roster, before);
    const secondBefore = clone(draws[1]);
    draws[0].constraints.separatePairs.push(['injae','seungju']);
    draws[0].teams[0][0].id = 'mutated';
    assert.deepEqual(draws[1], secondBefore);
  }
  for (const count of [0, 11, 1.5, '3']) assert.throws(() => C.makeCandidates(roster, 'balanced', null, {}, count));
});

test('repeat minimization compares teammates across team sides and can be disabled', t => {
  const previousRandom = globalThis.TeamDrawCore;
  globalThis.TeamDrawCore = {randomInt: () => 0};
  t.after(() => { if (previousRandom === undefined) delete globalThis.TeamDrawCore; else globalThis.TeamDrawCore = previousRandom; });
  const roster = flatRoster();
  const previous = C.makeTeams(roster, 'random', null, {avoidRepeat: false});
  const unconstrained = C.makeTeams(roster, 'random', previous, {avoidRepeat: false});
  assert.equal(C.repeatPairs(unconstrained, previous), 20);
  assert.equal(C.repeatPairs({teams: previous.teams.slice().reverse()}, previous), 20);
  assert.equal(C.repeatPairs(previous, null), 0);
  const diversified = C.makeCandidates(roster, 'random', previous, {avoidRepeat: true}, 3);
  assert.equal(diversified.length, 3);
  diversified.forEach(draw => assert.equal(C.repeatPairs(draw, previous), 8));
});

test('balanced repeat avoidance preserves the established tier and lane balance', () => {
  const roster = C.createDefaultState().roster;
  const previous = C.makeTeams(roster);
  const draws = C.makeCandidates(roster, 'balanced', previous, {avoidRepeat: true}, 3);
  assert.ok(draws.length > 0);
  draws.forEach(draw => {
    assert.equal(draw.metrics.difference, 0);
    assert.equal(draw.metrics.offRole, 1);
    assertDraw(draw, roster);
  });
});

test('old draws without constraints keep legacy captain validation', () => {
  const state = C.createDefaultState();
  state.draw = C.makeTeams(state.roster);
  state.drawNumber = 1;
  delete state.draw.constraints;
  delete state.shuffleOptions;
  assert.equal(C.validateState(state), true);
  state.draw.teams.reverse();
  assert.equal(C.validateState(state), false);
});

test('a fully constrained split returns one preview instead of duplicate candidates', () => {
  const roster = flatRoster();
  const others = roster.filter(person => !C.CAPTAINS.includes(person.id));
  const separatePairs = others.map((person, index) => [person.id, C.CAPTAINS[index < 4 ? 1 : 0]]);
  const draws = C.makeCandidates(roster, 'balanced', null, {separatePairs}, 3);
  assert.equal(draws.length, 1);
  assertDraw(draws[0], roster);
  others.forEach((person, index) => assert.equal(teamOf(draws[0], person.id), index < 4 ? 0 : 1));
});
