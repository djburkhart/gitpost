# How gitpo.st works

gitpo.st is **the commit log for writing**. Ideas get the same tools you already trust for code: a subject, a body, a SHA, history you can diff, forks with intent, and pull requests.

## What a post is

A post is an **object** in the log. It has:

- a **subject** — the commit message
- a **body** — Markdown prose
- a **SHA** — the current tip of that object
- an **owner** — the `@handle` who started it
- optional **remotes** — topics such as `remote:writing`

The live page is `/p/{id}`. Older revisions stay addressable at `/p/{id}/o/{sha}`.

Nothing is silently rewritten. **Amend** writes a new commit. The previous SHA stays in the history forever.

## Why Git objects

Each object is a real commit history. That is why the product talks in Git:

| Word | What it means here |
| --- | --- |
| **Commit** | Publish a sealed object, or add a revision |
| **SHA** | The address of that revision |
| **Tip / HEAD** | The current version of the object |
| **Working tree** | Private drafts nobody else can see |
| **Star** | Bookmark a commit you will return to |
| **Watch** | Follow new commits on a thread |
| **Remote** | A topic you track, like `remote:ai-safety` |
| **Fork** | Take the tip and write your own, with an intent |
| **Pull request** | Propose a merge, or a better paragraph |
| **Cherry-pick** | Lift one commit — or one sentence — into your tree |

The homepage feed is `origin / main`. If you track remotes, a second list appears: `git fetch remotes`.

## History, diffs, and proof

Open any object and use the **History** and **Diff** tabs.

- History lists every commit. Each one has a permalink.
- Diff compares any two revisions of the same object.
- Hover a paragraph on **Read** to see **blame** — who last wrote that paragraph, and at which SHA.
- A **verified history** badge means the first-parent line is intact. If history was rewritten, the badge says so.

Revert is a new commit with a reason. The “bad” edit stays in the log. The record stays honest.

## Forks, takes, and pull requests

**Fork** copies the tip into your log. You pick an intent so the graph stays readable:

- Counter-argument
- Extension
- Translation
- Simplification
- Implementation

You can add a one-line note. Your fork keeps a **derived from** link back to the parent. The **Diverge** tab shows how your take differs from the parent now, or from the parent at the moment you forked. Other forks of the same idea show up as **Takes**.

There are two kinds of pull request:

1. **Full** — you own a fork and propose merging it back into the parent.
2. **Paragraph** — you disagree with one paragraph. You rewrite it and say why. The author can accept, reject, or reply.

Merges that cannot be combined cleanly become an **idea conflict**. Markers appear in the prose. Someone with push access resolves them into one piece of writing. Nothing is overwritten silently.

## Identity

You sign in with a **handle** (`@you`) and a password. The handle is your identity on the log. Profiles live at `/u/{handle}`.

Signup is usually **invite-only**. An administrator mints a code; you open `/join` (or a link with `?invite=…`) and **commit identity**. Administrators can also open registration or close it.

The first account on a site is the super admin `@danny`. Regular members cannot mint invites.

## Feed, explore, and remotes

- **Log** (`/`) — recent objects, newest tip first. Signed-in, objects on remotes you track appear above the main log.
- **Explore** (`/explore`) — a commit graph of popular objects, forks, and merges. Search by words, or filter with `remote:topic`.
- **Pulls** (`/pulls`) — proposed merges across the site.

Remotes are topics, not other people. Tag an object when you commit (`ai-safety`, or `#writing` in the body). Track a remote to fetch that topic into your log. You can follow up to 24 remotes.

## Credit is structural

When someone forks or cherry-picks your work, gitpo.st writes a **derived from** link on the new object. You get an **inbox** notice unless you turn those notices off. Volume of posts does not make a maintainer. Reviews, accepted merges, and work others take from you do.

## What you will not find

There is no follow-a-person graph, no direct messages, and no way to rewrite a published SHA. Comments stay off the main line. If a discussion should become real work, the owner can **branch that thread**.
