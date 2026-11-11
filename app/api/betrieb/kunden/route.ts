import { getCurrentUser } from "@/lib/auth";
import { requireOperationsOwner } from "@/lib/operations-runtime";
import { WorkflowError } from "@/lib/customer-workflow";
import { customerWorkflow, readWorkflowJson, workflowOriginValid, WorkflowRequestError } from "@/lib/customer-workflow-runtime";
import { isWorkflowRead, validateWorkflowInput } from "@/lib/customer-workflow-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
}
async function owner() {
  if (!await getCurrentUser()) throw new WorkflowRequestError(401, "Anmeldung erforderlich.");
  try { return await requireOperationsOwner(); }
  catch { throw new WorkflowRequestError(403, "Nur für den konfigurierten Inhaber verfügbar."); }
}
function failure(error: unknown) {
  if (error instanceof WorkflowRequestError) return json({ error: error.message }, error.status);
  if (error instanceof WorkflowError) {
    const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_INPUT" ? 400 : 409;
    return json({ error: error.message, code: error.code }, status);
  }
  console.error("Customer workflow API failed");
  return json({ error: "Interner Fehler. Vorgang neu lesen, bevor eine Aktion wiederholt wird." }, 500);
}

/** Owner session only. Agent identities use cw_* tools on the existing MCP endpoint. */
export async function GET(request: Request) {
  if (!workflowOriginValid(request, true)) return json({ error: "Origin nicht erlaubt." }, 403);
  try {
    const actor = await owner();
    const params = new URL(request.url).searchParams;
    if ([...new Set(params.keys())].some(key => params.getAll(key).length !== 1)) throw new WorkflowRequestError(400, "Doppelte Parameter sind nicht erlaubt.");
    const action = params.get("action") || "list_workflows";
    if (!isWorkflowRead(action)) throw new WorkflowRequestError(405, "Leseaktion erforderlich.");
    const input = Object.fromEntries([...params].filter(([key]) => key !== "action"));
    validateWorkflowInput(action, input);
    return json({ result: customerWorkflow().call(actor, action, input) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!workflowOriginValid(request)) return json({ error: "Origin nicht erlaubt." }, 403);
  try {
    const actor = await owner();
    const body = await readWorkflowJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["action", "input"].includes(key))) throw new WorkflowRequestError(400, "Erwartet werden ausschließlich action und input.");
    const { action, input } = body as { action?: unknown; input?: unknown };
    if (typeof action !== "string") throw new WorkflowRequestError(400, "Aktion fehlt.");
    validateWorkflowInput(action, input);
    return json({ result: customerWorkflow().call(actor, action, input) });
  } catch (error) { return failure(error); }
}
