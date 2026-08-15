package main

import (
	"fmt"
	"strings"
	"time"
)

type HistoryProof struct {
	Verified    bool   `json:"verified"`
	Genesis     string `json:"genesis,omitempty"`
	Head        string `json:"head,omitempty"`
	CommitCount int    `json:"commitCount"`
	Reason      string `json:"reason,omitempty"`
}

func (s *Store) VerifyHistory(id string) HistoryProof {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p := s.posts[id]
	if p == nil {
		return HistoryProof{Reason: "object not found"}
	}
	dir := s.repoDir(id)
	head := strings.TrimSpace(s.headSHA(id))
	list, err := s.git(dir, "rev-list", "--first-parent", "--reverse", "HEAD")
	if err != nil {
		return HistoryProof{Head: head, Reason: "could not read history"}
	}
	shas := []string{}
	for _, line := range strings.Split(strings.TrimSpace(list), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			shas = append(shas, line)
		}
	}
	proof := HistoryProof{Head: head, CommitCount: len(shas)}
	if len(shas) == 0 {
		proof.Reason = "empty object store"
		return proof
	}
	proof.Genesis = shas[0]
	prev := ""
	for _, sha := range shas {
		if _, err := s.git(dir, "cat-file", "-e", sha+"^{commit}"); err != nil {
			proof.Reason = "missing object " + shortSHA(sha)
			return proof
		}
		parents, _ := s.git(dir, "rev-list", "--parents", "-n", "1", sha)
		fields := strings.Fields(strings.TrimSpace(parents))
		if prev != "" {
			ok := false
			for _, f := range fields[1:] {
				if f == prev {
					ok = true
					break
				}
			}
			if !ok {
				proof.Reason = "broken parent link at " + shortSHA(sha)
				return proof
			}
		}
		prev = sha
	}
	if head != "" && shas[len(shas)-1] != head {
		proof.Reason = "HEAD is not the tip of first-parent history"
		return proof
	}
	reflog, _ := s.git(dir, "reflog", "--format=%gs")
	for _, line := range strings.Split(reflog, "\n") {
		low := strings.ToLower(line)
		if strings.Contains(low, "reset:") || strings.Contains(low, "rebase") || strings.Contains(low, "commit (amend)") {
			proof.Reason = "history was rewritten (" + strings.TrimSpace(line) + ")"
			return proof
		}
	}
	proof.Verified = true
	return proof
}

func (s *Store) ResolveSHA(id, want string) (string, error) {
	want = strings.TrimSpace(want)
	if want == "" {
		return s.headSHA(id), nil
	}
	out, err := s.git(s.repoDir(id), "rev-parse", "--verify", want+"^{commit}")
	if err != nil {
		return "", errNotFound
	}
	return strings.TrimSpace(out), nil
}

func (s *Store) FindByObject(sha string) (*Post, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sha = strings.TrimSpace(sha)
	if sha == "" {
		return nil, ""
	}
	if p := s.posts[sha]; p != nil {
		cp := *p
		s.refreshPost(&cp)
		return &cp, cp.HeadSHA
	}
	for _, p := range s.posts {
		exact, err := s.ResolveSHA(p.ID, sha)
		if err == nil && exact != "" {
			cp := *p
			s.refreshPost(&cp)
			return &cp, exact
		}
	}
	return nil, ""
}

func (s *Store) Revert(id, sha, reason string, user *User, signoff bool) (*Post, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.posts[id]
	if p == nil {
		return nil, errNotFound
	}
	if err := s.writeDenied(p, user); err != nil {
		return nil, err
	}
	reason = strings.TrimSpace(reason)
	if reason == "" || len(reason) > 2000 {
		return nil, errBadRequest
	}
	exact, err := s.ResolveSHA(id, sha)
	if err != nil {
		return nil, err
	}
	if exact == p.HeadSHA && s.commitCount(id) < 2 {
		return nil, errBadRequest
	}
	dir := s.repoDir(id)
	subjOut, _ := s.git(dir, "log", "-1", "--format=%s", exact)
	orig := strings.TrimSpace(subjOut)
	if orig == "" {
		orig = exact[:7]
	}
	env := []string{
		"GIT_AUTHOR_NAME=" + user.Name,
		"GIT_AUTHOR_EMAIL=" + user.Email,
		"GIT_COMMITTER_NAME=" + user.Name,
		"GIT_COMMITTER_EMAIL=" + user.Email,
	}
	if _, err := s.gitEnv(dir, env, "revert", "--no-commit", "--no-edit", exact); err != nil {
		_, _ = s.git(dir, "revert", "--abort")
		return nil, friendlyGitErr(err)
	}
	msg := fmt.Sprintf("Revert %q", orig)
	body := reason + "\n\nThis reverts commit " + exact + "."
	if signoff {
		trail := s.trailerBlock(p, user, true)
		if trail != "" {
			body = body + "\n\n" + trail
		}
	}
	shaNew, err := s.commit(dir, user.Name, user.Email, msg, time.Now().UTC(), body)
	if err != nil {
		_, _ = s.git(dir, "revert", "--abort")
		return nil, err
	}
	s.refreshPost(p)
	p.UpdatedAt = time.Now().UTC()
	s.recordLocked("revert", p.ID, shaNew, user.Handle)
	return p, s.save()
}
