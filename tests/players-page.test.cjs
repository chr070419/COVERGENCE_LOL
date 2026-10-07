'use strict';
// User event flows run with the real selectors and a minimal DOM adapter.
// These tests do not substitute for browser rendering or mobile visual QA.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const C = require('../domain/core.cjs');
const H = require('../domain/history-core.cjs');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/players.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'public/players-page.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));
const viewer = { user: null, role: 'viewer', canEdit: false, canManageAdmins: false };
const owner = { user: { id: 'owner', name: '소유자' }, role: 'owner', canEdit: true, canManageAdmins: true };
function fixture(count = 1, current = false) {
  const draw = C.makeTeams(C.DEFAULT_ROSTER);
  const team = draw.teams.findIndex(slots => slots.some(slot => slot.id === 'injae'));
  const result = H.upgrade(C.createDefaultState());
  for (let index = 0; index < count; index += 1) {
    let match = H.upgrade(C.createDefaultState());
    match.draw = clone(draw); match.drawNumber = 1; match.bestOf = current ? 3 : 1;
    match.seriesId = `test-series-${index}`; match.matchDate = `2026-10-${String(index + 1).padStart(2, '0')}`;
    const won = index % 5 !== 1 && index % 5 !== 3;
    const players = match.roster.map(person => ({ id: person.id, champion: null, kills: null, deaths: null, assists: null, damage: null, cs: null, gold: null, vision: null }));
    Object.assign(players.find(person => person.id === 'injae'), { champion: ['Ahri', 'Orianna', 'Lux'][index % 3], kills: 8, deaths: index === 0 ? 0 : 2, assists: 11, cs: index === 2 ? null : index === 3 ? 0 : 184 });
    match = H.recordGame(match, won ? team : 1 - team, { players, durationSeconds: index === 1 ? null : 1934 });
    if (current) return match;
    match.history[0].endedAt = `${match.matchDate}T12:00:00.000Z`;
    result.history.push(match.history[0]);
  }
  return result;
}
async function app(options = {}) {
  const server = { state: options.state === undefined ? fixture() : clone(options.state), revision: 1, session: clone(options.session || viewer), fail: options.fail || null, loads: 0, writes: 0, deferred: !!options.deferLoads, waiting: [] };
  class Element {
    constructor(id = '', properties = {}) {
      this.id = id; this.dataset = {}; this.listeners = {}; this.value = ''; this.hidden = false; this.disabled = false; this.textContent = ''; this.innerHTML = '';
      const classes = new Set();
      this.classList = { add(...names) { names.forEach(name => classes.add(name)); }, remove(...names) { names.forEach(name => classes.delete(name)); }, contains(name) { return classes.has(name); } };
      this.attributes = {}; Object.assign(this, properties);
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    get innerHTML() { return this._html || ''; }
    set innerHTML(value) {
      this._html = value;
      this.insightPanel = value.includes('class="pi-panel') ? new Element() : null;
      if (value.includes('class="pi-panel is-animated"')) this.insightPanel.classList.add('is-animated');
      this.panelNodes = [...value.matchAll(/<details\b([^>]*\bdata-profile-panel="([^"]+)"[^>]*)>/g)].map(match => new Element('', { dataset: { profilePanel: match[2] }, open: /\sopen(?:\s|$)/.test(match[1]) }));
    }
    async emit(type, extra = {}) { for (const fn of this.listeners[type] || []) await fn({ target: this, preventDefault() {}, ...extra }); await settle(); }
    closest(selector) {
      for (const part of selector.split(',').map(value => value.trim())) {
        const attribute = part.match(/^\[data-([a-z-]+)\]$/)?.[1];
        const key = attribute?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        if (key && Object.prototype.hasOwnProperty.call(this.dataset, key)) return this;
      }
      return null;
    }
    showModal() { this.open = true; }
    close() { this.open = false; for (const fn of this.listeners.close || []) fn({ target: this }); }
    querySelector(selector) {
      if (selector === '.pi-panel') return this.insightPanel;
      const attribute = selector.match(/^\[data-([a-z-]+)="([^"]*)"\]$/);
      if (attribute && attribute[1] !== 'profile-panel' && this.innerHTML.includes(`data-${attribute[1]}="${attribute[2]}"`)) {
        const key = attribute[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        const ref = attribute[1] === 'visual-role' ? `role-${attribute[2]}` : `${attribute[1]}-${attribute[2]}`;
        return els[ref] ||= new Element('', { dataset: { [key]: attribute[2] } });
      }
      const panel = selector.match(/^\[data-profile-panel="([a-z]+)"\]$/)?.[1];
      if (panel) return this.panelNodes.find(node => node.dataset.profilePanel === panel) || null;
      return null;
    }
    querySelectorAll(selector) { return selector === 'details[data-profile-panel][open]' ? this.panelNodes.filter(node => node.open) : []; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    scrollIntoView(settings) { this.scrolled = true; this.scrollSettings = settings; }
    focus() { this.focused = true; document.activeElement = this; }
  }
  const els = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element(match[1])]));
  const events = {}, documentEvents = {}, urls = [], intervals = [], preferenceWrites = [];
  const location = { search: options.search || '' };
  const document = { hidden: false, title: '', documentElement: new Element('html'), getElementById: id => els[id] || (Object.values(els).some(element => element.innerHTML.includes(`id="${id}"`)) ? (els[id] = new Element(id)) : null), addEventListener(type, fn) { documentEvents[type] = fn; } };
  const media = { matches: !!options.reducedMotion, addEventListener(type, fn) { this[type] = fn; } };
  const window = { location, matchMedia: () => media, localStorage: { getItem() { if (options.storageBlocked) throw new Error('blocked'); return options.storedMotion ?? null; }, setItem(key, value) { if (options.storageBlocked) throw new Error('blocked'); preferenceWrites.push([key, value]); } }, history: { pushState(_state, _title, url) { urls.push(url); location.search = url.includes('?') ? '?' + url.split('?')[1] : ''; } }, addEventListener(type, fn) { events[type] = fn; } };
  const context = vm.createContext({ document, window, console, crypto: webcrypto, URLSearchParams, Intl, setTimeout() {}, clearTimeout() {}, setInterval(fn) { intervals.push(fn); },
    async hostLoad() { server.loads += 1; if (server.deferred) await new Promise((resolve, reject) => server.waiting.push({ resolve, reject })); if (server.fail) throw Object.assign(new Error(server.fail), { status: 503 }); return JSON.stringify({ state: server.state, revision: server.revision, session: server.session }); },
    hostWrite() { server.writes += 1; throw new Error('Statistics page must not write'); }
  });
  for (const file of ['domain/core.cjs', 'domain/history-core.cjs', 'domain/player-stats.cjs', 'public/player-visuals.js', 'public/player-demo.js', 'public/player-insights.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  vm.runInContext('globalThis.SiteData={load:async()=>JSON.parse(await hostLoad()),save:hostWrite};', context);
  vm.runInContext(source, context); await settle(); await settle();
  return { server, els, document, events, documentEvents, location, urls, intervals, media, preferenceWrites,
    clickPlayer: async (id, extra = {}) => els.playerHistory.emit('click', { target: new Element('', { dataset: { player: id } }), ...extra }),
    more: async () => els.playerDetail.emit('click', { target: new Element('', { dataset: { moreGames: '' } }) }),
    demoGame: async index => els.playerDetail.emit('click', { target: new Element('', { dataset: { demoGame: String(index) } }) }),
    metric: async id => els.playerDetail.emit('click', { target: new Element('', { dataset: { insightMetric: id } }) }),
    insightGame: async index => els.playerDetail.emit('click', { target: new Element('', { dataset: { insightGame: String(index) } }) }),
    role: async id => els.playerDetail.emit('click', { target: new Element('', { dataset: { visualRole: id } }) }),
    champion: async id => els.playerDetail.emit('click', { target: new Element('', { dataset: { explorerChampion: encodeURIComponent(id) } }) }),
    explorerView: async id => els.playerDetail.emit('click', { target: new Element('', { dataset: { explorerView: id } }) }),
    jump: async () => els.playerDetail.emit('click', { target: new Element('', { dataset: { explorerJump: '' } }) }),
    reset: async () => els.playerDetail.emit('click', { target: new Element('', { dataset: { explorerReset: '' } }) }),
    clear: async kind => els.playerDetail.emit('click', { target: new Element('', { dataset: { explorerClear: kind } }) }),
    insightKey: async key => els.playerDetail.emit('click', { target: new Element('', { dataset: { insightKey: encodeURIComponent(key) } }) }),
    heroFilter: async value => els.playerDetail.emit('click', { target: new Element('', { dataset: { heroFilter: value } }) }),
    heroGame: async key => els.playerDetail.emit('click', { target: new Element('', { dataset: { heroGame: encodeURIComponent(key) } }) }),
    replay: async () => els.playerDetail.emit('click', { target: new Element('', { dataset: { insightReplay: '' } }) }),
    back: async search => { location.search = search; events.popstate(); await settle(); }
  };
}

test('directory includes every registered player with zero matches and stable profile links, viewer cannot mutate', async () => {
  const ui = await app({ state: null });
  assert.equal((ui.els.playerHistory.innerHTML.match(/class="directory-row"/g) || []).length, 10);
  assert.match(ui.els.playerHistory.innerHTML, /players\.html\?player=injae/);
  assert.equal(ui.els.playerDirectory.hidden, false);
  assert.equal(ui.els.playerProfile.hidden, true);
  assert.equal(ui.els.adminNav.hidden, true);
  assert.equal(ui.els.accessBadge.textContent, '보기 전용');
  await ui.clickPlayer('injae');
  assert.equal(ui.urls.at(-1), './players.html?player=injae');
  assert.match(ui.els.playerDetail.innerHTML, /아직 기록된 내전이 없습니다/);
  assert.match(ui.els.playerDetail.innerHTML, /CS·시간이 모두 있는 0경기/);
  assert.doesNotMatch(ui.els.playerDetail.innerHTML, /NaN|Infinity|0\.0%|0\.00/);
  assert.equal(ui.server.writes, 0);
});

test('deep-linked one-game profile shows actual stats, Perfect KDA, form and a precise history link', async () => {
  const ui = await app({ search: '?player=injae' });
  const content = ui.els.playerDetail.innerHTML;
  assert.equal(ui.document.title, '신인재 · 개인 성적 · 융합본부 롤 내전');
  assert.match(content, /Perfect/);
  assert.match(content, /8 \/ 0 \/ 11/);
  assert.match(content, /100\.0%/);
  assert.match(content, /32:14/);
  assert.match(content, /최근 1경기/);
  assert.match(content, /1연승/);
  assert.match(content, /record=test-series-0&amp;game=1#record-test-series-0/);
  for (const role of ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']) assert.match(content, new RegExp(role));
  assert.equal(ui.els.playerDirectory.hidden, true);
  assert.equal(ui.els.playerProfile.hidden, false);
});

test('ten games display 6W4L, missing measurements and genuine zero without treating null as zero', async () => {
  const ui = await app({ state: fixture(10), search: '?player=injae' });
  const content = ui.els.playerDetail.innerHTML;
  assert.match(content, /6승 4패/);
  assert.match(content, /60\.0%/);
  assert.match(content, /10\.56/);
  assert.match(content, /최근 5경기/);
  assert.match(content, /3승 2패/);
  assert.match(content, /CS가 수집된 9경기/);
  assert.match(content, /CS·시간이 모두 있는 8경기/);
  assert.match(content, /CS —/);
  assert.match(content, /CS 0/);
  assert.match(content, /경기 시간 미입력/);
  const rows = content.match(/<ol class="recent-games">([\s\S]*?)<\/ol>/)[1];
  assert.ok(rows.indexOf('2026.10.10') < rows.indexOf('2026.10.09'));
  assert.ok(rows.indexOf('2026.10.09') < rows.indexOf('2026.10.01'));
});

test('search, selection, date filter and browser history preserve shareable route state', async () => {
  const ui = await app({ state: fixture(2) });
  ui.els.playerSearch.value = '신인'; await ui.els.playerSearch.emit('input');
  assert.match(ui.els.playerHistory.innerHTML, /신인재/); assert.doesNotMatch(ui.els.playerHistory.innerHTML, /최해람/);
  await ui.clickPlayer('injae');
  ui.els.playersDate.value = '2026-10-01'; await ui.els.playersDate.emit('change');
  assert.equal(ui.urls.at(-1), './players.html?player=injae&date=2026-10-01');
  assert.match(ui.els.playerDetail.innerHTML, /최근 1경기/);
  await ui.back('?player=haeram');
  assert.equal(ui.els.detailPlayer.value, 'haeram');
  assert.equal(ui.document.title, '최해람 · 개인 성적 · 융합본부 롤 내전');
  await ui.back('');
  assert.equal(ui.els.playerDirectory.hidden, false);
  assert.equal(ui.els.playerProfile.hidden, true);
  const pushed = ui.urls.length; await ui.clickPlayer('haeram', { ctrlKey: true }); assert.equal(ui.urls.length, pushed);
});

test('unknown player URL stays explicit, never silently selects another player', async () => {
  const ui = await app({ search: '?player=missing' });
  assert.match(ui.els.playerDetail.innerHTML, /선수를 찾을 수 없습니다/);
  assert.equal(ui.els.detailPlayer.value, 'missing');
  assert.equal(ui.urls.length, 0);
  assert.doesNotMatch(ui.els.playerDetail.innerHTML, /신인재|최해람/);
});

test('current scored sets are included before archiving and lead back to match center', async () => {
  const ui = await app({ state: fixture(1, true), search: '?player=injae' });
  assert.equal(ui.server.state.history.length, 0);
  assert.match(ui.els.playerDetail.innerHTML, /최근 1경기/);
  assert.match(ui.els.playerDetail.innerHTML, /href="\.\/index\.html"/);
  assert.match(ui.els.playerDetail.innerHTML, /1세트 · 진행 중/);
});

test('record corrections and deletion recompute source statistics on refresh without a write', async () => {
  const ui = await app({ state: fixture(), search: '?player=injae&date=2026-10-01', session: owner });
  assert.equal(ui.els.adminNav.hidden, false);
  const record = ui.server.state.history[0]; record.results[0] = 1 - record.results[0]; record.games[0].winner = record.results[0]; ui.server.revision += 1;
  await ui.els.playersRefreshBtn.emit('click');
  assert.match(ui.els.playerDetail.innerHTML, /0승 1패/);
  assert.match(ui.els.playerDetail.innerHTML, /0\.0%/);
  ui.server.state.history = []; ui.server.revision += 1;
  await ui.els.playersRefreshBtn.emit('click');
  assert.equal(ui.els.playersDate.value, '2026-10-01');
  assert.match(ui.els.playerDetail.innerHTML, /선택한 경기일에 기록된 내전이 없습니다/);
  assert.doesNotMatch(ui.els.playerDetail.innerHTML, /0\.0%/);
  assert.equal(ui.server.writes, 0);
});

test('connection failure clears stale stats, retry restores current source and viewer permissions', async () => {
  const ui = await app({ search: '?player=injae', session: owner });
  ui.server.fail = '네트워크 연결 실패';
  await ui.els.playersRefreshBtn.emit('click');
  assert.equal(ui.els.playersError.hidden, false);
  assert.match(ui.els.playerDetail.innerHTML, /연결 실패/);
  assert.doesNotMatch(ui.els.playerDetail.innerHTML, /100\.0%/);
  assert.equal(ui.els.adminNav.hidden, true);
  ui.server.fail = null; ui.server.session = viewer;
  await ui.els.playersRefreshBtn.emit('click');
  assert.equal(ui.els.playersError.hidden, true);
  assert.match(ui.els.playerDetail.innerHTML, /100\.0%/);
  assert.equal(ui.els.adminNav.hidden, true);
  assert.equal(ui.els.playersRefreshBtn.disabled, false);
});

test('long and markup-like player/champion names are escaped in text and route attributes', async () => {
  const state = fixture();
  state.roster.find(person => person.id === 'injae').name = '<img src=x onerror=alert(1)>';
  state.history[0].games[0].players.find(person => person.id === 'injae').champion = '<script>alert(1)</script>';
  const ui = await app({ state, search: '?player=injae' });
  assert.match(ui.els.playerDetail.innerHTML, /&lt;img/);
  assert.match(ui.els.playerDetail.innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(ui.els.playerDetail.innerHTML.replace(/<script type="application\/json" data-insight-data>[\s\S]*?<\/script>/g, ''), /<img|<script/);
});

test('recent games load progressively without dropping older source records', async () => {
  const ui = await app({ state: fixture(25), search: '?player=injae' });
  assert.equal((ui.els.playerDetail.innerHTML.match(/class="recent-game /g) || []).length, 20);
  assert.match(ui.els.playerDetail.innerHTML, /이전 경기 더 보기/);
  await ui.more();
  assert.equal((ui.els.playerDetail.innerHTML.match(/class="recent-game /g) || []).length, 25);
  assert.doesNotMatch(ui.els.playerDetail.innerHTML, /이전 경기 더 보기/);
  assert.match(ui.els.playerDetail.innerHTML, /2026\.10\.01/);
});

test('profile uses current nickname while historical rows retain the saved nickname across rename', async () => {
  const state = fixture();
  Object.assign(state.roster.find(player => player.id === 'injae'), { currentNickname: 'New Injae#KR1', nicknameAliases: ['Old Injae#KR1'] });
  state.history[0].games[0].players.find(player => player.id === 'injae').nicknameAtMatch = 'Old Injae#KR1';
  const ui = await app({ state, search: '?player=injae' });
  assert.match(ui.els.playerDetail.innerHTML, /현재 닉네임<\/span><strong>New Injae#KR1/);
  assert.match(ui.els.playerDetail.innerHTML, /이전 닉네임 1개/);
  const recent = ui.els.playerDetail.innerHTML.match(/<ol class="recent-games">([\s\S]*?)<\/ol>/)[1];
  assert.match(recent, /당시 닉네임 · Old Injae#KR1/);
  assert.doesNotMatch(recent, /New Injae/);
  ui.server.state.roster.find(player => player.id === 'injae').currentNickname = 'Newest Injae#KR2';
  ui.server.revision += 1; await ui.els.playersRefreshBtn.emit('click');
  assert.match(ui.els.playerDetail.innerHTML, /현재 닉네임<\/span><strong>Newest Injae#KR2/);
  assert.match(ui.els.playerDetail.innerHTML, /당시 닉네임 · Old Injae#KR1/);
  assert.equal(ui.server.writes, 0);
});

test('nickname search finds a stable profile through current and previous aliases', async () => {
  const state = fixture();
  Object.assign(state.roster.find(player => player.id === 'injae'), { currentNickname: 'NewNickname#KR1', nicknameAliases: ['LegacyNickname#OLD'] });
  const ui = await app({ state });
  for (const query of ['newnickname', 'legacynickname']) {
    ui.els.playerSearch.value = query; await ui.els.playerSearch.emit('input');
    assert.match(ui.els.playerHistory.innerHTML, /player=injae/);
    assert.doesNotMatch(ui.els.playerHistory.innerHTML, /player=haeram/);
    assert.match(ui.els.playerHistory.innerHTML, /NewNickname#KR1/);
  }
});

test('legacy nickname data remains null and never borrows the current profile nickname', async () => {
  const S = require('../domain/player-stats.cjs');
  const state = fixture();
  state.roster.find(player => player.id === 'injae').currentNickname = 'CurrentOnly#KR1';
  const selection = S.selectPlayer(state, 'injae');
  assert.equal(selection.profile.currentNickname, 'CurrentOnly#KR1');
  assert.deepEqual(selection.profile.nicknameAliases, []);
  assert.equal(selection.recent[0].nicknameAtMatch, null);
  assert.equal(S.selectGames(state)[0].participants.find(player => player.id === 'injae').nicknameAtMatch, null);
  assert.equal(S.selectPlayer(state, 'haeram').profile.currentNickname, null);
  const ui = await app({ state, search: '?player=injae' });
  const recent = ui.els.playerDetail.innerHTML.match(/<ol class="recent-games">([\s\S]*?)<\/ol>/)[1];
  assert.doesNotMatch(recent, /CurrentOnly|당시 닉네임/);
});

test('current nickname, aliases and historical nickname are escaped without adding external images', async () => {
  const state = fixture();
  Object.assign(state.roster.find(player => player.id === 'injae'), { currentNickname: '<img src=x>', nicknameAliases: ['<script>old</script>'] });
  state.history[0].games[0].players.find(player => player.id === 'injae').nicknameAtMatch = '<svg onload=x>';
  const ui = await app({ state, search: '?player=injae' });
  assert.match(ui.els.playerDetail.innerHTML, /&lt;img src=x&gt;/);
  assert.match(ui.els.playerDetail.innerHTML, /&lt;script&gt;old&lt;\/script&gt;/);
  assert.match(ui.els.playerDetail.innerHTML, /&lt;svg onload=x&gt;/);
  assert.doesNotMatch(ui.els.playerDetail.innerHTML.replace(/<script type="application\/json" data-insight-data>[\s\S]*?<\/script>/g, ''), /<img|<script|<[^>]+\son[a-z]+\s*=/i);
});

test('visual summaries retain full statistics and show genuine form without inventing empty records', async () => {
  const empty = await app({ state: null });
  assert.equal((empty.els.playerHistory.innerHTML.match(/첫 기록을 기다리는 중/g) || []).length, 10);
  assert.doesNotMatch(empty.els.playerHistory.innerHTML, /<i class="form-win"|0\.0%/);
  const ui = await app({ state: fixture(10), search: '?player=injae' });
  const content = ui.els.playerDetail.innerHTML;
  assert.match(content, /class="player-stage"/);
  assert.match(content, /<svg/);
  assert.match(content, /포지션별 상세 수치/);
  assert.match(content, /챔피언별 상세 수치/);
  assert.match(content, /6승 4패/);
  assert.match(content, /3승 2패/);
  assert.doesNotMatch(content, /<details class="profile-breakdown-details" open/);
  assert.match(ui.els.playerHistory.innerHTML, /class="directory-form" role="img" aria-label="최근 5경기, 최신순:/);
  assert.equal(ui.server.writes, 0);
});

test('role selection scopes all exploration data, preserves focus and leaves cumulative hero unchanged', async () => {
  const ui = await app({ search: '?player=haeram&demo=1' });
  const hero = ui.els.playerDetail.innerHTML.split('<section class="pe-workspace"')[0];
  const sourceState = clone(ui.server.state);
  await ui.role('top');
  assert.match(ui.els.playerDetail.innerHTML, /data-visual-role="top" aria-pressed="true"/);
  assert.match(ui.els.playerDetail.innerHTML, /TOP · 모든 챔피언 · <b>8경기/);
  assert.match(ui.els.playerDetail.innerHTML, /전체 대비/);
  assert.equal(ui.els['role-top'].focused, true);
  assert.equal(ui.els.playerDetail.innerHTML.split('<section class="pe-workspace"')[0], hero);
  assert.equal(ui.els.playerDetail.classList.contains('is-animated'), false);
  assert.deepEqual(ui.server.state, sourceState);
  assert.equal(ui.server.writes, 0);
});

test('entrance motion runs for player or date navigation but does not replay on refresh or more games', async () => {
  const ui = await app({ state: fixture(25), search: '?player=injae' });
  assert.equal(ui.els.playerDetail.classList.contains('is-animated'), true);
  assert.match(ui.els.playerDetail.innerHTML, /class="pi-panel is-animated"/);
  await ui.more();
  assert.doesNotMatch(ui.els.playerDetail.innerHTML, /class="pi-panel is-animated"/);
  assert.equal(ui.els.playerDetail.classList.contains('is-animated'), false);
  ui.server.revision += 1; await ui.els.playersRefreshBtn.emit('click');
  assert.equal(ui.els.playerDetail.classList.contains('is-animated'), false);
  ui.els.playersDate.value = '2026-10-01'; await ui.els.playersDate.emit('change');
  assert.equal(ui.els.playerDetail.classList.contains('is-animated'), true);
  await ui.clickPlayer('haeram');
  assert.equal(ui.els.playerProfile.scrollSettings.behavior, 'smooth');
  assert.equal(ui.server.writes, 0);
});

test('same-profile updates retain expanded detailed stats, navigation resets disclosure state', async () => {
  const ui = await app({ state: fixture(25), search: '?player=injae' });
  for (const key of ['positions', 'champions', 'method']) ui.els.playerDetail.querySelector(`[data-profile-panel="${key}"]`).open = true;
  await ui.more();
  for (const key of ['positions', 'champions', 'method']) assert.equal(ui.els.playerDetail.querySelector(`[data-profile-panel="${key}"]`).open, true);
  await ui.role('mid');
  ui.els['role-mid'].focused = false;
  ui.server.revision += 1; await ui.els.playersRefreshBtn.emit('click');
  assert.equal(ui.els['role-mid'].focused, true);
  for (const key of ['positions', 'champions', 'method']) assert.equal(ui.els.playerDetail.querySelector(`[data-profile-panel="${key}"]`).open, true);
  ui.els.playersDate.value = '2026-10-01'; await ui.els.playersDate.emit('change');
  for (const key of ['positions', 'champions', 'method']) assert.equal(ui.els.playerDetail.querySelector(`[data-profile-panel="${key}"]`).open, false);
  assert.equal(ui.server.writes, 0);
});

test('explicit and OS reduced motion disable entrance and smooth scrolling without a server write', async () => {
  const ui = await app({ search: '?player=injae' });
  await ui.els.playersMotionToggle.emit('click');
  assert.equal(ui.els.playersMotionToggle.textContent, '모션 꺼짐');
  assert.equal(ui.els.playersMotionToggle.attributes['aria-pressed'], 'false');
  assert.equal(ui.document.documentElement.dataset.playerMotion, 'off');
  assert.equal(ui.els.playerDetail.classList.contains('is-animated'), false);
  assert.equal(ui.els.playerDetail.querySelector('.pi-panel').classList.contains('is-animated'), false);
  assert.deepEqual(ui.preferenceWrites, [['lol-player-motion', 'off']]);
  await ui.clickPlayer('haeram');
  assert.equal(ui.els.playerProfile.scrollSettings.behavior, 'auto');
  await ui.els.playersMotionToggle.emit('click');
  assert.equal(ui.els.playerDetail.classList.contains('is-animated'), false);
  assert.equal(ui.els.playersMotionToggle.textContent, '모션 켜짐');
  ui.media.matches = true; ui.media.change();
  assert.equal(ui.els.playersMotionToggle.disabled, true);
  assert.equal(ui.document.documentElement.dataset.playerMotion, 'off');
  const reduced = await app({ reducedMotion: true, storedMotion: 'on', search: '?player=injae' });
  assert.equal(reduced.els.playerDetail.classList.contains('is-animated'), false);
  assert.doesNotMatch(reduced.els.playerDetail.innerHTML, /class="pi-panel is-animated"/);
  assert.equal(reduced.els.playersMotionToggle.textContent, '모션 꺼짐');
  const persisted = await app({ storedMotion: 'off', search: '?player=injae' });
  assert.equal(persisted.els.playerDetail.classList.contains('is-animated'), false);
  const blocked = await app({ storageBlocked: true, search: '?player=injae' });
  await blocked.els.playersMotionToggle.emit('click');
  assert.equal(blocked.els.playersMotionToggle.textContent, '모션 꺼짐');
  assert.equal(ui.server.writes + reduced.server.writes + persisted.server.writes + blocked.server.writes, 0);
});


test('haeram demo opens offline without a shared read or write and remains unmistakably virtual', async () => {
  for (const session of [viewer, owner]) {
    const ui = await app({ search: '?player=haeram&demo=1', fail: 'offline', session });
    assert.equal(ui.server.loads, 0);
    assert.equal(ui.server.writes, 0);
    assert.equal(ui.els.playerDemoBanner.hidden, false);
    assert.match(ui.document.title, /가상 데이터 · 최해람/);
    assert.match(ui.els.playerDetail.innerHTML, /15승 9패/);
    assert.match(ui.els.playerDetail.innerHTML, /62\.5%/);
    assert.match(ui.els.playerDetail.innerHTML, /4연승/);
    assert.match(ui.els.playerDetail.innerHTML, /DEMO PLAYER PROFILE · 가상 데이터/);
    assert.equal(ui.els.detailPlayer.disabled, true);
    assert.equal(ui.els.adminNav.hidden, true);
    assert.equal(ui.els.accessLogin.hidden, true);
    assert.equal(ui.els.playersRefreshBtn.hidden, true);
    assert.equal(ui.els.matchHistoryLink.hidden, true);
    assert.doesNotMatch(ui.els.detailPlayer.innerHTML, /민재|인재|종원|데모 참가자/);
    assert.doesNotMatch(ui.els.playerDetail.innerHTML, /data-player=|history\.html|함께한 동료|경기를 누르면 해당 기록으로 이동/);
    for (const poll of ui.intervals) poll();
    ui.documentEvents.visibilitychange();
    ui.events.pageshow({ persisted: true });
    await settle();
    assert.equal(ui.server.loads, 0);
  }
});

test('demo query does not synthesize other players and entry exits into current real records', async () => {
  const invalid = await app({ search: '?player=injae&demo=1' });
  assert.equal(invalid.server.loads, 1);
  assert.equal(invalid.els.playerDemoBanner.hidden, true);
  assert.doesNotMatch(invalid.document.title, /가상/);
  const ui = await app({ search: '?player=haeram' });
  const originalState = clone(ui.server.state);
  await ui.els.playersDemoEntry.emit('click');
  assert.equal(ui.location.search, '?player=haeram&demo=1');
  assert.equal(ui.els.playerDetailHeading.focused, true);
  assert.equal(ui.server.loads, 1);
  assert.match(ui.els.playerDetail.innerHTML, /15승 9패/);
  ui.server.state = null; ui.server.revision += 1;
  await ui.els.playerDemoExit.emit('click');
  assert.equal(ui.location.search, '?player=haeram');
  assert.equal(ui.els.playerDemoBanner.hidden, true);
  assert.match(ui.els.playerDetail.innerHTML, /아직 기록된 내전이 없습니다/);
  assert.doesNotMatch(ui.els.playerDetail.innerHTML, /15승 9패|가상 데이터/);
  assert.equal(ui.server.loads, 2);
  assert.equal(ui.server.writes, 0);
  assert.equal(originalState.history.length, 1);
});

test('demo dates, progressive list, back navigation and sample detail stay in the isolated route', async () => {
  const ui = await app({ search: '?player=haeram&demo=1' });
  await ui.more();
  assert.equal((ui.els.playerDetail.innerHTML.match(/data-demo-game=/g) || []).length, 25);
  await ui.demoGame(0);
  assert.equal(ui.els.demoGameDialog.open, true);
  assert.match(ui.els.demoGameContent.innerHTML, /Ahri/);
  assert.match(ui.els.demoGameContent.innerHTML, /10 \/ 2 \/ 15/);
  assert.match(ui.els.demoGameContent.innerHTML, /33:30/);
  assert.match(ui.els.demoGameContent.innerHTML, /실제 기록에 저장되지 않습니다/);
  assert.equal(ui.els.demoGameClose.focused, true);
  await ui.els.demoGameClose.emit('click');
  assert.equal(ui.els.demoGameDialog.open, false);
  await ui.demoGame(22);
  assert.match(ui.els.demoGameContent.innerHTML, /<dt>CS<\/dt><dd>—<\/dd>/);
  await ui.els.demoGameClose.emit('click');
  await ui.demoGame(21);
  assert.match(ui.els.demoGameContent.innerHTML, /<dt>경기 시간<\/dt><dd>미입력<\/dd>/);
  await ui.els.demoGameClose.emit('click');
  await ui.demoGame(23);
  assert.match(ui.els.demoGameContent.innerHTML, /<dt>챔피언 대상 피해량<\/dt><dd>—<\/dd>/);
  await ui.els.demoGameClose.emit('click');
  ui.els.playersDate.value = '2026-10-07'; await ui.els.playersDate.emit('change');
  assert.equal(ui.location.search, '?player=haeram&demo=1&date=2026-10-07');
  assert.equal((ui.els.playerDetail.innerHTML.match(/data-demo-game=/g) || []).length, 4);
  assert.match(ui.els.filterSummary.textContent, /^가상 데이터/);
  await ui.back('?player=haeram&demo=1');
  assert.match(ui.els.playerDetail.innerHTML, /15승 9패/);
  assert.equal(ui.server.loads, 0);
  await ui.back('?player=injae');
  assert.equal(ui.server.loads, 1);
  assert.match(ui.document.title, /^신인재/);
  assert.equal(ui.els.playerDemoBanner.hidden, true);
  await ui.back('?player=haeram&demo=1');
  assert.equal(ui.server.loads, 1);
  assert.match(ui.document.title, /^가상 데이터/);
  assert.equal(ui.server.writes, 0);
});

test('delayed real fetch success or failure cannot replace a demo after route change', async () => {
  for (const rejected of [false, true]) {
    const ui = await app({ search: '?player=haeram', deferLoads: true });
    assert.equal(ui.server.loads, 1);
    await ui.els.playersDemoEntry.emit('click');
    assert.match(ui.els.playerDetail.innerHTML, /15승 9패/);
    if (rejected) ui.server.waiting.shift().reject(new Error('late offline'));
    else ui.server.waiting.shift().resolve();
    await settle(); await settle();
    assert.match(ui.els.playerDetail.innerHTML, /15승 9패/);
    assert.equal(ui.els.playerDemoBanner.hidden, false);
    assert.equal(ui.els.playersError.hidden, true);
    assert.equal(ui.server.writes, 0);
    await ui.els.playerDemoExit.emit('click');
    assert.match(ui.els.playerDetail.innerHTML, /실제 개인 성적을 불러오는 중/);
    assert.doesNotMatch(ui.els.playerDetail.innerHTML, /15승 9패/);
    assert.equal(ui.server.loads, 2);
    ui.server.waiting.shift().resolve(); await settle(); await settle();
    assert.doesNotMatch(ui.els.playerDetail.innerHTML, /가상 데이터|15승 9패/);
  }
});

test('insight metrics and selected game update locally, preserve focus and keep profile state', async () => {
  const ui = await app({ search: '?player=haeram&demo=1' });
  const original = ui.els.playerDetail.innerHTML;
  ui.els.playerDetail.querySelector('[data-profile-panel="positions"]').open = true;
  const chosen = JSON.stringify(['demo-haeram-15', 'set:1']);
  await ui.insightKey(chosen);
  assert.equal(ui.els[`insight-key-${encodeURIComponent(chosen)}`].focused, true);
  assert.ok(ui.els.playerInsights.innerHTML.includes(`data-insight-key="${encodeURIComponent(chosen)}" class="pi-pick-win" aria-pressed="true"`));
  for (const metric of ['damage', 'csPerMinute', 'kda']) {
    await ui.metric(metric);
    assert.equal(ui.els[`insight-metric-${metric}`].focused, true);
    assert.match(ui.els.playerInsights.innerHTML, new RegExp(`data-insight-metric="${metric}"[^>]*aria-pressed="true"`));
    assert.ok(ui.els.playerInsights.innerHTML.includes(`data-insight-key="${encodeURIComponent(chosen)}" class="pi-pick-win" aria-pressed="true"`));
  }
  assert.doesNotMatch(ui.els.playerInsights.innerHTML, /class="pi-panel is-animated"/);
  assert.equal(ui.els.playerDetail.innerHTML, original);
  assert.equal(ui.els.playerDetail.querySelector('[data-profile-panel="positions"]').open, true);
  assert.equal(ui.els.playerDetail.classList.contains('is-animated'), false);
  assert.equal(ui.server.loads, 0);
  assert.equal(ui.server.writes, 0);
});


test('real insight selections survive source refresh without mutating any record', async () => {
  const ui = await app({ state: fixture(10), search: '?player=injae' });
  const original = clone(ui.server.state);
  await ui.insightGame(2);
  await ui.metric('csPerMinute');
  ui.server.revision += 1;
  await ui.els.playersRefreshBtn.emit('click');
  assert.match(ui.els.playerDetail.innerHTML, /data-insight-metric="csPerMinute"[^>]*aria-pressed="true"/);
  assert.match(ui.els.playerDetail.innerHTML, /data-insight-game="2"[^>]*aria-pressed="true"/);
  assert.equal(ui.els['insight-metric-csPerMinute'].focused, true);
  assert.deepEqual(ui.server.state, original);
  assert.equal(ui.server.writes, 0);
});

test('explorer line and champion filters intersect across graph, recent games and detail tabs', async () => {
  const ui = await app({ search: '?player=haeram&demo=1' });
  const hero = ui.els.playerDetail.innerHTML.split('<section class="pe-workspace"')[0];
  assert.match(ui.els.playerDetail.innerHTML, /pe-matches-view" hidden/);
  assert.match(ui.els.playerDetail.innerHTML, /pe-details-view" hidden/);
  await ui.champion('ahri');
  let content = ui.els.playerDetail.innerHTML;
  const total = require('../domain/player-stats.cjs').selectPlayer((require('../public/player-demo.js'), globalThis.LoLPlayerDemo.createState()), 'haeram');
  const count = total.recent.filter(row => row.champion === 'Ahri').length;
  assert.match(content, new RegExp(`모든 라인 · Ahri · <b>${count}경기`));
  assert.match(content, /data-explorer-champion="ahri" aria-pressed="true"/);
  const rows = content.match(/<ol class="recent-games">([\s\S]*?)<\/ol>/)[1];
  assert.equal((rows.match(/class="recent-game /g) || []).length, count);
  assert.doesNotMatch(rows, /Orianna|Sylas|Gnar/);
  assert.equal(content.split('<section class="pe-workspace"')[0], hero);
  await ui.explorerView('matches');
  assert.match(ui.els.playerDetail.innerHTML, /data-explorer-view="matches" aria-pressed="true"/);
  assert.match(ui.els.playerDetail.innerHTML, /pe-explore-view" hidden/);
  assert.doesNotMatch(ui.els.playerDetail.innerHTML, /pe-matches-view" hidden/);
  assert.equal(ui.els['explorer-view-matches'].focused, true);
  await ui.explorerView('details');
  assert.doesNotMatch(ui.els.playerDetail.innerHTML, /pe-details-view" hidden/);
  assert.match(ui.els.playerDetail.innerHTML, /선택 범위 · 1종/);
  await ui.role('top');
  assert.match(ui.els.playerDetail.innerHTML, /TOP · Ahri · <b>0경기/);
  assert.match(ui.els.playerDetail.innerHTML, /이 조합의 경기가 없습니다/);
  assert.match(ui.els.playerDetail.innerHTML, /data-explorer-view="details" aria-pressed="true"/);
  assert.equal(ui.els.playerDetail.innerHTML.split('<section class="pe-workspace"')[0], hero);
  await ui.clear('role');
  assert.equal(ui.els['explorer-all-roles-'].focused, true);
  assert.match(ui.els.playerDetail.innerHTML, new RegExp(`모든 라인 · Ahri · <b>${count}경기`));
  await ui.reset();
  assert.match(ui.els.playerDetail.innerHTML, /모든 라인 · 모든 챔피언 · <b>24경기/);
  assert.match(ui.els.playerDetail.innerHTML, /data-explorer-view="details" aria-pressed="true"/);
  assert.equal(ui.server.loads, 0);
  assert.equal(ui.server.writes, 0);
});

test('filtered demo links use original game identity and highlights select exact older games', async () => {
  const ui = await app({ search: '?player=haeram&demo=1' });
  require('../public/player-insights.js'); const I = globalThis.LoLPlayerInsights;
  const detail = require('../domain/player-stats.cjs').selectPlayer((require('../public/player-demo.js'), globalThis.LoLPlayerDemo.createState()), 'haeram');
  await ui.role('top');
  const rows = ui.els.playerDetail.innerHTML.match(/<ol class="recent-games">([\s\S]*?)<\/ol>/)[1];
  const sourceIndex = Number(rows.match(/data-demo-game="(\d+)"/)[1]);
  assert.ok(sourceIndex > 0, 'first top result is not first unfiltered match');
  await ui.demoGame(sourceIndex);
  assert.match(ui.els.demoGameContent.innerHTML, new RegExp(detail.recent[sourceIndex].champion));
  await ui.els.demoGameClose.emit('click');
  const oldestTop = detail.recent.filter(game => game.position === 'top').at(-1);
  await ui.insightKey(I.gameKey(oldestTop));
  assert.ok(ui.els.playerInsights.innerHTML.includes(`data-insight-key="${encodeURIComponent(I.gameKey(oldestTop))}" class="pi-pick-win" aria-pressed="true"`));
  const originalIndex = detail.recent.findIndex(game => I.gameKey(game) === I.gameKey(oldestTop));
  assert.match(ui.els.playerInsightsAction.innerHTML, new RegExp(`data-demo-game="${originalIndex}"`));
  await ui.metric('damage');
  assert.match(ui.els.playerInsightsAction.innerHTML, new RegExp(`data-demo-game="${originalIndex}"`));
  assert.equal(ui.server.writes, 0);
});

test('stable selected game survives new match insertion and deletion chooses an existing source game', async () => {
  require('../public/player-insights.js'); const I = globalThis.LoLPlayerInsights;
  const ui = await app({ state: fixture(10), search: '?player=injae' });
  const selectedKey = JSON.stringify(['test-series-3', 'set:1']);
  await ui.insightKey(selectedKey);
  ui.server.state = fixture(11); ui.server.revision += 1;
  await ui.els.playersRefreshBtn.emit('click');
  assert.ok(ui.els.playerDetail.innerHTML.includes(`data-insight-key="${encodeURIComponent(selectedKey)}" class="pi-pick-loss" aria-pressed="true"`));
  ui.server.state.history = ui.server.state.history.filter(record => record.id !== 'test-series-3');
  ui.server.revision += 1;
  await ui.els.playersRefreshBtn.emit('click');
  assert.doesNotMatch(ui.els.playerDetail.innerHTML, /record=test-series-3&amp;/);
  const current = require('../domain/player-stats.cjs').selectPlayer(ui.server.state, 'injae');
  assert.ok(ui.els.playerDetail.innerHTML.includes(`data-insight-key="${encodeURIComponent(I.gameKey(current.recent[0]))}" class="pi-pick-win" aria-pressed="true"`));
  assert.equal(ui.server.writes, 0);
});

test('deleted champion scope stays honest until reset and route change resets all explorer controls', async () => {
  const ui = await app({ state: fixture(10), search: '?player=injae' });
  await ui.champion('ahri');
  await ui.explorerView('matches');
  ui.server.state.history = ui.server.state.history.filter(record => record.games[0].players.find(player => player.id === 'injae').champion !== 'Ahri');
  ui.server.revision += 1;
  await ui.els.playersRefreshBtn.emit('click');
  assert.match(ui.els.playerDetail.innerHTML, /모든 라인 · ahri · <b>0경기/);
  assert.match(ui.els.playerDetail.innerHTML, /이 조합의 경기가 없습니다/);
  await ui.reset();
  assert.match(ui.els.playerDetail.innerHTML, /모든 라인 · 모든 챔피언 · <b>6경기/);
  await ui.champion('orianna');
  await ui.back('?player=haeram');
  assert.match(ui.els.playerDetail.innerHTML, /data-explorer-view="explore" aria-pressed="true"/);
  assert.match(ui.els.playerDetail.innerHTML, /data-explorer-champion="" aria-pressed="true"/);
  assert.equal(ui.server.writes, 0);
});


test('hero exploration shortcut preserves route and filters and respects reduced motion', async () => {
  const ui = await app({ search: '?player=haeram&demo=1', reducedMotion: true });
  await ui.role('mid');
  const route = ui.location.search;
  await ui.jump();
  assert.equal(ui.els.explorerHeading.focused, true);
  assert.equal(ui.els.explorerHeading.scrollSettings.behavior, 'auto');
  assert.equal(ui.location.search, route);
  assert.match(ui.els.playerDetail.innerHTML, /MID · 모든 챔피언 · <b>16경기/);
  assert.equal(ui.server.writes, 0);
});

test('player card shows source facts only and each one jumps into the matching explorer scope', async () => {
  const ui = await app({ search: '?player=haeram&demo=1' });
  const html = ui.els.playerDetail.innerHTML;
  const strip = html.slice(html.indexOf('class="ps-strip"'), html.indexOf('class="profile-totals"'));
  assert.match(strip, /주 무대[\s\S]*<strong>MID<\/strong><small>16경기 · 전체의 66\.7%<\/small>/);
  assert.match(strip, /최다 픽[\s\S]*<strong>Ahri<\/strong><small>7경기 · 3승 4패<\/small>/);
  assert.match(strip, /한 판 최다 킬[\s\S]*data-count-value="14"/);
  assert.match(strip, /현재 <strong>4연승<\/strong> 중/);
  assert.equal((strip.match(/class="ps-form-card /g) || []).length, 5);
  assert.doesNotMatch(strip, /MVP|MMR|ACE|점수|Score|평점/);
  await ui.heroFilter('champion:ahri');
  assert.match(ui.els.playerDetail.innerHTML, /모든 라인 · Ahri · <b>7경기/);
  assert.equal(ui.els.explorerHeading.focused, true);
  await ui.heroFilter('role:mid');
  assert.match(ui.els.playerDetail.innerHTML, /MID · 모든 챔피언 · <b>16경기/);
  await ui.heroFilter('champion:zed');
  await ui.heroFilter('role:__proto__');
  assert.match(ui.els.playerDetail.innerHTML, /MID · 모든 챔피언 · <b>16경기/);
  assert.equal(ui.server.writes, 0);
});

test('recent card outside the current filter widens the scope and selects that exact game', async () => {
  const ui = await app({ search: '?player=haeram&demo=1' });
  const keys = [...ui.els.playerDetail.innerHTML.matchAll(/data-hero-game="([^"]+)"/g)].map(match => decodeURIComponent(match[1]));
  await ui.role('top');
  assert.match(ui.els.playerDetail.innerHTML, /TOP · 모든 챔피언 · <b>8경기/);
  await ui.heroGame(keys[4]);
  assert.match(ui.els.playerDetail.innerHTML, /모든 라인 · 모든 챔피언 · <b>24경기/);
  assert.match(ui.els.playerDetail.innerHTML, /GAME 20 \/ 24/);
  assert.match(ui.els.playerDetail.innerHTML, /<strong>Orianna<\/strong>/);
  await ui.heroGame('["missing","set:1"]');
  assert.match(ui.els.playerDetail.innerHTML, /GAME 20 \/ 24/);
});

test('replay is user-started from the first game, ends on the latest and never starts with motion off', async () => {
  const ui = await app({ search: '?player=haeram&demo=1' });
  assert.match(ui.els.playerDetail.innerHTML, /data-insight-replay="" aria-pressed="false"/);
  await ui.replay();
  assert.match(ui.els.playerInsights.innerHTML, /GAME 01 \/ 24/);
  const reduced = await app({ search: '?player=haeram&demo=1', reducedMotion: true });
  await reduced.replay();
  assert.doesNotMatch(reduced.els.playerInsights?.innerHTML || '', /GAME 01 \/ 24/);
  assert.match(reduced.els.playerDetail.innerHTML, /GAME 24 \/ 24/);
  assert.equal(ui.server.writes + reduced.server.writes, 0);
});

test('profile view marks the document so the page chrome can compact', async () => {
  const ui = await app({ search: '?player=injae' });
  assert.equal(ui.document.documentElement.dataset.playerView, 'profile');
  await ui.clickPlayer('');
  assert.equal(ui.document.documentElement.dataset.playerView, 'directory');
});
