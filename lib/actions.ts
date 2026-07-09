"use server";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { appUrl, esc, mailLayout, notifyTeam, sendMail } from "./mail";
import {
  createSession,
  destroySession,
  hashPassword,
  hasAnyUser,
  requireAdmin,
  requireUser,
  verifyPassword,
} from "./auth";
import { getDb, UPLOAD_DIR, type Doc, type User } from "./db";

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

// ---------------------------------------------------------------- Auth

export async function setupAction(formData: FormData): Promise<void> {
  if (hasAnyUser()) redirect("/login");
  const name = str(formData, "name");
  const email = str(formData, "email");
  const password = str(formData, "password");
  if (!name || !email || password.length < 8) {
    redirect("/setup?fehler=eingabe");
  }
  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')"
    )
    .run(email, name, hashPassword(password));
  await createSession(Number(result.lastInsertRowid));
  redirect("/");
}

export async function loginAction(formData: FormData): Promise<void> {
  const email = str(formData, "email");
  const password = str(formData, "password");
  const user = getDb()
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email) as User | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) {
    redirect("/login?fehler=1");
  }
  await createSession(user.id);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

// ---------------------------------------------------------------- News

export async function createAnnouncementAction(
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  const title = str(formData, "title");
  const body = str(formData, "body");
  if (!title) return;
  getDb()
    .prepare(
      "INSERT INTO announcements (title, body, created_by) VALUES (?, ?, ?)"
    )
    .run(title, body, user.id);
  revalidatePath("/");

  after(() =>
    notifyTeam(
      user.id,
      `Neue Ankündigung: ${title}`,
      mailLayout(
        title,
        `<p style="margin:0 0 12px;color:#8A9BB5;font-size:13px;">Veröffentlicht von ${esc(user.name)}</p>
         ${body ? `<p style="margin:0;white-space:pre-wrap;">${esc(body)}</p>` : ""}`
      )
    )
  );
}

export async function deleteAnnouncementAction(
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  const id = Number(str(formData, "id"));
  const db = getDb();
  const row = db
    .prepare("SELECT created_by FROM announcements WHERE id = ?")
    .get(id) as { created_by: number | null } | undefined;
  if (!row) return;
  if (user.role !== "admin" && row.created_by !== user.id) return;
  db.prepare("DELETE FROM announcements WHERE id = ?").run(id);
  revalidatePath("/");
}

// ---------------------------------------------------------------- Dokumente

export async function createFolderAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = str(formData, "name");
  const parentRaw = str(formData, "parent_id");
  const parentId = parentRaw ? Number(parentRaw) : null;
  if (!name) return;
  getDb()
    .prepare(
      "INSERT INTO folders (name, parent_id, created_by) VALUES (?, ?, ?)"
    )
    .run(name, parentId, user.id);
  revalidatePath("/dokumente");
}

export async function deleteFolderAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(str(formData, "id"));
  const db = getDb();

  // Collect the folder subtree and delete all stored files inside it.
  const collectDocs = (folderId: number): Doc[] => {
    const docs = db
      .prepare("SELECT * FROM documents WHERE folder_id = ?")
      .all(folderId) as Doc[];
    const children = db
      .prepare("SELECT id FROM folders WHERE parent_id = ?")
      .all(folderId) as { id: number }[];
    for (const child of children) docs.push(...collectDocs(child.id));
    return docs;
  };

  const folder = db
    .prepare("SELECT created_by FROM folders WHERE id = ?")
    .get(id) as { created_by: number | null } | undefined;
  if (!folder) return;
  if (user.role !== "admin" && folder.created_by !== user.id) return;

  for (const doc of collectDocs(id)) {
    fs.rmSync(path.join(UPLOAD_DIR, doc.stored_name), { force: true });
  }
  db.prepare("DELETE FROM folders WHERE id = ?").run(id);
  revalidatePath("/dokumente");
}

export async function uploadDocumentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const folderRaw = str(formData, "folder_id");
  const folderId = folderRaw ? Number(folderRaw) : null;
  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);

  const db = getDb();
  const uploadedNames: string[] = [];
  for (const file of files) {
    const storedName = `${crypto.randomUUID()}${path.extname(file.name).slice(0, 20)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buffer);
    db.prepare(
      `INSERT INTO documents (name, folder_id, stored_name, size, mime, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      path.basename(file.name),
      folderId,
      storedName,
      file.size,
      file.type || "application/octet-stream",
      user.id
    );
    uploadedNames.push(path.basename(file.name));
  }
  revalidatePath("/dokumente");

  if (uploadedNames.length > 0) {
    const folderName = folderId
      ? ((
          db.prepare("SELECT name FROM folders WHERE id = ?").get(folderId) as
            | { name: string }
            | undefined
        )?.name ?? null)
      : null;
    after(() =>
      notifyTeam(
        user.id,
        uploadedNames.length === 1
          ? `Neues Dokument: ${uploadedNames[0]}`
          : `${uploadedNames.length} neue Dokumente im Teamportal`,
        mailLayout(
          uploadedNames.length === 1 ? "Neues Dokument" : "Neue Dokumente",
          `<p style="margin:0 0 12px;color:#8A9BB5;font-size:13px;">Hochgeladen von ${esc(user.name)}${folderName ? ` in den Ordner „${esc(folderName)}&ldquo;` : ""}</p>
           <ul style="margin:0;padding-left:20px;">${uploadedNames.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
        )
      )
    );
  }
}

export async function deleteDocumentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(str(formData, "id"));
  const db = getDb();
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as
    | Doc
    | undefined;
  if (!doc) return;
  if (user.role !== "admin" && doc.uploaded_by !== user.id) return;
  fs.rmSync(path.join(UPLOAD_DIR, doc.stored_name), { force: true });
  db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  revalidatePath("/dokumente");
}

// ---------------------------------------------------------------- Aufgaben

export async function createTaskAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const title = str(formData, "title");
  const description = str(formData, "description");
  const assignedRaw = str(formData, "assigned_to");
  const dueDate = str(formData, "due_date");
  if (!title) return;
  getDb()
    .prepare(
      `INSERT INTO tasks (title, description, assigned_to, due_date, created_by)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      title,
      description,
      assignedRaw ? Number(assignedRaw) : null,
      dueDate || null,
      user.id
    );
  revalidatePath("/aufgaben");
  revalidatePath("/");

  const assignee = assignedRaw
    ? ((
        getDb()
          .prepare("SELECT name FROM users WHERE id = ?")
          .get(Number(assignedRaw)) as { name: string } | undefined
      )?.name ?? null)
    : null;
  after(() =>
    notifyTeam(
      user.id,
      `Neue Aufgabe: ${title}`,
      mailLayout(
        title,
        `<p style="margin:0 0 12px;color:#8A9BB5;font-size:13px;">Angelegt von ${esc(user.name)}${assignee ? ` · zugewiesen an ${esc(assignee)}` : ""}${dueDate ? ` · fällig am ${dueDate.split("-").reverse().join(".")}` : ""}</p>
         ${description ? `<p style="margin:0;white-space:pre-wrap;">${esc(description)}</p>` : ""}`
      )
    )
  );
}

export async function toggleTaskAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = Number(str(formData, "id"));
  getDb()
    .prepare(
      "UPDATE tasks SET status = CASE status WHEN 'open' THEN 'done' ELSE 'open' END WHERE id = ?"
    )
    .run(id);
  revalidatePath("/aufgaben");
  revalidatePath("/");
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(str(formData, "id"));
  const db = getDb();
  const task = db
    .prepare("SELECT created_by FROM tasks WHERE id = ?")
    .get(id) as { created_by: number | null } | undefined;
  if (!task) return;
  if (user.role !== "admin" && task.created_by !== user.id) return;
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  revalidatePath("/aufgaben");
  revalidatePath("/");
}

// ---------------------------------------------------------------- Kalender

export async function createEventAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const title = str(formData, "title");
  const date = str(formData, "date");
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  getDb()
    .prepare(
      `INSERT INTO events (title, date, start_time, end_time, location, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title,
      date,
      str(formData, "start_time") || null,
      str(formData, "end_time") || null,
      str(formData, "location"),
      str(formData, "description"),
      user.id
    );
  revalidatePath("/kalender");
  revalidatePath("/");

  const startTime = str(formData, "start_time");
  const location = str(formData, "location");
  const description = str(formData, "description");
  after(() =>
    notifyTeam(
      user.id,
      `Neuer Termin: ${title}`,
      mailLayout(
        title,
        `<p style="margin:0 0 12px;color:#8A9BB5;font-size:13px;">Eingetragen von ${esc(user.name)}</p>
         <p style="margin:0 0 12px;"><strong>${date.split("-").reverse().join(".")}</strong>${startTime ? ` · ${esc(startTime)} Uhr` : ""}${location ? ` · ${esc(location)}` : ""}</p>
         ${description ? `<p style="margin:0;white-space:pre-wrap;">${esc(description)}</p>` : ""}`
      )
    )
  );
}

export async function deleteEventAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(str(formData, "id"));
  const db = getDb();
  const event = db
    .prepare("SELECT created_by FROM events WHERE id = ?")
    .get(id) as { created_by: number | null } | undefined;
  if (!event) return;
  if (user.role !== "admin" && event.created_by !== user.id) return;
  db.prepare("DELETE FROM events WHERE id = ?").run(id);
  revalidatePath("/kalender");
  revalidatePath("/");
}

// ---------------------------------------------------------------- Verwaltung

export async function createUserAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = str(formData, "name");
  const email = str(formData, "email");
  const password = str(formData, "password");
  const role = str(formData, "role") === "admin" ? "admin" : "member";
  if (!name || !email || password.length < 8) {
    redirect("/admin?fehler=eingabe");
  }
  try {
    getDb()
      .prepare(
        "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)"
      )
      .run(email, name, hashPassword(password), role);
  } catch {
    redirect("/admin?fehler=email");
  }
  revalidatePath("/admin");

  after(() =>
    sendMail({
      to: [email],
      subject: "Ihr Zugang zum VTM Teamportal",
      html: mailLayout(
        `Willkommen, ${name}`,
        `<p style="margin:0 0 16px;">für Sie wurde ein Zugang zum VTM Teamportal angelegt — dem internen Portal für Dokumente, News, Aufgaben und Termine.</p>
         <table role="presentation" cellpadding="0" cellspacing="0" style="background:#F5F7FA;border-left:4px solid #1F4EFF;border-radius:0 6px 6px 0;width:100%;">
           <tr><td style="padding:16px 20px;font-family:'Arial Narrow',Arial,sans-serif;font-size:15px;line-height:1.8;">
             <strong>Adresse:</strong> <a href="${appUrl()}" style="color:#1F4EFF;">${appUrl().replace("https://", "")}</a><br>
             <strong>E-Mail:</strong> ${esc(email)}<br>
             <strong>Startpasswort:</strong> ${esc(password)}
           </td></tr>
         </table>
         <p style="margin:16px 0 0;color:#8A9BB5;font-size:13px;">Bitte behandeln Sie diese Zugangsdaten vertraulich.</p>`
      ),
    })
  );
}

export async function deleteUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = Number(str(formData, "id"));
  if (id === admin.id) return; // sich selbst löschen ist nicht erlaubt
  getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
  revalidatePath("/admin");
}

export async function resetPasswordAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(str(formData, "id"));
  const password = str(formData, "password");
  if (password.length < 8) redirect("/admin?fehler=passwort");
  getDb()
    .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .run(hashPassword(password), id);
  revalidatePath("/admin");
}
