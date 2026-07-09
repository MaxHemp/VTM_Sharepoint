import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb, UPLOAD_DIR, type Doc } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  const { id } = await params;
  const doc = getDb()
    .prepare("SELECT * FROM documents WHERE id = ?")
    .get(Number(id)) as Doc | undefined;
  if (!doc) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const filePath = path.join(UPLOAD_DIR, doc.stored_name);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Datei fehlt" }, { status: 404 });
  }

  const data = fs.readFileSync(filePath);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Length": String(doc.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
    },
  });
}
