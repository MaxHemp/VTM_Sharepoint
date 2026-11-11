"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOperationsOwner } from "@/lib/operations-runtime";
import { customerWorkflow } from "@/lib/customer-workflow-runtime";
import { WorkflowError } from "@/lib/customer-workflow";
import { validateWorkflowInput, workflowToolDefinition, WORKFLOW_BODY_LIMIT } from "@/lib/customer-workflow-tools";

const portalActions = new Set(["register_customer", "intake", "approve_content", "record_customer_approval", "authorize_delivery", "request_revision", "cancel_workflow", "record_delivery_evidence", "retry_delivery"]);

export async function customerWorkflowAction(form: FormData) {
  const actor = await requireOperationsOwner();
  let errorMessage: string | undefined;
  let action = "";
  try {
    const requestHeaders = await headers();
    const origin = requestHeaders.get("origin");
    let expectedOrigin: string | undefined;
    try {
      expectedOrigin = process.env.APP_URL ? new URL(process.env.APP_URL).origin : origin && new URL(origin).host === requestHeaders.get("host") ? new URL(origin).origin : undefined;
    } catch { /* Invalid request origin is rejected below. */ }
    if (!origin || origin !== expectedOrigin) throw new WorkflowError("FORBIDDEN", "Origin nicht erlaubt.");
    if (form.getAll("action").length !== 1 || typeof form.get("action") !== "string") throw new WorkflowError("INVALID_INPUT", "Ungültige Formularaktion.");
    action = String(form.get("action"));
    if (!portalActions.has(action)) throw new WorkflowError("INVALID_INPUT", "Diese Aktion ist im Inhaberportal nicht verfügbar.");
    const definition = workflowToolDefinition(action);
    const entries: [string, string][] = [];
    const seen = new Set<string>();
    let bytes = 0;
    for (const [key, value] of form.entries()) {
      if (key.startsWith("$ACTION_") || key === "action") continue;
      if (!Object.hasOwn(definition.inputSchema.properties, key) || typeof value !== "string" || (seen.has(key) && key !== "workers")) throw new WorkflowError("INVALID_INPUT", "Unbekannte, doppelte oder ungültige Formularfelder.");
      bytes += Buffer.byteLength(key) + Buffer.byteLength(value);
      if (bytes > WORKFLOW_BODY_LIMIT) throw new WorkflowError("INVALID_INPUT", "Anfrage zu groß.");
      seen.add(key);
      entries.push([key, value]);
    }
    const args: Record<string, unknown> = Object.fromEntries(entries);
    if (Object.hasOwn(args, "version")) {
      if (!/^\d+$/.test(String(args.version))) throw new WorkflowError("INVALID_INPUT", "Ungültige Version. Bitte Vorgang neu laden.");
      args.version = Number(args.version);
    }
    if (action === "register_customer") {
      args.approvers = String(args.approvers ?? "").split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      args.workers = form.getAll("workers");
    }
    validateWorkflowInput(action, args);
    customerWorkflow().call(actor, action, args);
  } catch (error) {
    if (error instanceof WorkflowError) errorMessage = error.message;
    else {
      console.error("Customer workflow action failed");
      errorMessage = "Die Aktion konnte nicht bestätigt werden. Bitte den Vorgang neu laden und den Verlauf prüfen, bevor du sie wiederholst.";
    }
  }
  revalidatePath("/betrieb/kunden");
  redirect(errorMessage ? `/betrieb/kunden?fehler=${encodeURIComponent(errorMessage)}` : `/betrieb/kunden?erfolg=${encodeURIComponent(action)}`);
}
