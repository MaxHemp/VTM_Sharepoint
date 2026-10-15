import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { Operations, berlinDay } from "../lib/operations.ts";
import { toolDefinition } from "../lib/operations-tools.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

function fixture() {
  let now = Date.parse("2026-10-15T17:00:00Z");
  const db = new Database(":memory:");
  const ops = new Operations(db, () => now);
  let counter = 0;
  const call = (actor, action, input = {}) => ops.call(actor, action, { ...input, request_key: input.request_key ?? `test-${++counter}` });
  const create = (input = {}) => call("juergen", "create_job", { title: "Fiktiver Artikel", brief: "Nur Testdaten verarbeiten.", criteria: "Text und Quelle dokumentiert.", assignee: "artur", category: "article", ...input });
  return { ops, db, call, create, advance: ms => { now += ms; } };
}
const rejects = (fn, code) => assert.throws(fn, error => error.code === code);

test("delegation, result, correction and executive acceptance have an audit trail", () => {
  const { ops, call, create } = fixture();
  const job = create();
  const claim = call("artur", "claim_job", job);
  const result = call("artur", "submit_result", { ...claim, result: "Testartefakt: data/test-article.html" });
  const corrected = call("juergen", "request_revision", { ...result, reason: "Quelle ergänzen" });
  const nextClaim = call("artur", "claim_job", corrected);
  const nextResult = call("artur", "submit_result", { ...nextClaim, result: "Testartefakt: data/test-article-v2.html; Quelle geprüft" });
  assert.equal(call("juergen", "accept_result", nextResult).state, "completed");
  assert.equal(ops.events("owner").filter(e => e.action === "submit_result").length, 2);
});
test("commercial decisions require the owner even when created by the owner", () => {
  const { call, create } = fixture();
  const job = create({ category: "commercial", title: "Preisänderung vorschlagen" });
  assert.equal(job.state, "waiting_approval");
  rejects(() => call("juergen", "approve_job", { ...job, reason: "Budget vorhanden" }), "FORBIDDEN");
  rejects(() => call("artur", "claim_job", job), "CONFLICT");
  const approved = call("owner", "approve_job", { ...job, reason: "Konkreten Testvorschlag genehmigt" });
  assert.equal(call("artur", "claim_job", approved).state, "in_progress");
});
test("new initiatives cannot be activated by the executive", () => {
  const { call, create } = fixture(); const job = create({ category: "initiative" });
  rejects(() => call("juergen", "approve_job", { ...job, reason: "Vorschlag" }), "FORBIDDEN");
  const blocked = call("owner", "reject_job", { ...job, reason: "Noch nicht" });
  assert.equal(blocked.state, "blocked");
  rejects(() => call("juergen", "unblock_job", { ...blocked, reason: "Andere Priorität" }), "FORBIDDEN");
  assert.equal(call("owner", "unblock_job", { ...blocked, reason: "Konkreten Umfang nun genehmigt" }).state, "ready");
});
test("duplicate mutation is replayed once and key reuse for other contents is rejected", () => {
  const { ops, call, create } = fixture(); const job = create();
  const input = { ...job, request_key: "stable-claim" };
  assert.deepEqual(call("artur", "claim_job", input), call("artur", "claim_job", input));
  rejects(() => call("artur", "claim_job", { ...input, version: 5 }), "CONFLICT");
  assert.equal(ops.events("owner").filter(e => e.action === "claim_job").length, 1);
});
test("parallel attempts with different request keys cannot both claim the same version", () => {
  const { call, create } = fixture(); const job = create();
  call("artur", "claim_job", job);
  rejects(() => call("artur", "claim_job", job), "CONFLICT");
});
test("expired lease can be reclaimed and old holder cannot submit", () => {
  const { ops, call, create, advance } = fixture(); const job = create();
  const old = call("artur", "claim_job", job); advance(31 * 60000);
  rejects(() => call("artur", "submit_result", { ...old, result: "Veraltet" }), "LEASE_INVALID");
  const fresh = call("artur", "claim_job", { id: job.id, version: ops.get("artur", job.id).version });
  rejects(() => call("artur", "submit_result", { ...fresh, lease_token: old.lease_token, result: "Veraltet" }), "LEASE_INVALID");
  assert.equal(call("artur", "submit_result", { ...fresh, result: "Neue Fassung" }).state, "submitted");
});
test("specialists cannot see others' jobs, create jobs or approve their own output", () => {
  const { ops, call, create } = fixture(); const job = create();
  assert.equal(ops.list("mika").length, 0);
  rejects(() => ops.get("mika", job.id), "NOT_FOUND");
  rejects(() => call("mika", "create_job", {}), "FORBIDDEN");
  rejects(() => call("artur", "accept_result", job), "FORBIDDEN");
  assert(!ops.tools("juergen").includes("approve_job"));
});
test("stop blocks external pickup and renewal while permitting result preservation", () => {
  const { call, create } = fixture(); const job = create({ category: "email", assignee: "natalie" });
  rejects(() => call("natalie", "claim_job", job), "STOPPED");
  rejects(() => call("juergen", "set_external_stop", { stopped: false }), "FORBIDDEN");
  call("owner", "set_external_stop", { stopped: false });
  const claim = call("natalie", "claim_job", job);
  call("owner", "set_external_stop", { stopped: true });
  rejects(() => call("natalie", "renew_lease", claim), "STOPPED");
  assert.equal(call("natalie", "submit_result", { ...claim, result: "Versand nicht ausgeführt; Stopp berücksichtigt" }).state, "submitted");
});
test("dependencies enforce the business workflow", () => {
  const { call, create } = fixture(); const first = create(); const next = create({ dependencies: [first.id] });
  rejects(() => call("artur", "claim_job", next), "DEPENDENCY");
  const claimed = call("artur", "claim_job", first);
  const submitted = call("artur", "submit_result", { ...claimed, result: "Prüfbares Ergebnis" });
  call("juergen", "accept_result", submitted);
  assert.equal(call("artur", "claim_job", next).state, "in_progress");
});
test("owner cancellation invalidates outstanding work", () => {
  const { call, create } = fixture(); const job = create(); const claim = call("artur", "claim_job", job);
  const cancelled = call("owner", "cancel_job", { ...claim, reason: "Priorität geändert" });
  rejects(() => call("artur", "submit_result", { ...cancelled, lease_token: claim.lease_token, result: "Alt" }), "LEASE_INVALID");
});
test("failed mutations roll back audit and state together", () => {
  const { db, ops, call, create } = fixture(); const job = create();
  db.exec("CREATE TRIGGER fail_test_event BEFORE INSERT ON ops_events WHEN NEW.action='claim_job' BEGIN SELECT RAISE(ABORT,'test rollback'); END");
  assert.throws(() => call("artur", "claim_job", job), /test rollback/);
  assert.equal(ops.get("artur", job.id).state, "ready");
  assert.equal(ops.get("artur", job.id).version, 1);
});
test("daily report includes weekends, Berlin calendar and a distinct owner receipt", () => {
  const { ops, call, advance } = fixture();
  assert.equal(ops.reportStatus().overdue, true);
  call("juergen", "save_report", { body: "Heute keine Änderungen. Nächste Schritte: Testbetrieb fortsetzen." });
  assert.equal(ops.reportStatus().present, true);
  assert.equal(ops.reports("owner")[0].read_at, null);
  rejects(() => call("juergen", "mark_report_read", { day: "2026-10-15" }), "FORBIDDEN");
  call("owner", "mark_report_read", { day: "2026-10-15" });
  assert.ok(ops.reports("owner")[0].read_at);
  advance(2 * 86400000); // Saturday: no quiet-day exception.
  assert.equal(ops.reportStatus().overdue, true);
  assert.equal(berlinDay(new Date("2026-10-15T22:30:00Z")), "2026-10-16");
});
test("agent credentials are scoped, expire, rotate and never grant owner rights", () => {
  const { ops, db, advance } = fixture(); const old = ops.provisionToken("artur", 1);
  assert.equal(ops.authenticate(old), "artur");
  assert.notEqual(db.prepare("SELECT digest FROM ops_tokens").get().digest, old);
  const fresh = ops.provisionToken("artur", 1); assert.equal(ops.authenticate(old), null);
  assert.equal(ops.authenticate(fresh), "artur"); advance(3600001);
  assert.equal(ops.authenticate(fresh), null);
  rejects(() => ops.provisionToken("owner"), "INVALID_INPUT");
});
test("MCP definitions accurately separate reads, writes and required lease fields", () => {
  const read = toolDefinition("get_job"), write = toolDefinition("submit_result");
  assert.equal(read.annotations.readOnlyHint, true);
  assert.equal(write.annotations.readOnlyHint, false);
  assert(write.inputSchema.required.includes("lease_token"));
  assert(!("actor" in write.inputSchema.properties));
});
test("two independent database connections race for one reservation", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vtm-ops-race-"));
  const filename = path.join(directory, "race.db");
  const db = new Database(filename); db.pragma("journal_mode=WAL");
  const ops = new Operations(db);
  const job = ops.call("juergen", "create_job", { title: "Race", brief: "Fiktiv", criteria: "Genau eine Reservierung", assignee: "artur", category: "article", request_key: "race-create" });
  const gate = new SharedArrayBuffer(4);
  const workers = [1, 2].map(index => new Worker(new URL("./operations-race-worker.mjs", import.meta.url), { workerData: { filename, job, gate, index } }));
  try {
    const results = workers.map(worker => new Promise((resolve, reject) => { worker.on("message", resolve); worker.on("error", reject); worker.on("exit", code => { if (code) reject(new Error(`worker exited ${code}`)); }); }));
    Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0, 2);
    const values = await Promise.all(results);
    assert.equal(values.filter(value => value.ok).length, 1);
    assert.equal(values.filter(value => value.code === "CONFLICT").length, 1);
    assert.equal(ops.get("artur", job.id).version, 2);
  } finally {
    await Promise.all(workers.map(worker => worker.terminate())); db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
