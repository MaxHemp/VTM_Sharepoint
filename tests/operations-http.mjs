import assert from "node:assert/strict";
import fs from "node:fs";

const endpoint = process.env.OPS_TEST_ENDPOINT ?? "http://127.0.0.1:3210/api/betrieb/mcp";
if (new URL(endpoint).hostname !== "127.0.0.1") throw new Error("Dieser Probelauf ist ausschließlich für localhost freigegeben.");
const tokens = Object.fromEntries(["juergen", "artur"].map(actor => [actor, fs.readFileSync(`data/agent-${actor}.secret`, "utf8").trim()]));
let seq = 0;
async function rpc(actor, method, params = {}, headers = {}) {
  return fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25", Authorization: `Bearer ${tokens[actor]}`, ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }) });
}
async function tool(actor, name, args = {}) {
  const response = await rpc(actor, "tools/call", { name, arguments: args });
  assert.equal(response.status, 200);
  const message = await response.json();
  return { isError: !!message.result.isError, data: JSON.parse(message.result.content[0].text) };
}
assert.equal((await fetch(endpoint, { method: "POST" })).status, 401);
assert.equal((await rpc("artur", "ping", {}, { Origin: "https://unrelated.example" })).status, 403);
assert.equal((await rpc("artur", "ping", {}, { "MCP-Protocol-Version": "unknown" })).status, 400);
assert.equal((await fetch(endpoint)).status, 405);
const initialization = await (await rpc("artur", "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "local-pilot-test", version: "1" } })).json();
assert.equal(initialization.result.protocolVersion, "2025-11-25");
const definitions = await (await rpc("artur", "tools/list")).json();
assert(!definitions.result.tools.some(tool => tool.name === "approve_job"));
const jobs = (await tool("artur", "list_jobs")).data;
const job = jobs.find(job => job.title === "PILOT · Fiktiven Artikel aufbereiten" && job.state === "ready");
assert(job, "Bitte zuerst den fiktiven Auftrag über die Oberfläche anlegen.");
assert(!("lease_hash" in job));
const forbidden = await tool("juergen", "approve_job", { id: job.id, version: job.version, request_key: "http-forbidden", reason: "Test" });
assert.equal(forbidden.data.code, "FORBIDDEN");
const malicious = await tool("artur", "claim_job", { id: job.id, version: job.version, request_key: "http-role-forge", actor: "owner" });
assert.equal(malicious.data.code, "INVALID_INPUT");
const key = `http-claim-${job.id}`;
const claimInput = { id: job.id, version: job.version, request_key: key };
const claim = await tool("artur", "claim_job", claimInput);
assert.equal(claim.isError, false);
assert.deepEqual(await tool("artur", "claim_job", claimInput), claim);
const stale = await tool("artur", "claim_job", { ...claimInput, request_key: `${key}-other` });
assert.equal(stale.data.code, "CONFLICT");
const result = await tool("artur", "submit_result", { id: job.id, version: claim.data.version, lease_token: claim.data.lease_token, request_key: `http-submit-${job.id}`, result: "PILOT ERFOLGREICH: Der lokale Testclient mit Arturs Rolle hat den Auftrag reserviert und dieses Ergebnis über die Agentenschnittstelle zurückgemeldet. Kein echter Work-Chat ausgeführt, keine Nachricht versendet, kein Artikel veröffentlicht." });
assert.equal(result.data.state, "submitted");
const report = await tool("juergen", "save_report", { request_key: `http-report-${job.id}`, body: "Lokaler Pilotbericht: Ein fiktiver Auftrag wurde über die Oberfläche erstellt, mit Arturs Werkzeugrolle übernommen und zur Prüfung zurückgegeben. Dies war ein Schnittstellentest, kein echter Agentenlauf. Kaufmännische Freigaben und Zugriffstrennung geprüft. Mail, Ghost, Work-Chat-Anbindung und automatische Berichtszustellung sind noch nicht aktiv." });
assert.equal(report.data.externalDeliveryVerified, false);
console.log(JSON.stringify({ passed: true, httpChecks: ["missing_auth_401", "foreign_origin_403", "unsupported_protocol_400", "no_sse_405", "initialize", "role_filtered_tools", "no_role_spoofing", "no_owner_rights_for_juergen", "idempotent_claim", "stale_version_conflict", "ui_created_job_processed", "result_stored", "report_stored_not_sent"], jobId: job.id, resultState: result.data.state }));
