"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { operations, requireOperationsOwner } from "@/lib/operations-runtime";
import { OperationsError } from "@/lib/operations";

export async function operationAction(form: FormData) {
  const actor = await requireOperationsOwner();
  const action = String(form.get("action") ?? "");
  const args: Record<string, unknown> = Object.fromEntries([...form.entries()].filter(([key]) => key !== "action"));
  if (args.version) args.version = Number(args.version);
  if (action === "set_external_stop") args.stopped = args.stopped === "true";
  let errorMessage: string | undefined;
  try { operations().call(actor, action, args); }
  catch (error) {
    if (!(error instanceof OperationsError)) throw error;
    errorMessage = error.message;
  }
  revalidatePath("/betrieb");
  redirect(errorMessage ? `/betrieb?fehler=${encodeURIComponent(errorMessage)}` : "/betrieb");
}
