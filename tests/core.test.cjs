'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const core = require('../domain/core.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const signature = draw => draw.teams.map(team => team.map(slot => slot.role + ':' + slot.id).sort().join('|')).join('/');

function assertLegal(draw, roster) {
  assert.equal(draw.teams.length, 2);
  assert.equal(new Set(draw.teams.flat().map(slot => slot.id)).size, 10);
  draw.teams.forEach((team, i) => {
    assert.equal(team.length, 5);
    assert.equal(new Set(team.map(slot => slot.role)).size, 5);
    assert.ok(team.some(slot => slot.id === core.CAPTAINS[i]));
    team.forEach(slot => {
      const person = roster.find(person => person.id === slot.id);
      assert.ok(person);
      assert.ok(!person.excluded.includes(slot.role));
    });
  });
  assert.deepEqual(core.summarize(draw.teams, roster), draw.metrics);
}

test('default roster preserves all 10 names, tiers and ordered role preferences', () => {
  assert.deepEqual(core.DEFAULT_ROSTER.map(p => [p.id, p.name, p.tier, p.primary, p.secondary, p.excluded]), [
    ['injae','신인재','silver','top',['mid','jungle'],[]],
    ['seungju','피승주','gold','mid',['top'],[]],
    ['dongin','홍동인','gold','top',['mid'],[]],
    ['minjae','권민재','diamond','adc',['fill'],[]],
    ['seongpyo','전성표','emerald','top',['jungle'],[]],
    ['haeram','최해람','silver','mid',['top'],[]],
    ['junhyeok','전준혁','gold','top',['mid'],[]],
    ['sejun','권세준','silver','mid',['top','jungle'],[]],
    ['changwoo','유창우','silver','fill',[],['support']],
    ['jongwon','이종원','diamond','adc',['fill'],[]]
  ]);
  const one = core.createDefaultState();
  one.roster[0].secondary.push('adc');
  assert.deepEqual(core.createDefaultState().roster[0].secondary, ['mid','jungle']);
  assert.ok(core.validateState(core.createDefaultState()));
});

test('balanced and random draws preserve 5 roles, captains, exclusions, and input immutability', () => {
  const roster = core.createDefaultState().roster;
  const before = clone(roster);
  for (const mode of ['balanced','random']) {
    let previous = null;
    for (let i = 0; i < 12; i += 1) {
      const draw = core.makeTeams(roster, mode, previous);
      assertLegal(draw, roster);
      assert.equal(draw.mode, mode);
      if (previous) assert.notEqual(signature(draw), signature(previous));
      if (mode === 'balanced') {
        assert.equal(draw.metrics.difference, 0);
        assert.equal(draw.metrics.offRole, 1);
      }
      previous = draw;
    }
  }
  assert.deepEqual(roster, before);
});

test('secondary preferences retain their entered priority', () => {
  const injae = core.DEFAULT_ROSTER.find(p => p.id === 'injae');
  assert.equal(core.fit(injae, 'mid').cost, 2);
  assert.equal(core.fit(injae, 'jungle').cost, 3);
  assert.ok(core.fit(injae, 'top').cost < core.fit(injae, 'mid').cost);
});

test('an excluded role remains impossible, even if every other assignment is expensive', () => {
  const roster = core.createDefaultState().roster;
  roster.forEach(p => { p.primary = 'fill'; p.secondary = []; p.excluded = ['support']; });
  assert.throws(() => core.makeTeams(roster), /만들 수 없습니다/);
  const changwoo = core.DEFAULT_ROSTER.find(p => p.id === 'changwoo');
  assert.equal(core.fit(changwoo, 'support').kind, 'excluded');
  assert.equal(core.fit(changwoo, 'jungle').kind, 'flex');
});

test('best-of rules stop at clinch and undo restores the next game', () => {
  assert.deepEqual(core.seriesStatus(3,[0,1]), { wins:[1,1], target:2, winner:null, nextGame:3, complete:false });
  assert.deepEqual(core.seriesStatus(3,[0,1,0]), { wins:[2,1], target:2, winner:0, nextGame:null, complete:true });
  assert.deepEqual(core.seriesStatus(5,[1,0,1,1]), { wins:[1,3], target:3, winner:1, nextGame:null, complete:true });
  assert.equal(core.seriesStatus(5,[1,0,1]).nextGame, 4);
  assert.equal(core.seriesStatus(1,[1]).winner, 1);
  assert.equal(core.seriesStatus(7,[0,0,0,0]).target, 4);
  assert.throws(() => core.seriesStatus(5,[0,0,0,1]), /종료 후/);
  for (const bad of [0,2,4,'3',null,undefined]) assert.throws(() => core.seriesStatus(bad,[]));
  for (const bad of [[2],[true],['0'],new Array(1),null,{},[0,0,0,0]]) assert.throws(() => core.seriesStatus(3,bad));
});

test('state validation rejects corrupted draws and accepts complete/restored series', () => {
  const state = core.createDefaultState();
  state.draw = core.makeTeams(state.roster);
  state.drawNumber = 1;
  state.results = [0,1,0];
  assert.ok(core.validateState(state));
  assert.ok(core.validateState(clone(state)));
  const corruptions = [
    s => { s.version = 2; },
    s => { s.drawNumber = -1; },
    s => { s.roster[0].name = ''; },
    s => { s.roster[0].id = s.roster[1].id; },
    s => { s.roster[0].tier = 'super'; },
    s => { s.roster[0].active = false; },
    s => { s.roster[0].primary = 'bottom'; },
    s => { s.roster[0].excluded = ['top']; },
    s => { s.roster[0].secondary = ['mid','mid']; },
    s => { s.draw.teams[0][0] = clone(s.draw.teams[0][1]); },
    s => { s.draw.teams.reverse(); },
    s => { s.draw.createdAt = 'not a date'; },
    s => { s.draw.createdAt = '2026-10-07'; },
    s => { s.roster[0].secondary = new Array(1); },
    s => { s.draw.metrics.totals[0] += 1; },
    s => { s.draw.metrics.offRole = 0; },
    s => { s.results = [0,0,1]; },
    s => { s.draw = null; }
  ];
  corruptions.forEach(mutate => { const broken = clone(state); mutate(broken); assert.equal(core.validateState(broken), false); });
  for (const malformed of [null,undefined,[],{},'state',42]) assert.equal(core.validateState(malformed), false);
});

test('invalid roster inputs fail clearly before generating a draw', () => {
  const original = core.createDefaultState().roster;
  const withoutCaptain = clone(original);
  withoutCaptain.find(p => p.id === 'jongwon').id = 'other';
  assert.throws(() => core.makeTeams(withoutCaptain), /팀장/);
  assert.throws(() => core.makeTeams(original.slice(0,9)), /10명/);
  assert.throws(() => core.makeTeams(original,'unknown'), /지원하지/);
  const contradiction = clone(original);
  contradiction[0].secondary.push('top');
  assert.throws(() => core.makeTeams(contradiction), /중복/);
});
