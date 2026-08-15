export type SeedPost = {
  owner: string;
  subject: string;
  body: string;
  daysAgo?: number;
  hoursAgo?: number;
  story?: Record<string, unknown> | null;
  edits?: string[];
};

export const DEMO_USERS = [
  {
    handle: "ada",
    name: "Ada Lovelace",
    email: "ada@gitpo.st",
    bio: "Notes on analytical engines, rebase disasters, and clean history.",
    password: "demo",
  },
  {
    handle: "linus",
    name: "Linus T.",
    email: "linus@gitpo.st",
    bio: "I merge things. Sometimes I write about why.",
    password: "demo",
  },
  {
    handle: "maya",
    name: "Maya Chen",
    email: "maya@gitpo.st",
    bio: "SRE. I collect commit messages the way other people collect vinyl.",
    password: "demo",
  },
  {
    handle: "guest",
    name: "Guest",
    email: "guest@gitpo.st",
    bio: "A visitor. Fork something.",
    password: "demo",
  },
];

const FORCE = `Yesterday I rebased a week of work onto a main that had already moved, then force-pushed the branch everyone else had checked out.

The sequence, for the record:

1. \`git pull --rebase origin main\`
2. resolve three conflicts by taking *theirs* in the wrong file
3. \`git push --force-with-lease\` — lease expired, I used \`--force\`
4. Slack went quiet for twelve minutes

Recovery that actually worked:

- found the pre-push tip with \`git reflog\`
- \`git branch rescue HEAD@{4}\`
- opened a PR from \`rescue\` back to main
- wrote a post-mortem instead of another apology thread

The rule I am keeping: force-with-lease only, and never on a branch another human has pulled. History is a social contract, not a local aesthetic.`;

export const SEED_POSTS: SeedPost[] = [
  {
    owner: "ada",
    subject: "I force-pushed to main and lived to tell the tale",
    body: FORCE,
    daysAgo: 6,
    hoursAgo: 2,
    edits: [
      FORCE +
        `\n\n**Addendum.** Two people had already based feature work on the rewritten tip. Cherry-picking their commits onto \`rescue\` was faster than asking them to rebase. That is the whole argument for treating writing — and history — as mergeable objects.`,
      FORCE +
        `\n\n**Addendum.** Two people had already based feature work on the rewritten tip. Cherry-picking their commits onto \`rescue\` was faster than asking them to rebase. That is the whole argument for treating writing — and history — as mergeable objects.\n\n**What I would tell a junior.** Reflog is not advanced. It is the undo stack. Learn \`HEAD@{n}\` before you learn rebase flags.`,
    ],
  },
  {
    owner: "maya",
    subject: "A good commit subject is a letter to future you",
    daysAgo: 4,
    hoursAgo: 8,
    body: `Fifty characters. Present tense. No trailing period. The body explains *why*.

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

The subject is the \`git log --oneline\` you will search at 2 a.m. If it does not survive that, it is not done.

I keep a private branch of *only* commit messages I wish I had written. This post is the public version of that branch.`,
  },
  {
    owner: "linus",
    subject: "The first Git commit still reads like a dare",
    daysAgo: 8,
    hoursAgo: 3,
    story: {
      url: "https://github.com/git/git/commit/e83c5163316f89bfbde7d9ab23ca2e25604af290",
      provider: "github",
      repo: "git/git",
      sha: "e83c5163316f89bfbde7d9ab23ca2e25604af290",
      message: 'Initial revision of "git", the information manager from hell',
      author: "Linus Torvalds",
      date: "2005-04-07T22:13:13Z",
      htmlUrl: "https://github.com/git/git/commit/e83c5163316f89bfbde7d9ab23ca2e25604af290",
      additions: 1200,
      deletions: 0,
      snippet: `diff --git a/README b/README
--- /dev/null
+++ b/README
@@ -0,0 +1,12 @@
+GIT - the stupid content tracker
+
+"git" can mean anything, depending on your mood.
+ - random three-letter combination that is pronounceable
+ - stupid. contemptible and despicable. simple.
+ - "global information tracker": you're in a good mood
+ - "goddamn idiotic truckload of sh*t": when it breaks`,
    },
    body: `I keep coming back to the initial revision — not for nostalgia, for tone.

It is a content tracker that refuses to pretend it is a product. The README is a mood ring. The code is small enough to hold in your head. The commit subject does not market anything.

Story mode on this post embeds that commit so you can read the original message next to this note. That is the whole idea of gitpo.st: a narrative wrapped around a real object, with the object still addressable by SHA.

If you fork this, keep the embed. Rewrite the essay. Open a PR. That is how writing should work.`,
  },
  {
    owner: "ada",
    subject: "The six aliases I actually type every day",
    daysAgo: 3,
    hoursAgo: 1,
    body: `Not a museum. The ones that stayed after a year:

    [alias]
      st   = status -sb
      lg   = log --oneline --decorate --graph --all -n 30
      ds   = diff --stat
      last = log -1 --stat
      undo = reset --soft HEAD~1
      please = push --force-with-lease

Rules that come with them:

- \`undo\` is soft on purpose. I want the hunks back in the index.
- \`please\` is named so I hesitate. Hesitation is a feature.
- \`lg\` is capped at 30. Infinite graphs are how afternoons disappear.

If you have a better \`lg\`, fork this post and send a PR. I will merge the ones I adopt.`,
  },
  {
    owner: "maya",
    subject: "How the session cookie stopped being a footgun",
    daysAgo: 7,
    hoursAgo: 10,
    body: `v1 stored the raw user id in a signed cookie. Fine until we needed logout-everywhere.

v2 added a \`token_version\` on the user row. Every password change incremented it. Cookies carried the version. Mismatch meant unauthenticated.

That was the whole patch. Forty lines. The interesting part was the rollout: we accepted both shapes for a week, then rejected the old one, then deleted the parser.

This post will grow as I add the actual diffs from the private repo (redacted). Treat it as a living changelog, not an essay.`,
    edits: [
      `v1 stored the raw user id in a signed cookie. Fine until we needed logout-everywhere.

v2 added a \`token_version\` on the user row. Every password change incremented it. Cookies carried the version. Mismatch meant unauthenticated.

That was the whole patch. Forty lines. The interesting part was the rollout: we accepted both shapes for a week, then rejected the old one, then deleted the parser.

**v3 (today).** Tokens are now opaque random ids in a server-side table. Cookie holds only the id. Revocation is a row delete. Versioning was a halfway house — simpler than I wanted to admit at the time.

Treat this post as a living changelog. New commits, same object.`,
    ],
  },
  {
    owner: "linus",
    subject: "main is a promise, not a workspace",
    daysAgo: 2,
    hoursAgo: 14,
    body: `A branch is a conversation. \`main\` is the thing you can merge without asking who is in the room.

I do not care if you use git-flow, trunk-based, or a single long-lived \`develop\`. I care that the name you put on the default branch means *this will not disappear in a rebase*.

On gitpo.st the same rule applies to posts. The default branch of a post is the published text. Alternative takes live on named branches. Pull requests are how you propose a better paragraph. Cherry-pick is how you steal one.

If that feels like overkill for writing, you have never tried to edit a shared design doc in a Google Doc at the same time as six other people.`,
  },
  {
    owner: "ada",
    subject: "Cherry-pick is the most honest verb in Git",
    daysAgo: 1,
    hoursAgo: 3,
    body: `Merge says *take all of it*. Rebase says *pretend I was here first*. Cherry-pick says *this one idea, in my tree, with its original author still attached*.

That is how I want to read, too. Not entire blogs. One paragraph that should survive in my own notes, attributed, replayable.

The cherry-pick button on a post is not a gimmick. It is the same object model.`,
  },
  {
    owner: "maya",
    subject: "Star is a bookmark. Watch is a promise.",
    daysAgo: 0,
    hoursAgo: 6,
    body: `I starred 400 repositories last year and opened none of them in Q4.

Watch should mean: if this post gets a new commit, I want to know. Star should mean: I may come back. They are not the same social gesture, and we should stop treating them as two shades of like.

On this site they map to the GitHub primitives on purpose. If you watch this post, you are asking for the next amendment. I will try not to waste that.`,
  },
];
