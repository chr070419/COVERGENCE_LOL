'use strict';
// Recap and achievements are counts, maxima and orderings of recorded games.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../domain/player-stats.cjs');
globalThis.LoLCore = require('../domain/core.cjs');
globalThis.LoLHistory = require('../domain/history-core.cjs');
require('../public/player-insights.js');
require('../public/player-demo.js');
require('../public/player-recap.js');
const I = globalThis.LoLPlayerInsights;
const R = globalThis.LoLPlayerRecap;

function game(index, overrides = {}) {
  const row = { seriesId: `s-${String(index).padStart(2, '0')}`, setNumber: 1, date: `2026-10-${String(index).padStart(2, '0')}`, endedAt: `2026-10-${String(index).padStart(2, '0')}T12:00:00Z`, won: true, champion: 'Ahri', position: 'mid', kills: 5, deaths: 2, assists: 6, cs: 180, durationSeconds: 1800, damage: 20000, ...overrides };
  row.kda = S.calculateKDA(row.kills, row.deaths, row.assists);
  return row;
}
function detail(rows) {
  const recent = rows.slice().reverse();
  return { profile: { id: 'p', name: '선수' }, recent, totals: S.aggregateStats(recent), positions: S.aggregateByPosition(recent), champions: S.aggregateByChampion(recent), form: S.getRecentForm(recent), teammates: [] };
}
const byId = list => Object.fromEntries(list.map(item => [item.id, item]));

test('demo achievements unlock on the exact first qualifying game', () => {
  const demo = S.selectPlayer(globalThis.LoLPlayerDemo.createState(), 'haeram');
  const list = byId(R.achievements(demo));
  assert.equal(R.achievements(demo).filter(item => item.unlocked).length, 9);
  assert.equal(list['first-win'].game.champion, 'Gnar');
  assert.equal(list['streak-3'].game.date, '2026-10-07');
  assert.equal(list['kills-10'].game.kills, 10);
  assert.equal(list['streak-5'].unlocked, false);
  assert.equal(list['streak-5'].value, 4);
  assert.equal(list['streak-5'].hint, '다음 경기를 이기면 달성');
  assert.equal(list['games-30'].hint, '6경기 더 출전하면 달성');
  assert.equal(list['lanes-3'].hint, '2 / 3 · 1곳 더');
});

test('missing K/D/A never counts and K/D/A milestones say 미수집 instead of zero progress', () => {
  const list = byId(R.achievements(detail([game(1, { kills: null, deaths: null, assists: null }), game(2, { kills: 12, deaths: null })])));
  for (const id of ['kills-10', 'assists-20', 'deathless']) { assert.equal(list[id].unknown, true); assert.equal(list[id].value, null); assert.equal(list[id].unlocked, false); }
  const html = R.renderAchievements(R.achievements(detail([game(1, { kills: null })])));
  assert.match(html, /K\/D\/A 미수집/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('streak, best day and recap facts come straight from the ordered games', () => {
  const rows = [game(1), game(2, { won: false }), game(3), game(4), game(5), game(5, { seriesId: 's-05b', endedAt: '2026-10-05T13:00:00Z', won: false })];
  const data = R.recap(detail(rows));
  assert.equal(data.games, 6);
  assert.equal(data.streak.count, 3);
  assert.equal(data.streak.start.date, '2026-10-03');
  assert.equal(data.first.date, '2026-10-01');
  assert.deepEqual([data.bestDay.wins, data.bestDay.losses], [1, 0]);
  assert.equal(data.bestDay.date, '2026-10-04');
  assert.equal(R.recap(detail([])), null);
});

test('story slides escape names, skip empty facts and never show a rating', () => {
  const rows = [game(1, { champion: '<img src=x>', kills: null, deaths: null, assists: null })];
  const slides = R.renderStory(R.recap({ ...detail(rows), profile: { name: '<b>x</b>' } }));
  const html = slides.join('');
  assert.doesNotMatch(html, /<img|<b>x<\/b>/);
  assert.doesNotMatch(html, /CAREER HIGHS/);
  assert.doesNotMatch(html, /MVP|MMR|ACE|점수|평점|Score/);
  assert.match(html, /SEASON RECAP/);
  assert.match(html, /data-recap-explore/);
});

test('unlocked tiles link to their game with the same key the chart uses', () => {
  const rows = [game(1), game(2)];
  const html = R.renderAchievements(R.achievements(detail(rows)));
  assert.ok(html.includes(`data-hero-game="${encodeURIComponent(I.gameKey(rows[0]))}"`));
  assert.match(html, /class="ac-tile is-locked/);
});
