import H from "../domain/history-core.cjs";

export const MAX_BODY_BYTES = 10 * 1024 * 1024;
export const MAX_STATE_BYTES = 1536 * 1024;
const encoder = new TextEncoder();

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) { throw new ApiError(status, code, message); }

export function json(value, status = 200) {
  return Response.json(value, { status, headers: {
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "Vary": "Cookie",
    "X-Content-Type-Options": "nosniff",
  } });
}

export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)) return null;
  const [local, domain] = email.split("@");
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..") || domain.split(".").some(part => part.length > 63)) return null;
  return email;
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) {
    fail(403, "origin_denied", "사이트 안에서 다시 시도해주세요.");
  }
}

export async function readJson(request) {
  assertSameOrigin(request);
  const type = (request.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json") fail(415, "json_required", "JSON 형식이 필요합니다.");
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    fail(413, "body_too_large", "요청 데이터가 너무 큽니다.");
  }
  if (!request.body) fail(400, "invalid_json", "요청 내용이 비어 있습니다.");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        fail(413, "body_too_large", "요청 데이터가 너무 큽니다.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value;
  } catch { fail(400, "invalid_json", "요청 데이터가 올바르지 않습니다."); }
}

export function canonicalState(raw) {
  let state;
  try {
    state = H.upgrade(raw);
    if (!H.validate(state) || state.roster.length !== 10 || state.history.some(item => item.roster.length !== 10)) throw new Error("invalid state");
  } catch { fail(400, "invalid_state", "참가자 10명, 팀 편성, 경기 결과와 기록을 확인해주세요."); }
  // H.upgrade whitelists known fields at every level. Authorization metadata
  // supplied by a client is never stored or read as part of the match state.
  const payload = JSON.stringify(state);
  if (encoder.encode(payload).byteLength > MAX_STATE_BYTES) {
    fail(413, "state_too_large", "전체 기록이 저장 한도(1.5MB)에 도달했습니다. 백업 후 오래된 기록을 정리해주세요.");
  }
  return { state, payload };
}

function authenticatedUser(raw) {
  if (!raw || typeof raw.userId !== "string" || !raw.userId || raw.userId.length > 256) return null;
  const email = normalizeEmail(raw.email);
  if (!email) return null;
  return { id: raw.userId, email, name: raw.fullName || raw.displayName || email };
}

const authorizationSql = `(EXISTS (SELECT 1 FROM site_settings WHERE key = 'owner' AND user_id = ?) OR EXISTS (SELECT 1 FROM admin_grants WHERE user_id = ?))`;

// Both sets contain canonical archive JSON. The mutation token makes this
// conditional on the preceding CAS succeeding in this exact transaction.
// JSON table joins keep large backup imports within D1's binding/query limits.
const auditChangesSql = `
  WITH previous AS (
    SELECT json_extract(value, '$.id') AS record_id, value AS record
    FROM json_each(?, '$.history')
  ), current AS (
    SELECT json_extract(value, '$.id') AS record_id, value AS record
    FROM shared_state, json_each(shared_state.payload, '$.history')
    WHERE shared_state.id = 1 AND shared_state.mutation_id = ?
  ), changes AS (
    SELECT current.record_id, previous.record AS before_record, current.record AS after_record,
      CASE WHEN previous.record_id IS NULL THEN 'add' ELSE 'update' END AS action
    FROM current LEFT JOIN previous ON previous.record_id = current.record_id
    WHERE previous.record_id IS NULL OR previous.record != current.record
    UNION ALL
    SELECT previous.record_id, previous.record, NULL, 'remove'
    FROM previous WHERE NOT EXISTS (SELECT 1 FROM current WHERE current.record_id = previous.record_id)
  )
  INSERT INTO record_audit (state_revision, record_id, actor_id, actor_name, created_at, action, reason, before_record, after_record)
  SELECT ?, record_id, ?, ?, ?, action, ?, before_record, after_record FROM changes
  WHERE EXISTS (SELECT 1 FROM shared_state WHERE id = 1 AND mutation_id = ?)`;

/** Dependencies are injected so the same authorization and SQL run in tests. */
export function createBackend({ getEnvironment, getUser, now = () => new Date().toISOString() }) {
  function environment() {
    const environment = getEnvironment();
    if (!environment?.db) fail(503, "database_unavailable", "공유 저장소 연결을 준비하고 있습니다. 잠시 후 다시 시도해주세요.");
    const ownerEmail = normalizeEmail(environment.ownerEmail);
    if (!ownerEmail) fail(503, "owner_unconfigured", "관리자 계정 설정을 준비하고 있습니다.");
    return { db: environment.db, ownerEmail };
  }

  async function identity(db, ownerEmail) {
    const user = authenticatedUser(await getUser());
    if (!user) return { user: null, role: "viewer", canEdit: false, canManageAdmins: false };

    let owner = await db.prepare("SELECT user_id AS userId, email FROM site_settings WHERE key = 'owner'").first();
    if (!owner && user.email === ownerEmail) {
      await db.prepare("INSERT INTO site_settings (key, user_id, email, created_at) VALUES ('owner', ?, ?, ?) ON CONFLICT(key) DO NOTHING")
        .bind(user.id, user.email, now()).run();
      owner = await db.prepare("SELECT user_id AS userId, email FROM site_settings WHERE key = 'owner'").first();
    }
    if (owner?.userId === user.id) return { user, role: "owner", canEdit: true, canManageAdmins: true };

    // A grant binds once. Reusing the email with a different authenticated ID
    // after binding cannot take over that grant.
    let grant = await db.prepare("SELECT user_id AS userId FROM admin_grants WHERE user_id = ?").bind(user.id).first();
    if (!grant) {
      await db.prepare("UPDATE admin_grants SET user_id = ? WHERE email = ? AND user_id IS NULL AND NOT EXISTS (SELECT 1 FROM admin_grants WHERE user_id = ?)")
        .bind(user.id, user.email, user.id).run();
      grant = await db.prepare("SELECT user_id AS userId FROM admin_grants WHERE user_id = ?").bind(user.id).first();
    }
    const isAdmin = Boolean(grant);
    return { user, role: isAdmin ? "admin" : "viewer", canEdit: isAdmin, canManageAdmins: false };
  }

  async function requireRole(db, ownerEmail, ownerOnly = false) {
    const session = await identity(db, ownerEmail);
    if (!session.user) fail(401, "authentication_required", "ChatGPT로 로그인해주세요.");
    if (ownerOnly ? !session.canManageAdmins : !session.canEdit) {
      fail(403, "permission_denied", ownerOnly ? "사이트 소유자만 관리자를 변경할 수 있습니다." : "관리자만 경기 내용을 변경할 수 있습니다.");
    }
    return session;
  }

  async function session() {
    const { db, ownerEmail } = environment();
    return json(await identity(db, ownerEmail));
  }

  async function getState() {
    const { db } = environment();
    const row = await db.prepare("SELECT payload, revision FROM shared_state WHERE id = 1").first();
    if (!row) return json({ state: null, revision: 0 });
    // Parse-and-upgrade also ensures legacy rows cannot leak unexpected fields.
    const { state } = canonicalState(JSON.parse(row.payload));
    return json({ state, revision: row.revision });
  }

  async function putState(request) {
    assertSameOrigin(request);
    const { db, ownerEmail } = environment();
    const session = await requireRole(db, ownerEmail);
    const body = await readJson(request);
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision >= Number.MAX_SAFE_INTEGER) {
      fail(400, "invalid_revision", "저장 버전 정보가 올바르지 않습니다.");
    }
    const { state, payload } = canonicalState(body.state);
    let reason = "경기 기록 저장";
    if (body.reason !== undefined) {
      if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 300 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.reason)) {
        fail(400, "invalid_reason", "변경 사유는 1~300자로 입력해주세요.");
      }
      reason = body.reason.trim();
    }
    const userId = session.user.id;
    const actorName = typeof session.user.name === "string" ? session.user.name.trim().slice(0, 200) || session.user.email : session.user.email;
    const timestamp = now();
    const mutationId = crypto.randomUUID();
    // This read supplies the before image only. CAS below still guards against
    // another save or a revocation between this read and the transaction.
    const previous = await db.prepare("SELECT payload, revision FROM shared_state WHERE id = 1").first();
    if ((previous?.revision || 0) !== body.expectedRevision) {
      fail(409, "revision_conflict", "다른 관리자가 먼저 저장했습니다. 최신 내용을 불러온 뒤 다시 시도해주세요.");
    }
    const beforePayload = previous ? canonicalState(JSON.parse(previous.payload)).payload : '{"history":[]}';
    let mutation;
    if (body.expectedRevision === 0) {
      mutation = db.prepare(`INSERT INTO shared_state (id, payload, revision, updated_by, updated_at, mutation_id) SELECT 1, ?, 1, ?, ?, ? WHERE ${authorizationSql} ON CONFLICT(id) DO NOTHING RETURNING revision`)
        .bind(payload, userId, timestamp, mutationId, userId, userId);
    } else {
      mutation = db.prepare(`UPDATE shared_state SET payload = ?, revision = revision + 1, updated_by = ?, updated_at = ?, mutation_id = ? WHERE id = 1 AND revision = ? AND ${authorizationSql} RETURNING revision`)
        .bind(payload, userId, timestamp, mutationId, body.expectedRevision, userId, userId);
    }
    // D1 batch is transactional: any audit insertion failure rolls the state
    // mutation back, and a failed CAS cannot create a misleading audit entry.
    const results = await db.batch([
      mutation,
      db.prepare(auditChangesSql).bind(beforePayload, mutationId, body.expectedRevision + 1, userId, actorName, timestamp, reason, mutationId),
    ]);
    const saved = results[0]?.results?.[0];
    if (!saved) {
      // Recheck permission for accurate revocation feedback. The SQL itself
      // already guarded against revocation racing the initial role check.
      const allowed = await db.prepare(`SELECT 1 AS allowed WHERE ${authorizationSql}`).bind(userId, userId).first();
      if (!allowed) fail(403, "permission_denied", "관리자 권한이 해제되었습니다. 내용을 다시 불러와주세요.");
      fail(409, "revision_conflict", "다른 관리자가 먼저 저장했습니다. 최신 내용을 불러온 뒤 다시 시도해주세요.");
    }
    return json({ state, revision: saved.revision });
  }

  async function getAudit(request) {
    const { db, ownerEmail } = environment();
    await requireRole(db, ownerEmail);
    const recordId = request ? new URL(request.url).searchParams.get("recordId") : null;
    if (recordId !== null && (!recordId.trim() || recordId.length > 100 || /[\u0000-\u001f\u007f]/.test(recordId))) {
      fail(400, "invalid_record_id", "경기 기록을 다시 선택해주세요.");
    }
    const query = `SELECT id, state_revision AS stateRevision, record_id AS recordId, actor_id AS actorId,
      actor_name AS actorName, created_at AS createdAt, action, reason,
      before_record AS beforeRecord, after_record AS afterRecord
      FROM record_audit ${recordId === null ? "" : "WHERE record_id = ?"} ORDER BY id DESC LIMIT 50`;
    const statement = db.prepare(query);
    const rows = await (recordId === null ? statement : statement.bind(recordId)).all();
    return json({ entries: (rows.results || []).map(row => ({
      ...row,
      beforeRecord: row.beforeRecord === null ? null : JSON.parse(row.beforeRecord),
      afterRecord: row.afterRecord === null ? null : JSON.parse(row.afterRecord),
    })) });
  }

  async function getAdmins() {
    const { db, ownerEmail } = environment();
    await requireRole(db, ownerEmail, true);
    const owner = await db.prepare("SELECT user_id AS userId, email FROM site_settings WHERE key = 'owner'").first();
    const rows = await db.prepare("SELECT email, user_id AS userId, created_at AS createdAt FROM admin_grants ORDER BY created_at, email").all();
    return json({ owner, admins: rows.results || [] });
  }

  async function mutateAdmins(request, remove) {
    assertSameOrigin(request);
    const { db, ownerEmail } = environment();
    await requireRole(db, ownerEmail, true);
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    if (!email) fail(400, "invalid_email", "ChatGPT 계정 이메일을 정확히 입력해주세요.");
    const owner = await db.prepare("SELECT user_id AS userId, email FROM site_settings WHERE key = 'owner'").first();
    if (email === owner.email || email === ownerEmail) fail(400, "owner_is_permanent", "소유자는 기본 관리자이며 변경할 수 없습니다.");
    if (remove) {
      const removed = await db.prepare("DELETE FROM admin_grants WHERE email = ? RETURNING email").bind(email).first();
      if (!removed) fail(404, "admin_not_found", "해당 관리자 등록을 찾을 수 없습니다.");
      return json({ removed: email });
    }
    const createdAt = now();
    const added = await db.prepare("INSERT INTO admin_grants (email, user_id, created_at) VALUES (?, NULL, ?) ON CONFLICT(email) DO NOTHING RETURNING email, user_id AS userId, created_at AS createdAt")
      .bind(email, createdAt).first();
    if (!added) fail(409, "admin_already_exists", "이미 등록된 관리자입니다.");
    return json({ admin: added }, 201);
  }

  // Operational details and SQL exceptions are never returned to a browser.
  function endpoint(fn) {
    return async (...args) => {
      try { return await fn(...args); }
      catch (error) {
        if (error instanceof ApiError) return json({ error: error.code, message: error.message }, error.status);
        console.error("Site API request failed", error instanceof Error ? error.message : "unknown error");
        return json({ error: "service_unavailable", message: "공유 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해주세요." }, 503);
      }
    };
  }
  return {
    session: endpoint(session),
    getState: endpoint(getState),
    putState: endpoint(putState),
    getAudit: endpoint(getAudit),
    getAdmins: endpoint(getAdmins),
    addAdmin: endpoint(request => mutateAdmins(request, false)),
    removeAdmin: endpoint(request => mutateAdmins(request, true)),
  };
}
