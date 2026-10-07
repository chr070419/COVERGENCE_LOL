'use strict';
// Event-flow integration with a DOM adapter and an asynchronous shared-data boundary.
// This verifies permissions and persistence behavior, not layout or real browser rendering.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const C = require('../domain/core.cjs');
const H = require('../domain/history-core.cjs');
const root = path.join(__dirname, '../public');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));
const owner = () => ({ user: { id: 'owner-id', name: '소유자', email: 'owner@example.test' }, role: 'owner', canEdit: true, canManageAdmins: true });
const viewer = () => ({ user: null, role: 'viewer', canEdit: false, canManageAdmins: false });

class Element {
  constructor(id = '', attrs = {}) {
    this.id = id; this.value = ''; this.textContent = ''; this.hidden = false; this.checked = false;
    this.disabled = false; this.dataset = {}; this.listeners = {}; this.open = false;
    this.classes = new Set();
    this.classList = { toggle: (name, enabled) => { if (enabled) this.classes.add(name); else this.classes.delete(name); } };
    Object.assign(this, attrs);
  }
  set innerHTML(value) {
    this.markup = value;
    const options = [...value.matchAll(/<option value="([^"]*)"/g)].map(match => match[1]);
    if (options.length) { this.options = options; this.value = options[0]; }
    this.children = [...value.matchAll(/<button\b([^>]*)>/g)].map(match => {
      const dataset = Object.fromEntries([...match[1].matchAll(/data-([a-z-]+)="([^"]*)"/g)]
        .map(attribute => [attribute[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), attribute[2]]));
      return new Element('', {dataset, disabled: /\bdisabled\b/.test(match[1])});
    });
  }
  get innerHTML() { return this.markup || ''; }
  set selectedIndex(value) { this.value = this.options?.[value] || ''; }
  addEventListener(event, callback) { (this.listeners[event] ??= []).push(callback); }
  async emit(type, extra = {}, force = false) {
    if (type === 'click' && this.disabled && !force) return;
    for (const callback of this.listeners[type] || []) await callback({ target: this, preventDefault() {}, ...extra });
    // Some UI handlers intentionally launch an asynchronous commit without returning it.
    await settle();
  }
  closest(selector) {
    const dataName = selector.match(/^\[data-([a-z-]+)\]$/)?.[1]?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return dataName && Object.hasOwn(this.dataset, dataName) ? this : null;
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  select() {}
  click() { return this.emit('click'); }
  remove() {}
}

function fixture(results = [], legacy = false) {
  let state = C.createDefaultState();
  state.draw = C.makeTeams(state.roster); state.drawNumber = 1;
  if (legacy) { state.results = results.slice(); return state; }
  state = H.upgrade(state);
  for (const winner of results) state = H.recordGame(state, winner);
  return H.syncCurrent(state);
}
function createServer(shared = null, session = owner()) {
  return { raw: shared === null ? null : typeof shared === 'string' ? shared : JSON.stringify(shared), revision: shared === null ? 0 : 1,
    session: clone(session), loads: 0, saves: [], reject: null };
}
async function createApp(options = {}) {
  const els = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element(match[1])]));
  const modes = ['balanced', 'random'].map(value => new Element('', { value, checked: value === 'balanced' }));
  const winners = [0, 1].map(index => new Element('', { dataset: { win: String(index) } }));
  const excluded = ['top', 'jungle', 'mid', 'adc', 'support'].map(value => new Element('', { value }));
  const special = Object.fromEntries(['.captain-lock span:last-child', '.line-note strong', '.line-note p', '.roster-notes > span:last-child'].map(key => [key, new Element()]));
  const captions = [new Element(), new Element()];
  const editOnly = [...html.matchAll(/<[^>]*\bdata-edit-only\b[^>]*>/g)].map(match => {
    const id = match[0].match(/\bid="([^"]+)"/)?.[1]; return id ? els[id] : new Element();
  });
  const closers = [...html.matchAll(/<button\b[^>]*data-close="([^"]+)"[^>]*>/g)]
    .map(match => new Element('', {dataset: {close: match[1]}}));
  const downloads = [], blobs = new Map(), intervals = [], documentListeners = {};
  const body = new Element(); body.appendChild = element => { downloads.push({ element, blob: blobs.get(element.href) }); };
  const document = {
    hidden: false, body,
    getElementById(id) { assert.ok(els[id], `Missing HTML element #${id}`); return els[id]; },
    querySelector(selector) {
      if (selector === 'dialog[open]') return Object.values(els).find(element => element.id.endsWith('Dialog') && element.open) || null;
      assert.ok(special[selector], selector); return special[selector];
    },
    querySelectorAll(selector) {
      return ({ '[data-win]': winners, '[name="mode"]': modes, '[name="excluded"]': excluded,
        '[name="excluded"]:checked': excluded.filter(element => element.checked), '.captain-caption': captions,
        '[data-edit-only]': editOnly, '[data-edit]': (els.rosterArea.children || []).filter(element => element.dataset.edit),
        '[data-nickname]': (els.rosterArea.children || []).filter(element => element.dataset.nickname), '[data-close]': closers })[selector] || [];
    },
    addEventListener(event, callback) { (documentListeners[event] ??= []).push(callback); },
    createElement() { return new Element(); }
  };
  let local = options.local ?? null, localReads = 0, localWrites = 0;
  const localStorage = { getItem() { localReads++; return local; }, setItem(key, value) { localWrites++; local = value; }, removeItem() { localWrites++; local = null; } };
  const server = options.server || createServer(options.shared ?? null, options.session || owner());
  const context = vm.createContext({
    document, localStorage, crypto: webcrypto, console, setTimeout() { return 1; }, clearTimeout() {},
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    location: { href: '' }, navigator: { clipboard: { async writeText(value) { context.copied = value; } } }, Blob,
    URL: { createObjectURL(blob) { const url = `blob:test-${blobs.size}`; blobs.set(url, blob); return url; }, revokeObjectURL() {} },
    async hostLoad() {
      server.loads++;
      await Promise.resolve();
      if (server.failLoad) { server.failLoad = false; throw new Error('연결 실패'); }
      return JSON.stringify({ session: server.session, revision: server.revision, state: server.raw === null ? null : JSON.parse(server.raw) });
    },
    async hostSave(raw, revision) {
      server.saves.push({ state: JSON.parse(raw), revision });
      await Promise.resolve();
      if (server.saveGate) await server.saveGate;
      if (server.reject) {
        const rejected = server.reject; server.reject = null;
        if (rejected.loadFail) server.failLoad = true;
        if (Object.hasOwn(rejected, 'state')) server.raw = rejected.state === null ? null : JSON.stringify(rejected.state);
        if (rejected.session) server.session = clone(rejected.session);
        if (rejected.revision !== undefined) server.revision = rejected.revision;
        return JSON.stringify({ error: { status: rejected.status, message: '서버에서 변경을 거절했습니다.' } });
      }
      if (revision !== server.revision) return JSON.stringify({ error: { status: 409, message: '버전 충돌' } });
      if (!server.session.canEdit) return JSON.stringify({ error: { status: 403, message: '편집 권한 없음' } });
      server.raw = raw; server.revision++;
      return JSON.stringify({ state: JSON.parse(raw), revision: server.revision });
    }
  });
  // Parse at the actual client boundary: state objects must use the VM realm's prototypes.
  vm.runInContext(`let knownSession = {user:null,role:'viewer',canEdit:false,canManageAdmins:false};
  globalThis.SiteData = {
    getSession() { return knownSession; },
    async load() { try { const data = JSON.parse(await hostLoad()); knownSession = data.session; return data; }
      catch (error) { knownSession = {user:null,role:'viewer',canEdit:false,canManageAdmins:false}; throw error; }
    },
    async save(state, revision) { const result = JSON.parse(await hostSave(JSON.stringify(state), revision));
      if (result.error) { const error = new Error(result.error.message); error.status = result.error.status; throw error; }
      return result;
    }
  };`, context);
  for (const file of ['draw-base.js', '../domain/core.cjs', '../domain/history-core.cjs', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  await settle();
  return { els, winners, modes, excluded, context, server, editOnly, downloads, document, intervals, closers,
    raw: () => server.raw, read: () => server.raw === null ? null : JSON.parse(server.raw), localRaw: () => local,
    localReads: () => localReads, localWrites: () => localWrites };
}
async function confirm(app) { await app.els.confirmAction.emit('click'); }
async function win(app, index) {
  await app.winners[index].emit('click'); assert.ok(app.els.confirmDialog.open); await confirm(app);
}
async function chooseCandidate(app, index = 0) {
  const button = app.els.candidateList.children.find(element => element.dataset.candidate === String(index));
  assert.ok(button, 'Expected a generated candidate');
  await app.els.candidateList.emit('click', {target: button});
}
async function spoof(element, type = 'click', extra = {}) { await element.emit(type, extra, true); }

test('whole match flow: Bo3 clinch, undo, rule cancel/apply, redraw and restored shared score', async () => {
  const app = await createApp();
  assert.equal(app.read().roster.length, 10); assert.equal(app.els.scoreA.textContent, 0); assert.match(app.els.teamsArea.innerHTML, /신인재|최해람/);
  await win(app, 0); await win(app, 0);
  assert.equal(app.els.scoreA.textContent, 2); assert.ok(app.winners.every(button => button.disabled)); assert.match(app.els.progressText.textContent, /종원 팀 최종 승리/);
  await app.winners[1].emit('click'); assert.deepEqual(app.read().results, [0, 0]);
  await app.els.undoBtn.emit('click'); await confirm(app); assert.equal(app.els.scoreA.textContent, 1); assert.ok(!app.winners[0].disabled);
  app.els.bestOf.value = '5'; await app.els.bestOf.emit('change'); await app.els.cancelAction.emit('click');
  assert.equal(app.read().bestOf, 3); assert.deepEqual(app.read().results, [0]);
  app.els.bestOf.value = '5'; await app.els.bestOf.emit('change'); await confirm(app);
  assert.equal(app.read().bestOf, 5); assert.deepEqual(app.read().results, []);
  await win(app, 1); await win(app, 1); await win(app, 1); assert.match(app.els.progressText.textContent, /민재 팀 최종 승리/);
  const restored = await createApp({ server: app.server }); assert.equal(restored.els.scoreB.textContent, 3); assert.ok(restored.winners[0].disabled);
  await app.els.shuffleBtn.emit('click'); await chooseCandidate(app); await confirm(app); assert.deepEqual(app.read().results, []); assert.equal(app.read().drawNumber, 2);
  await app.els.copyBtn.emit('click'); assert.match(app.context.copied, /종원 팀 0 : 0 민재 팀/); assert.match(app.context.copied, /신인재/);
  assert.equal(app.localWrites(), 0);
});

test('profile edits save a valid draw and safely render names', async () => {
  const app = await createApp(); await app.els.rosterArea.emit('click', { target: { closest: () => ({ dataset: { edit: 'haeram' } }) } });
  app.els.playerName.value = '<b>최해람</b>'; app.els.playerTier.value = 'gold'; await app.els.editForm.emit('submit');
  assert.equal(app.read().roster.find(person => person.id === 'haeram').tier, 'gold'); assert.equal(app.read().drawNumber, 2);
  assert.ok(C.validateState(app.read())); assert.match(app.els.rosterArea.innerHTML, /&lt;b&gt;최해람&lt;\/b&gt;/);
});

test('manual swaps enforce captains and excluded roles while preserving adjustment provenance', async () => {
  const app = await createApp(); await app.els.swapBtn.emit('click'); const draw = app.read().draw;
  const captain = draw.teams[0].findIndex(person => person.id === 'jongwon');
  app.els.swapFrom.value = `0:${captain}`; app.els.swapTo.value = '1:0'; await app.els.swapForm.emit('submit'); assert.match(app.els.swapError.textContent, /팀장/);
  let location; draw.teams.forEach((team, ti) => team.forEach((person, si) => { if (person.id === 'changwoo') location = [ti, si]; }));
  app.els.swapFrom.value = location.join(':'); app.els.swapTo.value = `${location[0]}:${draw.teams[location[0]].findIndex(slot => slot.role === 'support')}`;
  await app.els.swapForm.emit('submit'); assert.match(app.els.swapError.textContent, /제외/);
  app.els.swapFrom.value = '0:0'; app.els.swapTo.value = '0:1'; await app.els.swapForm.emit('submit');
  assert.ok(C.validateState(app.read())); assert.equal(app.read().drawNumber, 2); assert.equal(app.els.drawTag.textContent, '직접 조정');
});

test('completed archives, undo, and date correction retain the same shared series identity', async () => {
  const app = await createApp(); app.els.matchDate.value = '2026-09-30'; await app.els.matchDate.emit('change');
  await win(app, 0); await win(app, 0); assert.equal(app.read().history.length, 1); const id = app.read().history[0].id;
  assert.equal(app.read().history[0].date, '2026-09-30'); assert.equal(app.read().history[0].status, 'completed');
  const restored = await createApp({ server: app.server }); assert.equal(restored.read().history.length, 1); assert.equal(restored.els.historyCount.textContent, 1);
  restored.els.matchDate.value = '2026-10-01'; await restored.els.matchDate.emit('change'); await confirm(restored);
  assert.equal(restored.read().history[0].date, '2026-10-01'); assert.equal(restored.read().history[0].id, id);
  await restored.els.undoBtn.emit('click'); await confirm(restored); assert.equal(restored.read().history.length, 0);
  await win(restored, 1); await win(restored, 0); assert.equal(restored.read().history.length, 1); assert.equal(restored.read().history[0].id, id);
});

test('daily history survives lineup edits, partial day-end and legacy backup import', async () => {
  const app = await createApp(); await win(app, 0); await win(app, 0); const archived = JSON.stringify(app.read().history[0]);
  await app.els.rosterArea.emit('click', { target: { closest: () => ({ dataset: { edit: 'haeram' } }) } });
  app.els.playerName.value = '최해람 수정'; app.els.playerTier.value = 'diamond'; await app.els.editForm.emit('submit'); await confirm(app);
  assert.equal(JSON.stringify(app.read().history[0]), archived); assert.equal(app.read().results.length, 0);
  app.els.matchDate.value = '2026-10-08'; await app.els.matchDate.emit('change'); await win(app, 1); await app.els.endDayBtn.emit('click'); await confirm(app);
  assert.equal(app.read().history.length, 2); assert.ok(app.read().history.some(record => record.status === 'stopped' && record.date === '2026-10-08'));
  assert.equal(app.context.location.href, './history.html?date=2026-10-08');
  const stats = H.summarize(app.read().history); assert.equal(stats.games, 3); assert.equal(stats.completed, 1); assert.equal(stats.stopped, 1); assert.equal(stats.teams[1].seriesWins, 0);
  const legacy = fixture([], true); app.els.loadFile.files = [{ size: 2000, text: async () => JSON.stringify(legacy) }];
  await app.els.loadFile.emit('change'); await confirm(app); assert.equal(app.read().history.length, 2); assert.equal(app.read().roster.find(person => person.id === 'haeram').name, '최해람');
  const restored = await createApp({ server: app.server }); assert.equal(restored.read().history.length, 2); assert.ok(H.validate(restored.read()));
});

test('viewers see shared data and cannot mutate through spoofed clicks, forms or imports', async () => {
  const shared = fixture([0]); const local = JSON.stringify(fixture([1, 1], true));
  const app = await createApp({ shared, local, session: viewer() }); const before = app.raw();
  assert.equal(app.els.accessBadge.textContent, '뷰어'); assert.equal(app.els.scoreA.textContent, 1); assert.equal(app.els.scoreB.textContent, 0);
  assert.ok(app.editOnly.every(element => element.hidden)); assert.ok(app.winners.every(button => button.disabled));
  assert.equal(app.els.adminNav.hidden, true); assert.equal(app.localReads(), 0);
  for (const id of ['shuffleBtn', 'swapBtn', 'undoBtn', 'resetSeriesBtn', 'endDayBtn', 'migrateBtn', 'loadBtn', 'confirmAction', 'makeCandidatesBtn', 'addPairBtn']) await spoof(app.els[id]);
  await spoof(app.winners[1]);
  app.els.bestOf.value = '7'; await spoof(app.els.bestOf, 'change');
  app.els.matchDate.value = '2026-10-09'; await spoof(app.els.matchDate, 'change');
  await spoof(app.modes[1], 'change');
  await spoof(app.els.rosterArea, 'click', { target: { closest: () => ({ dataset: { edit: 'haeram' } }) } });
  await spoof(app.els.editForm, 'submit'); await spoof(app.els.swapForm, 'submit');
  await spoof(app.els.lockCaptains, 'change'); await spoof(app.els.avoidRepeat, 'change');
  await spoof(app.els.candidateList, 'click', {target: new Element('', {dataset: {candidate: '0'}})});
  await spoof(app.els.pairList, 'click', {target: new Element('', {dataset: {removePair: '0'}})});
  let fileReads = 0; app.els.loadFile.files = [{ size: local.length, text: async () => { fileReads++; return local; } }];
  await spoof(app.els.loadFile, 'change');
  assert.equal(fileReads, 0); assert.equal(app.server.saves.length, 0); assert.equal(app.raw(), before);
  assert.equal(app.localRaw(), local); assert.equal(app.localWrites(), 0); assert.equal(app.els.confirmDialog.open, false); assert.equal(app.els.editDialog.open, false);
});

test('an initial viewer ignores local records and never seeds an empty shared match', async () => {
  const local = JSON.stringify(fixture([1, 1], true));
  const app = await createApp({ local, session: viewer() });
  assert.equal(app.raw(), null); assert.equal(app.server.saves.length, 0); assert.equal(app.localReads(), 0); assert.equal(app.localRaw(), local);
  assert.equal(app.els.scoreA.textContent, 0); assert.equal(app.els.scoreB.textContent, 0); assert.match(app.els.teamsArea.innerHTML, /관리자가 공용 경기를 준비/);
  assert.equal(app.els.legacyNotice.hidden, true); assert.equal(app.els.saveBtn.disabled, true);
});

test('owner seeds a fresh shared match without automatically migrating existing local scores', async () => {
  const legacy = fixture([1, 1], true); legacy.roster.find(person => person.id === 'haeram').name = '이전 명단';
  const local = JSON.stringify(legacy); const app = await createApp({ local });
  assert.equal(app.server.saves.length, 1); assert.equal(app.server.saves[0].revision, 0);
  assert.deepEqual(app.read().results, []); assert.deepEqual(app.read().history, []);
  assert.equal(app.read().roster.find(person => person.id === 'haeram').name, '최해람');
  assert.equal(app.els.legacyNotice.hidden, false); assert.equal(app.localRaw(), local); assert.equal(app.localWrites(), 0);
  assert.equal(app.els.adminNav.hidden, false); assert.equal(app.els.accessBadge.textContent, '소유자 · 관리자');
});

test('409 rejects the optimistic score, loads the latest revision and permits a deliberate retry', async () => {
  const app = await createApp({ shared: fixture() }); const latest = H.recordGame(app.read(), 1);
  app.server.reject = { status: 409, state: latest, revision: 7 };
  await win(app, 0);
  assert.equal(app.server.saves.length, 1); assert.equal(app.server.saves[0].revision, 1);
  assert.deepEqual(app.read().results, [1]); assert.equal(app.els.scoreA.textContent, 0); assert.equal(app.els.scoreB.textContent, 1);
  assert.match(app.els.storageWarning.textContent, /다른 관리자가 먼저 변경/); assert.equal(app.els.storageWarning.hidden, false);
  await win(app, 0);
  assert.equal(app.server.saves[1].revision, 7); assert.deepEqual(app.read().results, [1, 0]); assert.equal(app.els.storageWarning.hidden, true);
});

test('403 refreshes revoked permission, rolls back optimistic state and blocks subsequent spoofed edits', async () => {
  const app = await createApp({ shared: fixture() }); const latest = H.recordGame(app.read(), 1);
  app.server.reject = { status: 403, state: latest, revision: 4, session: viewer() };
  await win(app, 0);
  assert.deepEqual(app.read().results, [1]); assert.equal(app.els.scoreA.textContent, 0); assert.equal(app.els.scoreB.textContent, 1);
  assert.equal(app.els.accessBadge.textContent, '뷰어'); assert.ok(app.winners.every(button => button.disabled)); assert.ok(app.editOnly.every(element => element.hidden));
  assert.match(app.els.storageWarning.textContent, /편집 권한이 없습니다/);
  await spoof(app.winners[0]); await spoof(app.els.shuffleBtn); await spoof(app.els.confirmAction);
  assert.equal(app.server.saves.length, 1); assert.deepEqual(app.read().results, [1]);
});

test('explicit legacy migration merges prior matches and preserves the exact raw browser backup', async () => {
  const legacy = fixture([1, 1], true); const local = '\n' + JSON.stringify(legacy, null, 2) + '\n';
  const app = await createApp({ shared: fixture([0]), local });
  assert.equal(app.server.saves.length, 0); assert.deepEqual(app.read().results, [0]);
  await app.els.migrateBtn.emit('click'); assert.equal(app.els.confirmDialog.open, true); assert.equal(app.server.saves.length, 0);
  await app.els.cancelAction.emit('click'); assert.deepEqual(app.read().results, [0]);
  await app.els.legacyBackupBtn.emit('click'); assert.equal(await app.downloads.at(-1).blob.text(), local);
  await app.els.migrateBtn.emit('click'); await confirm(app);
  assert.equal(app.server.saves.length, 1); assert.deepEqual(app.read().results, [1, 1]); assert.equal(app.read().history.length, 2);
  assert.ok(app.read().history.some(record => record.status === 'stopped' && record.results.join() === '0'));
  assert.ok(app.read().history.some(record => record.status === 'completed' && record.results.join() === '1,1'));
  assert.equal(app.els.legacyNotice.hidden, true); assert.equal(app.localRaw(), local); assert.equal(app.localWrites(), 0);
});

test('corrupt legacy records stay recoverable and cannot replace the shared match', async () => {
  const app = await createApp({ shared: fixture(), local: '{bad' }); const before = app.raw();
  await app.els.migrateBtn.emit('click'); assert.equal(app.els.confirmDialog.open, false); assert.match(app.els.toast.textContent, /이전 기록을 읽지 못했습니다/);
  assert.equal(app.server.saves.length, 0); assert.equal(app.raw(), before); assert.equal(app.localRaw(), '{bad');
  await app.els.legacyBackupBtn.emit('click'); assert.equal(await app.downloads.at(-1).blob.text(), '{bad');
});

test('viewer polling reads newer shared scores without writing or consulting browser records', async () => {
  const app = await createApp({ shared: fixture(), local: '{bad', session: viewer() });
  const updated = H.recordGame(H.recordGame(app.read(), 0), 1); app.server.raw = JSON.stringify(updated); app.server.revision = 8;
  app.intervals[0](); await settle();
  assert.equal(app.els.scoreA.textContent, 1); assert.equal(app.els.scoreB.textContent, 1);
  assert.equal(app.server.loads, 2); assert.equal(app.server.saves.length, 0); assert.equal(app.localReads(), 0);
});

for (const status of [403, 409]) {
  test(`${status} followed by a failed reload restores confirmed scores and fails closed`, async () => {
    const app = await createApp({ shared: fixture() }); const before = app.raw();
    app.server.reject = { status, loadFail: true };
    await win(app, 0);
    assert.equal(app.raw(), before); assert.equal(app.els.scoreA.textContent, 0); assert.equal(app.els.scoreB.textContent, 0);
    assert.equal(app.els.accessBadge.textContent, '뷰어'); assert.ok(app.winners.every(button => button.disabled));
    assert.equal(app.els.confirmDialog.open, false); assert.equal(app.els.editDialog.open, false); assert.equal(app.els.swapDialog.open, false);
    if (status === 409) assert.match(app.els.storageWarning.textContent, /최신 내용을 불러오지 못했/);
    await spoof(app.winners[0]); await spoof(app.els.confirmAction); assert.equal(app.server.saves.length, 1);
  });
}

test('shuffle candidates are only previews until an admin applies one', async () => {
  const app = await createApp({shared: fixture([0])});
  const before = app.raw(), writes = app.server.saves.length;
  await app.els.shuffleBtn.emit('click');
  assert.equal(app.els.shuffleDialog.open, true);
  assert.match(app.els.candidateList.innerHTML, /후보 1/);
  assert.ok(app.els.candidateList.children.some(button => button.dataset.candidate === '0'));
  assert.equal(app.raw(), before); assert.equal(app.server.saves.length, writes);
  await app.closers.find(button => button.dataset.close === 'shuffleDialog').emit('click');
  assert.equal(app.els.shuffleDialog.open, false); assert.equal(app.raw(), before);
  await app.els.shuffleBtn.emit('click'); await chooseCandidate(app);
  assert.equal(app.els.shuffleDialog.open, false); assert.equal(app.els.confirmDialog.open, true);
  assert.equal(app.raw(), before); assert.equal(app.server.saves.length, writes);
  await app.els.cancelAction.emit('click'); assert.equal(app.raw(), before);
  await app.els.shuffleBtn.emit('click'); await chooseCandidate(app); await confirm(app);
  assert.equal(app.server.saves.length, writes + 1);
  assert.deepEqual(app.read().results, []); assert.deepEqual(app.read().games, []);
  assert.equal(app.read().history.length, 1); assert.equal(app.read().history[0].status, 'stopped');
  assert.deepEqual(app.read().history[0].results, [0]); assert.notEqual(app.read().seriesId, JSON.parse(before).seriesId);
});

test('changing shuffle options or separation pairs invalidates the existing previews', async () => {
  const app = await createApp({shared: fixture()}); const before = app.raw();
  await app.els.shuffleBtn.emit('click');
  app.els.lockCaptains.checked = false; await app.els.lockCaptains.emit('change');
  assert.equal(app.els.candidateList.innerHTML, ''); assert.match(app.els.candidateError.textContent, /후보를 다시/);
  await app.els.candidateList.emit('click', {target: new Element('', {dataset: {candidate: '0'}})});
  assert.equal(app.raw(), before); assert.equal(app.server.saves.length, 0);
  await app.els.makeCandidatesBtn.emit('click'); assert.match(app.els.candidateList.innerHTML, /후보 1/);
  app.els.pairA.value = 'injae'; app.els.pairB.value = 'seungju'; await app.els.addPairBtn.emit('click');
  assert.equal(app.els.candidateList.innerHTML, ''); assert.match(app.els.pairList.innerHTML, /신인재 ↔ 피승주/);
  await app.els.makeCandidatesBtn.emit('click'); assert.match(app.els.candidateList.innerHTML, /후보 1/);
  const remover = app.els.pairList.children.find(button => button.dataset.removePair === '0');
  await app.els.pairList.emit('click', {target: remover});
  assert.equal(app.els.candidateList.innerHTML, ''); assert.equal(app.els.pairList.innerHTML, '');
  app.els.pairA.value = 'injae'; app.els.pairB.value = 'seungju'; await app.els.addPairBtn.emit('click');
  app.els.avoidRepeat.checked = false; await app.els.avoidRepeat.emit('change');
  await app.els.makeCandidatesBtn.emit('click'); await chooseCandidate(app);
  const saved = app.read();
  assert.equal(saved.shuffleOptions.captainsLocked, false); assert.equal(saved.shuffleOptions.avoidRepeat, false);
  assert.deepEqual(saved.shuffleOptions.separatePairs, [['injae','seungju']]);
  const teamOf = id => saved.draw.teams.findIndex(team => team.some(slot => slot.id === id));
  assert.notEqual(teamOf('injae'), teamOf('seungju')); assert.equal(saved.draw.constraints.captainsLocked, false);
  assert.equal(app.server.saves.length, 1); assert.ok(H.validate(saved));
});

test('mid-series swaps preserve the score and completed lineup and apply to the next set', async () => {
  const app = await createApp({shared: fixture([0])});
  const original = app.read(), firstGame = clone(original.games[0]);
  await app.els.swapBtn.emit('click');
  app.els.swapFrom.value = '0:0'; app.els.swapTo.value = '0:1';
  await app.els.swapForm.emit('submit');
  assert.equal(app.els.confirmDialog.open, true);
  assert.deepEqual(app.read(), original);
  await confirm(app);
  let current = app.read();
  assert.equal(current.seriesId, original.seriesId); assert.deepEqual(current.results, [0]);
  assert.deepEqual(current.games[0], firstGame); assert.equal(current.drawNumber, original.drawNumber + 1);
  assert.notDeepEqual(current.draw.teams, firstGame.draw.teams);
  assert.equal(app.els.scoreA.textContent, 1); assert.equal(app.els.scoreB.textContent, 0);
  const nextDraw = clone(current.draw);
  await win(app, 1); current = app.read();
  assert.deepEqual(current.results, [0, 1]); assert.deepEqual(current.games[0], firstGame);
  assert.deepEqual(current.games[1].draw, nextDraw);
  assert.equal(current.history.length, 0); assert.ok(H.validate(current));
});

test('played set buttons open the frozen lineup for viewers after the current lineup changes', async () => {
  let shared = fixture([0]); const original = clone(shared.games[0]);
  const nextDraw = clone(shared.draw); [nextDraw.teams[0][0].id, nextDraw.teams[0][1].id] = [nextDraw.teams[0][1].id, nextDraw.teams[0][0].id];
  nextDraw.metrics = C.summarize(nextDraw.teams, shared.roster, nextDraw.constraints); nextDraw.adjusted = true;
  shared = H.setNextDraw(shared, nextDraw);
  const app = await createApp({shared, session: viewer()});
  const played = app.els.seriesGames.children.find(button => button.dataset.game === '0');
  assert.ok(played); await app.els.seriesGames.emit('click', {target: played});
  assert.equal(app.els.gameDialog.open, true); assert.equal(app.els.gameDialogTitle.textContent, '1세트 · 종원 팀 승리');
  const oldTopId = original.draw.teams[0].find(slot => slot.role === 'top').id;
  const oldTopName = shared.roster.find(person => person.id === oldTopId).name;
  assert.ok(app.els.gameDialogContent.innerHTML.includes(`<span>탑</span><b>${oldTopName}</b>`));
  assert.match(app.els.gameDialogContent.innerHTML, /챔피언 미입력/);
  assert.equal(app.server.saves.length, 0);
  await app.closers.find(button => button.dataset.close === 'gameDialog').emit('click');
  await app.els.seriesGames.emit('click', {target: new Element('', {dataset: {game: '1'}})});
  assert.equal(app.els.gameDialog.open, false); assert.equal(app.server.saves.length, 0);
});

async function openNicknames(app, id = 'haeram') {
  await app.els.rosterArea.emit('click', {target: new Element('', {dataset: {nickname:id}})});
}
for (const results of [[0], [0, 0]]) {
  test(`nickname rename preserves ${results.length === 1 ? 'active' : 'completed'} score, series, lineup and frozen archive`, async () => {
    let shared = H.updatePlayerNicknames(fixture(results), 'haeram', {currentNickname:'Original#KR1', nicknameAliases:['Past#KR1']});
    shared = H.syncCurrent(shared);
    const app = await createApp({shared}), before = app.read();
    await openNicknames(app); assert.equal(app.els.nicknameDialog.open, true); assert.equal(app.els.editDialog.open, false);
    app.els.nicknameCurrent.value = 'NewName#KR1';
    await app.els.nicknameForm.emit('submit');
    const after = app.read(), player = after.roster.find(p => p.id === 'haeram');
    assert.equal(player.currentNickname, 'NewName#KR1'); assert.deepEqual(player.nicknameAliases, ['Past#KR1', 'Original#KR1']);
    assert.deepEqual({...after, roster:before.roster}, before);
    assert.equal(app.els.nicknameDialog.open, false); assert.equal(app.els.confirmDialog.open, false);
    assert.equal(app.server.saves.length, 1); assert.equal(app.server.saves[0].revision, 1);
    assert.match(app.els.rosterArea.innerHTML, /NewName#KR1/); assert.match(app.els.rosterArea.innerHTML, /이전·추가 2개/);
  });
}

test('nickname aliases can be corrected manually and changing to empty retains the former current name', async () => {
  const shared = H.updatePlayerNicknames(fixture([0]), 'haeram', {currentNickname:'Current#KR1', nicknameAliases:['WrongAlias','KeepAlias']});
  const app = await createApp({shared});
  await openNicknames(app); app.els.nicknameAliases.value = 'KeepAlias\nAnotherAlias'; await app.els.nicknameForm.emit('submit');
  assert.deepEqual(app.read().roster.find(p => p.id === 'haeram').nicknameAliases, ['KeepAlias','AnotherAlias']);
  await openNicknames(app); app.els.nicknameCurrent.value = ''; app.els.nicknameAliases.value = ''; await app.els.nicknameForm.emit('submit');
  const player = app.read().roster.find(p => p.id === 'haeram');
  assert.equal(player.currentNickname, null); assert.deepEqual(player.nicknameAliases, ['Current#KR1']);
  await openNicknames(app); app.els.nicknameAliases.value = ''; await app.els.nicknameForm.emit('submit');
  assert.deepEqual(app.read().roster.find(p => p.id === 'haeram').nicknameAliases, []);
});

test('ambiguous nicknames require a deliberate second save and changing input resets acknowledgement', async () => {
  const shared = H.updatePlayerNicknames(fixture(), 'injae', {currentNickname:'Same Name#KR1', nicknameAliases:['OldAlias']});
  const app = await createApp({shared});
  await openNicknames(app); app.els.nicknameCurrent.value = 'same name#kr1'; await app.els.nicknameForm.emit('submit');
  assert.equal(app.server.saves.length, 0); assert.equal(app.els.nicknameWarning.hidden, false);
  assert.match(app.els.nicknameWarning.textContent, /신인재/); assert.match(app.els.nicknameWarning.textContent, /자동 연결되지 않/);
  assert.equal(app.els.nicknameSave.textContent, '중복 확인 후 저장');
  app.els.nicknameCurrent.value = 'OldAlias'; await app.els.nicknameCurrent.emit('input');
  assert.equal(app.els.nicknameWarning.hidden, true); await app.els.nicknameForm.emit('submit'); assert.equal(app.server.saves.length, 0);
  await app.els.nicknameForm.emit('submit'); assert.equal(app.server.saves.length, 1);
  assert.equal(app.read().roster.find(p => p.id === 'haeram').currentNickname, 'OldAlias');
});

test('viewers see nickname labels but cannot edit through spoofed clicks or form submits', async () => {
  const shared = H.updatePlayerNicknames(fixture(), 'haeram', {currentNickname:'<Name>#KR1', nicknameAliases:[]});
  const app = await createApp({shared, session:viewer()}), before = app.raw();
  assert.match(app.els.rosterArea.innerHTML, /&lt;Name&gt;#KR1/); assert.doesNotMatch(app.els.rosterArea.innerHTML, /data-nickname=/);
  await openNicknames(app); app.els.nicknameCurrent.value = 'hacked'; app.els.nicknameDialog.open = true;
  await spoof(app.els.nicknameForm, 'submit');
  assert.equal(app.server.saves.length, 0); assert.equal(app.raw(), before); assert.ok(app.els.nicknameSave.disabled);
});

test('nickname CAS conflict keeps latest server record and requires reopening before a fresh edit', async () => {
  const shared = H.updatePlayerNicknames(fixture([0]), 'haeram', {currentNickname:'Before', nicknameAliases:[]});
  const latest = H.updatePlayerNicknames(H.recordGame(shared, 1), 'haeram', {currentNickname:'OtherAdmin', nicknameAliases:[]});
  const app = await createApp({shared}); await openNicknames(app); app.els.nicknameCurrent.value = 'MyStaleEdit';
  app.server.reject = {status:409, state:latest, revision:8}; await app.els.nicknameForm.emit('submit');
  assert.deepEqual(app.read(), latest); assert.equal(app.server.saves.length, 1); assert.equal(app.els.nicknameDialog.open, true);
  await app.els.nicknameForm.emit('submit'); assert.equal(app.server.saves.length, 1); assert.match(app.els.nicknameError.textContent, /다시 열어/);
  app.els.nicknameDialog.close(); await openNicknames(app); assert.equal(app.els.nicknameCurrent.value, 'OtherAdmin');
  app.els.nicknameCurrent.value = 'DeliberateNewName'; await app.els.nicknameForm.emit('submit');
  assert.equal(app.server.saves[1].revision, 8); assert.deepEqual(app.read().results, [0,1]);
  assert.ok(app.read().roster.find(p => p.id === 'haeram').nicknameAliases.includes('OtherAdmin'));
});

test('nickname saving blocks cancel and closes the dialog when permission is revoked', async () => {
  const app = await createApp({shared:fixture([0])}); await openNicknames(app); app.els.nicknameCurrent.value = 'Pending';
  let release; app.server.saveGate = new Promise(resolve => {release=resolve;});
  app.server.reject = {status:403, session:viewer()};
  const pending = app.els.nicknameForm.emit('submit'); await settle();
  assert.ok(app.els.nicknameCurrent.disabled); assert.ok(app.els.nicknameSave.disabled);
  const closer = app.closers.find(button => button.dataset.close === 'nicknameDialog');
  await spoof(closer); assert.equal(app.els.nicknameDialog.open, true);
  let prevented = false; await app.els.nicknameDialog.emit('cancel', {preventDefault(){prevented=true;}}); assert.ok(prevented);
  release(); await pending; assert.equal(app.els.nicknameDialog.open, false); assert.equal(app.els.accessBadge.textContent, '뷰어');
  assert.equal(app.read().roster.find(p => p.id === 'haeram').currentNickname, null);
  await spoof(app.els.nicknameForm, 'submit'); assert.equal(app.server.saves.length, 1);
});
