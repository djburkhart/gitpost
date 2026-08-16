package main

import (
	"strings"
	"time"
)

func (s *Store) ListWatches(handle string) []RepoWatch {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []RepoWatch{}
	h := strings.ToLower(handle)
	for _, w := range s.watches {
		if strings.ToLower(w.Handle) == h {
			out = append(out, w)
		}
	}
	return out
}

func (s *Store) WatchRepo(handle, raw string) (*RepoWatch, error) {
	owner, repo, ok := parseRepoRef(raw)
	if !ok {
		return nil, errBadRequest
	}
	ref := owner + "/" + repo
	s.mu.Lock()
	defer s.mu.Unlock()
	h := strings.ToLower(handle)
	n := 0
	for _, w := range s.watches {
		if strings.ToLower(w.Handle) == h {
			if strings.EqualFold(w.Repo, ref) {
				cp := w
				return &cp, nil
			}
			n++
		}
	}
	if n >= 24 {
		return nil, errBadRequest
	}
	w := RepoWatch{
		ID:        idHex(4),
		Handle:    handle,
		Repo:      ref,
		Provider:  "github",
		CreatedAt: time.Now().UTC(),
	}
	s.watches = append(s.watches, w)
	return &w, s.save()
}

func (s *Store) UnwatchRepo(handle, raw string) error {
	owner, repo, ok := parseRepoRef(raw)
	if !ok {
		repo = strings.TrimSpace(raw)
	} else {
		repo = owner + "/" + repo
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []RepoWatch{}
	h := strings.ToLower(handle)
	for _, w := range s.watches {
		if strings.ToLower(w.Handle) == h && strings.EqualFold(w.Repo, repo) {
			continue
		}
		out = append(out, w)
	}
	s.watches = out
	return s.save()
}

func (s *Store) HintsFor(handle string) []ReleaseHint {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []ReleaseHint{}
	h := strings.ToLower(handle)
	for _, hint := range s.hints {
		if strings.ToLower(hint.Handle) == h && !hint.Dismissed {
			out = append(out, hint)
		}
	}
	return out
}

func (s *Store) RefreshChangelog(handle string) []ReleaseHint {
	watches := s.ListWatches(handle)
	for _, w := range watches {
		parts := strings.SplitN(w.Repo, "/", 2)
		if len(parts) != 2 {
			continue
		}
		list, err := ListGHReleases(parts[0], parts[1], 5)
		if err != nil || len(list) == 0 {
			continue
		}
		latest := list[0]
		if latest.Draft || latest.TagName == "" {
			continue
		}
		s.ingestRelease(handle, w.Repo, latest)
		s.mu.Lock()
		for i := range s.watches {
			if s.watches[i].ID == w.ID {
				s.watches[i].LastTag = latest.TagName
			}
		}
		_ = s.save()
		s.mu.Unlock()
	}
	return s.HintsFor(handle)
}

func (s *Store) ingestRelease(handle, repo string, rel ghRelease) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, h := range s.hints {
		if strings.EqualFold(h.Handle, handle) && strings.EqualFold(h.Repo, repo) && h.Tag == rel.TagName {
			return
		}
	}
	name := rel.Name
	if name == "" {
		name = rel.TagName
	}
	hint := ReleaseHint{
		ID:          idHex(5),
		Handle:      handle,
		Repo:        repo,
		Tag:         rel.TagName,
		Name:        name,
		Body:        rel.Body,
		HTMLURL:     rel.HTMLURL,
		PublishedAt: rel.PublishedAt,
		CreatedAt:   time.Now().UTC(),
	}
	s.hints = append(s.hints, hint)
	s.notices = append(s.notices, Notice{
		ID:        idHex(6),
		Handle:    handle,
		Kind:      "release",
		Actor:     "github",
		PostID:    "",
		Subject:   repo + " " + rel.TagName,
		CreatedAt: time.Now().UTC(),
	})
}

func (s *Store) DismissHint(handle, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.hints {
		if s.hints[i].ID == id && strings.EqualFold(s.hints[i].Handle, handle) {
			s.hints[i].Dismissed = true
			return s.save()
		}
	}
	return errNotFound
}

func (s *Store) DraftFromHint(handle, id string) (*Draft, error) {
	s.mu.Lock()
	var hint *ReleaseHint
	for i := range s.hints {
		if s.hints[i].ID == id && strings.EqualFold(s.hints[i].Handle, handle) {
			hint = &s.hints[i]
			break
		}
	}
	if hint == nil {
		s.mu.Unlock()
		return nil, errNotFound
	}
	subject := hint.Repo + " " + hint.Tag
	if hint.Name != "" && hint.Name != hint.Tag {
		subject = hint.Name
	}
	body := "Shipped " + hint.Repo + " `" + hint.Tag + "`.\n\n"
	if hint.Body != "" {
		body += hint.Body
	}
	if len(body) > 200000 {
		body = body[:200000]
	}
	draftID := hint.DraftID
	s.mu.Unlock()
	d, err := s.SaveDraft(draftID, handle, subject, body, hint.HTMLURL, []string{"changelog", slugify(strings.Split(hint.Repo, "/")[0])})
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.hints {
		if s.hints[i].ID == id {
			s.hints[i].DraftID = d.ID
		}
	}
	_ = s.save()
	return d, nil
}

func (s *Store) HintFromURL(handle, raw string) (*ReleaseHint, error) {
	st, err := FetchStory(raw)
	if err != nil || st == nil {
		return nil, errBadRequest
	}
	if st.Kind != "release" && st.Kind != "commit" && st.Kind != "pull" {
		if !strings.Contains(raw, "/releases/") {
			return nil, errBadRequest
		}
		st.Kind = "release"
	}
	tag := st.Number
	if tag == "" {
		tag = st.SHA
	}
	if tag == "" {
		tag = "ship"
	}
	name := st.Title
	if name == "" {
		name = strings.Split(st.Message, "\n")[0]
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.hints {
		if strings.EqualFold(s.hints[i].Handle, handle) && s.hints[i].HTMLURL == st.HTMLURL {
			cp := s.hints[i]
			return &cp, nil
		}
	}
	hint := ReleaseHint{
		ID:          idHex(5),
		Handle:      handle,
		Repo:        st.Repo,
		Tag:         tag,
		Name:        name,
		Body:        st.Message,
		HTMLURL:     st.HTMLURL,
		PublishedAt: st.Date,
		CreatedAt:   time.Now().UTC(),
	}
	s.hints = append(s.hints, hint)
	s.notices = append(s.notices, Notice{
		ID: idHex(6), Handle: handle, Kind: "release", Actor: st.Provider,
		Subject: hint.Repo + " " + hint.Tag, CreatedAt: time.Now().UTC(),
	})
	return &hint, s.save()
}
