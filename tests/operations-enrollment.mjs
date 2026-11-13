import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { SignJWT } from 'jose';

// Existing LOCAL pilot database only; never point this test at production.
const origin = 'http://127.0.0.1:3210';
const db = new Database('data/vtm.db', { readonly: true });
const owner = db.prepare('select id from users where email=?').get('pilot@localhost.test');
assert(owner, 'Die lokale fiktive Pilot-Datenbank fehlt.');
const secret = new TextEncoder().encode(fs.readFileSync('data/auth-secret','utf8').trim());
const cookie = async id => `vtm_session=${await new SignJWT({uid:id}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('5m').sign(secret)}`;
const ownerCookie = await cookie(owner.id);
async function provision(actor, headers = {}, confirm='30-days') {
  return fetch(`${origin}/api/betrieb/zugang`, {method:'POST', headers:{Origin:origin,...headers}, body:new URLSearchParams({actor,confirm}), redirect:'manual'});
}
assert.equal((await provision('artur')).status,401);
assert.equal((await provision('artur',{Cookie:ownerCookie,Origin:'https://example.org'})).status,403);
assert.equal((await provision('owner',{Cookie:ownerCookie})).status,400);
assert.equal((await provision('artur',{Cookie:ownerCookie},'')).status,400);
assert.equal((await provision('artur',{Cookie:await cookie(-1)})).status,401);
const response = await provision('artur',{Cookie:ownerCookie});
assert.equal(response.status,200);
assert(response.headers.get('cache-control').includes('no-store'));
assert(response.headers.get('content-disposition').includes('attachment;'));
const access = await response.json();
assert.equal(access.actor,'artur'); assert.equal(access.endpoint,`${origin}/api/betrieb/mcp`);
assert.match(access.token,/^[A-Za-z0-9_-]{43}$/);
async function tools(token) {
  const response = await fetch(access.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  return {response,message:await response.json()};
}
const toolList=await tools(access.token);
assert.equal(toolList.response.status,200);
assert(!toolList.message.result.tools.some(t=>['create_job','approve_job','save_report'].includes(t.name)));
const rotation = await provision('artur',{Cookie:ownerCookie});
assert.equal(rotation.status,200);
assert.equal((await tools(access.token)).response.status,401);
db.close();
console.log('Bestanden: fehlende Anmeldung, fremde Origin, ungültige Rolle/Bestätigung, unbekannte Sitzung, vertraulicher Download, Rollenbindung und Widerruf durch Rotation. Nur localhost und fiktive Pilotdaten.');
