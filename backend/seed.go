package main

import (
	"strings"
	"time"
)

func md(s string) string {
	return strings.ReplaceAll(s, "´", "`")
}

func (s *Store) SeedIfEmpty() error {
	s.mu.RLock()
	empty := len(s.users) == 0
	s.mu.RUnlock()
	if !empty {
		return nil
	}

	ada, err := s.CreateUser("ada", "Ada Lovelace", "ada@gitpo.st", "Notes on analytical engines, rebase disasters, and clean history.", "demo")
	if err != nil {
		return err
	}
	linus, err := s.CreateUser("linus", "Linus T.", "linus@gitpo.st", "I merge things. Sometimes I write about why.", "demo")
	if err != nil {
		return err
	}
	maya, err := s.CreateUser("maya", "Maya Chen", "maya@gitpo.st", "SRE. I collect commit messages the way other people collect vinyl.", "demo")
	if err != nil {
		return err
	}
	if _, err = s.CreateUser("guest", "Guest", "guest@gitpo.st", "A visitor. Fork something.", "demo"); err != nil {
		return err
	}

	must := func(p *Post, err error) *Post {
		if err != nil {
			panic(err)
		}
		return p
	}

	t := func(days, hours int) time.Time {
		return time.Now().UTC().Add(-time.Duration(days)*24*time.Hour - time.Duration(hours)*time.Hour)
	}

	bodyForce := md(`Yesterday I rebased a week of work onto a main that had already moved, then force-pushed the branch everyone else had checked out.

The sequence, for the record:

1. ´git pull --rebase origin main´
2. resolve three conflicts by taking *theirs* in the wrong file
3. ´git push --force-with-lease´ — lease expired, I used ´--force´
4. Slack went quiet for twelve minutes

Recovery that actually worked:

- found the pre-push tip with ´git reflog´
- ´git branch rescue HEAD@{4}´
- opened a PR from ´rescue´ back to main
- wrote a post-mortem instead of another apology thread

The rule I am keeping: force-with-lease only, and never on a branch another human has pulled. History is a social contract, not a local aesthetic.`)

	p1 := must(s.CreatePost(ada, "I force-pushed to main and lived to tell the tale",
		bodyForce, "", nil, t(6, 2)))

	_, _ = s.AmendPost(p1.ID, ada, "I force-pushed to main and lived to tell the tale",
		bodyForce+md(`

**Addendum.** Two people had already based feature work on the rewritten tip. Cherry-picking their commits onto ´rescue´ was faster than asking them to rebase. That is the whole argument for treating writing — and history — as mergeable objects.`), nil)

	_, _ = s.AmendPost(p1.ID, ada, "I force-pushed to main and lived to tell the tale",
		bodyForce+md(`

**Addendum.** Two people had already based feature work on the rewritten tip. Cherry-picking their commits onto ´rescue´ was faster than asking them to rebase. That is the whole argument for treating writing — and history — as mergeable objects.

**What I would tell a junior.** Reflog is not advanced. It is the undo stack. Learn ´HEAD@{n}´ before you learn rebase flags.`), nil)

	must(s.CreatePost(maya, "A good commit subject is a letter to future you",
		md(`Fifty characters. Present tense. No trailing period. The body explains *why*.

Bad:

    fixed stuff
    WIP
    addressing comments
    updates

Better:

    Reject stale session tokens after password change

    Tokens issued before the password-change event stayed valid for
    the remainder of their TTL. An attacker with a stolen cookie
    survived a reset. We now bind token iat to password_updated_at.

The subject is the ´git log --oneline´ you will search at 2 a.m. If it does not survive that, it is not done.

I keep a private branch of *only* commit messages I wish I had written. This post is the public version of that branch.`),
		"", nil, t(4, 8)))

	story := &Story{
		URL:       "https://github.com/git/git/commit/e83c5163316f89bfbde7d9ab23ca2e25604af290",
		Provider:  "github",
		Repo:      "git/git",
		SHA:       "e83c5163316f89bfbde7d9ab23ca2e25604af290",
		Message:   "Initial revision of \"git\", the information manager from hell",
		Author:    "Linus Torvalds",
		Date:      "2005-04-07T22:13:13Z",
		HTMLURL:   "https://github.com/git/git/commit/e83c5163316f89bfbde7d9ab23ca2e25604af290",
		Additions: 1200,
		Deletions: 0,
		Snippet: `diff --git a/README b/README
--- /dev/null
+++ b/README
@@ -0,0 +1,22 @@
+GIT - the stupid content tracker
+
+"git" can mean anything, depending on your mood.
+ - random three-letter combination that is pronounceable, and not
+   actually used by any common UNIX command.  The fact that it is a
+   mispronunciation of "get" may or may not be relevant.
+ - stupid. contemptible and despicable. simple. Take your pick from the
+   dictionary of slang.
+ - "global information tracker": you're in a good mood, and it actually
+   works for you. Angels sing, and a light suddenly fills the room.
+ - "goddamn idiotic truckload of sh*t": when it breaks`,
	}
	must(s.CreatePost(linus, "The first Git commit still reads like a dare",
		md(`I keep coming back to the initial revision — not for nostalgia, for tone.

It is a content tracker that refuses to pretend it is a product. The README is a mood ring. The code is small enough to hold in your head. The commit subject does not market anything.

Story mode on this post embeds that commit so you can read the original message next to this note. That is the whole idea of gitpo.st: a narrative wrapped around a real object, with the object still addressable by SHA.

If you fork this, keep the embed. Rewrite the essay. Open a PR. That is how writing should work.`),
		story.URL, story, t(8, 3)))

	must(s.CreatePost(ada, "The six aliases I actually type every day",
		md(`Not a museum. The ones that stayed after a year:

    [alias]
      st   = status -sb
      lg   = log --oneline --decorate --graph --all -n 30
      ds   = diff --stat
      last = log -1 --stat
      undo = reset --soft HEAD~1
      please = push --force-with-lease

Rules that come with them:

- ´undo´ is soft on purpose. I want the hunks back in the index.
- ´please´ is named so I hesitate. Hesitation is a feature.
- ´lg´ is capped at 30. Infinite graphs are how afternoons disappear.

If you have a better ´lg´, fork this post and send a PR. I will merge the ones I adopt.`),
		"", nil, t(3, 1)))

	p5 := must(s.CreatePost(maya, "How the session cookie stopped being a footgun",
		md(`v1 stored the raw user id in a signed cookie. Fine until we needed logout-everywhere.

v2 added a ´token_version´ on the user row. Every password change incremented it. Cookies carried the version. Mismatch meant unauthenticated.

That was the whole patch. Forty lines. The interesting part was the rollout: we accepted both shapes for a week, then rejected the old one, then deleted the parser.

This post will grow as I add the actual diffs from the private repo (redacted). Treat it as a living changelog, not an essay.`),
		"", nil, t(7, 10)))
	_, _ = s.AmendPost(p5.ID, maya, "How the session cookie stopped being a footgun",
		md(`v1 stored the raw user id in a signed cookie. Fine until we needed logout-everywhere.

v2 added a ´token_version´ on the user row. Every password change incremented it. Cookies carried the version. Mismatch meant unauthenticated.

That was the whole patch. Forty lines. The interesting part was the rollout: we accepted both shapes for a week, then rejected the old one, then deleted the parser.

**v3 (today).** Tokens are now opaque random ids in a server-side table. Cookie holds only the id. Revocation is a row delete. Versioning was a halfway house — simpler than I wanted to admit at the time.

Treat this post as a living changelog. New commits, same object.`), nil)

	must(s.CreatePost(linus, "main is a promise, not a workspace",
		md(`A branch is a conversation. ´main´ is the thing you can merge without asking who is in the room.

I do not care if you use git-flow, trunk-based, or a single long-lived ´develop´. I care that the name you put on the default branch means *this will not disappear in a rebase*.

On gitpo.st the same rule applies to posts. The default branch of a post is the published text. Alternative takes live on named branches. Pull requests are how you propose a better paragraph. Cherry-pick is how you steal one.

If that feels like overkill for writing, you have never tried to edit a shared design doc in a Google Doc at the same time as six other people.`),
		"", nil, t(2, 14)))

	must(s.CreatePost(ada, "Cherry-pick is the most honest verb in Git",
		`Merge says *take all of it*. Rebase says *pretend I was here first*. Cherry-pick says *this one idea, in my tree, with its original author still attached*.

That is how I want to read, too. Not entire blogs. One paragraph that should survive in my own notes, attributed, replayable.

The cherry-pick button on a post is not a gimmick. It is the same object model.`,
		"", nil, t(1, 3)))

	must(s.CreatePost(maya, "Star is a bookmark. Watch is a promise.",
		`I starred 400 repositories last year and opened none of them in Q4.

Watch should mean: if this post gets a new commit, I want to know. Star should mean: I may come back. They are not the same social gesture, and we should stop treating them as two shades of like.

On this site they map to the GitHub primitives on purpose. If you watch this post, you are asking for the next amendment. I will try not to waste that.`,
		"", nil, t(0, 6)))

	forked, err := s.Fork(p1.ID, maya)
	if err != nil {
		return err
	}
	_, err = s.AmendPost(forked.ID, maya, "I force-pushed to main and lived to tell the tale",
		bodyForce+md(`

**Addendum.** Two people had already based feature work on the rewritten tip. Cherry-picking their commits onto ´rescue´ was faster than asking them to rebase. That is the whole argument for treating writing — and history — as mergeable objects.

**What I would tell a junior.** Reflog is not advanced. It is the undo stack. Learn ´HEAD@{n}´ before you learn rebase flags.

**Maya's edit.** Add this to the recovery list: message the people who had the old tip *before* you push the rescue branch. Reflog saves objects. It does not save trust.`), nil)
	if err != nil {
		return err
	}
	if _, err = s.OpenPR(maya, "Add a note about telling people before you rescue",
		"Small amendment to the recovery section. The reflog steps are right; the social step was missing.",
		forked.ID, p1.ID); err != nil {
		return err
	}

	_, _ = s.ToggleStar(p1.ID, "maya")
	_, _ = s.ToggleStar(p1.ID, "linus")
	_, _ = s.ToggleStar(p1.ID, "guest")
	_, _ = s.ToggleWatch(p1.ID, "maya")
	_, _ = s.ToggleStar(p5.ID, "ada")
	_, _ = s.ToggleStar(p5.ID, "linus")

	return nil
}
