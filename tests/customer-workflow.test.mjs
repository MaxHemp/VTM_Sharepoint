import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { CustomerWorkflow, workflowHash } from '../lib/customer-workflow.ts';
import {createDeliveryAdapter,createSqliteDeliveryStore} from '../lib/customer-delivery.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const required=['factual_accuracy','source_coverage','quotes_exact','editorial_value','brand_and_format','visual_export','customer_isolation'];
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code);
function fixture(filename=':memory:') {
  let now=Date.parse('2026-11-11T18:00:00Z');
  const db=new Database(filename);const flow=new CustomerWorkflow(db,()=>now,channel=>channel==='email'?'sender@fixture.example':'https://ghost.fixture.example');let count=0;
  db.exec("CREATE TABLE IF NOT EXISTS ops_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT OR IGNORE INTO ops_settings VALUES('external_stop','1')");
  const call=(actor,action,args={})=>flow.call(actor,action,{...args,request_key:args.request_key??`r-${++count}`});
  const customer=(id='fixture-a',workers=['artur','mika','juergen','natalie'])=>call('owner','register_customer',{customer_id:id,name:`Test ${id}`,approvers:[`editor@${id}.example`],workers});
  const source=(customer_id='fixture-a',source_id='source-v1',opts={})=>call('juergen','register_source',{customer_id,source_id,locator:'https://reference.example/fixture#p1',excerpt:'Die fiktive Lösung unterstützt einen manuellen Abgleich.',kind:'provider',valid_until:'2027-01-01T00:00:00Z',evidence:'Originalpassage in Testquelle geprüft; keine reale Produktaussage.',...opts});
  const create=(customer_id='fixture-a',opts={})=>call('natalie','intake',{customer_id,source_kind:'mail',source_id:`fixture-message-${++count}@example.test`,title:'Fiktiver Testauftrag',brief:'Ein fiktives Asset aus der Testquelle erstellen; nichts real versenden.',...opts});
  const claim=w=>call(w.assignee,'claim_stage',{id:w.id,version:w.version});
  const update=(w,action,args={},actor=w.assignee)=>call(actor,action,{id:w.id,version:w.version,...args});
  const research=w=>{const c=claim(w);return update(c,'submit_research',{lease_token:c.lease_token,source_ids:['source-v1'],summary:'Aussage ist Anbieterangabe, nicht unabhängig belegt.'});};
  const produce=(w,opts={})=>{const c=claim(w);return update(c,'submit_production',{lease_token:c.lease_token,content:{channel:'email',payload:{to:`reader@${w.customer_id}.example`,subject:'Fiktiver Test',text:'Laut Anbieter wird ein manueller Abgleich unterstützt.'},assets:[],claims:[{text:'Manueller Abgleich',source_id:'source-v1',kind:'provider'}],quality_requirements:[],...opts}});};
  const design=w=>{const c=claim(w);return update(c,'submit_design',{lease_token:c.lease_token,assets:[{uri:'fixture://rendered-preview',sha256:'a'.repeat(64)}],notes:'Fiktiver Export visuell im Test geprüft.'});};
  const qa=(w,overrides={})=>{const c=claim(w);return update(c,'submit_qa',{lease_token:c.lease_token,checks:required.map(criterion=>({criterion,passed:true,evidence:'Fixture-Prüfung dokumentiert.'})),notes:'Unabhängiger Prüfer; nur fiktiver Test.',...overrides});};
  const ready=w=>{let x=qa(design(produce(research(w))));x=update(x,'approve_content',{revision_hash:x.revision_hash,evidence:'Max bestätigt nur die benannte fiktive Fassung.'},'owner');return update(x,'record_customer_approval',{revision_hash:x.revision_hash,approver:`editor@${w.customer_id}.example`,evidence:'Fiktive Bestätigung mit derselben Prüfsumme.'},'owner');};
  const queue=w=>update(w,'authorize_delivery',{revision_hash:w.revision_hash,confirmation:'Nur fiktives Testziel und exakt dargestellte Fassung genehmigt.'},'owner');
  const stop=v=>db.prepare("UPDATE ops_settings SET value=? WHERE key='external_stop'").run(v?'1':'0');
  return {db,flow,call,customer,source,create,claim,update,research,produce,design,qa,ready,queue,stop,advance:ms=>{now+=ms;}};
}
function seed(f){f.customer();f.source();return f.create();}
const success=()=>({send:async()=>({status:'verified',providerId:'fixture-1',evidence:'Fiktiver Zielabruf mit passender Fassung.'}),reconcile:async()=>({status:'uncertain'})});

test('full fixture flow: intake, research, Artur, Mika, independent QA, Max, customer, authorization, verified evidence, report',async()=>{
  const f=fixture();let w=seed(f);w=f.ready(w);assert.equal(w.state,'ready_delivery');w=f.queue(w);
  let sent=0;const adapter={...success(),send:async req=>{sent++;assert.equal(req.payloadHash,workflowHash(req.payload));return {status:'verified',providerId:'fixture-1',evidence:'Verified fake publication'};}};
  assert.equal((await f.flow.dispatchOne(adapter)).state,'disabled');assert.equal((await f.flow.dispatchOne(adapter,true)).state,'stopped');
  f.stop(false);assert.equal((await f.flow.dispatchOne(adapter,true)).state,'verified');assert.equal(sent,1);assert.equal(f.flow.get('owner',w.id).state,'completed');
  assert.equal((await f.flow.dispatchOne(adapter,true)).state,'idle');assert.equal(f.flow.maintenance().reportPresent,true);
  assert.equal(f.flow.events('owner',w.id).filter(e=>e.action==='delivery_result').length,1);
  assert(!JSON.stringify(f.flow.get('owner',w.id)).includes('lease_hash'));
});

test('duplicate intake shares one workflow and rejects cross-customer or altered assignment',()=>{
  const f=fixture();f.customer();f.source();const input={source_id:'mail-global-1'};const a=f.create('fixture-a',input);const b=f.create('fixture-a',input);assert.equal(a.id,b.id);
  rejects(()=>f.create('fixture-a',{...input,brief:'Changed instructions'}),'CONFLICT');f.customer('fixture-b');rejects(()=>f.create('fixture-b',input),'CONFLICT');
});

test('idempotency is actor and canonical content bound',()=>{
  const f=fixture();let w=seed(f);const args={id:w.id,version:w.version,request_key:'stable'};const a=f.call('artur','claim_stage',args);const b=f.call('artur','claim_stage',{request_key:'stable',version:w.version,id:w.id});assert.deepEqual(a,b);
  rejects(()=>f.call('artur','claim_stage',{...args,version:10}),'CONFLICT');assert.equal(f.flow.events('owner',w.id).filter(e=>e.action==='claim_stage').length,1);
});

test('customer separation applies to reads, sources, intake and specialist actions',()=>{
  const f=fixture();f.customer('fixture-a',['artur','mika','juergen']);f.source();f.customer('fixture-b',['natalie']);
  const w=f.call('juergen','intake',{customer_id:'fixture-a',source_kind:'portal',source_id:'p1',title:'Private fixture',brief:'Private test'});
  rejects(()=>f.flow.get('natalie',w.id),'NOT_FOUND');assert.equal(f.flow.list('natalie').length,0);rejects(()=>f.call('natalie','list_sources',{customer_id:'fixture-a'}),'NOT_FOUND');
  rejects(()=>f.call('kalli','workflow_status'),'FORBIDDEN');rejects(()=>f.call('artur','register_customer',{}),'FORBIDDEN');
});

test('source isolation, freshness, revocation and provider claim classification block weak output',()=>{
  const f=fixture();let w=seed(f);f.customer('fixture-b');f.source('fixture-b','only-b');const c=f.claim(w);
  rejects(()=>f.update(c,'submit_research',{lease_token:c.lease_token,source_ids:['only-b'],summary:'Wrong customer'}),'SOURCE_INVALID');
  w=f.update(c,'submit_research',{lease_token:c.lease_token,source_ids:['source-v1'],summary:'Valid'});const p=f.claim(w);
  rejects(()=>f.update(p,'submit_production',{lease_token:p.lease_token,content:{channel:'email',payload:{to:'test@example.test',subject:'Test',text:'Claim'},assets:[],claims:[{text:'Unproven independent claim',source_id:'source-v1',kind:'independent'}],quality_requirements:[]}}),'QUALITY_GATE');
  f.call('juergen','revoke_source',{customer_id:w.customer_id,source_id:'source-v1',reason:'Fictional correction'});
  rejects(()=>f.update(p,'submit_production',{lease_token:p.lease_token,content:{}}),'SOURCE_INVALID');
});

test('lease fences stale or competing worker results after expiry',()=>{
  const f=fixture();let w=seed(f);const a=f.claim(w);rejects(()=>f.claim(f.flow.get('artur',w.id)),'CONFLICT');f.advance(31*60000);
  const b=f.claim(f.flow.get('artur',w.id));rejects(()=>f.update(b,'submit_research',{lease_token:a.lease_token,source_ids:['source-v1'],summary:'Late answer'}),'LEASE_INVALID');
  assert.equal(f.update(b,'submit_research',{lease_token:b.lease_token,source_ids:['source-v1'],summary:'Current answer'}).state,'producing');
});

test('QA cannot skip checks, self-review, or pass a critical failure',()=>{
  const f=fixture();let w=seed(f);w=f.design(f.produce(f.research(w)));const c=f.claim(w);
  rejects(()=>f.update(c,'submit_qa',{lease_token:c.lease_token,checks:[],notes:'No checks'}),'QUALITY_GATE');
  rejects(()=>f.update(c,'submit_qa',{lease_token:c.lease_token,checks:[],notes:'Self approval'},'artur'),'LEASE_INVALID');
  const failed=f.update(c,'submit_qa',{lease_token:c.lease_token,checks:required.map(criterion=>({criterion,passed:criterion!=='factual_accuracy',evidence:'Test evidence'})),notes:'Critical fact check failed'});
  assert.equal(failed.state,'producing');rejects(()=>f.update(failed,'approve_content',{revision_hash:failed.revision_hash,evidence:'Not allowed'},'owner'),'CONFLICT');
});

test('only Max can approve content; customer approval must follow exact Max revision and named approver',()=>{
  const f=fixture();let w=seed(f);w=f.qa(f.design(f.produce(f.research(w))));
  rejects(()=>f.update(w,'approve_content',{revision_hash:w.revision_hash,evidence:'Agent approval'},'juergen'),'FORBIDDEN');
  rejects(()=>f.update(w,'record_customer_approval',{revision_hash:w.revision_hash,approver:'editor@fixture-a.example',evidence:'Early approval'},'owner'),'CONFLICT');
  rejects(()=>f.update(w,'approve_content',{revision_hash:'b'.repeat(64),evidence:'Wrong version'},'owner'),'CONFLICT');
  w=f.update(w,'approve_content',{revision_hash:w.revision_hash,evidence:'Exact owner approval'},'owner');
  rejects(()=>f.update(w,'record_customer_approval',{revision_hash:w.revision_hash,approver:'unknown@example.test',evidence:'Wrong person'},'owner'),'FORBIDDEN');
});

test('revision invalidates both approvals and cancels queued external action',async()=>{
  const f=fixture();let w=seed(f);w=f.queue(f.ready(w));const hash=w.revision_hash;
  w=f.update(w,'request_revision',{reason:'Layout correction'},'juergen');assert.equal(w.revision_hash,null);assert.equal(w.owner_approval_json,null);assert.equal(w.customer_approval_json,null);
  f.stop(false);assert.equal((await f.flow.dispatchOne(success(),true)).state,'idle');
  rejects(()=>f.update(w,'approve_content',{revision_hash:hash,evidence:'Late approval of old package'},'owner'),'QUALITY_GATE');
});

test('source expiry after approval blocks dispatch with zero external calls',async()=>{
  const f=fixture();let w=seed(f);f.queue(f.ready(w));f.stop(false);f.advance(100*24*3600000);let calls=0;
  await assert.rejects(()=>f.flow.dispatchOne({send:async()=>{calls++;return {status:'verified'};},reconcile:async()=>({status:'uncertain'})},true),e=>e.code==='SOURCE_INVALID');assert.equal(calls,0);
});

test('SMTP acceptance is not delivery and blocks automatic replay or hidden revision',async()=>{
  const f=fixture();let w=seed(f);w=f.queue(f.ready(w));f.stop(false);let calls=0;
  const adapter={send:async()=>{calls++;return {status:'accepted',providerId:'smtp-fixture',evidence:'250 accepted'};},reconcile:async()=>({status:'uncertain',error:'No delivery evidence'})};
  await f.flow.dispatchOne(adapter,true);assert.equal(f.flow.get('owner',w.id).state,'delivery_accepted');assert.equal((await f.flow.dispatchOne(adapter,true)).state,'idle');assert.equal(calls,1);
  w=f.flow.get('owner',w.id);rejects(()=>f.update(w,'request_revision',{reason:'New text'},'owner'),'RECONCILE_REQUIRED');
  w=f.update(w,'record_delivery_evidence',{outcome:'verified',provider_id:'smtp-fixture',evidence:'Fiktiver Empfang mit Message-ID und exakter Fassung bestätigt.'},'owner');assert.equal(w.state,'completed');
});

test('ambiguous network failure persists uncertainty, reconciliation never sends again',async()=>{
  const f=fixture();let w=seed(f);f.queue(f.ready(w));f.stop(false);let sends=0,reads=0;
  const adapter={send:async()=>{sends++;throw new Error('socket closed after effect');},reconcile:async()=>{reads++;return {status:'verified',providerId:'fixture-remote-id',evidence:'Existing destination content matches'};}};
  assert.equal((await f.flow.dispatchOne(adapter,true)).state,'uncertain');assert.equal((await f.flow.dispatchOne(adapter,true)).state,'idle');assert.equal((await f.flow.reconcileOne(adapter)).state,'verified');assert.equal(sends,1);assert.equal(reads,1);
});

test('recovery from committed send reservation survives process restart without resubmission',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vtm-recovery-'));const filename=path.join(dir,'test.db');const f=fixture(filename);let w=seed(f);f.queue(f.ready(w));f.stop(false);
  f.db.prepare("UPDATE cw_outbox SET state='sending',started_at=0").run();f.db.prepare("UPDATE cw_workflows SET state='delivering' WHERE id=?").run(w.id);f.db.close();
  const g=fixture(filename);assert.equal(g.flow.maintenance().recovered,1);assert.equal(g.flow.get('owner',w.id).state,'delivery_uncertain');assert.equal((await g.flow.dispatchOne(success(),true)).state,'idle');g.db.close();fs.rmSync(dir,{recursive:true});
});

test('definite non-send can only retry after explicit owner decision and unchanged approvals',async()=>{
  const f=fixture();let w=seed(f);f.queue(f.ready(w));f.stop(false);let count=0;const adapter={send:async()=>{count++;return count===1?{status:'not_sent',error:'Configuration missing before submission'}:{status:'verified',providerId:'second-test',evidence:'Verified fake receipt'};},reconcile:async()=>({status:'uncertain'})};
  await f.flow.dispatchOne(adapter,true);assert.equal((await f.flow.dispatchOne(adapter,true)).state,'idle');w=f.flow.get('owner',w.id);rejects(()=>f.update(w,'retry_delivery',{reason:'Please try'},'juergen'),'FORBIDDEN');
  f.update(w,'retry_delivery',{reason:'Configuration verified, same exact action'},'owner');assert.equal((await f.flow.dispatchOne(adapter,true)).state,'verified');assert.equal(count,2);
});

test('two database connections cannot reserve same delivery',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vtm-concurrency-'));const filename=path.join(dir,'test.db');const f=fixture(filename);const w=seed(f);f.queue(f.ready(w));f.stop(false);const g=fixture(filename);let sends=0;
  const adapter={send:async()=>{sends++;await new Promise(r=>setTimeout(r,20));return {status:'verified',providerId:'single',evidence:'One fixture call'};},reconcile:async()=>({status:'uncertain'})};
  const results=await Promise.all([f.flow.dispatchOne(adapter,true),g.flow.dispatchOne(adapter,true)]);assert.equal(sends,1);assert.deepEqual(results.map(r=>r.state).sort(),['idle','verified']);f.db.close();g.db.close();fs.rmSync(dir,{recursive:true});
});

test('unverifiable adapter success is downgraded to uncertainty',async()=>{
  const f=fixture();const w=seed(f);f.queue(f.ready(w));f.stop(false);await f.flow.dispatchOne({send:async()=>({status:'verified'}),reconcile:async()=>({status:'uncertain'})},true);assert.equal(f.flow.get('owner',w.id).state,'delivery_uncertain');
});

test('identical regenerated revision reuses known-unsent outbox after both fresh approvals',()=>{
  const f=fixture();let w=seed(f);w=f.queue(f.ready(w));const hash=w.revision_hash;const first=f.db.prepare('SELECT id FROM cw_outbox').get().id;
  w=f.update(w,'request_revision',{reason:'Repeat full review'},'owner');w=f.queue(f.ready(w));assert.equal(w.revision_hash,hash);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM cw_outbox').get().n,1);assert.equal(f.db.prepare('SELECT id FROM cw_outbox').get().id,first);
});

test('late async delivery result cannot complete a newer attempt after manual reconciliation',async()=>{
  const f=fixture();let w=seed(f);f.queue(f.ready(w));f.stop(false);let releaseFirst,releaseSecond;
  const firstPromise=new Promise(r=>{releaseFirst=r;});const secondPromise=new Promise(r=>{releaseSecond=r;});let sends=0;
  const adapter={send:async()=>++sends===1?await firstPromise:await secondPromise,reconcile:async()=>({status:'uncertain'})};
  const first=f.flow.dispatchOne(adapter,true);await new Promise(r=>setImmediate(r));f.advance(6*60000);f.flow.maintenance();
  w=f.flow.get('owner',w.id);w=f.update(w,'record_delivery_evidence',{outcome:'not_sent',provider_id:'fixture-first',evidence:'Provider confirmed first attempt did not execute'},'owner');
  f.update(w,'retry_delivery',{reason:'Known non-send reviewed'},'owner');const second=f.flow.dispatchOne(adapter,true);await new Promise(r=>setImmediate(r));
  releaseFirst({status:'verified',providerId:'stale',evidence:'Late result'});await first;assert.equal(f.flow.get('owner',w.id).state,'delivering');
  releaseSecond({status:'not_sent',error:'Second preflight rejected'});await second;assert.equal(f.flow.get('owner',w.id).state,'delivery_not_sent');
});

test('an unresolved first receipt cannot starve reconciliation of later workflows',async()=>{
  const f=fixture();const a=seed(f),b=f.create();f.queue(f.ready(a));f.queue(f.ready(b));f.stop(false);
  const adapter={send:async()=>({status:'accepted',providerId:'fixture',evidence:'Accepted only'}),reconcile:async()=>({status:'uncertain'})};
  await f.flow.dispatchOne(adapter,true);await f.flow.dispatchOne(adapter,true);const one=await f.flow.reconcileOne(adapter),two=await f.flow.reconcileOne(adapter);assert.notEqual(one.id,two.id);
});

test('destination change after approval blocks dispatch without a new approval',async()=>{
  const f=fixture();const w=seed(f);f.queue(f.ready(w));f.stop(false);
  const changed=new CustomerWorkflow(f.db,()=>Date.parse('2026-11-11T18:00:00Z'),()=> 'different-sender@fixture.example');let calls=0;
  await assert.rejects(()=>changed.dispatchOne({send:async()=>{calls++;return {status:'verified'};},reconcile:async()=>({status:'uncertain'})},true),e=>e.code==='DESTINATION_CHANGED');assert.equal(calls,0);
});

test('SQLite backup restores unchanged approval evidence and durable pending delivery',async()=>{
  const f=fixture();const w=seed(f);f.queue(f.ready(w));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vtm-backup-')),filename=path.join(dir,'restore.db');
  await f.db.backup(filename);const restored=new Database(filename);const flow=new CustomerWorkflow(restored,()=>Date.parse('2026-11-11T18:00:00Z'),()=> 'sender@fixture.example');
  assert.deepEqual(flow.get('owner',w.id),f.flow.get('owner',w.id));assert.equal(restored.prepare('SELECT state FROM cw_outbox').get().state,'queued');assert.equal(restored.pragma('integrity_check',{simple:true}),'ok');restored.close();fs.rmSync(dir,{recursive:true});
});

test('real adapter and core synchronize owner non-send evidence before authorized SMTP retry',async()=>{
  const f=fixture();let w=seed(f);f.queue(f.ready(w));f.stop(false);let sends=0;
  const adapter=createDeliveryAdapter({enabled:true,env:{SMTP_HOST:'smtp.fixture.example',MAIL_FROM:'sender@fixture.example'},store:createSqliteDeliveryStore(f.db),beforeMutation:r=>f.flow.assertDispatchAllowed(r),smtpFactory:()=>({sendMail:async m=>{sends++;if(sends===1)throw new Error('Ambiguous fake response');return {messageId:m.messageId,accepted:[m.to],rejected:[]};}})});
  assert.equal((await f.flow.dispatchOne(adapter,true)).state,'uncertain');w=f.flow.get('owner',w.id);
  w=f.update(w,'record_delivery_evidence',{outcome:'not_sent',provider_id:'fixture-provider-record',evidence:'Provider trace confirms no recipient submission for this exact attempt.'},'owner');
  f.update(w,'retry_delivery',{reason:'Non-send verified, exact same action approved again'},'owner');await f.flow.synchronizeAdjudications(adapter);
  assert.equal((await f.flow.dispatchOne(adapter,true)).state,'accepted');assert.equal(sends,2);await f.flow.synchronizeAdjudications(adapter);assert.equal((await f.flow.dispatchOne(adapter,true)).state,'idle');
});

test('real Ghost adapter checks stop again after asynchronous preflight',async()=>{
  const f=fixture();let w=seed(f);w=f.qa(f.design(f.produce(f.research(w),{channel:'ghost',payload:{title:'Fiktiver Artikel',html:'<p>Fiktiver Inhalt.</p>'}})));
  w=f.update(w,'approve_content',{revision_hash:w.revision_hash,evidence:'Fixture owner'},'owner');w=f.update(w,'record_customer_approval',{revision_hash:w.revision_hash,approver:'editor@fixture-a.example',evidence:'Fixture customer'},'owner');f.queue(w);f.stop(false);let writes=0;
  const adapter=createDeliveryAdapter({enabled:true,env:{GHOST_ADMIN_URL:'https://ghost.fixture.example',GHOST_ADMIN_API_KEY:`${'a'.repeat(24)}:${'b'.repeat(64)}`},store:createSqliteDeliveryStore(f.db),beforeMutation:r=>f.flow.assertDispatchAllowed(r),fetch:async(_url,init)=>{if(init.method!=='GET')writes++;f.stop(true);return new Response('{}',{status:404});}});
  assert.equal((await f.flow.dispatchOne(adapter,true)).state,'not_sent');assert.equal(writes,0);
});

test('real adapter rejects a different configured sender than sealed approval',async()=>{
  const f=fixture();const w=seed(f);f.queue(f.ready(w));f.stop(false);let writes=0;
  const adapter=createDeliveryAdapter({enabled:true,env:{SMTP_HOST:'smtp.fixture.example',MAIL_FROM:'other-sender@fixture.example'},store:createSqliteDeliveryStore(f.db),beforeMutation:r=>f.flow.assertDispatchAllowed(r),smtpFactory:()=>({sendMail:async()=>{writes++;return {};}})});
  assert.equal((await f.flow.dispatchOne(adapter,true)).state,'not_sent');assert.equal(writes,0);
});

test('declared campaign asset roles cannot be omitted or duplicated at design handoff',()=>{
  const f=fixture();let w=seed(f);w=f.produce(f.research(w),{required_asset_roles:['cover','quote-card']});const c=f.claim(w);
  const asset=role=>({role,uri:`fixture://${role}`,sha256:'a'.repeat(64)});
  for(const assets of [[],[asset('cover')],[asset('cover'),asset('cover'),asset('quote-card')]]) {
    rejects(()=>f.update(c,'submit_design',{lease_token:c.lease_token,assets,notes:'Incomplete fixture'}),'QUALITY_GATE');
    assert.equal(f.flow.get('mika',w.id).state,'designing');
  }
  const ready=f.update(c,'submit_design',{lease_token:c.lease_token,assets:[asset('cover'),asset('quote-card')],notes:'Complete fixture references'});
  assert.equal(ready.state,'qa');
  const content=JSON.parse(ready.content_json);
  assert.deepEqual(content.required_asset_roles,['cover','quote-card']);
  assert.deepEqual(content.assets.map(a=>a.role),['cover','quote-card']);
});

test('duplicate mandatory asset roles are invalid rather than silently deduplicated',()=>{
  const f=fixture();const w=f.research(seed(f));
  rejects(()=>f.produce(w,{required_asset_roles:['cover','cover']}),'INVALID_INPUT');
});

test('work queue polls only current unleased own stages and honors customer access',()=>{
  const f=fixture();let w=seed(f);
  assert.deepEqual(f.call('artur','work_queue').map(x=>x.id),[w.id]);
  assert.deepEqual(f.call('mika','work_queue'),[]);
  const c=f.claim(w);assert.deepEqual(f.call('artur','work_queue'),[]);
  f.advance(31*60000);assert.equal(f.call('artur','work_queue')[0].version,c.version);
  w=f.research(f.flow.get('artur',w.id));w=f.produce(w);
  assert.deepEqual(f.call('artur','work_queue'),[]);
  const entry=f.call('mika','work_queue')[0];assert.equal(entry.id,w.id);assert.equal(entry.version,w.version);
  assert.deepEqual(Object.keys(entry).sort(),['customer_id','id','state','updated_at','version']);
  f.db.prepare('UPDATE cw_customers SET workers=? WHERE id=?').run(JSON.stringify(['artur','juergen']),w.customer_id);
  assert.deepEqual(f.call('mika','work_queue'),[]);
  rejects(()=>f.call('kalli','work_queue'),'FORBIDDEN');
});
