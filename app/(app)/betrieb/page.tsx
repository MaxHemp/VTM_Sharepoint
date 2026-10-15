import { randomUUID } from "node:crypto";
import { operations, requireOperationsOwner } from "@/lib/operations-runtime";
import { operationAction } from "@/app/betrieb-actions";
import { PageHeader } from "@/components/page-header";
import type { Job } from "@/lib/operations";

const labels: Record<string, string> = { ready: "Bereit", waiting_approval: "Deine Entscheidung erforderlich", in_progress: "In Arbeit", submitted: "Ergebnis zur Prüfung", completed: "Abgeschlossen", blocked: "Blockiert", cancelled: "Abgebrochen" };
const categories: Record<string, string> = { internal: "Interne Arbeit", article: "Artikel erstellen", email: "E-Mail versenden", ghost: "Ghost-Veröffentlichung", invoice: "Feststehende Rechnung versenden", commercial: "Kaufmännische Entscheidung", initiative: "Neue Initiative" };

function JobAction({ job, action, label, reason }: { job: Job; action: string; label: string; reason?: boolean }) {
  return <form action={operationAction} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="action" value={action}/><input type="hidden" name="request_key" value={randomUUID()}/>
    <input type="hidden" name="id" value={job.id}/><input type="hidden" name="version" value={job.version}/>
    {reason && <input name="reason" aria-label={`${label}: Begründung für ${job.title}`} placeholder="Begründung oder Korrekturauftrag" required className="vtm-input"/>}
    <button className="btn-primary" type="submit">{label}</button>
  </form>;
}
export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ fehler?: string }> }) {
  const actor = await requireOperationsOwner(); const ops = operations();
  const jobs = ops.list(actor); const reports = ops.reports(actor); const status = ops.reportStatus();
  const error = (await searchParams).fehler;
  const registry = ops.call(actor, "list_agents") as { id: string; role: string; connected: boolean }[];
  return <>
    <PageHeader label="Betriebszentrale" title="Jürgen und das VTM-Team" description="Du entscheidest kaufmännisch. Jürgen führt den freigegebenen Betrieb und berichtet täglich."/>
    <div className="mx-auto max-w-6xl space-y-8 p-6 lg:p-10">
      <section className="vtm-card space-y-3 p-5" aria-label="Betriebsstatus">
        <h2 className="font-display text-xl font-bold">Isolierter Pilotbetrieb</h2>
        <p>Aufträge und Rückmeldungen werden dauerhaft gespeichert. Mailversand, Ghost und automatisches Starten der Agenten sind noch nicht angeschlossen.</p>
        <p><strong>{ops.isStopped() ? "Externe Aufträge angehalten" : "Externe Aufträge zur Übernahme freigegeben"}</strong> · Freigaben für kaufmännische Entscheidungen bleiben bei dir.</p>
        <form action={operationAction}>
          <input type="hidden" name="action" value="set_external_stop"/><input type="hidden" name="request_key" value={randomUUID()}/>
          <input type="hidden" name="stopped" value={ops.isStopped() ? "false" : "true"}/>
          <button className="btn-primary">{ops.isStopped() ? "Externe Aufträge zur Übernahme freigeben" : "Externe Aufträge anhalten"}</button>
        </form>
      </section>
      {error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-4 text-red-900">{error}</p>}
      <section className="vtm-card p-5">
        <h2 className="font-display text-xl font-bold">Agententeam</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">{registry.map(agent => <li key={agent.id} className="rounded border border-[var(--hairline)] p-3"><strong className="capitalize">{agent.id}</strong> · {agent.role}<br/><span className="text-sm">{agent.connected ? "Werkzeugzugang eingerichtet; Chat-Anbindung noch prüfen" : "Werkzeugzugang noch einzurichten"}</span></li>)}</ul>
      </section>
      <section className="vtm-card p-5">
        <h2 className="font-display text-xl font-bold">Neuer Auftrag</h2>
        <form action={operationAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="action" value="create_job"/><input type="hidden" name="request_key" value={randomUUID()}/>
          <label className="sm:col-span-2">Ziel<input className="vtm-input" name="title" required maxLength={200}/></label>
          <label className="sm:col-span-2">Briefing<textarea className="vtm-input" name="brief" required rows={3}/></label>
          <label className="sm:col-span-2">Woran erkennen wir ein gutes Ergebnis?<textarea className="vtm-input" name="criteria" required rows={2}/></label>
          <label>Verantwortlich<select name="assignee" className="vtm-input">{registry.map(agent => <option key={agent.id} value={agent.id}>{agent.id}</option>)}</select></label>
          <label>Art des Auftrags<select name="category" className="vtm-input">{Object.entries(categories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <p className="text-sm sm:col-span-2">Kaufmännische Entscheidungen und neue Initiativen werden zuerst dir vorgelegt. Es werden keine automatischen Team-Mails ausgelöst.</p>
          <button className="btn-primary sm:justify-self-start">Auftrag anlegen</button>
        </form>
      </section>
      <section aria-label="Aufträge"><h2 className="font-display mb-4 text-xl font-bold">Aufträge ({jobs.length})</h2>
        {jobs.length === 0 && <p className="vtm-card p-5">Noch keine Aufträge. Der Pilot beginnt mit fiktiven Vorgängen.</p>}
        <div className="space-y-4">{jobs.map(job => <article className="vtm-card space-y-3 p-5" key={job.id}>
          <p className="text-sm">{labels[job.state]} · {job.assignee} · {categories[job.category]} · Version {job.version}</p>
          <h3 className="font-display text-lg font-bold">{job.title}</h3><p className="whitespace-pre-wrap">{job.brief}</p>
          <p><strong>Abnahme:</strong> {job.criteria}</p><p className="text-xs text-[var(--ink-soft)]">Auftrag {job.id}</p>
          {job.result && <div className="rounded bg-[var(--surface-raised)] p-3"><strong>Letzte Rückmeldung</strong><p className="whitespace-pre-wrap">{job.result}</p></div>}
          {job.state === "waiting_approval" && <div className="space-y-2"><JobAction job={job} action="approve_job" label="Als Inhaber zustimmen" reason/><JobAction job={job} action="reject_job" label="Ablehnen" reason/></div>}
          {job.state === "submitted" && <div className="space-y-2"><JobAction job={job} action="accept_result" label="Ergebnis annehmen"/><JobAction job={job} action="request_revision" label="Korrektur beauftragen" reason/></div>}
          {job.state === "blocked" && <JobAction job={job} action="unblock_job" label="Nach Klärung freigeben" reason/>}
          {!["completed", "cancelled"].includes(job.state) && <JobAction job={job} action="cancel_job" label="Auftrag stoppen" reason/>}
        </article>)}</div>
      </section>
      <section className="vtm-card space-y-3 p-5">
        <h2 className="font-display text-xl font-bold">Täglicher Inhaberbericht</h2>
        <p>{status.present ? "Bericht für heute liegt vor." : status.overdue ? "Der heutige Bericht fehlt und ist überfällig." : "Für heute liegt noch kein Bericht vor."} Pflicht an jedem Kalendertag, auch am Wochenende.</p>
        <p className="text-sm">Vorgesehen: 18:00 Uhr Europe/Berlin. Zeitplan und aktive Zustellung sind noch nicht eingerichtet.</p>
        {reports.map(report => <article key={report.day} className="border-t border-[var(--hairline)] pt-3"><h3 className="font-bold">{report.day}</h3><p className="whitespace-pre-wrap">{report.body}</p>
          {report.read_at ? <p className="text-sm">Von dir als gelesen bestätigt.</p> : <form action={operationAction}><input type="hidden" name="action" value="mark_report_read"/><input type="hidden" name="request_key" value={randomUUID()}/><input type="hidden" name="day" value={report.day}/><button className="btn-primary">Als gelesen bestätigen</button></form>}
        </article>)}
      </section>
      <details className="vtm-card p-5"><summary className="cursor-pointer font-bold">Bearbeitungsverlauf</summary><ol className="mt-3 space-y-2">{(ops.events(actor) as { seq: number; actor: string; action: string; created_at: string }[]).map(event => <li className="text-sm" key={event.seq}>{event.created_at} · {event.actor} · {event.action}</li>)}</ol></details>
    </div>
  </>;
}
