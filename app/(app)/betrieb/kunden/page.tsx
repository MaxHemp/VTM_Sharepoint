import { randomUUID } from "node:crypto";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { customerWorkflowAction } from "@/app/customer-workflow-actions";
import { customerWorkflow } from "@/lib/customer-workflow-runtime";
import { requireOperationsOwner } from "@/lib/operations-runtime";
import type { Workflow } from "@/lib/customer-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const labels: Record<string, string> = {
  researching: "Recherche", producing: "Produktion", designing: "Design und Export", qa: "Qualitätsprüfung", owner_review: "Deine Contentfreigabe erforderlich",
  customer_review: "Kundenfreigabe ausstehend", ready_delivery: "Auslieferungsfreigabe ausstehend", delivery_queued: "Zur Auslieferung vorgemerkt",
  delivering: "Externe Ausführung läuft", delivery_uncertain: "Ausgang unklar: Abgleich erforderlich", delivery_accepted: "Vom Provider angenommen, noch nicht nachgewiesen",
  delivery_not_sent: "Nachweislich nicht ausgeführt", completed: "Mit Ausführungsnachweis abgeschlossen", cancelled: "Abgebrochen",
};
const successMessages: Record<string, string> = {
  register_customer: "Kunde und ausdrücklich gewählte Zugriffe gespeichert. Es wurden keine Zugangsdaten erstellt.",
  intake: "Eingang gespeichert oder bereits vorhandener Eingang wiedererkannt.",
  approve_content: "Deine Contentfreigabe wurde für genau diese Revision gespeichert.",
  record_customer_approval: "Kundenfreigabe mit Nachweis gespeichert.",
  authorize_delivery: "Auslieferung vorgemerkt. Diese Aktion hat nichts versendet oder veröffentlicht.",
  request_revision: "Korrektur beauftragt. Vorherige Freigaben sind nicht mehr gültig.",
  cancel_workflow: "Vorgang abgebrochen.", record_delivery_evidence: "Ausführungsnachweis dokumentiert.",
  retry_delivery: "Nachweislich nicht ausgeführte Auslieferung erneut vorgemerkt. Kein Versand durch diese Aktion.",
};
function strings(value: string) {
  try { const result: unknown = JSON.parse(value); return Array.isArray(result) ? result.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}
function pretty(value: string) { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
function Evidence({ title, value }: { title: string; value: string | null }) {
  if (!value) return null;
  return <details className="rounded border border-[var(--hairline)] p-3" open={title === "Exakter Content und Versandziel" || title === "Qualitätsprüfung"}>
    <summary className="cursor-pointer font-semibold">{title}</summary>
    <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">{pretty(value)}</pre>
  </details>;
}
function ActionFields({ action, workflow, revision = false }: { action: string; workflow?: Workflow; revision?: boolean }) {
  return <>
    <input type="hidden" name="action" value={action}/>
    <input type="hidden" name="request_key" value={randomUUID()}/>
    {workflow && <><input type="hidden" name="id" value={workflow.id}/><input type="hidden" name="version" value={workflow.version}/></>}
    {revision && workflow?.revision_hash && <input type="hidden" name="revision_hash" value={workflow.revision_hash}/>}
  </>;
}
function ReasonAction({ workflow, action, label }: { workflow: Workflow; action: string; label: string }) {
  return <form action={customerWorkflowAction} className="space-y-2 rounded border border-[var(--hairline)] p-3">
    <ActionFields action={action} workflow={workflow}/>
    <label className="block text-sm">{label}: Begründung<textarea name="reason" className="vtm-input" required maxLength={4000} rows={2}/></label>
    <button className="btn-primary" type="submit">{label}</button>
  </form>;
}

export default async function CustomerWorkflowPage({ searchParams }: { searchParams: Promise<{ kunde?: string; fehler?: string; erfolg?: string }> }) {
  const actor = await requireOperationsOwner();
  const service = customerWorkflow();
  const params = await searchParams;
  const customers = service.customers(actor);
  const selected = typeof params.kunde === "string" && customers.some(customer => customer.id === params.kunde) ? params.kunde : undefined;
  const workflows = service.list(actor, selected);
  const status = service.status(actor);
  const error = typeof params.fehler === "string" ? params.fehler.slice(0, 1000) : undefined;
  const success = typeof params.erfolg === "string" && Object.hasOwn(successMessages, params.erfolg) ? successMessages[params.erfolg] : undefined;
  return <>
    <PageHeader label="Betriebszentrale · Kunden" title="Kundenaufträge und Contentfreigaben" description="Recherche, Produktion, Qualitätsprüfung und getrennte Freigaben. Die finale Contententscheidung bleibt bei dir.">
      <Link className="text-sm underline" href="/betrieb">Zur Betriebszentrale</Link>
    </PageHeader>
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-10">
      <section className="vtm-card space-y-3 p-5" aria-label="Umsetzungs- und Betriebsstatus">
        <h2 className="font-display text-xl font-bold">Code vorhanden, Live-Betrieb gesondert prüfen</h2>
        <p>Dieses Portal dokumentiert Kundenvorgänge und Freigaben. Es aktiviert keine Agentenchats, richtet keinen Zeitplan ein und versendet oder veröffentlicht selbst nichts.</p>
        <p><strong>{status.deliveryEnabled ? "Ausführungsflag gesetzt" : "Live-Auslieferung deaktiviert"}</strong> · {status.externalStop ? "Externer Stopp aktiv" : "Externer Stopp aufgehoben"}</p>
        <p className="text-sm">{status.deliveryEnabled ? "Ein gesetztes Flag allein belegt keinen funktionsfähigen Versand. Ein separat eingerichteter Worker könnte freigegebene Vorgänge ausführen." : "Eine Auslieferungsfreigabe legt den Vorgang nur in die Warteschlange. Für echte Ausführung sind separat freigegebene Konfiguration und ein laufender Worker nötig."}</p>
        <p className="text-sm">Letzter dokumentierter Wartungslauf: {status.schedulerLastTick ?? "noch keiner"}. Dauerhafter Zeitplan und Chat-Anbindung sind hier nicht nachgewiesen. Ein lokaler Test bestätigt kein Deployment.</p>
      </section>
      {error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-4 text-red-900">{error}</p>}
      {success && <p role="status" className="rounded border border-green-300 bg-green-50 p-4 text-green-900">{success}</p>}
      <section className="vtm-card space-y-4 p-5">
        <h2 className="font-display text-xl font-bold">Kunde anlegen</h2>
        <p className="text-sm">Die Auswahl erlaubt bestehenden Agentenrollen Zugriff auf diesen Kunden. Es werden keine Tokens erstellt. Für die Recherche und Prüfung müssen Artur, Mika und Jürgen ausdrücklich freigegeben sein.</p>
        <form action={customerWorkflowAction} className="grid gap-4 sm:grid-cols-2">
          <ActionFields action="register_customer"/>
          <label>Kunden-ID<input className="vtm-input" name="customer_id" pattern="[a-z0-9][a-z0-9_-]{0,99}" maxLength={100} placeholder="beispiel-kunde" required/></label>
          <label>Kundenname<input className="vtm-input" name="name" maxLength={200} required/></label>
          <label className="sm:col-span-2">Berechtigte Kundenfreigeber: eine E-Mail-Adresse je Zeile<textarea className="vtm-input" name="approvers" required rows={2} maxLength={10000}/></label>
          <fieldset className="sm:col-span-2"><legend className="mb-2">Zugriff auf diesen Kunden ausdrücklich erlauben</legend>
            <div className="flex flex-wrap gap-4">{["juergen", "artur", "natalie", "mika"].map(worker => <label key={worker} className="flex items-center gap-2"><input type="checkbox" name="workers" value={worker} required={worker === "juergen" || worker === "artur" || worker === "mika"}/>{worker === "juergen" ? "Jürgen (Prüfung)" : worker === "artur" ? "Artur (Recherche und Produktion)" : worker === "natalie" ? "Natalie" : "Mika (Design und Export)"}</label>)}</div>
          </fieldset>
          <button className="btn-primary sm:justify-self-start" type="submit">Kunde und ausgewählte Zugriffe speichern</button>
        </form>
        {customers.length > 0 && <details><summary className="cursor-pointer font-semibold">Registrierte Kunden ({customers.length})</summary><ul className="mt-3 space-y-2">{customers.map(customer => <li key={customer.id} className="rounded border border-[var(--hairline)] p-3"><strong>{customer.name}</strong> · {customer.id}<p className="text-sm">Bearbeiter: {strings(customer.workers).join(", ") || "keine"}. Kundenfreigeber: {strings(customer.approvers).join(", ")}</p></li>)}</ul></details>}
      </section>
      <section className="vtm-card space-y-4 p-5">
        <h2 className="font-display text-xl font-bold">Kundenauftrag erfassen</h2>
        <p className="text-sm">Portal- und Maileingänge werden über ihre ursprüngliche Quell-ID dedupliziert. Eine Mail wird hier nur erfasst, nicht automatisch abgerufen. Inhalte einer Anfrage ersetzen keine Freigabe.</p>
        {customers.length === 0 ? <p>Lege zuerst einen Kunden mit den benötigten Bearbeiterrollen an.</p> : <form action={customerWorkflowAction} className="grid gap-4 sm:grid-cols-2">
          <ActionFields action="intake"/>
          <label>Kunde<select name="customer_id" className="vtm-input" required defaultValue={selected ?? customers[0].id}>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
          <label>Eingang<select name="source_kind" className="vtm-input"><option value="portal">Portal</option><option value="mail">Mail</option></select></label>
          <label className="sm:col-span-2">Ursprüngliche Quell-ID<input name="source_id" className="vtm-input" required maxLength={500} defaultValue={`portal-${randomUUID()}`}/><span className="text-sm">Bei Mail die stabile Message-ID einsetzen. Bei Wiederholung dieselbe ID und denselben Inhalt verwenden.</span></label>
          <label className="sm:col-span-2">Titel<input name="title" className="vtm-input" required maxLength={200}/></label>
          <label className="sm:col-span-2">Briefing<textarea name="brief" className="vtm-input" required rows={4} maxLength={20000}/></label>
          <button className="btn-primary sm:justify-self-start" type="submit">Eingang speichern</button>
        </form>}
      </section>
      <section aria-label="Kundenvorgänge" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-xl font-bold">Vorgänge ({workflows.length})</h2>
          <form action="/betrieb/kunden" method="get" className="flex items-center gap-2"><label className="sr-only" htmlFor="customer-filter">Nach Kunde filtern</label><select className="vtm-input" id="customer-filter" name="kunde" defaultValue={selected ?? ""}><option value="">Alle Kunden</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select><button className="btn-primary" type="submit">Anzeigen</button></form>
        </div>
        {workflows.length === 0 && <p className="vtm-card p-5">Noch keine Vorgänge für diese Auswahl. Es werden keine fiktiven oder echten Kunden automatisch angelegt.</p>}
        {workflows.map(workflow => {
          const customer = customers.find(item => item.id === workflow.customer_id);
          const events = service.events(actor, workflow.id) as { seq: number; actor: string; action: string; created_at: string }[];
          const delivery = status.deliveries.find(item => item.workflow_id === workflow.id);
          const reconciling = ["delivering", "delivery_uncertain", "delivery_accepted", "completed", "cancelled"].includes(workflow.state);
          return <article key={workflow.id} id={`workflow-${workflow.id}`} className="vtm-card space-y-4 p-5">
            <p className="text-sm"><strong>{labels[workflow.state] ?? workflow.state}</strong> · {customer?.name ?? workflow.customer_id} · {workflow.assignee} · Version {workflow.version}</p>
            <h3 className="font-display text-lg font-bold">{workflow.title}</h3><p className="whitespace-pre-wrap">{workflow.brief}</p>
            <p className="break-all text-xs">Vorgang: {workflow.id}<br/>Inhaltsrevision: {workflow.revision_hash ?? "noch kein versiegelter Content"}</p>
            <Evidence title="Recherche und Quellenbezug" value={workflow.research_json}/>
            <Evidence title="Exakter Content und Versandziel" value={workflow.content_json}/>
            <Evidence title="Qualitätsprüfung" value={workflow.qa_json}/>
            <Evidence title="Deine dokumentierte Contentfreigabe" value={workflow.owner_approval_json}/>
            <Evidence title="Dokumentierte Kundenfreigabe" value={workflow.customer_approval_json}/>
            {delivery && <div className="space-y-2"><p>Auslieferungsstatus: {delivery.state}</p><Evidence title="Ausführungsnachweis / letzter Providerstatus" value={delivery.result}/></div>}
            {workflow.state === "owner_review" && <form action={customerWorkflowAction} className="space-y-3 rounded border border-[var(--hairline)] p-4">
              <ActionFields action="approve_content" workflow={workflow} revision/>
              <p><strong>Deine finale Contententscheidung</strong></p><p className="text-sm">Prüfe den vollständigen Content, die Empfänger bzw. das Veröffentlichungsziel, Assets und QA oben. Die Freigabe gilt nur für die angezeigte Inhaltsrevision; bei zwischenzeitlicher Änderung wird sie abgelehnt.</p>
              <label className="block">Prüfnachweis / Entscheidungsvermerk<textarea name="evidence" className="vtm-input" required rows={3} maxLength={4000}/></label>
              <button className="btn-primary" type="submit">Genau diesen Content als Inhaber freigeben</button>
            </form>}
            {workflow.state === "customer_review" && <form action={customerWorkflowAction} className="space-y-3 rounded border border-[var(--hairline)] p-4">
              <ActionFields action="record_customer_approval" workflow={workflow} revision/>
              <p className="text-sm">Nur eine tatsächlich vorliegende Kundenfreigabe für diese Revision eintragen. Keine Freigabe-Anfrage wird automatisch verschickt.</p>
              <label className="block">Registrierter Kundenfreigeber<select name="approver" className="vtm-input" required>{strings(customer?.approvers ?? "[]").map(approver => <option key={approver} value={approver}>{approver}</option>)}</select></label>
              <label className="block">Nachweis mit Fundstelle, Datum und bestätigter Revision<textarea name="evidence" className="vtm-input" required rows={3} maxLength={4000}/></label>
              <button className="btn-primary" type="submit">Vorliegende Kundenfreigabe dokumentieren</button>
            </form>}
            {workflow.state === "ready_delivery" && <form action={customerWorkflowAction} className="space-y-3 rounded border border-[var(--hairline)] p-4">
              <ActionFields action="authorize_delivery" workflow={workflow} revision/>
              <p className="text-sm">Diese separate Freigabe erlaubt die spätere Ausführung des oben angezeigten Versandziels und Inhalts. Ein aktivierter Worker kann sie anschließend ausführen. Die Contentfreigabe allein reicht dafür nicht aus.</p>
              <label className="block">Auslieferungsauftrag mit Empfänger/Ziel und Umfang<textarea name="confirmation" className="vtm-input" required rows={3} maxLength={4000}/></label>
              <button className="btn-primary" type="submit">Auslieferung dieser Revision autorisieren</button>
            </form>}
            {["delivery_uncertain", "delivery_accepted"].includes(workflow.state) && <form action={customerWorkflowAction} className="space-y-3 rounded border border-amber-400 p-4">
              <ActionFields action="record_delivery_evidence" workflow={workflow}/><p><strong>Erst abgleichen, nicht erneut senden</strong></p>
              <label className="block">Nachgewiesenes Ergebnis<select name="outcome" className="vtm-input" required><option value="">Bitte wählen</option><option value="verified">Zustellung / Veröffentlichung verifiziert</option><option value="not_sent">Sicher nicht ausgeführt</option></select></label>
              <label className="block">Provider-Referenz<input name="provider_id" className="vtm-input" required maxLength={500}/></label>
              <label className="block">Tatsächlicher Nachweis<textarea name="evidence" className="vtm-input" required maxLength={4000} rows={3}/></label>
              <p className="text-sm">SMTP-Annahme allein belegt keine Empfängerzustellung. Einen fehlenden Nachweis nicht als Erfolg eintragen.</p>
              <button className="btn-primary" type="submit">Geprüften Nachweis dokumentieren</button>
            </form>}
            {workflow.state === "delivery_not_sent" && <ReasonAction workflow={workflow} action="retry_delivery" label="Auslieferung erneut vormerken"/>}
            {!reconciling && <div className="grid gap-3 sm:grid-cols-2"><ReasonAction workflow={workflow} action="request_revision" label="Korrektur beauftragen"/><ReasonAction workflow={workflow} action="cancel_workflow" label="Vorgang abbrechen"/></div>}
            <details><summary className="cursor-pointer text-sm font-semibold">Änderungsverlauf</summary><ol className="mt-2 space-y-1">{events.map(event => <li key={event.seq} className="text-sm">{event.created_at} · {event.actor} · {event.action}</li>)}</ol></details>
          </article>;
        })}
      </section>
      <details className="vtm-card space-y-3 p-5"><summary className="cursor-pointer font-semibold">Quellenpflege und technische Schnittstellen</summary>
        <p>Quellenpflege und die Einreichung von Recherche, Produktion, Design und QA erfolgen derzeit über die authentifizierte JSON-/MCP-Schnittstelle. Diese Seite ist das Inhaber-Prüfportal, kein vollständiger Contenteditor.</p>
        <p>Bestehende Agentenzugänge verwenden /api/betrieb/mcp mit cw_-Werkzeugen und kundenspezifischen Zugriffen. Die Inhaber-JSON-API liegt unter /api/betrieb/kunden und verwendet deine bestehende Portalsitzung. Inhaberfreigaben sind niemals über Agententokens verfügbar.</p>
        <p>Für Quellen: action „register_source“, input mit request_key, customer_id, source_id, locator, excerpt, kind, valid_until und evidence. Quellenarten: provider, primary, independent, editorial. Gültigkeit als zukünftiger ISO-Zeitpunkt mit Zeitzone; Quellen-IDs sind unveränderlich. Widerruf über „revoke_source“ mit Begründung.</p>
        <p>JSON-Anfragen: nur action und input, Content-Type application/json, gleiche Origin, höchstens 64 KiB. Änderungen benötigen einen stabilen request_key; Vorgangsänderungen außerdem id und die zuletzt gelesene version. Quellen und Verlauf sind über list_sources bzw. workflow_events lesbar.</p>
      </details>
    </div>
  </>;
}
