import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { DATA_DIR, getDb, type User } from "./db";

const SESSION_COOKIE = "vtm_session";
const SESSION_DAYS = 30;

// The signing secret comes from AUTH_SECRET if set; otherwise a random
// secret is generated once and kept in data/auth-secret so sessions
// survive restarts without any configuration.
function getSecret(): Uint8Array {
  if (process.env.AUTH_SECRET) {
    return new TextEncoder().encode(process.env.AUTH_SECRET);
  }
  const secretFile = path.join(DATA_DIR, "auth-secret");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(secretFile)) {
    fs.writeFileSync(secretFile, crypto.randomBytes(32).toString("hex"), {
      mode: 0o600,
    });
  }
  return new TextEncoder().encode(fs.readFileSync(secretFile, "utf8").trim());
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 12);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export async function createSession(userId: number): Promise<void> {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSecret());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    path: "/",
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const uid = payload.uid;
    if (typeof uid !== "number") return null;
    const user = getDb()
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(uid) as User | undefined;
    return user ?? null;
  } catch {
    return null;
  }
}

export function hasAnyUser(): boolean {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as {
    n: number;
  };
  return row.n > 0;
}

/** Guard for authenticated pages: redirects to /setup or /login as needed. */
export async function requireUser(): Promise<User> {
  if (!hasAnyUser()) redirect("/setup");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}
