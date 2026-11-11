import { createHash, randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Actor } from "./operations";
import type { DeliveryAdapter, DeliveryRequest, DeliveryResult } from "./customer-delivery";

type Input = Record<string, unknown>;
type Customer = { id: string; name: string; approvers: string; workers: string };
type Source = { customer_id: string; id: string; locator: string; excerpt: string; kind: string; valid_until: string; evidence: string; digest: string; revoked: number };
export type Workflow = {
  id: string; customer_id: string; title: string; brief: string; state: string; version: number;
  assignee: Actor; revision_hash: string | null; content_json: string | null; research_json: string | null;
  qa_json: string | null; owner_approval_json: string | null; customer_approval_json: string | null;
  lease_hash?: string | null; lease_until: number | null; created_at: string; updated_at: string;
};
type Outbox = { id: string; workflow_id: string; customer_id: string; revision_hash: string; channel: "email" | "ghost"; payload: string; payload_hash: string; state: string; idempotency_key: string; result: string | null; started_at: number | null; attempts: number; last_reconciled_at: number };
export class WorkflowError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
function fail(code: string, message: string): never { throw new WorkflowError(code, message); }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Input)[k])}`).join(",")}}`;
  if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) fail("INVALID_INPUT", "Ungültiger JSON-Wert.");
  return JSON.stringify(value);
}
export const workflowHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const textHash = (value: string) => createHash("sha256").update(value).digest("hex");
const allowedActors: Actor[] = ["owner", "juergen", "natalie", "artur", "mika"];
const checksRequired = ["factual_accuracy", "source_coverage", "quotes_exact", "editorial_value", "brand_and_format", "visual_export", "customer_isolation"];
const txt = (i: Input, k: string, max = 20000): string => {
  const v = i[k]; if (typeof v !== "string" || !v.trim() || v.length > max) fail("INVALID_INPUT", `${k}: gültiger Text erforderlich.`); return v.trim();
};
const obj = (v: unknown): Input => { if (!v || typeof v !== "object" || Array.isArray(v)) fail("INVALID_INPUT", "Objekt erforderlich."); return v as Input; };
const list = (v: unknown, max = 100): unknown[] => { if (!Array.isArray(v) || v.length > max) fail("INVALID_INPUT", "Begrenzte Liste erforderlich."); return v; };
const strings = (v: unknown): string[] => list(v).map(x => { if (typeof x !== "string" || !x.trim() || x.length > 200) fail("INVALID_INPUT", "Ungültiger Listenwert."); return x; });
const manager = (a: Actor) => { if (!["owner", "juergen"].includes(a)) fail("FORBIDDEN", "Nur Inhaber oder Jürgen."); };
const owner = (a: Actor) => { if (a !== "owner") fail("FORBIDDEN", "Diese Freigabe bleibt bei Max."); };
const email = (v: string) => /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(v) && !/[\r\n]/.test(v);
const parse = <T>(v: string | null, fallback: T): T => v ? JSON.parse(v) as T : fallback;
const berlin = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

/** Additive workflow. Does not create identities, install schedulers or activate delivery. */
export class CustomerWorkflow {
  constructor(private db: Database.Database, private clock = () => Date.now(), private targetResolver = (channel: string): string | null => channel === "email" ? process.env.MAIL_FROM ?? process.env.SMTP_USER ?? null : process.env.GHOST_ADMIN_URL ?? null) {
    db.pragma("foreign_keys = ON"); db.pragma("busy_timeout = 5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS cw_customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, approvers TEXT NOT NULL, workers TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cw_sources (customer_id TEXT NOT NULL REFERENCES cw_customers(id), id TEXT NOT NULL, locator TEXT NOT NULL, excerpt TEXT NOT NULL, kind TEXT NOT NULL, valid_until TEXT NOT NULL, evidence TEXT NOT NULL, digest TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(customer_id,id));
      CREATE TABLE IF NOT EXISTS cw_workflows (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES cw_customers(id), title TEXT NOT NULL, brief TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, assignee TEXT NOT NULL, revision_hash TEXT, content_json TEXT, research_json TEXT, qa_json TEXT, owner_approval_json TEXT, customer_approval_json TEXT, lease_hash TEXT, lease_until INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cw_intake (source_kind TEXT NOT NULL, source_id TEXT NOT NULL, customer_id TEXT NOT NULL, fingerprint TEXT NOT NULL, workflow_id TEXT NOT NULL REFERENCES cw_workflows(id), PRIMARY KEY(source_kind,source_id));
      CREATE TABLE IF NOT EXISTS cw_requests (actor TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(actor,request_key));
      CREATE TABLE IF NOT EXISTS cw_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, workflow_id TEXT, customer_id TEXT, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cw_outbox (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES cw_workflows(id), customer_id TEXT NOT NULL, revision_hash TEXT NOT NULL, channel TEXT NOT NULL, payload TEXT NOT NULL, payload_hash TEXT NOT NULL, state TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, result TEXT, started_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, last_reconciled_at INTEGER NOT NULL DEFAULT 0, authorized_by TEXT NOT NULL, authorization TEXT NOT NULL, UNIQUE(workflow_id,revision_hash));
      CREATE TABLE IF NOT EXISTS cw_signals (workflow_id TEXT NOT NULL REFERENCES cw_workflows(id), version INTEGER NOT NULL, assignee TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workflow_id,version));
      CREATE TABLE IF NOT EXISTS cw_reports (day TEXT PRIMARY KEY, body TEXT NOT NULL, generated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cw_health (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    if (!(db.prepare("PRAGMA table_info(cw_outbox)").all() as {name:string}[]).some(c=>c.name==="last_reconciled_at")) db.exec("ALTER TABLE cw_outbox ADD COLUMN last_reconciled_at INTEGER NOT NULL DEFAULT 0");
  }
  private now() { return new Date(this.clock()).toISOString(); }
  private event(actor: Actor, action: string, w: Workflow | null, detail: unknown, customerId?: string) {
    this.db.prepare("INSERT INTO cw_events(workflow_id,customer_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)").run(w?.id ?? null, w?.customer_id ?? customerId ?? null, actor, action, canonical(detail), this.now());
  }
  private customer(actor: Actor, id: string): Customer {
    const c = this.db.prepare("SELECT * FROM cw_customers WHERE id=?").get(id) as Customer | undefined;
    if (!c || (actor !== "owner" && !parse<Actor[]>(c.workers, []).includes(actor))) fail("NOT_FOUND", "Kunde nicht verfügbar.");
    return c;
  }
  customers(actor: Actor) { this.validActor(actor); return (this.db.prepare("SELECT * FROM cw_customers ORDER BY name").all() as Customer[]).filter(c => actor === "owner" || parse<Actor[]>(c.workers, []).includes(actor)); }
  list(actor: Actor, customerId?: string) { this.validActor(actor); if (customerId) this.customer(actor, customerId); const ids = new Set(this.customers(actor).map(c => c.id)); return (this.db.prepare("SELECT * FROM cw_workflows ORDER BY updated_at DESC,id").all() as Workflow[]).filter(w => ids.has(w.customer_id) && (!customerId || w.customer_id === customerId)).map(w => this.safe(w)); }
  get(actor: Actor, id: string) { this.validActor(actor); return this.safe(this.raw(actor, id)); }
  private raw(actor: Actor, id: string): Workflow { const w = this.db.prepare("SELECT * FROM cw_workflows WHERE id=?").get(id) as Workflow | undefined; if (!w) fail("NOT_FOUND", "Vorgang nicht verfügbar."); this.customer(actor, w.customer_id); return w; }
  private safe(w: Workflow): Workflow { const { lease_hash, ...safe } = w; void lease_hash; return safe; }
  private validActor(a: Actor) { if (!allowedActors.includes(a)) fail("FORBIDDEN", "Unbekannte Rolle."); }
  events(actor: Actor, id: string) { this.raw(actor, id); return this.db.prepare("SELECT seq,actor,action,detail,created_at FROM cw_events WHERE workflow_id=? ORDER BY seq").all(id); }
  status(actor: Actor) {
    const workflows = this.list(actor); const ids = new Set(workflows.map(w => w.id));
    const deliveries = (this.db.prepare("SELECT id,workflow_id,state,result FROM cw_outbox").all() as Pick<Outbox,"id"|"workflow_id"|"state"|"result">[]).filter(o => ids.has(o.workflow_id));
    const lastTick = this.db.prepare("SELECT value FROM cw_health WHERE key='last_tick'").get() as {value:string}|undefined;
    return { externalStop: this.stopped(), schedulerLastTick: lastTick?.value ?? null, schedulerInstalled: false, workChatWakeupConnected: false, deliveryEnabled: process.env.CUSTOMER_DELIVERY_ENABLED === "true", workflows: workflows.length, deliveries, reports: actor === "owner" ? this.db.prepare("SELECT * FROM cw_reports ORDER BY day DESC LIMIT 7").all() : [] };
  }
  tools(actor: Actor) {
    this.validActor(actor);
    const actions = ["list_workflows", "get_workflow", "list_customers", "workflow_status", "list_sources", "workflow_events", "claim_stage", "submit_research", "submit_production", "submit_design", "submit_qa"];
    if (["owner","juergen","natalie"].includes(actor)) actions.push("intake");
    if (["owner","juergen"].includes(actor)) actions.push("register_source", "revoke_source", "request_revision", "cancel_workflow");
    if (actor === "owner") actions.push("register_customer", "approve_content", "record_customer_approval", "authorize_delivery", "record_delivery_evidence", "retry_delivery");
    return actions;
  }
  call(actor: Actor, action: string, input: Input = {}): unknown {
    if (!this.tools(actor).includes(action)) fail("FORBIDDEN", "Aktion für diese Rolle nicht verfügbar.");
    if (action === "list_workflows") return this.list(actor, input.customer_id ? txt(input,"customer_id",100) : undefined);
    if (action === "get_workflow") return this.get(actor, txt(input,"id",100));
    if (action === "list_customers") return this.customers(actor);
    if (action === "workflow_status") return this.status(actor);
    if (action === "workflow_events") return this.events(actor,txt(input,"id",100));
    if (action === "list_sources") { const id=txt(input,"customer_id",100); this.customer(actor,id); return this.db.prepare("SELECT * FROM cw_sources WHERE customer_id=? ORDER BY id").all(id); }
    const key = txt(input,"request_key",200); const fingerprint = workflowHash({action,input});
    return this.db.transaction(() => {
      const prior = this.db.prepare("SELECT * FROM cw_requests WHERE actor=? AND request_key=?").get(actor,key) as {fingerprint:string;response:string}|undefined;
      if (prior) { if (prior.fingerprint !== fingerprint) fail("CONFLICT","Wiederholungsschlüssel mit anderem Inhalt."); return JSON.parse(prior.response); }
      const result = this.mutate(actor,action,input);
      this.db.prepare("INSERT INTO cw_requests VALUES(?,?,?,?)").run(actor,key,fingerprint,canonical(result));
      return result;
    }).immediate();
  }
  private save(actor: Actor, action: string, w: Workflow, fields: Partial<Workflow>, detail: unknown = {}) {
    const allowed = new Set(["state","assignee","revision_hash","content_json","research_json","qa_json","owner_approval_json","customer_approval_json","lease_hash","lease_until"]);
    if (Object.keys(fields).some(k=>!allowed.has(k))) fail("INVALID_INPUT","Ungültige interne Änderung.");
    const changed = this.db.prepare(`UPDATE cw_workflows SET ${Object.keys(fields).map(k=>`${k}=?`).join(",")},version=version+1,updated_at=? WHERE id=? AND version=?`).run(...Object.values(fields),this.now(),w.id,w.version).changes;
    if (changed !== 1) fail("CONFLICT","Vorgang wurde inzwischen geändert.");
    const next = this.raw(actor,w.id);
    this.event(actor,action,next,{...obj(detail),version:next.version,state:next.state});
    if (["researching","producing","designing","qa"].includes(next.state)) this.db.prepare("INSERT OR IGNORE INTO cw_signals VALUES(?,?,?,?)").run(next.id,next.version,next.assignee,this.now());
    return this.safe(next);
  }
  private sources(w: Workflow): Source[] {
    const research=parse<{sources:{id:string;digest:string}[]}>(w.research_json,{sources:[]});
    if (!research.sources.length) fail("QUALITY_GATE","Keine geprüften Quellen vorhanden.");
    return research.sources.map(s=>{ const source=this.db.prepare("SELECT * FROM cw_sources WHERE customer_id=? AND id=?").get(w.customer_id,s.id) as Source|undefined;
      if (!source || source.revoked || source.digest!==s.digest || Date.parse(source.valid_until)<=this.clock()) fail("SOURCE_INVALID","Quelle fehlt, ist widerrufen oder abgelaufen. Neu recherchieren."); return source; });
  }
  private approvals(w: Workflow) {
    this.sources(w);
    const content=parse<Input>(w.content_json,{});
    if(!content.delivery_target || content.delivery_target!==this.targetResolver(String(content.channel)))fail("DESTINATION_CHANGED","Versandabsender oder Publikationsziel fehlt oder wurde nach Prüfung geändert. Neue Fassung erforderlich.");
    const ownerApproval=parse<Input>(w.owner_approval_json,{}), customerApproval=parse<Input>(w.customer_approval_json,{});
    if (!w.revision_hash || ownerApproval.revision_hash!==w.revision_hash || customerApproval.revision_hash!==w.revision_hash) fail("APPROVAL_REQUIRED","Max und Kunde müssen exakt diese Fassung freigeben.");
  }
  private lease(actor: Actor,w: Workflow,i: Input) {
    if(actor!==w.assignee || !w.lease_until || w.lease_until<=this.clock() || textHash(txt(i,"lease_token",200))!==w.lease_hash) fail("LEASE_INVALID","Reservierung fehlt, ist abgelaufen oder gehört zu einer anderen Fassung.");
  }
  private mutate(actor: Actor, action: string, i: Input): unknown {
    if(action==="register_customer") {
      owner(actor); const id=txt(i,"customer_id",100), name=txt(i,"name",200);
      if(!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(id)) fail("INVALID_INPUT","Kunden-ID ungültig.");
      const approvers=strings(i.approvers).map(x=>x.toLowerCase()), workers=strings(i.workers) as Actor[];
      if(!approvers.length || approvers.some(x=>!email(x)) || workers.some(x=>!allowedActors.includes(x)||x==="owner")) fail("INVALID_INPUT","Kundenprüfer und freigegebene Rollen ausdrücklich angeben.");
      if(this.db.prepare("SELECT 1 FROM cw_customers WHERE id=?").get(id)) fail("CONFLICT","Kunde bereits angelegt. Zugriffe nicht still überschreiben.");
      this.db.prepare("INSERT INTO cw_customers VALUES(?,?,?,?)").run(id,name,canonical([...new Set(approvers)]),canonical([...new Set(workers)]));
      this.event(actor,action,null,{id,name,workers},id); return {id,name};
    }
    if(action==="register_source" || action==="revoke_source") {
      manager(actor); const customerId=txt(i,"customer_id",100); this.customer(actor,customerId); const id=txt(i,"source_id",200);
      if(action==="revoke_source") { const reason=txt(i,"reason",2000); if(!this.db.prepare("UPDATE cw_sources SET revoked=1 WHERE customer_id=? AND id=?").run(customerId,id).changes) fail("NOT_FOUND","Quelle fehlt."); this.event(actor,action,null,{source_id:id,reason},customerId); return {id,revoked:true}; }
      const source={locator:txt(i,"locator",2000),excerpt:txt(i,"excerpt"),kind:txt(i,"kind",30),valid_until:txt(i,"valid_until",40),evidence:txt(i,"evidence",4000)};
      if(!["provider","primary","independent","editorial"].includes(source.kind) || !/(Z|[+-]\d{2}:\d{2})$/.test(source.valid_until) || !(Date.parse(source.valid_until)>this.clock())) fail("INVALID_INPUT","Quellenart oder Gültigkeit ungültig.");
      if(this.db.prepare("SELECT 1 FROM cw_sources WHERE customer_id=? AND id=?").get(customerId,id)) fail("CONFLICT","Quellen unveränderlich versionieren; neue ID verwenden.");
      this.db.prepare("INSERT INTO cw_sources(customer_id,id,locator,excerpt,kind,valid_until,evidence,digest) VALUES(?,?,?,?,?,?,?,?)").run(customerId,id,source.locator,source.excerpt,source.kind,source.valid_until,source.evidence,workflowHash(source));
      this.event(actor,action,null,{source_id:id,digest:workflowHash(source)},customerId); return {id,digest:workflowHash(source)};
    }
    if(action==="intake") {
      const customerId=txt(i,"customer_id",100); const c=this.customer(actor,customerId); const sourceKind=txt(i,"source_kind",20), sourceId=txt(i,"source_id",500), title=txt(i,"title",200),brief=txt(i,"brief");
      if(!["mail","portal"].includes(sourceKind)) fail("INVALID_INPUT","Unbekannter Eingang.");
      if(!parse<Actor[]>(c.workers,[]).includes("artur") || !parse<Actor[]>(c.workers,[]).includes("juergen") || !parse<Actor[]>(c.workers,[]).includes("mika")) fail("NOT_CONFIGURED","Artur, Mika und Jürgen sind für diesen Kunden noch nicht freigegeben.");
      const fingerprint=workflowHash({customerId,sourceKind,sourceId,title,brief});
      const prior=this.db.prepare("SELECT * FROM cw_intake WHERE source_kind=? AND source_id=?").get(sourceKind,sourceId) as {fingerprint:string;workflow_id:string}|undefined;
      if(prior) { if(prior.fingerprint!==fingerprint) fail("CONFLICT","Eingang bereits anders zugeordnet; manuelle Klärung statt Dublette."); return this.get(actor,prior.workflow_id); }
      const id=randomUUID(); this.db.prepare("INSERT INTO cw_workflows(id,customer_id,title,brief,state,assignee,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(id,customerId,title,brief,"researching","artur",this.now(),this.now());
      this.db.prepare("INSERT INTO cw_intake VALUES(?,?,?,?,?)").run(sourceKind,sourceId,customerId,fingerprint,id);
      const w=this.raw(actor,id); this.event(actor,action,w,{source_kind:sourceKind,source_id:sourceId,sourceIsDataNotAuthorization:true}); this.db.prepare("INSERT INTO cw_signals VALUES(?,?,?,?)").run(id,1,"artur",this.now()); return this.safe(w);
    }
    const w=this.raw(actor,txt(i,"id",100)); if(i.version!==w.version) fail("CONFLICT","Vorgang inzwischen geändert. Aktuelle Version lesen.");
    if(action==="claim_stage") {
      if(actor!==w.assignee || !["researching","producing","designing","qa"].includes(w.state)) fail("FORBIDDEN","Rolle oder Produktionsstufe passt nicht.");
      if(w.lease_until && w.lease_until>this.clock()) fail("CONFLICT","Stufe bereits reserviert.");
      const lease=randomBytes(32).toString("base64url"); const next=this.save(actor,action,w,{lease_hash:textHash(lease),lease_until:this.clock()+30*60000}); return {...next,lease_token:lease};
    }
    if(["submit_research","submit_production","submit_design","submit_qa"].includes(action)) {
      this.lease(actor,w,i);
      if(action==="submit_research") {
        if(w.state!=="researching") fail("CONFLICT","Keine Recherche ausstehend."); const ids=strings(i.source_ids); if(!ids.length) fail("QUALITY_GATE","Belegsammlung erforderlich.");
        const sources=ids.map(id=>{const s=this.db.prepare("SELECT * FROM cw_sources WHERE customer_id=? AND id=?").get(w.customer_id,id) as Source|undefined; if(!s || s.revoked || Date.parse(s.valid_until)<=this.clock()) fail("SOURCE_INVALID","Nur gültige kundeneigene Quellen."); return {id:s.id,digest:s.digest};});
        return this.save(actor,action,w,{state:"producing",assignee:"artur",research_json:canonical({sources,summary:txt(i,"summary"),researcher:actor}),lease_hash:null,lease_until:null},{source_ids:ids});
      }
      if(action==="submit_production") {
        if(w.state!=="producing") fail("CONFLICT","Keine Produktion ausstehend."); const sources=this.sources(w); const content=obj(i.content);
        if(Object.keys(content).some(k=>!["channel","payload","assets","claims","quality_requirements"].includes(k))) fail("INVALID_INPUT","Unbekanntes Inhaltsfeld.");
        const channel=txt(content,"channel",20), payload=obj(content.payload);
        if(!["email","ghost"].includes(channel)) fail("INVALID_INPUT","Nur E-Mail oder Ghost unterstützt.");
        const fields=channel==="email"?["to","subject","text","html"]:["title","html"];
        if(Object.keys(payload).some(k=>!fields.includes(k))) fail("INVALID_INPUT","Unbekanntes Versandfeld.");
        if(channel==="email") { if(!email(txt(payload,"to",320)) || /[\r\n]/.test(txt(payload,"subject",500))) fail("INVALID_INPUT","Empfänger oder Betreff ungültig."); if(!payload.text&&!payload.html) fail("INVALID_INPUT","Nachrichteninhalt fehlt."); }
        else { txt(payload,"title",500); txt(payload,"html",100000); }
        for(const [key,value] of Object.entries(payload)) if(typeof value!=="string"||value.length>100000||!value.trim()) fail("INVALID_INPUT",`${key}: ungültiger Inhalt.`);
        const assets=list(content.assets,30).map(v=>{const a=obj(v),uri=txt(a,"uri",2000),sha256=txt(a,"sha256",64);if(!/^[a-f0-9]{64}$/.test(sha256)) fail("INVALID_INPUT","Export-Prüfsumme fehlt.");return {uri,sha256};});
        const claims=list(content.claims,200).map(v=>{const c=obj(v),sourceId=txt(c,"source_id",200),kind=txt(c,"kind",30);const s=sources.find(s=>s.id===sourceId);if(!s||!["provider","primary","independent","editorial"].includes(kind)||s.kind!==kind)fail("QUALITY_GATE","Aussage und Quellenart passen nicht zusammen.");return {text:txt(c,"text",4000),source_id:sourceId,kind};});
        if(!claims.length) fail("QUALITY_GATE","Aussagen mit Quellenbezug erforderlich.");
        const extra=strings(content.quality_requirements??[]); const sealed={channel,payload,delivery_target:this.targetResolver(channel),assets,claims,quality_requirements:[...new Set([...checksRequired,...extra])],producer:actor};
        const revision=workflowHash({customer_id:w.customer_id,content:sealed,research:JSON.parse(w.research_json!)});
        return this.save(actor,action,w,{state:"designing",assignee:"mika",content_json:canonical(sealed),revision_hash:revision,qa_json:null,owner_approval_json:null,customer_approval_json:null,lease_hash:null,lease_until:null},{revision_hash:revision});
      }
      if(action==="submit_design") {
        if(w.state!=="designing")fail("CONFLICT","Keine Gestaltung ausstehend.");this.sources(w);
        const content=parse<Input>(w.content_json,{});
        const assets=list(i.assets,30).map(v=>{const a=obj(v),uri=txt(a,"uri",2000),sha256=txt(a,"sha256",64);if(!/^[a-f0-9]{64}$/.test(sha256))fail("INVALID_INPUT","Export-Prüfsumme fehlt.");return {uri,sha256};});
        const sealed={...content,assets,designer:actor,design_notes:txt(i,"notes",4000)};
        const revision=workflowHash({customer_id:w.customer_id,content:sealed,research:JSON.parse(w.research_json!)});
        return this.save(actor,action,w,{state:"qa",assignee:"juergen",content_json:canonical(sealed),revision_hash:revision,lease_hash:null,lease_until:null},{revision_hash:revision});
      }
      if(w.state!=="qa") fail("CONFLICT","Keine Qualitätsprüfung ausstehend."); this.sources(w); const content=parse<Input>(w.content_json,{});
      if(actor===content.producer) fail("FORBIDDEN","Produktion darf sich nicht selbst abnehmen."); const required=strings(content.quality_requirements);
      const checks=list(i.checks,100).map(v=>{const c=obj(v);if(typeof c.passed!=="boolean")fail("INVALID_INPUT","Prüfergebnis muss wahr oder falsch sein.");return {criterion:txt(c,"criterion",200),passed:c.passed,evidence:txt(c,"evidence",4000)};});
      if(new Set(checks.map(c=>c.criterion)).size!==checks.length || required.some(k=>!checks.some(c=>c.criterion===k)))fail("QUALITY_GATE","Pflichtprüfungen fehlen oder sind doppelt.");
      const passed=checks.every(c=>c.passed); return this.save(actor,action,w,{state:passed?"owner_review":"producing",assignee:passed?"juergen":"artur",qa_json:canonical({reviewer:actor,revision_hash:w.revision_hash,checks,notes:txt(i,"notes",4000)}),lease_hash:null,lease_until:null},{passed,revision_hash:w.revision_hash});
    }
    if(action==="approve_content" || action==="record_customer_approval" || action==="authorize_delivery") {
      owner(actor);this.sources(w);if(txt(i,"revision_hash",64)!==w.revision_hash)fail("CONFLICT","Freigabe gilt nicht für diese Fassung.");
      if(action==="approve_content") { if(w.state!=="owner_review")fail("CONFLICT","Fach-/Qualitätsprüfung fehlt.");const qa=parse<Input>(w.qa_json,{});if(qa.revision_hash!==w.revision_hash)fail("QUALITY_GATE","Qualitätsprüfung gehört zu anderer Fassung.");return this.save(actor,action,w,{state:"customer_review",owner_approval_json:canonical({revision_hash:w.revision_hash,evidence:txt(i,"evidence",4000),actor,at:this.now()})},{revision_hash:w.revision_hash}); }
      if(action==="record_customer_approval") { if(w.state!=="customer_review")fail("CONFLICT","Max muss zuerst exakt diese Fassung freigeben.");const approver=txt(i,"approver",320).toLowerCase();const c=this.customer(actor,w.customer_id);if(!parse<string[]>(c.approvers,[]).includes(approver))fail("FORBIDDEN","Nicht der festgelegte Kundenprüfer.");return this.save(actor,action,w,{state:"ready_delivery",customer_approval_json:canonical({revision_hash:w.revision_hash,approver,evidence:txt(i,"evidence",4000),recorded_by:actor,at:this.now()})},{revision_hash:w.revision_hash,approver}); }
      if(w.state!=="ready_delivery")fail("CONFLICT","Noch nicht zur Auslieferung bereit.");this.approvals(w);const confirmation=txt(i,"confirmation",4000);const content=parse<Input>(w.content_json,{}),payload=obj(content.payload);
      const previous=this.db.prepare("SELECT * FROM cw_outbox WHERE workflow_id=? AND revision_hash=?").get(w.id,w.revision_hash) as Outbox|undefined;
      if(previous&&!["cancelled","not_sent"].includes(previous.state))fail("RECONCILE_REQUIRED","Diese Fassung hat bereits einen Ausführungsversuch.");
      const id=previous?.id??randomUUID();
      if(previous)this.db.prepare("UPDATE cw_outbox SET state='queued',started_at=NULL,authorization=?,authorized_by=? WHERE id=?").run(confirmation,actor,id);
      else this.db.prepare("INSERT INTO cw_outbox(id,workflow_id,customer_id,revision_hash,channel,payload,payload_hash,state,idempotency_key,authorized_by,authorization) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id,w.id,w.customer_id,w.revision_hash,String(content.channel),canonical(payload),workflowHash(payload),"queued",`cw-${w.id}-${w.revision_hash}`,actor,confirmation);
      return this.save(actor,action,w,{state:"delivery_queued"},{outbox_id:id,revision_hash:w.revision_hash,externalEffectPerformed:false});
    }
    if(action==="request_revision" || action==="cancel_workflow") {
      manager(actor);const reason=txt(i,"reason",4000); if(["completed","cancelled"].includes(w.state))fail("CONFLICT","Vorgang bereits abgeschlossen.");
      const unsafe=this.db.prepare("SELECT 1 FROM cw_outbox WHERE workflow_id=? AND state IN ('sending','uncertain','accepted','verified')").get(w.id); if(unsafe)fail("RECONCILE_REQUIRED","Externe Aktion zuerst abgleichen. Nicht still überschreiben.");
      this.db.prepare("UPDATE cw_outbox SET state='cancelled' WHERE workflow_id=? AND state IN ('queued','not_sent')").run(w.id);
      return this.save(actor,action,w,{state:action==="cancel_workflow"?"cancelled":"researching",assignee:"artur",revision_hash:null,content_json:null,research_json:null,qa_json:null,owner_approval_json:null,customer_approval_json:null,lease_hash:null,lease_until:null},{reason});
    }
    if(action==="record_delivery_evidence") {
      owner(actor);const o=this.db.prepare("SELECT * FROM cw_outbox WHERE workflow_id=? AND revision_hash=?").get(w.id,w.revision_hash) as Outbox|undefined;
      if(!o||!["uncertain","accepted"].includes(o.state))fail("CONFLICT","Kein ungeklärter Versand vorhanden.");
      const evidence=txt(i,"evidence",4000),providerId=txt(i,"provider_id",500),outcome=txt(i,"outcome",30);
      if(!["verified","not_sent"].includes(outcome))fail("INVALID_INPUT","Nachweis muss zugestellt/veröffentlicht oder sicher nicht ausgeführt belegen.");
      this.db.prepare("UPDATE cw_outbox SET state=?,result=? WHERE id=?").run(outcome,canonical({status:outcome,evidence,providerId,recordedBy:actor}),o.id);
      return this.save(actor,action,w,{state:outcome==="verified"?"completed":"delivery_not_sent"},{outbox_id:o.id,outcome,evidence,provider_id:providerId});
    }
    if(action==="retry_delivery") {
      owner(actor);this.approvals(w);if(w.state!=="delivery_not_sent")fail("RECONCILE_REQUIRED","Nur nachweislich nicht ausgeführte Aktion wiederholen.");txt(i,"reason",4000);
      const changed=this.db.prepare("UPDATE cw_outbox SET state='queued',started_at=NULL WHERE workflow_id=? AND revision_hash=? AND state='not_sent'").run(w.id,w.revision_hash).changes;if(changed!==1)fail("CONFLICT","Keine wiederholbare Aktion.");return this.save(actor,action,w,{state:"delivery_queued"},{reason:i.reason});
    }
    fail("INVALID_INPUT","Unbekannte Aktion.");
  }
  private stopped() {
    const has=this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ops_settings'").get();
    if(!has)return true;const r=this.db.prepare("SELECT value FROM ops_settings WHERE key='external_stop'").get() as {value:string}|undefined;return r?.value!=="0";
  }
  private request(o: Outbox): DeliveryRequest { return {id:o.id,idempotencyKey:o.idempotency_key,channel:o.channel,payload:JSON.parse(o.payload),payloadHash:o.payload_hash,attempt:o.attempts,destination:String(parse<Input>(this.raw("owner",o.workflow_id).content_json,{}).delivery_target??"")}; }
  /** Invoked by the adapter immediately before every SMTP submission / Ghost mutation. */
  assertDispatchAllowed(request: DeliveryRequest) {
    const o=this.db.prepare("SELECT * FROM cw_outbox WHERE id=?").get(request.id) as Outbox|undefined;
    if(!o||o.state!=="sending"||o.attempts!==request.attempt||o.idempotency_key!==request.idempotencyKey||o.payload_hash!==request.payloadHash)fail("CONFLICT","Ausführungsversuch nicht mehr aktuell.");
    if(this.stopped())fail("STOPPED","Externe Aktionen angehalten.");
    const w=this.raw("owner",o.workflow_id);if(w.state!=="delivering"||w.revision_hash!==o.revision_hash)fail("CONFLICT","Fassung nicht mehr aktuell.");this.approvals(w);
  }
  /** Bridge only an explicit owner adjudication into the separate adapter journal; no network I/O. */
  async synchronizeAdjudications(adapter: DeliveryAdapter) {
    if(!adapter.adjudicate)return;
    const rows=this.db.prepare("SELECT * FROM cw_outbox WHERE state IN ('not_sent','queued','verified') AND result IS NOT NULL").all() as Outbox[];
    for(const o of rows){const result=parse<DeliveryResult&{recordedBy?:string}>(o.result,{status:"uncertain"});if(result.recordedBy==="owner")await adapter.adjudicate(this.request(o),result);}
  }
  /** Internal worker only, not an MCP tool. Every external call is preceded by sealed approvals and stop check. */
  async dispatchOne(adapter: DeliveryAdapter, enabled = false): Promise<{state:string;id?:string}> {
    if(!enabled)return {state:"disabled"};
    const selected=this.db.transaction(()=>{
      if(this.stopped())return null;
      const o=this.db.prepare("SELECT * FROM cw_outbox WHERE state='queued' ORDER BY rowid LIMIT 1").get() as Outbox|undefined;if(!o)return null;
      const w=this.raw("owner",o.workflow_id);
      if(w.state!=="delivery_queued" || w.revision_hash!==o.revision_hash)fail("CONFLICT","Versandfassung nicht mehr aktuell.");this.approvals(w);
      if(workflowHash(JSON.parse(o.payload))!==o.payload_hash)fail("CONFLICT","Versandinhalt wurde verändert.");
      this.db.prepare("UPDATE cw_outbox SET state='sending',started_at=?,attempts=attempts+1 WHERE id=? AND state='queued'").run(this.clock(),o.id);
      this.save("owner","dispatch_started",w,{state:"delivering"},{outbox_id:o.id});return {...o,attempts:o.attempts+1};
    }).immediate();
    if(!selected)return {state:this.stopped()?"stopped":"idle"};
    let result: DeliveryResult;
    try {
      // Recheck at the effect boundary, not merely when work was reserved.
      const w=this.raw("owner",selected.workflow_id);this.approvals(w);
      if(this.stopped()||w.revision_hash!==selected.revision_hash)result={status:"not_sent",error:"Freigabe/Stopp unmittelbar vor Ausführung geändert."};
      else result=await adapter.send(this.request(selected));
    } catch { result={status:"uncertain",error:"Unklarer Ausgang. Vor Wiederholung abgleichen."}; }
    return {state:this.recordResult(selected,result),id:selected.id};
  }
  private recordResult(o: Outbox,result: DeliveryResult) {
    if(!["verified","accepted","uncertain","not_sent"].includes(result.status) || (result.status==="verified"&&(!result.providerId||!result.evidence)))result={status:"uncertain",error:"Ungültiger oder unvollständiger Ausführungsnachweis."};
    return this.db.transaction(()=>{
      const current=this.db.prepare("SELECT * FROM cw_outbox WHERE id=?").get(o.id) as Outbox;
      // A human reconciliation wins over a late network result.
      if(!["sending","uncertain","accepted"].includes(current.state)||current.attempts!==o.attempts)return current.state;
      if(current.state==="accepted"&&["uncertain","not_sent"].includes(result.status))return current.state;
      this.db.prepare("UPDATE cw_outbox SET state=?,result=? WHERE id=?").run(result.status,canonical(result),o.id);
      const w=this.raw("owner",o.workflow_id);const state=result.status==="verified"?"completed":result.status==="accepted"?"delivery_accepted":result.status==="not_sent"?"delivery_not_sent":"delivery_uncertain";
      this.save("owner","delivery_result",w,{state},{outbox_id:o.id,...result});return result.status;
    }).immediate();
  }
  async reconcileOne(adapter: DeliveryAdapter): Promise<{state:string;id?:string}> {
    const o=this.db.transaction(()=>{const next=this.db.prepare("SELECT * FROM cw_outbox WHERE state IN ('uncertain','accepted') ORDER BY last_reconciled_at,rowid LIMIT 1").get() as Outbox|undefined;if(next)this.db.prepare("UPDATE cw_outbox SET last_reconciled_at=? WHERE id=?").run(this.clock(),next.id);return next;}).immediate();if(!o)return {state:"idle"};
    let result: DeliveryResult;try {result=await adapter.reconcile(this.request(o));}catch{result={status:"uncertain",error:"Abgleich fehlgeschlagen; nicht erneut senden."};}
    return {state:this.recordResult(o,result),id:o.id};
  }
  /** Persist health, recover orphaned attempts, create truthful daily portal summary. Never sends or wakes a chat. */
  maintenance() {
    return this.db.transaction(()=>{
      const orphaned=this.db.prepare("SELECT * FROM cw_outbox WHERE state='sending' AND started_at<=?").all(this.clock()-5*60000) as Outbox[];
      for(const o of orphaned) {this.db.prepare("UPDATE cw_outbox SET state='uncertain',result=? WHERE id=?").run(canonical({status:"uncertain",error:"Ausführung unterbrochen; Abgleich erforderlich."}),o.id);const w=this.raw("owner",o.workflow_id);this.save("owner","recovered_uncertain",w,{state:"delivery_uncertain"},{outbox_id:o.id});}
      this.db.prepare("INSERT INTO cw_health VALUES('last_tick',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(this.now());
      const day=berlin(this.clock()),hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Berlin",hour:"2-digit",hourCycle:"h23"}).format(new Date(this.clock())));
      if(hour>=18) {const counts=this.db.prepare("SELECT state,COUNT(*) AS count FROM cw_workflows GROUP BY state ORDER BY state").all();this.db.prepare("INSERT INTO cw_reports VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET body=excluded.body,generated_at=excluded.generated_at").run(day,canonical({states:counts,externalDeliveryVerified:false,deliveryChannel:"portal_only",note:"accepted heißt SMTP-Annahme, nicht Empfängerzustellung. completed verlangt Nachweis."}),this.now());}
      return {recovered:orphaned.length,day,reportPresent:!!this.db.prepare("SELECT 1 FROM cw_reports WHERE day=?").get(day)};
    }).immediate();
  }
}
