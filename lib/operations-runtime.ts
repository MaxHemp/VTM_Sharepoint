import { getDb } from "./db";
import { Operations, type Actor } from "./operations";
import { requireUser } from "./auth";

export function operations() { return new Operations(getDb()); }
export async function requireOperationsOwner(): Promise<Actor> {
  const user = await requireUser();
  const email = process.env.OPS_OWNER_EMAIL?.trim().toLowerCase();
  if (!email || user.email.toLowerCase() !== email || user.role !== "admin") {
    throw new Error("Die Betriebszentrale ist nur für den konfigurierten Inhaber verfügbar.");
  }
  return "owner";
}
