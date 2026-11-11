import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import nodemailer from "nodemailer";
import { SignJWT } from "jose";

export type DeliveryRequest = {
  id: string;
  idempotencyKey: string;
  channel: "email" | "ghost";
  payload: Record<string, unknown>;
  payloadHash: string;
  /** Dispatch generation, checked by the caller before each mutation. */
  attempt?: number;
  /** Approved sender address or Ghost origin, sealed into the workflow revision. */
  destination?: string;
};
/** accepted is a provider receipt, NOT evidence of delivery/publication. */
export type DeliveryResult = {
  status: "verified" | "accepted" | "uncertain" | "not_sent";
  providerId?: string;
  evidence?: string;
  error?: string;
};
export type DeliveryAdapter = {
  send(request: DeliveryRequest): Promise<DeliveryResult>;
  /** Read-only: never sends an email or creates/publishes a Ghost post. */
  reconcile(request: DeliveryRequest): Promise<DeliveryResult>;
  /** Trusted owner adjudication only. No external I/O; not an agent-facing action. */
  adjudicate?(request: DeliveryRequest, result: DeliveryResult): Promise<DeliveryResult>;
};
type Attempt = { fingerprint: string; result: DeliveryResult; generation: number; adjudicationHash: string | null };
export type DeliveryAttemptStore = {
  /** The production implementation must survive process restarts. */
  durable: true;
  read(key: string): Attempt | undefined;
  /** Atomically reserve BEFORE external I/O; retry only a confirmed not_sent attempt. */
  claim(key: string, fingerprint: string): boolean;
  save(key: string, fingerprint: string, result: DeliveryResult, generation: number): void;
  /** Invalidate in-flight writes and apply explicitly recorded owner evidence. */
  adjudicate(key: string, fingerprint: string, result: DeliveryResult, adjudicationHash: string): void;
};
export type SmtpOptions = {
  host: string; port: number; secure: boolean; requireTLS: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout: number; greetingTimeout: number; socketTimeout: number;
};
export type SmtpMessage = {
  from: string; to: string; subject: string; text?: string; html?: string;
  messageId: string; envelope: { from: string; to: string[] };
  disableFileAccess: true; disableUrlAccess: true;
};
export type SmtpTransport = {
  sendMail(message: SmtpMessage): Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[] }>;
  close?(): void;
};
export type SmtpReceipt = {
  messageId: string; recipient: string; payloadHash: string;
  state: "delivered" | "accepted" | "not_sent";
  /** Trusted provider audit/receipt reference, never an unverified caller assertion. */
  evidence: string;
};
export type DeliveryAdapterOptions = {
  /** Explicit activation is separate from merely having SMTP credentials. */
  enabled?: boolean;
  env?: NodeJS.ProcessEnv;
  store?: DeliveryAttemptStore;
  smtpFactory?: (options: SmtpOptions) => SmtpTransport;
  fetch?: typeof globalThis.fetch;
  clock?: () => number;
  /** Must synchronously recheck approval, stop, destination and attempt generation. */
  beforeMutation?: (request: DeliveryRequest, phase: "smtp_submit" | "ghost_create" | "ghost_publish") => void;
  /** Optional trusted provider integration. Generic SMTP cannot prove delivery. */
  smtpReceipt?: (query: { messageId: string; recipient: string; payloadHash: string }) => Promise<SmtpReceipt | null>;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new Error("Payload must contain only JSON values.");
}
/** The workflow must seal the exact payload with this hash before approval. */
export function deliveryPayloadHash(payload: Record<string, unknown>): string { return sha256(canonical(payload)); }
const pending = (): DeliveryResult => ({ status: "uncertain", error: "An attempt was reserved. Reconcile before any further action; never blindly resend." });
const noSend = (error: string): DeliveryResult => ({ status: "not_sent", error });
const uncertain = (error: string, providerId?: string): DeliveryResult => ({ status: "uncertain", error, ...(providerId ? { providerId } : {}) });
function preserveReceipt(previous: DeliveryResult, next: DeliveryResult): DeliveryResult {
  if (previous.status === "verified") return previous;
  if (previous.status === "accepted" && (next.status === "uncertain" || next.status === "not_sent")) return previous;
  return next;
}

/** A separate durable journal protects even a crash between provider I/O and outbox updates. */
export function createSqliteDeliveryStore(db: Database.Database): DeliveryAttemptStore {
  db.exec(`CREATE TABLE IF NOT EXISTS customer_delivery_attempts (
    idempotency_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL,
    generation INTEGER NOT NULL DEFAULT 1, adjudication_hash TEXT
  )`);
  if (!(db.prepare("PRAGMA table_info(customer_delivery_attempts)").all() as {name: string}[]).some(column => column.name === "generation")) {
    db.exec("ALTER TABLE customer_delivery_attempts ADD COLUMN generation INTEGER NOT NULL DEFAULT 1");
  }
  if (!(db.prepare("PRAGMA table_info(customer_delivery_attempts)").all() as {name: string}[]).some(column => column.name === "adjudication_hash")) {
    db.exec("ALTER TABLE customer_delivery_attempts ADD COLUMN adjudication_hash TEXT");
  }
  const read = (key: string): Attempt | undefined => {
    const row = db.prepare("SELECT fingerprint, result, generation, adjudication_hash FROM customer_delivery_attempts WHERE idempotency_key = ?").get(key) as { fingerprint: string; result: string; generation: number; adjudication_hash: string | null } | undefined;
    return row ? { fingerprint: row.fingerprint, result: JSON.parse(row.result) as DeliveryResult, generation: row.generation, adjudicationHash: row.adjudication_hash } : undefined;
  };
  return {
    durable: true,
    read,
    claim: db.transaction((key: string, fingerprint: string) => {
      const previous = read(key);
      if (!previous) return db.prepare("INSERT OR IGNORE INTO customer_delivery_attempts (idempotency_key, fingerprint, result) VALUES (?, ?, ?)")
        .run(key, fingerprint, JSON.stringify(pending())).changes === 1;
      if (previous.fingerprint !== fingerprint || previous.result.status !== "not_sent") return false;
      db.prepare("UPDATE customer_delivery_attempts SET result = ?, generation = generation + 1 WHERE idempotency_key = ? AND fingerprint = ?")
        .run(JSON.stringify(pending()), key, fingerprint);
      return true;
    }).immediate,
    save: db.transaction((key: string, fingerprint: string, result: DeliveryResult, generation: number) => {
      const previous = read(key);
      if (!previous || previous.fingerprint !== fingerprint || previous.generation !== generation) throw new Error("Delivery attempt identity/generation mismatch.");
      db.prepare("UPDATE customer_delivery_attempts SET result = ? WHERE idempotency_key = ? AND fingerprint = ?")
        .run(JSON.stringify(preserveReceipt(previous.result, result)), key, fingerprint);
    }).immediate,
    adjudicate: db.transaction((key: string, fingerprint: string, result: DeliveryResult, adjudicationHash: string) => {
      const previous = read(key);
      if (previous?.fingerprint === fingerprint && previous.adjudicationHash === adjudicationHash) return;
      if (!previous || previous.fingerprint !== fingerprint || (previous.result.status === "verified" && result.status !== "verified")) throw new Error("Owner adjudication does not match the existing attempt.");
      db.prepare("UPDATE customer_delivery_attempts SET result = ?, generation = generation + 1, adjudication_hash = ? WHERE idempotency_key = ? AND fingerprint = ?")
        .run(JSON.stringify(result), adjudicationHash, key, fingerprint);
    }).immediate,
  };
}

const mailbox = (value: unknown): value is string => typeof value === "string" && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(value);
function nonempty(value: unknown, max: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function validationError(request: DeliveryRequest): string | undefined {
  if (!request || !nonempty(request.id, 200) || !nonempty(request.idempotencyKey, 200)) return "Invalid delivery identity.";
  if (request.channel !== "email" && request.channel !== "ghost") return "Unsupported delivery channel.";
  if (!request.payload || Object.getPrototypeOf(request.payload) !== Object.prototype) return "Invalid delivery payload.";
  if (!/^[a-f0-9]{64}$/.test(request.payloadHash) || deliveryPayloadHash(request.payload) !== request.payloadHash) return "Approved payload hash mismatch.";
  const payload = request.payload;
  const allowed = request.channel === "email" ? ["to", "subject", "text", "html"] : ["title", "html"];
  if (Object.keys(payload).some(key => !allowed.includes(key))) return "Payload contains unsupported fields.";
  if (request.channel === "email") {
    if (!mailbox(payload.to) || !nonempty(payload.subject, 500) || /[\r\n\x00]/.test(payload.subject)) return "Invalid email recipient or subject.";
    if ((payload.text !== undefined && !nonempty(payload.text, 500_000)) || (payload.html !== undefined && !nonempty(payload.html, 500_000)) || (!payload.text && !payload.html)) return "Email requires valid text or HTML content.";
  } else if (!nonempty(payload.title, 500) || !nonempty(payload.html, 500_000)) return "Ghost requires a title and HTML content.";
  return undefined;
}

type EmailConfig = { from: string; options: SmtpOptions };
type GhostConfig = { origin: string; keyId: string; secret: string };
function emailConfig(env: NodeJS.ProcessEnv): EmailConfig | undefined {
  const from = env.MAIL_FROM ?? env.SMTP_USER;
  const port = Number(env.SMTP_PORT ?? 587);
  if (!mailbox(from) || !env.SMTP_HOST || /[\s/@?#]/.test(env.SMTP_HOST) || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  if ((env.SMTP_USER && !env.SMTP_PASS) || (!env.SMTP_USER && env.SMTP_PASS)) return undefined;
  return { from, options: { host: env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS! } } : {}),
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 } };
}
function ghostOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return undefined;
    return url.origin;
  } catch { return undefined; }
}
function ghostConfig(env: NodeJS.ProcessEnv): GhostConfig | undefined {
  const origin = ghostOrigin(env.GHOST_ADMIN_URL ?? "");
  const key = /^([a-f0-9]{24}):([a-f0-9]{64})$/i.exec(env.GHOST_ADMIN_API_KEY ?? "");
  return origin && key ? { origin, keyId: key[1], secret: key[2] } : undefined;
}
function messageId(request: DeliveryRequest, config: EmailConfig) { return `<vtm-${sha256(request.idempotencyKey)}@${config.from.split("@")[1]}>`; }
class MutationBlockedError extends Error {}
function ghostIdentity(request: DeliveryRequest) {
  const key = sha256(request.idempotencyKey);
  return { slug: `vtm-${key}`, tags: [`#vtm-key-${key}`, `#vtm-payload-${request.payloadHash}`] };
}
function ghostLexical(request: DeliveryRequest): string {
  return JSON.stringify({ root: { children: [{ type: "html", version: 1, html: request.payload.html }], direction: null, format: "", indent: 0, type: "root", version: 1 } });
}
type GhostPost = { id: string; slug: string; title: string; lexical: string; status: string; updated_at: string; visibility: string; tags: { name: string }[] };
function exactPost(body: unknown, request: DeliveryRequest): GhostPost | undefined {
  try {
    const posts = (body as { posts?: GhostPost[] })?.posts;
    if (!Array.isArray(posts) || posts.length !== 1) return undefined;
    const post = posts[0]; const marker = ghostIdentity(request);
    if (!/^[a-f0-9]{24}$/.test(post.id) || post.slug !== marker.slug || post.title !== request.payload.title || post.visibility !== "public" || !nonempty(post.updated_at, 100) || !Number.isFinite(Date.parse(post.updated_at))) return undefined;
    if (!Array.isArray(post.tags) || !marker.tags.every(tag => post.tags.some(item => item.name === tag))) return undefined;
    if (canonical(JSON.parse(post.lexical)) !== canonical(JSON.parse(ghostLexical(request)))) return undefined;
    return post;
  } catch { return undefined; }
}

/**
 * Default off. Enabling requires CUSTOMER_DELIVERY_ENABLED=true (or enabled:true),
 * a durable store, and valid channel configuration. Does not read caller URLs,
 * follow redirects, fetch email assets, or infer approval. The caller must verify
 * owner approval, its payload hash and the external stop immediately before send.
 */
export function createDeliveryAdapter(options: DeliveryAdapterOptions = {}): DeliveryAdapter {
  // Snapshot configuration: a reused adapter cannot silently switch destinations.
  const env = { ...(options.env ?? process.env) };
  const enabled = options.enabled ?? env.CUSTOMER_DELIVERY_ENABLED === "true";
  const store = options.store;
  const smtp = emailConfig(env); const ghost = ghostConfig(env);
  const fetcher = options.fetch ?? globalThis.fetch;
  const clock = options.clock ?? Date.now;
  const evidence = (kind: string, request: DeliveryRequest, data: Record<string, unknown>) => JSON.stringify({ kind, payloadHash: request.payloadHash, observedAt: new Date(clock()).toISOString(), ...data });
  const fingerprint = (request: DeliveryRequest) => sha256(canonical({ id: request.id, channel: request.channel, payloadHash: request.payloadHash,
    destination: request.channel === "email" ? { from: smtp?.from ?? null, host: smtp?.options.host ?? null, port: smtp?.options.port ?? null } : ghost?.origin ?? null }));
  const guard = (request: DeliveryRequest): string | undefined => {
    try {
      const invalid = validationError(request); if (invalid) return invalid;
      const target = request.channel === "email" ? smtp?.from : ghost?.origin;
      const destination = request.channel === "ghost" && typeof request.destination === "string" ? ghostOrigin(request.destination) : request.destination;
      if (request.destination !== undefined && (!destination || destination !== target)) return "Configured destination does not match the approved target.";
      if (request.attempt !== undefined && (!Number.isSafeInteger(request.attempt) || request.attempt < 1)) return "Invalid dispatch attempt generation.";
      return undefined;
    } catch { return "Invalid or non-JSON delivery payload."; }
  };
  const record = (request: DeliveryRequest, result: DeliveryResult, generation: number): DeliveryResult => {
    try { store!.save(request.idempotencyKey, fingerprint(request), result, generation); return store!.read(request.idempotencyKey)!.result; }
    catch { return uncertain("Could not persist provider outcome; reconcile the durable attempt before any further action.", result.providerId); }
  };
  function checkMutation(request: DeliveryRequest, phase: "smtp_submit" | "ghost_create" | "ghost_publish") {
    const returned: unknown = options.beforeMutation!(request, phase);
    // An accidentally async assertion must not turn into unchecked external I/O.
    if (returned && typeof returned === "object" && "then" in returned) {
      void Promise.resolve(returned).catch(() => {});
      throw new MutationBlockedError();
    }
  }
  async function ghostApi(config: GhostConfig, path: string, method = "GET", body?: unknown, request?: DeliveryRequest) {
    const now = Math.floor(clock() / 1000);
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256", typ: "JWT", kid: config.keyId })
      .setIssuedAt(now).setExpirationTime(now + 300).setAudience("/admin/").sign(Buffer.from(config.secret, "hex"));
    // Token signing is async; authorization must be checked AFTER it, directly before I/O.
    if (method !== "GET") {
      try { checkMutation(request!, method === "POST" ? "ghost_create" : "ghost_publish"); }
      catch { throw new MutationBlockedError(); }
    }
    return fetcher(`${config.origin}/ghost/api/admin/${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Ghost ${token}`, "Accept-Version": "v5.0", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function readPost(request: DeliveryRequest): Promise<{ absent: true } | { post: GhostPost }> {
    const response = await ghostApi(ghost!, `posts/slug/${ghostIdentity(request).slug}/?formats=lexical`);
    if (response.status === 404) return { absent: true };
    if (!response.ok) throw new Error("Ghost reconciliation unavailable.");
    const post = exactPost(await response.json(), request);
    if (!post) throw new Error("Ghost identity/content evidence does not match the approved payload.");
    return { post };
  }
  function ghostVerified(request: DeliveryRequest, post: GhostPost): DeliveryResult {
    return { status: "verified", providerId: post.id, evidence: evidence("ghost_published_readback", request, { origin: ghost!.origin, postId: post.id, slug: post.slug, updatedAt: post.updated_at }) };
  }
  async function reconcileEvidence(request: DeliveryRequest, previous?: Attempt): Promise<DeliveryResult> {
    if (request.channel === "email") {
      const query = { messageId: messageId(request, smtp!), recipient: request.payload.to as string, payloadHash: request.payloadHash };
      if (options.smtpReceipt) {
        try {
          const receipt = await options.smtpReceipt(query);
          if (receipt && receipt.messageId === query.messageId && receipt.recipient === query.recipient && receipt.payloadHash === query.payloadHash && nonempty(receipt.evidence, 20_000) && ["delivered", "accepted", "not_sent"].includes(receipt.state)) {
            return { status: receipt.state === "delivered" ? "verified" : receipt.state, providerId: query.messageId,
              evidence: evidence("smtp_provider_receipt", request, { messageId: query.messageId, recipient: query.recipient, state: receipt.state, receipt: receipt.evidence }) };
          }
        } catch { /* Provider downtime is not evidence that an email was not sent. */ }
      }
      if (previous?.result.status === "accepted" || previous?.result.status === "verified" || previous?.result.status === "not_sent") return previous.result;
      return uncertain("SMTP has no delivery/deduplication lookup. A stable Message-ID does not prove non-delivery; obtain provider evidence before retrying.", query.messageId);
    }
    try {
      const found = await readPost(request);
      if ("post" in found && found.post.status === "published") return ghostVerified(request, found.post);
      return uncertain("post" in found ? "Matching Ghost draft exists; publication is not verified. Review the existing draft instead of creating another." : "No matching Ghost post is visible. Absence does not prove an earlier submission failed.", "post" in found ? found.post.id : undefined);
    } catch { return uncertain("Ghost reconciliation is unavailable or identity/content evidence does not match."); }
  }
  async function sendEmail(request: DeliveryRequest): Promise<DeliveryResult> {
    let transport: SmtpTransport;
    try { transport = (options.smtpFactory ?? (config => nodemailer.createTransport(config)))(smtp!.options); }
    catch { return noSend("SMTP transport could not be initialized; no message was submitted."); }
    const id = messageId(request, smtp!);
    try {
      try { checkMutation(request, "smtp_submit"); }
      catch { return noSend("Current authorization or stop check rejected SMTP submission; no message was submitted."); }
      const info = await transport.sendMail({ from: smtp!.from, to: request.payload.to as string, subject: request.payload.subject as string,
        ...(request.payload.text === undefined ? {} : { text: request.payload.text as string }),
        ...(request.payload.html === undefined ? {} : { html: request.payload.html as string }),
        messageId: id, envelope: { from: smtp!.from, to: [request.payload.to as string] }, disableFileAccess: true, disableUrlAccess: true });
      const accepted = info.accepted?.map(value => typeof value === "string" ? value : value && typeof value === "object" && "address" in value ? value.address : undefined);
      if (info.messageId !== id || accepted?.length !== 1 || accepted[0] !== request.payload.to || (info.rejected?.length ?? 0) !== 0) return uncertain("SMTP did not return an unambiguous receipt for the expected recipient and Message-ID.", id);
      return { status: "accepted", providerId: id, evidence: evidence("smtp_accepted_not_delivered", request, { messageId: id, recipient: request.payload.to }) };
    } catch { return uncertain("SMTP submission outcome is unknown. Do not resend without provider evidence.", id); }
    finally { try { transport.close?.(); } catch { /* Closing a connection does not change the send result. */ } }
  }
  async function sendGhost(request: DeliveryRequest): Promise<DeliveryResult> {
    let post: GhostPost | undefined;
    let mutationStarted = false;
    try {
      const found = await readPost(request);
      if ("post" in found) post = found.post;
      if (post?.status === "published") return ghostVerified(request, post);
      if (post && post.status !== "draft") return uncertain("Existing Ghost post is neither the expected draft nor published.", post.id);
      if (!post) {
        const marker = ghostIdentity(request);
        mutationStarted = true;
        const created = await ghostApi(ghost!, "posts/?formats=lexical", "POST", { posts: [{ title: request.payload.title, lexical: ghostLexical(request), slug: marker.slug, status: "draft", visibility: "public", tags: marker.tags.map(name => ({ name })) }] }, request);
        if (!created.ok) return uncertain("Ghost draft creation did not return a conclusive response; reconcile before further action.");
        const draft = exactPost(await created.json(), request);
        if (!draft || draft.status !== "draft") return uncertain("Ghost draft response did not match the approved identity/content.");
        const readback = await readPost(request);
        if (!("post" in readback) || readback.post.id !== draft.id || readback.post.status !== "draft") return uncertain("Ghost draft readback was inconclusive.", draft.id);
        post = readback.post;
      }
      // The update targets the one verified draft, with Ghost's optimistic concurrency timestamp.
      mutationStarted = true;
      const published = await ghostApi(ghost!, `posts/${post.id}/?formats=lexical`, "PUT", { posts: [{ id: post.id, updated_at: post.updated_at, status: "published" }] }, request);
      if (!published.ok) return uncertain("Ghost publication outcome is unknown; reconcile the existing post.", post.id);
      const accepted = exactPost(await published.json(), request);
      if (!accepted || accepted.id !== post.id || accepted.status !== "published") return uncertain("Ghost publication response did not contain matching publication evidence.", post.id);
      try {
        const readback = await readPost(request);
        if ("post" in readback && readback.post.id === post.id && readback.post.status === "published") return ghostVerified(request, readback.post);
      } catch { /* A successful update is not the same as verified readback. */ }
      return { status: "accepted", providerId: post.id, evidence: evidence("ghost_publish_accepted_unverified", request, { origin: ghost!.origin, postId: post.id }) };
    } catch (error) {
      if (error instanceof MutationBlockedError) return post
        ? uncertain("Current authorization or stop check blocked publication. Review the existing Ghost draft before further action.", post.id)
        : noSend("Current authorization or stop check blocked Ghost creation; no draft was submitted.");
      return mutationStarted ? uncertain("Ghost mutation outcome is unknown; reconcile before any further action.", post?.id) : noSend("Ghost preflight failed; no draft or publication was submitted.");
    }
  }
  return {
    async send(request) {
      try { request = { ...request, payload: JSON.parse(canonical(request.payload)) }; }
      catch { return noSend("Invalid or non-JSON delivery payload."); }
      const invalid = guard(request); if (invalid) return noSend(invalid);
      if (!enabled) return noSend("Customer delivery is disabled.");
      if (!options.beforeMutation) return noSend("A current authorization/stop callback is required before external mutations.");
      if (!store?.durable) return noSend("A durable delivery attempt store is required.");
      if (request.channel === "email" ? !smtp : !ghost) return noSend("Delivery channel configuration is incomplete or invalid.");
      let generation: number;
      try {
        const key = fingerprint(request);
        if (!store.claim(request.idempotencyKey, key)) {
          const previous = store.read(request.idempotencyKey);
          if (!previous || previous.fingerprint !== key) return noSend("Idempotency key belongs to a different request or destination.");
          if (previous.result.status !== "uncertain") return previous.result;
          return record(request, await reconcileEvidence(request, previous), previous.generation);
        }
        generation = store.read(request.idempotencyKey)!.generation;
      } catch { return uncertain("Could not reserve/read the durable attempt; no new submission was started."); }
      return record(request, await (request.channel === "email" ? sendEmail(request) : sendGhost(request)), generation);
    },
    async reconcile(request) {
      try { request = { ...request, payload: JSON.parse(canonical(request.payload)) }; }
      catch { return uncertain("Invalid or non-JSON delivery payload."); }
      const invalid = guard(request); if (invalid) return uncertain(invalid);
      if (!enabled) return uncertain("Customer delivery is disabled; no provider lookup was made.");
      if (!store?.durable || (request.channel === "email" ? !smtp : !ghost)) return uncertain("Reconciliation requires the configured channel and durable attempt store.");
      let previous: Attempt | undefined;
      try {
        previous = store.read(request.idempotencyKey);
        if (previous && previous.fingerprint !== fingerprint(request)) return uncertain("Idempotency key belongs to a different request or destination.");
      } catch { return uncertain("Could not read the durable delivery attempt."); }
      const result = await reconcileEvidence(request, previous);
      return previous ? record(request, result, previous.generation) : result;
    },
    async adjudicate(request, result) {
      try { request = { ...request, payload: JSON.parse(canonical(request.payload)) }; }
      catch { return uncertain("Invalid owner adjudication request."); }
      const invalid = guard(request); if (invalid) return uncertain(invalid);
      if (!store?.durable || (request.channel === "email" ? !smtp : !ghost)) return uncertain("Owner adjudication requires the configured channel and durable store.");
      if (!["verified", "not_sent"].includes(result.status) || !nonempty(result.providerId, 500) || !nonempty(result.evidence, 20_000)) return uncertain("Owner adjudication requires a definitive outcome, provider identity and concrete evidence.");
      try {
        const previous = store.read(request.idempotencyKey);
        if (!previous || previous.fingerprint !== fingerprint(request)) return uncertain("No matching durable attempt exists for owner adjudication.");
        store.adjudicate(request.idempotencyKey, previous.fingerprint, { status: result.status, providerId: result.providerId,
          evidence: evidence("explicit_owner_adjudication", request, { providerId: result.providerId, outcome: result.status, receipt: result.evidence }) }, sha256(canonical({ status: result.status, providerId: result.providerId, evidence: result.evidence })));
        return store.read(request.idempotencyKey)!.result;
      } catch { return uncertain("Could not persist the exact owner adjudication."); }
    },
  };
}
