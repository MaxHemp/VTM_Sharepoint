import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import { chromium } from 'playwright';

/**
 * Local-only HTTP/browser contract test. No production database, no sends.
 * Start the app against a new fictional fixture DB with delivery disabled and
 * external stop active. Pass CW_HTTP_FIXTURE=/absolute/path/outside/repo.json:
 * { fixtureOnly: true, origin: "http://127.0.0.1:3211",
 *   ownerCookie: "vtm_session=<short-lived fictional owner session>",
 *   tokens: { juergen: "...", artur: "...", mika: "...", natalie: "..." } }
 * Tokens/cookies are never printed or checked in. The test creates uniquely
 * named fictional customers in that local DB. Browser network is local-only.
 */
setDefaultResultOrder('ipv4first');
const fixturePath = process.argv[2] ?? process.env.CW_HTTP_FIXTURE;
assert(fixturePath && path.isAbsolute(fixturePath), 'CW_HTTP_FIXTURE must name an absolute path to a temporary fictional fixture file.');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
assert.equal(fixture.fixtureOnly, true, 'Fixture must explicitly be fictional and local-only.');
const url = new URL(fixture.origin);
assert.equal(url.protocol, 'http:', 'Only local plain HTTP test servers are allowed.');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Refusing a non-local test target.');
assert(!url.username && !url.password && url.pathname === '/' && !url.search && !url.hash);
const origin = url.origin;
assert.match(fixture.ownerCookie, /^vtm_session=[A-Za-z0-9._-]+$/);
for (const actor of ['juergen', 'artur', 'mika', 'natalie']) assert.match(fixture.tokens?.[actor] ?? '', /^[A-Za-z0-9_-]{40,200}$/);

const run = randomUUID();
let sequence = 0;
const nextKey = () => `local-http-${run}-${++sequence}`;
const checks = [];
const pass = name => checks.push(name);
const api = `${origin}/api/betrieb/kunden`;
const mcp = `${origin}/api/betrieb/mcp`;
const localFetch = (target, options = {}) => {
  assert.equal(new URL(target).origin, origin, 'Refusing a remote URL.');
  return fetch(target, { ...options, redirect: 'manual' });
};
const ownerRequest = (action, input = {}, extra = {}) => localFetch(api, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: fixture.ownerCookie, ...(extra.headers ?? {}) },
  body: extra.body ?? JSON.stringify({ action, input }),
});
async function ownerCall(action, input = {}) {
  const response = await ownerRequest(action, input);
  assert.equal(response.status, 200, `Owner action ${action} failed with HTTP ${response.status}`);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  return (await response.json()).result;
}
const rpc = (actor, method, params = {}, extra = {}) => localFetch(mcp, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixture.tokens[actor]}`, ...(extra.headers ?? {}) },
  body: extra.body ?? JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }),
});
async function tool(actor, action, input = {}, expectedError) {
  const response = await rpc(actor, 'tools/call', { name: `cw_${action}`, arguments: input });
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert(reply.result, `Expected MCP tool result for ${action}`);
  const result = JSON.parse(reply.result.content[0].text);
  assert.equal(!!reply.result.isError, !!expectedError, `Unexpected MCP outcome for ${action}`);
  if (expectedError) assert.equal(result.code, expectedError);
  return result;
}

assert.equal((await localFetch(api)).status, 401);
assert.equal((await localFetch(api, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
assert.equal((await localFetch(mcp, { method: 'POST' })).status, 401);
pass('unauthenticated_owner_api_and_mcp_rejected');
assert.equal((await localFetch(`${api}?action=workflow_status`, { headers: { Cookie: fixture.ownerCookie } })).status, 200);
const status = await ownerCall('workflow_status');
assert.equal(status.deliveryEnabled, false, 'Refusing to mutate a fixture with live delivery enabled.');
assert.equal(status.externalStop, true, 'Refusing to mutate a fixture with external stop disabled.');
pass('owner_session_reads_and_live_delivery_disabled');

assert.equal((await ownerRequest('list_customers', {}, { headers: { Origin: 'https://foreign.example' } })).status, 403);
assert.equal((await localFetch(api, { method: 'POST', headers: { Cookie: fixture.ownerCookie, 'Content-Type': 'application/json' }, body: '{"action":"list_customers","input":{}}' })).status, 403);
assert.equal((await rpc('artur', 'ping', {}, { headers: { Origin: 'https://foreign.example' } })).status, 403);
assert.equal((await ownerRequest('list_customers', {}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
assert.equal((await ownerRequest('list_customers', {}, { body: 'not-json' })).status, 400);
assert.equal((await ownerRequest('list_customers', {}, { body: JSON.stringify({ action: 'list_customers', input: {}, actor: 'owner' }) })).status, 400);
assert.equal((await ownerRequest('list_customers', { unknown: true })).status, 400);
assert.equal((await ownerRequest('list_customers', {}, { body: 'x'.repeat(65537) })).status, 413);
assert.equal((await rpc('artur', 'ping', {}, { body: 'x'.repeat(65537) })).status, 413);
pass('origin_content_type_unknown_fields_json_and_body_limit');

for (const actor of ['juergen', 'artur', 'mika', 'natalie']) {
  const response = await rpc(actor, 'tools/list');
  assert.equal(response.status, 200);
  const names = (await response.json()).result.tools.map(item => item.name);
  assert(names.includes('cw_list_workflows') && names.includes('cw_submit_design'));
  for (const forbidden of ['register_customer', 'approve_content', 'record_customer_approval', 'authorize_delivery', 'record_delivery_evidence', 'retry_delivery']) assert(!names.includes(`cw_${forbidden}`));
}
await tool('artur', 'list_workflows', { actor: 'owner' }, 'INVALID_INPUT');
await tool('artur', '__proto__', {}, 'INVALID_INPUT');
pass('agent_tools_never_advertise_owner_powers_and_reject_role_spoofing');

const customerId = `http-${run}`;
const otherCustomerId = `http-other-${run}`;
await ownerCall('register_customer', { request_key: nextKey(), customer_id: customerId, name: 'FIKTIVER HTTP-Testkunde', approvers: ['approver@example.test'], workers: ['juergen', 'artur', 'mika'] });
await ownerCall('register_customer', { request_key: nextKey(), customer_id: otherCustomerId, name: 'FIKTIVER zweiter Testkunde', approvers: ['other@example.test'], workers: ['natalie'] });
await ownerCall('register_source', { request_key: nextKey(), customer_id: customerId, source_id: 'fictional-v1', locator: 'https://source.example.test/fictional', excerpt: 'Fiktive Testinformation, keine echte Produktaussage.', kind: 'provider', valid_until: new Date(Date.now() + 86400000).toISOString(), evidence: 'Nur fiktive lokale Testquelle.' });
const intake = { request_key: nextKey(), customer_id: customerId, source_kind: 'portal', source_id: `fictional-intake-${run}`, title: `FIKTIVER Browsercheck ${run}`, brief: 'Nur lokaler Schnittstellen- und Freigabetest. Nichts extern versenden.' };
let workflow = await ownerCall('intake', intake);
assert.equal((await ownerCall('intake', { ...intake, request_key: nextKey() })).id, workflow.id);
await tool('natalie', 'get_workflow', { id: workflow.id }, 'NOT_FOUND');
assert(!(await tool('natalie', 'list_workflows')).some(item => item.id === workflow.id));
assert(!(await tool('artur', 'list_customers')).some(item => item.id === otherCustomerId));
pass('deduplicated_intake_and_cross_customer_isolation');
const claim = async w => tool(w.assignee, 'claim_stage', { id: w.id, version: w.version, request_key: nextKey() });
const submit = async (w, action, input) => tool(w.assignee, action, { request_key: nextKey(), id: w.id, version: w.version, lease_token: w.lease_token, ...input });
let reserved = await claim(workflow);
workflow = await submit(reserved, 'submit_research', { source_ids: ['fictional-v1'], summary: 'Fiktive Anbieterangabe korrekt zugeordnet.' });
reserved = await claim(workflow);
const content = { channel: 'email', payload: { to: 'recipient@example.test', subject: 'Fiktiver lokaler Test', text: 'Fiktive Testinformation. Kein externer Versand.' }, assets: [], claims: [{ text: 'Fiktive Testinformation', source_id: 'fictional-v1', kind: 'provider' }], quality_requirements: [] };
await tool('artur', 'submit_production', { request_key: nextKey(), id: reserved.id, version: reserved.version, lease_token: reserved.lease_token, content: { ...content, payload: { ...content.payload, bcc: 'unapproved@example.test' } } }, 'INVALID_INPUT');
workflow = await submit(reserved, 'submit_production', { content });
assert.equal(workflow.state, 'designing');
reserved = await claim(workflow);
workflow = await submit(reserved, 'submit_design', { assets: [{ uri: 'fixture://local-visual-export', sha256: 'a'.repeat(64) }], notes: 'Fiktiver Export im lokalen Test.' });
reserved = await claim(workflow);
const requirements = JSON.parse(workflow.content_json).quality_requirements;
workflow = await submit(reserved, 'submit_qa', { checks: requirements.map(criterion => ({ criterion, passed: true, evidence: 'Fiktiver lokaler Testnachweis.' })), notes: 'Jürgen prüft getrennt von Artur und Mika.' });
assert.equal(workflow.state, 'owner_review');
assert(!('lease_hash' in workflow));
assert(!('lease_token' in await tool('artur', 'get_workflow', { id: workflow.id })));
pass('artur_mika_juergen_flow_sealed_qa_and_safe_reads');

await tool('juergen', 'approve_content', { request_key: nextKey(), id: workflow.id, version: workflow.version, revision_hash: workflow.revision_hash, evidence: 'Darf nicht angenommen werden.' }, 'FORBIDDEN');
let rejected = await ownerRequest('approve_content', { request_key: nextKey(), id: workflow.id, version: workflow.version - 1, revision_hash: workflow.revision_hash, evidence: 'Veraltete Version muss scheitern.' });
assert.equal(rejected.status, 409);
assert.equal((await rejected.json()).code, 'CONFLICT');
rejected = await ownerRequest('approve_content', { request_key: nextKey(), id: workflow.id, version: workflow.version, revision_hash: 'b'.repeat(64), evidence: 'Falsche Inhaltsrevision muss scheitern.' });
assert.equal(rejected.status, 409);
assert.equal((await ownerCall('get_workflow', { id: workflow.id })).state, 'owner_review');
pass('agent_approval_forbidden_stale_version_and_wrong_revision_rejected');

const anonymous = await localFetch(`${origin}/betrieb/kunden`);
assert([302, 303, 307].includes(anonymous.status));
assert.match(anonymous.headers.get('location') ?? '', /\/login/);
const htmlResponse = await localFetch(`${origin}/betrieb/kunden?kunde=${customerId}`, { headers: { Cookie: fixture.ownerCookie } });
assert.equal(htmlResponse.status, 200);
const html = await htmlResponse.text();
assert(html.includes('Kundenaufträge und Contentfreigaben'));
assert(html.includes(workflow.revision_hash));
assert(html.includes('Live-Auslieferung deaktiviert'));
assert(!html.includes('lease_hash') && !html.includes(reserved.lease_token));
pass('owner_ui_server_render_and_anonymous_redirect');

let screenshot;
if (process.env.CW_HTTP_SKIP_BROWSER === 'true') {
  pass('browser_explicitly_skipped');
  // Progressive enhancement submits the real rendered Server Action even when
  // a browser runtime is unavailable. This does not claim visual/browser QA.
  const approvalForm = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(match => match[0]).find(form => form.includes('value="approve_content"') && form.includes(workflow.id));
  assert(approvalForm, 'Expected the rendered owner approval form.');
  const makeForm = () => {
    const form = new FormData();
    for (const input of approvalForm.matchAll(/<input\b[^>]*>/g)) {
      const name = input[0].match(/\bname="([^"]*)"/)?.[1];
      const value = input[0].match(/\bvalue="([^"]*)"/)?.[1] ?? '';
      if (name) form.append(name, value);
    }
    form.append('evidence', 'Fiktive Freigabe über das tatsächlich gerenderte lokale Inhaberformular.');
    return form;
  };
  const submitForm = form => localFetch(`${origin}/betrieb/kunden`, { method: 'POST', headers: { Origin: origin, Cookie: fixture.ownerCookie }, body: form });
  const invalidForm = makeForm(); invalidForm.append('unknown_field', 'must reject');
  const invalidResponse = await submitForm(invalidForm);
  assert.equal(invalidResponse.status, 303);
  assert.match(invalidResponse.headers.get('location') ?? '', /fehler=/);
  assert.equal((await ownerCall('get_workflow', { id: workflow.id })).state, 'owner_review');
  const approvedResponse = await submitForm(makeForm());
  assert.equal(approvedResponse.status, 303);
  assert.match(approvedResponse.headers.get('location') ?? '', /erfolg=approve_content/);
  workflow = await ownerCall('get_workflow', { id: workflow.id });
  assert.equal(workflow.state, 'customer_review');
  const repeatResponse = await submitForm(makeForm());
  assert.equal(repeatResponse.status, 303);
  assert.equal((await ownerCall('get_workflow', { id: workflow.id })).version, workflow.version);
  pass('rendered_owner_form_unknown_fields_rejected_and_repeated_submit_idempotent');
} else {
  const executablePath = process.env.CW_HTTP_BROWSER_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath());
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addCookies([{ name: 'vtm_session', value: fixture.ownerCookie.slice('vtm_session='.length), url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    const browserErrors = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    await page.goto(`${origin}/betrieb/kunden?kunde=${customerId}`, { waitUntil: 'networkidle' });
    assert.equal(await page.getByRole('heading', { name: 'Kundenaufträge und Contentfreigaben' }).count(), 1);
    const article = page.locator(`#workflow-${workflow.id}`);
    assert(await article.locator('p').filter({ hasText: `Inhaltsrevision: ${workflow.revision_hash}` }).isVisible());
    assert(await article.getByText('recipient@example.test', { exact: false }).isVisible());
    await article.getByLabel('Prüfnachweis / Entscheidungsvermerk').fill('Fiktive Browser-Freigabe nur für die angezeigte lokale Testrevision.');
    screenshot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vtm-cw-http-')), 'owner-review.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await article.getByRole('button', { name: 'Genau diesen Content als Inhaber freigeben' }).click();
    await page.waitForURL('**/betrieb/kunden?erfolg=approve_content');
    assert(await page.getByRole('status').isVisible());
    assert.equal(browserErrors.length, 0, 'Browser must not report rendering or hydration errors.');
    workflow = await ownerCall('get_workflow', { id: workflow.id });
    assert.equal(workflow.state, 'customer_review');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/betrieb/kunden?kunde=${customerId}`, { waitUntil: 'networkidle' });
    assert(await page.getByRole('heading', { name: 'Kundenaufträge und Contentfreigaben' }).isVisible());
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, 'Mobile page must not overflow horizontally.');
    pass('chromium_owner_review_form_submitted_and_mobile_layout');
  } finally { await browser.close(); }
}
workflow = await ownerCall('record_customer_approval', { request_key: nextKey(), id: workflow.id, version: workflow.version, revision_hash: workflow.revision_hash, approver: 'approver@example.test', evidence: 'Fiktive Kundenfreigabe für exakt diese lokale Testrevision.' });
assert.equal(workflow.state, 'ready_delivery');
workflow = await ownerCall('authorize_delivery', { request_key: nextKey(), id: workflow.id, version: workflow.version, revision_hash: workflow.revision_hash, confirmation: 'Nur fiktive lokale Warteschlange. Live-Ausführung bleibt deaktiviert.' });
assert.equal(workflow.state, 'delivery_queued');
const finalStatus = await ownerCall('workflow_status');
assert.equal(finalStatus.deliveryEnabled, false);
assert.equal(finalStatus.externalStop, true);
assert.equal(finalStatus.deliveries.find(item => item.workflow_id === workflow.id)?.state, 'queued');
pass('separate_customer_and_delivery_approval_queued_without_external_send');
console.log(JSON.stringify({ passed: true, localOnly: true, checks, browserSkipped: process.env.CW_HTTP_SKIP_BROWSER === 'true', screenshot, workflowId: workflow.id }));
