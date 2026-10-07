const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const S = require('../domain/player-stats.cjs');
require('../public/player-insights.js');
const I = globalThis.LoLPlayerInsights;

function game(overrides = {}) {
  const row = { date: '2026-10-07', endedAt: '2026-10-07T12:00:00Z', seriesId: 'series-one', setNumber: 1, won: true, champion: 'Ahri', position: 'mid', kills: 8, deaths: 2, assists: 10, cs: 180, durationSeconds: 1800, damage: 24000, ...overrides };
  row.kda = S.calculateKDA(row.kills, row.deaths, row.assists);
  return row;
}
const detail = rows => ({ recent: rows });

function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}

test('trend takes recent 12 and displays true oldest-to-newest source order without mutation', () => {
  const rows = Array.from({ length: 15 }, (_, index) => game({ date: `2026-10-${String(index + 1).padStart(2, '0')}` }));
  const input = frozen(detail(rows));
  const before = JSON.stringify(input);
  const model = I.buildModel(input);
  assert.equal(model.games.length, 12);
  assert.equal(model.games[0].date, '2026-10-04');
  assert.equal(model.games.at(-1).date, '2026-10-15');
  assert.deepEqual(model.points.map(point => point.index), [...Array(12).keys()]);
  assert.equal(JSON.stringify(input), before);
  assert.ok(model.points.every((point, index) => index === 0 || point.x > model.points[index - 1].x));
});

test('ties follow actual end time, series ID, and set number from source selectors', () => {
  const model = I.buildModel(detail([game({ setNumber: 3 }), game({ setNumber: 1 }), game({ setNumber: 2 })]));
  assert.deepEqual(model.games.map(row => row.setNumber), [1, 2, 3]);
  const later = game({ endedAt: '2026-10-07T13:00:00Z' });
  assert.equal(I.buildModel(detail([later, game()])).games.at(-1), later);
});

test('numeric KDA uses per-game source ratio with positive untruncated bounds', () => {
  const model = I.buildModel(detail([game({ kills: 100, deaths: 1, assists: 99, setNumber: 1 }), game({ kills: 0, assists: 0, setNumber: 2 })]), 'kda');
  assert.deepEqual(model.points.map(point => point.value), [199, 0]);
  assert.equal(model.domain.min, 0);
  assert.ok(model.domain.max >= 199);
  assert.ok(model.points.every(point => point.y >= model.plot.top && point.y <= model.plot.bottom));
  assert.equal(I.buildModel(detail([game({ kills: 0, assists: 0 })])).domain.max, 1);
});

test('Perfect is a nonnumeric separate marker and breaks connected lines', () => {
  const rows = [game({ setNumber: 1 }), game({ setNumber: 2, deaths: 0 }), game({ setNumber: 3 }), game({ setNumber: 4 })];
  const model = I.buildModel(detail(rows));
  assert.equal(model.points[1].perfect, true);
  assert.equal(model.points[1].value, null);
  assert.equal(model.points[1].missing, false);
  assert.equal(model.points[1].y, model.plot.perfect);
  assert.ok(model.points[1].y < model.plot.top);
  assert.deepEqual(model.segments.map(segment => segment.map(point => point.index)), [[0], [2, 3]]);
  const html = I.render(detail(rows));
  assert.match(html, /Perfect · 수치 축과 별도 표시/);
  assert.doesNotMatch(html, /Infinity|NaN/);
});

test('all-Perfect and uncollected metrics never render a numerical 0–1 scale', () => {
  const perfect = detail([game({ deaths: 0 }), game({ deaths: 0, setNumber: 2 })]);
  const model = I.buildModel(perfect);
  assert.equal(model.domain.max, null);
  assert.deepEqual(model.ticks, []);
  assert.equal(model.numericCount, 0);
  assert.equal(model.measured, 2);
  const html = I.render(perfect);
  assert.match(html, /수치형 KDA가 없어 숫자 축은 표시하지 않습니다/);
  assert.doesNotMatch(html, /class="pi-gridline"|class="pi-trend-line"/);
  const missing = I.render(detail([game({ damage: null })]), { metric: 'damage' });
  assert.match(missing, /이 지표는 아직 수집되지 않았습니다/);
  assert.doesNotMatch(missing, /class="pi-gridline"|class="pi-trend-line"/);
});

test('missing KDA, CS, duration, and damage form actual gaps rather than fake zeroes', () => {
  const rows = [game({ setNumber: 1 }), game({ setNumber: 2, assists: null }), game({ setNumber: 3 }), game({ setNumber: 4 })];
  const model = I.buildModel(detail(rows));
  assert.equal(model.points[1].value, null);
  assert.equal(model.points[1].y, null);
  assert.equal(model.points[1].missing, true);
  assert.deepEqual(model.segments.map(segment => segment.length), [1, 2]);
  const cs = I.buildModel(detail([game({ setNumber: 1 }), game({ setNumber: 2, cs: null }), game({ setNumber: 3, durationSeconds: null }), game({ setNumber: 4, cs: 0 })]), 'csPerMinute');
  assert.deepEqual(cs.points.map(point => point.value), [6, null, null, 0]);
  assert.equal(cs.measured, 2);
  const damage = I.buildModel(detail([game({ damage: null }), game({ damage: 0, setNumber: 2 })]), 'damage');
  assert.deepEqual(damage.points.map(point => point.value), [null, 0]);
});

test('CS per minute delegates the per-game pair to source stats, with real time precision', () => {
  const row = game({ cs: 211, durationSeconds: 1934 });
  const expected = S.calculateCsPerMinute([row]).value;
  assert.equal(I.buildModel(detail([row]), 'csPerMinute').points[0].value, expected);
  assert.match(I.render(detail([row]), { metric: 'csPerMinute' }), /211 · 32:14/);
});

test('highlight extrema cite only complete K/D/A samples and preserve unknown states', () => {
  const model = I.buildModel(detail([game({ kills: 20, assists: 13 }), game({ kills: 999, deaths: null, assists: 888 }), game({ kills: 3, deaths: 0, assists: 21 })]));
  assert.deepEqual(model.highlights, { games: 2, maxKills: 20, maxAssists: 21, deathless: 1 });
  assert.deepEqual(I.buildModel(detail([game({ deaths: null })])).highlights, { games: 0, maxKills: null, maxAssists: null, deathless: null });
  assert.match(I.render(detail([game({ kills: 0, deaths: 0, assists: 0 })])), /K\/D\/A가 모두 있는 1경기/);
});

test('empty and single-game profiles render readable states with no invented line', () => {
  const empty = I.buildModel(null);
  assert.equal(empty.games.length, 0);
  assert.equal(I.selectedIndex(empty, 0), -1);
  assert.match(I.render(null), /첫 경기부터 나만의 곡선/);
  assert.doesNotMatch(I.render(null), /data-insight-game/);
  const one = I.buildModel(detail([game()]));
  assert.equal(one.points[0].x, (one.plot.left + one.plot.right) / 2);
  assert.equal(one.segments[0].length, 1);
  const html = I.render(detail([game()]));
  assert.doesNotMatch(html, /class="pi-trend-line"/);
  assert.match(html, /data-insight-game="0"[^>]+aria-pressed="true"/);
});

test('selected index defaults newest, clamps after updates, and native controls do not navigate', () => {
  const input = detail([game({ setNumber: 1, champion: 'Ahri' }), game({ setNumber: 2, champion: 'Orianna', won: false })]);
  const model = I.buildModel(input);
  assert.equal(I.selectedIndex(model), 1);
  assert.equal(I.selectedIndex(model, NaN), 1);
  assert.equal(I.selectedIndex(model, 99), 1);
  assert.equal(I.selectedIndex(model, -99), 0);
  const html = I.render(input, { selectedIndex: 0, metric: 'damage' });
  assert.match(html, /data-insight-metric="damage" aria-pressed="true"/);
  assert.match(html, /data-insight-game="0"[^>]+aria-pressed="true"/);
  assert.match(html, /aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(html, /href=|onclick=|<a[ >]/);
});

test('untrusted labels are escaped and unknown metric requests use KDA', () => {
  const input = detail([game({ champion: '<img src=x onerror="boom">', position: '<script>x</script>', date: '" bad-date' })]);
  const html = I.render(input, { metric: '__proto__' });
  assert.equal(I.buildModel(input, '__proto__').metric, 'kda');
  assert.match(html, /&lt;img src=x onerror=&quot;boom&quot;&gt;/);
  assert.match(html, /&lt;SCRIPT&gt;X&lt;\/SCRIPT&gt;/);
  assert.doesNotMatch(html.replace(/<script type="application\/json" data-insight-data>[\s\S]*?<\/script>/g, ''), /<img|<script|bad-date/);
});

test('source edits and deletions flow straight into fresh projections without cached aggregates', () => {
  const input = detail([game({ kills: 12 }), game({ kills: 4, setNumber: 2 })]);
  assert.equal(I.buildModel(input).highlights.maxKills, 12);
  input.recent[0].kills = 1;
  input.recent[0].kda = S.calculateKDA(1, 2, 10);
  assert.equal(I.buildModel(input).highlights.maxKills, 4);
  input.recent.pop();
  assert.equal(I.buildModel(input).games.length, 1);
  assert.equal(I.buildModel(input).highlights.maxKills, 1);
});

test('mobile layout wraps selectors, uses native touch targets and explicit motion opt-outs', () => {
  const css = fs.readFileSync(require.resolve('../public/player-insights.css'), 'utf8');
  assert.match(css, /max-width:480px[^}]+\.pi-game-picker\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /\.pi-panel\.is-animated \.pi-trend-line/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /data-player-motion="off"/);
  assert.doesNotMatch(css, /animation:[^;}]+infinite/);
});

test('fractional axis bounds remain legible and are announced accurately', () => {
  const input = detail([game({ kills: 1, deaths: 4, assists: 0 })]);
  assert.equal(I.buildModel(input).domain.max, 0.4);
  assert.match(I.render(input), /세로축은 0부터 0.4 KDA/);
  assert.match(I.render(input), />0.2<\/span>/);
  const tiny = I.render(detail([game({ kills: 1, deaths: 100, assists: 0 })]));
  assert.match(tiny, />0.005<\/span>/);
});


test('entry animation is explicitly enabled only for the initial profile render', () => {
  const input = detail([game()]);
  assert.match(I.render(input, { animate: true }), /<section class="pi-panel is-animated"/);
  assert.doesNotMatch(I.render(input), /class="pi-panel is-animated"/);
  assert.doesNotMatch(I.render(input, { selectedIndex: 0, metric: 'damage' }), /class="pi-panel is-animated"/);
  assert.doesNotMatch(I.render(input, { animate: 'true' }), /class="pi-panel is-animated"/);
});

test('both motion opt-outs remove the hover translation as well as animations', () => {
  const css = fs.readFileSync(require.resolve('../public/player-insights.css'), 'utf8');
  assert.match(css, /html\[data-player-motion="off"\] \.pi-game-picker button:hover\{transform:none\}/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.pi-game-picker button:hover\{transform:none\}\}/);
});

function history(count = 30) {
  return Array.from({ length: count }, (_, index) => game({
    seriesId: `series-${index + 1}`,
    date: new Date(Date.UTC(2026, 8, index + 1)).toISOString().slice(0, 10),
    champion: `Champion ${index + 1}`,
    kills: index + 1,
    endedAt: new Date(Date.UTC(2026, 8, index + 1, 12)).toISOString()
  }));
}

test('stable identity uses source IDs, survives nickname and result changes, and keeps delimiters distinct', () => {
  const row = game({ seriesId: 'same:series', setNumber: 3 });
  const key = I.gameKey(row);
  assert.equal(key, I.gameKey({ ...row, champion: 'Different', won: false, kills: 2 }));
  assert.notEqual(key, I.gameKey({ ...row, setNumber: 4 }));
  assert.notEqual(I.gameKey({ seriesId: 'a:b', gameId: 'c' }), I.gameKey({ seriesId: 'a', gameId: 'b:c' }));
  assert.deepEqual(JSON.parse(I.gameKey({ seriesId: 'source', gameId: 'game-id', setNumber: 99 })), ['source', 'game-id']);
});

test('stable selected key opens an older source game and retains it across metric switches', () => {
  const rows = history(), selectedKey = I.gameKey(rows[2]);
  const input = frozen(detail(rows));
  const model = I.buildModel(input, 'kda', { selectedKey });
  assert.equal(model.allGames.length, 30);
  assert.equal(model.games.length, 12);
  assert.equal(model.selectedGlobalIndex, 2);
  assert.equal(model.selectedKey, selectedKey);
  assert.equal(model.games[model.selectedIndex], rows[2]);
  assert.equal(I.selectedIndex(model), 2);
  assert.equal(I.buildModel(input, 'damage', { selectedKey }).selectedKey, selectedKey);
  assert.equal(I.buildModel(input, 'damage', { selectedKey }).selectedGlobalIndex, 2);
  const rendered = I.render(input, { metric: 'damage', selectedKey });
  assert.match(rendered, /GAME 03 \/ 30/);
  assert.match(rendered, /data-insight-range="all" min="0" max="29" step="1" value="2"/);
  assert.match(rendered, /data-insight-range="plot" min="0" max="11" step="1" value="2"/);
});

test('timeline window stays fixed while scrubbing inside it and shifts only when selection leaves it', () => {
  const rows = history(), input = detail(rows);
  const initial = I.buildModel(input);
  assert.equal(initial.windowStart, 18);
  const inside = I.buildModel(input, 'kda', { selectedKey: I.gameKey(rows[19]), windowStart: initial.windowStart });
  assert.equal(inside.windowStart, 18);
  assert.equal(inside.selectedIndex, 1);
  const outside = I.buildModel(input, 'kda', { selectedKey: I.gameKey(rows[3]), windowStart: initial.windowStart });
  assert.equal(outside.windowStart, 0);
  assert.equal(outside.selectedGlobalIndex, 3);
  assert.equal(I.buildModel(input, 'kda', { selectedKey: 'deleted-key' }).selectedKey, I.gameKey(rows[29]));
  const selected = I.gameKey(rows[6]);
  rows.splice(6, 1);
  assert.equal(I.buildModel(input, 'kda', { selectedKey: selected }).selectedKey, I.gameKey(rows.at(-1)));
});

test('highlights expose actual oldest or latest-tied source games outside the initial plot window', () => {
  const rows = history();
  rows[0].kills = 50;
  rows[0].kda = S.calculateKDA(50, 2, 10);
  rows[1].deaths = 0;
  rows[1].kda = S.calculateKDA(rows[1].kills, 0, 10);
  rows[10].assists = 80;
  rows[14].assists = 80;
  rows[20].kills = 999;
  rows[20].deaths = null;
  const model = I.buildModel(detail(rows));
  assert.equal(model.highlightGames.maxKills, rows[0]);
  assert.equal(model.highlightGames.maxAssists, rows[14]);
  assert.equal(model.highlightGames.deathless, rows[1]);
  assert.equal(model.highlights.games, 29);
  const html = I.render(detail(rows));
  const key = encodeURIComponent(I.gameKey(rows[0]));
  assert.ok(html.includes(`class="pi-highlight" data-insight-key="${key}"`));
  assert.equal(I.buildModel(detail(rows), 'kda', { selectedKey: I.gameKey(model.highlightGames.maxKills) }).selectedGlobalIndex, 0);
});

test('render payload is inert JSON with safe closing tags and encoded key attributes', () => {
  const row = game({ seriesId: '"/><script>oops</script>', gameId: '<img onerror="boom">', champion: '</script><script>alert(1)</script>&"' });
  const html = I.render(detail([row]));
  const payload = html.match(/<script type="application\/json" data-insight-data>([\s\S]*?)<\/script>/);
  assert.ok(payload);
  assert.doesNotMatch(payload[1], /[<>&]/);
  assert.equal(JSON.parse(payload[1]).recent[0].champion, row.champion);
  assert.equal((html.match(/<script/g) || []).length, 1);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  const keys = [...html.matchAll(/data-insight-key="([^"]+)"/g)].map(match => decodeURIComponent(match[1]));
  assert.ok(keys.every(key => key === I.gameKey(row)));
  assert.doesNotMatch(html, /aria-label="[^>]*<script|aria-label="[^>]*<img/);
});

function bindingFixture(input, options = {}) {
  const html = I.render(input, options);
  const payload = html.match(/<script type="application\/json" data-insight-data>([\s\S]*?)<\/script>/)[1];
  const listeners = new Map();
  function element(attributes = {}) {
    return { attributes, innerHTML: '', textContent: '', value: '', disabled: false,
      classList: { removed: [], remove(name) { this.removed.push(name); } },
      setAttribute(key, value) { this.attributes[key] = String(value); },
      getAttribute(key) { return this.attributes[key] || null; } };
  }
  const drawing = element(), selection = element(), panel = element();
  const ranges = [element({ 'data-insight-range': 'plot' }), element({ 'data-insight-range': 'all' })];
  const nodes = new Map([
    ['[data-insight-data]', { textContent: payload }], ['.pi-drawing', drawing], ['.pi-chart', element()],
    ['.pi-axis-y', element()], ['[data-insight-selection]', selection], ['.pi-game-picker', element()],
    ['.pi-timeline-navigation', element()], ['[data-insight-measured]', element()], ['.pi-panel', panel]
  ]);
  const container = {
    querySelector(selector) { return nodes.get(selector) || null; },
    querySelectorAll(selector) { return selector === '[data-insight-range]' ? ranges : []; },
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name, handler) { if (listeners.get(name) === handler) listeners.delete(name); }
  };
  return { container, nodes, drawing, selection, panel, ranges, listeners,
    fire(type, range, value) { range.value = String(value); listeners.get(type)?.({ target: range }); } };
}

test('native range input updates cursor, selected game and historical window before commit without replacing capture element', () => {
  const rows = history(), fixture = bindingFixture(detail(rows));
  const committed = [], metadata = [], range = fixture.ranges[1];
  const cleanup = I.bind(fixture.container, { onSelect(key, context) { committed.push(key); metadata.push(context); } });
  fixture.fire('input', range, 2);
  assert.equal(fixture.ranges[1], range);
  assert.equal(fixture.ranges[0].min, '0');
  assert.equal(fixture.ranges[0].max, '11');
  assert.equal(fixture.ranges[0].value, '2');
  assert.match(fixture.selection.innerHTML, /Champion 3/);
  assert.match(fixture.selection.innerHTML, /GAME 03 \/ 30/);
  assert.match(fixture.drawing.innerHTML, /class="pi-cursor"/);
  assert.match(range.attributes['aria-valuetext'], /3\/30경기/);
  assert.deepEqual(committed, []);
  assert.deepEqual(fixture.panel.classList.removed, ['is-animated']);
  fixture.fire('change', range, 2);
  assert.deepEqual(committed, [I.gameKey(rows[2])]);
  assert.deepEqual(metadata, [{ windowStart: 0 }]);
  const committedModel = I.buildModel(detail(rows), 'kda', { selectedKey: committed[0], ...metadata[0] });
  assert.equal(committedModel.windowStart, Number(fixture.ranges[0].min));
  cleanup();
  fixture.fire('change', range, 9);
  assert.equal(committed.length, 1);
  assert.equal(fixture.listeners.size, 0);
});

test('plot scrubbing retains window bounds and does not manufacture missing or Perfect metric values', () => {
  const rows = history();
  rows[20].deaths = 0;
  rows[20].kda = S.calculateKDA(rows[20].kills, 0, rows[20].assists);
  rows[21].assists = null;
  rows[21].kda = S.calculateKDA(rows[21].kills, rows[21].deaths, null);
  const fixture = bindingFixture(detail(rows));
  I.bind(fixture.container, () => {});
  fixture.fire('input', fixture.ranges[0], 20);
  assert.equal(fixture.ranges[0].min, '18');
  assert.equal(fixture.ranges[0].max, '29');
  assert.match(fixture.selection.innerHTML, />Perfect</);
  fixture.fire('input', fixture.ranges[0], 21);
  assert.match(fixture.selection.innerHTML, />미수집</);
  assert.doesNotMatch(fixture.selection.innerHTML, /NaN|Infinity/);
  const before = fixture.selection.innerHTML;
  fixture.fire('input', fixture.ranges[0], 99);
  assert.equal(fixture.selection.innerHTML, before);
  fixture.fire('input', fixture.ranges[0], 2.5);
  assert.equal(fixture.selection.innerHTML, before);
});

test('native range keyboard equivalents, endpoint buttons and one-game disabled state remain accessible', () => {
  const rows = history(2), input = detail(rows);
  const earliest = I.render(input, { selectedKey: I.gameKey(rows[0]) });
  assert.match(earliest, /data-insight-step="previous" disabled/);
  assert.match(earliest, /data-insight-step="next" data-insight-key=/);
  assert.match(earliest, /type="range" data-insight-range="plot"[^>]+aria-valuetext=/);
  const latest = I.render(input);
  assert.match(latest, /data-insight-step="next" disabled/);
  const one = I.render(detail([rows[0]]));
  assert.match(one, /data-insight-range="plot"[^>]+ disabled/);
  assert.match(one, /data-insight-range="all"[^>]+ disabled/);
  const fixture = bindingFixture(input), committed = [];
  I.bind(fixture.container, key => committed.push(key));
  // Arrow/Home/End changes use the browser's same native input/change events.
  fixture.fire('input', fixture.ranges[0], 0);
  fixture.fire('change', fixture.ranges[0], 0);
  assert.deepEqual(committed, [I.gameKey(rows[0])]);
  const css = fs.readFileSync(require.resolve('../public/player-insights.css'), 'utf8');
  assert.match(css, /\.pi-panel \.pi-plot-input:focus-visible/);
  assert.match(css, /touch-action:pan-y/);
  assert.match(css, /#00176A/);
  assert.match(css, /#003E9C/);
});

test('a quoted champion in a qualifying highlight cannot introduce event-handler attributes', () => {
  const champion = '" onclick="alert(1)" data-attack="';
  const html = I.render(detail([game({ champion, kills: 99, assists: 99, deaths: 0 })]));
  const highlights = [...html.matchAll(/<button\b[^>]*class="pi-highlight"[^>]*>/g)].map(match => match[0]);
  assert.equal(highlights.length, 3);
  highlights.forEach(tag => {
    const attributes = [...tag.matchAll(/\s([a-zA-Z-]+)="([^"]*)"/g)].map(match => match[1]);
    assert.ok(attributes.includes('aria-label'));
    assert.ok(!attributes.includes('onclick'));
    assert.ok(!attributes.includes('data-attack'));
    assert.match(tag, /&quot; onclick=&quot;alert\(1\)&quot; data-attack=&quot;/);
  });
});
