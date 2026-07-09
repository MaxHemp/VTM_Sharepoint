import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  stored_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function createDb(): Database.Database {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "vtm.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

// Cache the connection on globalThis so Next.js hot reload doesn't open
// a new handle on every code change.
const globalForDb = globalThis as unknown as { __vtmDb?: Database.Database };

export function getDb(): Database.Database {
  if (!globalForDb.__vtmDb) {
    globalForDb.__vtmDb = createDb();
  }
  return globalForDb.__vtmDb;
}

export type User = {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: "admin" | "member";
  created_at: string;
};

export type Folder = {
  id: number;
  name: string;
  parent_id: number | null;
  created_by: number | null;
  created_at: string;
};

export type Doc = {
  id: number;
  name: string;
  folder_id: number | null;
  stored_name: string;
  size: number;
  mime: string;
  uploaded_by: number | null;
  created_at: string;
};

export type Announcement = {
  id: number;
  title: string;
  body: string;
  created_by: number | null;
  created_at: string;
};

export type Task = {
  id: number;
  title: string;
  description: string;
  status: "open" | "done";
  assigned_to: number | null;
  due_date: string | null;
  created_by: number | null;
  created_at: string;
};

export type Event = {
  id: number;
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  location: string;
  description: string;
  created_by: number | null;
  created_at: string;
};
