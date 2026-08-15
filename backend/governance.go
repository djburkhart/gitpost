package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var (
	errProtectedMain  = errors.New("main is protected — open a pull request")
	errReviewsPending = errors.New("requested reviews are still pending")
	errDraftPR        = errors.New("this is still a draft — mark it ready after reviews")
	errUnresolved     = errors.New("resolve the conflict markers before merging")
)

type ReviewRequest struct {
	Handle      string    `json:"handle"`
	Status      string    `json:"status"`
	Note        string    `json:"note,omitempty"`
	RequestedBy string    `json:"requestedBy,omitempty"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func containsHandle(list []string, handle string) bool {
	handle = strings.ToLower(strings.TrimSpace(handle))
	for _, h := range list {
		if strings.ToLower(h) == handle {
			return true
		}
	}
	return false
}

func addHandle(list []string, handle string) []string {
	if handle == "" || containsHandle(list, handle) {
		return list
	}
	return append(list, handle)
}

func removeHandle(list []string, handle string) []string {
	handle = strings.ToLower(handle)
	out := []string{}
	for _, h := range list {
		if strings.ToLower(h) != handle {
			out = append(out, h)
		}
	}
	return out
}

func canPushUser(p *Post, u *User) bool {
	if p == nil || u == nil {
		return false
	}
	if p.Owner == u.Handle {
		return true
	}
	if containsHandle(p.Maintainers, u.Handle) {
		return true
	}
	if !p.Protected && containsHandle(p.CoAuthors, u.Handle) {
		return true
	}
	return false
}

func (s *Store) canPush(p *Post, u *User) bool {
	return canPushUser(p, u)
}

func (s *Store) writeDenied(p *Post, u *User) error {
	if s.canPush(p, u) {
		return nil
	}
	if p.Protected {
		return errProtectedMain
	}
	return errForbidden
}

func (s *Store) trailerBlock(p *Post, editor *User, signoff bool) string {
	lines := []string{}
	for _, h := range p.CoAuthors {
		if strings.EqualFold(h, editor.Handle) {
			continue
		}
		u := s.byHandle[strings.ToLower(h)]
		if u == nil {
			continue
		}
		lines = append(lines, fmt.Sprintf("Co-authored-by: %s <%s>", u.Name, u.Email))
	}
	if signoff {
		lines = append(lines, fmt.Sprintf("Signed-off-by: %s <%s>", editor.Name, editor.Email))
	}
	return strings.Join(lines, "\n")
}

func parseTrailers(body string) (clean string, trailers []string) {
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	var keep []string
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "Co-authored-by:") || strings.HasPrefix(trim, "Signed-off-by:") {
			trailers = append(trailers, trim)
			continue
		}
		keep = append(keep, line)
	}
	return strings.TrimSpace(strings.Join(keep, "\n")), trailers
}

func reviewsReady(reqs []ReviewRequest) bool {
	if len(reqs) == 0 {
		return true
	}
	for _, r := range reqs {
		if r.Status != "approved" {
			return false
		}
	}
	return true
}

func (s *Store) InviteCoAuthor(id, handle string, actor *User) (*Post, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.posts[id]
	if p == nil {
		return nil, errNotFound
	}
	if !s.canPush(p, actor) {
		return nil, errForbidden
	}
	u := s.byHandle[strings.ToLower(strings.TrimSpace(handle))]
	if u == nil {
		return nil, errNotFound
	}
	if u.Handle == p.Owner || containsHandle(p.CoAuthors, u.Handle) {
		return p, nil
	}
	p.CoAuthorInvites = addHandle(p.CoAuthorInvites, u.Handle)
	return p, s.save()
}

func (s *Store) AcceptCoAuthor(id string, user *User) (*Post, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.posts[id]
	if p == nil {
		return nil, errNotFound
	}
	if !containsHandle(p.CoAuthorInvites, user.Handle) {
		return nil, errForbidden
	}
	p.CoAuthorInvites = removeHandle(p.CoAuthorInvites, user.Handle)
	p.CoAuthors = addHandle(p.CoAuthors, user.Handle)
	return p, s.save()
}

func (s *Store) RemoveCoAuthor(id, handle string, actor *User) (*Post, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.posts[id]
	if p == nil {
		return nil, errNotFound
	}
	if actor.Handle != p.Owner && !strings.EqualFold(actor.Handle, handle) {
		return nil, errForbidden
	}
	p.CoAuthors = removeHandle(p.CoAuthors, handle)
	p.CoAuthorInvites = removeHandle(p.CoAuthorInvites, handle)
	p.Maintainers = removeHandle(p.Maintainers, handle)
	return p, s.save()
}

func (s *Store) SetProtection(id string, protected bool, maintainers []string, actor *User) (*Post, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.posts[id]
	if p == nil {
		return nil, errNotFound
	}
	if p.Owner != actor.Handle {
		return nil, errForbidden
	}
	p.Protected = protected
	if maintainers != nil {
		clean := []string{}
		for _, h := range maintainers {
			u := s.byHandle[strings.ToLower(strings.TrimSpace(h))]
			if u == nil || u.Handle == p.Owner {
				continue
			}
			clean = addHandle(clean, u.Handle)
			p.CoAuthors = addHandle(p.CoAuthors, u.Handle)
		}
		p.Maintainers = clean
	}
	return p, s.save()
}

func upsertReview(list []ReviewRequest, handle, status, note, by string) []ReviewRequest {
	handle = strings.TrimSpace(handle)
	now := time.Now().UTC()
	for i := range list {
		if strings.EqualFold(list[i].Handle, handle) {
			if status != "" {
				list[i].Status = status
			}
			if note != "" {
				list[i].Note = note
			}
			list[i].UpdatedAt = now
			return list
		}
	}
	if status == "" {
		status = "requested"
	}
	return append(list, ReviewRequest{
		Handle: handle, Status: status, Note: note, RequestedBy: by, UpdatedAt: now,
	})
}

func (s *Store) RequestReview(kind, id, handle, by string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := s.byHandle[strings.ToLower(strings.TrimSpace(handle))]
	if u == nil {
		return errNotFound
	}
	if kind == "pr" {
		pr := s.prs[id]
		if pr == nil {
			return errNotFound
		}
		dst := s.posts[pr.TargetPostID]
		src := s.posts[pr.SourcePostID]
		if dst == nil {
			return errNotFound
		}
		if by != pr.Author && (dst == nil || dst.Owner != by) && (src == nil || src.Owner != by) && !s.canPush(dst, s.byHandle[strings.ToLower(by)]) {
			return errForbidden
		}
		pr.Reviewers = upsertReview(pr.Reviewers, u.Handle, "requested", "", by)
		pr.Draft = true
		pr.UpdatedAt = time.Now().UTC()
		return s.save()
	}
	p := s.posts[id]
	if p == nil {
		return errNotFound
	}
	if p.Owner != by && !s.canPush(p, s.byHandle[strings.ToLower(by)]) {
		return errForbidden
	}
	p.Reviewers = upsertReview(p.Reviewers, u.Handle, "requested", "", by)
	return s.save()
}

func (s *Store) SubmitReview(kind, id, status, note string, user *User) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	status = strings.ToLower(strings.TrimSpace(status))
	if status != "approved" && status != "changes" {
		return errBadRequest
	}
	if kind == "pr" {
		pr := s.prs[id]
		if pr == nil {
			return errNotFound
		}
		found := false
		for _, r := range pr.Reviewers {
			if strings.EqualFold(r.Handle, user.Handle) {
				found = true
				break
			}
		}
		if !found {
			return errForbidden
		}
		pr.Reviewers = upsertReview(pr.Reviewers, user.Handle, status, note, user.Handle)
		if reviewsReady(pr.Reviewers) {
			pr.Draft = false
		} else {
			pr.Draft = true
		}
		pr.UpdatedAt = time.Now().UTC()
		return s.save()
	}
	p := s.posts[id]
	if p == nil {
		return errNotFound
	}
	found := false
	for _, r := range p.Reviewers {
		if strings.EqualFold(r.Handle, user.Handle) {
			found = true
			break
		}
	}
	if !found {
		return errForbidden
	}
	p.Reviewers = upsertReview(p.Reviewers, user.Handle, status, note, user.Handle)
	return s.save()
}

func ideaMerge(base, ours, theirs, oursLabel, theirsLabel string) (string, bool, error) {
	dir, err := os.MkdirTemp("", "gitpost-merge-*")
	if err != nil {
		return "", false, err
	}
	defer os.RemoveAll(dir)
	write := func(name, body string) error {
		return os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644)
	}
	if err := write("base", base); err != nil {
		return "", false, err
	}
	if err := write("ours", ours); err != nil {
		return "", false, err
	}
	if err := write("theirs", theirs); err != nil {
		return "", false, err
	}
	cmd := exec.Command("git", "merge-file", "-p", "--diff3",
		"-L", oursLabel, "-L", "base", "-L", theirsLabel,
		filepath.Join(dir, "ours"), filepath.Join(dir, "base"), filepath.Join(dir, "theirs"),
	)
	out, err := cmd.CombinedOutput()
	text := string(out)
	if !strings.Contains(text, "<<<<<<<") && err != nil && len(out) == 0 {
		return "", true, err
	}
	return text, strings.Contains(text, "<<<<<<<"), nil
}

func (s *Store) ResolvePR(id, body string, user *User) (*PullRequest, error) {
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
	if pr.Status != "conflict" {
		return nil, errConflict
	}
	body = strings.TrimSpace(body)
	if body == "" || strings.Contains(body, "<<<<<<<") || strings.Contains(body, ">>>>>>>") {
		return nil, errUnresolved
	}
	if !reviewsReady(pr.Reviewers) {
		return nil, errReviewsPending
	}
	dir := s.repoDir(dst.ID)
	if err := writePostFile(dir, dst.Subject, body, dst.Story); err != nil {
		return nil, err
	}
	msg := "Resolve idea conflict from PR #" + fmt.Sprint(pr.Number)
	sha, err := s.commit(dir, user.Name, user.Email, msg, time.Now().UTC(), s.trailerBlock(dst, user, true))
	if err != nil {
		return nil, err
	}
	pr.Status = "merged"
	pr.ConflictBody = ""
	pr.MergedSHA = sha
	pr.Draft = false
	pr.UpdatedAt = time.Now().UTC()
	s.refreshPost(dst)
	dst.Body = body
	dst.UpdatedAt = pr.UpdatedAt
	s.recordLocked("merge", dst.ID, sha, user.Handle)
	return pr, s.save()
}
