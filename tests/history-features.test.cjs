'use strict';
// Event-flow tests use a small DOM adapter; they do not assert browser layout.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const C = require('../domain/core.cjs');
const H = require('../domain/history-core.cjs');
const root = path.join(__dirname, '../public');
const html = fs.readFileSync(path.join(root, 'history.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'history-page.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));
const admin = { user: { id: 'admin', name: '관리자' }, role: 'admin', canEdit: true, canManageAdmins: false };
const viewer = { user: null, role: 'viewer', canEdit: false, canManageAdmins: false };
const decode = value => String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function attrs(source) { return Object.fromEntries([...source.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])])); }
function fixture() {
  let state = C.createDefaultState(); state.draw = C.makeTeams(state.roster); state.drawNumber = 1;
  state = H.upgrade(state); state = H.recordGame(state, 0); state = H.recordGame(state, 0);
  return state;
}
async function app(options = {}) {
  const server = { state: clone(options.state || fixture()), revision: 1, session: clone(options.session || admin), writes: [], audit: [], fail: null, ...options.server };
  let rows = [], selects = new Map(), scrollCalls = [];
  class Element {
    constructor(id = '', properties = {}) {
      this.id = id; this.dataset = {}; this.listeners = {}; this.value = ''; this.hidden = false; this.disabled = false; this.open = false; this.textContent = '';
      this.classList = { add() {}, remove() {} }; Object.assign(this, properties);
    }
    set innerHTML(markup) {
      this.markup = markup;
      if (this.id === 'historyMatches') {
        for (const id of Object.keys(els)) if (id.startsWith('record-')) delete els[id];
        for (const match of markup.matchAll(/id="(record-[^"]+)"/g)) {
          const id = decode(match[1]); els[id] = new Element(id);
        }
      }
      if (this.id === 'editSets') {
        rows = []; selects = new Map();
        for (const match of markup.matchAll(/<select([^>]*data-winner="\d+"[^>]*)>([\s\S]*?)<\/select>/g)) {
          const a = attrs(match[1]); const selected = [...match[2].matchAll(/<option value="([^"]+)"([^>]*)>/g)];
          selects.set(`winner-${a['data-winner']}`, new Element('', { value: selected.find(item => item[2].includes('selected'))?.[1] || selected[0][1] }));
        }
        for (const match of markup.matchAll(/<input([^>]*data-(duration|notes)="\d+"[^>]*)>/g)) {
          const a = attrs(match[1]); selects.set(`${match[2]}-${a[`data-${match[2]}`]}`, new Element('', { value: a.value || '' }));
        }
        for (const match of markup.matchAll(/<tr data-player-row([^>]*)>([\s\S]*?)<\/tr>/g)) {
          const a = attrs(match[1]); const row = new Element('', { dataset: { game: a['data-game'], team: a['data-team'], role: a['data-role'], person: a['data-person'] }, fields: {} });
          for (const select of match[2].matchAll(/<select([^>]*)>([\s\S]*?)<\/select>/g)) {
            const sa = attrs(select[1]); const opts = [...select[2].matchAll(/<option value="([^"]+)"([^>]*)>/g)];
            row.fields[sa['data-field']] = new Element('', { value: opts.find(item => item[2].includes('selected'))?.[1] || opts[0][1], dataset: { field: sa['data-field'] }, row });
          }
          for (const input of match[2].matchAll(/<input([^>]*)>/g)) {
            const ia = attrs(input[1]); row.fields[ia['data-field']] = new Element('', { value: ia.value || '', dataset: { field: ia['data-field'] }, row });
          }
          rows.push(row);
        }
      }
    }
    get innerHTML() { return this.markup || ''; }
    addEventListener(event, listener) { (this.listeners[event] ||= []).push(listener); }
    async emit(type, extra = {}) { for (const fn of this.listeners[type] || []) await fn({ target: this, preventDefault() {}, ...extra }); await settle(); }
    closest(selector) { if (selector === '[data-player-row]') return this.row || this; if (selector === 'button' || selector.startsWith('[data-')) return this; return null; }
    querySelector(selector) { return this.fields?.[selector.match(/data-field="([^"]+)"/)?.[1]] || null; }
    querySelectorAll() { return []; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    reportValidity() { return true; }
    scrollIntoView() { scrollCalls.push(this.id); }
    focus() {}
  }
  const els = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element(match[1])]));
  const closeButtons = [...html.matchAll(/<button[^>]*data-close="([^"]+)"[^>]*>/g)].map(match => new Element('', { dataset: { close: match[1] } }));
  const document = {
    hidden: false,
    getElementById(id) { assert.ok(els[id], `missing #${id}`); return els[id]; },
    querySelector(selector) {
      if (selector === 'dialog[open]') return Object.values(els).find(el => el.open) || null;
      const match = selector.match(/data-(winner|duration|notes)="(\d+)"/); return match ? selects.get(`${match[1]}-${match[2]}`) : null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-close]') return closeButtons;
      const match = selector.match(/data-game="(\d+)"/); return match ? rows.filter(row => row.dataset.game === match[1]) : [];
    },
    addEventListener() {}, body: { appendChild() {} }
  };
  const context = vm.createContext({ document, crypto: webcrypto, console, URLSearchParams, Intl,
    window: { location: { search: options.search || '' }, addEventListener() {} }, setTimeout() {}, clearTimeout() {}, setInterval() {},
    async hostLoad() { return JSON.stringify({ state: server.state, revision: server.revision, session: server.session }); },
    async hostSave(raw, revision, reason) {
      server.writes.push({ state: JSON.parse(raw), revision, reason });
      if (server.fail) throw Object.assign(new Error(server.fail.message || '저장 실패'), { status: server.fail.status });
      if (revision !== server.revision) throw Object.assign(new Error('동시 수정'), { status: 409 });
      server.state = JSON.parse(raw); server.revision += 1;
      return JSON.stringify({ state: server.state, revision: server.revision });
    },
    async hostAudit(id) { server.lastAudit = id; return JSON.stringify({ entries: server.audit }); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../domain/core.cjs'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../domain/history-core.cjs'), 'utf8'), context);
  vm.runInContext(`globalThis.SiteData = { load: async()=>JSON.parse(await hostLoad()), save:async(state,rev,reason)=>JSON.parse(await hostSave(JSON.stringify(state),rev,reason)), listAudit:async id=>JSON.parse(await hostAudit(id)) }; globalThis.ResultCard={open(record){globalThis.sharedId=record.id;}};`, context);
  vm.runInContext(source, context); await settle(); await settle();
  return { els, server, context, scrollCalls, rows: () => rows, controls: () => selects,
    closeDialog: async id => closeButtons.find(button => button.dataset.close === id).emit('click'),
    clickRecord: async (key, id = server.state.history[0].id) => els.historyMatches.emit('click', { target: new Element('', { dataset: { [key]: id } }) }),
    clickAudit: async index => els.auditList.emit('click', { target: new Element('', { dataset: { restore: String(index) } }) })
  };
}

test('viewer reads per-set stats and share action but cannot open edit, delete or audit', async () => {
  const ui = await app({ session: viewer });
  assert.match(ui.els.historyMatches.innerHTML, /세트별 실제 라인업/);
  assert.doesNotMatch(ui.els.historyMatches.innerHTML, /data-edit-record|data-audit|data-delete-record/);
  assert.equal(ui.els.historyAuditBtn.hidden, true);
  await ui.clickRecord('editRecord'); await ui.clickRecord('audit'); await ui.clickRecord('deleteRecord');
  await ui.els.historyAuditBtn.emit('click');
  ui.els.deleteRecordReason.value = '위조 요청'; ui.els.deleteRecordConfirm.checked = true;
  await ui.els.deleteRecordForm.emit('submit');
  assert.equal(ui.els.deleteRecordDialog.open, false);
  assert.equal(ui.els.recordEditDialog.open, false); assert.equal(ui.els.auditDialog.open, false);
  assert.equal(ui.server.writes.length, 0);
  await ui.clickRecord('share'); assert.equal(ui.context.sharedId, ui.server.state.history[0].id);
});

test('admin must provide reason and review; save changes canonical record only after successful CAS', async () => {
  const ui = await app(); const originalDate = ui.server.state.history[0].date;
  await ui.clickRecord('editRecord');
  ui.els.editMatchDate.value = '2026-09-01';
  await ui.els.recordEditForm.emit('submit'); assert.equal(ui.server.writes.length, 0);
  await ui.els.previewRecordEdit.emit('click'); assert.match(ui.els.recordEditError.textContent, /변경 사유/);
  assert.equal(ui.server.state.history[0].date, originalDate);
  ui.els.editReason.value = '경기일 오입력 정정'; await ui.els.previewRecordEdit.emit('click');
  assert.equal(ui.els.saveRecordEdit.disabled, false);
  await ui.els.recordEditForm.emit('submit');
  assert.equal(ui.server.state.history[0].date, '2026-09-01');
  assert.equal(ui.server.writes[0].revision, 1); assert.equal(ui.server.writes[0].reason, '경기일 오입력 정정');
  assert.equal(ui.els.recordEditDialog.open, false);
});

test('duplicate lineup is rejected before saving and unknown statistics stay null', async () => {
  const ui = await app(); await ui.clickRecord('editRecord');
  const [first, second] = ui.rows(); second.fields.id.value = first.fields.id.value;
  ui.els.editReason.value = '라인업 정정'; await ui.els.previewRecordEdit.emit('click');
  assert.match(ui.els.recordEditError.textContent, /중복/); assert.equal(ui.els.saveRecordEdit.disabled, true);
  await ui.els.recordEditForm.emit('submit'); assert.equal(ui.server.writes.length, 0);
  assert.equal(ui.server.state.history[0].games[0].players[0].kills, null);
});

test('unsaved personal numbers follow player during a two-slot swap', async () => {
  const ui = await app(); await ui.clickRecord('editRecord');
  const first = ui.rows().find(row => row.dataset.game === '0' && row.dataset.team === '0' && row.dataset.role === 'top');
  const second = ui.rows().find(row => row.dataset.game === '0' && row.dataset.team === '0' && row.dataset.role === 'mid');
  const firstId = first.fields.id.value; const secondId = second.fields.id.value;
  first.fields.kills.value = '8'; await ui.els.recordEditForm.emit('input', { target: first.fields.kills });
  second.fields.id.value = firstId; await ui.els.recordEditForm.emit('change', { target: second.fields.id });
  first.fields.id.value = secondId; await ui.els.recordEditForm.emit('change', { target: first.fields.id });
  assert.equal(String(second.fields.kills.value), '8');
  ui.els.editReason.value = '실제 라인업 및 킬 정정'; await ui.els.previewRecordEdit.emit('click');
  assert.equal(ui.els.recordEditError.textContent, ''); await ui.els.recordEditForm.emit('submit');
  const saved = ui.server.state.history[0].games[0];
  assert.equal(saved.players.find(player => player.id === firstId).kills, 8);
  assert.equal(saved.players.find(player => player.id === firstId).deaths, null);
  assert.equal(saved.draw.teams[0].find(slot => slot.id === firstId).role, 'mid');
});

test('CAS conflict refetches and closes draft, while network failure preserves input for retry', async () => {
  const ui = await app(); await ui.clickRecord('editRecord');
  ui.els.editMatchDate.value = '2026-09-01'; ui.els.editReason.value = '날짜 정정'; await ui.els.previewRecordEdit.emit('click');
  ui.server.fail = { status: 0 }; await ui.els.recordEditForm.emit('submit');
  assert.equal(ui.els.recordEditDialog.open, true); assert.equal(ui.els.editMatchDate.value, '2026-09-01');
  assert.match(ui.els.recordEditError.textContent, /저장하지 못했습니다/);
  ui.server.fail = null; ui.server.revision = 2; await ui.els.recordEditForm.emit('submit');
  assert.equal(ui.els.recordEditDialog.open, false);
  assert.match(ui.els.toast.textContent, /다른 관리자가 먼저 변경/);
  assert.notEqual(ui.server.state.history[0].date, '2026-09-01');
});

test('permission revocation denies draft and hides editing after refetch', async () => {
  const ui = await app(); await ui.clickRecord('editRecord');
  ui.els.editMatchDate.value = '2026-09-01'; ui.els.editReason.value = '날짜 정정'; await ui.els.previewRecordEdit.emit('click');
  ui.server.fail = { status: 403 }; ui.server.session = clone(viewer); await ui.els.recordEditForm.emit('submit');
  assert.equal(ui.els.recordEditDialog.open, false);
  assert.doesNotMatch(ui.els.historyMatches.innerHTML, /data-edit-record|data-audit/);
  assert.match(ui.els.toast.textContent, /관리자 권한/);
});

test('audit restore requires reason and submits selected prior snapshot with current revision', async () => {
  const ui = await app(); const before = clone(ui.server.state.history[0]); before.date = '2026-09-02';
  ui.server.audit = [{ id: 9, recordId: before.id, stateRevision: 1, actorName: '<관리자>', createdAt: new Date().toISOString(), reason: '<script>사유</script>', beforeRecord: before, afterRecord: clone(ui.server.state.history[0]) }];
  await ui.clickRecord('audit');
  assert.match(ui.els.auditList.innerHTML, /&lt;관리자&gt;/); assert.doesNotMatch(ui.els.auditList.innerHTML, /<script>/);
  await ui.clickAudit(0); await ui.els.restoreForm.emit('submit'); assert.equal(ui.server.writes.length, 0);
  ui.els.restoreReason.value = '이전 경기일 복구'; await ui.els.restoreForm.emit('submit');
  assert.equal(ui.server.state.history[0].date, '2026-09-02');
  assert.equal(ui.server.writes[0].reason, '이전 경기일 복구'); assert.equal(ui.server.writes[0].revision, 1);
});

test('an invalid extra set can be removed without passing result validation first', async () => {
  const ui = await app(); await ui.clickRecord('editRecord');
  await ui.els.addRecordSet.emit('click'); assert.equal(ui.rows().length, 30);
  ui.els.editReason.value = '확인'; await ui.els.previewRecordEdit.emit('click');
  assert.equal(ui.els.saveRecordEdit.disabled, true);
  await ui.els.editSets.emit('click', { target: { closest() { return true; } } });
  assert.equal(ui.rows().length, 20);
  assert.equal(ui.server.writes.length, 0);
});

test('delete requires explicit record confirmation and reason, resets mirrored current and saves with pinned revision', async () => {
  const ui = await app(); const removed = clone(ui.server.state.history[0]);
  await ui.clickRecord('deleteRecord');
  assert.equal(ui.els.deleteRecordDialog.open, true);
  assert.match(ui.els.deleteRecordPreview.innerHTML, new RegExp(removed.date));
  assert.match(ui.els.deleteRecordPreview.innerHTML, /2 : 0/);
  await ui.els.deleteRecordForm.emit('submit');
  assert.match(ui.els.deleteRecordError.textContent, /삭제 사유/);
  ui.els.deleteRecordReason.value = '중복 경기 삭제';
  await ui.els.deleteRecordForm.emit('submit');
  assert.match(ui.els.deleteRecordError.textContent, /내용을 확인/);
  assert.equal(ui.server.writes.length, 0);
  ui.els.deleteRecordConfirm.checked = true;
  await ui.els.deleteRecordForm.emit('submit');
  assert.equal(ui.server.writes.length, 1);
  assert.equal(ui.server.writes[0].revision, 1);
  assert.equal(ui.server.writes[0].reason, '중복 경기 삭제');
  assert.equal(ui.server.state.history.length, 0);
  assert.equal(ui.server.state.results.length, 0);
  assert.notEqual(ui.server.state.seriesId, removed.id);
  assert.equal(H.syncCurrent(ui.server.state).history.length, 0);
  assert.equal(ui.els.deleteRecordDialog.open, false);
});

test('delete cancellation sends no write, including a forged submit after closing', async () => {
  const ui = await app(); await ui.clickRecord('deleteRecord');
  ui.els.deleteRecordReason.value = '삭제 취소'; ui.els.deleteRecordConfirm.checked = true;
  await ui.closeDialog('deleteRecordDialog');
  await ui.els.deleteRecordForm.emit('submit');
  assert.equal(ui.server.writes.length, 0);
  assert.equal(ui.server.state.history.length, 1);
});

test('stale delete closes the confirmation and retains the newer record', async () => {
  const ui = await app(); await ui.clickRecord('deleteRecord');
  ui.els.deleteRecordReason.value = '경기 삭제'; ui.els.deleteRecordConfirm.checked = true;
  ui.server.revision = 2;
  await ui.els.deleteRecordForm.emit('submit');
  assert.equal(ui.server.state.history.length, 1);
  assert.equal(ui.els.deleteRecordDialog.open, false);
  assert.match(ui.els.toast.textContent, /다른 관리자가 먼저 변경/);
});

test('deleted records remain accessible through global audit and can be restored without an existing card', async () => {
  const previous = fixture(); const deleted = clone(previous.history[0]);
  const ui = await app({ state: H.removeSnapshot(previous, deleted.id) });
  ui.server.audit = [{ id: 10, recordId: deleted.id, stateRevision: 1, actorName: '관리자', createdAt: new Date().toISOString(), reason: '중복으로 오인', beforeRecord: deleted, afterRecord: null }];
  assert.equal(ui.els.historyAuditBtn.hidden, false);
  await ui.els.historyAuditBtn.emit('click');
  assert.equal(ui.server.lastAudit, undefined);
  assert.match(ui.els.auditList.innerHTML, /삭제된 기록 복구/);
  await ui.clickAudit(0);
  assert.equal(ui.els.restoreDialog.open, true);
  assert.match(ui.els.restorePreview.innerHTML, /삭제된 경기/);
  ui.els.restoreReason.value = '정상 경기 복구'; await ui.els.restoreForm.emit('submit');
  assert.equal(ui.server.state.history.length, 1);
  assert.equal(ui.server.state.history[0].id, deleted.id);
  assert.equal(ui.server.writes[0].reason, '정상 경기 복구');
  assert.equal(ui.server.state.results.length, 0);
});

test('record links open the exact saved set once, independently of a conflicting date filter', async () => {
  const state = fixture(); const record = state.history[0];
  const ui = await app({ state, session: viewer, search: `?record=${encodeURIComponent(record.id)}&game=2&date=2026-01-01` });
  assert.equal(ui.els.historyDate.value, record.date);
  assert.match(ui.els.historyMatches.innerHTML, /archive-lineup" open/);
  assert.match(ui.els.historyMatches.innerHTML, /snapshot-set is-linked-game/);
  assert.deepEqual(ui.scrollCalls, [`record-${record.id}-game-2`]);
  ui.server.revision += 1; await ui.els.historyRefreshBtn.emit('click');
  assert.equal(ui.scrollCalls.length, 1);
});

test('missing record and invalid set links report an error without jumping to an unrelated match', async () => {
  const state = fixture(); const record = state.history[0];
  const missing = await app({ state, search: '?record=nonexistent' });
  assert.equal(missing.els.historyLinkStatus.hidden, false);
  assert.match(missing.els.historyLinkStatus.textContent, /기록을 찾을 수 없습니다/);
  assert.equal(missing.scrollCalls.length, 0);
  const invalid = await app({ state, search: `?record=${encodeURIComponent(record.id)}&game=7` });
  assert.match(invalid.els.historyLinkStatus.textContent, /세트를 찾을 수 없습니다/);
  assert.equal(invalid.scrollCalls.length, 0);
});

test('historical nicknames display independently of current profile and survive unrelated record correction', async () => {
  const state = fixture();
  state.roster.find(player => player.id === 'injae').currentNickname = 'Current Injae#KR1';
  for (const game of state.games) game.players.find(player => player.id === 'injae').nicknameAtMatch = 'Past Injae#KR1';
  for (const game of state.history[0].games) game.players.find(player => player.id === 'injae').nicknameAtMatch = 'Past Injae#KR1';
  const ui = await app({ state });
  assert.match(ui.els.historyMatches.innerHTML, /당시 닉네임 · Past Injae#KR1/);
  assert.doesNotMatch(ui.els.historyMatches.innerHTML, /Current Injae/);
  await ui.clickRecord('editRecord');
  ui.els.editMatchDate.value = '2026-09-01'; ui.els.editReason.value = '경기일 정정';
  await ui.els.previewRecordEdit.emit('click'); await ui.els.recordEditForm.emit('submit');
  assert.equal(ui.server.writes.length, 1);
  for (const game of ui.server.state.history[0].games) assert.equal(game.players.find(player => player.id === 'injae').nicknameAtMatch, 'Past Injae#KR1');
});

test('unsaved nickname correction follows its player ID when slots are swapped', async () => {
  const ui = await app(); await ui.clickRecord('editRecord');
  const first = ui.rows().find(row => row.dataset.game === '0' && row.dataset.team === '0' && row.dataset.role === 'top');
  const second = ui.rows().find(row => row.dataset.game === '0' && row.dataset.team === '0' && row.dataset.role === 'mid');
  const firstId = first.fields.id.value; const secondId = second.fields.id.value;
  first.fields.nicknameAtMatch.value = '  First Player#KR1  '; await ui.els.recordEditForm.emit('input', { target: first.fields.nicknameAtMatch });
  second.fields.nicknameAtMatch.value = 'Second Player#KR2'; await ui.els.recordEditForm.emit('input', { target: second.fields.nicknameAtMatch });
  second.fields.id.value = firstId; await ui.els.recordEditForm.emit('change', { target: second.fields.id });
  first.fields.id.value = secondId; await ui.els.recordEditForm.emit('change', { target: first.fields.id });
  assert.equal(second.fields.nicknameAtMatch.value, '  First Player#KR1  ');
  assert.equal(first.fields.nicknameAtMatch.value, 'Second Player#KR2');
  ui.els.editReason.value = '당시 닉네임과 라인업 정정'; await ui.els.previewRecordEdit.emit('click');
  assert.equal(ui.els.recordEditError.textContent, ''); await ui.els.recordEditForm.emit('submit');
  const saved = ui.server.state.history[0].games[0];
  assert.equal(saved.players.find(player => player.id === firstId).nicknameAtMatch, '  First Player#KR1  ');
  assert.equal(saved.players.find(player => player.id === secondId).nicknameAtMatch, 'Second Player#KR2');
  assert.equal(saved.draw.teams[0].find(slot => slot.id === firstId).role, 'mid');
});

test('new sets clear copied historical nicknames and empty values stay null', async () => {
  const state = fixture();
  for (const game of state.games) for (const player of game.players) player.nicknameAtMatch = 'Nickname-' + player.id;
  for (const game of state.history[0].games) for (const player of game.players) player.nicknameAtMatch = 'Nickname-' + player.id;
  const ui = await app({ state }); await ui.clickRecord('editRecord');
  ui.els.editBestOf.value = '5';
  await ui.els.addRecordSet.emit('click');
  assert.ok(ui.rows().filter(row => row.dataset.game === '2').every(row => row.fields.nicknameAtMatch.value === ''));
  const old = ui.rows().find(row => row.dataset.game === '0');
  const oldId = old.fields.id.value; old.fields.nicknameAtMatch.value = '   ';
  ui.els.editReason.value = '세트 추가 및 미확인 닉네임 정정'; await ui.els.previewRecordEdit.emit('click');
  assert.equal(ui.els.recordEditError.textContent, ''); await ui.els.recordEditForm.emit('submit');
  const record = ui.server.state.history[0];
  assert.equal(record.games[0].players.find(player => player.id === oldId).nicknameAtMatch, null);
  assert.ok(record.games[2].players.every(player => player.nicknameAtMatch === null));
});

test('nickname corrections are explicit and escaped in the audit diff', async () => {
  const ui = await app(); const before = clone(ui.server.state.history[0]); const after = clone(before);
  before.games[0].players[0].nicknameAtMatch = 'Old#KR1';
  after.games[0].players[0].nicknameAtMatch = '<New>#KR1';
  ui.server.audit = [{ id: 11, recordId: before.id, stateRevision: 1, actorName: '관리자', createdAt: new Date().toISOString(), reason: '닉네임 정정', beforeRecord: before, afterRecord: after }];
  await ui.clickRecord('audit');
  assert.match(ui.els.auditList.innerHTML, /당시 닉네임: Old#KR1 → &lt;New&gt;#KR1/);
  assert.doesNotMatch(ui.els.auditList.innerHTML, /<New>/);
});


test('unrelated archive correction preserves the exact observed nickname including spaces and fullwidth characters', async () => {
  const state = fixture();
  const observed = '  VisibleＮame#KR1  ';
  for (const game of state.games) game.players.find(player => player.id === 'injae').nicknameAtMatch = observed;
  for (const game of state.history[0].games) game.players.find(player => player.id === 'injae').nicknameAtMatch = observed;
  const ui = await app({ state }); await ui.clickRecord('editRecord');
  for (const row of ui.rows().filter(row => row.fields.id.value === 'injae')) assert.equal(row.fields.nicknameAtMatch.value, observed);
  ui.els.editMatchDate.value = '2026-09-12'; ui.els.editReason.value = '경기 날짜 정정';
  await ui.els.previewRecordEdit.emit('click');
  assert.equal(ui.els.recordEditError.textContent, ''); await ui.els.recordEditForm.emit('submit');
  assert.equal(ui.server.writes.length, 1);
  for (const game of ui.server.state.games.concat(ui.server.state.history[0].games)) assert.equal(game.players.find(player => player.id === 'injae').nicknameAtMatch, observed);
});
