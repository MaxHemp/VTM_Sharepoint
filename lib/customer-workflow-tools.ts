import { WorkflowError } from "./customer-workflow";

type Schema = {
  type: "object" | "array" | "string" | "integer" | "boolean";
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
};
const text = (maxLength = 20000): Schema => ({ type: "string", minLength: 1, maxLength });
const list = (items: Schema, maxItems = 100): Schema => ({ type: "array", items, maxItems });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: "object", properties, required, additionalProperties: false });
const fields: Record<string, Schema> = {
  request_key: text(200), id: text(100), version: { type: "integer", minimum: 1 },
  customer_id: text(100), name: text(200), approvers: list(text(320), 50),
  workers: list({ type: "string", enum: ["juergen", "natalie", "mika", "artur"] }, 4),
  source_kind: { type: "string", enum: ["portal", "mail"] }, source_id: text(500),
  title: text(200), brief: text(), locator: text(2000), excerpt: text(),
  kind: { type: "string", enum: ["provider", "primary", "independent", "editorial"] },
  valid_until: text(40), evidence: text(4000), lease_token: text(200),
  source_ids: list(text(200)), summary: text(),
  content: object({
    channel: { type: "string", enum: ["email", "ghost"] },
    payload: object({ to: text(320), subject: text(500), text: text(100000), html: text(100000), title: text(500) }, []),
    assets: list(object({ uri: text(2000), sha256: text(64) }), 30),
    claims: list(object({ text: text(4000), source_id: text(200), kind: { type: "string", enum: ["provider", "primary", "independent", "editorial"] } }), 200),
    quality_requirements: list(text(200)),
    required_asset_roles: list(text(200),30),
  }, ["channel","payload","assets","claims","quality_requirements"]),
  assets: list(object({ uri: text(2000), sha256: text(64), role: text(200) }, ["uri","sha256"]), 30),
  checks: list(object({ criterion: text(200), passed: { type: "boolean" }, evidence: text(4000) })),
  notes: text(4000), revision_hash: text(64), approver: text(320), confirmation: text(4000), reason: text(4000), provider_id: text(500), outcome: { type: "string", enum: ["verified", "not_sent"] },
};
const definitions: Record<string, { description: string; required: string[]; optional?: string[]; readOnly?: boolean }> = {
  work_queue: { description: "Bis zu 50 aktuell übernehmbare eigene Stufen lesen, älteste zuerst. Keine Reservierung, keine Chat-Weckung. Jede Stufe vor Übernahme frisch lesen.", required: [], readOnly: true },
  list_workflows: { description: "Freigegebene Kundenvorgänge lesen. Optional nach Kunde filtern.", required: [], optional: ["customer_id"], readOnly: true },
  get_workflow: { description: "Aktuellen Kundenvorgang mit Version und Inhaltsrevision lesen. Keine Reservierungsgeheimnisse.", required: ["id"], readOnly: true },
  workflow_status: { description: "Workflow- und Ausführungsstatus lesen. Codebereitschaft ist keine Live-Aktivierung.", required: [], readOnly: true },
  list_customers: { description: "Für diese Identität freigegebene Kunden lesen.", required: [], readOnly: true },
  list_sources: { description: "Quellen eines freigegebenen Kunden einschließlich Gültigkeit und Widerruf lesen.", required: ["customer_id"], readOnly: true },
  workflow_events: { description: "Nachvollziehbaren Änderungsverlauf eines freigegebenen Vorgangs lesen.", required: ["id"], readOnly: true },
  revoke_source: { description: "Quelle begründet widerrufen. Zugehörige Freigaben erfüllen anschließend die Quellenprüfung nicht mehr.", required: ["request_key", "customer_id", "source_id", "reason"] },
  record_delivery_evidence: { description: "Nur Inhaber: unklaren oder angenommenen Versand anhand eines tatsächlichen Provider-Nachweises als verifiziert oder sicher nicht gesendet abgleichen. Kein erneuter Versand.", required: ["request_key", "id", "version", "outcome", "provider_id", "evidence"] },
  retry_delivery: { description: "Nur Inhaber: nachweislich nicht ausgeführte Auslieferung erneut einreihen. Erneute Prüfung aller Freigaben. Dieses Werkzeug sendet nichts.", required: ["request_key", "id", "version", "reason"] },
  register_customer: { description: "Nur Inhaber: Kunde, erlaubte Bearbeiter und konkrete Kundenfreigeber registrieren. Erstellt keine Zugangsdaten.", required: ["request_key", "customer_id", "name", "approvers", "workers"] },
  intake: { description: "Kundenauftrag aus Portal oder Mail erfassen. source_id dedupliziert die ursprüngliche Anfrage. Kein Mailabruf oder Versand.", required: ["request_key", "customer_id", "source_kind", "source_id", "title", "brief"] },
  register_source: { description: "Geprüfte Quelle mit Fundstelle, Auszug, Beleg und Gültigkeit für einen Kunden hinterlegen.", required: ["request_key", "customer_id", "source_id", "locator", "excerpt", "kind", "valid_until", "evidence"] },
  claim_stage: { description: "Zugewiesene Workflow-Stufe atomar reservieren. lease_token vertraulich behandeln und nur für die eigene Einreichung verwenden.", required: ["request_key", "id", "version"] },
  submit_research: { description: "Recherche mit gültiger eigener Reservierung und registrierten Quellen einreichen.", required: ["request_key", "id", "version", "lease_token", "source_ids", "summary"] },
  submit_production: { description: "Exakten Content, Assets und belegte Aussagen an Design und anschließende QA übergeben. Kein Versand, keine Veröffentlichung.", required: ["request_key", "id", "version", "lease_token", "content"] },
  submit_design: { description: "Mika: finale visuelle Exporte mit Prüfsummen und gültiger Reservierung einreichen. Versiegelt die Inhaltsrevision für QA und Freigaben.", required: ["request_key", "id", "version", "lease_token", "assets", "notes"] },
  submit_qa: { description: "Qualitätsprüfung mit Einzelprüfungen und Nachweisen einreichen. Finale Contentfreigabe bleibt beim Inhaber.", required: ["request_key", "id", "version", "lease_token", "checks", "notes"] },
  approve_content: { description: "Nur Inhaber: genau die angezeigte Inhaltsrevision nach QA freigeben und Entscheidung belegen.", required: ["request_key", "id", "version", "revision_hash", "evidence"] },
  record_customer_approval: { description: "Nur Inhaber: tatsächliche Kundenfreigabe durch einen registrierten Freigeber für genau diese Revision dokumentieren.", required: ["request_key", "id", "version", "revision_hash", "approver", "evidence"] },
  authorize_delivery: { description: "Nur Inhaber: Auslieferung genau dieser bereits freigegebenen Revision gesondert autorisieren. Dieses Werkzeug sendet nichts.", required: ["request_key", "id", "version", "revision_hash", "confirmation"] },
  request_revision: { description: "Korrektur beauftragen. Bestehende Freigaben und Auslieferungsberechtigungen werden ungültig.", required: ["request_key", "id", "version", "reason"] },
  cancel_workflow: { description: "Kundenvorgang abbrechen. Bereits erfolgte oder unklare externe Ergebnisse müssen gesondert abgeglichen werden.", required: ["request_key", "id", "version", "reason"] },
};

export const WORKFLOW_BODY_LIMIT = 65536;
export function workflowToolDefinition(action: string) {
  const definition = Object.hasOwn(definitions, action) ? definitions[action] : undefined;
  if (!definition) throw new WorkflowError("INVALID_INPUT", "Unbekanntes Workflow-Werkzeug.");
  const properties = Object.fromEntries([...definition.required, ...(definition.optional ?? [])].map(key => [key, fields[key]]));
  return {
    name: `cw_${action}`, description: definition.description,
    inputSchema: { type: "object", properties, required: definition.required, additionalProperties: false },
    annotations: { readOnlyHint: !!definition.readOnly, destructiveHint: action === "cancel_workflow", openWorldHint: false },
  };
}
export function isWorkflowRead(action: string) { return Object.hasOwn(definitions, action) && !!definitions[action].readOnly; }

function invalid(path: string): never { throw new WorkflowError("INVALID_INPUT", `${path}: Ungültiger oder unbekannter Parameter.`); }
function validate(value: unknown, schema: Schema, path: string): void {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid(path);
    const record = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false && Object.keys(record).some(key => !Object.hasOwn(properties, key))) invalid(path);
    if (schema.required?.some(key => !Object.hasOwn(record, key))) invalid(path);
    for (const [key, item] of Object.entries(record)) if (Object.hasOwn(properties, key)) validate(item, properties[key], `${path}.${key}`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 100)) invalid(path);
    value.forEach((item, index) => validate(item, schema.items!, `${path}[${index}]`));
  } else if (schema.type === "string") {
    if (typeof value !== "string" || (schema.minLength !== undefined && value.trim().length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength) || (schema.enum && !schema.enum.includes(value))) invalid(path);
  } else if (schema.type === "integer") {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || (schema.minimum !== undefined && value < schema.minimum)) invalid(path);
  } else if (typeof value !== "boolean") invalid(path);
}

/** Shared boundary schema; the service independently enforces permissions and transition gates. */
export function validateWorkflowInput(action: string, input: unknown): asserts input is Record<string, unknown> {
  const definition = workflowToolDefinition(action);
  validate(input, definition.inputSchema as Schema, "input");
  if (Buffer.byteLength(JSON.stringify(input)) > WORKFLOW_BODY_LIMIT) throw new WorkflowError("INVALID_INPUT", "Anfrage zu groß.");
}
