import { operations } from "@/lib/operations-runtime";
import { OperationsError } from "@/lib/operations";
import { toolDefinition } from "@/lib/operations-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const versions = ["2025-03-26", "2025-06-18", "2025-11-25"];
function originValid(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(process.env.APP_URL || request.url).origin;
}
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
/** Stateless JSON response transport; owner mutations use the authenticated portal, never bearer tokens. */
export async function POST(request: Request) {
  if (!originValid(request)) return json({ error: "Origin nicht erlaubt" }, 403);
  const version = request.headers.get("mcp-protocol-version");
  if (version && !versions.includes(version)) return json({ error: "Protokollversion nicht unterstützt" }, 400);
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token || token.length > 200) return json({ error: "Agentenzugang fehlt" }, 401);
  const ops = operations(); const actor = ops.authenticate(token);
  if (!actor) return json({ error: "Agentenzugang ungültig oder abgelaufen" }, 401);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "JSON erforderlich" }, 415);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 65536) return json({ error: "Anfrage zu groß" }, 413);
  let message: Record<string, unknown>;
  try { message = JSON.parse(raw); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Ungültiges JSON" } }); }
  if (!message || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Ungültige Anfrage" } });
  const id = message.id;
  if (id === undefined) {
    if (["notifications/initialized", "notifications/cancelled"].includes(message.method)) return new Response(null, { status: 202 });
    return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Aufruf benötigt eine ID" } });
  }
  if (typeof id !== "string" && typeof id !== "number") return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Ungültige ID" } });
  const reply = (result: unknown) => json({ jsonrpc: "2.0", id, result });
  const params = message.params;
  const p = params && typeof params === "object" && !Array.isArray(params) ? params as Record<string, unknown> : {};
  if (message.method === "initialize") return reply({ protocolVersion: versions.includes(String(p.protocolVersion)) ? p.protocolVersion : versions[versions.length - 1], capabilities: { tools: {} }, serverInfo: { name: "vtm-betrieb", version: "0.1.0" }, instructions: "Auftragskoordination im Pilotbetrieb. Keine Mail-/Ghost-Ausführung. Kaufmännische Entscheidungen und neue Initiativen benötigen Max' Zustimmung. Täglicher Inhaberbericht ist verpflichtend." });
  if (message.method === "ping") return reply({});
  if (message.method === "tools/list") return reply({ tools: ops.tools(actor).map(toolDefinition) });
  if (message.method !== "tools/call") return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Methode nicht verfügbar" } });
  try {
    if (typeof p.name !== "string" || (p.arguments !== undefined && (!p.arguments || typeof p.arguments !== "object" || Array.isArray(p.arguments)))) throw new OperationsError("INVALID_INPUT", "Ungültige Werkzeugparameter.");
    const args = (p.arguments ?? {}) as Record<string, unknown>;
    const definition = toolDefinition(p.name);
    if (Object.keys(args).some(key => !(key in definition.inputSchema.properties))) throw new OperationsError("INVALID_INPUT", "Unbekannte Werkzeugparameter.");
    if (definition.inputSchema.required.some(key => !(key in args))) throw new OperationsError("INVALID_INPUT", "Erforderliche Werkzeugparameter fehlen.");
    const result = ops.call(actor, p.name, args);
    return reply({ content: [{ type: "text", text: JSON.stringify(result) }], isError: false });
  } catch (error) {
    if (error instanceof OperationsError) return reply({ content: [{ type: "text", text: JSON.stringify({ code: error.code, message: error.message }) }], isError: true });
    console.error("Operations tool failed", error instanceof Error ? error.message : "unknown");
    return reply({ content: [{ type: "text", text: "Interner Fehler. Auftrag neu lesen, bevor eine Aktion wiederholt wird." }], isError: true });
  }
}
export async function GET(request: Request) {
  if (!originValid(request)) return json({ error: "Origin nicht erlaubt" }, 403);
  return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}
