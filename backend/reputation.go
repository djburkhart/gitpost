package main

import (
	"sort"
	"strings"
	"time"
)

type Attribution struct {
	Kind          string    `json:"kind"`
	SourcePostID  string    `json:"sourcePostId"`
	SourceSHA     string    `json:"sourceSha,omitempty"`
	SourceOwner   string    `json:"sourceOwner"`
	SourceSubject string    `json:"sourceSubject,omitempty"`
	Actor         string    `json:"actor"`
	CreatedAt     time.Time `json:"createdAt"`
}

type Notice struct {
	ID           string    `json:"id"`
	Handle       string    `json:"handle"`
	Kind         string    `json:"kind"`
	Actor        string    `json:"actor"`
	PostID       string    `json:"postId"`
	SourcePostID string    `json:"sourcePostId,omitempty"`
	SHA          string    `json:"sha,omitempty"`
	Subject      string    `json:"subject,omitempty"`
	Read         bool      `json:"read"`
	CreatedAt    time.Time `json:"createdAt"`
}

type DayCell struct {
	Date    string `json:"date"`
	Commits int    `json:"commits"`
	Merges  int    `json:"merges"`
	Taken   int    `json:"taken"`
	Total   int    `json:"total"`
	Level   int    `json:"level"`
}

type MaintainerScore struct {
	Score           int `json:"score"`
	Reviews         int `json:"reviews"`
	MergesAccepted  int `json:"mergesAccepted"`
	Taken           int `json:"taken"`
	QualityMain     int `json:"qualityMain"`
	StarsMaintained int `json:"starsMaintained"`
}

func (s *Store) attachDerived(dest *Post, src *Post, kind, actor, sha string) {
	if dest == nil || src == nil {
		return
	}
	dest.DerivedFrom = append(dest.DerivedFrom, Attribution{
		Kind:          kind,
		SourcePostID:  src.ID,
		SourceSHA:     sha,
		SourceOwner:   src.Owner,
		SourceSubject: src.Subject,
		Actor:         actor,
		CreatedAt:     time.Now().UTC(),
	})
}

func (s *Store) notifyDerivedLocked(src *Post, dest *Post, kind, actor, sha string) {
	if src == nil || dest == nil {
		return
	}
	if strings.EqualFold(src.Owner, actor) || src.Owner == "" {
		return
	}
	u := s.byHandle[strings.ToLower(src.Owner)]
	if u != nil && u.QuietDerived {
		return
	}
	s.notices = append(s.notices, Notice{
		ID:           idHex(6),
		Handle:       src.Owner,
		Kind:         kind,
		Actor:        actor,
		PostID:       dest.ID,
		SourcePostID: src.ID,
		SHA:          sha,
		Subject:      dest.Subject,
		CreatedAt:    time.Now().UTC(),
	})
	if len(s.notices) > 4000 {
		s.notices = append([]Notice(nil), s.notices[len(s.notices)-3000:]...)
	}
}

func (s *Store) Inbox(handle string) []Notice {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Notice{}
	h := strings.ToLower(handle)
	for _, n := range s.notices {
		if strings.ToLower(n.Handle) == h {
			out = append(out, n)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if len(out) > 80 {
		out = out[:80]
	}
	return out
}

func (s *Store) UnreadCount(handle string) int {
	n := 0
	h := strings.ToLower(handle)
	for _, note := range s.notices {
		if strings.ToLower(note.Handle) == h && !note.Read {
			n++
		}
	}
	return n
}

func (s *Store) MarkInbox(handle string, ids []string, all bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	h := strings.ToLower(handle)
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	for i := range s.notices {
		if strings.ToLower(s.notices[i].Handle) != h {
			continue
		}
		if all || want[s.notices[i].ID] {
			s.notices[i].Read = true
		}
	}
	return s.save()
}

func (s *Store) SetQuietDerived(handle string, quiet bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := s.byHandle[strings.ToLower(handle)]
	if u == nil {
		return errNotFound
	}
	u.QuietDerived = quiet
	return s.save()
}

func (s *Store) Contribution(handle string) map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	h := strings.ToLower(handle)
	today := time.Now().UTC()
	// 53 weeks ending this week, starting Sunday
	weekday := int(today.Weekday())
	end := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
	start := end.AddDate(0, 0, -(52*7 + weekday))
	cells := map[string]*DayCell{}
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		key := d.Format("2006-01-02")
		cells[key] = &DayCell{Date: key}
	}
	bump := func(t time.Time, kind string) {
		key := t.UTC().Format("2006-01-02")
		c := cells[key]
		if c == nil {
			return
		}
		switch kind {
		case "commit":
			c.Commits++
		case "merge":
			c.Merges++
		case "taken":
			c.Taken++
		}
	}
	for _, ev := range s.events {
		p := s.posts[ev.PostID]
		switch ev.Kind {
		case "commit", "revert":
			if strings.EqualFold(ev.Actor, h) {
				bump(ev.CreatedAt, "commit")
			}
		case "merge":
			if p != nil && strings.EqualFold(p.Owner, h) {
				bump(ev.CreatedAt, "merge")
			}
		case "cherry":
			if p != nil && strings.EqualFold(p.Owner, h) && !strings.EqualFold(ev.Actor, h) {
				bump(ev.CreatedAt, "taken")
			}
		}
	}
	weeks := make([][]DayCell, 0, 53)
	var week []DayCell
	totals := map[string]int{"commits": 0, "merges": 0, "taken": 0}
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		c := *cells[d.Format("2006-01-02")]
		c.Total = c.Commits + c.Merges + c.Taken
		switch {
		case c.Total <= 0:
			c.Level = 0
		case c.Total == 1:
			c.Level = 1
		case c.Total <= 3:
			c.Level = 2
		case c.Total <= 6:
			c.Level = 3
		default:
			c.Level = 4
		}
		totals["commits"] += c.Commits
		totals["merges"] += c.Merges
		totals["taken"] += c.Taken
		week = append(week, c)
		if len(week) == 7 {
			weeks = append(weeks, week)
			week = nil
		}
	}
	if len(week) > 0 {
		weeks = append(weeks, week)
	}
	return map[string]any{
		"weeks":  weeks,
		"start":  start.Format("2006-01-02"),
		"end":    end.Format("2006-01-02"),
		"totals": totals,
	}
}

func (s *Store) Score(handle string) MaintainerScore {
	s.mu.RLock()
	defer s.mu.RUnlock()
	h := strings.ToLower(handle)
	out := MaintainerScore{}
	for _, pr := range s.prs {
		for _, r := range pr.Reviewers {
			if strings.EqualFold(r.Handle, h) && r.Status != "" && r.Status != "pending" {
				out.Reviews++
			}
		}
	}
	for _, ev := range s.events {
		p := s.posts[ev.PostID]
		if ev.Kind == "merge" && p != nil && strings.EqualFold(p.Owner, h) {
			out.MergesAccepted++
		}
		if ev.Kind == "cherry" && p != nil && strings.EqualFold(p.Owner, h) && !strings.EqualFold(ev.Actor, h) {
			out.Taken++
		}
	}
	for _, p := range s.posts {
		if !strings.EqualFold(p.Owner, h) && !containsHandle(p.Maintainers, h) {
			continue
		}
		out.StarsMaintained += len(p.Stars)
		if p.Protected {
			out.QualityMain += 3
		}
		if p.CommitCount >= 3 {
			out.QualityMain += 1
		}
		if p.Verified {
			out.QualityMain += 2
		}
	}
	out.Score = out.Reviews*3 + out.MergesAccepted*5 + out.Taken*2 + out.QualityMain + out.StarsMaintained
	return out
}

func (s *Store) DerivationsFrom(id string) []map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []map[string]any{}
	seen := map[string]bool{}
	for _, p := range s.posts {
		if p.ParentPostID == id && !seen[p.ID] {
			seen[p.ID] = true
			out = append(out, map[string]any{
				"kind": "fork", "id": p.ID, "subject": p.Subject, "owner": p.Owner,
				"sha": p.HeadSHA, "intent": p.ForkIntent, "updatedAt": p.UpdatedAt,
			})
		}
		for _, a := range p.DerivedFrom {
			if a.SourcePostID == id && !seen[p.ID] {
				seen[p.ID] = true
				out = append(out, map[string]any{
					"kind": a.Kind, "id": p.ID, "subject": p.Subject, "owner": p.Owner,
					"sha": p.HeadSHA, "updatedAt": a.CreatedAt,
				})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		ti, _ := out[i]["updatedAt"].(time.Time)
		tj, _ := out[j]["updatedAt"].(time.Time)
		return ti.After(tj)
	})
	return out
}
