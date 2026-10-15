import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Operations } from "../lib/operations.ts";
import { isAgent } from "../lib/operations-tools.ts";

const actor = process.argv[2];
if (!isAgent(actor)) throw new Error("Aufruf: node --experimental-transform-types scripts/operations-token.mjs juergen|natalie|mika|artur");
const directory = path.resolve("data"); fs.mkdirSync(directory, { recursive: true });
const db = new Database(path.join(directory, "vtm.db"));
const token = new Operations(db).provisionToken(actor, 24 * 30);
const destination = path.join(directory, `agent-${actor}.secret`);
fs.writeFileSync(destination, token, { mode: 0o600 });
db.close();
console.log(`Agentenzugang erneuert. Geheimnis lokal gespeichert: ${destination}. Gültig für 30 Tage. Nicht in Chats oder Versionsverwaltung kopieren.`);
