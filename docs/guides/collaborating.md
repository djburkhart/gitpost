# Collaborating

Comments stay off the main line. Credit, review, and branches are how work becomes part of the object.

## Discuss

The **Discuss** tab is a thread on the object. Sign in to comment or reply. Markdown renders.

The owner can **Branch this thread**. That promotes the discussion into a named git branch on the object. The comment shows the branch name. Use this when a side conversation should become real work, not when you only need a reply.

## Co-authors

On **Collab**, the owner (or anyone who can push) can invite an `@handle`. The invitee sees a banner: **Accept Co-authored-by**.

Accepted co-authors:

- appear on the object
- are attached as `Co-authored-by` trailers on new commits
- can commit directly **unless main is protected**

The owner or the co-author can remove that credit.

## Protected main

**Protect main** means only the author and listed **maintainers** can push to the canonical tip. Everyone else works via pull request.

Unprotected, accepted co-authors can amend directly.

Only the owner can protect or unprotect, and only the owner adds maintainers.

## Reviews on the object

Still on **Collab**, you can request a review of the draft itself (not only of a PR). The reviewer **Approves** or **Requests changes**. The same pattern exists on pull requests — see [Forks and pull requests](forks-and-prs.md).

## Branches

The **Branches** tab lists git branches on the object. If you can push, you can create one (`alternative-take`) and **check out** a non-head branch. Checkout moves the object’s default branch.

Discussion branches created from **Discuss** show up here too.

## Cherry-pick

Two shapes:

**A whole commit.** In **History**, mark a commit, then **Cherry-pick {sha}**. That applies the commit onto the current tip. You need push access. If that commit is already in the history, or it conflicts, the action fails instead of rewriting.

**A sentence or excerpt.** On **Read**, select 8 to 8000 characters in the body. A sheet offers **Lift this into your tree**. Attribution is baked in (`@owner` and the source SHA). Choose **New object** or one of your existing objects as the destination.

Cherry-picks write **derived from** and notify the source author (unless they quiet those notices).

## Idea ↔ code

If you can push, **Link issue / PR** attaches a GitHub or GitLab issue, pull request, or commit. The writing stays on gitpo.st; the work continues in the repo.

Story commits already carry a bridge from the code object you pasted. You can **unlink** a bridge later.

## Tips

- Invite a co-author when the credit should be structural, not a mention in the body.
- Protect main once a thread has readers you do not want surprised by a direct amend.
- Cherry-pick the sentence that landed. Fork when you need a whole new take.
- Branch a discussion only when you are ready to treat it as a line of work.
