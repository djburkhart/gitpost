# Stars, watch, and remotes

Three ways to keep a thread close. They do different jobs.

## Star

**Star** bookmarks a commit you will return to. It is a toggle. The count shows on the object, in the log, and on the explore graph.

Star is not a follow, and it does not write to your inbox. It is a mark you — and other people — can see.

You must be signed in.

## Watch

**Watch** marks that you are following new commits on that thread. It is also a toggle. The button stays highlighted while you are watching.

Watch is stored on the object. It is not the same as tracking a remote, and it is not the same as starring.

## Remotes (topics)

A **remote** is a topic, written `remote:writing` or `remote:ai-safety`.

### Tag an object

When you compose or amend, add remotes in the tag field, or put `#hashtags` in the subject or body. Up to eight per object.

On the object, remotes link to explore: `/explore?q=remote:writing`. **Track remotes** follows every topic on that object at once.

### Track a remote

On **explore**, the remotes bar lists topics already in use. Click one to filter the graph. Signed in, you can also type a topic and press Enter (`git remote add …`).

Your tracked remotes show as **tracking {topic}**. Remove one with ×.

You can track up to 24 remotes.

### Fetch them on the log

The homepage is `origin / main` — the public log.

If you track remotes, a **git fetch remotes** list appears above it: recent objects that carry those topics.

## Explore

**explore** is `git log --graph --decorate --all`:

- Search by words in the subject, owner, or topics.
- Prefix `remote:` to pin a topic.
- **trending SHAs** ranks objects from the last week by forks, PRs, cherry-picks, and merges — not by raw post volume.
- The graph draws commits, forks, and merges as lanes, not a flat timeline.

## Tips

- Star the SHA you will cite. Watch the thread you expect to grow. Track the topic you want in your morning log.
- Remotes work best when writers tag as they commit. A late amend can still add them.
- Explore search is a filter on the graph, not a full-text index of every body.
