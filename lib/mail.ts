import nodemailer from "nodemailer";
import { getDb } from "./db";

// E-Mail-Versand über SMTP. Ohne SMTP_HOST in der Umgebung ist der Versand
// deaktiviert und alle Funktionen kehren still zurück — das Portal bleibt
// voll nutzbar.

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

function getTransport() {
  const port = Number(process.env.SMTP_PORT ?? 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
      : undefined,
  });
}

export function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

export function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** VTM-gebrandetes E-Mail-Layout (Inline-Styles für Mail-Clients). */
export function mailLayout(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="de">
<body style="margin:0;padding:0;background:#F5F7FA;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FA;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="background:#0D1C3C;background:linear-gradient(135deg,#0D1C3C 0%,#122952 100%);border-radius:8px 8px 0 0;padding:28px 32px;">
            <div style="font-family:'Arial Narrow',Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;color:#4B75FF;margin-bottom:8px;">VTM Teamportal</div>
            <div style="font-family:'Arial Narrow',Arial,sans-serif;font-size:24px;font-weight:bold;color:#FFFFFF;line-height:1.2;">${esc(heading)}</div>
          </td>
        </tr>
        <tr>
          <td style="height:3px;background:#1F4EFF;background:linear-gradient(135deg,#1F4EFF 0%,#4B75FF 100%);font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="background:#FFFFFF;padding:32px;font-family:'Arial Narrow',Arial,sans-serif;font-size:16px;line-height:1.65;color:#0D1C3C;border:1px solid #E8ECF2;border-top:none;">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="background:#FFFFFF;border:1px solid #E8ECF2;border-top:none;border-radius:0 0 8px 8px;padding:20px 32px;">
            <a href="${appUrl()}" style="display:inline-block;background:#0D1C3C;background:linear-gradient(135deg,#0D1C3C 0%,#122952 100%);color:#FFFFFF;font-family:'Arial Narrow',Arial,sans-serif;font-size:14px;font-weight:500;text-decoration:none;padding:12px 28px;border-radius:6px;">Zum Teamportal</a>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 8px;font-family:'Arial Narrow',Arial,sans-serif;font-size:12px;color:#8A9BB5;">
            Diese Nachricht wurde automatisch vom VTM Teamportal versendet.<br>
            VersicherungsTech Media UG
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendMail(opts: {
  to?: string[];
  bcc?: string[];
  subject: string;
  html: string;
}): Promise<void> {
  if (!mailConfigured()) {
    console.log(`[mail] SMTP nicht konfiguriert — E-Mail übersprungen: ${opts.subject}`);
    return;
  }
  const from =
    process.env.MAIL_FROM ?? process.env.SMTP_USER ?? "teamportal@localhost";
  try {
    await getTransport().sendMail({
      from: `"VTM Teamportal" <${from}>`,
      to: opts.to?.join(", "),
      bcc: opts.bcc?.join(", "),
      subject: opts.subject,
      html: opts.html,
    });
    console.log(`[mail] gesendet: ${opts.subject}`);
  } catch (error) {
    console.error(`[mail] Versand fehlgeschlagen: ${opts.subject}`, error);
  }
}

/** Benachrichtigt alle Team-Mitglieder außer der auslösenden Person (BCC). */
export async function notifyTeam(
  excludeUserId: number,
  subject: string,
  html: string
): Promise<void> {
  const rows = getDb()
    .prepare("SELECT email FROM users WHERE id != ?")
    .all(excludeUserId) as { email: string }[];
  if (rows.length === 0) return;
  await sendMail({ bcc: rows.map((r) => r.email), subject, html });
}
