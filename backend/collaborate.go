package main

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type PostComment struct {
	ID        string    `json:"id"`
	PostID    string    `json:"postId"`
	ParentID  string    `json:"parentId,omitempty"`
	Author    string    `json:"author"`
	Body      string    `json:"body"`
	Branch    string    `json:"branch,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

func quoteExcerpt(excerpt string) string {
	excerpt = strings.TrimSpace(strings.ReplaceAll(excerpt, "\r\n", "\n"))
	if excerpt == "" {
		return ""
	}
	lines := strings.Split(excerpt, "\n")
	for i, line := range lines {
		lines[i] = "> " + strings.TrimRight(line, " ")
	}
	return strings.Join(lines, "\n")
}

func (s *Store) CherryPickExcerpt(destID, sourceID, excerpt string, user *User) (*Post, error) {
	excerpt = strings.TrimSpace(strings.ReplaceAll(excerpt, "\r\n", "\n"))
	if excerpt == "" || len(excerpt) > 8000 {
		return nil, errBadRequest
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	src := s.posts[sourceID]
	if src == nil {
		return nil, errNotFound
	}
	attr := fmt.Sprintf(
		"%s\n\nCherry-picked from @%s `%s` — %s",
		quoteExcerpt(excerpt),
		src.Owner,
		src.ShortSHA,
		src.Subject,
	)
	now := time.Now().UTC()
	if destID == "" {
		body := attr
		subject := "Cherry-pick: " + src.Subject
		if len(subject) > 72 {
			subject = subject[:69] + "…"
		}
		s.mu.Unlock()
		p, err := s.CreatePost(user, subject, body, "", nil, src.Topics, now)
		if err != nil {
			s.mu.Lock()
			return nil, err
		}
		s.mu.Lock()
		if np := s.posts[p.ID]; np != nil {
			s.attachDerived(np, src, "cherry", user.Handle, src.HeadSHA)
			s.notifyDerivedLocked(src, np, "cherry", user.Handle, src.HeadSHA)
		}
		s.recordLocked("cherry", p.ID, p.HeadSHA, user.Handle)
		s.recordLocked("cherry", src.ID, src.HeadSHA, user.Handle)
		_ = s.save()
		return p, nil
	}
	dst := s.posts[destID]
	if dst == nil {
		return nil, errNotFound
	}
	if err := s.writeDenied(dst, user); err != nil {
		return nil, err
	}
	body := strings.TrimSpace(dst.Body)
	if body != "" {
		body = body + "\n\n" + attr
	} else {
		body = attr
	}
	subject := dst.Subject
	dir := s.repoDir(dst.ID)
	if err := writePostFile(dir, subject, body, dst.Story); err != nil {
		return nil, err
	}
	sha, err := s.commit(dir, user.Name, user.Email, "cherry-pick excerpt from "+src.ShortSHA, now)
	if err != nil {
		return nil, err
	}
	dst.Body = body
	dst.HeadSHA = sha
	dst.ShortSHA = shortSHA(sha)
	dst.UpdatedAt = now
	dst.CommitCount = s.commitCount(dst.ID)
	s.recordLocked("cherry", dst.ID, sha, user.Handle)
	s.recordLocked("cherry", src.ID, src.HeadSHA, user.Handle)
	s.attachDerived(dst, src, "cherry", user.Handle, src.HeadSHA)
	s.notifyDerivedLocked(src, dst, "cherry", user.Handle, src.HeadSHA)
	return dst, s.save()
}

func (s *Store) ListComments(postID string) []PostComment {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []PostComment{}
	for _, c := range s.comments {
		if c.PostID == postID {
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

func (s *Store) AddComment(postID, parentID, body string, user *User) (*PostComment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.posts[postID] == nil {
		return nil, errNotFound
	}
	body = strings.TrimSpace(body)
	if body == "" || len(body) > 4000 {
		return nil, errBadRequest
	}
	parentID = strings.TrimSpace(parentID)
	if parentID != "" {
		found := false
		for _, c := range s.comments {
			if c.ID == parentID && c.PostID == postID {
				found = true
				break
			}
		}
		if !found {
			return nil, errNotFound
		}
	}
	c := PostComment{
		ID:        idHex(4),
		PostID:    postID,
		ParentID:  parentID,
		Author:    user.Handle,
		Body:      body,
		CreatedAt: time.Now().UTC(),
	}
	s.comments = append(s.comments, c)
	return &c, s.save()
}

func (s *Store) BranchDiscussion(postID, commentID string, user *User) (*BranchInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.posts[postID]
	if p == nil {
		return nil, errNotFound
	}
	if p.Owner != user.Handle {
		return nil, errForbidden
	}
	var root *PostComment
	byID := map[string]PostComment{}
	for i := range s.comments {
		c := s.comments[i]
		if c.PostID != postID {
			continue
		}
		byID[c.ID] = c
		if c.ID == commentID {
			cp := c
			root = &cp
		}
	}
	if root == nil {
		return nil, errNotFound
	}
	for root.ParentID != "" {
		par, ok := byID[root.ParentID]
		if !ok {
			break
		}
		cp := par
		root = &cp
	}
	thread := []PostComment{}
	var walk func(id string)
	walk = func(id string) {
		c, ok := byID[id]
		if !ok {
			return
		}
		thread = append(thread, c)
		for _, other := range s.comments {
			if other.PostID == postID && other.ParentID == id {
				walk(other.ID)
			}
		}
	}
	walk(root.ID)
	name := "discuss-" + root.ID
	dir := s.repoDir(postID)
	if _, err := s.git(dir, "branch", name); err != nil {
		return nil, friendlyGitErr(err)
	}
	current := p.DefaultBranch
	if current == "" {
		current = "main"
	}
	if _, err := s.git(dir, "checkout", name); err != nil {
		return nil, err
	}
	var b strings.Builder
	b.WriteString(strings.TrimSpace(p.Body))
	b.WriteString("\n\n---\n\n## Discussion\n\nPromoted from a comment thread so the main line stays readable.\n")
	for _, c := range thread {
		b.WriteString("\n### @")
		b.WriteString(c.Author)
		b.WriteString(" · ")
		b.WriteString(c.CreatedAt.UTC().Format("2006-01-02"))
		b.WriteString("\n\n")
		b.WriteString(c.Body)
		b.WriteString("\n")
	}
	subject := "discuss: " + p.Subject
	if len(subject) > 72 {
		subject = subject[:69] + "…"
	}
	if err := writePostFile(dir, subject, b.String(), p.Story); err != nil {
		_, _ = s.git(dir, "checkout", current)
		return nil, err
	}
	sha, err := s.commit(dir, user.Name, user.Email, subject, time.Now().UTC())
	if err != nil {
		_, _ = s.git(dir, "checkout", current)
		return nil, err
	}
	_, _ = s.git(dir, "checkout", current)
	s.refreshPost(p)
	for i := range s.comments {
		if s.comments[i].PostID == postID {
			for _, c := range thread {
				if s.comments[i].ID == c.ID {
					s.comments[i].Branch = name
				}
			}
		}
	}
	if err := s.save(); err != nil {
		return nil, err
	}
	return &BranchInfo{Name: name, SHA: sha, Author: user.Handle}, nil
}

func (s *Store) ListTakes(id string) []Post {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p := s.posts[id]
	if p == nil {
		return nil
	}
	root := id
	if p.ParentPostID != "" {
		root = p.ParentPostID
	}
	out := []Post{}
	for _, other := range s.posts {
		if other.ID == id {
			continue
		}
		if other.ParentPostID == id || other.ParentPostID == root || other.ID == root {
			if other.ID == root && root == id {
				continue
			}
			cp := *other
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
