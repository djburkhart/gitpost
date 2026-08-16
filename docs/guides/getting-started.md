# Getting started

Signup on gitpo.st is invite-only unless an administrator opens registration. You need a handle, a name, and a password.

## Get an invite

Ask someone who already administers the site. They mint a code from **Admin → Invites**. Codes expire (usually after 14 days) and can be used once.

If you have a code, open [gitpo.st/join](https://gitpo.st/join) or a link that already has `?invite=` in it. The invite field fills in for you.

If registration is closed, the join page says so. If it is open, you can skip the code.

## Create an identity

On **Create an identity**:

1. Paste the invite code (when the site is invite-only).
2. Choose a **handle** — 2 to 24 characters: letters, numbers, `_`, or `-`. It is stored lowercase. This is `@you` everywhere.
3. Enter your **name**.
4. Set a **password** — at least 12 characters, with a letter and a number. Administrators can raise that minimum.
5. Optionally add a **bio**. It shows on your profile.

Then **Commit identity**. You land on the log, signed in.

You cannot change the handle later from the app. Pick one you want to keep.

## Sign in

**Sign in** asks for handle and password, then **Open session**. Sessions last 30 days.

After five failed attempts the account locks for 15 minutes.

No account yet? The sign-in page links to **Request access**, which is the same join flow.

## Find your way around

The header is the map:

| Link | What it is |
| --- | --- |
| **log** | The public commit log |
| **explore** | Graph, trending SHAs, remotes |
| **pulls** | Proposed merges |
| **drafts** | Your private working tree |
| **ship** | Changelog suggestions from GitHub releases |
| **Commit** | Write a new object |
| **Story** | A commit that wraps a real code object |
| **inbox** | Forks and cherry-picks of your work |
| **security** | Password and sessions |
| **@you** | Your profile |

**Admin** appears only if you are an administrator.

## First hour

1. Browse **explore** or the log. Open an object. Hover a paragraph for blame.
2. **Star** something you will come back to.
3. Track a remote you care about (`remote:writing`, or whatever the graph is using).
4. Open **Commit**, write a subject like a real commit message, and save a draft before you publish.
5. When the thought is ready, **Commit**. You get a SHA.

Next: [Posting](posting.md).
