import { DurableObject } from "cloudflare:workers";
import { unifiedDiff } from "./diff";
import { ADMIN_BIO, ADMIN_EMAIL, ADMIN_HANDLE, ADMIN_NAME, SEED_VERSION } from "./seed";

export interface Env {
  STORE: DurableObjectNamespace<GitPostStore>;
  ASSETS: Fetcher;
  ADMIN_PASSWORD?: string;
}

type User = {
  id: string;
  handle: string;
  name: string;
  email: string;
  bio: string;
  password_hash: string;
  created_at: string;
  role?: string;
  disabled?: number;
  failed_logins?: number;
  locked_until?: string;
};

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function err(status: number, message: string): Response {
  return json({ error: message }, status);
}

function slugify(s: string): string {
  const out = s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return out || "post";
}

function normalizeTopicName(s: string): string {
  s = (s || "").toLowerCase().trim().replace(/^remote:/, "").replace(/^#/, "").trim();
  if (!s) return "";
  s = slugify(s);
  if (s.length < 2 || s.length > 40) return "";
  return s;
}

function parseReviews(raw: string | null | undefined): any[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function canPushPost(p: any, viewer: User | null): boolean {
  if (!p || !viewer) return false;
  if (p.owner === viewer.handle) return true;
  if (parseTopics(p.maintainers_json).includes(viewer.handle)) return true;
  if (!p.protected && parseTopics(p.coauthors_json).includes(viewer.handle)) return true;
  return false;
}

function reviewsReady(list: any[]): boolean {
  if (!list.length) return true;
  return list.every((r) => r.status === "approved");
}

function trailerBlock(p: any, user: User, signoff: boolean): string {
  const lines: string[] = [];
  for (const h of parseTopics(p.coauthors_json)) {
    if (h.toLowerCase() === user.handle.toLowerCase()) continue;
    lines.push(`Co-authored-by: ${h} <${h}@gitpo.st>`);
  }
  if (signoff) lines.push(`Signed-off-by: ${user.name} <${user.email}>`);
  return lines.join("\n");
}

function ideaMergeText(base: string, ours: string, theirs: string, oursLabel: string, theirsLabel: string): { body: string; conflict: boolean } {
  if (ours === theirs) return { body: theirs, conflict: false };
  if (ours === base) return { body: theirs, conflict: false };
  if (theirs === base) return { body: ours, conflict: false };
  const b = splitParagraphs(base);
  const o = splitParagraphs(ours);
  const t = splitParagraphs(theirs);
  const n = Math.max(o.length, t.length, b.length);
  const out: string[] = [];
  let conflict = false;
  for (let i = 0; i < n; i++) {
    const bp = b[i] || "";
    const op = o[i] || "";
    const tp = t[i] || "";
    if (op === tp) {
      if (op) out.push(op);
    } else if (op === bp) {
      if (tp) out.push(tp);
    } else if (tp === bp) {
      if (op) out.push(op);
    } else {
      conflict = true;
      out.push(`<<<<<<< ${oursLabel}\n${op}\n=======\n${tp}\n>>>>>>> ${theirsLabel}`);
    }
  }
  return { body: out.join("\n\n"), conflict };
}

function parseTopics(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function extractTopics(explicit: string[] | undefined, subject: string, body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string) => {
    const t = normalizeTopicName(raw);
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const t of explicit || []) add(t);
  const blob = `${subject}\n${body || ""}`;
  const re = /#([A-Za-z][A-Za-z0-9_-]{1,39})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob))) add(m[1]);
  return out.slice(0, 8);
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function hex(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function shaHex(algo: "SHA-1" | "SHA-256", text: string): Promise<string> {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function hashPass(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, base, 256);
  return `pbkdf2$100000$${hexBytes(salt)}$${hexBytes(new Uint8Array(bits))}`;
}

async function checkPass(stored: string, pw: string): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith("pbkdf2$")) {
    const [, iterS, saltHex, hashHex] = stored.split("$");
    const iter = Number(iterS) || 120000;
    const salt = unhex(saltHex);
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, 256);
    return hexBytes(new Uint8Array(bits)) === hashHex;
  }
  return (await shaHex("SHA-256", "gitpost:" + pw)) === stored;
}

function hexBytes(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function validatePassword(pw: string, min = 12): string | null {
  if (pw.length < min) return "password must be at least 12 characters and include a letter and a number";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "password must be at least 12 characters and include a letter and a number";
  return null;
}

function isAdmin(u: User | null): boolean {
  return !!u && (u.role === "admin" || u.role === "superadmin");
}

function isSuper(u: User | null): boolean {
  return !!u && u.role === "superadmin";
}

async function gitCommitSha(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const header = new TextEncoder().encode(`commit ${bytes.length}\0`);
  const combined = new Uint8Array(header.length + bytes.length);
  combined.set(header);
  combined.set(bytes, header.length);
  const buf = await crypto.subtle.digest("SHA-1", combined);
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function encodePostFile(subject: string, body: string, story: unknown): string {
  let raw = `# ${subject}\n\n${(body || "").trim()}\n`;
  if (story) raw += `\n---\nstory.json\n${JSON.stringify(story, null, 2)}\n`;
  return raw;
}

function cookie(token: string, clear = false): string {
  if (clear) return "gp_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
  return `gp_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export class GitPostStore extends DurableObject<Env> {
  private ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = this.ctx.blockConcurrencyWhile(() => this.init());
  }

  private sql<T = Record<string, unknown>>(q: string, ...binds: unknown[]): T[] {
    return this.ctx.storage.sql.exec(q, ...binds).toArray() as T[];
  }

  private one<T = Record<string, unknown>>(q: string, ...binds: unknown[]): T | null {
    return this.sql<T>(q, ...binds)[0] ?? null;
  }

  private async init() {
    let ver: { value: string } | null = null;
    try {
      ver = this.one<{ value: string }>("SELECT value FROM meta WHERE key = ?", "seed_version");
    } catch {
      ver = null;
    }
    if (!ver || ver.value !== SEED_VERSION) {
      for (const t of ["stars", "watches", "branches", "commits", "prs", "posts", "sessions", "users", "invites", "audits", "settings", "meta"]) {
        try {
          this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS ${t}`);
        } catch {
          /* */
        }
      }
    }
    const statements = [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        handle TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        bio TEXT,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        disabled INTEGER DEFAULT 0,
        failed_logins INTEGER DEFAULT 0,
        locked_until TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_agent TEXT,
        ip TEXT,
        created_at TEXT,
        expires_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        subject TEXT NOT NULL,
        slug TEXT,
        body TEXT,
        head_sha TEXT,
        parent_post_id TEXT,
        forked_from_sha TEXT,
        fork_intent TEXT,
        fork_intent_note TEXT,
        story_json TEXT,
        story_url TEXT,
        default_branch TEXT DEFAULT 'main',
        created_at TEXT,
        updated_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS commits (
        sha TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        subject TEXT,
        body TEXT,
        author TEXT,
        email TEXT,
        created_at TEXT,
        parent_sha TEXT,
        story_json TEXT,
        branch TEXT DEFAULT 'main'
      )`,
      `CREATE TABLE IF NOT EXISTS stars (
        post_id TEXT NOT NULL,
        handle TEXT NOT NULL,
        PRIMARY KEY (post_id, handle)
      )`,
      `CREATE TABLE IF NOT EXISTS watches (
        post_id TEXT NOT NULL,
        handle TEXT NOT NULL,
        PRIMARY KEY (post_id, handle)
      )`,
      `CREATE TABLE IF NOT EXISTS branches (
        post_id TEXT NOT NULL,
        name TEXT NOT NULL,
        sha TEXT,
        PRIMARY KEY (post_id, name)
      )`,
      `CREATE TABLE IF NOT EXISTS prs (
        id TEXT PRIMARY KEY,
        number INTEGER,
        title TEXT,
        body TEXT,
        author TEXT,
        target_post_id TEXT,
        source_post_id TEXT,
        source_sha TEXT,
        target_sha TEXT,
        status TEXT,
        merged_sha TEXT,
        kind TEXT DEFAULT 'full',
        paragraph_index INTEGER DEFAULT 0,
        original TEXT,
        proposed TEXT,
        rationale TEXT,
        review_note TEXT,
        comments_json TEXT,
        created_at TEXT,
        updated_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS invites (
        code TEXT PRIMARY KEY,
        created_by TEXT,
        used_by TEXT,
        created_at TEXT,
        expires_at TEXT,
        used_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS audits (
        id TEXT PRIMARY KEY,
        actor TEXT,
        action TEXT,
        target TEXT,
        detail TEXT,
        created_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS remotes (
        handle TEXT NOT NULL,
        topic TEXT NOT NULL,
        created_at TEXT,
        PRIMARY KEY (handle, topic)
      )`,
      `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        kind TEXT,
        post_id TEXT,
        sha TEXT,
        actor TEXT,
        created_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        parent_id TEXT,
        author TEXT,
        body TEXT,
        branch TEXT,
        created_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        subject TEXT,
        body TEXT,
        story_url TEXT,
        topics_json TEXT,
        created_at TEXT,
        updated_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS notices (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        kind TEXT,
        actor TEXT,
        post_id TEXT,
        source_post_id TEXT,
        sha TEXT,
        subject TEXT,
        read INTEGER,
        created_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS watches (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        repo TEXT NOT NULL,
        provider TEXT,
        last_tag TEXT,
        created_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS hints (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        repo TEXT,
        tag TEXT,
        name TEXT,
        body TEXT,
        html_url TEXT,
        published_at TEXT,
        dismissed INTEGER,
        draft_id TEXT,
        created_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
    ];
    for (const stmt of statements) {
      this.ctx.storage.sql.exec(stmt);
    }
    for (const extra of [
      "ALTER TABLE posts ADD COLUMN fork_intent TEXT",
      "ALTER TABLE posts ADD COLUMN fork_intent_note TEXT",
      "ALTER TABLE prs ADD COLUMN kind TEXT",
      "ALTER TABLE prs ADD COLUMN paragraph_index INTEGER",
      "ALTER TABLE prs ADD COLUMN original TEXT",
      "ALTER TABLE prs ADD COLUMN proposed TEXT",
      "ALTER TABLE prs ADD COLUMN rationale TEXT",
      "ALTER TABLE prs ADD COLUMN review_note TEXT",
      "ALTER TABLE prs ADD COLUMN comments_json TEXT",
      "ALTER TABLE posts ADD COLUMN topics_json TEXT",
      "ALTER TABLE posts ADD COLUMN coauthors_json TEXT",
      "ALTER TABLE posts ADD COLUMN invites_json TEXT",
      "ALTER TABLE posts ADD COLUMN maintainers_json TEXT",
      "ALTER TABLE posts ADD COLUMN protected INTEGER",
      "ALTER TABLE posts ADD COLUMN reviewers_json TEXT",
      "ALTER TABLE prs ADD COLUMN draft INTEGER",
      "ALTER TABLE prs ADD COLUMN reviewers_json TEXT",
      "ALTER TABLE prs ADD COLUMN conflict_body TEXT",
      "ALTER TABLE commits ADD COLUMN trailers TEXT",
      "ALTER TABLE posts ADD COLUMN derived_json TEXT",
      "ALTER TABLE users ADD COLUMN quiet_derived INTEGER",
      "ALTER TABLE posts ADD COLUMN kind TEXT",
      "ALTER TABLE posts ADD COLUMN bridges_json TEXT",
    ]) {
      try {
        this.ctx.storage.sql.exec(extra);
      } catch {
        /* already present */
      }
    }
    const seeded = this.one<{ value: string }>("SELECT value FROM meta WHERE key = ?", "seed_version");
    if (!seeded || seeded.value !== SEED_VERSION) await this.seed();
    await this.ensureAdminPassword();
  }

  private setting(key: string, fallback: string): string {
    return this.one<{ value: string }>("SELECT value FROM settings WHERE key = ?", key)?.value || fallback;
  }

  private setSetting(key: string, value: string) {
    this.sql("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, value);
  }

  private audit(actor: string, action: string, target = "", detail = "") {
    this.sql(
      "INSERT INTO audits (id, actor, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      hex(6),
      actor,
      action,
      target,
      detail,
      new Date().toISOString(),
    );
  }

  private async seed() {
    const pw = this.env.ADMIN_PASSWORD || "";
    if (!pw) throw new Error("ADMIN_PASSWORD is required to seed the super admin");
    await this.createUser(ADMIN_HANDLE, ADMIN_NAME, ADMIN_EMAIL, ADMIN_BIO, pw, "superadmin");
    this.setSetting("signupMode", "invite");
    this.setSetting("minPassword", "12");
    this.audit("system", "bootstrap", ADMIN_HANDLE, "seeded super admin");
    this.sql("INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_version', ?)", SEED_VERSION);
    this.sql("INSERT OR REPLACE INTO meta (key, value) VALUES ('admin_pw_fp', ?)", await shaHex("SHA-256", "admin-pw:" + pw));
  }

  private async ensureAdminPassword() {
    const pw = this.env.ADMIN_PASSWORD || "";
    if (!pw) return;
    const fp = await shaHex("SHA-256", "admin-pw:" + pw);
    const current = this.one<{ value: string }>("SELECT value FROM meta WHERE key = ?", "admin_pw_fp");
    if (current?.value === fp) return;
    const existing = this.one<User>("SELECT * FROM users WHERE handle = ?", ADMIN_HANDLE);
    if (existing) {
      this.sql(
        "UPDATE users SET password_hash = ?, role = 'superadmin', disabled = 0, failed_logins = 0, locked_until = NULL WHERE handle = ?",
        await hashPass(pw),
        ADMIN_HANDLE,
      );
    } else {
      await this.createUser(ADMIN_HANDLE, ADMIN_NAME, ADMIN_EMAIL, ADMIN_BIO, pw, "superadmin");
    }
    this.sql("INSERT OR REPLACE INTO meta (key, value) VALUES ('admin_pw_fp', ?)", fp);
    this.audit("system", "admin-password", ADMIN_HANDLE, "synced from ADMIN_PASSWORD");
  }

  private async createUser(handle: string, name: string, email: string, bio: string, password: string, role = "member") {
    handle = handle.toLowerCase().trim();
    if (!handle || !password) throw new Error("bad request");
    if (this.one("SELECT id FROM users WHERE handle = ?", handle)) throw new Error("conflict");
    const id = hex(8);
    const now = new Date().toISOString();
    this.sql(
      "INSERT INTO users (id, handle, name, email, bio, password_hash, role, disabled, failed_logins, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)",
      id,
      handle,
      name || handle,
      email || `${handle}@gitpo.st`,
      bio || "",
      await hashPass(password),
      role,
      now,
    );
    return this.one<User>("SELECT * FROM users WHERE id = ?", id)!;
  }

  private publicUser(u: User) {
    const role = u.role || "member";
    return {
      id: u.id,
      handle: u.handle,
      name: u.name,
      email: u.email,
      bio: u.bio,
      role,
      disabled: !!u.disabled,
      isAdmin: role === "admin" || role === "superadmin",
      isSuperAdmin: role === "superadmin",
      createdAt: u.created_at,
      quietDerived: !!(u as any).quiet_derived,
    };
  }

  private userBySession(token: string | null): User | null {
    if (!token) return null;
    const s = this.one<{ user_id: string; expires_at: string }>(
      "SELECT user_id, expires_at FROM sessions WHERE token = ?",
      token,
    );
    if (!s || s.expires_at < new Date().toISOString()) return null;
    const u = this.one<User>("SELECT * FROM users WHERE id = ?", s.user_id);
    if (!u || u.disabled) return null;
    return u;
  }

  private findPost(ref: string) {
    const byId = this.one<any>("SELECT * FROM posts WHERE id = ?", ref);
    if (byId) return byId;
    const all = this.sql<any>("SELECT * FROM posts");
    const r = ref.toLowerCase();
    return all.find((p) => p.head_sha?.toLowerCase().startsWith(r) || p.id.toLowerCase() === r) || null;
  }

  private postPayload(p: any, viewer: User | null) {
    const stars = this.sql<{ handle: string }>("SELECT handle FROM stars WHERE post_id = ?", p.id).map((s) => s.handle);
    const watches = this.sql<{ handle: string }>("SELECT handle FROM watches WHERE post_id = ?", p.id).map((s) => s.handle);
    const forkCount = this.one<{ n: number }>("SELECT COUNT(*) as n FROM posts WHERE parent_post_id = ?", p.id)?.n || 0;
    const commitCount = this.one<{ n: number }>("SELECT COUNT(*) as n FROM commits WHERE post_id = ?", p.id)?.n || 0;
    let story = null;
    if (p.story_json) {
      try {
        story = JSON.parse(p.story_json);
      } catch {
        story = null;
      }
    }
    return {
      id: p.id,
      owner: p.owner,
      headSha: p.head_sha,
      shortSha: shortSha(p.head_sha || ""),
      subject: p.subject,
      slug: p.slug,
      body: p.body,
      parentPostId: p.parent_post_id || "",
      forkedFromSha: p.forked_from_sha || "",
      forkIntent: p.fork_intent || "",
      forkIntentNote: p.fork_intent_note || "",
      storyUrl: p.story_url || "",
      story,
      kind: p.kind || (story && (story as any).kind && (story as any).kind !== "link" ? "story" : ""),
      bridges: parseReviews(p.bridges_json),
      starCount: stars.length,
      watchCount: watches.length,
      stars,
      watchers: watches,
      starred: !!(viewer && stars.includes(viewer.handle)),
      watched: !!(viewer && watches.includes(viewer.handle)),
      defaultBranch: p.default_branch || "main",
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      commitCount,
      forkCount,
      topics: parseTopics(p.topics_json),
      coAuthors: parseTopics(p.coauthors_json),
      coAuthorInvites: parseTopics(p.invites_json),
      maintainers: parseTopics(p.maintainers_json),
      protected: !!p.protected,
      reviewers: parseReviews(p.reviewers_json),
      canPush: canPushPost(p, viewer),
      invited: !!(viewer && parseTopics(p.invites_json).includes(viewer.handle)),
      verified: this.verifyHistory(p.id).verified,
      genesis: this.verifyHistory(p.id).genesis,
      derivedFrom: parseReviews(p.derived_json),
    };
  }

  private verifyHistory(id: string) {
    const rows = this.sql<any>("SELECT sha, parent_sha FROM commits WHERE post_id = ? ORDER BY created_at ASC", id);
    if (!rows.length) return { verified: false, genesis: "", head: "", commitCount: 0, reason: "empty object store" };
    const bySha = new Map(rows.map((r) => [r.sha, r]));
    let prev = "";
    for (const r of rows) {
      if (prev && r.parent_sha && r.parent_sha !== prev) {
        return { verified: false, genesis: rows[0].sha, head: rows[rows.length - 1].sha, commitCount: rows.length, reason: "broken parent link at " + shortSha(r.sha) };
      }
      if (prev && !r.parent_sha) {
        return { verified: false, genesis: rows[0].sha, head: rows[rows.length - 1].sha, commitCount: rows.length, reason: "missing parent at " + shortSha(r.sha) };
      }
      if (r.parent_sha && !bySha.has(r.parent_sha) && r.parent_sha !== prev) {
        // first commit may reference a forked parent from another post
      }
      prev = r.sha;
    }
    const p = this.findPost(id);
    const head = p?.head_sha || rows[rows.length - 1].sha;
    if (head && head !== rows[rows.length - 1].sha) {
      return { verified: false, genesis: rows[0].sha, head, commitCount: rows.length, reason: "HEAD is not the tip of first-parent history" };
    }
    return { verified: true, genesis: rows[0].sha, head, commitCount: rows.length };
  }

  private recordEvent(kind: string, postId: string, sha: string, actor: string) {
    this.sql(
      "INSERT INTO events (id, kind, post_id, sha, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      hex(4),
      kind,
      postId,
      sha || "",
      actor,
      new Date().toISOString(),
    );
  }

  private attachDerived(destId: string, src: any, kind: string, actor: string, sha: string) {
    const dest = this.findPost(destId);
    if (!dest) return;
    const list = parseReviews(dest.derived_json);
    list.push({
      kind,
      sourcePostId: src.id,
      sourceSha: sha,
      sourceOwner: src.owner,
      sourceSubject: src.subject,
      actor,
      createdAt: new Date().toISOString(),
    });
    this.sql("UPDATE posts SET derived_json = ? WHERE id = ?", JSON.stringify(list), destId);
  }

  private notifyDerived(src: any, dest: any, kind: string, actor: string, sha: string) {
    if (!src || !dest || src.owner === actor) return;
    const u = this.one<any>("SELECT * FROM users WHERE handle = ?", String(src.owner).toLowerCase());
    if (u?.quiet_derived) return;
    this.sql(
      "INSERT INTO notices (id, handle, kind, actor, post_id, source_post_id, sha, subject, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
      hex(6),
      src.owner,
      kind,
      actor,
      dest.id,
      src.id,
      sha || "",
      dest.subject || "",
      new Date().toISOString(),
    );
  }

  private unreadCount(handle: string) {
    return this.sql<any>("SELECT id FROM notices WHERE handle = ? AND read = 0", handle).length;
  }

  private contribution(handle: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const weekday = today.getUTCDay();
    const end = new Date(today);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - (52 * 7 + weekday));
    const cells = new Map<string, any>();
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      cells.set(key, { date: key, commits: 0, merges: 0, taken: 0, total: 0, level: 0 });
    }
    const events = this.sql<any>("SELECT * FROM events");
    for (const ev of events) {
      const key = String(ev.created_at || "").slice(0, 10);
      const cell = cells.get(key);
      if (!cell) continue;
      const p = this.findPost(ev.post_id);
      if ((ev.kind === "commit" || ev.kind === "revert") && ev.actor === handle) cell.commits++;
      if (ev.kind === "merge" && p && p.owner === handle) cell.merges++;
      if (ev.kind === "cherry" && p && p.owner === handle && ev.actor !== handle) cell.taken++;
    }
    const weeks: any[][] = [];
    let week: any[] = [];
    const totals = { commits: 0, merges: 0, taken: 0 };
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const c = cells.get(d.toISOString().slice(0, 10))!;
      c.total = c.commits + c.merges + c.taken;
      c.level = c.total <= 0 ? 0 : c.total === 1 ? 1 : c.total <= 3 ? 2 : c.total <= 6 ? 3 : 4;
      totals.commits += c.commits;
      totals.merges += c.merges;
      totals.taken += c.taken;
      week.push(c);
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }
    if (week.length) weeks.push(week);
    return { weeks, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), totals };
  }

  private score(handle: string) {
    let reviews = 0;
    for (const pr of this.sql<any>("SELECT reviewers_json FROM prs")) {
      for (const r of parseReviews(pr.reviewers_json)) {
        if (r.handle === handle && r.status && r.status !== "pending") reviews++;
      }
    }
    let mergesAccepted = 0;
    let taken = 0;
    for (const ev of this.sql<any>("SELECT * FROM events")) {
      const p = this.findPost(ev.post_id);
      if (ev.kind === "merge" && p && p.owner === handle) mergesAccepted++;
      if (ev.kind === "cherry" && p && p.owner === handle && ev.actor !== handle) taken++;
    }
    let qualityMain = 0;
    let starsMaintained = 0;
    for (const p of this.sql<any>("SELECT * FROM posts")) {
      const maintainers = parseTopics(p.maintainers_json);
      if (p.owner !== handle && !maintainers.includes(handle)) continue;
      starsMaintained += this.sql<any>("SELECT user FROM stars WHERE post_id = ?", p.id).length;
      if (p.protected) qualityMain += 3;
      const commits = this.sql<any>("SELECT sha FROM commits WHERE post_id = ?", p.id).length;
      if (commits >= 3) qualityMain += 1;
      if (this.verifyHistory(p.id).verified) qualityMain += 2;
    }
    const score = reviews * 3 + mergesAccepted * 5 + taken * 2 + qualityMain + starsMaintained;
    return { score, reviews, mergesAccepted, taken, qualityMain, starsMaintained };
  }

  private derivationsFrom(id: string) {
    const out: any[] = [];
    const seen = new Set<string>();
    for (const p of this.sql<any>("SELECT * FROM posts")) {
      if (p.parent_post_id === id && !seen.has(p.id)) {
        seen.add(p.id);
        out.push({ kind: "fork", id: p.id, subject: p.subject, owner: p.owner, sha: p.head_sha, intent: p.fork_intent, updatedAt: p.updated_at });
      }
      for (const a of parseReviews(p.derived_json)) {
        if (a.sourcePostId === id && !seen.has(p.id)) {
          seen.add(p.id);
          out.push({ kind: a.kind, id: p.id, subject: p.subject, owner: p.owner, sha: p.head_sha, updatedAt: a.createdAt });
        }
      }
    }
    return out;
  }

  private listWatches(handle: string) {
    return this.sql<any>("SELECT * FROM watches WHERE handle = ?", handle).map((w) => ({
      id: w.id, handle: w.handle, repo: w.repo, provider: w.provider, lastTag: w.last_tag, createdAt: w.created_at,
    }));
  }

  private parseRepo(raw: string) {
    const m = String(raw || "").trim().match(/(?:https?:\/\/github\.com\/)?([^/\s]+)\/([^/\s#?]+)/i);
    if (!m) return "";
    return m[1] + "/" + m[2].replace(/\.git$/, "");
  }

  private watchRepo(handle: string, raw: string) {
    const repo = this.parseRepo(raw);
    if (!repo) return null;
    const existing = this.one<any>("SELECT * FROM watches WHERE handle = ? AND repo = ?", handle, repo);
    if (existing) return { id: existing.id, handle, repo, provider: "github", lastTag: existing.last_tag, createdAt: existing.created_at };
    const id = hex(4);
    const ts = new Date().toISOString();
    this.sql("INSERT INTO watches (id, handle, repo, provider, last_tag, created_at) VALUES (?, ?, ?, 'github', '', ?)", id, handle, repo, ts);
    return { id, handle, repo, provider: "github", lastTag: "", createdAt: ts };
  }

  private unwatchRepo(handle: string, raw: string) {
    const repo = this.parseRepo(raw) || raw;
    this.sql("DELETE FROM watches WHERE handle = ? AND repo = ?", handle, repo);
  }

  private hintsFor(handle: string) {
    return this.sql<any>("SELECT * FROM hints WHERE handle = ? AND (dismissed IS NULL OR dismissed = 0) ORDER BY created_at DESC", handle).map((h) => ({
      id: h.id, handle: h.handle, repo: h.repo, tag: h.tag, name: h.name, body: h.body,
      htmlUrl: h.html_url, publishedAt: h.published_at, dismissed: !!h.dismissed, draftId: h.draft_id, createdAt: h.created_at,
    }));
  }

  private async refreshChangelog(handle: string) {
    for (const w of this.sql<any>("SELECT * FROM watches WHERE handle = ?", handle)) {
      const [owner, repo] = String(w.repo).split("/");
      if (!owner || !repo) continue;
      try {
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=5`, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": "gitpo.st" },
        });
        if (!res.ok) continue;
        const list: any[] = await res.json();
        const latest = list.find((r) => !r.draft && r.tag_name);
        if (!latest) continue;
        const exists = this.one<any>("SELECT id FROM hints WHERE handle = ? AND repo = ? AND tag = ?", handle, w.repo, latest.tag_name);
        if (!exists) {
          this.sql(
            "INSERT INTO hints (id, handle, repo, tag, name, body, html_url, published_at, dismissed, draft_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?)",
            hex(5), handle, w.repo, latest.tag_name, latest.name || latest.tag_name, latest.body || "", latest.html_url || "", latest.published_at || "", new Date().toISOString(),
          );
          this.sql(
            "INSERT INTO notices (id, handle, kind, actor, post_id, source_post_id, sha, subject, read, created_at) VALUES (?, ?, 'release', 'github', '', '', '', ?, 0, ?)",
            hex(6), handle, `${w.repo} ${latest.tag_name}`, new Date().toISOString(),
          );
        }
        this.sql("UPDATE watches SET last_tag = ? WHERE id = ?", latest.tag_name, w.id);
      } catch { /* ignore */ }
    }
    return this.hintsFor(handle);
  }

  private draftFromHint(handle: string, id: string) {
    const h = this.one<any>("SELECT * FROM hints WHERE id = ? AND handle = ?", id, handle);
    if (!h) return null;
    const subject = h.name && h.name !== h.tag ? h.name : `${h.repo} ${h.tag}`;
    const body = `Shipped ${h.repo} \`${h.tag}\`.\n\n${h.body || ""}`;
    const did = h.draft_id || hex(5);
    const ts = new Date().toISOString();
    if (h.draft_id) {
      this.sql("UPDATE drafts SET subject = ?, body = ?, story_url = ?, updated_at = ? WHERE id = ?", subject, body, h.html_url || "", ts, did);
    } else {
      this.sql(
        "INSERT INTO drafts (id, owner, subject, body, story_url, topics_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        did, handle, subject, body, h.html_url || "", JSON.stringify(["changelog"]), ts, ts,
      );
      this.sql("UPDATE hints SET draft_id = ? WHERE id = ?", did, id);
    }
    const d = this.one<any>("SELECT * FROM drafts WHERE id = ?", did);
    return { id: d.id, owner: d.owner, subject: d.subject, body: d.body, storyUrl: d.story_url, topics: parseTopics(d.topics_json), createdAt: d.created_at, updatedAt: d.updated_at };
  }

  private async commit(postId: string, user: User, subject: string, body: string, story: unknown, when: string, parentSha: string, branch = "main") {
    const file = encodePostFile(subject, body, story);
    const payload = `tree ${await shaHex("SHA-1", file)}\n${parentSha ? `parent ${parentSha}\n` : ""}author ${user.name} <${user.email}> ${Math.floor(new Date(when).getTime() / 1000)} +0000\ncommitter ${user.name} <${user.email}> ${Math.floor(new Date(when).getTime() / 1000)} +0000\n\n${subject}\n`;
    const sha = await gitCommitSha(payload);
    this.sql(
      "INSERT INTO commits (sha, post_id, subject, body, author, email, created_at, parent_sha, story_json, branch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      sha,
      postId,
      subject,
      body,
      user.name,
      user.email,
      when,
      parentSha || "",
      story ? JSON.stringify(story) : "",
      branch,
    );
    this.sql("INSERT OR REPLACE INTO branches (post_id, name, sha) VALUES (?, ?, ?)", postId, branch, sha);
    this.sql(
      "UPDATE posts SET subject = ?, slug = ?, body = ?, head_sha = ?, story_json = ?, updated_at = ? WHERE id = ?",
      subject,
      slugify(subject),
      body,
      sha,
      story ? JSON.stringify(story) : "",
      when,
      postId,
    );
    return sha;
  }

  private async createPost(user: User, subject: string, body: string, storyUrl: string, story: unknown, topics: string[] = [], when?: string) {
    subject = subject.trim();
    if (!subject) throw new Error("bad request");
    const id = hex(5);
    const ts = when || new Date().toISOString();
    const topicList = extractTopics(topics, subject, body);
    this.sql(
      "INSERT INTO posts (id, owner, subject, slug, body, head_sha, parent_post_id, forked_from_sha, story_json, story_url, default_branch, created_at, updated_at, topics_json) VALUES (?, ?, ?, ?, ?, '', '', '', ?, ?, 'main', ?, ?, ?)",
      id,
      user.handle,
      subject,
      slugify(subject),
      body || "",
      story ? JSON.stringify(story) : "",
      storyUrl || "",
      ts,
      ts,
      JSON.stringify(topicList),
    );
    const sha = await this.commit(id, user, subject, body || "", story, ts, "");
    this.recordEvent("commit", id, sha, user.handle);
    const st = story as any;
    if (st && st.kind && st.kind !== "link") {
      const bridge = {
        url: st.url || storyUrl,
        provider: st.provider,
        repo: st.repo,
        kind: st.kind,
        number: st.number || "",
        title: st.title || String(st.message || "").split("\n")[0],
        state: st.state || "",
        sha: st.sha || "",
        htmlUrl: st.htmlUrl || st.url,
        direction: "code-to-writing",
        createdBy: user.handle,
        createdAt: ts,
      };
      this.sql("UPDATE posts SET kind = 'story', bridges_json = ? WHERE id = ?", JSON.stringify([bridge]), id);
    }
    return this.findPost(id)!;
  }

  private async amendPost(id: string, user: User, subject: string, body: string, story: unknown, topics?: string[], signoff = true) {
    const p = this.findPost(id);
    if (!p) throw new Error("not found");
    if (!canPushPost(p, user)) {
      throw new Error(p.protected ? "main is protected — open a pull request" : "forbidden");
    }
    const ts = new Date().toISOString();
    const sha = await this.commit(p.id, user, subject.trim() || p.subject, body, story, ts, p.head_sha, p.default_branch || "main");
    const topicList = extractTopics(topics || parseTopics(p.topics_json), subject.trim() || p.subject, body);
    this.sql("UPDATE posts SET topics_json = ? WHERE id = ?", JSON.stringify(topicList), p.id);
    this.recordEvent("commit", p.id, sha, user.handle);
    return this.findPost(p.id)!;
  }

  private async forkPost(id: string, user: User, intent: string, note: string) {
    const src = this.findPost(id);
    if (!src) throw new Error("not found");
    intent = normalizeIntent(intent);
    note = (note || "").trim().slice(0, 280);
    const nid = hex(5);
    const ts = new Date().toISOString();
    this.sql(
      "INSERT INTO posts (id, owner, subject, slug, body, head_sha, parent_post_id, forked_from_sha, fork_intent, fork_intent_note, story_json, story_url, default_branch, created_at, updated_at, topics_json) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, 'main', ?, ?, ?)",
      nid,
      user.handle,
      src.subject,
      src.slug,
      src.body,
      src.id,
      src.head_sha,
      intent,
      note,
      src.story_json,
      src.story_url,
      ts,
      ts,
      src.topics_json || "[]",
    );
    const commits = this.sql<any>("SELECT * FROM commits WHERE post_id = ? ORDER BY created_at ASC", src.id);
    let last = "";
    for (const c of commits) {
      const sha = await gitCommitSha(`fork ${nid} ${c.sha} ${last}`);
      this.sql(
        "INSERT INTO commits (sha, post_id, subject, body, author, email, created_at, parent_sha, story_json, branch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'main')",
        sha,
        nid,
        c.subject,
        c.body,
        c.author,
        c.email,
        c.created_at,
        last,
        c.story_json,
      );
      last = sha;
    }
    const forkSha = await this.commit(nid, user, "fork(" + intent + "): " + src.subject, src.body, src.story_json ? JSON.parse(src.story_json) : null, ts, last);
    this.sql("UPDATE posts SET head_sha = ? WHERE id = ?", forkSha, nid);
    this.recordEvent("fork", src.id, src.head_sha, user.handle);
    this.recordEvent("fork", nid, forkSha, user.handle);
    const dest = this.findPost(nid)!;
    this.attachDerived(nid, src, "fork", user.handle, src.head_sha);
    this.notifyDerived(src, dest, "fork", user.handle, src.head_sha);
    return dest;
  }

  private async openPR(
    user: User,
    title: string,
    body: string,
    sourceId: string,
    targetId: string,
    kind: string,
    paragraphIndex: number,
    original: string,
    proposed: string,
    rationale: string,
  ) {
    const dst = this.findPost(targetId);
    if (!dst) throw new Error("not found");
    kind = (kind || "full").toLowerCase();
    if (kind !== "full" && kind !== "paragraph") throw new Error("bad request");
    const n = (this.one<{ n: number }>("SELECT COALESCE(MAX(number),0) as n FROM prs")?.n || 0) + 1;
    const id = hex(4);
    const ts = new Date().toISOString();
    original = (original || "").trim();
    proposed = (proposed || "").trim();
    rationale = (rationale || "").trim();
    let sourceSha = "";
    let targetSha = dst.head_sha;
    let sourcePostId = sourceId;
    if (kind === "paragraph") {
      if (dst.owner === user.handle) throw new Error("forbidden");
      if (!original || !proposed || !rationale) throw new Error("bad request");
      const paras = splitParagraphs(dst.body || "");
      const found = paras.findIndex((p) => p === original);
      if (found < 0) throw new Error("that paragraph has changed since this proposal");
      paragraphIndex = found;
      if (!title) title = "Change paragraph " + (found + 1);
      body = rationale;
      sourcePostId = dst.id;
      sourceSha = dst.head_sha;
    } else {
      const src = this.findPost(sourceId);
      if (!src) throw new Error("not found");
      if (src.owner !== user.handle) throw new Error("forbidden");
      if (!title) title = src.subject;
      sourceSha = src.head_sha;
      sourcePostId = src.id;
    }
    this.sql(
      "INSERT INTO prs (id, number, title, body, author, target_post_id, source_post_id, source_sha, target_sha, status, merged_sha, kind, paragraph_index, original, proposed, rationale, review_note, comments_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', '', ?, ?, ?, ?, ?, '', '[]', ?, ?)",
      id,
      n,
      title,
      body || "",
      user.handle,
      dst.id,
      sourcePostId,
      sourceSha,
      targetSha,
      kind,
      paragraphIndex || 0,
      original,
      proposed,
      rationale,
      ts,
      ts,
    );
    this.recordEvent("pr", dst.id, dst.head_sha, user.handle);
    return this.one<any>("SELECT * FROM prs WHERE id = ?", id);
  }

  private issueSession(u: User, req: Request, status: number): Response {
    const token = hex(24);
    const now = new Date().toISOString();
    const exp = new Date(Date.now() + 30 * 86400000).toISOString();
    this.sql(
      "INSERT INTO sessions (token, user_id, user_agent, ip, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      token,
      u.id,
      req.headers.get("User-Agent") || "",
      req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For") || "",
      now,
      exp,
    );
    return json({ user: this.publicUser(u) }, status, { "set-cookie": cookie(token) });
  }

  private async handleSecurity(path: string, method: string, req: Request, viewer: User | null): Promise<Response | null> {
    if (path === "/api/security/password" && method === "POST") {
      if (!viewer) return err(401, "unauthorized");
      const inb = await req.json<any>();
      if (!(await checkPass(viewer.password_hash, inb.current || ""))) return err(401, "unauthorized");
      const weak = validatePassword(inb.next || "", Number(this.setting("minPassword", "12")) || 12);
      if (weak) return err(400, weak);
      this.sql("UPDATE users SET password_hash = ? WHERE id = ?", await hashPass(inb.next), viewer.id);
      this.sql("DELETE FROM sessions WHERE user_id = ?", viewer.id);
      this.audit(viewer.handle, "password.change", viewer.handle, "");
      return this.issueSession({ ...viewer, password_hash: "" }, req, 200);
    }
    if (path === "/api/security/sessions" && method === "GET") {
      if (!viewer) return err(401, "unauthorized");
      const cur = readCookie(req, "gp_session");
      const sessions = this.sql<any>("SELECT * FROM sessions WHERE user_id = ? AND expires_at > ?", viewer.id, new Date().toISOString()).map((s) => ({
        id: String(s.token).slice(0, 12),
        token: s.token,
        ip: s.ip,
        userAgent: s.user_agent,
        createdAt: s.created_at,
        expiresAt: s.expires_at,
        current: s.token === cur,
      }));
      return json({ sessions });
    }
    if (path === "/api/security/sessions/revoke-all" && method === "POST") {
      if (!viewer) return err(401, "unauthorized");
      const cur = readCookie(req, "gp_session");
      this.sql("DELETE FROM sessions WHERE user_id = ? AND token != ?", viewer.id, cur || "");
      this.audit(viewer.handle, "session.revoke_all", viewer.handle, "");
      return json({ ok: true });
    }
    const one = path.match(/^\/api\/security\/sessions\/(.+)$/);
    if (one && method === "DELETE") {
      if (!viewer) return err(401, "unauthorized");
      const token = decodeURIComponent(one[1]);
      const s = this.one<any>("SELECT * FROM sessions WHERE token = ?", token);
      if (!s || s.user_id !== viewer.id) return err(404, "not found");
      this.sql("DELETE FROM sessions WHERE token = ?", token);
      return json({ ok: true });
    }
    return null;
  }

  private async handleAdmin(path: string, method: string, req: Request, viewer: User | null): Promise<Response | null> {
    if (!path.startsWith("/api/admin/")) return null;
    if (!viewer) return err(401, "unauthorized");
    if (!isAdmin(viewer)) return err(403, "forbidden");

    if (path === "/api/admin/overview" && method === "GET") {
      const users = this.sql<User>("SELECT * FROM users");
      return json({
        users: users.length,
        disabled: users.filter((u) => u.disabled).length,
        admins: users.filter((u) => isAdmin(u)).length,
        posts: this.sql("SELECT id FROM posts").length,
        sessions: this.sql("SELECT token FROM sessions").length,
        invites: this.sql("SELECT code FROM invites").length,
        settings: { signupMode: this.setting("signupMode", "invite"), minPassword: Number(this.setting("minPassword", "12")) },
      });
    }
    if (path === "/api/admin/users" && method === "GET") {
      const users = this.sql<User>("SELECT * FROM users").map((u) => ({
        ...this.publicUser(u),
        failedLogins: u.failed_logins || 0,
        lockedUntil: u.locked_until || null,
      }));
      return json({ users });
    }
    const dis = path.match(/^\/api\/admin\/users\/([^/]+)\/(disable|enable)$/);
    if (dis && method === "POST") {
      const handle = dis[1].toLowerCase();
      const u = this.one<User>("SELECT * FROM users WHERE handle = ?", handle);
      if (!u) return err(404, "not found");
      if (isSuper(u)) return err(403, "cannot modify the super admin");
      const off = dis[2] === "disable" ? 1 : 0;
      this.sql("UPDATE users SET disabled = ? WHERE id = ?", off, u.id);
      if (off) this.sql("DELETE FROM sessions WHERE user_id = ?", u.id);
      this.audit(viewer.handle, off ? "user.disable" : "user.enable", handle, "");
      return json({ ok: true });
    }
    const delu = path.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (delu && method === "DELETE") {
      if (!isSuper(viewer)) return err(403, "forbidden");
      const u = this.one<User>("SELECT * FROM users WHERE handle = ?", delu[1].toLowerCase());
      if (!u) return err(404, "not found");
      if (isSuper(u)) return err(403, "cannot modify the super admin");
      this.sql("DELETE FROM sessions WHERE user_id = ?", u.id);
      this.sql("DELETE FROM users WHERE id = ?", u.id);
      this.audit(viewer.handle, "user.delete", u.handle, "");
      return json({ ok: true });
    }
    const role = path.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
    if (role && method === "POST") {
      if (!isSuper(viewer)) return err(403, "forbidden");
      const inb = await req.json<any>();
      if (inb.role !== "admin" && inb.role !== "member") return err(400, "bad request");
      const u = this.one<User>("SELECT * FROM users WHERE handle = ?", role[1].toLowerCase());
      if (!u) return err(404, "not found");
      if (isSuper(u)) return err(403, "cannot modify the super admin");
      this.sql("UPDATE users SET role = ? WHERE id = ?", inb.role, u.id);
      this.audit(viewer.handle, "user.role", u.handle, inb.role);
      return json({ ok: true });
    }
    if (path === "/api/admin/invites" && method === "GET") {
      const invites = this.sql<any>("SELECT * FROM invites").map((i) => ({
        code: i.code,
        createdBy: i.created_by,
        usedBy: i.used_by,
        createdAt: i.created_at,
        expiresAt: i.expires_at,
        usedAt: i.used_at,
      }));
      return json({ invites });
    }
    if (path === "/api/admin/invites" && method === "POST") {
      const inb = await req.json<any>().catch(() => ({ days: 14 }));
      const days = inb.days > 0 && inb.days <= 90 ? inb.days : 14;
      const code = hex(10);
      const now = new Date();
      this.sql(
        "INSERT INTO invites (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)",
        code,
        viewer.handle,
        now.toISOString(),
        new Date(now.getTime() + days * 86400000).toISOString(),
      );
      this.audit(viewer.handle, "invite.create", code.slice(0, 8), "");
      return json({ invite: { code, createdBy: viewer.handle, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + days * 86400000).toISOString() } }, 201);
    }
    const rev = path.match(/^\/api\/admin\/invites\/([^/]+)$/);
    if (rev && method === "DELETE") {
      this.sql("DELETE FROM invites WHERE code = ?", rev[1]);
      this.audit(viewer.handle, "invite.revoke", rev[1].slice(0, 8), "");
      return json({ ok: true });
    }
    if (path === "/api/admin/audit" && method === "GET") {
      const events = this.sql<any>("SELECT * FROM audits ORDER BY created_at DESC LIMIT 200").map((e) => ({
        id: e.id,
        actor: e.actor,
        action: e.action,
        target: e.target,
        detail: e.detail,
        createdAt: e.created_at,
      }));
      return json({ events });
    }
    if (path === "/api/admin/sessions" && method === "GET") {
      const sessions = this.sql<any>("SELECT * FROM sessions").map((s) => {
        const u = this.one<User>("SELECT * FROM users WHERE id = ?", s.user_id);
        return {
          token: s.token,
          handle: u?.handle || "",
          ip: s.ip,
          userAgent: s.user_agent,
          createdAt: s.created_at,
          expiresAt: s.expires_at,
        };
      });
      return json({ sessions });
    }
    const kick = path.match(/^\/api\/admin\/sessions\/(.+)$/);
    if (kick && method === "DELETE") {
      this.sql("DELETE FROM sessions WHERE token = ?", decodeURIComponent(kick[1]));
      this.audit(viewer.handle, "session.revoke", "", "");
      return json({ ok: true });
    }
    if (path === "/api/admin/settings" && method === "GET") {
      return json({ settings: { signupMode: this.setting("signupMode", "invite"), minPassword: Number(this.setting("minPassword", "12")) } });
    }
    if (path === "/api/admin/settings" && method === "PUT") {
      const inb = await req.json<any>();
      if (inb.signupMode && ["invite", "open", "closed"].includes(inb.signupMode)) this.setSetting("signupMode", inb.signupMode);
      if (inb.minPassword >= 12 && inb.minPassword <= 64) this.setSetting("minPassword", String(inb.minPassword));
      this.audit(viewer.handle, "settings.update", "", this.setting("signupMode", "invite"));
      return json({ settings: { signupMode: this.setting("signupMode", "invite"), minPassword: Number(this.setting("minPassword", "12")) } });
    }
    const delp = path.match(/^\/api\/admin\/posts\/([^/]+)$/);
    if (delp && method === "DELETE") {
      const p = this.findPost(delp[1]);
      if (!p) return err(404, "not found");
      this.sql("DELETE FROM posts WHERE id = ?", p.id);
      this.sql("DELETE FROM commits WHERE post_id = ?", p.id);
      this.audit(viewer.handle, "post.delete", p.id, p.subject);
      return json({ ok: true });
    }
    return err(404, "not found");
  }

  private listTakes(id: string) {
    const p = this.findPost(id);
    if (!p) return [];
    const root = p.parent_post_id || id;
    const posts = this.sql<any>("SELECT * FROM posts");
    const out = posts.filter((other) => {
      if (other.id === id) return false;
      return other.parent_post_id === id || other.parent_post_id === root || other.id === root;
    });
    out.sort((a, b) => {
      const sa = this.sql("SELECT handle FROM stars WHERE post_id = ?", a.id).length;
      const sb = this.sql("SELECT handle FROM stars WHERE post_id = ?", b.id).length;
      if (sa !== sb) return sb - sa;
      return String(b.updated_at).localeCompare(String(a.updated_at));
    });
    return out;
  }

  private buildGraph() {
    const posts = this.sql<any>("SELECT * FROM posts ORDER BY updated_at DESC");
    const prs = this.sql<any>("SELECT * FROM prs WHERE status = 'merged' AND IFNULL(kind,'full') != 'paragraph'");
    const keep = new Set<string>();
    posts.slice(0, 80).forEach((p) => keep.add(p.id));
    for (const p of posts) {
      if (keep.has(p.id) && p.parent_post_id) keep.add(p.parent_post_id);
    }
    const mergedInto = new Map<string, string[]>();
    for (const pr of prs) {
      keep.add(pr.target_post_id);
      keep.add(pr.source_post_id);
      const list = mergedInto.get(pr.target_post_id) || [];
      list.push(pr.source_post_id);
      mergedInto.set(pr.target_post_id, list);
    }
    const nodes = posts
      .filter((p) => keep.has(p.id))
      .map((p) => {
        const parents: string[] = [];
        if (p.parent_post_id) parents.push(p.parent_post_id);
        const extras = mergedInto.get(p.id) || [];
        parents.push(...extras);
        let kind = p.parent_post_id ? "fork" : "commit";
        if (extras.length) kind = "merge";
        const stars = this.sql<{ handle: string }>("SELECT handle FROM stars WHERE post_id = ?", p.id);
        const forkCount = this.one<{ n: number }>("SELECT COUNT(*) as n FROM posts WHERE parent_post_id = ?", p.id)?.n || 0;
        const commitCount = this.one<{ n: number }>("SELECT COUNT(*) as n FROM commits WHERE post_id = ?", p.id)?.n || 0;
        return {
          id: p.id,
          owner: p.owner,
          subject: p.subject,
          shortSha: shortSha(p.head_sha || ""),
          headSha: p.head_sha,
          parentPostId: p.parent_post_id || "",
          forkIntent: p.fork_intent || "",
          forkCount,
          starCount: stars.length,
          commitCount,
          topics: parseTopics(p.topics_json),
          updatedAt: p.updated_at,
          kind,
          parents,
        };
      });
    return { nodes };
  }

  private buildTrending() {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const by = new Map<string, { forks: number; prs: number; cherries: number; merges: number }>();
    const touch = (id: string) => {
      if (!by.has(id)) by.set(id, { forks: 0, prs: 0, cherries: 0, merges: 0 });
      return by.get(id)!;
    };
    for (const ev of this.sql<any>("SELECT * FROM events WHERE created_at >= ?", since)) {
      const sc = touch(ev.post_id);
      if (ev.kind === "fork") sc.forks++;
      else if (ev.kind === "pr") sc.prs++;
      else if (ev.kind === "cherry") sc.cherries++;
      else if (ev.kind === "merge") sc.merges++;
    }
    for (const p of this.sql<any>("SELECT * FROM posts WHERE parent_post_id != '' AND created_at >= ?", since)) {
      touch(p.parent_post_id).forks++;
      touch(p.id);
    }
    for (const pr of this.sql<any>("SELECT * FROM prs WHERE created_at >= ?", since)) {
      touch(pr.target_post_id).prs++;
      if (pr.status === "merged" && pr.updated_at >= since) touch(pr.target_post_id).merges++;
    }
    const rows = [...by.entries()]
      .map(([id, sc]) => ({
        id,
        sc,
        total: sc.forks * 4 + sc.prs * 3 + sc.cherries * 3 + sc.merges * 2,
      }))
      .filter((r) => r.total > 0 && this.findPost(r.id))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
    return rows.map((r) => {
      const p = this.findPost(r.id)!;
      return {
        id: p.id,
        subject: p.subject,
        owner: p.owner,
        shortSha: shortSha(p.head_sha || ""),
        headSha: p.head_sha,
        score: r.total,
        forks: r.sc.forks,
        prs: r.sc.prs,
        cherries: r.sc.cherries,
        merges: r.sc.merges,
        topics: parseTopics(p.topics_json),
        forkIntent: p.fork_intent || "",
        parentPostId: p.parent_post_id || "",
      };
    });
  }

  private blamePost(p: any) {
    const hist = this.sql<any>("SELECT * FROM commits WHERE post_id = ? ORDER BY created_at DESC", p.id);
    const snaps = hist.map((c: any) => ({ c, paras: splitParagraphs(c.body || "") }));
    if (!snaps.length) {
      return splitParagraphs(p.body || "").map((text, index) => ({
        index,
        text,
        author: p.owner,
        sha: p.head_sha,
        shortSha: shortSha(p.head_sha || ""),
        date: p.updated_at,
        subject: p.subject,
      }));
    }
    const head = snaps[0];
    return head.paras.map((para: string, i: number) => {
      let blamed = head.c;
      for (let j = 1; j < snaps.length; j++) {
        if (snaps[j].paras.includes(para)) blamed = snaps[j].c;
        else break;
      }
      return {
        index: i,
        text: para,
        author: blamed.author,
        sha: blamed.sha,
        shortSha: shortSha(blamed.sha),
        date: blamed.created_at,
        subject: blamed.subject,
      };
    });
  }

  async fetch(req: Request): Promise<Response> {
    await this.ready;
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const viewer = this.userBySession(readCookie(req, "gp_session"));

    try {
      if (path === "/api/health" && method === "GET") {
        return json({ ok: true, service: "gitpo.st", edge: "cloudflare", time: new Date().toISOString() });
      }

      if (path === "/api/auth/me" && method === "GET") {
        return json({ user: viewer ? this.publicUser(viewer) : null, unread: viewer ? this.unreadCount(viewer.handle) : 0 });
      }

      if (path === "/api/auth/config" && method === "GET") {
        return json({
          signupMode: this.setting("signupMode", "invite"),
          minPassword: Number(this.setting("minPassword", "12")) || 12,
        });
      }

      if (path === "/api/auth/register" && method === "POST") {
        const inb = await req.json<any>();
        const mode = this.setting("signupMode", "invite");
        if (mode === "closed") return err(403, "registration is closed");
        const min = Number(this.setting("minPassword", "12")) || 12;
        const weak = validatePassword(inb.password || "", min);
        if (weak) return err(400, weak);
        if (mode === "invite") {
          const code = String(inb.invite || "").trim();
          const inv = this.one<any>("SELECT * FROM invites WHERE code = ?", code);
          if (!inv || inv.used_by || inv.expires_at < new Date().toISOString()) return err(400, "invite code is invalid or expired");
          const u = await this.createUser(inb.handle, inb.name, inb.email, inb.bio, inb.password);
          this.sql("UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?", u.handle, new Date().toISOString(), code);
          this.audit("system", "user.register", u.handle, "");
          return this.issueSession(u, req, 201);
        }
        const u = await this.createUser(inb.handle, inb.name, inb.email, inb.bio, inb.password);
        this.audit("system", "user.register", u.handle, "");
        return this.issueSession(u, req, 201);
      }

      if (path === "/api/auth/login" && method === "POST") {
        const inb = await req.json<any>();
        const u = this.one<User>("SELECT * FROM users WHERE handle = ?", String(inb.handle || "").toLowerCase());
        if (!u) return err(401, "unauthorized");
        if (u.disabled) return err(403, "account disabled");
        if (u.locked_until && u.locked_until > new Date().toISOString()) return err(429, "account temporarily locked");
        if (!(await checkPass(u.password_hash, inb.password || ""))) {
          const fails = (u.failed_logins || 0) + 1;
          const lock = fails >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
          this.sql("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?", fails, lock, u.id);
          if (lock) return err(429, "account temporarily locked");
          return err(401, "unauthorized");
        }
        this.sql("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?", u.id);
        return this.issueSession(u, req, 200);
      }

      if (path === "/api/auth/logout" && method === "POST") {
        const t = readCookie(req, "gp_session");
        if (t) this.sql("DELETE FROM sessions WHERE token = ?", t);
        return json({ ok: true }, 200, { "set-cookie": cookie("", true) });
      }

      if (path === "/api/feed" && method === "GET") {
        let q = (url.searchParams.get("q") || "").toLowerCase();
        let topic = normalizeTopicName(url.searchParams.get("topic") || "");
        if (!topic && q.startsWith("remote:")) {
          topic = normalizeTopicName(q);
          q = "";
        }
        const followed = url.searchParams.get("followed") === "1";
        let remotes: string[] = [];
        if (followed && viewer) {
          remotes = this.sql<{ topic: string }>("SELECT topic FROM remotes WHERE handle = ?", viewer.handle).map((r) => r.topic);
        }
        let posts = this.sql<any>("SELECT * FROM posts ORDER BY updated_at DESC");
        if (topic) {
          posts = posts.filter((p) => parseTopics(p.topics_json).includes(topic));
        }
        if (followed) {
          posts = posts.filter((p) => parseTopics(p.topics_json).some((t) => remotes.includes(t)));
        }
        if (q) {
          posts = posts.filter((p) => `${p.subject} ${p.body} ${p.owner} ${p.topics_json || ""}`.toLowerCase().includes(q));
        }
        return json({
          posts: posts.map((p) => {
            const item = this.postPayload(p, viewer);
            delete (item as any).body;
            return item;
          }),
          topic,
          remotes,
        });
      }

      if (path.startsWith("/api/objects/")) {
        const sha = decodeURIComponent(path.slice("/api/objects/".length));
        const c =
          this.one<any>("SELECT * FROM commits WHERE sha = ?", sha) ||
          this.sql<any>("SELECT * FROM commits WHERE sha LIKE ?", sha + "%")[0];
        if (!c) return err(404, "not found");
        const p = this.findPost(c.post_id);
        if (!p) return err(404, "not found");
        const proof = this.verifyHistory(p.id);
        const payload: any = this.postPayload(p, viewer);
        payload.at = c.sha;
        payload.historical = c.sha !== p.head_sha;
        payload.subject = c.subject;
        payload.body = c.body;
        payload.shortSha = shortSha(c.sha);
        payload.verified = proof.verified;
        payload.genesis = proof.genesis;
        return json({ post: payload, sha: c.sha, history: proof });
      }

      if (path === "/api/graph" && method === "GET") {
        return json(this.buildGraph());
      }
      if (path === "/api/trending" && method === "GET") {
        return json({ trending: this.buildTrending() });
      }
      if (path === "/api/topics" && method === "GET") {
        const counts = new Map<string, number>();
        for (const p of this.sql<any>("SELECT topics_json FROM posts")) {
          for (const t of parseTopics(p.topics_json)) counts.set(t, (counts.get(t) || 0) + 1);
        }
        const topics = [...counts.entries()]
          .map(([topic, count]) => ({ topic, count }))
          .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
        return json({ topics });
      }
      if (path === "/api/remotes" && method === "GET") {
        if (!viewer) return err(401, "unauthorized");
        const remotes = this.sql<{ topic: string }>("SELECT topic FROM remotes WHERE handle = ? ORDER BY topic", viewer.handle).map((r) => r.topic);
        return json({ remotes });
      }
      if (path === "/api/remotes" && method === "POST") {
        if (!viewer) return err(401, "unauthorized");
        const inb = await req.json<any>();
        const topic = normalizeTopicName(inb.topic || "");
        if (!topic) return err(400, "bad request");
        this.sql("INSERT OR IGNORE INTO remotes (handle, topic, created_at) VALUES (?, ?, ?)", viewer.handle, topic, new Date().toISOString());
        const remotes = this.sql<{ topic: string }>("SELECT topic FROM remotes WHERE handle = ?", viewer.handle).map((r) => r.topic);
        return json({ remotes });
      }
      const unf = path.match(/^\/api\/remotes\/([^/]+)$/);
      if (unf && method === "DELETE") {
        if (!viewer) return err(401, "unauthorized");
        this.sql("DELETE FROM remotes WHERE handle = ? AND topic = ?", viewer.handle, normalizeTopicName(decodeURIComponent(unf[1])));
        const remotes = this.sql<{ topic: string }>("SELECT topic FROM remotes WHERE handle = ?", viewer.handle).map((r) => r.topic);
        return json({ remotes });
      }

      if (path === "/api/posts" && method === "POST") {
        if (!viewer) return err(401, "unauthorized");
        const inb = await req.json<any>();
        let story = null;
        if (inb.storyUrl) story = await fetchStory(inb.storyUrl);
        const p = await this.createPost(viewer, inb.subject, inb.body || "", inb.storyUrl || "", story, inb.topics || []);
        return json({ post: this.postPayload(p, viewer) }, 201);
      }

      const postMatch = path.match(/^\/api\/posts\/([^/]+)(?:\/(.*))?$/);
      if (postMatch) {
        const ref = decodeURIComponent(postMatch[1]);
        const rest = postMatch[2] || "";
        const p = this.findPost(ref);
        if (!p && method !== "POST") return err(404, "not found");

        if (!rest && method === "GET") {
          const proof = this.verifyHistory(p.id);
          const payload: any = this.postPayload(p, viewer);
          payload.verified = proof.verified;
          payload.genesis = proof.genesis;
          const at = url.searchParams.get("at") || "";
          if (at) {
            const c =
              this.one<any>("SELECT * FROM commits WHERE sha = ? AND post_id = ?", at, p.id) ||
              this.sql<any>("SELECT * FROM commits WHERE post_id = ? AND sha LIKE ?", p.id, at + "%")[0];
            if (!c) return err(404, "not found");
            payload.at = c.sha;
            payload.historical = c.sha !== p.head_sha;
            payload.subject = c.subject;
            payload.body = c.body;
            payload.shortSha = shortSha(c.sha);
            if (c.story_json) {
              try { payload.story = JSON.parse(c.story_json); } catch { /* ignore */ }
            }
          }
          return json({ post: payload, history: proof });
        }

        if (!rest && method === "PUT") {
          if (!viewer) return err(401, "unauthorized");
          const inb = await req.json<any>();
          let story = p.story_json ? JSON.parse(p.story_json) : null;
          if (inb.storyUrl && inb.storyUrl !== p.story_url) story = await fetchStory(inb.storyUrl);
          const np = await this.amendPost(p.id, viewer, inb.subject, inb.body, story, inb.topics, inb.signoff !== false);
          return json({ post: this.postPayload(np, viewer) });
        }

        if (rest === "history" && method === "GET") {
          const commits = this.sql<any>("SELECT * FROM commits WHERE post_id = ? ORDER BY created_at DESC", p.id).map((c) => ({
            sha: c.sha,
            shortSha: shortSha(c.sha),
            subject: c.subject,
            body: "",
            author: c.author,
            email: c.email,
            date: c.created_at,
            parents: c.parent_sha ? [c.parent_sha] : [],
          }));
          return json({ commits, history: this.verifyHistory(p.id) });
        }

        if (rest === "revert" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          if (!canPushPost(p, viewer)) return err(403, p.protected ? "main is protected — open a pull request" : "forbidden");
          const inb = await req.json<any>();
          const reason = String(inb.reason || "").trim();
          if (!reason || reason.length > 2000) return err(400, "bad request");
          const c =
            this.one<any>("SELECT * FROM commits WHERE sha = ? AND post_id = ?", inb.sha, p.id) ||
            this.sql<any>("SELECT * FROM commits WHERE post_id = ? AND sha LIKE ?", p.id, String(inb.sha || "") + "%")[0];
          if (!c) return err(404, "not found");
          const parent = c.parent_sha ? this.one<any>("SELECT * FROM commits WHERE sha = ?", c.parent_sha) : null;
          if (!parent) return err(400, "cannot revert the first commit");
          const subject = `Revert "${c.subject}"`;
          const body = parent.body || "";
          const sha = await this.commit(p.id, viewer, subject, body, parent.story_json ? JSON.parse(parent.story_json) : null, new Date().toISOString(), p.head_sha);
          this.recordEvent("revert", p.id, sha, viewer.handle);
          return json({ post: this.postPayload(this.findPost(p.id), viewer) });
        }

        if (rest === "diff" && method === "GET") {
          const from = url.searchParams.get("from") || "";
          const to = url.searchParams.get("to") || "";
          const a = from ? this.one<any>("SELECT * FROM commits WHERE sha = ?", from) : null;
          const b = to ? this.one<any>("SELECT * FROM commits WHERE sha = ?", to) : this.one<any>("SELECT * FROM commits WHERE sha = ?", p.head_sha);
          const oldT = a ? encodePostFile(a.subject, a.body, a.story_json ? JSON.parse(a.story_json) : null) : "";
          const newT = b ? encodePostFile(b.subject, b.body, b.story_json ? JSON.parse(b.story_json) : null) : "";
          return json({ diff: unifiedDiff(oldT, newT), from, to });
        }

        if (rest === "blob" && method === "GET") {
          const sha = url.searchParams.get("sha") || p.head_sha;
          const c = this.one<any>("SELECT * FROM commits WHERE sha = ?", sha);
          if (!c) return err(404, "not found");
          let story = null;
          if (c.story_json) try { story = JSON.parse(c.story_json); } catch { /* */ }
          return json({ subject: c.subject, body: c.body, story, raw: encodePostFile(c.subject, c.body, story) });
        }

        if (rest === "star" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          const exists = this.one("SELECT handle FROM stars WHERE post_id = ? AND handle = ?", p.id, viewer.handle);
          if (exists) this.sql("DELETE FROM stars WHERE post_id = ? AND handle = ?", p.id, viewer.handle);
          else this.sql("INSERT INTO stars (post_id, handle) VALUES (?, ?)", p.id, viewer.handle);
          return json({ post: this.postPayload(this.findPost(p.id), viewer) });
        }

        if (rest === "watch" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          const exists = this.one("SELECT handle FROM watches WHERE post_id = ? AND handle = ?", p.id, viewer.handle);
          if (exists) this.sql("DELETE FROM watches WHERE post_id = ? AND handle = ?", p.id, viewer.handle);
          else this.sql("INSERT INTO watches (post_id, handle) VALUES (?, ?)", p.id, viewer.handle);
          return json({ post: this.postPayload(this.findPost(p.id), viewer) });
        }

        if (rest === "fork" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          let inb: any = {};
          try {
            inb = await req.json<any>();
          } catch {
            inb = {};
          }
          const np = await this.forkPost(p.id, viewer, inb.intent || "", inb.note || "");
          return json({ post: this.postPayload(np, viewer) }, 201);
        }

        if (rest === "forks" && method === "GET") {
          const takes = this.listTakes(p.id).map((row) => {
            const item = this.postPayload(row, viewer);
            delete (item as any).body;
            return item;
          });
          return json({ forks: takes, takes });
        }

        if (rest === "coauthors" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          if (!canPushPost(p, viewer)) return err(403, "forbidden");
          const inb = await req.json<any>();
          const u = this.one<User>("SELECT * FROM users WHERE lower(handle) = ?", String(inb.handle || "").toLowerCase());
          if (!u) return err(404, "not found");
          const invites = parseTopics(p.invites_json);
          const authors = parseTopics(p.coauthors_json);
          if (u.handle !== p.owner && !authors.includes(u.handle) && !invites.includes(u.handle)) invites.push(u.handle);
          this.sql("UPDATE posts SET invites_json = ? WHERE id = ?", JSON.stringify(invites), p.id);
          return json({ post: this.postPayload(this.findPost(p.id), viewer) });
        }

        if (rest === "coauthors/accept" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          const invites = parseTopics(p.invites_json).filter((h) => h !== viewer.handle);
          const authors = parseTopics(p.coauthors_json);
          if (!parseTopics(p.invites_json).includes(viewer.handle)) return err(403, "forbidden");
          if (!authors.includes(viewer.handle)) authors.push(viewer.handle);
          this.sql("UPDATE posts SET invites_json = ?, coauthors_json = ? WHERE id = ?", JSON.stringify(invites), JSON.stringify(authors), p.id);
          return json({ post: this.postPayload(this.findPost(p.id), viewer) });
        }

        const rmCo = rest.match(/^coauthors\/([^/]+)$/);
        if (rmCo && method === "DELETE") {
          if (!viewer) return err(401, "unauthorized");
          const handle = decodeURIComponent(rmCo[1]);
          if (viewer.handle !== p.owner && viewer.handle !== handle) return err(403, "forbidden");
          const authors = parseTopics(p.coauthors_json).filter((h) => h !== handle);
          const invites = parseTopics(p.invites_json).filter((h) => h !== handle);
          const mains = parseTopics(p.maintainers_json).filter((h) => h !== handle);
          this.sql("UPDATE posts SET coauthors_json = ?, invites_json = ?, maintainers_json = ? WHERE id = ?", JSON.stringify(authors), JSON.stringify(invites), JSON.stringify(mains), p.id);
          return json({ post: this.postPayload(this.findPost(p.id), viewer) });
        }

        if (rest === "protect" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          if (p.owner !== viewer.handle) return err(403, "forbidden");
          const inb = await req.json<any>();
          const mains: string[] = [];
          for (const h of inb.maintainers || []) {
            const u = this.one<User>("SELECT * FROM users WHERE lower(handle) = ?", String(h).toLowerCase());
            if (u && u.handle !== p.owner) mains.push(u.handle);
          }
          const authors = parseTopics(p.coauthors_json);
          for (const h of mains) if (!authors.includes(h)) authors.push(h);
          this.sql(
            "UPDATE posts SET protected = ?, maintainers_json = ?, coauthors_json = ? WHERE id = ?",
            inb.protected ? 1 : 0,
            JSON.stringify(mains),
            JSON.stringify(authors),
            p.id,
          );
          return json({ post: this.postPayload(this.findPost(p.id), viewer) });
        }

        if (rest === "reviewers" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          if (p.owner !== viewer.handle && !canPushPost(p, viewer)) return err(403, "forbidden");
          const inb = await req.json<any>();
          const u = this.one<User>("SELECT * FROM users WHERE lower(handle) = ?", String(inb.handle || "").toLowerCase());
          if (!u) return err(404, "not found");
          const list = parseReviews(p.reviewers_json);
          if (!list.some((r) => r.handle === u.handle)) {
            list.push({ handle: u.handle, status: "requested", requestedBy: viewer.handle, updatedAt: new Date().toISOString() });
          }
          this.sql("UPDATE posts SET reviewers_json = ? WHERE id = ?", JSON.stringify(list), p.id);
          return json({ post: this.postPayload(this.findPost(p.id), viewer) });
        }

        if (rest === "review" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          const inb = await req.json<any>();
          const status = String(inb.status || "").toLowerCase();
          if (status !== "approved" && status !== "changes") return err(400, "bad request");
          const list = parseReviews(p.reviewers_json);
          const mine = list.find((r) => r.handle === viewer.handle);
          if (!mine) return err(403, "forbidden");
          mine.status = status;
          mine.note = inb.note || "";
          mine.updatedAt = new Date().toISOString();
          this.sql("UPDATE posts SET reviewers_json = ? WHERE id = ?", JSON.stringify(list), p.id);
          return json({ post: this.postPayload(this.findPost(p.id), viewer) });
        }

        if (rest === "excerpt" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          const inb = await req.json<any>();
          const excerpt = String(inb.excerpt || "").trim();
          if (!excerpt || excerpt.length > 8000) return err(400, "bad request");
          const quoted = excerpt.split("\n").map((l) => "> " + l.replace(/\s+$/, "")).join("\n");
          const attr = `${quoted}\n\nCherry-picked from @${p.owner} \`${shortSha(p.head_sha || "")}\` — ${p.subject}`;
          if (!inb.destId) {
            let subject = "Cherry-pick: " + p.subject;
            if (subject.length > 72) subject = subject.slice(0, 69) + "…";
            const created = await this.createPost(viewer, subject, attr, "", null, parseTopics(p.topics_json));
            this.recordEvent("cherry", created.id, created.head_sha, viewer.handle);
            this.recordEvent("cherry", p.id, p.head_sha, viewer.handle);
            this.attachDerived(created.id, p, "cherry", viewer.handle, p.head_sha);
            this.notifyDerived(p, created, "cherry", viewer.handle, p.head_sha);
            return json({ post: this.postPayload(this.findPost(created.id), viewer) }, 201);
          }
          const dest = this.findPost(inb.destId);
          if (!dest) return err(404, "not found");
          if (dest.owner !== viewer.handle) return err(403, "forbidden");
          const body = dest.body ? dest.body.trim() + "\n\n" + attr : attr;
          const np = await this.amendPost(dest.id, viewer, dest.subject, body, dest.story_json ? JSON.parse(dest.story_json) : null);
          this.recordEvent("cherry", dest.id, np.head_sha, viewer.handle);
          this.recordEvent("cherry", p.id, p.head_sha, viewer.handle);
          this.attachDerived(dest.id, p, "cherry", viewer.handle, p.head_sha);
          this.notifyDerived(p, this.findPost(dest.id), "cherry", viewer.handle, p.head_sha);
          return json({ post: this.postPayload(this.findPost(dest.id), viewer) }, 201);
        }

        if (rest === "comments" && method === "GET") {
          const comments = this.sql<any>("SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC", p.id).map((c) => ({
            id: c.id,
            postId: c.post_id,
            parentId: c.parent_id || "",
            author: c.author,
            body: c.body,
            branch: c.branch || "",
            createdAt: c.created_at,
          }));
          return json({ comments });
        }

        if (rest === "comments" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          const inb = await req.json<any>();
          const body = String(inb.body || "").trim();
          if (!body || body.length > 4000) return err(400, "bad request");
          const parentId = String(inb.parentId || "").trim();
          if (parentId) {
            const par = this.one<any>("SELECT id FROM comments WHERE id = ? AND post_id = ?", parentId, p.id);
            if (!par) return err(404, "not found");
          }
          const id = hex(4);
          const ts = new Date().toISOString();
          this.sql(
            "INSERT INTO comments (id, post_id, parent_id, author, body, branch, created_at) VALUES (?, ?, ?, ?, ?, '', ?)",
            id, p.id, parentId, viewer.handle, body, ts,
          );
          return json({
            comment: { id, postId: p.id, parentId, author: viewer.handle, body, branch: "", createdAt: ts },
          }, 201);
        }

        const branchThread = rest.match(/^comments\/([^/]+)\/branch$/);
        if (branchThread && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          if (p.owner !== viewer.handle) return err(403, "forbidden");
          const rootId = branchThread[1];
          const all = this.sql<any>("SELECT * FROM comments WHERE post_id = ?", p.id);
          const byId = new Map(all.map((c) => [c.id, c]));
          let root = byId.get(rootId);
          if (!root) return err(404, "not found");
          while (root.parent_id && byId.has(root.parent_id)) root = byId.get(root.parent_id);
          const thread: any[] = [];
          const walk = (id: string) => {
            const c = byId.get(id);
            if (!c) return;
            thread.push(c);
            for (const other of all) if (other.parent_id === id) walk(other.id);
          };
          walk(root.id);
          const name = "discuss-" + root.id;
          let md = (p.body || "").trim() + "\n\n---\n\n## Discussion\n\nPromoted from a comment thread so the main line stays readable.\n";
          for (const c of thread) {
            md += `\n### @${c.author} · ${(c.created_at || "").slice(0, 10)}\n\n${c.body}\n`;
          }
          let subject = "discuss: " + p.subject;
          if (subject.length > 72) subject = subject.slice(0, 69) + "…";
          const sha = await gitCommitSha(`discuss ${p.id} ${name} ${md}`);
          this.sql(
            "INSERT INTO commits (sha, post_id, subject, body, author, email, created_at, parent_sha, story_json, branch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            sha, p.id, subject, md, viewer.name, viewer.email, new Date().toISOString(), p.head_sha, p.story_json || "", name,
          );
          this.sql("INSERT OR REPLACE INTO branches (post_id, name, sha) VALUES (?, ?, ?)", p.id, name, sha);
          for (const c of thread) {
            this.sql("UPDATE comments SET branch = ? WHERE id = ?", name, c.id);
          }
          return json({ branch: { name, sha, author: viewer.handle } }, 201);
        }

        if (rest === "diverge" && method === "GET") {
          if (!p.parent_post_id) return err(400, "bad request");
          const parent = this.findPost(p.parent_post_id);
          if (!parent) return err(404, "not found");
          let against = url.searchParams.get("against") || "parent";
          let oldT = "";
          let newT = encodePostFile(p.subject, p.body, p.story_json ? JSON.parse(p.story_json) : null);
          if (against === "base" && p.forked_from_sha) {
            const base = this.one<any>("SELECT * FROM commits WHERE sha = ?", p.forked_from_sha);
            oldT = base
              ? encodePostFile(base.subject, base.body, base.story_json ? JSON.parse(base.story_json) : null)
              : encodePostFile(parent.subject, parent.body, parent.story_json ? JSON.parse(parent.story_json) : null);
          } else {
            against = "parent";
            oldT = encodePostFile(parent.subject, parent.body, parent.story_json ? JSON.parse(parent.story_json) : null);
          }
          return json({
            parentId: parent.id,
            parentSubject: parent.subject,
            parentOwner: parent.owner,
            parentHeadSha: parent.head_sha,
            forkId: p.id,
            forkSubject: p.subject,
            forkOwner: p.owner,
            forkHeadSha: p.head_sha,
            intent: p.fork_intent || "",
            intentNote: p.fork_intent_note || "",
            intentLabel: FORK_INTENT_LABELS[p.fork_intent] || p.fork_intent || "",
            baseSha: p.forked_from_sha || "",
            against,
            diff: unifiedDiff(oldT, newT),
          });
        }

        if (rest === "paragraphs" && method === "GET") {
          return json({
            paragraphs: splitParagraphs(p.body || "").map((text, index) => ({ index, text })),
          });
        }

        if (rest === "blame" && method === "GET") {
          return json({ blame: this.blamePost(p) });
        }

        if (rest === "branches" && method === "GET") {
          const list = this.sql<any>("SELECT * FROM branches WHERE post_id = ?", p.id).map((b) => ({
            name: b.name,
            sha: b.sha,
            head: b.sha === p.head_sha || b.name === p.default_branch,
          }));
          return json({ branches: list });
        }

        if (rest === "branches" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          if (p.owner !== viewer.handle) return err(403, "forbidden");
          const inb = await req.json<any>();
          const name = slugify(inb.name || "");
          if (!name || name === "main") return err(400, "bad request");
          const from = inb.from || p.head_sha;
          this.sql("INSERT OR REPLACE INTO branches (post_id, name, sha) VALUES (?, ?, ?)", p.id, name, from);
          return json({ branch: { name, sha: from } }, 201);
        }

        if (rest === "checkout" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          if (p.owner !== viewer.handle) return err(403, "forbidden");
          const inb = await req.json<any>();
          const b = this.one<any>("SELECT * FROM branches WHERE post_id = ? AND name = ?", p.id, inb.name);
          if (!b) return err(404, "not found");
          const c = this.one<any>("SELECT * FROM commits WHERE sha = ?", b.sha);
          if (c) {
            this.sql(
              "UPDATE posts SET head_sha = ?, subject = ?, body = ?, default_branch = ?, updated_at = ? WHERE id = ?",
              c.sha,
              c.subject,
              c.body,
              inb.name,
              new Date().toISOString(),
              p.id,
            );
          }
          return json({ post: this.postPayload(this.findPost(p.id), viewer) });
        }

        if (rest === "cherry-pick" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          if (p.owner !== viewer.handle) return err(403, "forbidden");
          const inb = await req.json<any>();
          let c = this.one<any>("SELECT * FROM commits WHERE sha = ?", inb.sha);
          if (!c && inb.sourceId) c = this.one<any>("SELECT * FROM commits WHERE sha = ? AND post_id = ?", inb.sha, inb.sourceId);
          if (!c) return err(404, "not found");
          if (c.sha === p.head_sha || (c.subject === p.subject && c.body === p.body)) {
            return err(409, "that commit is already in this history");
          }
          const np = await this.amendPost(p.id, viewer, c.subject, c.body, c.story_json ? JSON.parse(c.story_json) : null);
          this.recordEvent("cherry", p.id, np.head_sha, viewer.handle);
          return json({ post: this.postPayload(np, viewer) });
        }
      }

      if (path === "/api/prs" && method === "GET") {
        const postId = url.searchParams.get("post") || "";
        let prs = this.sql<any>("SELECT * FROM prs ORDER BY number DESC");
        if (postId) prs = prs.filter((pr) => pr.target_post_id === postId || pr.source_post_id === postId);
        return json({
          prs: prs.map((pr) => mapPR(pr)),
        });
      }

      if (path === "/api/prs" && method === "POST") {
        if (!viewer) return err(401, "unauthorized");
        const inb = await req.json<any>();
        const pr = await this.openPR(
          viewer,
          inb.title,
          inb.body,
          inb.sourceId,
          inb.targetId,
          inb.kind,
          Number(inb.paragraphIndex) || 0,
          inb.original || "",
          inb.proposed || "",
          inb.rationale || "",
        );
        return json({ pr: mapPR(pr) }, 201);
      }

      const prMatch = path.match(/^\/api\/prs\/([^/]+)(?:\/(.*))?$/);
      if (prMatch) {
        const id = prMatch[1];
        const rest = prMatch[2] || "";
        const pr =
          this.one<any>("SELECT * FROM prs WHERE id = ?", id) ||
          this.one<any>("SELECT * FROM prs WHERE number = ?", Number(id));
        if (!pr) return err(404, "not found");

        if (!rest && method === "GET") {
          const src = this.findPost(pr.source_post_id);
          const dst = this.findPost(pr.target_post_id);
          let diff = "";
          if (pr.kind === "paragraph") {
            diff = unifiedDiff((pr.original || "") + "\n", (pr.proposed || "") + "\n");
          } else {
            const oldT = dst ? encodePostFile(dst.subject, dst.body, dst.story_json ? JSON.parse(dst.story_json) : null) : "";
            const newT = src ? encodePostFile(src.subject, src.body, src.story_json ? JSON.parse(src.story_json) : null) : "";
            diff = unifiedDiff(oldT, newT);
          }
          return json({
            pr: mapPR(pr),
            diff,
            source: src ? this.postPayload(src, viewer) : null,
            target: dst ? this.postPayload(dst, viewer) : null,
          });
        }

        if (rest === "merge" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          const dst = this.findPost(pr.target_post_id);
          if (!dst) return err(404, "not found");
          if (!canPushPost(dst, viewer)) {
            return err(403, dst.protected ? "main is protected — open a pull request" : "forbidden");
          }
          if (pr.status !== "open" && pr.status !== "conflict") return err(409, "conflict");
          const reviewers = parseReviews(pr.reviewers_json);
          if (pr.draft && !reviewsReady(reviewers)) return err(409, "this is still a draft — mark it ready after reviews");
          if (!reviewsReady(reviewers)) return err(409, "requested reviews are still pending");
          if (pr.kind === "paragraph") {
            let next: string;
            try {
              next = applyParagraph(dst.body || "", Number(pr.paragraph_index) || 0, pr.original || "", pr.proposed || "");
            } catch (e: any) {
              const msg = String(e?.message || e);
              if (msg.includes("changed")) {
                const block = `<<<<<<< yours (@${dst.owner} — current main)\n${pr.original || ""}\n=======\n${pr.proposed || ""}\n>>>>>>> incoming from @${pr.author}`;
                this.sql("UPDATE prs SET status = 'conflict', conflict_body = ?, updated_at = ? WHERE id = ?", block, new Date().toISOString(), pr.id);
                return json({ pr: mapPR(this.one<any>("SELECT * FROM prs WHERE id = ?", pr.id)) });
              }
              return err(400, msg);
            }
            const sha = await this.commit(
              dst.id,
              viewer,
              `Accept paragraph from @${pr.author}: ${pr.title}`,
              next,
              dst.story_json ? JSON.parse(dst.story_json) : null,
              new Date().toISOString(),
              dst.head_sha,
            );
            this.sql("UPDATE prs SET status = 'merged', merged_sha = ?, conflict_body = '', updated_at = ? WHERE id = ?", sha, new Date().toISOString(), pr.id);
            this.recordEvent("merge", dst.id, sha, viewer.handle);
            return json({ pr: mapPR(this.one<any>("SELECT * FROM prs WHERE id = ?", pr.id)) });
          }
          const src = this.findPost(pr.source_post_id);
          if (!src) return err(404, "not found");
          let baseBody = dst.body || "";
          if (src.forked_from_sha) {
            const c = this.one<any>("SELECT * FROM commits WHERE sha = ?", src.forked_from_sha);
            if (c) baseBody = c.body || "";
          } else if (pr.target_sha) {
            const c = this.one<any>("SELECT * FROM commits WHERE sha = ?", pr.target_sha);
            if (c) baseBody = c.body || "";
          }
          const merged = ideaMergeText(baseBody, dst.body || "", src.body || "", `yours (@${dst.owner} — current main)`, `incoming from @${pr.author} (PR #${pr.number})`);
          if (merged.conflict) {
            this.sql("UPDATE prs SET status = 'conflict', conflict_body = ?, updated_at = ? WHERE id = ?", merged.body, new Date().toISOString(), pr.id);
            return json({ pr: mapPR(this.one<any>("SELECT * FROM prs WHERE id = ?", pr.id)) });
          }
          const sha = await this.commit(dst.id, viewer, `Merge PR #${pr.number}: ${pr.title}`, merged.body, src.story_json ? JSON.parse(src.story_json) : null, new Date().toISOString(), dst.head_sha);
          this.sql("UPDATE prs SET status = 'merged', merged_sha = ?, conflict_body = '', updated_at = ? WHERE id = ?", sha, new Date().toISOString(), pr.id);
          this.recordEvent("merge", dst.id, sha, viewer.handle);
          return json({ pr: mapPR(this.one<any>("SELECT * FROM prs WHERE id = ?", pr.id)) });
        }

        if (rest === "resolve" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          const dst = this.findPost(pr.target_post_id);
          if (!dst) return err(404, "not found");
          if (!canPushPost(dst, viewer)) return err(403, "forbidden");
          if (pr.status !== "conflict") return err(409, "conflict");
          const inb = await req.json<any>();
          const body = String(inb.body || "").trim();
          if (!body || body.includes("<<<<<<<") || body.includes(">>>>>>>")) {
            return err(400, "resolve the conflict markers before merging");
          }
          if (!reviewsReady(parseReviews(pr.reviewers_json))) return err(409, "requested reviews are still pending");
          const sha = await this.commit(dst.id, viewer, `Resolve idea conflict from PR #${pr.number}`, body, dst.story_json ? JSON.parse(dst.story_json) : null, new Date().toISOString(), dst.head_sha);
          this.sql("UPDATE prs SET status = 'merged', merged_sha = ?, conflict_body = '', draft = 0, updated_at = ? WHERE id = ?", sha, new Date().toISOString(), pr.id);
          this.recordEvent("merge", dst.id, sha, viewer.handle);
          return json({ pr: mapPR(this.one<any>("SELECT * FROM prs WHERE id = ?", pr.id)) });
        }

        if (rest === "reviewers" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          const inb = await req.json<any>();
          const u = this.one<User>("SELECT * FROM users WHERE lower(handle) = ?", String(inb.handle || "").toLowerCase());
          if (!u) return err(404, "not found");
          const list = parseReviews(pr.reviewers_json);
          if (!list.some((r) => r.handle === u.handle)) {
            list.push({ handle: u.handle, status: "requested", requestedBy: viewer.handle, updatedAt: new Date().toISOString() });
          }
          this.sql("UPDATE prs SET reviewers_json = ?, draft = 1, updated_at = ? WHERE id = ?", JSON.stringify(list), new Date().toISOString(), pr.id);
          return json({ pr: mapPR(this.one<any>("SELECT * FROM prs WHERE id = ?", pr.id)) });
        }

        if (rest === "review" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          const inb = await req.json<any>();
          const status = String(inb.status || "").toLowerCase();
          if (status !== "approved" && status !== "changes") return err(400, "bad request");
          const list = parseReviews(pr.reviewers_json);
          const mine = list.find((r) => r.handle === viewer.handle);
          if (!mine) return err(403, "forbidden");
          mine.status = status;
          mine.note = inb.note || "";
          mine.updatedAt = new Date().toISOString();
          const draft = reviewsReady(list) ? 0 : 1;
          this.sql("UPDATE prs SET reviewers_json = ?, draft = ?, updated_at = ? WHERE id = ?", JSON.stringify(list), draft, new Date().toISOString(), pr.id);
          return json({ pr: mapPR(this.one<any>("SELECT * FROM prs WHERE id = ?", pr.id)) });
        }

        if (rest === "close" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          const dst = this.findPost(pr.target_post_id);
          if (!dst) return err(404, "not found");
          if (dst.owner !== viewer.handle && pr.author !== viewer.handle) return err(403, "forbidden");
          if (pr.status !== "open") return err(409, "conflict");
          let inb: any = {};
          try {
            inb = await req.json<any>();
          } catch {
            inb = {};
          }
          this.sql(
            "UPDATE prs SET status = 'closed', review_note = ?, updated_at = ? WHERE id = ?",
            inb.note || "",
            new Date().toISOString(),
            pr.id,
          );
          return json({ pr: mapPR(this.one<any>("SELECT * FROM prs WHERE id = ?", pr.id)) });
        }

        if (rest === "comment" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          const dst = this.findPost(pr.target_post_id);
          if (!dst) return err(404, "not found");
          if (dst.owner !== viewer.handle && pr.author !== viewer.handle) return err(403, "forbidden");
          const inb = await req.json<any>();
          const text = String(inb.body || "").trim();
          if (!text) return err(400, "bad request");
          let comments: any[] = [];
          try {
            comments = JSON.parse(pr.comments_json || "[]");
          } catch {
            comments = [];
          }
          comments.push({ author: viewer.handle, body: text, createdAt: new Date().toISOString() });
          this.sql("UPDATE prs SET comments_json = ?, updated_at = ? WHERE id = ?", JSON.stringify(comments), new Date().toISOString(), pr.id);
          return json({ pr: mapPR(this.one<any>("SELECT * FROM prs WHERE id = ?", pr.id)) });
        }
      }

      const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
      if (userMatch && method === "GET") {
        const u = this.one<User>("SELECT * FROM users WHERE handle = ?", userMatch[1].toLowerCase());
        if (!u) return err(404, "not found");
        const posts = this.sql<any>("SELECT * FROM posts WHERE owner = ? ORDER BY updated_at DESC", u.handle).map((p) => {
          const item = this.postPayload(p, viewer);
          delete (item as any).body;
          return item;
        });
        const derived: any[] = [];
        for (const p of this.sql<any>("SELECT id FROM posts WHERE owner = ?", u.handle)) {
          derived.push(...this.derivationsFrom(p.id));
        }
        const pub: any = this.publicUser(u);
        if (!viewer || viewer.handle !== u.handle) delete pub.email;
        return json({ user: pub, posts, graph: this.contribution(u.handle), score: this.score(u.handle), derived });
      }

      if (path.match(/^\/api\/posts\/[^/]+\/derived$/) && method === "GET") {
        const id = decodeURIComponent(path.split("/")[3]);
        const p = this.findPost(id);
        if (!p) return err(404, "not found");
        return json({ derived: this.derivationsFrom(p.id) });
      }

      if (path === "/api/inbox" && method === "GET") {
        if (!viewer) return err(401, "unauthorized");
        const notices = this.sql<any>("SELECT * FROM notices WHERE handle = ? ORDER BY created_at DESC LIMIT 80", viewer.handle).map((n) => ({
          id: n.id,
          handle: n.handle,
          kind: n.kind,
          actor: n.actor,
          postId: n.post_id,
          sourcePostId: n.source_post_id,
          sha: n.sha,
          subject: n.subject,
          read: !!n.read,
          createdAt: n.created_at,
        }));
        return json({ notices, unread: this.unreadCount(viewer.handle) });
      }

      if (path === "/api/inbox/read" && method === "POST") {
        if (!viewer) return err(401, "unauthorized");
        const inb = await req.json<any>();
        if (inb.all) {
          this.sql("UPDATE notices SET read = 1 WHERE handle = ?", viewer.handle);
        } else {
          for (const id of inb.ids || []) {
            this.sql("UPDATE notices SET read = 1 WHERE id = ? AND handle = ?", id, viewer.handle);
          }
        }
        const notices = this.sql<any>("SELECT * FROM notices WHERE handle = ? ORDER BY created_at DESC LIMIT 80", viewer.handle);
        return json({ notices, unread: this.unreadCount(viewer.handle) });
      }

      if (path === "/api/me/prefs" && method === "PUT") {
        if (!viewer) return err(401, "unauthorized");
        const inb = await req.json<any>();
        if (typeof inb.quietDerived === "boolean") {
          this.sql("UPDATE users SET quiet_derived = ? WHERE handle = ?", inb.quietDerived ? 1 : 0, viewer.handle);
        }
        const u = this.one<User>("SELECT * FROM users WHERE handle = ?", viewer.handle);
        return json({ user: u ? this.publicUser(u) : null });
      }

      if (path === "/api/drafts" && method === "GET") {
        if (!viewer) return err(401, "unauthorized");
        const drafts = this.sql<any>("SELECT * FROM drafts WHERE owner = ? ORDER BY updated_at DESC", viewer.handle).map((d) => ({
          id: d.id,
          owner: d.owner,
          subject: d.subject,
          body: d.body,
          storyUrl: d.story_url,
          topics: parseTopics(d.topics_json),
          createdAt: d.created_at,
          updatedAt: d.updated_at,
        }));
        return json({ drafts });
      }

      if (path === "/api/drafts" && method === "POST") {
        if (!viewer) return err(401, "unauthorized");
        const inb = await req.json<any>();
        const subject = String(inb.subject || "").trim();
        const body = String(inb.body || "");
        if (!subject && !body.trim()) return err(400, "bad request");
        const n = this.sql<any>("SELECT id FROM drafts WHERE owner = ?", viewer.handle).length;
        if (n >= 40) return err(400, "bad request");
        const id = hex(5);
        const ts = new Date().toISOString();
        this.sql(
          "INSERT INTO drafts (id, owner, subject, body, story_url, topics_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          id,
          viewer.handle,
          subject,
          body,
          inb.storyUrl || "",
          JSON.stringify(inb.topics || []),
          ts,
          ts,
        );
        const d = this.one<any>("SELECT * FROM drafts WHERE id = ?", id);
        return json({ draft: { id: d.id, owner: d.owner, subject: d.subject, body: d.body, storyUrl: d.story_url, topics: parseTopics(d.topics_json), createdAt: d.created_at, updatedAt: d.updated_at } }, 201);
      }

      const draftMatch = path.match(/^\/api\/drafts\/([^/]+)(?:\/(commit))?$/);
      if (draftMatch) {
        if (!viewer) return err(401, "unauthorized");
        const d = this.one<any>("SELECT * FROM drafts WHERE id = ? AND owner = ?", draftMatch[1], viewer.handle);
        if (!d) return err(404, "not found");
        if (draftMatch[2] === "commit" && method === "POST") {
          if (!String(d.subject || "").trim()) return err(400, "bad request");
          this.sql("DELETE FROM drafts WHERE id = ?", d.id);
          const story = d.story_url ? await fetchStory(d.story_url) : null;
          const p = await this.createPost(viewer, d.subject, d.body || "", d.story_url || "", story, parseTopics(d.topics_json));
          return json({ post: this.postPayload(p, viewer) }, 201);
        }
        if (method === "GET") {
          return json({ draft: { id: d.id, owner: d.owner, subject: d.subject, body: d.body, storyUrl: d.story_url, topics: parseTopics(d.topics_json), createdAt: d.created_at, updatedAt: d.updated_at } });
        }
        if (method === "PUT") {
          const inb = await req.json<any>();
          this.sql(
            "UPDATE drafts SET subject = ?, body = ?, story_url = ?, topics_json = ?, updated_at = ? WHERE id = ?",
            String(inb.subject || "").trim(),
            String(inb.body || ""),
            inb.storyUrl || "",
            JSON.stringify(inb.topics || []),
            new Date().toISOString(),
            d.id,
          );
          const nd = this.one<any>("SELECT * FROM drafts WHERE id = ?", d.id);
          return json({ draft: { id: nd.id, owner: nd.owner, subject: nd.subject, body: nd.body, storyUrl: nd.story_url, topics: parseTopics(nd.topics_json), createdAt: nd.created_at, updatedAt: nd.updated_at } });
        }
        if (method === "DELETE") {
          this.sql("DELETE FROM drafts WHERE id = ?", d.id);
          return json({ ok: true });
        }
      }

      const postBridge = path.match(/^\/api\/posts\/([^/]+)\/bridges$/);
      if (postBridge) {
        if (!viewer) return err(401, "unauthorized");
        const p = this.findPost(decodeURIComponent(postBridge[1]));
        if (!p) return err(404, "not found");
        if (!canPushPost(p, viewer)) return err(403, "forbidden");
        if (method === "POST") {
          const inb = await req.json<any>();
          const st = await fetchStory(String(inb.url || ""));
          if (!st) return err(400, "bad request");
          const list = parseReviews(p.bridges_json);
          const bridge = {
            url: st.url,
            provider: st.provider,
            repo: st.repo,
            kind: st.kind,
            number: st.number || "",
            title: st.title || String(st.message || "").split("\n")[0],
            state: st.state || "",
            sha: st.sha || "",
            htmlUrl: st.htmlUrl || st.url,
            direction: inb.direction || "writing-to-code",
            createdBy: viewer.handle,
            createdAt: new Date().toISOString(),
          };
          if (!list.some((b: any) => b.url === bridge.url)) list.push(bridge);
          this.sql("UPDATE posts SET bridges_json = ?, updated_at = ? WHERE id = ?", JSON.stringify(list), new Date().toISOString(), p.id);
          return json({ post: this.postPayload(this.findPost(p.id), viewer) });
        }
        if (method === "DELETE") {
          const raw = url.searchParams.get("url") || "";
          const list = parseReviews(p.bridges_json).filter((b: any) => b.url !== raw && b.htmlUrl !== raw);
          this.sql("UPDATE posts SET bridges_json = ? WHERE id = ?", JSON.stringify(list), p.id);
          return json({ post: this.postPayload(this.findPost(p.id), viewer) });
        }
      }

      if (path === "/api/watches" && method === "GET") {
        if (!viewer) return err(401, "unauthorized");
        return json({ watches: this.listWatches(viewer.handle) });
      }
      if (path === "/api/watches" && method === "POST") {
        if (!viewer) return err(401, "unauthorized");
        const inb = await req.json<any>();
        const w = this.watchRepo(viewer.handle, String(inb.repo || ""));
        if (!w) return err(400, "bad request");
        return json({ watch: w, watches: this.listWatches(viewer.handle) });
      }
      if (path === "/api/watches" && method === "DELETE") {
        if (!viewer) return err(401, "unauthorized");
        this.unwatchRepo(viewer.handle, url.searchParams.get("repo") || "");
        return json({ watches: this.listWatches(viewer.handle) });
      }

      if (path === "/api/changelog" && method === "GET") {
        if (!viewer) return err(401, "unauthorized");
        const hints = await this.refreshChangelog(viewer.handle);
        return json({ hints, watches: this.listWatches(viewer.handle) });
      }
      if (path === "/api/changelog/from-url" && method === "POST") {
        if (!viewer) return err(401, "unauthorized");
        const inb = await req.json<any>();
        const st = await fetchStory(String(inb.url || ""));
        if (!st || (st.kind !== "release" && st.kind !== "commit" && st.kind !== "pull" && !String(inb.url || "").includes("/releases/"))) {
          return err(400, "bad request");
        }
        const tag = st.number || st.sha || "ship";
        const name = st.title || String(st.message || "").split("\n")[0];
        const existing = this.one<any>("SELECT * FROM hints WHERE handle = ? AND html_url = ?", viewer.handle, st.htmlUrl || st.url);
        if (!existing) {
          this.sql(
            "INSERT INTO hints (id, handle, repo, tag, name, body, html_url, published_at, dismissed, draft_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?)",
            hex(5), viewer.handle, st.repo || "", tag, name, st.message || "", st.htmlUrl || st.url, st.date || "", new Date().toISOString(),
          );
        }
        return json({ hints: this.hintsFor(viewer.handle) }, 201);
      }
      const chDraft = path.match(/^\/api\/changelog\/([^/]+)\/draft$/);
      if (chDraft && method === "POST") {
        if (!viewer) return err(401, "unauthorized");
        const d = this.draftFromHint(viewer.handle, chDraft[1]);
        if (!d) return err(404, "not found");
        return json({ draft: d }, 201);
      }
      const chDismiss = path.match(/^\/api\/changelog\/([^/]+)\/dismiss$/);
      if (chDismiss && method === "POST") {
        if (!viewer) return err(401, "unauthorized");
        this.sql("UPDATE hints SET dismissed = 1 WHERE id = ? AND handle = ?", chDismiss[1], viewer.handle);
        return json({ hints: this.hintsFor(viewer.handle) });
      }

      if (path === "/api/story/preview" && method === "GET") {
        const st = await fetchStory(url.searchParams.get("url") || "");
        if (!st) return err(400, "bad request");
        return json({ story: st });
      }

      const sec = await this.handleSecurity(path, method, req, viewer);
      if (sec) return sec;
      const adm = await this.handleAdmin(path, method, req, viewer);
      if (adm) return adm;

      return err(404, "not found");
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg === "not found") return err(404, msg);
      if (msg === "unauthorized") return err(401, msg);
      if (msg.includes("protected")) return err(403, msg);
      if (msg.includes("reviews") || msg.includes("draft")) return err(409, msg);
      if (msg === "that paragraph has changed since this proposal") return err(409, msg);
      if (msg === "bad request") return err(400, msg);
      return err(500, msg);
    }
  }
}

function mapPR(pr: any) {
  let comments: any[] = [];
  try {
    comments = JSON.parse(pr.comments_json || "[]");
  } catch {
    comments = [];
  }
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    body: pr.body,
    author: pr.author,
    targetPostId: pr.target_post_id,
    sourcePostId: pr.source_post_id,
    sourceSha: pr.source_sha,
    targetSha: pr.target_sha,
    status: pr.status,
    mergedSha: pr.merged_sha,
    kind: pr.kind || "full",
    paragraphIndex: pr.paragraph_index || 0,
    original: pr.original || "",
    proposed: pr.proposed || "",
    rationale: pr.rationale || "",
    reviewNote: pr.review_note || "",
    comments,
    reviewers: parseReviews(pr.reviewers_json),
    draft: !!pr.draft,
    conflictBody: pr.conflict_body || "",
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
  };
}

const FORK_INTENT_LABELS: Record<string, string> = {
  "counter-argument": "Counter-argument",
  extension: "Extension",
  translation: "Translation",
  simplification: "Simplification",
  implementation: "Implementation",
};

function normalizeIntent(s: string): string {
  s = (s || "").toLowerCase().trim().replace(/[\s_]+/g, "-");
  if (s === "counterargument") s = "counter-argument";
  if (!FORK_INTENT_LABELS[s]) throw new Error("bad request");
  return s;
}

function splitParagraphs(body: string): string[] {
  return (body || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function applyParagraph(body: string, index: number, original: string, proposed: string): string {
  original = (original || "").trim();
  proposed = (proposed || "").trim();
  if (!proposed) throw new Error("bad request");
  const paras = splitParagraphs(body);
  const found = paras.findIndex((p) => p === original);
  if (found >= 0) {
    paras[found] = proposed;
    return paras.join("\n\n");
  }
  if (index >= 0 && index < paras.length) throw new Error("that paragraph has changed since this proposal");
  throw new Error("not found");
}

async function fetchStory(rawURL: string): Promise<any | null> {
  rawURL = (rawURL || "").trim();
  if (!rawURL) return null;
  const ghCommit = rawURL.match(/github\.com\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,40})/i);
  const ghPR = rawURL.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  const ghIssue = rawURL.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/i);
  const ghRel = rawURL.match(/github\.com\/([^/]+)\/([^/]+)\/releases\/tag\/([^/?#]+)/i);
  const glC = rawURL.match(/gitlab\.com\/(.+)\/-\/commit\/([0-9a-f]{7,40})/i);
  const glMR = rawURL.match(/gitlab\.com\/(.+)\/-\/merge_requests\/(\d+)/i);
  const glI = rawURL.match(/gitlab\.com\/(.+)\/-\/issues\/(\d+)/i);
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "gitpo.st" };
  try {
    if (ghCommit) {
      const owner = ghCommit[1];
      const repo = ghCommit[2].replace(/\.git$/, "");
      const sha = ghCommit[3];
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, { headers });
      if (!res.ok) return { url: rawURL, provider: "github", repo: `${owner}/${repo}`, sha, htmlUrl: rawURL, kind: "commit", message: "Could not fetch commit — saved the link." };
      const payload: any = await res.json();
      const files = (payload.files || []).slice(0, 4).map((f: any) => ({ filename: f.filename, additions: f.additions, deletions: f.deletions }));
      let snippet = "";
      for (const f of (payload.files || []).slice(0, 4)) {
        if (!f.patch) continue;
        snippet += `diff --git a/${f.filename} b/${f.filename}\n${f.patch}\n`;
      }
      return {
        url: rawURL, provider: "github", repo: `${owner}/${repo}`, sha: payload.sha, kind: "commit",
        title: String(payload.commit?.message || "").split("\n")[0],
        message: payload.commit?.message, author: payload.commit?.author?.name, date: payload.commit?.author?.date,
        htmlUrl: payload.html_url, additions: payload.stats?.additions || 0, deletions: payload.stats?.deletions || 0,
        snippet: snippet.slice(0, 8000), files,
      };
    }
    if (ghPR) {
      const owner = ghPR[1];
      const repo = ghPR[2].replace(/\.git$/, "");
      const num = ghPR[3];
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, { headers });
      if (!res.ok) return { url: rawURL, provider: "github", repo: `${owner}/${repo}`, htmlUrl: rawURL, kind: "pull", number: num, message: "Pull request " + num };
      const payload: any = await res.json();
      let snippet = "";
      const files: any[] = [];
      try {
        const fr = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}/files?per_page=10`, { headers });
        if (fr.ok) {
          const fl: any[] = await fr.json();
          for (const f of fl.slice(0, 4)) {
            files.push({ filename: f.filename, additions: f.additions, deletions: f.deletions });
            if (f.patch) snippet += `diff --git a/${f.filename} b/${f.filename}\n${f.patch}\n`;
          }
        }
      } catch { /* ignore */ }
      return {
        url: rawURL, provider: "github", repo: `${owner}/${repo}`, sha: payload.head?.sha, kind: "pull", number: num,
        title: payload.title, state: payload.merged ? "merged" : payload.state,
        message: `${payload.title}\n\n${payload.body || ""}`, author: payload.user?.login, htmlUrl: payload.html_url,
        additions: payload.additions, deletions: payload.deletions, snippet: snippet.slice(0, 8000), files,
      };
    }
    if (ghIssue) {
      const owner = ghIssue[1];
      const repo = ghIssue[2].replace(/\.git$/, "");
      const num = ghIssue[3];
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${num}`, { headers });
      if (!res.ok) return { url: rawURL, provider: "github", repo: `${owner}/${repo}`, htmlUrl: rawURL, kind: "issue", number: num, message: "Issue " + num };
      const payload: any = await res.json();
      if (payload.pull_request) return fetchStory(payload.pull_request.html_url || rawURL.replace("/issues/", "/pull/"));
      return {
        url: rawURL, provider: "github", repo: `${owner}/${repo}`, kind: "issue", number: num,
        title: payload.title, state: payload.state, message: `${payload.title}\n\n${payload.body || ""}`,
        author: payload.user?.login, htmlUrl: payload.html_url,
      };
    }
    if (ghRel) {
      const owner = ghRel[1];
      const repo = ghRel[2].replace(/\.git$/, "");
      const tag = decodeURIComponent(ghRel[3]);
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`, { headers });
      if (!res.ok) return { url: rawURL, provider: "github", repo: `${owner}/${repo}`, kind: "release", title: tag, message: tag, htmlUrl: rawURL };
      const payload: any = await res.json();
      return {
        url: rawURL, provider: "github", repo: `${owner}/${repo}`, kind: "release",
        title: payload.name || payload.tag_name, number: payload.tag_name, state: "published",
        message: `${payload.name || payload.tag_name}\n\n${payload.body || ""}`,
        author: payload.author?.login, date: payload.published_at, htmlUrl: payload.html_url,
      };
    }
    if (glC) return { url: rawURL, provider: "gitlab", repo: glC[1], sha: glC[2], htmlUrl: rawURL, kind: "commit", message: "GitLab commit" };
    if (glMR) return { url: rawURL, provider: "gitlab", repo: glMR[1], number: glMR[2], htmlUrl: rawURL, kind: "pull", message: "Merge request " + glMR[2] };
    if (glI) return { url: rawURL, provider: "gitlab", repo: glI[1], number: glI[2], htmlUrl: rawURL, kind: "issue", message: "Issue " + glI[2] };
  } catch {
    /* fall through */
  }
  return { url: rawURL, provider: "link", htmlUrl: rawURL, kind: "link", message: rawURL };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": request.headers.get("Origin") || "*",
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "Content-Type",
          "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
        },
      });
    }
    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "gitpo.st", edge: "cloudflare", time: new Date().toISOString() });
    }
    if (url.pathname.startsWith("/api/")) {
      try {
        const id = env.STORE.idFromName("main");
        return await env.STORE.get(id).fetch(request);
      } catch (e: any) {
        return json({ error: String(e?.message || e), stack: String(e?.stack || "") }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
