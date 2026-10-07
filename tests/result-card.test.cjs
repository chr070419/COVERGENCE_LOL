'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const C = require('../domain/core.cjs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/result-card.js'), 'utf8');
const context = vm.createContext({ LoLCore: C });
vm.runInContext(source, context);
const R = context.ResultCard;
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(results = []) {
  const state = C.createDefaultState();
  state.draw = C.makeTeams(state.roster); state.drawNumber = 1;
  state.matchDate = '2026-10-07'; state.results = results.slice();
  state.games = results.map(winner => ({ winner, draw: clone(state.draw) }));
  return state;
}
function changedDraw(state) {
  const draw = clone(state.draw);
  const team = draw.teams.find(members => members.some(slot => slot.id === 'minjae'));
  const captain = team.find(slot => slot.id === 'minjae');
  const candidate = team.find(slot => slot.id !== captain.id && slot.role !== 'support' && state.roster.find(person => person.id === slot.id).excluded.indexOf(captain.role) === -1);
  const role = captain.role; captain.role = candidate.role; candidate.role = role;
  C.summarize(draw.teams, state.roster, draw.constraints);
  return draw;
}

test('card uses recorded set lineups and labels an unplayed changed lineup separately', () => {
  const state = fixture([0]);
  const played = clone(state.games[0].draw);
  state.draw = changedDraw(state);
  const model = R.buildModel(state);
  assert.equal(model.groups.length, 2);
  assert.equal(model.groups[0].pending, false);
  assert.equal(model.groups[1].pending, true);
  assert.deepEqual(Array.from(model.groups[0].sets), [1]);
  const firstRoles = model.groups[0].teams.flat().map(person => person.id + ':' + person.role).sort();
  assert.deepEqual(Array.from(firstRoles), played.teams.flat().map(person => person.id + ':' + person.role).sort());
  assert.notEqual(model.groups[0].key, model.groups[1].key);
});

test('finished snapshot excludes any unrelated final draft lineup', () => {
  const state = fixture([0, 0]);
  state.status = 'completed'; state.date = state.matchDate;
  state.draw = changedDraw(state);
  const model = R.buildModel(state);
  assert.equal(model.groups.length, 1);
  assert.deepEqual(Array.from(model.groups[0].sets), [1, 2]);
  assert.equal(model.winner, 0);
  assert.equal(model.groups[0].pending, false);
});

test('seven distinct consecutive set groups fit a bounded dynamic export canvas', () => {
  const state = fixture([0, 1, 0, 1, 0, 1, 0]);
  state.bestOf = 7; state.status = 'completed';
  const alternate = changedDraw(state);
  state.games.forEach((game, index) => { if (index % 2) game.draw = clone(alternate); });
  const model = R.buildModel(state);
  assert.equal(model.groups.length, 7);
  assert.equal(model.results.length, 7);
  assert.ok(model.height > 3500 && model.height < 5000);
  assert.ok(model.width * model.height < 5000000);
});

test('lineup cards without results and legacy cards remain supported', () => {
  const fresh = R.buildModel(fixture());
  assert.equal(fresh.groups.length, 1);
  assert.equal(fresh.groups[0].pending, true);
  assert.match(fresh.stateLabel, /경기 시작 전/);
  const legacy = fixture([1]); delete legacy.games;
  legacy.status = 'stopped'; legacy.date = legacy.matchDate;
  const model = R.buildModel(legacy);
  assert.equal(model.groups.length, 1);
  assert.match(model.stateLabel, /중도 종료/);
});

test('unlocking captains is respected and broken set arrays fail visibly', () => {
  const state = fixture([0]);
  state.draw.constraints = { captainsLocked: false, separatePairs: [], avoidRepeat: true };
  const teamA = state.draw.teams.find(team => team.some(slot => slot.id === 'jongwon'));
  const teamB = state.draw.teams.find(team => team.some(slot => slot.id === 'minjae'));
  const a = teamA.find(slot => slot.id === 'jongwon'), b = teamB.find(slot => slot.id === 'minjae');
  const id = a.id; a.id = b.id; b.id = id;
  state.games[0].draw = clone(state.draw);
  assert.equal(R.buildModel(state).results.length, 1);
  state.games = [];
  assert.throws(() => R.buildModel(state), /세트 결과와 라인업/);
});

test('measured truncation retains whole unicode code points and fits the allotted cell', () => {
  const context = { measureText(value) { return { width: Array.from(value).length * 20 }; } };
  assert.equal(R.clipText(context, '매우긴이름입니다', 80), '매우긴…');
  assert.equal(R.clipText(context, '😀😀😀😀', 60), '😀😀…');
  assert.equal(R.clipText(context, '신인재', 80), '신인재');
});

test('PNG renderer waits for fonts and keeps every text label within a seven-set canvas', async () => {
  const state = fixture([0, 1, 0, 1, 0, 1, 0]); state.bestOf = 7; state.status = 'completed';
  const alternate = changedDraw(state);
  state.games.forEach((game, index) => { if (index % 2) game.draw = clone(alternate); });
  state.roster[0].name = '최대한길게작성된이름을카드범위안에표시하는지확인';
  let loadedFonts = 0, drewText = 0;
  const canvas = { width: 0, height: 0,
    toBlob(callback, mime) { assert.equal(mime, 'image/png'); callback(new Blob(['test-png'], { type: mime })); } };
  const graphics = {
    measureText(value) { const size = Number(this.font.match(/ (\d+)px /)[1]); return { width: Array.from(value).length * size * 0.7 }; },
    fillText(value, x, y) {
      assert.equal(loadedFonts, 3, 'all required font weights must finish loading');
      const width = this.measureText(value).width;
      const left = this.textAlign === 'center' ? x - width / 2 : this.textAlign === 'right' ? x - width : x;
      assert.ok(left >= 0 && left + width <= canvas.width, 'text must remain inside the canvas');
      assert.ok(y > 0 && y < canvas.height, 'text must not be vertically clipped'); drewText++;
    },
  };
  for (const method of ['fillRect', 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath', 'fill', 'stroke']) graphics[method] = () => {};
  canvas.getContext = type => { assert.equal(type, '2d'); return graphics; };
  const outputContext = vm.createContext({ LoLCore: C, Blob, document: {
    fonts: { async load() { await Promise.resolve(); loadedFonts++; }, ready: Promise.resolve() },
    createElement(tag) { assert.equal(tag, 'canvas'); return canvas; }
  }, URL: { createObjectURL(blob) { assert.equal(blob.type, 'image/png'); return 'blob:result-card-test'; } } });
  vm.runInContext(source, outputContext);
  const output = await outputContext.ResultCard.createCard(state);
  assert.equal(output.url, 'blob:result-card-test');
  assert.equal(output.filename, '융합본부_내전_2026-10-07_4-3.png');
  assert.ok(drewText > 200);
  assert.equal(canvas.height, output.model.height);
});
