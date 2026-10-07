'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../domain/player-stats.cjs');
const fs = require('node:fs');
const vm = require('node:vm');
const visualContext = vm.createContext({ module: { exports: {} } });
vm.runInContext(fs.readFileSync(require.resolve('../public/player-visuals.js'), 'utf8'), visualContext);
const V = visualContext.module.exports;

function fixture(rows = []) {
  return {
    profile: { id: 'player-a', name: '선수 A', primary: 'mid' },
    totals: S.aggregateStats(rows),
    recent: rows,
    positions: S.aggregateByPosition(rows),
    champions: S.aggregateByChampion(rows),
    form: S.getRecentForm(rows),
    missing: { position: rows.filter(row => !row.position).length, champion: rows.filter(row => !row.champion).length }
  };
}

function game(index, changes = {}) {
  return { seriesId: 'sample', setNumber: index, date: `2026-10-${String(index).padStart(2, '0')}`, won: true, position: 'mid', champion: 'Ahri', kills: 8, deaths: 2, assists: 11, cs: 184, durationSeconds: 1934, ...changes };
}

test('explorer all-position mode has no falsely selected map role', () => {
  const detail = fixture([game(1), game(2, { position: 'top' })]);
  const all = V.renderPositions(detail, '', { allowAll: true });
  assert.doesNotMatch(all, /aria-pressed="true"/);
  assert.match(all, /전체 포지션/);
  const mid = V.renderPositions(detail, 'mid', { allowAll: true });
  assert.match(mid, /data-visual-role="mid" aria-pressed="true"/);
  assert.equal((mid.match(/aria-pressed="true"/g) || []).length, 1);
});

test('overview shows exact 6/4 results and 60.0%, including ring segment distribution', () => {
  const detail = fixture(Array.from({ length: 10 }, (_, index) => game(index + 1, { won: index < 6 })));
  const result = V.renderOverview(detail);
  assert.match(result, /60\.0%/);
  assert.match(result, /10경기 누적/);
  // Count-up targets wrap the exact final text; motion never changes the value.
  assert.match(result, /<b><span data-count-key="hero-wins" data-count-value="6" data-count-digits="0">6<\/span><\/b> 승/);
  assert.match(result, /<b><span data-count-key="hero-losses" data-count-value="4" data-count-digits="0">4<\/span><\/b> 패/);
  assert.match(result, /data-count-value="60" data-count-digits="1" data-count-suffix="%">60\.0%<\/span>/);
  assert.match(result, /stroke-dasharray="60 40"/);
  assert.match(result, /stroke-dasharray="40 60" stroke-dashoffset="-60"/);
});

test('empty source stays empty, never fabricates 0% or Perfect', () => {
  const detail = fixture();
  const overview = V.renderOverview(detail);
  assert.match(overview, /첫 기록을 기다리는 중/);
  assert.doesNotMatch(overview, /0\.0%|pv-ring-win"|pv-ring-loss"/);
  assert.match(V.renderForm(detail), /첫 경기가 등록되면/);
  assert.doesNotMatch(V.renderForm(detail), /pv-form-step/);
  const positions = V.renderPositions(detail);
  assert.match(positions, /data-visual-role="mid" aria-pressed="true"/);
  assert.match(positions, /이 포지션으로 기록된 경기가 없습니다/);
  assert.doesNotMatch(positions, />0\.0%<|Perfect/);
  assert.match(V.renderChampions(detail), /챔피언이 기록되면/);
});

test('one perfect game displays full win ring and only one actual recent result', () => {
  const detail = fixture([game(1, { deaths: 0 })]);
  assert.match(V.renderOverview(detail), /100\.0%/);
  assert.match(V.renderPositions(detail), /Perfect/);
  assert.match(V.renderChampions(detail), /Perfect/);
  const form = V.renderForm(detail, row => `./history.html?record=sample&game=${row.setNumber}`);
  assert.match(form, /최근 1경기의 흐름/);
  assert.match(form, /1연승/);
  assert.equal((form.match(/class="pv-form-step /g) || []).length, 1);
  assert.match(form, /href="\.\/history\.html\?record=sample&amp;game=1"/);
});

test('five-match ribbon keeps selector newest-first order and original links', () => {
  const detail = fixture(Array.from({ length: 7 }, (_, index) => game(7 - index, { won: index < 3 })));
  const form = V.renderForm(detail, row => `./history.html?game=${row.setNumber}`);
  assert.equal((form.match(/class="pv-form-step /g) || []).length, 5);
  assert.match(form, /최근 5경기의 흐름/);
  assert.match(form, /왼쪽부터 최신순/);
  assert.match(form, /3연승/);
  assert.ok(form.indexOf('game=7') < form.indexOf('game=6'));
  assert.doesNotMatch(form, /game=2"|game=1"/);
});

test('position map uses actual games, explicit all-game denominator and five accessible buttons', () => {
  const detail = fixture([game(3), game(2, { position: 'top', won: false }), game(1, { position: null })]);
  const result = V.renderPositions(detail, 'top');
  assert.equal((result.match(/<button /g) || []).length, 5);
  assert.match(result, /data-visual-role="top" aria-pressed="true"/);
  assert.equal((result.match(/aria-pressed="true"/g) || []).length, 1);
  assert.match(result, /전체 3경기 중 실제 플레이 비중/);
  assert.match(result, /33\.3%/);
  assert.match(result, /포지션 미입력 1경기/);
  assert.match(result, /0승 1패/);
  assert.match(result, /<dt>승률<\/dt><dd>0\.0%/);
  const invalidRole = V.renderPositions(detail, '" onclick="alert(1)');
  assert.doesNotMatch(invalidRole, /onclick/);
  assert.match(invalidRole, /data-visual-role="top" aria-pressed="true"/);
});

test('champion showcase uses frequency order, keeps unknown games in share denominator, and limits to three', () => {
  const detail = fixture([
    game(5, { champion: 'Ahri' }), game(4, { champion: 'Ahri', won: false }),
    game(3, { champion: 'Orianna' }), game(2, { champion: 'Lux' }), game(1, { champion: null })
  ]);
  const result = V.renderChampions(detail);
  assert.equal((result.match(/<article /g) || []).length, 3);
  assert.match(result, /경기 수 순 · 전체 5경기 기준/);
  assert.match(result, /전체 경기의 <b>40\.0%/);
  assert.match(result, /챔피언 미입력 1경기/);
  assert.match(result, /미입력 경기를 포함한 전체 경기 기준/);
  assert.ok(result.indexOf('<h4>Ahri') < result.indexOf('<h4>Orianna'));
});

test('missing KDA remains unknown and rendering never mutates selector output', () => {
  const detail = fixture([game(1, { kills: null, deaths: null, assists: null, cs: null, durationSeconds: null })]);
  const before = JSON.stringify(detail);
  const result = V.renderOverview(detail) + V.renderForm(detail) + V.renderPositions(detail) + V.renderChampions(detail);
  assert.match(result, /<dt>KDA<\/dt><dd>—<\/dd>/);
  assert.doesNotMatch(result, /Perfect|NaN|Infinity|undefined/);
  assert.equal(JSON.stringify(detail), before);
});

test('untrusted champion names are text, and unsafe link callbacks cannot create executable URLs', () => {
  const malicious = '<svg onload="alert(1)"><script>bad</script>&';
  const detail = fixture([game(1, { champion: malicious })]);
  const result = V.renderForm(detail, () => 'javascript:alert(1)') + V.renderChampions(detail);
  assert.match(result, /&lt;svg onload=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(result, /<svg onload|<script>|href="javascript:|<img|onerror=/);
  assert.doesNotMatch(result, /<a /);
  const quotedLink = V.renderForm(detail, () => './history.html?record="onclick="x');
  assert.match(quotedLink, /record=&quot;onclick=&quot;x/);
  assert.doesNotMatch(quotedLink, /href="[^>]*"onclick=/);
});
