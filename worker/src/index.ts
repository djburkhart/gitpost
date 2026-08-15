import { DurableObject } from "cloudflare:workers";
import { unifiedDiff } from "./diff";
import { DEMO_USERS, SEED_POSTS } from "./seed";

export interface Env {
  STORE: DurableObjectNamespace<GitPostStore>;
  ASSETS: Fetcher;
}

type User = {
  id: string;
  handle: string;
  name: string;
  email: string;
  bio: string;
  password_hash: string;
  created_at: string;
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
  return shaHex("SHA-256", "gitpost:" + pw);
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
    const statements = [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        handle TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        bio TEXT,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
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
        created_at TEXT,
        updated_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
    ];
    for (const stmt of statements) {
      this.ctx.storage.sql.exec(stmt);
    }
    const seeded = this.one<{ value: string }>("SELECT value FROM meta WHERE key = ?", "seeded");
    if (!seeded) await this.seed();
  }

  private async seed() {
    for (const u of DEMO_USERS) {
      await this.createUser(u.handle, u.name, u.email, u.bio, u.password);
    }
    const created: Record<string, string> = {};
    for (const p of SEED_POSTS) {
      const user = this.one<User>("SELECT * FROM users WHERE handle = ?", p.owner);
      if (!user) continue;
      const when = new Date(
        Date.now() - (p.daysAgo || 0) * 86400000 - (p.hoursAgo || 0) * 3600000,
      ).toISOString();
      const post = await this.createPost(user, p.subject, p.body, p.story ? (p.story as { url?: string }).url || "" : "", p.story || null, when);
      created[p.subject] = post.id;
      if (p.edits) {
        for (const body of p.edits) {
          await this.amendPost(post.id, user, p.subject, body, p.story || null);
        }
      }
    }
    const adaForce = created["I force-pushed to main and lived to tell the tale"];
    const maya = this.one<User>("SELECT * FROM users WHERE handle = ?", "maya");
    if (adaForce && maya) {
      const fork = await this.forkPost(adaForce, maya);
      const extra =
        SEED_POSTS[0].edits?.[1] +
        `\n\n**Maya's edit.** Add this to the recovery list: message the people who had the old tip *before* you push the rescue branch. Reflog saves objects. It does not save trust.`;
      await this.amendPost(fork.id, maya, SEED_POSTS[0].subject, extra, null);
      await this.openPR(maya, "Add a note about telling people before you rescue", "Small amendment to the recovery section. The reflog steps are right; the social step was missing.", fork.id, adaForce);
      this.sql("INSERT OR IGNORE INTO stars (post_id, handle) VALUES (?, ?)", adaForce, "maya");
      this.sql("INSERT OR IGNORE INTO stars (post_id, handle) VALUES (?, ?)", adaForce, "linus");
      this.sql("INSERT OR IGNORE INTO stars (post_id, handle) VALUES (?, ?)", adaForce, "guest");
      this.sql("INSERT OR IGNORE INTO watches (post_id, handle) VALUES (?, ?)", adaForce, "maya");
    }
    const cookiePost = created["How the session cookie stopped being a footgun"];
    if (cookiePost) {
      this.sql("INSERT OR IGNORE INTO stars (post_id, handle) VALUES (?, ?)", cookiePost, "ada");
      this.sql("INSERT OR IGNORE INTO stars (post_id, handle) VALUES (?, ?)", cookiePost, "linus");
    }
    this.sql("INSERT INTO meta (key, value) VALUES ('seeded', '1')");
  }

  private async createUser(handle: string, name: string, email: string, bio: string, password: string) {
    handle = handle.toLowerCase().trim();
    if (!handle || !password) throw new Error("bad request");
    if (this.one("SELECT id FROM users WHERE handle = ?", handle)) throw new Error("conflict");
    const id = hex(8);
    const now = new Date().toISOString();
    this.sql(
      "INSERT INTO users (id, handle, name, email, bio, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      handle,
      name || handle,
      email || `${handle}@gitpo.st`,
      bio || "",
      await hashPass(password),
      now,
    );
    return this.one<User>("SELECT * FROM users WHERE id = ?", id)!;
  }

  private publicUser(u: User) {
    return { id: u.id, handle: u.handle, name: u.name, email: u.email, bio: u.bio, createdAt: u.created_at };
  }

  private userBySession(token: string | null): User | null {
    if (!token) return null;
    const s = this.one<{ user_id: string; expires_at: string }>(
      "SELECT user_id, expires_at FROM sessions WHERE token = ?",
      token,
    );
    if (!s || s.expires_at < new Date().toISOString()) return null;
    return this.one<User>("SELECT * FROM users WHERE id = ?", s.user_id);
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

  private async forkPost(id: string, user: User) {
    const src = this.findPost(id);
    if (!src) throw new Error("not found");
    const nid = hex(5);
    const ts = new Date().toISOString();
    this.sql(
      "INSERT INTO posts (id, owner, subject, slug, body, head_sha, parent_post_id, forked_from_sha, story_json, story_url, default_branch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, 'main', ?, ?)",
      nid,
      user.handle,
      src.subject,
      src.slug,
      src.body,
      src.id,
      src.head_sha,
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
    const forkSha = await this.commit(nid, user, "fork: " + src.subject, src.body, src.story_json ? JSON.parse(src.story_json) : null, ts, last);
    this.sql("UPDATE posts SET head_sha = ? WHERE id = ?", forkSha, nid);
    return this.findPost(nid)!;
  }

  private async openPR(user: User, title: string, body: string, sourceId: string, targetId: string) {
    const src = this.findPost(sourceId);
    const dst = this.findPost(targetId);
    if (!src || !dst) throw new Error("not found");
    if (src.owner !== user.handle) throw new Error("forbidden");
    const n = (this.one<{ n: number }>("SELECT COALESCE(MAX(number),0) as n FROM prs")?.n || 0) + 1;
    const id = hex(4);
    const ts = new Date().toISOString();
    this.sql(
      "INSERT INTO prs (id, number, title, body, author, target_post_id, source_post_id, source_sha, target_sha, status, merged_sha, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', '', ?, ?)",
      id,
      n,
      title || src.subject,
      body || "",
      user.handle,
      dst.id,
      src.id,
      src.head_sha,
      dst.head_sha,
      ts,
      ts,
    );
    return this.one<any>("SELECT * FROM prs WHERE id = ?", id);
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

      if (path === "/api/auth/register" && method === "POST") {
        const inb = await req.json<any>();
        const u = await this.createUser(inb.handle, inb.name, inb.email, inb.bio, inb.password);
        const token = hex(24);
        const exp = new Date(Date.now() + 30 * 86400000).toISOString();
        this.sql("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", token, u.id, exp);
        return json({ user: this.publicUser(u) }, 201, { "set-cookie": cookie(token) });
      }

      if (path === "/api/auth/login" && method === "POST") {
        const inb = await req.json<any>();
        const u = this.one<User>("SELECT * FROM users WHERE handle = ?", String(inb.handle || "").toLowerCase());
        if (!u || u.password_hash !== (await hashPass(inb.password || ""))) return err(401, "unauthorized");
        const token = hex(24);
        const exp = new Date(Date.now() + 30 * 86400000).toISOString();
        this.sql("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", token, u.id, exp);
        return json({ user: this.publicUser(u) }, 200, { "set-cookie": cookie(token) });
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
          const np = await this.forkPost(p.id, viewer);
          return json({ post: this.postPayload(np, viewer) }, 201);
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
          const np = await this.amendPost(p.id, viewer, c.subject, c.body, c.story_json ? JSON.parse(c.story_json) : null);
          return json({ post: this.postPayload(np, viewer) });
        }
      }

      if (path === "/api/prs" && method === "GET") {
        const postId = url.searchParams.get("post") || "";
        let prs = this.sql<any>("SELECT * FROM prs ORDER BY number DESC");
        if (postId) prs = prs.filter((pr) => pr.target_post_id === postId || pr.source_post_id === postId);
        return json({
          prs: prs.map((pr) => ({
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
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
          })),
        });
      }

      if (path === "/api/prs" && method === "POST") {
        if (!viewer) return err(401, "unauthorized");
        const inb = await req.json<any>();
        const pr = await this.openPR(viewer, inb.title, inb.body, inb.sourceId, inb.targetId);
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
          const oldT = dst ? encodePostFile(dst.subject, dst.body, dst.story_json ? JSON.parse(dst.story_json) : null) : "";
          const newT = src ? encodePostFile(src.subject, src.body, src.story_json ? JSON.parse(src.story_json) : null) : "";
          return json({ pr: mapPR(pr), diff: unifiedDiff(oldT, newT), source: src, target: dst });
        }

        if (rest === "merge" && method === "POST") {
          if (!viewer) return err(401, "unauthorized");
          const dst = this.findPost(pr.target_post_id);
          const src = this.findPost(pr.source_post_id);
          if (!dst || !src) return err(404, "not found");
          if (dst.owner !== viewer.handle) return err(403, "forbidden");
          if (pr.status !== "open") return err(409, "conflict");
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
          this.sql("UPDATE prs SET status = 'closed', updated_at = ? WHERE id = ?", new Date().toISOString(), pr.id);
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

      return err(404, "not found");
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg === "not found") return err(404, msg);
      if (msg === "unauthorized") return err(401, msg);
      if (msg === "forbidden") return err(403, msg);
      if (msg === "conflict") return err(409, msg);
      if (msg === "bad request") return err(400, msg);
      return err(500, msg);
    }
  }
}

function mapPR(pr: any) {
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
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
  };
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
