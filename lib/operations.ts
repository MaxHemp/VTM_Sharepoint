import { createHash, randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type Actor = "owner" | "juergen" | "natalie" | "mika" | "artur";
type Input = Record<string, unknown>;
export type Job = {
  id: string; title: string; brief: string; criteria: string; assignee: Actor;
  category: string; state: string; version: number; dependencies: string;
  due_at: string | null; result: string | null; lease_hash: string | null;
  lease_until: number | null; created_at: string; updated_at: string;
};
export class OperationsError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const agents: Actor[] = ["owner", "juergen", "natalie", "mika", "artur"];
const external = ["email", "ghost", "invoice"];
const reserved = ["commercial", "initiative"];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fail(code: string, message: string): never { throw new OperationsError(code, message); }
function text(input: Input, name: string, max = 20000): string {
  const value = input[name];
  if (typeof value !== "string" || !value.trim() || value.length > max) fail("INVALID_INPUT", `${name}: Bitte einen gültigen Wert angeben.`);
  return value.trim();
}
function manager(actor: Actor) { if (actor !== "owner" && actor !== "juergen") fail("FORBIDDEN", "Nur die Geschäftsführung darf diese Aktion ausführen."); }
function owner(actor: Actor) { if (actor !== "owner") fail("FORBIDDEN", "Diese Entscheidung liegt beim Inhaber."); }
export function berlinDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Durable coordination only. No SMTP, Ghost or automatic chat execution. */
export class Operations {
  constructor(private db: Database.Database, private clock = () => Date.now()) {
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE IF NOT EXISTS ops_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO ops_settings VALUES ('external_stop','1');
      CREATE TABLE IF NOT EXISTS ops_jobs (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, brief TEXT NOT NULL, criteria TEXT NOT NULL,
        assignee TEXT NOT NULL, category TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('ready','waiting_approval','in_progress','submitted','completed','blocked','cancelled')),
        version INTEGER NOT NULL DEFAULT 1, dependencies TEXT NOT NULL DEFAULT '[]',
        due_at TEXT, result TEXT, lease_hash TEXT, lease_until INTEGER,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ops_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, actor TEXT NOT NULL,
        action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ops_requests (
        actor TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
        response TEXT NOT NULL, PRIMARY KEY(actor,request_key)
      );
      CREATE TABLE IF NOT EXISTS ops_tokens (
        digest TEXT PRIMARY KEY, actor TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ops_reports (
        day TEXT PRIMARY KEY, body TEXT NOT NULL, created_by TEXT NOT NULL,
        created_at TEXT NOT NULL, read_at TEXT
      );
    `);
  }
  private now() { return new Date(this.clock()).toISOString(); }
  private event(actor: Actor, action: string, id: string | null, detail: unknown) {
    this.db.prepare("INSERT INTO ops_events(job_id,actor,action,detail,created_at) VALUES(?,?,?,?,?)")
      .run(id, actor, action, JSON.stringify(detail), this.now());
  }
  provisionToken(actor: Actor, lifetimeHours = 24) {
    if (!agents.includes(actor) || actor === "owner") fail("INVALID_INPUT", "Kein Agentenzugang für diese Identität.");
    const token = randomBytes(32).toString("base64url");
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM ops_tokens WHERE actor=?").run(actor);
      this.db.prepare("INSERT INTO ops_tokens VALUES(?,?,?)").run(hash(token), actor, this.clock() + lifetimeHours * 3600000);
      this.event("owner", "token_rotated", null, { actor });
    }).immediate();
    return token;
  }
  authenticate(token: string): Actor | null {
    const row = this.db.prepare("SELECT actor FROM ops_tokens WHERE digest=? AND expires_at>?").get(hash(token), this.clock()) as { actor: Actor } | undefined;
    return row?.actor ?? null;
  }
  list(actor: Actor): Job[] {
    return (actor === "owner" || actor === "juergen"
      ? this.db.prepare("SELECT * FROM ops_jobs ORDER BY created_at DESC,id").all()
      : this.db.prepare("SELECT * FROM ops_jobs WHERE assignee=? ORDER BY created_at DESC,id").all(actor)) as Job[];
  }
  get(actor: Actor, id: string): Job {
    const row = this.db.prepare("SELECT * FROM ops_jobs WHERE id=?").get(id) as Job | undefined;
    if (!row || (actor !== "owner" && actor !== "juergen" && row.assignee !== actor)) fail("NOT_FOUND", "Auftrag nicht verfügbar.");
    return row;
  }
  isStopped() { return (this.db.prepare("SELECT value FROM ops_settings WHERE key='external_stop'").get() as { value: string }).value === "1"; }
  events(actor: Actor) {
    manager(actor);
    return this.db.prepare("SELECT * FROM ops_events ORDER BY seq DESC LIMIT 100").all();
  }
  reports(actor: Actor) {
    manager(actor);
    return this.db.prepare("SELECT * FROM ops_reports ORDER BY day DESC LIMIT 30").all() as { day: string; body: string; created_at: string; read_at: string | null }[];
  }
  reportStatus() {
    const day = berlinDay(new Date(this.clock()));
    const exists = this.db.prepare("SELECT day FROM ops_reports WHERE day=?").get(day);
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(new Date(this.clock())));
    return { day, required: true, present: !!exists, overdue: !exists && hour >= 18, scheduleActive: false, deliveryChannel: "portal_only" };
  }
  tools(actor: Actor) {
    const common = ["list_jobs", "get_job", "claim_job", "renew_lease", "submit_result", "report_blocker"];
    if (actor === "owner" || actor === "juergen") common.push("list_agents", "create_job", "accept_result", "request_revision", "unblock_job", "cancel_job", "get_events", "get_reports", "save_report");
    if (actor === "owner") common.push("approve_job", "reject_job", "set_external_stop", "mark_report_read");
    return common;
  }
  call(actor: Actor, action: string, input: Input = {}): unknown {
    if (!agents.includes(actor) || !this.tools(actor).includes(action)) fail("FORBIDDEN", "Werkzeug für diese Rolle nicht verfügbar.");
    if (action === "list_jobs") return this.list(actor).map(({ lease_hash: _secret, ...job }) => { void _secret; return job; });
    if (action === "get_job") { const { lease_hash: _secret, ...job } = this.get(actor, text(input, "id")); void _secret; return job; }
    if (action === "list_agents") return [
      { id: "juergen", role: "Geschäftsführung", connected: this.connected("juergen") },
      { id: "natalie", role: "E-Mail und Organisation", connected: this.connected("natalie") },
      { id: "mika", role: "Marketing und Gestaltung", connected: this.connected("mika") },
      { id: "artur", role: "Artikel", connected: this.connected("artur") },
    ];
    if (action === "get_events") return this.events(actor);
    if (action === "get_reports") return { reports: this.reports(actor), status: this.reportStatus() };
    const key = text(input, "request_key", 200);
    const fingerprint = hash(JSON.stringify({ action, input }));
    return this.db.transaction(() => {
      const previous = this.db.prepare("SELECT fingerprint,response FROM ops_requests WHERE actor=? AND request_key=?").get(actor, key) as { fingerprint: string; response: string } | undefined;
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail("CONFLICT", "Wiederholungsschlüssel bereits für andere Daten verwendet.");
        return JSON.parse(previous.response);
      }
      const response = this.mutate(actor, action, input);
      this.db.prepare("INSERT INTO ops_requests VALUES(?,?,?,?)").run(actor, key, fingerprint, JSON.stringify(response));
      return response;
    }).immediate();
  }
  private connected(actor: Actor) {
    return !!this.db.prepare("SELECT 1 FROM ops_tokens WHERE actor=? AND expires_at>?").get(actor, this.clock());
  }
  private mutate(actor: Actor, action: string, input: Input): unknown {
    if (action === "set_external_stop") {
      owner(actor);
      if (typeof input.stopped !== "boolean") fail("INVALID_INPUT", "stopped muss wahr oder falsch sein.");
      this.db.prepare("UPDATE ops_settings SET value=? WHERE key='external_stop'").run(input.stopped ? "1" : "0");
      this.event(actor, action, null, { stopped: input.stopped });
      return { stopped: input.stopped, externalExecutorsActive: false };
    }
    if (action === "save_report") {
      manager(actor);
      const body = text(input, "body"); const day = berlinDay(new Date(this.clock()));
      this.db.prepare("INSERT INTO ops_reports(day,body,created_by,created_at) VALUES(?,?,?,?) ON CONFLICT(day) DO UPDATE SET body=excluded.body,created_by=excluded.created_by,created_at=excluded.created_at,read_at=NULL").run(day, body, actor, this.now());
      this.event(actor, action, null, { day });
      return { day, storedInPortal: true, externalDeliveryVerified: false };
    }
    if (action === "mark_report_read") {
      owner(actor); const day = text(input, "day", 10);
      if (!this.db.prepare("UPDATE ops_reports SET read_at=? WHERE day=?").run(this.now(), day).changes) fail("NOT_FOUND", "Bericht fehlt.");
      this.event(actor, action, null, { day }); return { day, read: true };
    }
    if (action === "create_job") {
      manager(actor);
      const title = text(input, "title", 200), brief = text(input, "brief"), criteria = text(input, "criteria");
      const assignee = text(input, "assignee") as Actor, category = text(input, "category");
      if (!agents.includes(assignee) || assignee === "owner") fail("INVALID_INPUT", "Unbekannter Agent.");
      if (!["internal", "email", "article", "ghost", "invoice", "commercial", "initiative"].includes(category)) fail("INVALID_INPUT", "Ungültige Auftragsart.");
      const dependencies = input.dependencies ?? [];
      if (!Array.isArray(dependencies) || dependencies.length > 30 || dependencies.some(id => typeof id !== "string")) fail("INVALID_INPUT", "Ungültige Abhängigkeiten.");
      for (const id of dependencies) this.get(actor, id);
      const due = input.due_at ? text(input, "due_at", 40) : null;
      if (due && !Number.isFinite(Date.parse(due))) fail("INVALID_INPUT", "Ungültiger Termin.");
      const id = randomUUID(), state = reserved.includes(category) ? "waiting_approval" : "ready";
      this.db.prepare("INSERT INTO ops_jobs(id,title,brief,criteria,assignee,category,state,dependencies,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, title, brief, criteria, assignee, category, state, JSON.stringify(dependencies), due, this.now(), this.now());
      this.event(actor, action, id, { title, category, assignee, state, mandate: "1.3" });
      return { id, state, version: 1 };
    }
    const job = this.get(actor, text(input, "id"));
    if (!Number.isInteger(input.version) || input.version !== job.version) fail("CONFLICT", "Der Auftrag wurde inzwischen geändert. Bitte neu laden.");
    let state = job.state, result = job.result, leaseHash = job.lease_hash, leaseUntil = job.lease_until;
    let leaseToken: string | undefined;
    if (["approve_job", "reject_job"].includes(action)) {
      owner(actor);
      if (job.state !== "waiting_approval") fail("CONFLICT", "Keine Inhaberentscheidung ausstehend.");
      text(input, "reason", 2000);
      state = action === "approve_job" ? "ready" : "blocked";
    } else if (action === "claim_job") {
      if (actor !== job.assignee) fail("FORBIDDEN", "Nur der zugewiesene Agent darf übernehmen.");
      const expired = job.state === "in_progress" && job.lease_until !== null && job.lease_until <= this.clock();
      if (job.state !== "ready" && !expired) fail("CONFLICT", "Auftrag ist nicht verfügbar.");
      if (external.includes(job.category) && this.isStopped()) fail("STOPPED", "Externe Aktionen sind angehalten.");
      for (const id of JSON.parse(job.dependencies) as string[]) {
        const predecessor = this.db.prepare("SELECT state FROM ops_jobs WHERE id=?").get(id) as { state: string };
        if (predecessor.state !== "completed") fail("DEPENDENCY", "Ein Vorgänger ist noch offen.");
      }
      leaseToken = randomBytes(32).toString("base64url"); leaseHash = hash(leaseToken); leaseUntil = this.clock() + 30 * 60000; state = "in_progress";
    } else if (["submit_result", "report_blocker", "renew_lease"].includes(action)) {
      if (actor !== job.assignee || job.state !== "in_progress" || !leaseUntil || leaseUntil <= this.clock() || hash(text(input, "lease_token")) !== leaseHash) fail("LEASE_INVALID", "Reservierung fehlt oder ist abgelaufen.");
      if (action === "renew_lease") {
        if (external.includes(job.category) && this.isStopped()) fail("STOPPED", "Externe Aktionen sind angehalten.");
        leaseUntil = this.clock() + 30 * 60000;
      } else {
        result = text(input, "result"); state = action === "submit_result" ? "submitted" : "blocked";
      }
    } else if (["accept_result", "request_revision"].includes(action)) {
      manager(actor);
      if (job.state !== "submitted") fail("CONFLICT", "Kein Ergebnis zur Prüfung vorhanden.");
      if (action === "request_revision") text(input, "reason", 2000);
      state = action === "accept_result" ? "completed" : "ready";
    } else if (action === "unblock_job") {
      manager(actor);
      if (reserved.includes(job.category)) owner(actor);
      if (job.state !== "blocked") fail("CONFLICT", "Auftrag ist nicht blockiert.");
      text(input, "reason", 2000); state = "ready";
    } else if (action === "cancel_job") {
      manager(actor);
      if (["completed", "cancelled"].includes(job.state)) fail("CONFLICT", "Auftrag bereits beendet.");
      text(input, "reason", 2000); state = "cancelled";
    } else fail("INVALID_INPUT", "Unbekannte Aktion.");
    if (state !== "in_progress") { leaseHash = null; leaseUntil = null; }
    this.db.prepare("UPDATE ops_jobs SET state=?,result=?,lease_hash=?,lease_until=?,version=version+1,updated_at=? WHERE id=? AND version=?")
      .run(state, result, leaseHash, leaseUntil, this.now(), job.id, job.version);
    this.event(actor, action, job.id, { state, version: job.version + 1, reason: input.reason, result: action === "submit_result" || action === "report_blocker" ? result : undefined });
    return { id: job.id, state, version: job.version + 1, ...(leaseToken ? { lease_token: leaseToken } : {}), lease_until: leaseUntil };
  }
}
