import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDeliveryAdapter, createSqliteDeliveryStore, deliveryPayloadHash } from "../lib/customer-delivery.ts";

const env = {
  SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_USER: "sender@example.test", SMTP_PASS: "fake-test-password", MAIL_FROM: "sender@example.test",
  GHOST_ADMIN_URL: "https://ghost.example.test", GHOST_ADMIN_API_KEY: `${"a".repeat(24)}:${"b".repeat(64)}`,
};
function request(channel = "email", payload = channel === "email" ? { to: "customer@example.test", subject: "Approved test", text: "Synthetic body" } : { title: "Approved article", html: "<p>Synthetic article only.</p>" }) {
  return { id: "outbox-test-1", idempotencyKey: "outbox-stable-test-key", channel, payload, payloadHash: deliveryPayloadHash(payload) };
}
function fixture(extra = {}) {
  const db = new Database(":memory:");
  const sent = [];
  const options = { enabled: true, env, beforeMutation() {}, store: createSqliteDeliveryStore(db), clock: () => Date.parse("2026-11-11T12:00:00Z"),
    smtpFactory: () => ({ async sendMail(message) { sent.push(message); return { messageId: message.messageId, accepted: [message.to], rejected: [] }; } }),
    fetch: async () => { throw new Error("Unexpected fetch: tests never access a real service."); }, ...extra };
  return { db, sent, options, adapter: createDeliveryAdapter(options) };
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function fakeGhost() {
  let post;
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    assert.equal(new URL(url).origin, env.GHOST_ADMIN_URL);
    assert.equal(init.redirect, "error");
    assert.match(init.headers.Authorization, /^Ghost [\w.-]+$/);
    if (init.method === "GET") return post ? response({ posts: [post] }) : response({}, 404);
    const input = JSON.parse(init.body).posts[0];
    if (init.method === "POST") {
      assert.equal(post, undefined, "never create a second draft");
      assert.equal(input.status, "draft");
      post = { ...input, id: "c".repeat(24), updated_at: "2026-11-11T12:00:00.000Z" };
    } else {
      assert.equal(init.method, "PUT");
      assert.equal(input.id, post.id);
      assert.equal(input.updated_at, post.updated_at);
      assert.equal(input.status, "published");
      post = { ...post, status: "published", updated_at: "2026-11-11T12:00:01.000Z" };
    }
    return response({ posts: [post] });
  };
  return { fetch, calls, get post() { return post; }, set post(value) { post = value; } };
}

test("hash is canonical and rejects non-JSON values", () => {
  assert.equal(deliveryPayloadHash({ b: 2, a: { d: true, c: "x" } }), deliveryPayloadHash({ a: { c: "x", d: true }, b: 2 }));
  for (const value of [undefined, NaN, Infinity, new Date(), () => {}, Array(2)]) assert.throws(() => deliveryPayloadHash({ value }));
});
test("delivery stays off with credentials alone, or without a durable journal", async () => {
  const f = fixture({ enabled: undefined });
  assert.equal((await f.adapter.send(request())).status, "not_sent");
  assert.equal(f.sent.length, 0);
  assert.equal((await createDeliveryAdapter({ ...f.options, enabled: true, store: undefined }).send(request())).status, "not_sent");
  assert.equal(f.sent.length, 0);
  assert.equal((await createDeliveryAdapter({ ...f.options, enabled: undefined, env: { ...env, CUSTOMER_DELIVERY_ENABLED: "true" } }).send(request())).status, "accepted");
});
test("SMTP fixes sender/envelope, prevents URL/file access and only proves acceptance", async () => {
  let transportOptions;
  const f = fixture();
  const adapter = createDeliveryAdapter({ ...f.options, smtpFactory: options => { transportOptions = options; return f.options.smtpFactory(options); } });
  const result = await adapter.send(request());
  assert.equal(result.status, "accepted");
  assert.match(result.evidence, /smtp_accepted_not_delivered/);
  assert.equal(f.sent[0].from, env.MAIL_FROM);
  assert.deepEqual(f.sent[0].envelope, { from: env.MAIL_FROM, to: [request().payload.to] });
  assert.equal(f.sent[0].disableFileAccess, true);
  assert.equal(f.sent[0].disableUrlAccess, true);
  assert.equal(transportOptions.requireTLS, true);
  assert.equal((await adapter.reconcile(request())).status, "accepted");
  assert.equal((await adapter.send(request())).status, "accepted");
  assert.equal(f.sent.length, 1);
});
test("hash tampering, header injection and payload overrides never send", async () => {
  const f = fixture();
  const tampered = request(); tampered.payload.text = "Changed after approval";
  const invalid = [tampered, request("email", { to: "ok@example.test\r\nBcc: attacker@example.test", subject: "x", text: "x" }),
    request("email", { to: "a@example.test,b@example.test", subject: "x", text: "x" }),
    request("email", { to: "a@example.test", subject: "x\r\nBcc: b@example.test", text: "x" })];
  for (const field of ["from", "bcc", "cc", "attachments", "headers", "envelope", "messageId", "url"]) invalid.push(request("email", { ...request().payload, [field]: "https://attacker.example.test" }));
  for (const req of invalid) assert.equal((await f.adapter.send(req)).status, "not_sent");
  assert.equal(f.sent.length, 0);
});
test("a reused key cannot change content, identity, channel or destination", async () => {
  const f = fixture(); await f.adapter.send(request());
  assert.equal((await f.adapter.send(request("email", { ...request().payload, text: "Different approved body" }))).status, "not_sent");
  assert.equal((await f.adapter.send({ ...request(), id: "another-outbox-row" })).status, "not_sent");
  assert.equal((await f.adapter.send(request("ghost"))).status, "not_sent");
  assert.equal((await createDeliveryAdapter({ ...f.options, env: { ...env, MAIL_FROM: "another@example.test" } }).send(request())).status, "not_sent");
  assert.equal(f.sent.length, 1);
});
test("SMTP timeout is uncertain and never retried, including from a new adapter", async () => {
  let calls = 0;
  const f = fixture({ smtpFactory: () => ({ async sendMail() { calls++; throw new Error("timeout after DATA"); } }) });
  assert.equal((await f.adapter.send(request())).status, "uncertain");
  assert.equal((await createDeliveryAdapter(f.options).send(request())).status, "uncertain");
  assert.equal((await f.adapter.reconcile(request())).status, "uncertain");
  assert.equal(calls, 1);
});
test("uncertain SMTP attempt survives a real database close and reopen", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vtm-delivery-test-")); const file = path.join(dir, "journal.sqlite");
  let db;
  try {
    db = new Database(file);
    let calls = 0;
    const base = { enabled: true, env, beforeMutation() {}, smtpFactory: () => ({ async sendMail() { calls++; throw new Error("socket lost"); } }) };
    assert.equal((await createDeliveryAdapter({ ...base, store: createSqliteDeliveryStore(db) }).send(request())).status, "uncertain");
    db.close(); db = new Database(file);
    assert.equal((await createDeliveryAdapter({ ...base, store: createSqliteDeliveryStore(db) }).send(request())).status, "uncertain");
    assert.equal(calls, 1);
  } finally { db?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test("a reservation before a crash blocks SMTP replay even without any saved outcome", async () => {
  const f = fixture();
  const capture = { ...f.options.store, save() { throw new Error("database interrupted"); } };
  assert.equal((await createDeliveryAdapter({ ...f.options, store: capture }).send(request())).status, "uncertain");
  assert.equal((await f.adapter.send(request())).status, "uncertain");
  assert.equal(f.sent.length, 1);
});
test("concurrent send calls reserve the request only once", async () => {
  let release; const barrier = new Promise(resolve => { release = resolve; }); let count = 0;
  const f = fixture({ smtpFactory: () => ({ async sendMail(message) { count++; await barrier; return { messageId: message.messageId, accepted: [message.to], rejected: [] }; } }) });
  const first = f.adapter.send(request());
  assert.equal((await f.adapter.send(request())).status, "uncertain");
  release(); assert.equal((await first).status, "accepted"); assert.equal(count, 1);
});
test("SMTP evidence must bind message, recipient, payload hash and receipt", async () => {
  const f = fixture({ smtpFactory: () => ({ async sendMail() { throw new Error("timeout"); } }) }); await f.adapter.send(request());
  for (const change of [{ recipient: "attacker@example.test" }, { payloadHash: "0".repeat(64) }, { messageId: "different" }, { evidence: "" }]) {
    const adapter = createDeliveryAdapter({ ...f.options, smtpReceipt: async query => ({ ...query, state: "delivered", evidence: "fake provider event 123", ...change }) });
    assert.equal((await adapter.reconcile(request())).status, "uncertain");
  }
  const adapter = createDeliveryAdapter({ ...f.options, smtpReceipt: async query => ({ ...query, state: "delivered", evidence: "fake provider event 123" }) });
  assert.equal((await adapter.reconcile(request())).status, "verified");
  assert.equal((await f.adapter.reconcile(request())).status, "verified");
});
test("definite not_sent can retry, unlike an ambiguous transport error", async () => {
  const f = fixture();
  const broken = createDeliveryAdapter({ ...f.options, smtpFactory() { throw new Error("initialization failed before any connection"); } });
  assert.equal((await broken.send(request())).status, "not_sent");
  assert.equal((await f.adapter.send(request())).status, "accepted");
  assert.equal(f.sent.length, 1);
});
test("an unexpected SMTP recipient receipt or Message-ID is not accepted", async () => {
  for (const info of [{ accepted: ["attacker@example.test"], rejected: [] }, { accepted: [request().payload.to], rejected: [] }, { accepted: [], rejected: [request().payload.to] }]) {
    const f = fixture({ smtpFactory: () => ({ async sendMail() { return info; } }) });
    assert.equal((await f.adapter.send(request())).status, "uncertain");
  }
});
test("Ghost verifies exact draft then publishes it once and reads back evidence", async () => {
  const ghost = fakeGhost(); const f = fixture({ fetch: ghost.fetch }); const req = request("ghost");
  const result = await f.adapter.send(req);
  assert.equal(result.status, "verified"); assert.match(result.evidence, /ghost_published_readback/);
  assert.deepEqual(ghost.calls.map(c => c.init.method), ["GET", "POST", "GET", "PUT", "GET"]);
  assert.equal(ghost.post.status, "published");
  assert.equal(JSON.parse(ghost.post.lexical).root.children[0].html, req.payload.html);
  assert.equal((await createDeliveryAdapter(f.options).send(req)).status, "verified");
  assert.equal(ghost.calls.length, 5);
});
test("Ghost uses only configured origin; rejects supplied URL/key/slug/status and redirects", async () => {
  const ghost = fakeGhost(); const f = fixture({ fetch: ghost.fetch });
  for (const field of ["url", "adminUrl", "apiKey", "slug", "status", "newsletter", "visibility"]) {
    assert.equal((await f.adapter.send(request("ghost", { ...request("ghost").payload, [field]: "https://attacker.example.test" }))).status, "not_sent");
  }
  assert.equal(ghost.calls.length, 0);
  for (const url of ["http://ghost.example.test", "https://user:password@ghost.example.test", "https://ghost.example.test/path", "https://ghost.example.test/?target=evil"]) {
    assert.equal((await createDeliveryAdapter({ ...f.options, env: { ...env, GHOST_ADMIN_URL: url } }).send(request("ghost"))).status, "not_sent");
  }
  const redirect = fixture({ fetch: async (_url, init) => { assert.equal(init.redirect, "error"); return response({}, 302); } });
  assert.equal((await redirect.adapter.send(request("ghost"))).status, "not_sent");
});
test("Ghost reconciles existing published post instead of creating a duplicate", async () => {
  const ghost = fakeGhost(); const first = fixture({ fetch: ghost.fetch }); await first.adapter.send(request("ghost"));
  const second = fixture({ fetch: ghost.fetch });
  assert.equal((await second.adapter.send(request("ghost"))).status, "verified");
  assert.equal(ghost.calls.filter(c => c.init.method === "POST").length, 1);
  assert.equal(ghost.calls.filter(c => c.init.method === "PUT").length, 1);
});
test("lost Ghost draft response never triggers another create or implicit publication", async () => {
  const ghost = fakeGhost();
  const f = fixture({ fetch: async (url, init) => { const result = await ghost.fetch(url, init); if (init.method === "POST") throw new Error("response lost after creation"); return result; } });
  assert.equal((await f.adapter.send(request("ghost"))).status, "uncertain");
  const resumed = createDeliveryAdapter({ ...f.options, fetch: ghost.fetch });
  assert.equal((await resumed.send(request("ghost"))).status, "uncertain");
  assert.equal((await resumed.reconcile(request("ghost"))).status, "uncertain");
  assert.equal(ghost.post.status, "draft");
  assert.equal(ghost.calls.filter(c => c.init.method === "POST").length, 1);
  assert.equal(ghost.calls.filter(c => c.init.method === "PUT").length, 0);
});
test("lost Ghost publication response reconciles by content evidence without another mutation", async () => {
  const ghost = fakeGhost();
  const f = fixture({ fetch: async (url, init) => { const result = await ghost.fetch(url, init); if (init.method === "PUT") throw new Error("response lost after publication"); return result; } });
  assert.equal((await f.adapter.send(request("ghost"))).status, "uncertain");
  assert.equal((await createDeliveryAdapter({ ...f.options, fetch: ghost.fetch }).send(request("ghost"))).status, "verified");
  assert.equal(ghost.calls.filter(c => c.init.method === "PUT").length, 1);
});
test("successful Ghost publish without readback remains accepted, not verified", async () => {
  const ghost = fakeGhost();
  const f = fixture({ fetch: async (url, init) => { if (init.method === "GET" && ghost.post?.status === "published") throw new Error("read unavailable"); return ghost.fetch(url, init); } });
  assert.equal((await f.adapter.send(request("ghost"))).status, "accepted");
  assert.equal((await f.adapter.reconcile(request("ghost"))).status, "accepted");
  assert.equal((await createDeliveryAdapter({ ...f.options, fetch: ghost.fetch }).reconcile(request("ghost"))).status, "verified");
});
test("Ghost hash markers alone cannot verify modified post content", async () => {
  const ghost = fakeGhost(); const f = fixture({ fetch: ghost.fetch }); await f.adapter.send(request("ghost"));
  for (const change of [{ title: "Other title" }, { lexical: JSON.stringify({ root: { children: [] } }) }, { slug: "attacker-slug" }, { tags: [] }]) {
    const old = ghost.post; ghost.post = { ...old, ...change };
    const independent = fixture({ fetch: ghost.fetch });
    assert.equal((await independent.adapter.reconcile(request("ghost"))).status, "uncertain");
    assert.equal((await independent.adapter.send(request("ghost"))).status, "not_sent");
    ghost.post = old;
  }
  assert.equal(ghost.calls.filter(c => c.init.method === "POST").length, 1);
});
test("no post after an ambiguous Ghost mutation is not proof that retrying is safe", async () => {
  let creates = 0;
  const f = fixture({ fetch: async (_url, init) => { if (init.method === "GET") return response({}, 404); creates++; throw new Error("timeout"); } });
  assert.equal((await f.adapter.send(request("ghost"))).status, "uncertain");
  assert.equal((await f.adapter.send(request("ghost"))).status, "uncertain");
  assert.equal(creates, 1);
});
test("caller mutation during Ghost I/O cannot change the sealed request", async () => {
  const ghost = fakeGhost(); const req = request("ghost");
  const f = fixture({ fetch: async (url, init) => { req.payload.html = "Unapproved changed content"; return ghost.fetch(url, init); } });
  assert.equal((await f.adapter.send(req)).status, "verified");
  assert.equal(JSON.parse(ghost.post.lexical).root.children[0].html, "<p>Synthetic article only.</p>");
});

test("enabled sends require an effect-boundary authorization callback", async () => {
  const f = fixture({ beforeMutation: undefined });
  assert.equal((await f.adapter.send(request())).status, "not_sent");
  assert.equal(f.sent.length, 0);
});
test("SMTP checks current approval and attempt immediately before submission", async () => {
  let seen;
  const f = fixture({ beforeMutation(req, phase) { seen = [req.attempt, req.destination, phase]; throw new Error("Owner stopped this attempt"); } });
  assert.equal((await f.adapter.send({ ...request(), attempt: 3, destination: env.MAIL_FROM })).status, "not_sent");
  assert.deepEqual(seen, [3, env.MAIL_FROM, "smtp_submit"]);
  assert.equal(f.sent.length, 0);
});
test("sealed destination must match the snapshotted SMTP sender or Ghost origin", async () => {
  const f = fixture();
  assert.equal((await f.adapter.send({ ...request(), destination: "other@example.test" })).status, "not_sent");
  assert.equal((await f.adapter.send({ ...request("ghost"), destination: "https://other.example.test" })).status, "not_sent");
  assert.equal(f.sent.length, 0);
});
test("stop or revocation during Ghost preflight prevents creating a draft", async () => {
  const ghost = fakeGhost(); let stopped = false; const phases = [];
  const f = fixture({ beforeMutation(_req, phase) { phases.push(phase); if (stopped) throw new Error("stop/revocation"); },
    fetch: async (url, init) => { const result = await ghost.fetch(url, init); stopped = true; return result; } });
  assert.equal((await f.adapter.send(request("ghost"))).status, "not_sent");
  assert.deepEqual(ghost.calls.map(call => call.init.method), ["GET"]);
  assert.deepEqual(phases, ["ghost_create"]);
});
test("stop after Ghost draft creation prevents publication and leaves an uncertain draft", async () => {
  const ghost = fakeGhost(); let stopped = false;
  const f = fixture({ beforeMutation() { if (stopped) throw new Error("source revoked"); },
    fetch: async (url, init) => { const result = await ghost.fetch(url, init); if (init.method === "GET" && ghost.post) stopped = true; return result; } });
  assert.equal((await f.adapter.send(request("ghost"))).status, "uncertain");
  assert.equal(ghost.post.status, "draft");
  assert.deepEqual(ghost.calls.map(call => call.init.method), ["GET", "POST", "GET"]);
  assert.equal((await f.adapter.reconcile(request("ghost"))).status, "uncertain");
  assert.equal(ghost.calls.filter(call => call.init.method === "PUT").length, 0);
});
test("explicit owner adjudication binds exact request and permits a proven SMTP non-send retry", async () => {
  const f = fixture({ smtpFactory: () => ({ async sendMail() { throw new Error("ambiguous"); } }) });
  await f.adapter.send(request());
  const proof = { status: "not_sent", providerId: "provider-event-123", evidence: "Explicit owner record of provider non-submission evidence" };
  assert.equal((await f.adapter.adjudicate({ ...request(), id: "wrong-outbox" }, proof)).status, "uncertain");
  assert.equal((await f.adapter.adjudicate(request(), { ...proof, evidence: "" })).status, "uncertain");
  assert.equal((await f.adapter.adjudicate(request(), proof)).status, "not_sent");
  let sends = 0;
  const resumed = createDeliveryAdapter({ ...f.options, smtpFactory: () => ({ async sendMail(message) { sends++; return { messageId: message.messageId, accepted: [message.to], rejected: [] }; } }) });
  assert.equal((await resumed.send({ ...request(), attempt: 2 })).status, "accepted");
  // Replayed owner proof is idempotent and cannot clear the newer accepted attempt.
  assert.equal((await resumed.adjudicate(request(), proof)).status, "accepted");
  assert.equal((await resumed.send({ ...request(), attempt: 3 })).status, "accepted");
  assert.equal(sends, 1);
});
test("late adapter results cannot overwrite owner adjudication or a newer attempt", async () => {
  let finishOld; let finishNew; let count = 0;
  const f = fixture({ smtpFactory: () => ({ sendMail(message) { return new Promise(resolve => {
    const done = () => resolve({ messageId: message.messageId, accepted: [message.to], rejected: [] });
    if (++count === 1) finishOld = done; else finishNew = done;
  }); } }) });
  const old = f.adapter.send({ ...request(), attempt: 1 });
  await f.adapter.adjudicate(request(), { status: "not_sent", providerId: "fake-event", evidence: "Explicit fixture owner evidence" });
  const fresh = f.adapter.send({ ...request(), attempt: 2 });
  finishOld(); assert.equal((await old).status, "uncertain");
  assert.equal(f.options.store.read(request().idempotencyKey).result.status, "uncertain");
  finishNew(); assert.equal((await fresh).status, "accepted");
  assert.equal(f.options.store.read(request().idempotencyKey).result.status, "accepted");
});
test("equivalent HTTPS root destination is accepted, but a path is not", async () => {
  const ghost = fakeGhost(); const f = fixture({ fetch: ghost.fetch });
  assert.equal((await f.adapter.send({ ...request("ghost"), destination: `${env.GHOST_ADMIN_URL}/wrong` })).status, "not_sent");
  assert.equal((await f.adapter.send({ ...request("ghost"), destination: `${env.GHOST_ADMIN_URL}/` })).status, "verified");
});
test("accidentally asynchronous authorization cannot bypass the effect check", async () => {
  const f = fixture({ beforeMutation: async () => { throw new Error("revoked asynchronously"); } });
  assert.equal((await f.adapter.send(request())).status, "not_sent");
  assert.equal(f.sent.length, 0);
});
