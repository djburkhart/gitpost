package main

import (
	"sort"
	"strings"
	"time"
)

type Draft struct {
	ID        string    `json:"id"`
	Owner     string    `json:"owner"`
	Subject   string    `json:"subject"`
	Body      string    `json:"body"`
	StoryURL  string    `json:"storyUrl,omitempty"`
	Topics    []string  `json:"topics,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (s *Store) ListDrafts(handle string) []Draft {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Draft{}
	h := strings.ToLower(handle)
	for _, d := range s.drafts {
		if strings.ToLower(d.Owner) == h {
			out = append(out, *d)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out
}

func (s *Store) GetDraft(id, handle string) *Draft {
	s.mu.RLock()
	defer s.mu.RUnlock()
	d := s.drafts[id]
	if d == nil || !strings.EqualFold(d.Owner, handle) {
		return nil
	}
	cp := *d
	return &cp
}

func (s *Store) SaveDraft(id, handle, subject, body, storyURL string, topics []string) (*Draft, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	subject = strings.TrimSpace(subject)
	if len(subject) > 120 {
		subject = subject[:120]
	}
	if len(body) > 200000 {
		body = body[:200000]
	}
	if id != "" {
		d := s.drafts[id]
		if d == nil || !strings.EqualFold(d.Owner, handle) {
			return nil, errNotFound
		}
		d.Subject = subject
		d.Body = body
		d.StoryURL = strings.TrimSpace(storyURL)
		d.Topics = extractTopics(topics, subject, body)
		d.UpdatedAt = now
		return d, s.save()
	}
	if subject == "" && strings.TrimSpace(body) == "" {
		return nil, errBadRequest
	}
	n := 0
	for _, d := range s.drafts {
		if strings.EqualFold(d.Owner, handle) {
			n++
		}
	}
	if n >= 40 {
		return nil, errBadRequest
	}
	d := &Draft{
		ID:        idHex(5),
		Owner:     handle,
		Subject:   subject,
		Body:      body,
		StoryURL:  strings.TrimSpace(storyURL),
		Topics:    extractTopics(topics, subject, body),
		CreatedAt: now,
		UpdatedAt: now,
	}
	s.drafts[d.ID] = d
	return d, s.save()
}

func (s *Store) DeleteDraft(id, handle string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.drafts[id]
	if d == nil || !strings.EqualFold(d.Owner, handle) {
		return errNotFound
	}
	delete(s.drafts, id)
	return s.save()
}

func (s *Store) CommitDraft(id string, user *User) (*Post, error) {
	s.mu.Lock()
	d := s.drafts[id]
	if d == nil || !strings.EqualFold(d.Owner, user.Handle) {
		s.mu.Unlock()
		return nil, errNotFound
	}
	subject := strings.TrimSpace(d.Subject)
	if subject == "" {
		s.mu.Unlock()
		return nil, errBadRequest
	}
	body, storyURL, topics := d.Body, d.StoryURL, append([]string{}, d.Topics...)
	delete(s.drafts, id)
	_ = s.save()
	s.mu.Unlock()
	var story *Story
	if strings.TrimSpace(storyURL) != "" {
		if st, err := FetchStory(storyURL); err == nil {
			story = st
		} else {
			story = &Story{URL: storyURL, Provider: "link", HTMLURL: storyURL}
		}
	}
	return s.CreatePost(user, subject, body, storyURL, story, topics, time.Time{})
}
