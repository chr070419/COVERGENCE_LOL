'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const C = require('../domain/core.cjs');
const H = require('../domain/history-core.cjs');
const S = require('../domain/player-stats.cjs');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/player-demo.js'), 'utf8');

function browser() {
  const context = vm.createContext({});
  for (const file of ['domain/core.cjs', 'domain/history-core.cjs', 'domain/player-stats.cjs', 'public/player-demo.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  return { demo: context.LoLPlayerDemo, history: context.LoLHistory, stats: context.LoLPlayerStats };
}
const plain = value => JSON.parse(JSON.stringify(value));
const fixture = () => plain(browser().demo.createState());

test('detached browser fixture is canonical without crypto, current time, storage or network', () => {
  const { demo, history } = browser();
  assert.equal(demo.PLAYER_ID, 'haeram');
  const first = demo.createState(), second = demo.createState();
  assert.equal(history.validate(first), true);
  assert.equal(H.validate(plain(first)), true);
  assert.deepEqual(plain(first), plain(second));
  assert.equal(first.history.length, 24);
  assert.equal(first.games.length, 0);
  assert.equal(first.history[0].date, '2026-10-07');
  assert.equal(first.history.at(-1).date, '2026-09-23');
  assert.equal(new Set(first.history.map(item => item.date)).size, 8);
});

test('24 match sources derive 15 wins, 9 losses, four current wins and actual roles', () => {
  const stats = S.selectPlayer(fixture(), 'haeram');
  assert.deepEqual([stats.totals.games, stats.totals.wins, stats.totals.losses, stats.totals.winRate], [24, 15, 9, 62.5]);
  assert.deepEqual(stats.form.results, [true, true, true, true, false]);
  assert.deepEqual(stats.form.streak, { won: true, count: 4 });
  assert.deepEqual(stats.positions.filter(row => row.games).map(row => [row.id, row.games]), [['top', 8], ['mid', 16]]);
  assert.deepEqual(stats.champions.map(row => [row.name, row.games]), [['Ahri', 7], ['Orianna', 5], ['Sylas', 4], ['Gnar', 3], ['Renekton', 3], ['Ornn', 2]]);
  assert.equal(stats.recent[0].seriesId, 'demo-haeram-24');
  assert.equal(stats.recent.at(-1).seriesId, 'demo-haeram-01');
});

test('zero-death result and missing historical measurements retain distinct meanings', () => {
  const stats = S.selectPlayer(fixture(), 'haeram');
  const perfect = stats.recent.filter(row => row.deaths === 0);
  assert.equal(perfect.length, 1);
  assert.deepEqual(perfect[0].kda, { ratio: null, perfect: true });
  assert.equal(perfect[0].seriesId, 'demo-haeram-23');
  assert.equal(stats.totals.samples.cs, 23);
  assert.equal(stats.totals.samples.damage, 21);
  assert.equal(stats.totals.csPerMinuteGames, 22);
  assert.equal(stats.recent.find(row => row.seriesId === 'demo-haeram-02').cs, null);
  assert.equal(stats.recent.find(row => row.seriesId === 'demo-haeram-03').durationSeconds, null);
  assert.equal(stats.recent.find(row => row.seriesId === 'demo-haeram-03').cs, 228);
  assert.equal(stats.totals.kda.kills, 159);
  assert.equal(stats.totals.kda.deaths, 86);
  assert.equal(stats.totals.kda.assists, 262);
  assert.equal(stats.totals.kda.ratio, 421 / 86);
  assert.equal(stats.totals.averages.cs, 5119 / 23);
  assert.equal(stats.totals.csPerMinute, 4891 / (42960 / 60));
});

test('only the requested player has their real identity and demo participants never inherit coworker names or nicknames', () => {
  const state = fixture(), stats = S.selectPlayer(state, 'haeram');
  assert.equal(stats.profile.name, '최해람');
  assert.equal(stats.profile.tier, 'silver');
  assert.equal(stats.profile.primary, 'mid');
  assert.deepEqual(stats.profile.secondary, ['top']);
  const realNames = C.DEFAULT_ROSTER.filter(person => person.id !== 'haeram').map(person => person.name);
  const allPeople = state.roster.concat(state.history.flatMap(series => series.roster));
  allPeople.forEach(person => {
    assert.ok(!realNames.includes(person.name));
    if (person.id !== 'haeram') assert.match(person.name, /^데모 참가자 \d{2}$/);
    assert.equal(person.currentNickname, null);
    assert.deepEqual(person.nicknameAliases, []);
  });
  state.history.forEach(series => {
    assert.deepEqual(series.teamNames, ['데모 블루', '데모 레드']);
    series.games.forEach(game => {
      assert.match(game.notes, /가상 경기/);
      game.players.forEach(person => assert.equal(person.nicknameAtMatch, null));
    });
  });
});

test('fixture callers and selector consumers cannot mutate subsequent previews', () => {
  const { demo, stats } = browser();
  const original = demo.createState(), expected = plain(original), selected = stats.selectPlayer(original, 'haeram');
  selected.profile.name = 'changed'; selected.profile.secondary.push('support'); selected.recent[0].kills = 999;
  assert.deepEqual(plain(original), expected);
  original.roster[0].name = 'changed';
  original.history[0].games[0].players.find(person => person.id === 'haeram').kills = 999;
  original.history[0].draw.teams[0][0].id = 'broken';
  assert.deepEqual(plain(demo.createState()), expected);
});

test('CommonJS fallback resolves the existing domain modules without a browser', () => {
  // public JS is served as a classic script in a type:module package. Exercise
  // its CommonJS branch explicitly rather than changing package module rules.
  const module = { exports: {} };
  const requireFromDemo = createRequire(path.join(root, 'public/player-demo.js'));
  vm.runInThisContext('(function(globalThis,require,module){' + source + '\n})')({}, requireFromDemo, module);
  const state = module.exports.createState();
  assert.equal(module.exports.PLAYER_ID, 'haeram');
  assert.equal(H.validate(state), true);
  assert.equal(S.selectPlayer(state, 'haeram').totals.games, 24);
});

test('preview remains source-derived under filtering, match correction and removal', () => {
  const state = fixture();
  const day = S.selectPlayer(state, 'haeram', { date: '2026-10-07' });
  assert.deepEqual([day.totals.games, day.totals.wins, day.totals.losses], [3, 3, 0]);
  assert.equal(S.selectPlayer(state, 'haeram', { date: '2026-10-08' }).totals.games, 0);
  assert.equal(Object.hasOwn(state, 'totals'), false);
  state.history[0].results[0] = 1;
  state.history[0].games[0].winner = 1;
  assert.equal(H.validate(state), true);
  assert.equal(S.selectPlayer(state, 'haeram').totals.wins, 14);
  state.history.shift();
  assert.deepEqual([S.selectPlayer(state, 'haeram').totals.games, S.selectPlayer(state, 'haeram').totals.losses], [23, 9]);
});
