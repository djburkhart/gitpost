# History and diffs

Edits are new commits. The previous SHA stays addressable forever.

## Amend

If you can push (you own the object, or you are an accepted co-author on an unprotected main), the object page has **Amend**.

That opens **New commit on this object**. Change the subject, body, or remotes. Optionally keep **Signed-off-by** (on by default). Accepted co-authors are added as `Co-authored-by` trailers on the new commit.

**Commit amendment** writes the revision and returns you to the live tip. The old SHA is still in **History**.

If **main is protected**, only the author and maintainers can amend. Everyone else works through a pull request.

## History

The **History** tab lists every commit: subject, author, time, short SHA.

From a row you can:

- open the **permalink** (`/p/{id}/o/{sha}`) — a sealed revision
- **view blob** — read that version on the same page
- **revert** (if you can push, and it is not already the tip)
- **mark cherry-pick** — then **Cherry-pick {sha}** appears in the action row

A banner on a historical view tells you that you are looking at a sealed object. **Return to the live tip** when you want the current HEAD.

The permalink page can **Copy permalink**. Share that URL when you mean *this* revision, not whatever the tip becomes next.

## Diff

The **Diff** tab compares two commits on the same object. Pick **from** and **to**. If the object has only one commit, there is nothing to compare yet.

## Blame

On **Read**, hover a paragraph. The tip shows the short SHA, author, time, and subject of the commit that last introduced that paragraph.

Paragraphs are split on blank lines. Write with that in mind if you want blame — and paragraph PRs — to land cleanly.

## Revert

Revert writes a **new** commit that undoes an older one. You must give a reason. Signed-off-by is optional and on by default.

The original commit stays in the log. History is not rewritten.

## Verified history

Each object shows **verified history** when the first-parent line is intact — no force-push equivalent. If the line is broken, the badge reads **history rewritten**.

## Tips

- Link a permalink when you cite a claim. Tips move.
- Prefer revert over “fixing” a SHA in place. The product will not let you rewrite anyway.
- Use diff before you open a pull request, so you know what you are proposing.
