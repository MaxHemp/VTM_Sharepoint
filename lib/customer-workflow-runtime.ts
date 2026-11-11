import { getDb } from "./db";
import { CustomerWorkflow } from "./customer-workflow";
import { WORKFLOW_BODY_LIMIT } from "./customer-workflow-tools";

export function customerWorkflow() { return new CustomerWorkflow(getDb()); }

/** Cookie-authenticated mutations require an explicit, exact same-origin request. */
export function workflowOriginValid(request: Request, allowMissing = false) {
  const origin = request.headers.get("origin");
  if (!origin) return allowMissing;
  try { return origin === new URL(process.env.APP_URL || request.url).origin; }
  catch { return false; }
}

export class WorkflowRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Stop reading at the byte limit, including requests without Content-Length. */
export async function readWorkflowJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new WorkflowRequestError(415, "JSON erforderlich.");
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > WORKFLOW_BODY_LIMIT)) throw new WorkflowRequestError(413, "Anfrage zu groß.");
  const reader = request.body?.getReader();
  if (!reader) throw new WorkflowRequestError(400, "JSON-Inhalt fehlt.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > WORKFLOW_BODY_LIMIT) {
        await reader.cancel();
        throw new WorkflowRequestError(413, "Anfrage zu groß.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new WorkflowRequestError(400, "Ungültiges JSON."); }
}
