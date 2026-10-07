import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import C from "../domain/core.cjs";
import H from "../domain/history-core.cjs";
import { createBackend, MAX_BODY_BYTES, MAX_STATE_BYTES, canonicalState } from "../lib/server-core.mjs";

const origin = "https://lol.example.chatgpt.site";
const owner = { userId: "owner-id", email: "owner@example.com", fullName: "소유자" };
const admin = { userId: "admin-id", email: "admin@example.com", fullName: "관리자" };
const viewer = { userId: "viewer-id", email: "viewer@example.com" };

function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE site_settings (key TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE admin_grants (email TEXT PRIMARY KEY, user_id TEXT UNIQUE, created_at TEXT NOT NULL);
    CREATE TABLE shared_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL, mutation_id TEXT NOT NULL DEFAULT 'legacy');
    CREATE TABLE record_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, state_revision INTEGER NOT NULL, record_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, created_at TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, before_record TEXT, after_record TEXT);
  `);
  let batchQueue = Promise.resolve();
  const db = {
    before: null,
    async batch(statements) {
      // Match D1's serialized, all-or-nothing batch behavior. Plain statement
      // hooks remain available to reproduce permission revocation races.
      const previous = batchQueue;
      let release;
      batchQueue = new Promise(resolve => { release = resolve; });
      await previous;
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      } finally { release(); }
    },
    prepare(query) {
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async first() {
          if (db.before) await db.before(query, args);
          return sql.prepare(query).get(...args) || null;
        },
        async run() {
          if (db.before) await db.before(query, args);
          const result = sql.prepare(query).run(...args);
          return { success: true, meta: { changes: result.changes } };
        },
        async all() {
          if (db.before) await db.before(query, args);
          return { results: sql.prepare(query).all(...args) };
        },
      };
      return statement;
    },
  };
  const api = (user, config = {}) => createBackend({ getEnvironment: () => ({ db, ownerEmail: "owner@example.com", ...config }), getUser: async () => user, now: () => "2026-10-07T09:30:00.000Z" });
  return { sql, db, api };
}

function request(body, method = "PUT", headers = {}) {
  return new Request(`${origin}/api/state`, { method, headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: JSON.stringify(body) });
}
function state() { return H.upgrade(C.createDefaultState()); }
async function expectStatus(response, status) {
  assert.equal(response.status, status, JSON.stringify(await response.clone().json()));
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  return response.json();
}
async function grant(f, person = admin) {
  await expectStatus(await f.api(owner).session(), 200);
  await expectStatus(await f.api(owner).addAdmin(request({ email: person.email }, "POST")), 201);
}

test("public reads never initialize data, and anonymous/viewer writes are denied", async () => {
  const f = fixture();
  assert.deepEqual(await expectStatus(await f.api(null).getState(), 200), { state: null, revision: 0 });
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM shared_state").get().n, 0);
  const session = await expectStatus(await f.api(null).session(), 200);
  assert.deepEqual(session, { user: null, role: "viewer", canEdit: false, canManageAdmins: false });
  await expectStatus(await f.api(null).putState(request({ state: state(), expectedRevision: 0, role: "owner" })), 401);
  await expectStatus(await f.api(viewer).putState(request({ state: state(), expectedRevision: 0, canEdit: true })), 403);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM shared_state").get().n, 0);
});

test("owner bootstrap requires exact normalized email and permanently binds stable ID", async () => {
  const f = fixture();
  const similar = { userId: "impostor", email: "owner+suffix@example.com" };
  assert.equal((await expectStatus(await f.api(similar).session(), 200)).role, "viewer");
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM site_settings").get().n, 0);
  assert.equal((await expectStatus(await f.api({ ...owner, email: " OWNER@EXAMPLE.COM " }).session(), 200)).role, "owner");
  assert.equal((await expectStatus(await f.api({ ...owner, email: "changed@example.com" }, { ownerEmail: "other@example.com" }).session(), 200)).role, "owner");
  assert.equal((await expectStatus(await f.api({ userId: "second-owner-id", email: owner.email }).session(), 200)).role, "viewer");
  assert.equal((await expectStatus(await f.api({ userId: "third-id", email: "other@example.com" }, { ownerEmail: "other@example.com" }).session(), 200)).role, "viewer");
});

test("concurrent owner bootstrap grants exactly one stable user ID", async () => {
  const f = fixture();
  const sessions = await Promise.all([f.api(owner).session(), f.api({ ...owner, userId: "other-id" }).session()]);
  const roles = await Promise.all(sessions.map(response => response.json()));
  assert.equal(roles.filter(value => value.role === "owner").length, 1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM site_settings").get().n, 1);
});

test("only owner manages pending admins; grant binds once then uses stable ID", async () => {
  const f = fixture();
  await expectStatus(await f.api(viewer).getAdmins(), 403);
  await expectStatus(await f.api(null).getAdmins(), 401);
  await grant(f);
  const before = await expectStatus(await f.api(owner).getAdmins(), 200);
  assert.equal(before.admins[0].userId, null);
  assert.equal(before.owner.userId, owner.userId);
  assert.equal((await expectStatus(await f.api(admin).session(), 200)).role, "admin");
  assert.equal((await expectStatus(await f.api({ ...admin, email: "new-address@example.com" }).session(), 200)).role, "admin");
  assert.equal((await expectStatus(await f.api({ ...admin, userId: "second-admin-id" }).session(), 200)).role, "viewer");
  await expectStatus(await f.api(admin).getAdmins(), 403);
  await expectStatus(await f.api(admin).addAdmin(request({ email: viewer.email }, "POST")), 403);
  await expectStatus(await f.api(owner).addAdmin(request({ email: admin.email }, "POST")), 409);
  await expectStatus(await f.api(owner).addAdmin(request({ email: owner.email }, "POST")), 400);
  for (const email of ["Display Name <x@example.com>", "x@example.com, y@example.com", "x..y@example.com", "bad", { email: "x@example.com" }]) {
    await expectStatus(await f.api(owner).addAdmin(request({ email }, "POST")), 400);
  }
});

test("revocation prevents rebinding and denies the former admin immediately", async () => {
  const f = fixture();
  await grant(f);
  assert.equal((await expectStatus(await f.api(admin).session(), 200)).role, "admin");
  await expectStatus(await f.api(owner).removeAdmin(request({ email: admin.email }, "DELETE")), 200);
  assert.equal((await expectStatus(await f.api(admin).session(), 200)).role, "viewer");
  await expectStatus(await f.api(admin).putState(request({ state: state(), expectedRevision: 0 })), 403);
  await expectStatus(await f.api(owner).removeAdmin(request({ email: admin.email }, "DELETE")), 404);
});

test("exact origin and JSON are mandatory for every mutation", async () => {
  const f = fixture();
  const payload = { state: state(), expectedRevision: 0 };
  const absent = request(payload);
  absent.headers.delete("Origin");
  await expectStatus(await f.api(owner).putState(absent), 403);
  await expectStatus(await f.api(owner).putState(request(payload, "PUT", { Origin: "https://attacker.example.com" })), 403);
  await expectStatus(await f.api(owner).putState(request(payload, "PUT", { Origin: `${origin}/` })), 403);
  await expectStatus(await f.api(owner).putState(request(payload, "PUT", { "Content-Type": "text/plain" })), 415);
  await expectStatus(await f.api(owner).addAdmin(request({ email: admin.email }, "POST", { Origin: "null" })), 403);
  await expectStatus(await f.api(owner).removeAdmin(request({ email: admin.email }, "DELETE", { Origin: "https://attacker.example.com" })), 403);
  await expectStatus(await f.api(owner).putState(request(payload, "PUT", { "Content-Length": String(MAX_BODY_BYTES + 1) })), 413);
});

test("a bounded streaming body rejects oversized requests without trusting content-length", async () => {
  const f = fixture();
  const oversized = request({ state: state(), expectedRevision: 0, padding: "x".repeat(MAX_BODY_BYTES) });
  await expectStatus(await f.api(owner).putState(oversized), 413);
});

test("CAS permits one first save and one concurrent revision update, rejecting stale writes", async () => {
  const f = fixture();
  const first = await Promise.all([f.api(owner).putState(request({ state: state(), expectedRevision: 0 })), f.api(owner).putState(request({ state: state(), expectedRevision: 0 }))]);
  assert.deepEqual(first.map(response => response.status).sort(), [200, 409]);
  const next = state();
  next.bestOf = 5;
  const competing = state();
  competing.bestOf = 7;
  const second = await Promise.all([f.api(owner).putState(request({ state: next, expectedRevision: 1 })), f.api(owner).putState(request({ state: competing, expectedRevision: 1 }))]);
  assert.deepEqual(second.map(response => response.status).sort(), [200, 409]);
  const row = f.sql.prepare("SELECT * FROM shared_state WHERE id = 1").get();
  assert.equal(row.revision, 2);
  assert.equal(row.updated_by, owner.userId);
  assert.equal(row.updated_at, "2026-10-07T09:30:00.000Z");
  assert.equal((await expectStatus(await f.api(viewer).getState(), 200)).revision, 2);
  await expectStatus(await f.api(owner).putState(request({ state: next, expectedRevision: 0 })), 409);
  for (const expectedRevision of [-1, 0.1, "2", Number.MAX_SAFE_INTEGER]) await expectStatus(await f.api(owner).putState(request({ state: next, expectedRevision })), 400);
});

test("revocation racing an already-authorized write is rechecked inside the CAS SQL", async () => {
  const f = fixture();
  await grant(f);
  await expectStatus(await f.api(owner).putState(request({ state: state(), expectedRevision: 0 })), 200);
  f.db.before = async query => {
    if (query.startsWith("UPDATE shared_state")) {
      f.db.before = null;
      f.sql.prepare("DELETE FROM admin_grants WHERE email = ?").run(admin.email);
    }
  };
  await expectStatus(await f.api(admin).putState(request({ state: state(), expectedRevision: 1 })), 403);
  assert.equal(f.sql.prepare("SELECT revision FROM shared_state").get().revision, 1);
});

test("canonical state removes unknown authorization fields and archives save atomically", async () => {
  const f = fixture();
  let current = state();
  current.draw = C.makeTeams(current.roster);
  current.drawNumber = 1;
  current = H.recordGame(H.recordGame(current, 0), 0);
  current.role = "owner";
  current.admins = [viewer.email];
  current.roster[0].canEdit = true;
  current.history[0].ownerId = "spoof";
  const saved = await expectStatus(await f.api(owner).putState(request({ state: current, expectedRevision: 0 })), 200);
  assert.equal(saved.state.role, undefined);
  assert.equal(saved.state.admins, undefined);
  assert.equal(saved.state.roster[0].canEdit, undefined);
  assert.equal(saved.state.history[0].ownerId, undefined);
  assert.equal(saved.state.history.length, 1);
  assert.equal(saved.state.history[0].results.length, 2);
  const undo = H.undoGame(saved.state);
  const undone = await expectStatus(await f.api(owner).putState(request({ state: undo, expectedRevision: 1 })), 200);
  assert.equal(undone.state.history.length, 0);
  assert.equal(undone.state.results.length, 1);
  const invalid = state();
  invalid.roster.push({ ...invalid.roster[0], id: "extra", active: false });
  await expectStatus(await f.api(owner).putState(request({ state: invalid, expectedRevision: 2 })), 400);
});

test("oversized canonical archives fail before database writes", async () => {
  let current = state();
  current.draw = C.makeTeams(current.roster);
  current.drawNumber = 1;
  current = H.recordGame(H.recordGame(current, 0), 0);
  const snapshot = current.history[0];
  current.history = Array.from({ length: 1000 }, (_, index) => ({ ...snapshot, id: `archive-${index}` }));
  assert.ok(new TextEncoder().encode(JSON.stringify(current)).length > MAX_STATE_BYTES);
  assert.throws(() => canonicalState(current), error => error.status === 413 && error.code === "state_too_large");
});

test("missing database or owner configuration fails closed with 503", async () => {
  const f = fixture();
  await expectStatus(await f.api(owner, { db: undefined }).session(), 503);
  await expectStatus(await f.api(owner, { ownerEmail: undefined }).putState(request({ state: state(), expectedRevision: 0 })), 503);
});

function completedState() {
  let current = state();
  current.draw = C.makeTeams(current.roster);
  current.drawNumber = 1;
  return H.recordGame(H.recordGame(current, 0), 0);
}

test("archive audit records trusted actor and before/after changes for every save path", async () => {
  const f = fixture();
  const original = completedState();
  const body = { state: original, expectedRevision: 0, reason: "  결과 JSON 등록  ", actorId: "forged", actorName: "forged", createdAt: "1900-01-01", audit: [{ action: "forged" }] };
  const initial = await expectStatus(await f.api(owner).putState(request(body)), 200);
  const first = (await expectStatus(await f.api(owner).getAudit(), 200)).entries;
  assert.equal(first.length, 1);
  assert.equal(first[0].action, "add");
  assert.equal(first[0].actorId, owner.userId);
  assert.equal(first[0].actorName, owner.fullName);
  assert.equal(first[0].createdAt, "2026-10-07T09:30:00.000Z");
  assert.equal(first[0].stateRevision, 1);
  assert.equal(first[0].reason, "결과 JSON 등록");
  assert.equal(first[0].beforeRecord, null);
  assert.deepEqual(first[0].afterRecord, initial.state.history[0]);

  // A normal state re-save creates no fake archive edit. State still advances
  // a revision for the normal concurrent-editor contract.
  await expectStatus(await f.api(owner).putState(request({ state: initial.state, expectedRevision: 1 })), 200);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM record_audit").get().n, 1);
  await grant(f);
  const changed = H.upgrade(initial.state);
  changed.history[0].date = "2026-10-06";
  const edited = await expectStatus(await f.api(admin).putState(request({ state: changed, expectedRevision: 2, reason: "경기일 오입력 정정" })), 200);
  const second = (await expectStatus(await f.api(admin).getAudit(), 200)).entries;
  assert.equal(second[0].action, "update");
  assert.equal(second[0].actorId, admin.userId);
  assert.equal(second[0].actorName, admin.fullName);
  assert.equal(second[0].stateRevision, 3);
  assert.deepEqual(second[0].beforeRecord, initial.state.history[0]);
  assert.deepEqual(second[0].afterRecord, edited.state.history[0]);

  const removed = H.upgrade(edited.state);
  removed.history = [];
  await expectStatus(await f.api(admin).putState(request({ state: removed, expectedRevision: 3, reason: "잘못 등록된 기록 제거" })), 200);
  const third = (await expectStatus(await f.api(owner).getAudit(), 200)).entries;
  assert.equal(third[0].action, "remove");
  assert.deepEqual(third[0].beforeRecord, edited.state.history[0]);
  assert.equal(third[0].afterRecord, null);
});

test("audit reads require a current admin role and filter to one record", async () => {
  const f = fixture();
  await expectStatus(await f.api(null).getAudit(), 401);
  await expectStatus(await f.api(viewer).getAudit(), 403);
  const current = completedState();
  const extra = H.cloneSnapshot(current.history[0]);
  extra.id = "second-match";
  current.history.push(extra);
  await expectStatus(await f.api(owner).putState(request({ state: current, expectedRevision: 0 })), 200);
  const one = await expectStatus(await f.api(owner).getAudit(new Request(`${origin}/api/audit?recordId=second-match`)), 200);
  assert.equal(one.entries.length, 1);
  assert.equal(one.entries[0].recordId, "second-match");
  const missing = await expectStatus(await f.api(owner).getAudit(new Request(`${origin}/api/audit?recordId=missing`)), 200);
  assert.deepEqual(missing.entries, []);
  await expectStatus(await f.api(owner).getAudit(new Request(`${origin}/api/audit?recordId=`)), 400);
  await expectStatus(await f.api(owner).getAudit(new Request(`${origin}/api/audit?recordId=${"x".repeat(101)}`)), 400);
  await grant(f);
  await expectStatus(await f.api(admin).getAudit(), 200);
  await expectStatus(await f.api(owner).removeAdmin(request({ email: admin.email }, "DELETE")), 200);
  await expectStatus(await f.api(admin).getAudit(), 403);
});

test("audit failures roll back the saved state and revision", async () => {
  const f = fixture();
  const initial = await expectStatus(await f.api(owner).putState(request({ state: state(), expectedRevision: 0 })), 200);
  f.sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON record_audit BEGIN SELECT RAISE(ABORT, 'audit storage unavailable'); END");
  const failing = completedState();
  const result = await expectStatus(await f.api(owner).putState(request({ state: failing, expectedRevision: 1 })), 503);
  assert.equal(result.error, "service_unavailable");
  const saved = await expectStatus(await f.api(owner).getState(), 200);
  assert.deepEqual(saved, initial);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM record_audit").get().n, 0);
});

test("stale and concurrent archive saves cannot leave orphan audit records", async () => {
  const f = fixture();
  await expectStatus(await f.api(owner).putState(request({ state: state(), expectedRevision: 0 })), 200);
  const a = completedState();
  const b = completedState();
  const responses = await Promise.all([
    f.api(owner).putState(request({ state: a, expectedRevision: 1, reason: "관리자 A 저장" })),
    f.api(owner).putState(request({ state: b, expectedRevision: 1, reason: "관리자 B 저장" })),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const saved = await expectStatus(await f.api(owner).getState(), 200);
  const entries = (await expectStatus(await f.api(owner).getAudit(), 200)).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].recordId, saved.state.history[0].id);
  assert.equal(entries[0].stateRevision, 2);
  await expectStatus(await f.api(owner).putState(request({ state: b, expectedRevision: 1 })), 409);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM record_audit").get().n, 1);
});

test("restoring an earlier archive revision is itself audited and synchronizes the active series", async () => {
  const f = fixture();
  const first = await expectStatus(await f.api(owner).putState(request({ state: completedState(), expectedRevision: 0 })), 200);
  const editedRecord = H.cloneSnapshot(first.state.history[0]);
  editedRecord.date = "2026-10-06";
  const edited = H.replaceSnapshot(first.state, editedRecord);
  const second = await expectStatus(await f.api(owner).putState(request({ state: edited, expectedRevision: 1, reason: "날짜 정정" })), 200);
  const audit = (await expectStatus(await f.api(owner).getAudit(), 200)).entries[0];
  const restored = H.replaceSnapshot(second.state, audit.beforeRecord);
  const third = await expectStatus(await f.api(owner).putState(request({ state: restored, expectedRevision: 2, reason: "이전 기록으로 복구" })), 200);
  assert.equal(third.state.matchDate, first.state.matchDate);
  assert.deepEqual(third.state.history, first.state.history);
  const latest = (await expectStatus(await f.api(owner).getAudit(), 200)).entries[0];
  assert.equal(latest.reason, "이전 기록으로 복구");
  assert.deepEqual(latest.beforeRecord, second.state.history[0]);
  assert.deepEqual(latest.afterRecord, first.state.history[0]);
});

test("audit list is newest first and limited to 50, and reasons cannot bypass validation", async () => {
  const f = fixture();
  const initial = completedState();
  await expectStatus(await f.api(owner).putState(request({ state: initial, expectedRevision: 0 })), 200);
  const insert = f.sql.prepare("INSERT INTO record_audit (state_revision, record_id, actor_id, actor_name, created_at, action, reason, before_record, after_record) VALUES (1, ?, 'owner-id', '소유자', '2026-10-07T09:30:00.000Z', 'update', 'test', NULL, NULL)");
  for (let i = 0; i < 55; i += 1) insert.run(`test-${i}`);
  const entries = (await expectStatus(await f.api(owner).getAudit(), 200)).entries;
  assert.equal(entries.length, 50);
  assert.equal(entries[0].recordId, "test-54");
  assert.equal(entries[49].recordId, "test-5");
  for (const reason of ["", " ", "x".repeat(301), {}, "hidden\u0000reason"]) {
    await expectStatus(await f.api(owner).putState(request({ state: initial, expectedRevision: 1, reason })), 400);
  }
  assert.equal((await expectStatus(await f.api(owner).getState(), 200)).revision, 1);
});
