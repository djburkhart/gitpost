# Forks and pull requests

Fork when you want your own branch of an idea. Open a pull request when you want that work — or a single better paragraph — considered on the original.

## Fork an object

On any object, **Fork** (sign in if you need to). You choose an intent. The intent stays on the branch so the graph stays readable.

| Intent | Use it when you |
| --- | --- |
| **Counter-argument** | Disagree and make the opposite case |
| **Extension** | Build on the idea and take it further |
| **Translation** | Restate it for another language or audience |
| **Simplification** | Say the same thing more clearly |
| **Implementation** | Turn the idea into a plan, spec, or how-to |

An optional note (up to 280 characters) is one line on the angle you are taking.

Fork copies the tip into your log, records `derived from`, and notifies the original author (unless they quiet those notices). You land on **Amend** so you can write the take immediately.

You cannot skip the intent. The graph depends on it.

## Read a take

A forked object shows its intent, a link to the parent, and the SHA it forked from.

**Diverge** (only on forks) diffs your take against:

- **parent now** — the parent’s current tip
- **at fork** — the parent as it was when you branched

**Takes** on the parent lists other forks, each with its intent.

## Open a pull request from a fork

If you own the fork, **Open pull request** proposes merging it into the parent. The title defaults to your subject; the body defaults to your intent note.

You land on `/pulls/{id}`. The page shows the diff, review requests, and discussion.

## Propose a paragraph

If the object is not yours, **Propose a change**. Pick the paragraph you disagree with, rewrite it, and write **why you disagree** (at least a short sentence). That opens a **paragraph** pull request.

The author sees current vs proposed, plus your rationale. They can **Accept paragraph**, **Reject** (optional note), or comment.

If the paragraph on main has moved since you proposed, the site will not apply a stale patch. That is an idea conflict, not a silent miss.

## Reviews

On an open PR, the author or someone who can push the target can **Request review** from an `@handle`.

If you were asked, you can **Approve** or **Request changes**.

Merge is blocked while:

- the PR is still a **draft** (this happens when the source already had pending reviewers)
- any requested reviewer has not approved

No reviewers means a non-draft PR can merge.

## Merge, close, conflict

**Merge** (or **Accept paragraph**) is available to the target’s owner or anyone who can push that object.

**Close** / **Reject** is available to the PR author or those same people.

If two claims cannot be merged silently, the PR status becomes **conflict**. Markers appear in the prose:

```
<<<<<<< yours (@owner — current main)
…
=======
incoming from @you
>>>>>>>
```

Edit that into one piece of writing and **Commit resolution**. Do not leave the markers in.

A successful merge is a new commit on the target. The PR shows the merged SHA.

## Site-wide pulls

**pulls** in the header lists every proposed merge — open and closed — with status, author, and `source → target`.

## Tips

- Pick the intent before you write. It is the first thing other people read on the graph.
- Fork to take the whole object somewhere. Propose a paragraph when one block is the disagreement.
- Say why in the rationale. Accept/reject is much easier when the argument is on the PR.
- If you want formal eyes before merge, request a review. Empty reviewer lists are a fast path; that is a choice, not a bug.
