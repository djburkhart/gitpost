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
    };
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

  private async createPost(user: User, subject: string, body: string, storyUrl: string, story: unknown, when?: string) {
    subject = subject.trim();
    if (!subject) throw new Error("bad request");
    const id = hex(5);
    const ts = when || new Date().toISOString();
    this.sql(
      "INSERT INTO posts (id, owner, subject, slug, body, head_sha, parent_post_id, forked_from_sha, story_json, story_url, default_branch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '', '', '', ?, ?, 'main', ?, ?)",
      id,
      user.handle,
      subject,
      slugify(subject),
      body || "",
      story ? JSON.stringify(story) : "",
      storyUrl || "",
      ts,
      ts,
    );
    await this.commit(id, user, subject, body || "", story, ts, "");
    return this.findPost(id)!;
  }

  private async amendPost(id: string, user: User, subject: string, body: string, story: unknown) {
    const p = this.findPost(id);
    if (!p) throw new Error("not found");
    if (p.owner !== user.handle) throw new Error("forbidden");
    const ts = new Date().toISOString();
    await this.commit(p.id, user, subject.trim() || p.subject, body, story, ts, p.head_sha, p.default_branch || "main");
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
      "INSERT INTO posts (id, owner, subject, slug, body, head_sha, parent_post_id, forked_from_sha, fork_intent, fork_intent_note, story_json, story_url, default_branch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, 'main', ?, ?)",
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
    return this.findPost(nid)!;
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
        return json({ user: viewer ? this.publicUser(viewer) : null });
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
        const q = (url.searchParams.get("q") || "").toLowerCase();
        let posts = this.sql<any>("SELECT * FROM posts ORDER BY updated_at DESC");
        if (q) {
          posts = posts.filter((p) => `${p.subject} ${p.body} ${p.owner}`.toLowerCase().includes(q));
        }
        return json({
          posts: posts.map((p) => {
            const item = this.postPayload(p, viewer);
            delete (item as any).body;
            return item;
          }),
        });
      }

      if (path === "/api/posts" && method === "POST") {
        if (!viewer) return err(401, "unauthorized");
        const inb = await req.json<any>();
        let story = null;
        if (inb.storyUrl) story = await fetchStory(inb.storyUrl);
        const p = await this.createPost(viewer, inb.subject, inb.body || "", inb.storyUrl || "", story);
        return json({ post: this.postPayload(p, viewer) }, 201);
      }

      const postMatch = path.match(/^\/api\/posts\/([^/]+)(?:\/(.*))?$/);
      if (postMatch) {
        const ref = decodeURIComponent(postMatch[1]);
        const rest = postMatch[2] || "";
        const p = this.findPost(ref);
        if (!p && method !== "POST") return err(404, "not found");

        if (!rest && method === "GET") return json({ post: this.postPayload(p, viewer) });

        if (!rest && method === "PUT") {
          if (!viewer) return err(401, "unauthorized");
          const inb = await req.json<any>();
          let story = p.story_json ? JSON.parse(p.story_json) : null;
          if (inb.storyUrl && inb.storyUrl !== p.story_url) story = await fetchStory(inb.storyUrl);
          const np = await this.amendPost(p.id, viewer, inb.subject, inb.body, story);
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
          return json({ commits });
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
          const forks = this.sql<any>("SELECT * FROM posts WHERE parent_post_id = ? ORDER BY updated_at DESC", p.id).map((row) => {
            const item = this.postPayload(row, viewer);
            delete (item as any).body;
            return item;
          });
          return json({ forks });
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
          return json({ pr: mapPR(pr), diff, source: src, target: dst });
        }

        if (rest === "merge" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          const dst = this.findPost(pr.target_post_id);
          if (!dst) return err(404, "not found");
          if (dst.owner !== viewer.handle) return err(403, "forbidden");
          if (pr.status !== "open") return err(409, "conflict");
          if (pr.kind === "paragraph") {
            let next: string;
            try {
              next = applyParagraph(dst.body || "", Number(pr.paragraph_index) || 0, pr.original || "", pr.proposed || "");
            } catch (e: any) {
              const msg = String(e?.message || e);
              if (msg.includes("changed")) return err(409, msg);
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
            this.sql("UPDATE prs SET status = 'merged', merged_sha = ?, updated_at = ? WHERE id = ?", sha, new Date().toISOString(), pr.id);
            return json({ pr: mapPR(this.one<any>("SELECT * FROM prs WHERE id = ?", pr.id)) });
          }
          const src = this.findPost(pr.source_post_id);
          if (!src) return err(404, "not found");
          const sha = await this.commit(dst.id, viewer, `Merge PR #${pr.number}: ${pr.title}`, src.body, src.story_json ? JSON.parse(src.story_json) : null, new Date().toISOString(), dst.head_sha);
          this.sql("UPDATE prs SET status = 'merged', merged_sha = ?, updated_at = ? WHERE id = ?", sha, new Date().toISOString(), pr.id);
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
        return json({ user: this.publicUser(u), posts });
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
      if (msg === "forbidden") return err(403, msg);
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

async function fetchStory(rawURL: string) {
  rawURL = (rawURL || "").trim();
  if (!rawURL) return null;
  const ghCommit = rawURL.match(/github\.com\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,40})/i);
  const ghPR = rawURL.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  const gl = rawURL.match(/gitlab\.com\/(.+)\/-\/commit\/([0-9a-f]{7,40})/i);
  if (gl) return { url: rawURL, provider: "gitlab", repo: gl[1], sha: gl[2], htmlUrl: rawURL, message: "GitLab commit" };
  try {
    if (ghCommit) {
      const owner = ghCommit[1];
      const repo = ghCommit[2].replace(/\.git$/, "");
      const sha = ghCommit[3];
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "gitpo.st" },
      });
      if (!res.ok) return { url: rawURL, provider: "github", repo: `${owner}/${repo}`, sha, htmlUrl: rawURL, message: "Could not fetch commit — saved the link." };
      const payload: any = await res.json();
      const snippet = payload.files?.[0]?.patch?.slice(0, 4000) || "";
      return {
        url: rawURL,
        provider: "github",
        repo: `${owner}/${repo}`,
        sha: payload.sha,
        message: payload.commit?.message,
        author: payload.commit?.author?.name,
        date: payload.commit?.author?.date,
        htmlUrl: payload.html_url,
        additions: payload.stats?.additions || 0,
        deletions: payload.stats?.deletions || 0,
        snippet,
      };
    }
    if (ghPR) {
      const owner = ghPR[1];
      const repo = ghPR[2].replace(/\.git$/, "");
      const num = ghPR[3];
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "gitpo.st" },
      });
      if (!res.ok) return { url: rawURL, provider: "github", repo: `${owner}/${repo}`, htmlUrl: rawURL, message: "Pull request " + num };
      const payload: any = await res.json();
      return {
        url: rawURL,
        provider: "github",
        repo: `${owner}/${repo}`,
        sha: payload.head?.sha,
        message: `${payload.title}\n\n${payload.body || ""}`,
        author: payload.user?.login,
        htmlUrl: payload.html_url,
        additions: payload.additions,
        deletions: payload.deletions,
      };
    }
  } catch {
    /* fall through */
  }
  return { url: rawURL, provider: "link", htmlUrl: rawURL, message: rawURL };
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
