package main

import (
	"regexp"
	"sort"
	"strings"
	"time"
)

var topicRe = regexp.MustCompile(`#([A-Za-z][A-Za-z0-9_-]{1,39})`)

type Activity struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	PostID    string    `json:"postId"`
	SHA       string    `json:"sha"`
	Actor     string    `json:"actor"`
	CreatedAt time.Time `json:"createdAt"`
}

type RemoteFollow struct {
	Handle    string    `json:"handle"`
	Topic     string    `json:"topic"`
	CreatedAt time.Time `json:"createdAt"`
}

func normalizeTopic(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimPrefix(s, "remote:")
	s = strings.TrimPrefix(s, "#")
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	s = slugify(s)
	if len(s) < 2 || len(s) > 40 {
		return ""
	}
	return s
}

func extractTopics(explicit []string, subject, body string) []string {
	seen := map[string]bool{}
	out := []string{}
	add := func(raw string) {
		t := normalizeTopic(raw)
		if t == "" || seen[t] {
			return
		}
		seen[t] = true
		out = append(out, t)
	}
	for _, t := range explicit {
		add(t)
	}
	for _, m := range topicRe.FindAllStringSubmatch(subject+"\n"+body, -1) {
		add(m[1])
	}
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

func (s *Store) recordLocked(kind, postID, sha, actor string) {
	s.events = append(s.events, Activity{
		ID:        idHex(4),
		Kind:      kind,
		PostID:    postID,
		SHA:       sha,
		Actor:     actor,
		CreatedAt: time.Now().UTC(),
	})
	if len(s.events) > 4000 {
		s.events = append([]Activity(nil), s.events[len(s.events)-3000:]...)
	}
}

func (s *Store) FollowRemote(handle, topic string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	topic = normalizeTopic(topic)
	if topic == "" {
		return nil, errBadRequest
	}
	cur := s.remotes[handle]
	for _, t := range cur {
		if t == topic {
			return cur, s.save()
		}
	}
	if len(cur) >= 24 {
		return nil, errBadRequest
	}
	s.remotes[handle] = append(append([]string{}, cur...), topic)
	return s.remotes[handle], s.save()
}

func (s *Store) UnfollowRemote(handle, topic string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	topic = normalizeTopic(topic)
	cur := s.remotes[handle]
	out := []string{}
	for _, t := range cur {
		if t != topic {
			out = append(out, t)
		}
	}
	s.remotes[handle] = out
	return out, s.save()
}

func (s *Store) RemotesFor(handle string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]string{}, s.remotes[handle]...)
}

func (s *Store) TopicStats() []map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	counts := map[string]int{}
	for _, p := range s.posts {
		for _, t := range p.Topics {
			counts[t]++
		}
	}
	out := make([]map[string]any, 0, len(counts))
	for t, n := range counts {
		out = append(out, map[string]any{"topic": t, "count": n})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i]["count"].(int) == out[j]["count"].(int) {
			return out[i]["topic"].(string) < out[j]["topic"].(string)
		}
		return out[i]["count"].(int) > out[j]["count"].(int)
	})
	return out
}

func postHasTopic(p *Post, topic string) bool {
	for _, t := range p.Topics {
		if t == topic {
			return true
		}
	}
	return false
}

func (s *Store) Graph() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	all := make([]*Post, 0, len(s.posts))
	for _, p := range s.posts {
		s.refreshPost(p)
		all = append(all, p)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].UpdatedAt.After(all[j].UpdatedAt) })
	limit := 80
	if len(all) < limit {
		limit = len(all)
	}
	keep := map[string]bool{}
	for i := 0; i < limit; i++ {
		keep[all[i].ID] = true
	}
	for _, p := range all {
		if keep[p.ID] && p.ParentPostID != "" {
			keep[p.ParentPostID] = true
		}
	}
	mergedInto := map[string][]string{}
	for _, pr := range s.prs {
		if pr.Status == "merged" && pr.Kind != "paragraph" && pr.SourcePostID != "" {
			mergedInto[pr.TargetPostID] = append(mergedInto[pr.TargetPostID], pr.SourcePostID)
			keep[pr.TargetPostID] = true
			keep[pr.SourcePostID] = true
		}
	}
	nodes := []map[string]any{}
	for _, p := range all {
		if !keep[p.ID] {
			continue
		}
		kind := "commit"
		if p.ParentPostID != "" {
			kind = "fork"
		}
		parents := []string{}
		if p.ParentPostID != "" {
			parents = append(parents, p.ParentPostID)
		}
		if extras := mergedInto[p.ID]; len(extras) > 0 {
			kind = "merge"
			parents = append(parents, extras...)
		}
		nodes = append(nodes, map[string]any{
			"id":            p.ID,
			"owner":         p.Owner,
			"subject":       p.Subject,
			"shortSha":      p.ShortSHA,
			"headSha":       p.HeadSHA,
			"parentPostId":  p.ParentPostID,
			"forkIntent":    p.ForkIntent,
			"forkCount":     p.ForkCount,
			"starCount":     len(p.Stars),
			"commitCount":   p.CommitCount,
			"topics":        p.Topics,
			"updatedAt":     p.UpdatedAt,
			"kind":          kind,
			"parents":       parents,
		})
	}
	return map[string]any{"nodes": nodes}
}

func (s *Store) Trending(window time.Duration) []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	since := time.Now().UTC().Add(-window)
	type score struct {
		forks, prs, cherries, merges int
	}
	by := map[string]*score{}
	touch := func(id string) *score {
		if by[id] == nil {
			by[id] = &score{}
		}
		return by[id]
	}
	for _, ev := range s.events {
		if ev.CreatedAt.Before(since) {
			continue
		}
		sc := touch(ev.PostID)
		switch ev.Kind {
		case "fork":
			sc.forks++
		case "pr":
			sc.prs++
		case "cherry":
			sc.cherries++
		case "merge":
			sc.merges++
		}
	}
	for _, p := range s.posts {
		if p.ParentPostID != "" && p.CreatedAt.After(since) {
			touch(p.ParentPostID).forks++
			touch(p.ID)
		}
	}
	for _, pr := range s.prs {
		if pr.CreatedAt.After(since) {
			touch(pr.TargetPostID).prs++
		}
		if pr.Status == "merged" && pr.UpdatedAt.After(since) {
			touch(pr.TargetPostID).merges++
		}
	}
	type row struct {
		id    string
		sc    *score
		total int
	}
	rows := []row{}
	for id, sc := range by {
		if s.posts[id] == nil {
			continue
		}
		total := sc.forks*4 + sc.prs*3 + sc.cherries*3 + sc.merges*2
		if total <= 0 {
			continue
		}
		rows = append(rows, row{id, sc, total})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].total > rows[j].total })
	if len(rows) > 12 {
		rows = rows[:12]
	}
	out := []map[string]any{}
	for _, r := range rows {
		p := s.posts[r.id]
		s.refreshPost(p)
		out = append(out, map[string]any{
			"id":          p.ID,
			"subject":     p.Subject,
			"owner":       p.Owner,
			"shortSha":    p.ShortSHA,
			"headSha":     p.HeadSHA,
			"score":       r.total,
			"forks":       r.sc.forks,
			"prs":         r.sc.prs,
			"cherries":    r.sc.cherries,
			"merges":      r.sc.merges,
			"starCount":   len(p.Stars),
			"topics":      p.Topics,
			"forkIntent":  p.ForkIntent,
			"parentPostId": p.ParentPostID,
		})
	}
	return out
}

func (s *Store) Blame(id string) ([]map[string]any, error) {
	p := s.FindPost(id)
	if p == nil {
		return nil, errNotFound
	}
	hist, err := s.History(p.ID)
	if err != nil {
		return nil, err
	}
	type snap struct {
		c     CommitInfo
		paras []string
	}
	snaps := make([]snap, 0, len(hist))
	for _, c := range hist {
		raw, err := s.readBlob(p.ID, c.SHA)
		if err != nil {
			continue
		}
		_, body, _ := parsePostFile(raw)
		snaps = append(snaps, snap{c: c, paras: splitParagraphs(body)})
	}
	if len(snaps) == 0 {
		paras := splitParagraphs(p.Body)
		out := make([]map[string]any, 0, len(paras))
		for i, para := range paras {
			out = append(out, map[string]any{
				"index": i, "text": para, "author": p.Owner,
				"sha": p.HeadSHA, "shortSha": p.ShortSHA,
				"date": p.UpdatedAt, "subject": p.Subject,
			})
		}
		return out, nil
	}
	head := snaps[0]
	out := make([]map[string]any, 0, len(head.paras))
	for i, para := range head.paras {
		blamed := head.c
		for j := 1; j < len(snaps); j++ {
			found := false
			for _, prev := range snaps[j].paras {
				if prev == para {
					found = true
					break
				}
			}
			if found {
				blamed = snaps[j].c
			} else {
				break
			}
		}
		out = append(out, map[string]any{
			"index":    i,
			"text":     para,
			"author":   blamed.Author,
			"sha":      blamed.SHA,
			"shortSha": blamed.ShortSHA,
			"date":     blamed.Date,
			"subject":  blamed.Subject,
		})
	}
	return out, nil
}
