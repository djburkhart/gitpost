package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	errNotFound      = errors.New("not found")
	errUnauthorized  = errors.New("unauthorized")
	errConflict      = errors.New("conflict")
	errBadRequest    = errors.New("bad request")
	errForbidden     = errors.New("forbidden")
	errAlreadyApplied = errors.New("that commit is already in this history")
	errCherryConflict = errors.New("cherry-pick conflicted with the current tip")
	errGitFailed      = errors.New("that git action failed")
	errParagraphDrift = errors.New("that paragraph has changed since this proposal")
)

var forkIntentLabels = map[string]string{
	"counter-argument": "Counter-argument",
	"extension":        "Extension",
	"translation":      "Translation",
	"simplification":   "Simplification",
	"implementation":   "Implementation",
}

func normalizeIntent(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, " ", "-")
	s = strings.ReplaceAll(s, "_", "-")
	if s == "counterargument" {
		s = "counter-argument"
	}
	if _, ok := forkIntentLabels[s]; !ok {
		return "", errBadRequest
	}
	return s, nil
}

func splitParagraphs(body string) []string {
	body = strings.ReplaceAll(body, "\r\n", "\n")
	body = strings.TrimSpace(body)
	if body == "" {
		return nil
	}
	raw := strings.Split(body, "\n\n")
	out := make([]string, 0, len(raw))
	for _, p := range raw {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func joinParagraphs(paras []string) string {
	return strings.Join(paras, "\n\n")
}

func applyParagraph(body string, index int, original, proposed string) (string, error) {
	original = strings.TrimSpace(original)
	proposed = strings.TrimSpace(proposed)
	if proposed == "" {
		return "", errBadRequest
	}
	paras := splitParagraphs(body)
	for i, p := range paras {
		if p == original {
			paras[i] = proposed
			return joinParagraphs(paras), nil
		}
	}
	if index >= 0 && index < len(paras) {
		return "", errParagraphDrift
	}
	return "", errNotFound
}

type User struct {
	ID           string     `json:"id"`
	Handle       string     `json:"handle"`
	Name         string     `json:"name"`
	Email        string     `json:"email"`
	Bio          string     `json:"bio"`
	PasswordHash string     `json:"-"`
	PassStored   string     `json:"passwordHash"`
	Role         string     `json:"role"`
	Disabled     bool       `json:"disabled"`
	FailedLogins int        `json:"failedLogins"`
	LockedUntil  *time.Time `json:"lockedUntil,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	QuietDerived bool       `json:"quietDerived,omitempty"`
}

type Post struct {
	ID            string    `json:"id"`
	Owner         string    `json:"owner"`
	HeadSHA       string    `json:"headSha"`
	ShortSHA      string    `json:"shortSha"`
	Subject       string    `json:"subject"`
	Slug          string    `json:"slug"`
	Body          string    `json:"body,omitempty"`
	ParentPostID  string    `json:"parentPostId,omitempty"`
	ForkedFromSHA string    `json:"forkedFromSha,omitempty"`
	ForkIntent    string    `json:"forkIntent,omitempty"`
	ForkIntentNote string   `json:"forkIntentNote,omitempty"`
	StoryURL      string    `json:"storyUrl,omitempty"`
	Story         *Story    `json:"story,omitempty"`
	Kind          string    `json:"kind,omitempty"`
	Bridges       []Bridge  `json:"bridges,omitempty"`
	Stars         []string  `json:"stars"`
	Watchers      []string  `json:"watchers"`
	DefaultBranch string    `json:"defaultBranch"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
	CommitCount   int       `json:"commitCount"`
	ForkCount     int       `json:"forkCount"`
	Topics        []string  `json:"topics,omitempty"`
	CoAuthors       []string         `json:"coAuthors,omitempty"`
	CoAuthorInvites []string         `json:"coAuthorInvites,omitempty"`
	Maintainers     []string         `json:"maintainers,omitempty"`
	Protected       bool             `json:"protected"`
	Reviewers       []ReviewRequest  `json:"reviewers,omitempty"`
	Verified        bool             `json:"verified"`
	Genesis         string           `json:"genesis,omitempty"`
	DerivedFrom     []Attribution    `json:"derivedFrom,omitempty"`
}

type Story struct {
	URL       string      `json:"url"`
	Provider  string      `json:"provider"`
	Repo      string      `json:"repo"`
	SHA       string      `json:"sha"`
	Message   string      `json:"message"`
	Author    string      `json:"author"`
	Date      string      `json:"date"`
	HTMLURL   string      `json:"htmlUrl"`
	Additions int         `json:"additions"`
	Deletions int         `json:"deletions"`
	Snippet   string      `json:"snippet"`
	Kind      string      `json:"kind,omitempty"`
	Number    string      `json:"number,omitempty"`
	Title     string      `json:"title,omitempty"`
	State     string      `json:"state,omitempty"`
	Files     []StoryFile `json:"files,omitempty"`
}

type StoryFile struct {
	Filename  string `json:"filename"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

type Bridge struct {
	URL       string    `json:"url"`
	Provider  string    `json:"provider"`
	Repo      string    `json:"repo,omitempty"`
	Kind      string    `json:"kind"`
	Number    string    `json:"number,omitempty"`
	Title     string    `json:"title,omitempty"`
	State     string    `json:"state,omitempty"`
	SHA       string    `json:"sha,omitempty"`
	HTMLURL   string    `json:"htmlUrl,omitempty"`
	Direction string    `json:"direction,omitempty"`
	CreatedBy string    `json:"createdBy,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type RepoWatch struct {
	ID        string    `json:"id"`
	Handle    string    `json:"handle"`
	Repo      string    `json:"repo"`
	Provider  string    `json:"provider"`
	LastTag   string    `json:"lastTag,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type ReleaseHint struct {
	ID          string    `json:"id"`
	Handle      string    `json:"handle"`
	Repo        string    `json:"repo"`
	Tag         string    `json:"tag"`
	Name        string    `json:"name"`
	Body        string    `json:"body"`
	HTMLURL     string    `json:"htmlUrl"`
	PublishedAt string    `json:"publishedAt,omitempty"`
	Dismissed   bool      `json:"dismissed"`
	DraftID     string    `json:"draftId,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}

type CommitInfo struct {
	SHA       string    `json:"sha"`
	ShortSHA  string    `json:"shortSha"`
	Subject   string    `json:"subject"`
	Body      string    `json:"body,omitempty"`
	Author    string    `json:"author"`
	Email     string    `json:"email"`
	Date      time.Time `json:"date"`
	Parents   []string  `json:"parents"`
	Trailers  []string  `json:"trailers,omitempty"`
}

type PullRequest struct {
	ID           string     `json:"id"`
	Number       int        `json:"number"`
	Title        string     `json:"title"`
	Body         string     `json:"body"`
	Author       string     `json:"author"`
	TargetPostID string     `json:"targetPostId"`
	SourcePostID string     `json:"sourcePostId"`
	SourceSHA    string     `json:"sourceSha"`
	TargetSHA    string     `json:"targetSha"`
	Status       string     `json:"status"`
	MergedSHA    string     `json:"mergedSha,omitempty"`
	Kind         string     `json:"kind,omitempty"`
	ParagraphIndex int      `json:"paragraphIndex,omitempty"`
	Original     string     `json:"original,omitempty"`
	Proposed     string     `json:"proposed,omitempty"`
	Rationale    string     `json:"rationale,omitempty"`
	ReviewNote   string     `json:"reviewNote,omitempty"`
	Comments     []PRComment `json:"comments,omitempty"`
	Reviewers    []ReviewRequest `json:"reviewers,omitempty"`
	Draft        bool       `json:"draft,omitempty"`
	ConflictBody string     `json:"conflictBody,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

type PRComment struct {
	Author    string    `json:"author"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
}

type BranchInfo struct {
	Name   string `json:"name"`
	SHA    string `json:"sha"`
	Head   bool   `json:"head"`
	Author string `json:"author,omitempty"`
}

type Session struct {
	Token     string    `json:"token"`
	UserID    string    `json:"userId"`
	UserAgent string    `json:"userAgent,omitempty"`
	IP        string    `json:"ip,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type persisted struct {
	Users    []User        `json:"users"`
	Posts    []Post        `json:"posts"`
	PRs      []PullRequest `json:"prs"`
	Sessions []Session     `json:"sessions"`
	Invites  []Invite      `json:"invites"`
	Audits   []AuditEvent  `json:"audits"`
	Settings Settings      `json:"settings"`
	PRSeq    int           `json:"prSeq"`
	Events   []Activity     `json:"events"`
	Remotes  []RemoteFollow `json:"remotes"`
	Comments []PostComment  `json:"comments"`
	Drafts   []Draft        `json:"drafts"`
	Notices  []Notice       `json:"notices"`
	Watches  []RepoWatch    `json:"watches"`
	Hints    []ReleaseHint  `json:"hints"`
}

type Store struct {
	mu       sync.RWMutex
	root     string
	secret   []byte
	users    map[string]*User
	byHandle map[string]*User
	posts    map[string]*Post
	prs      map[string]*PullRequest
	sessions map[string]*Session
	invites  map[string]*Invite
	audits   []AuditEvent
	settings Settings
	prSeq    int
	events   []Activity
	remotes  map[string][]string
	comments []PostComment
	drafts   map[string]*Draft
	notices  []Notice
	watches  []RepoWatch
	hints    []ReleaseHint
}

func NewStore(root string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(root, "repos"), 0o755); err != nil {
		return nil, err
	}
	s := &Store{
		root:     root,
		secret:   []byte(idHex(24)),
		users:    map[string]*User{},
		byHandle: map[string]*User{},
		posts:    map[string]*Post{},
		prs:      map[string]*PullRequest{},
		sessions: map[string]*Session{},
		invites:  map[string]*Invite{},
		remotes:  map[string][]string{},
		drafts:   map[string]*Draft{},
		settings: Settings{SignupMode: SignupInvite, MinPassword: 12},
	}
	_ = s.load()
	return s, nil
}

func (s *Store) path() string { return filepath.Join(s.root, "state.json") }
func (s *Store) repoDir(id string) string {
	return filepath.Join(s.root, "repos", id)
}

func (s *Store) load() error {
	b, err := os.ReadFile(s.path())
	if err != nil {
		return err
	}
	var p persisted
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	for i := range p.Users {
		u := p.Users[i]
		u.PasswordHash = u.PassStored
		cp := u
		s.users[u.ID] = &cp
		s.byHandle[strings.ToLower(u.Handle)] = &cp
	}
	for i := range p.Posts {
		cp := p.Posts[i]
		s.posts[cp.ID] = &cp
	}
	for i := range p.PRs {
		cp := p.PRs[i]
		s.prs[cp.ID] = &cp
	}
	for i := range p.Sessions {
		cp := p.Sessions[i]
		if cp.ExpiresAt.After(time.Now()) {
			s.sessions[cp.Token] = &cp
		}
	}
	s.prSeq = p.PRSeq
	s.settings = p.Settings
	if s.settings.SignupMode == "" {
		s.settings.SignupMode = SignupInvite
	}
	if s.settings.MinPassword < 12 {
		s.settings.MinPassword = 12
	}
	s.audits = p.Audits
	s.invites = map[string]*Invite{}
	for i := range p.Invites {
		cp := p.Invites[i]
		s.invites[cp.Code] = &cp
	}
	s.events = p.Events
	s.remotes = map[string][]string{}
	for _, r := range p.Remotes {
		s.remotes[r.Handle] = append(s.remotes[r.Handle], r.Topic)
	}
	s.comments = p.Comments
	s.notices = p.Notices
	s.watches = p.Watches
	s.hints = p.Hints
	s.drafts = map[string]*Draft{}
	for i := range p.Drafts {
		cp := p.Drafts[i]
		s.drafts[cp.ID] = &cp
	}
	return nil
}

func (s *Store) save() error {
	p := persisted{PRSeq: s.prSeq}
	for _, u := range s.users {
		uu := *u
		uu.PassStored = u.PasswordHash
		p.Users = append(p.Users, uu)
	}
	for _, post := range s.posts {
		p.Posts = append(p.Posts, *post)
	}
	for _, pr := range s.prs {
		p.PRs = append(p.PRs, *pr)
	}
	for _, sess := range s.sessions {
		p.Sessions = append(p.Sessions, *sess)
	}
	for _, inv := range s.invites {
		p.Invites = append(p.Invites, *inv)
	}
	p.Audits = s.audits
	p.Settings = s.settings
	p.Events = s.events
	p.Comments = s.comments
	p.Notices = s.notices
	p.Watches = s.watches
	p.Hints = s.hints
	for _, d := range s.drafts {
		p.Drafts = append(p.Drafts, *d)
	}
	for handle, topics := range s.remotes {
		for _, t := range topics {
			p.Remotes = append(p.Remotes, RemoteFollow{Handle: handle, Topic: t})
		}
	}
	b, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path())
}

func idHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	dash := false
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			dash = false
		} else if !dash {
			b.WriteByte('-')
			dash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > 48 {
		out = out[:48]
	}
	if out == "" {
		out = "post"
	}
	return out
}

func shortSHA(sha string) string {
	if len(sha) >= 7 {
		return sha[:7]
	}
	return sha
}

func (s *Store) git(repo string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", repo}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("git %s: %s (%w)", strings.Join(args, " "), strings.TrimSpace(string(out)), err)
	}
	return string(out), nil
}

func (s *Store) gitEnv(repo string, env []string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", repo}, args...)...)
	cmd.Env = append(os.Environ(), env...)
	cmd.Env = append(cmd.Env, "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("git %s: %s (%w)", strings.Join(args, " "), strings.TrimSpace(string(out)), err)
	}
	return string(out), nil
}

func friendlyGitErr(err error) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "previous cherry-pick is now empty"),
		strings.Contains(msg, "nothing to commit"),
		strings.Contains(msg, "working tree clean"):
		return errAlreadyApplied
	case strings.Contains(msg, "conflict"):
		return errCherryConflict
	default:
		return errGitFailed
	}
}

func writePostFile(repo, subject, body string, story *Story) error {
	var b strings.Builder
	b.WriteString("# ")
	b.WriteString(subject)
	b.WriteString("\n\n")
	b.WriteString(strings.TrimSpace(body))
	b.WriteString("\n")
	if story != nil && story.URL != "" {
		enc, _ := json.MarshalIndent(story, "", "  ")
		b.WriteString("\n---\nstory.json\n")
		b.Write(enc)
		b.WriteString("\n")
	}
	return os.WriteFile(filepath.Join(repo, "POST.md"), []byte(b.String()), 0o644)
}

func parsePostFile(raw string) (subject, body string, story *Story) {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	if i := strings.Index(raw, "\n---\nstory.json\n"); i >= 0 {
		js := strings.TrimSpace(raw[i+len("\n---\nstory.json\n"):])
		raw = raw[:i]
		var st Story
		if json.Unmarshal([]byte(js), &st) == nil {
			story = &st
		}
	}
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "# ") {
		nl := strings.IndexByte(raw, '\n')
		if nl < 0 {
			return strings.TrimSpace(raw[2:]), "", story
		}
		return strings.TrimSpace(raw[2:nl]), strings.TrimSpace(raw[nl+1:]), story
	}
	return "", raw, story
}

func (s *Store) commit(repo, name, email, subject string, when time.Time, extra ...string) (string, error) {
	if _, err := s.git(repo, "add", "POST.md"); err != nil {
		return "", err
	}
	env := []string{
		"GIT_AUTHOR_NAME=" + name,
		"GIT_AUTHOR_EMAIL=" + email,
		"GIT_COMMITTER_NAME=" + name,
		"GIT_COMMITTER_EMAIL=" + email,
	}
	if !when.IsZero() {
		ts := when.Format(time.RFC3339)
		env = append(env, "GIT_AUTHOR_DATE="+ts, "GIT_COMMITTER_DATE="+ts)
	}
	args := []string{"commit", "--allow-empty", "-m", subject}
	if len(extra) > 0 && strings.TrimSpace(extra[0]) != "" {
		args = append(args, "-m", extra[0])
	}
	if _, err := s.gitEnv(repo, env, args...); err != nil {
		return "", err
	}
	sha, err := s.git(repo, "rev-parse", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(sha), nil
}

func (s *Store) initRepo(id, name, email string) (string, error) {
	dir := s.repoDir(id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	if _, err := exec.Command("git", "init", "-b", "main", dir).CombinedOutput(); err != nil {
		return "", err
	}
	_, _ = s.git(dir, "config", "user.name", name)
	_, _ = s.git(dir, "config", "user.email", email)
	_, _ = s.git(dir, "config", "core.logAllRefUpdates", "true")
	_, _ = s.git(dir, "config", "receive.denyNonFastForwards", "true")
	return dir, nil
}

func (s *Store) headSHA(id string) string {
	out, err := s.git(s.repoDir(id), "rev-parse", "HEAD")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

func (s *Store) commitCount(id string) int {
	out, err := s.git(s.repoDir(id), "rev-list", "--count", "HEAD")
	if err != nil {
		return 0
	}
	var n int
	fmt.Sscanf(strings.TrimSpace(out), "%d", &n)
	return n
}

func (s *Store) readBlob(id, sha string) (string, error) {
	spec := "HEAD:POST.md"
	if sha != "" {
		spec = sha + ":POST.md"
	}
	out, err := s.git(s.repoDir(id), "show", spec)
	if err != nil {
		return "", errNotFound
	}
	return out, nil
}

func (s *Store) refreshPost(p *Post) {
	p.HeadSHA = s.headSHA(p.ID)
	p.ShortSHA = shortSHA(p.HeadSHA)
	p.CommitCount = s.commitCount(p.ID)
	raw, err := s.readBlob(p.ID, "")
	if err == nil {
		sub, body, story := parsePostFile(raw)
		if sub != "" {
			p.Subject = sub
		}
		p.Body = body
		if story != nil {
			p.Story = story
			p.StoryURL = story.URL
		}
	}
	forks := 0
	for _, o := range s.posts {
		if o.ParentPostID == p.ID {
			forks++
		}
	}
	p.ForkCount = forks
}

func (s *Store) CreateUser(handle, name, email, bio, password string) (*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	handle = strings.ToLower(strings.TrimSpace(handle))
	if handle == "" || password == "" {
		return nil, errBadRequest
	}
	if s.byHandle[handle] != nil {
		return nil, errConflict
	}
	if email == "" {
		email = handle + "@gitpo.st"
	}
	if name == "" {
		name = handle
	}
	u := &User{
		ID:           idHex(8),
		Handle:       handle,
		Name:         name,
		Email:        email,
		Bio:          bio,
		PasswordHash: hashPass(password),
		Role:         RoleMember,
		CreatedAt:    time.Now().UTC(),
	}
	s.users[u.ID] = u
	s.byHandle[handle] = u
	return u, s.save()
}

func (s *Store) RegisterUser(handle, name, email, bio, password, invite string) (*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	handle = strings.ToLower(strings.TrimSpace(handle))
	if handle == "" || password == "" {
		return nil, errBadRequest
	}
	if err := s.consumeInvite(invite, handle); err != nil {
		return nil, err
	}
	if s.byHandle[handle] != nil {
		return nil, errConflict
	}
	if email == "" {
		email = handle + "@gitpo.st"
	}
	if name == "" {
		name = handle
	}
	u := &User{
		ID:           idHex(8),
		Handle:       handle,
		Name:         name,
		Email:        email,
		Bio:          bio,
		PasswordHash: hashPass(password),
		Role:         RoleMember,
		CreatedAt:    time.Now().UTC(),
	}
	s.users[u.ID] = u
	s.byHandle[handle] = u
	s.auditUnlocked("system", "user.register", handle, "")
	return u, s.save()
}

func (s *Store) Authenticate(handle, password string) (*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := s.byHandle[strings.ToLower(strings.TrimSpace(handle))]
	if u == nil {
		return nil, errUnauthorized
	}
	if u.Disabled {
		return nil, errDisabled
	}
	if u.LockedUntil != nil && u.LockedUntil.After(nowUTC()) {
		return nil, errLocked
	}
	if !checkPass(u.PasswordHash, password) {
		u.FailedLogins++
		if u.FailedLogins >= lockAfter {
			t := nowUTC().Add(lockFor)
			u.LockedUntil = &t
		}
		_ = s.save()
		if u.LockedUntil != nil && u.LockedUntil.After(nowUTC()) {
			return nil, errLocked
		}
		return nil, errUnauthorized
	}
	u.FailedLogins = 0
	u.LockedUntil = nil
	_ = s.save()
	return u, nil
}

func (s *Store) CreateSession(userID, ua, ip string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tok := idHex(24)
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(tok))
	signed := tok + "." + hex.EncodeToString(mac.Sum(nil))[:16]
	now := nowUTC()
	s.sessions[signed] = &Session{
		Token:     signed,
		UserID:    userID,
		UserAgent: ua,
		IP:        ip,
		CreatedAt: now,
		ExpiresAt: now.Add(30 * 24 * time.Hour),
	}
	return signed, s.save()
}

func (s *Store) UserBySession(token string) *User {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sess := s.sessions[token]
	if sess == nil || sess.ExpiresAt.Before(time.Now()) {
		return nil
	}
	return s.users[sess.UserID]
}

func (s *Store) DeleteSession(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, token)
	_ = s.save()
}

func (s *Store) UserByHandle(handle string) *User {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.byHandle[strings.ToLower(handle)]
}

func (s *Store) UserByID(id string) *User {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.users[id]
}

func (s *Store) CreatePost(owner *User, subject, body, storyURL string, story *Story, topics []string, when time.Time) (*Post, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	subject = strings.TrimSpace(subject)
	if subject == "" {
		return nil, errBadRequest
	}
	if when.IsZero() {
		when = time.Now().UTC()
	}
	id := idHex(5)
	dir, err := s.initRepo(id, owner.Name, owner.Email)
	if err != nil {
		return nil, err
	}
	if err := writePostFile(dir, subject, body, story); err != nil {
		return nil, err
	}
	sha, err := s.commit(dir, owner.Name, owner.Email, subject, when)
	if err != nil {
		return nil, err
	}
	p := &Post{
		ID:            id,
		Owner:         owner.Handle,
		HeadSHA:       sha,
		ShortSHA:      shortSHA(sha),
		Subject:       subject,
		Slug:          slugify(subject),
		Body:          body,
		StoryURL:      storyURL,
		Story:         story,
		Stars:         []string{},
		Watchers:      []string{},
		DefaultBranch: "main",
		CreatedAt:     when,
		UpdatedAt:     when,
		CommitCount:   1,
		Topics:        extractTopics(topics, subject, body),
	}
	if story != nil && story.Kind != "" && story.Kind != "link" {
		p.Kind = "story"
		if b := storyToBridge(story, owner.Handle, "code-to-writing"); b.URL != "" {
			p.Bridges = []Bridge{b}
		}
	}
	s.posts[id] = p
	s.recordLocked("commit", id, sha, owner.Handle)
	return p, s.save()
}

func (s *Store) AmendPost(id string, editor *User, subject, body string, story *Story, topics []string, signoff bool) (*Post, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.posts[id]
	if p == nil {
		return nil, errNotFound
	}
	if err := s.writeDenied(p, editor); err != nil {
		return nil, err
	}
	subject = strings.TrimSpace(subject)
	if subject == "" {
		subject = p.Subject
	}
	dir := s.repoDir(id)
	if err := writePostFile(dir, subject, body, story); err != nil {
		return nil, err
	}
	sha, err := s.commit(dir, editor.Name, editor.Email, subject, time.Now().UTC(), s.trailerBlock(p, editor, signoff))
	if err != nil {
		return nil, err
	}
	p.Subject = subject
	p.Body = body
	p.Story = story
	if story != nil {
		p.StoryURL = story.URL
		if story.Kind != "" && story.Kind != "link" {
			p.Kind = "story"
		}
	}
	p.HeadSHA = sha
	p.ShortSHA = shortSHA(sha)
	p.Slug = slugify(subject)
	p.UpdatedAt = time.Now().UTC()
	p.CommitCount = s.commitCount(id)
	if topics != nil {
		p.Topics = extractTopics(topics, subject, body)
	} else {
		p.Topics = extractTopics(p.Topics, subject, body)
	}
	s.recordLocked("commit", id, sha, editor.Handle)
	return p, s.save()
}

func (s *Store) FindPost(ref string) *Post {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if p := s.posts[ref]; p != nil {
		cp := *p
		s.refreshPost(&cp)
		return &cp
	}
	ref = strings.ToLower(ref)
	var found *Post
	for _, p := range s.posts {
		if strings.ToLower(p.ID) == ref || strings.HasPrefix(strings.ToLower(p.HeadSHA), ref) || strings.ToLower(p.ShortSHA) == ref {
			cp := *p
			s.refreshPost(&cp)
			found = &cp
			break
		}
	}
	if found == nil && len(ref) >= 7 && isHexRef(ref) {
		for _, p := range s.posts {
			if exact, err := s.ResolveSHA(p.ID, ref); err == nil && exact != "" {
				cp := *p
				s.refreshPost(&cp)
				found = &cp
				break
			}
		}
	}
	return found
}

func isHexRef(s string) bool {
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

func (s *Store) GetPostLocked(id string) *Post {
	return s.posts[id]
}

func (s *Store) Feed() []Post {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Post, 0, len(s.posts))
	for _, p := range s.posts {
		s.refreshPost(p)
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out
}

func (s *Store) UserLog(handle string) []Post {
	all := s.Feed()
	out := []Post{}
	h := strings.ToLower(handle)
	for _, p := range all {
		if strings.ToLower(p.Owner) == h {
			out = append(out, p)
		}
	}
	return out
}

func (s *Store) History(id string) ([]CommitInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.posts[id] == nil {
		return nil, errNotFound
	}
	out, err := s.git(s.repoDir(id), "log", "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P%x1f%b%x1e")
	if err != nil {
		return nil, err
	}
	var commits []CommitInfo
	for _, rec := range strings.Split(out, "\x1e") {
		rec = strings.TrimSpace(rec)
		if rec == "" {
			continue
		}
		parts := strings.Split(rec, "\x1f")
		if len(parts) < 5 {
			continue
		}
		dt, _ := time.Parse(time.RFC3339, parts[3])
		parents := []string{}
		body := ""
		if len(parts) > 5 {
			parents = strings.Fields(parts[5])
		}
		if len(parts) > 6 {
			body = strings.TrimSpace(parts[6])
		}
		clean, trailers := parseTrailers(body)
		commits = append(commits, CommitInfo{
			SHA:      parts[0],
			ShortSHA: shortSHA(parts[0]),
			Author:   parts[1],
			Email:    parts[2],
			Date:     dt,
			Subject:  parts[4],
			Body:     clean,
			Parents:  parents,
			Trailers: trailers,
		})
	}
	return commits, nil
}

func (s *Store) Diff(id, from, to string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.posts[id] == nil {
		return "", errNotFound
	}
	if from == "" || to == "" {
		out, err := s.git(s.repoDir(id), "show", "--format=", "HEAD", "--", "POST.md")
		return out, err
	}
	out, err := s.git(s.repoDir(id), "diff", from, to, "--", "POST.md")
	return out, err
}

func (s *Store) Blob(id, sha string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.posts[id] == nil {
		return "", errNotFound
	}
	return s.readBlob(id, sha)
}

func (s *Store) ToggleStar(id, handle string) (*Post, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.posts[id]
	if p == nil {
		return nil, errNotFound
	}
	p.Stars = toggle(p.Stars, handle)
	s.refreshPost(p)
	return p, s.save()
}

func (s *Store) ToggleWatch(id, handle string) (*Post, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.posts[id]
	if p == nil {
		return nil, errNotFound
	}
	p.Watchers = toggle(p.Watchers, handle)
	s.refreshPost(p)
	return p, s.save()
}

func toggle(list []string, v string) []string {
	out := []string{}
	found := false
	for _, x := range list {
		if x == v {
			found = true
			continue
		}
		out = append(out, x)
	}
	if !found {
		out = append(out, v)
	}
	return out
}

func (s *Store) Fork(id string, user *User, intent, note string) (*Post, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	src := s.posts[id]
	if src == nil {
		return nil, errNotFound
	}
	intent, err := normalizeIntent(intent)
	if err != nil {
		return nil, err
	}
	note = strings.TrimSpace(note)
	if len(note) > 280 {
		note = note[:280]
	}
	nid := idHex(5)
	srcDir := s.repoDir(id)
	dstDir := s.repoDir(nid)
	if err := os.MkdirAll(filepath.Dir(dstDir), 0o755); err != nil {
		return nil, err
	}
	if out, err := exec.Command("git", "clone", srcDir, dstDir).CombinedOutput(); err != nil {
		return nil, fmt.Errorf("clone: %s (%w)", out, err)
	}
	_, _ = s.git(dstDir, "config", "user.name", user.Name)
	_, _ = s.git(dstDir, "config", "user.email", user.Email)
	now := time.Now().UTC()
	subject := src.Subject
	// leave content as-is; fork commit records the fork
	sha, err := s.commit(dstDir, user.Name, user.Email, "fork("+intent+"): "+subject, now)
	if err != nil {
		return nil, err
	}
	p := &Post{
		ID:             nid,
		Owner:          user.Handle,
		HeadSHA:        sha,
		ShortSHA:       shortSHA(sha),
		Subject:        subject,
		Slug:           slugify(subject),
		Body:           src.Body,
		ParentPostID:   src.ID,
		ForkedFromSHA:  src.HeadSHA,
		ForkIntent:     intent,
		ForkIntentNote: note,
		StoryURL:       src.StoryURL,
		Story:         src.Story,
		Stars:         []string{},
		Watchers:      []string{},
		DefaultBranch: "main",
		CreatedAt:     now,
		UpdatedAt:     now,
		CommitCount:   s.commitCount(nid),
		Topics:        append([]string{}, src.Topics...),
	}
	s.posts[nid] = p
	s.attachDerived(p, src, "fork", user.Handle, src.HeadSHA)
	s.notifyDerivedLocked(src, p, "fork", user.Handle, src.HeadSHA)
	s.refreshPost(src)
	s.recordLocked("fork", src.ID, src.HeadSHA, user.Handle)
	s.recordLocked("fork", nid, sha, user.Handle)
	return p, s.save()
}

func (s *Store) Branches(id string) ([]BranchInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.posts[id] == nil {
		return nil, errNotFound
	}
	out, err := s.git(s.repoDir(id), "for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/heads")
	if err != nil {
		return nil, err
	}
	head := s.headSHA(id)
	var list []BranchInfo
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) != 2 {
			continue
		}
		list = append(list, BranchInfo{
			Name: parts[0],
			SHA:  parts[1],
			Head: parts[1] == head || parts[0] == "main",
		})
	}
	return list, nil
}

func (s *Store) CreateBranch(id, name, from string, user *User) (*BranchInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.posts[id]
	if p == nil {
		return nil, errNotFound
	}
	if err := s.writeDenied(p, user); err != nil {
		return nil, err
	}
	name = slugify(name)
	if name == "" || name == "main" {
		return nil, errBadRequest
	}
	args := []string{"branch", name}
	if from != "" {
		args = []string{"branch", name, from}
	}
	if _, err := s.git(s.repoDir(id), args...); err != nil {
		return nil, err
	}
	sha, _ := s.git(s.repoDir(id), "rev-parse", name)
	return &BranchInfo{Name: name, SHA: strings.TrimSpace(sha)}, nil
}

func (s *Store) CheckoutBranch(id, name string, user *User) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.posts[id]
	if p == nil {
		return errNotFound
	}
	if err := s.writeDenied(p, user); err != nil {
		return err
	}
	if _, err := s.git(s.repoDir(id), "checkout", name); err != nil {
		return err
	}
	s.refreshPost(p)
	p.DefaultBranch = name
	p.UpdatedAt = time.Now().UTC()
	return s.save()
}

func (s *Store) CherryPick(id, sha string, user *User) (*Post, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.posts[id]
	if p == nil {
		return nil, errNotFound
	}
	if err := s.writeDenied(p, user); err != nil {
		return nil, err
	}
	dir := s.repoDir(id)
	env := []string{
		"GIT_AUTHOR_NAME=" + user.Name,
		"GIT_AUTHOR_EMAIL=" + user.Email,
		"GIT_COMMITTER_NAME=" + user.Name,
		"GIT_COMMITTER_EMAIL=" + user.Email,
	}
	if _, err := s.gitEnv(dir, env, "cherry-pick", "--allow-empty", sha); err != nil {
		_, _ = s.git(dir, "cherry-pick", "--abort")
		return nil, friendlyGitErr(err)
	}
	s.refreshPost(p)
	p.UpdatedAt = time.Now().UTC()
	s.recordLocked("cherry", p.ID, p.HeadSHA, user.Handle)
	return p, s.save()
}

func (s *Store) CherryPickFrom(targetID, sourceID, sha string, user *User) (*Post, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dst := s.posts[targetID]
	src := s.posts[sourceID]
	if dst == nil || src == nil {
		return nil, errNotFound
	}
	if err := s.writeDenied(dst, user); err != nil {
		return nil, err
	}
	// fetch source object into dest via a temporary remote
	dir := s.repoDir(targetID)
	remote := "src-" + sourceID
	_, _ = s.git(dir, "remote", "remove", remote)
	if _, err := s.git(dir, "remote", "add", remote, s.repoDir(sourceID)); err != nil {
		return nil, err
	}
	if _, err := s.git(dir, "fetch", remote); err != nil {
		return nil, err
	}
	env := []string{
		"GIT_AUTHOR_NAME=" + user.Name,
		"GIT_AUTHOR_EMAIL=" + user.Email,
		"GIT_COMMITTER_NAME=" + user.Name,
		"GIT_COMMITTER_EMAIL=" + user.Email,
	}
	if _, err := s.gitEnv(dir, env, "cherry-pick", "--allow-empty", sha); err != nil {
		_, _ = s.git(dir, "cherry-pick", "--abort")
		return nil, friendlyGitErr(err)
	}
	s.refreshPost(dst)
	dst.UpdatedAt = time.Now().UTC()
	s.attachDerived(dst, src, "cherry", user.Handle, sha)
	s.notifyDerivedLocked(src, dst, "cherry", user.Handle, sha)
	s.recordLocked("cherry", dst.ID, dst.HeadSHA, user.Handle)
	s.recordLocked("cherry", src.ID, src.HeadSHA, user.Handle)
	return dst, s.save()
}

func (s *Store) OpenPR(author *User, title, body, sourceID, targetID, kind string, paragraphIndex int, original, proposed, rationale string) (*PullRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind == "" {
		kind = "full"
	}
	if kind != "full" && kind != "paragraph" {
		return nil, errBadRequest
	}
	dst := s.posts[targetID]
	if dst == nil {
		return nil, errNotFound
	}
	var src *Post
	if sourceID != "" {
		src = s.posts[sourceID]
		if src == nil {
			return nil, errNotFound
		}
	}
	now := time.Now().UTC()
	pr := &PullRequest{
		ID:             idHex(4),
		Author:         author.Handle,
		TargetPostID:   targetID,
		Kind:           kind,
		Status:         "open",
		CreatedAt:      now,
		UpdatedAt:      now,
		Rationale:      strings.TrimSpace(rationale),
		ParagraphIndex: paragraphIndex,
		Original:       strings.TrimSpace(original),
		Proposed:       strings.TrimSpace(proposed),
	}
	if kind == "paragraph" {
		if dst.Owner == author.Handle {
			return nil, errForbidden
		}
		if pr.Original == "" || pr.Proposed == "" || pr.Rationale == "" {
			return nil, errBadRequest
		}
		paras := splitParagraphs(dst.Body)
		found := false
		for i, p := range paras {
			if p == pr.Original {
				pr.ParagraphIndex = i
				found = true
				break
			}
		}
		if !found {
			if paragraphIndex < 0 || paragraphIndex >= len(paras) {
				return nil, errBadRequest
			}
			return nil, errParagraphDrift
		}
		if title == "" {
			title = "Change paragraph " + fmt.Sprint(pr.ParagraphIndex+1)
		}
		pr.Title = title
		pr.Body = pr.Rationale
		pr.SourcePostID = dst.ID
		pr.SourceSHA = dst.HeadSHA
		pr.TargetSHA = dst.HeadSHA
	} else {
		if src == nil {
			return nil, errNotFound
		}
		if src.Owner != author.Handle {
			return nil, errForbidden
		}
		if title == "" {
			title = src.Subject
		}
		pr.Title = title
		pr.Body = body
		pr.SourcePostID = sourceID
		pr.SourceSHA = src.HeadSHA
		pr.TargetSHA = dst.HeadSHA
		if len(src.Reviewers) > 0 {
			pr.Reviewers = append([]ReviewRequest{}, src.Reviewers...)
		}
		if len(pr.Reviewers) > 0 && !reviewsReady(pr.Reviewers) {
			pr.Draft = true
		}
	}
	s.prSeq++
	pr.Number = s.prSeq
	s.prs[pr.ID] = pr
	s.recordLocked("pr", targetID, pr.TargetSHA, author.Handle)
	return pr, s.save()
}

func (s *Store) ListPRs(postID string) []PullRequest {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []PullRequest{}
	for _, pr := range s.prs {
		if postID == "" || pr.TargetPostID == postID || pr.SourcePostID == postID {
			out = append(out, *pr)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Number > out[j].Number })
	return out
}

func (s *Store) GetPR(id string) *PullRequest {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if pr := s.prs[id]; pr != nil {
		cp := *pr
		return &cp
	}
	for _, pr := range s.prs {
		if fmt.Sprintf("%d", pr.Number) == id {
			cp := *pr
			return &cp
		}
	}
	return nil
}

func (s *Store) MergePR(id string, user *User) (*PullRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	pr := s.prs[id]
	if pr == nil {
		return nil, errNotFound
	}
	dst := s.posts[pr.TargetPostID]
	if dst == nil {
		return nil, errNotFound
	}
	if err := s.writeDenied(dst, user); err != nil {
		return nil, err
	}
	if pr.Status != "open" && pr.Status != "conflict" {
		return nil, errConflict
	}
	if pr.Draft {
		return nil, errDraftPR
	}
	if !reviewsReady(pr.Reviewers) {
		return nil, errReviewsPending
	}
	if pr.Kind == "paragraph" {
		next, err := applyParagraph(dst.Body, pr.ParagraphIndex, pr.Original, pr.Proposed)
		if err != nil {
			oursLabel := "yours (@" + dst.Owner + " — current main)"
			theirsLabel := "incoming from @" + pr.Author
			block := "<<<<<<< " + oursLabel + "\n" + pr.Original + "\n=======\n" + pr.Proposed + "\n>>>>>>> " + theirsLabel
			pr.Status = "conflict"
			pr.ConflictBody = block
			pr.UpdatedAt = time.Now().UTC()
			return pr, s.save()
		}
		dir := s.repoDir(dst.ID)
		if err := writePostFile(dir, dst.Subject, next, dst.Story); err != nil {
			return nil, err
		}
		sha, err := s.commit(dir, user.Name, user.Email, "Accept paragraph from @"+pr.Author+": "+pr.Title, time.Now().UTC(), s.trailerBlock(dst, user, true))
		if err != nil {
			return nil, err
		}
		pr.MergedSHA = sha
		pr.Status = "merged"
		pr.ConflictBody = ""
		pr.UpdatedAt = time.Now().UTC()
		s.refreshPost(dst)
		dst.UpdatedAt = pr.UpdatedAt
		s.recordLocked("merge", dst.ID, sha, user.Handle)
		return pr, s.save()
	}
	src := s.posts[pr.SourcePostID]
	if src == nil {
		return nil, errNotFound
	}
	dir := s.repoDir(dst.ID)
	oursRaw, _ := s.readBlob(dst.ID, "")
	theirsBytes, rerr := os.ReadFile(filepath.Join(s.repoDir(src.ID), "POST.md"))
	if rerr != nil {
		return nil, rerr
	}
	baseRaw := ""
	if src.ForkedFromSHA != "" {
		if b, err := s.readBlob(dst.ID, src.ForkedFromSHA); err == nil {
			baseRaw = b
		}
	}
	if baseRaw == "" && pr.TargetSHA != "" {
		if b, err := s.readBlob(dst.ID, pr.TargetSHA); err == nil {
			baseRaw = b
		}
	}
	if baseRaw == "" {
		baseRaw = oursRaw
	}
	oursLabel := "yours (@" + dst.Owner + " — current main)"
	theirsLabel := "incoming from @" + pr.Author + " (PR #" + fmt.Sprint(pr.Number) + ")"
	merged, conflicted, merr := ideaMerge(baseRaw, oursRaw, string(theirsBytes), oursLabel, theirsLabel)
	if merr != nil {
		return nil, merr
	}
	if conflicted {
		pr.Status = "conflict"
		pr.ConflictBody = merged
		pr.UpdatedAt = time.Now().UTC()
		return pr, s.save()
	}
	if err := os.WriteFile(filepath.Join(dir, "POST.md"), []byte(merged), 0o644); err != nil {
		return nil, err
	}
	sha, err := s.commit(dir, user.Name, user.Email, "Merge PR #"+fmt.Sprint(pr.Number)+": "+pr.Title, time.Now().UTC(), s.trailerBlock(dst, user, true))
	if err != nil {
		return nil, err
	}
	pr.MergedSHA = sha
	pr.Status = "merged"
	pr.ConflictBody = ""
	pr.UpdatedAt = time.Now().UTC()
	s.refreshPost(dst)
	dst.UpdatedAt = pr.UpdatedAt
	s.recordLocked("merge", dst.ID, sha, user.Handle)
	return pr, s.save()
}

func (s *Store) ClosePR(id string, user *User, note string) (*PullRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	pr := s.prs[id]
	if pr == nil {
		return nil, errNotFound
	}
	dst := s.posts[pr.TargetPostID]
	if dst == nil {
		return nil, errNotFound
	}
	if dst.Owner != user.Handle && pr.Author != user.Handle {
		return nil, errForbidden
	}
	if pr.Status != "open" {
		return nil, errConflict
	}
	pr.Status = "closed"
	pr.ReviewNote = strings.TrimSpace(note)
	pr.UpdatedAt = time.Now().UTC()
	return pr, s.save()
}

func (s *Store) CommentPR(id string, user *User, body string) (*PullRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	pr := s.prs[id]
	if pr == nil {
		return nil, errNotFound
	}
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, errBadRequest
	}
	dst := s.posts[pr.TargetPostID]
	if dst == nil {
		return nil, errNotFound
	}
	if dst.Owner != user.Handle && pr.Author != user.Handle {
		return nil, errForbidden
	}
	pr.Comments = append(pr.Comments, PRComment{
		Author:    user.Handle,
		Body:      body,
		CreatedAt: time.Now().UTC(),
	})
	pr.UpdatedAt = time.Now().UTC()
	return pr, s.save()
}

func (s *Store) ListForks(id string) []Post {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.posts[id] == nil {
		return nil
	}
	out := []Post{}
	for _, p := range s.posts {
		if p.ParentPostID == id {
			cp := *p
			s.refreshPost(&cp)
			out = append(out, cp)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if len(out[i].Stars) != len(out[j].Stars) {
			return len(out[i].Stars) > len(out[j].Stars)
		}
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out
}

func (s *Store) Diverge(id, against string) (map[string]any, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	fork := s.posts[id]
	if fork == nil {
		return nil, errNotFound
	}
	if fork.ParentPostID == "" {
		return nil, errBadRequest
	}
	parent := s.posts[fork.ParentPostID]
	if parent == nil {
		return nil, errNotFound
	}
	if against == "" {
		against = "parent"
	}
	var diff string
	if against == "base" && fork.ForkedFromSHA != "" {
		out, err := s.git(s.repoDir(fork.ID), "diff", fork.ForkedFromSHA, "HEAD", "--", "POST.md")
		if err != nil {
			// parent commit may not be in fork if history was rewritten
			base, berr := s.readBlob(parent.ID, fork.ForkedFromSHA)
			head, herr := s.readBlob(fork.ID, "")
			if berr == nil && herr == nil {
				diff = noIndexDiff(base, head)
			}
		} else {
			diff = out
		}
	} else {
		against = "parent"
		parentRaw, _ := s.readBlob(parent.ID, "")
		forkRaw, _ := s.readBlob(fork.ID, "")
		diff = noIndexDiff(parentRaw, forkRaw)
	}
	return map[string]any{
		"parentId":      parent.ID,
		"parentSubject": parent.Subject,
		"parentOwner":   parent.Owner,
		"parentHeadSha": parent.HeadSHA,
		"forkId":        fork.ID,
		"forkSubject":   fork.Subject,
		"forkOwner":     fork.Owner,
		"forkHeadSha":   fork.HeadSHA,
		"intent":        fork.ForkIntent,
		"intentNote":    fork.ForkIntentNote,
		"intentLabel":   forkIntentLabels[fork.ForkIntent],
		"baseSha":       fork.ForkedFromSHA,
		"against":       against,
		"diff":          diff,
	}, nil
}

func noIndexDiff(oldText, newText string) string {
	a, err1 := os.CreateTemp("", "gp-old-*.md")
	b, err2 := os.CreateTemp("", "gp-new-*.md")
	if err1 != nil || err2 != nil {
		return ""
	}
	defer os.Remove(a.Name())
	defer os.Remove(b.Name())
	_, _ = a.WriteString(oldText)
	_, _ = b.WriteString(newText)
	_ = a.Close()
	_ = b.Close()
	cmd := exec.Command("git", "diff", "--no-index", "--", a.Name(), b.Name())
	out, _ := cmd.CombinedOutput()
	return string(out)
}

func (s *Store) PRDiff(pr *PullRequest) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if pr.Kind == "paragraph" {
		return noIndexDiff(pr.Original+"\n", pr.Proposed+"\n"), nil
	}
	src := filepath.Join(s.repoDir(pr.SourcePostID), "POST.md")
	dst := filepath.Join(s.repoDir(pr.TargetPostID), "POST.md")
	cmd := exec.Command("git", "diff", "--no-index", "--", dst, src)
	out, _ := cmd.CombinedOutput()
	return string(out), nil
}
