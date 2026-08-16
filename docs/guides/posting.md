# Posting

A published post is a sealed Git object. Until you commit, it can live as a private draft in your working tree.

## Start a commit

Signed in, use **Commit** in the header, or go to `/compose`.

You get two modes:

- **Write** — a new object. Subject + body.
- **Story commit** — paste a GitHub or GitLab commit, pull request, issue, or release, then write why it matters. The code object stays attached.

**Story** in the header opens compose already in story mode.

You must be signed in. Guests are sent to sign in, then back here.

## Subject and body

**Subject** is the commit message. The counter turns cautionary after 50 characters and red after 72. The field allows up to 120. Aim for one line you would be happy to see in `git log --oneline`.

**Body** is Markdown. The editor is a rich Markdown field. Headings, lists, code, and tables all render on the object. Line breaks in the source stay visible.

Hashtags in the subject or body become remotes. `#writing` is stored as `writing` and shown as `remote:writing`.

## Remotes

Under the body, **Remotes** is a tag field. Type a topic and press Enter or comma. Examples: `ai-safety`, `writing`.

- Topics are lowercased and slugified (`AI Safety` → `ai-safety`).
- You can prefix `remote:` or `#`; both are stripped.
- A topic needs at least two characters and at most 40.
- An object can have up to eight remotes.

People who track that remote will see your object in their `git fetch remotes` list.

## Save a draft

**Save draft** writes to your working tree. Nobody else can see it.

Compose also auto-saves about two seconds after you stop typing, once there is a subject, body, or story URL.

The URL becomes `/compose?draft={id}` so you can come back. **Working tree** in the header (**drafts**) lists every uncommitted thought. From there you can open, **Commit**, or **Discard**.

A draft needs a subject before you can commit it from the list.

## Commit

**Commit** publishes a sealed object and takes you to `/p/{id}`. That page is the live tip.

If you were editing a draft, commit consumes the draft. If you were not, compose can still publish directly.

After it is public, further edits are new commits — see [History and diffs](history-and-diffs.md). You cannot unpublish from your account. An administrator can remove a post.

## Story commits

Paste a URL such as:

- `https://github.com/git/git/commit/…`
- a pull request or issue
- a release (`/releases/tag/v2.0`)
- the GitLab equivalents

gitpo.st fetches a preview: repo, title or message, author, `+`/`−`, files, and a snippet when one exists. If the subject is empty, the story title fills it in.

Write the **narrative** — what shipped, what it means, what to watch next. The diff stays attached on the object.

You can also start from **ship**: watch a GitHub repo, then **Write post** on a suggested release. That opens compose as a story draft. See [Shipping](shipping.md).

## Tips

- Write the subject as if it will live in a log forever. It will.
- Keep the first paragraph able to stand alone. Blame and paragraph PRs work on paragraphs split by a blank line.
- Tag remotes when you commit, not later as an afterthought — though you can add them on the next amend.
- Draft until the thought is ready. Commit is the act of sealing, not of thinking.
