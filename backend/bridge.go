package main

import (
	"strings"
	"time"
)

func (s *Store) AttachBridge(id, rawURL, direction string, user *User) (*Post, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return nil, errBadRequest
	}
	st, err := FetchStory(rawURL)
	if err != nil || st == nil {
		return nil, errBadRequest
	}
	if direction == "" {
		direction = "writing-to-code"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.posts[id]
	if p == nil {
		return nil, errNotFound
	}
	if err := s.writeDenied(p, user); err != nil {
		return nil, err
	}
	b := storyToBridge(st, user.Handle, direction)
	if b.URL == "" {
		b = Bridge{
			URL: rawURL, Provider: st.Provider, Repo: st.Repo, Kind: st.Kind,
			Title: st.Title, HTMLURL: st.HTMLURL, Direction: direction,
			CreatedBy: user.Handle, CreatedAt: time.Now().UTC(),
		}
	}
	for _, ex := range p.Bridges {
		if strings.EqualFold(ex.URL, b.URL) || (ex.Repo == b.Repo && ex.Kind == b.Kind && ex.Number != "" && ex.Number == b.Number) {
			return p, nil
		}
	}
	if len(p.Bridges) >= 12 {
		return nil, errBadRequest
	}
	p.Bridges = append(p.Bridges, b)
	p.UpdatedAt = time.Now().UTC()
	return p, s.save()
}

func (s *Store) DetachBridge(id, rawURL string, user *User) (*Post, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.posts[id]
	if p == nil {
		return nil, errNotFound
	}
	if err := s.writeDenied(p, user); err != nil {
		return nil, err
	}
	rawURL = strings.TrimSpace(rawURL)
	out := []Bridge{}
	for _, b := range p.Bridges {
		if !strings.EqualFold(b.URL, rawURL) && !strings.EqualFold(b.HTMLURL, rawURL) {
			out = append(out, b)
		}
	}
	p.Bridges = out
	p.UpdatedAt = time.Now().UTC()
	return p, s.save()
}
