# Inbox and profiles

Credit is structural. The inbox and the profile are where that shows up.

## Inbox

**inbox** in the header is **Derived from you**. It lists:

- **fork** — someone forked your object into theirs
- **cherry-pick** — someone lifted a commit or excerpt from you
- **release** — a GitHub repo you watch tagged a release (see [Shipping](shipping.md))

Each row links the actor, your source object, and the new object. Unread rows can be marked **Read**, or **Mark all read**.

You are not notified when you derive from yourself.

The header shows an unread count.

### Quiet those notices

On **security**, under **attribution**:

> Don’t notify me when someone forks or cherry-picks my work. The derived-from link is still written.

Turn that on if you want the graph without the inbox. Release suggestions are a different path (the ship log).

## Your profile

`/u/{handle}` — also **@you** in the header.

You see:

- handle, name, bio
- a **maintainer score** (if the site has enough activity to compute one)
- a contribution graph
- objects **taken from this log** (forks and other derivations)
- the person’s commit log

**No bio committed yet** appears when the bio is empty. There is no profile editor after signup. The bio is set when you create the identity.

On your own profile, **Sign out** ends this session.

## Maintainer score

The score is not “how much you posted.” Volume does not count.

It adds:

| Signal | What it is |
| --- | --- |
| **Reviews** | Formal reviews you completed |
| **Merges accepted** | Merges on objects you own |
| **Taken** | Others cherry-picked from objects you own |
| **Quality main** | Protected objects, objects with a few commits, verified history |
| **Stars on maintained objects** | Stars on objects you own or maintain |

The profile spells out the counts next to the number.

## Contribution graph

A year of days, in the spirit of a commit graph: your commits and reverts, merges on your objects, and times others took from you. Darker cells are busier days.

## Other people’s profiles

Same page, no sign-out button. Use it to read a log, see what was derived from them, and open objects.

## Tips

- Treat a fork notice as a chance to read a take, not as a metric.
- If you maintain a thread, protect main and request reviews — that is what the score is looking at.
- Share `/u/you` as your identity. The handle is the stable name.
