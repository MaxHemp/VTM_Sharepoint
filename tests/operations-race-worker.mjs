import { workerData, parentPort } from "node:worker_threads";
import Database from "better-sqlite3";
import { Operations } from "../lib/operations.ts";

const db = new Database(workerData.filename);
db.pragma("busy_timeout=5000");
const ops = new Operations(db);
const gate = new Int32Array(workerData.gate);
if (Atomics.load(gate, 0) === 0) Atomics.wait(gate, 0, 0);
try {
  ops.call("artur", "claim_job", { id: workerData.job.id, version: workerData.job.version, request_key: `race-${workerData.index}` });
  parentPort.postMessage({ ok: true });
} catch (error) { parentPort.postMessage({ ok: false, code: error.code }); }
finally { db.close(); }
