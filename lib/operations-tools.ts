import type { Actor } from "./operations";

const descriptions: Record<string, string> = {
  list_jobs: "Eigene Aufträge lesen; Geschäftsführung sieht die gesamte Liste.",
  get_job: "Auftrag und aktuelle Version lesen.", list_agents: "Registrierte Agenten und eingerichtete Zugänge lesen. Ein Zugang ist kein Nachweis eines laufenden Chats.",
  create_job: "Auftrag erstellen. Kaufmännische Entscheidungen und neue Initiativen warten zwingend auf den Inhaber. Kategorien müssen dem tatsächlichen Inhalt entsprechen.",
  claim_job: "Zugewiesenen Auftrag atomar für 30 Minuten reservieren. Liefert vertraulichen lease_token.",
  renew_lease: "Gültige eigene Reservierung um 30 Minuten verlängern.",
  submit_result: "Ergebnis mit tatsächlichen Datei-/Quellenverweisen zur Prüfung einreichen. Kein Versand und keine Veröffentlichung durch dieses Werkzeug.",
  report_blocker: "Hindernis melden und Reservierung beenden.", accept_result: "Eingereichtes Ergebnis nach Prüfung abschließen.",
  request_revision: "Ergebnis zur Korrektur zurückgeben. reason enthält den Korrekturauftrag.",
  unblock_job: "Geklärten blockierten Auftrag wieder freigeben. Kaufmännische Aufträge und neue Initiativen darf nur der Inhaber erneut freigeben.",
  cancel_job: "Offenen Auftrag abbrechen und Reservierung widerrufen. Bereits externe Aktionen gesondert abgleichen.",
  approve_job: "Vorbehaltenen Auftrag als Inhaber genehmigen.", reject_job: "Vorbehaltenen Auftrag als Inhaber ablehnen.",
  set_external_stop: "Nur Inhaber: Übernahme und Verlängerung externer Aufträge sperren oder freigeben. Keine externen Ausführer angeschlossen.",
  get_events: "Letzte 100 protokollierte Änderungen lesen.", get_reports: "Tagesberichte und Fälligkeit in Europe/Berlin lesen.",
  save_report: "Heutigen Inhaberbericht dauerhaft im Portal ablegen. Behauptet keinen externen Versand.",
  mark_report_read: "Inhaber bestätigt, einen vorhandenen Tagesbericht gelesen zu haben.",
};
export function toolDefinition(name: string) {
  const noInput = ["list_jobs", "list_agents", "get_events", "get_reports"].includes(name);
  const fields: Record<string, object> = {
    request_key: { type: "string", description: "Stabiler eindeutiger Schlüssel für genau diesen Änderungsversuch." },
    id: { type: "string" }, version: { type: "integer", minimum: 1 },
    title: { type: "string", maxLength: 200 }, brief: { type: "string" }, criteria: { type: "string" },
    assignee: { type: "string", enum: ["juergen", "natalie", "mika", "artur"] },
    category: { type: "string", enum: ["internal", "email", "article", "ghost", "invoice", "commercial", "initiative"] },
    dependencies: { type: "array", items: { type: "string" }, maxItems: 30 }, due_at: { type: "string", description: "ISO-8601-Termin mit Zeitzone" },
    lease_token: { type: "string" }, result: { type: "string" }, reason: { type: "string" },
    stopped: { type: "boolean" }, body: { type: "string" }, day: { type: "string" },
  };
  let required = noInput ? [] : ["request_key"];
  let optional: string[] = [];
  if (name === "get_job") required = ["id"];
  else if (name === "create_job") { required.push("title", "brief", "criteria", "assignee", "category"); optional = ["dependencies", "due_at"]; }
  else if (name === "save_report") required.push("body");
  else if (name === "mark_report_read") required.push("day");
  else if (name === "set_external_stop") required.push("stopped");
  else if (!noInput) {
    required.push("id", "version");
    if (["renew_lease", "submit_result", "report_blocker"].includes(name)) required.push("lease_token");
    if (["submit_result", "report_blocker"].includes(name)) required.push("result");
    if (["request_revision", "unblock_job", "cancel_job", "approve_job", "reject_job"].includes(name)) required.push("reason");
  }
  return {
    name, description: descriptions[name] ?? name,
    inputSchema: { type: "object", properties: Object.fromEntries([...required, ...optional].map(key => [key, fields[key]])), required, additionalProperties: false },
    annotations: { readOnlyHint: noInput || name === "get_job", destructiveHint: name === "cancel_job", openWorldHint: false },
  };
}
export function isAgent(value: string): value is Actor { return ["juergen", "natalie", "mika", "artur"].includes(value); }
