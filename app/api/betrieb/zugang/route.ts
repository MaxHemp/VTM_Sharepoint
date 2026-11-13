import { operations } from "@/lib/operations-runtime";
import { getCurrentUser } from "@/lib/auth";
import { isAgent } from "@/lib/operations-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Explicit owner-only provisioning. Never called by agent tools or GET requests. */
export async function POST(request: Request) {
  const origin = new URL(process.env.APP_URL || request.url).origin;
  if (request.headers.get("origin") !== origin) return new Response("Origin nicht erlaubt", { status: 403 });
  const user = await getCurrentUser();
  if (!user) return new Response("Anmeldung erforderlich", { status: 401 });
  const ownerEmail = process.env.OPS_OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail || user.role !== "admin" || user.email.toLowerCase() !== ownerEmail) return new Response("Nur Inhaber", { status: 403 });
  const form = await request.formData();
  const actor = String(form.get("actor") ?? "");
  if (!isAgent(actor) || form.get("confirm") !== "30-days") return new Response("Ungültige Zugangsanfrage", { status: 400 });
  const token = operations().provisionToken(actor, 30 * 24);
  return Response.json({ actor, endpoint: `${origin}/api/betrieb/mcp`, token, expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }, {
    headers: {
      "Content-Disposition": `attachment; filename="vtm-${actor}-zugang.json"`,
      "Cache-Control": "no-store, private", "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    },
  });
}
