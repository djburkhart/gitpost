package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errNotFound):
		writeJSON(w, 404, map[string]string{"error": "not found"})
	case errors.Is(err, errUnauthorized):
		writeJSON(w, 401, map[string]string{"error": "unauthorized"})
	case errors.Is(err, errForbidden):
		writeJSON(w, 403, map[string]string{"error": "forbidden"})
	case errors.Is(err, errProtectedMain):
		writeJSON(w, 403, map[string]string{"error": "main is protected — open a pull request"})
	case errors.Is(err, errReviewsPending):
		writeJSON(w, 409, map[string]string{"error": "requested reviews are still pending"})
	case errors.Is(err, errDraftPR):
		writeJSON(w, 409, map[string]string{"error": "this is still a draft — mark it ready after reviews"})
	case errors.Is(err, errUnresolved):
		writeJSON(w, 400, map[string]string{"error": "resolve the conflict markers before merging"})
	case errors.Is(err, errBadRequest):
		writeJSON(w, 400, map[string]string{"error": "bad request"})
	case errors.Is(err, errLocked):
		writeJSON(w, 429, map[string]string{"error": "account temporarily locked"})
	case errors.Is(err, errDisabled):
		writeJSON(w, 403, map[string]string{"error": "account disabled"})
	case errors.Is(err, errWeakPassword):
		writeJSON(w, 400, map[string]string{"error": "password must be at least 12 characters and include a letter and a number"})
	case errors.Is(err, errInviteReq):
		writeJSON(w, 400, map[string]string{"error": "an invite code is required"})
	case errors.Is(err, errInviteBad):
		writeJSON(w, 400, map[string]string{"error": "invite code is invalid or expired"})
	case errors.Is(err, errSignupClosed):
		writeJSON(w, 403, map[string]string{"error": "registration is closed"})
	case errors.Is(err, errLastSuper):
		writeJSON(w, 403, map[string]string{"error": "cannot modify the super admin"})
	case errors.Is(err, errAlreadyApplied):
		writeJSON(w, 409, map[string]string{"error": "that commit is already in this history"})
	case errors.Is(err, errCherryConflict):
		writeJSON(w, 409, map[string]string{"error": "cherry-pick conflicted with the current tip"})
	case errors.Is(err, errGitFailed):
		writeJSON(w, 400, map[string]string{"error": "that git action failed"})
	case errors.Is(err, errParagraphDrift):
		writeJSON(w, 409, map[string]string{"error": "that paragraph has changed since this proposal"})
	default:
		writeJSON(w, 500, map[string]string{"error": err.Error()})
	}
}

func readJSON(r *http.Request, dest any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	return dec.Decode(dest)
}

func (s *Server) currentUser(r *http.Request) *User {
	c, err := r.Cookie("gp_session")
	if err != nil || c.Value == "" {
		return nil
	}
	u := s.store.UserBySession(c.Value)
	if u != nil && u.Disabled {
		return nil
	}
	return u
}

func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) *User {
	u := s.currentUser(r)
	if u == nil {
		writeErr(w, errUnauthorized)
	}
	return u
}

func setSession(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     "gp_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   30 * 24 * 3600,
	})
}

func clearSession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     "gp_session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Handle   string `json:"handle"`
		Name     string `json:"name"`
		Email    string `json:"email"`
		Bio      string `json:"bio"`
		Password string `json:"password"`
		Invite   string `json:"invite"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	if err := validatePassword(in.Password, s.store.Settings().MinPassword); err != nil {
		writeErr(w, err)
		return
	}
	u, err := s.store.RegisterUser(in.Handle, in.Name, in.Email, in.Bio, in.Password, in.Invite)
	if err != nil {
		writeErr(w, err)
		return
	}
	tok, err := s.store.CreateSession(u.ID, r.UserAgent(), clientIP(r))
	if err != nil {
		writeErr(w, err)
		return
	}
	setSession(w, tok)
	writeJSON(w, 201, map[string]any{"user": u.Public()})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Handle   string `json:"handle"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	u, err := s.store.Authenticate(in.Handle, in.Password)
	if err != nil {
		writeErr(w, err)
		return
	}
	tok, err := s.store.CreateSession(u.ID, r.UserAgent(), clientIP(r))
	if err != nil {
		writeErr(w, err)
		return
	}
	setSession(w, tok)
	writeJSON(w, 200, map[string]any{"user": u.Public()})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("gp_session"); err == nil {
		s.store.DeleteSession(c.Value)
	}
	clearSession(w)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	if u == nil {
		writeJSON(w, 200, map[string]any{"user": nil})
		return
	}
	writeJSON(w, 200, map[string]any{"user": u.Public()})
}

func postPayload(p *Post, viewer *User) map[string]any {
	starred, watched := false, false
	if viewer != nil {
		for _, h := range p.Stars {
			if h == viewer.Handle {
				starred = true
			}
		}
		for _, h := range p.Watchers {
			if h == viewer.Handle {
				watched = true
			}
		}
	}
	return map[string]any{
		"id":            p.ID,
		"owner":         p.Owner,
		"headSha":       p.HeadSHA,
		"shortSha":      p.ShortSHA,
		"subject":       p.Subject,
		"slug":          p.Slug,
		"body":          p.Body,
		"parentPostId":   p.ParentPostID,
		"forkedFromSha":  p.ForkedFromSHA,
		"forkIntent":     p.ForkIntent,
		"forkIntentNote": p.ForkIntentNote,
		"storyUrl":      p.StoryURL,
		"story":         p.Story,
		"starCount":     len(p.Stars),
		"watchCount":    len(p.Watchers),
		"stars":         p.Stars,
		"watchers":      p.Watchers,
		"starred":       starred,
		"watched":       watched,
		"defaultBranch": p.DefaultBranch,
		"createdAt":     p.CreatedAt,
		"updatedAt":     p.UpdatedAt,
		"commitCount":   p.CommitCount,
		"forkCount":     p.ForkCount,
		"topics":        p.Topics,
		"coAuthors":     p.CoAuthors,
		"coAuthorInvites": p.CoAuthorInvites,
		"maintainers":   p.Maintainers,
		"protected":     p.Protected,
		"reviewers":     p.Reviewers,
		"canPush":       canPushUser(p, viewer),
		"invited":       viewer != nil && containsHandle(p.CoAuthorInvites, viewer.Handle),
	}
}

func (s *Server) handleFeed(w http.ResponseWriter, r *http.Request) {
	viewer := s.currentUser(r)
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	topic := normalizeTopic(r.URL.Query().Get("topic"))
	if topic == "" && strings.HasPrefix(q, "remote:") {
		topic = normalizeTopic(q)
		q = ""
	}
	followed := r.URL.Query().Get("followed") == "1"
	var remotes []string
	if followed && viewer != nil {
		remotes = s.store.RemotesFor(viewer.Handle)
	}
	feed := s.store.Feed()
	out := []map[string]any{}
	for i := range feed {
		p := feed[i]
		if topic != "" && !postHasTopic(&p, topic) {
			continue
		}
		if followed {
			hit := false
			for _, t := range remotes {
				if postHasTopic(&p, t) {
					hit = true
					break
				}
			}
			if !hit {
				continue
			}
		}
		if q != "" {
			blob := strings.ToLower(p.Subject + " " + p.Body + " " + p.Owner + " " + strings.Join(p.Topics, " "))
			if !strings.Contains(blob, q) {
				continue
			}
		}
		item := postPayload(&p, viewer)
		delete(item, "body")
		out = append(out, item)
	}
	writeJSON(w, 200, map[string]any{"posts": out, "topic": topic, "remotes": remotes})
}

func (s *Server) handleGetPost(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	p := s.store.FindPost(id)
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	writeJSON(w, 200, map[string]any{"post": postPayload(p, s.currentUser(r))})
}

func (s *Server) handleCreatePost(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var in struct {
		Subject  string   `json:"subject"`
		Body     string   `json:"body"`
		StoryURL string   `json:"storyUrl"`
		Topics   []string `json:"topics"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	var story *Story
	if strings.TrimSpace(in.StoryURL) != "" {
		st, err := FetchStory(in.StoryURL)
		if err == nil {
			story = st
		} else {
			story = &Story{URL: in.StoryURL, Provider: "link", HTMLURL: in.StoryURL}
		}
	}
	p, err := s.store.CreatePost(u, in.Subject, in.Body, in.StoryURL, story, in.Topics, time.Time{})
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"post": postPayload(p, u)})
}

func (s *Server) handleUpdatePost(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	var in struct {
		Subject  string   `json:"subject"`
		Body     string   `json:"body"`
		StoryURL string   `json:"storyUrl"`
		Topics   []string `json:"topics"`
		Signoff  *bool    `json:"signoff"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	story := p.Story
	if in.StoryURL != "" && in.StoryURL != p.StoryURL {
		if st, err := FetchStory(in.StoryURL); err == nil {
			story = st
		}
	}
	signoff := true
	if in.Signoff != nil {
		signoff = *in.Signoff
	}
	np, err := s.store.AmendPost(p.ID, u, in.Subject, in.Body, story, in.Topics, signoff)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"post": postPayload(np, u)})
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	hist, err := s.store.History(p.ID)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"commits": hist})
}

func (s *Server) handleDiff(w http.ResponseWriter, r *http.Request) {
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	diff, err := s.store.Diff(p.ID, from, to)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"diff": diff, "from": from, "to": to})
}

func (s *Server) handleBlob(w http.ResponseWriter, r *http.Request) {
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	raw, err := s.store.Blob(p.ID, r.URL.Query().Get("sha"))
	if err != nil {
		writeErr(w, err)
		return
	}
	sub, body, story := parsePostFile(raw)
	writeJSON(w, 200, map[string]any{"subject": sub, "body": body, "story": story, "raw": raw})
}

func (s *Server) handleStar(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	np, err := s.store.ToggleStar(p.ID, u.Handle)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"post": postPayload(np, u)})
}

func (s *Server) handleWatch(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	np, err := s.store.ToggleWatch(p.ID, u.Handle)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"post": postPayload(np, u)})
}

func (s *Server) handleFork(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	var in struct {
		Intent string `json:"intent"`
		Note   string `json:"note"`
	}
	_ = readJSON(r, &in)
	np, err := s.store.Fork(p.ID, u, in.Intent, in.Note)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"post": postPayload(np, u)})
}

func (s *Server) handleForks(w http.ResponseWriter, r *http.Request) {
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	list := s.store.ListTakes(p.ID)
	if r.URL.Query().Get("children") == "1" {
		list = s.store.ListForks(p.ID)
	}
	viewer := s.currentUser(r)
	out := []map[string]any{}
	for i := range list {
		item := postPayload(&list[i], viewer)
		delete(item, "body")
		out = append(out, item)
	}
	writeJSON(w, 200, map[string]any{"forks": out, "takes": out})
}

func (s *Server) handleDiverge(w http.ResponseWriter, r *http.Request) {
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	data, err := s.store.Diverge(p.ID, r.URL.Query().Get("against"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, data)
}

func (s *Server) handleParagraphs(w http.ResponseWriter, r *http.Request) {
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	paras := splitParagraphs(p.Body)
	out := make([]map[string]any, 0, len(paras))
	for i, t := range paras {
		out = append(out, map[string]any{"index": i, "text": t})
	}
	writeJSON(w, 200, map[string]any{"paragraphs": out})
}

func (s *Server) handleBranches(w http.ResponseWriter, r *http.Request) {
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	list, err := s.store.Branches(p.ID)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"branches": list})
}

func (s *Server) handleCreateBranch(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	var in struct {
		Name string `json:"name"`
		From string `json:"from"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	b, err := s.store.CreateBranch(p.ID, in.Name, in.From, u)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"branch": b})
}

func (s *Server) handleCheckout(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	if err := s.store.CheckoutBranch(p.ID, in.Name, u); err != nil {
		writeErr(w, err)
		return
	}
	np := s.store.FindPost(p.ID)
	writeJSON(w, 200, map[string]any{"post": postPayload(np, u)})
}

func (s *Server) handleCherryPick(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	var in struct {
		SHA      string `json:"sha"`
		SourceID string `json:"sourceId"`
	}
	if err := readJSON(r, &in); err != nil || in.SHA == "" {
		writeErr(w, errBadRequest)
		return
	}
	var (
		np  *Post
		err error
	)
	if in.SourceID != "" && in.SourceID != p.ID {
		np, err = s.store.CherryPickFrom(p.ID, in.SourceID, in.SHA, u)
	} else {
		np, err = s.store.CherryPick(p.ID, in.SHA, u)
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"post": postPayload(np, u)})
}

func (s *Server) handleCreatePR(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var in struct {
		Title          string `json:"title"`
		Body           string `json:"body"`
		SourceID       string `json:"sourceId"`
		TargetID       string `json:"targetId"`
		Kind           string `json:"kind"`
		ParagraphIndex int    `json:"paragraphIndex"`
		Original       string `json:"original"`
		Proposed       string `json:"proposed"`
		Rationale      string `json:"rationale"`
	}
	if err := readJSON(r, &in); err != nil || in.TargetID == "" {
		writeErr(w, errBadRequest)
		return
	}
	if in.Kind != "paragraph" && in.SourceID == "" {
		writeErr(w, errBadRequest)
		return
	}
	pr, err := s.store.OpenPR(u, in.Title, in.Body, in.SourceID, in.TargetID, in.Kind, in.ParagraphIndex, in.Original, in.Proposed, in.Rationale)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"pr": pr})
}

func (s *Server) handleListPRs(w http.ResponseWriter, r *http.Request) {
	postID := r.URL.Query().Get("post")
	writeJSON(w, 200, map[string]any{"prs": s.store.ListPRs(postID)})
}

func (s *Server) handleGetPR(w http.ResponseWriter, r *http.Request) {
	pr := s.store.GetPR(r.PathValue("id"))
	if pr == nil {
		writeErr(w, errNotFound)
		return
	}
	diff, _ := s.store.PRDiff(pr)
	src := s.store.FindPost(pr.SourcePostID)
	dst := s.store.FindPost(pr.TargetPostID)
	viewer := s.currentUser(r)
	var srcP, dstP any
	if src != nil {
		srcP = postPayload(src, viewer)
	}
	if dst != nil {
		dstP = postPayload(dst, viewer)
	}
	writeJSON(w, 200, map[string]any{"pr": pr, "diff": diff, "source": srcP, "target": dstP})
}

func (s *Server) handleMergePR(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	pr := s.store.GetPR(r.PathValue("id"))
	if pr == nil {
		writeErr(w, errNotFound)
		return
	}
	np, err := s.store.MergePR(pr.ID, u)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"pr": np})
}

func (s *Server) handleClosePR(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	pr := s.store.GetPR(r.PathValue("id"))
	if pr == nil {
		writeErr(w, errNotFound)
		return
	}
	var in struct {
		Note string `json:"note"`
	}
	_ = readJSON(r, &in)
	np, err := s.store.ClosePR(pr.ID, u, in.Note)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"pr": np})
}

func (s *Server) handleCommentPR(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	pr := s.store.GetPR(r.PathValue("id"))
	if pr == nil {
		writeErr(w, errNotFound)
		return
	}
	var in struct {
		Body string `json:"body"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	np, err := s.store.CommentPR(pr.ID, u, in.Body)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"pr": np})
}

func (s *Server) handleUser(w http.ResponseWriter, r *http.Request) {
	handle := r.PathValue("handle")
	u := s.store.UserByHandle(handle)
	if u == nil {
		writeErr(w, errNotFound)
		return
	}
	posts := s.store.UserLog(handle)
	viewer := s.currentUser(r)
	items := []map[string]any{}
	for i := range posts {
		item := postPayload(&posts[i], viewer)
		delete(item, "body")
		items = append(items, item)
	}
	writeJSON(w, 200, map[string]any{"user": u.Public(), "posts": items})
}

func (s *Server) handleCherryPickExcerpt(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var in struct {
		SourceID string `json:"sourceId"`
		DestID   string `json:"destId"`
		Excerpt  string `json:"excerpt"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	src := in.SourceID
	if src == "" {
		src = r.PathValue("id")
	}
	p, err := s.store.CherryPickExcerpt(in.DestID, src, in.Excerpt, u)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"post": postPayload(p, u)})
}

func (s *Server) handleListComments(w http.ResponseWriter, r *http.Request) {
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	writeJSON(w, 200, map[string]any{"comments": s.store.ListComments(p.ID)})
}

func (s *Server) handleAddComment(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var in struct {
		Body     string `json:"body"`
		ParentID string `json:"parentId"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	c, err := s.store.AddComment(r.PathValue("id"), in.ParentID, in.Body, u)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"comment": c})
}

func (s *Server) handleBranchDiscussion(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	b, err := s.store.BranchDiscussion(r.PathValue("id"), r.PathValue("cid"), u)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"branch": b})
}

func (s *Server) handleInviteCoAuthor(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var in struct {
		Handle string `json:"handle"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	p, err := s.store.InviteCoAuthor(r.PathValue("id"), in.Handle, u)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"post": postPayload(p, u)})
}

func (s *Server) handleAcceptCoAuthor(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	p, err := s.store.AcceptCoAuthor(r.PathValue("id"), u)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"post": postPayload(p, u)})
}

func (s *Server) handleRemoveCoAuthor(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	p, err := s.store.RemoveCoAuthor(r.PathValue("id"), r.PathValue("handle"), u)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"post": postPayload(p, u)})
}

func (s *Server) handleProtect(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var in struct {
		Protected   bool     `json:"protected"`
		Maintainers []string `json:"maintainers"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	p, err := s.store.SetProtection(r.PathValue("id"), in.Protected, in.Maintainers, u)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"post": postPayload(p, u)})
}

func (s *Server) handleRequestReview(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var in struct {
		Handle string `json:"handle"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	kind := "post"
	if strings.Contains(r.URL.Path, "/api/prs/") {
		kind = "pr"
	}
	if err := s.store.RequestReview(kind, r.PathValue("id"), in.Handle, u.Handle); err != nil {
		writeErr(w, err)
		return
	}
	if kind == "pr" {
		writeJSON(w, 200, map[string]any{"pr": s.store.GetPR(r.PathValue("id"))})
		return
	}
	p := s.store.FindPost(r.PathValue("id"))
	writeJSON(w, 200, map[string]any{"post": postPayload(p, u)})
}

func (s *Server) handleSubmitReview(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var in struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	kind := "post"
	if strings.Contains(r.URL.Path, "/api/prs/") {
		kind = "pr"
	}
	if err := s.store.SubmitReview(kind, r.PathValue("id"), in.Status, in.Note, u); err != nil {
		writeErr(w, err)
		return
	}
	if kind == "pr" {
		writeJSON(w, 200, map[string]any{"pr": s.store.GetPR(r.PathValue("id"))})
		return
	}
	p := s.store.FindPost(r.PathValue("id"))
	writeJSON(w, 200, map[string]any{"post": postPayload(p, u)})
}

func (s *Server) handleResolvePR(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var in struct {
		Body string `json:"body"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	pr, err := s.store.ResolvePR(r.PathValue("id"), in.Body, u)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"pr": pr})
}

func (s *Server) handleGraph(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.store.Graph())
}

func (s *Server) handleTrending(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"trending": s.store.Trending(7 * 24 * time.Hour)})
}

func (s *Server) handleTopics(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"topics": s.store.TopicStats()})
}

func (s *Server) handleListRemotes(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	writeJSON(w, 200, map[string]any{"remotes": s.store.RemotesFor(u.Handle)})
}

func (s *Server) handleFollowRemote(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var in struct {
		Topic string `json:"topic"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	list, err := s.store.FollowRemote(u.Handle, in.Topic)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"remotes": list})
}

func (s *Server) handleUnfollowRemote(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	list, err := s.store.UnfollowRemote(u.Handle, r.PathValue("topic"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"remotes": list})
}

func (s *Server) handleBlame(w http.ResponseWriter, r *http.Request) {
	p := s.store.FindPost(r.PathValue("id"))
	if p == nil {
		writeErr(w, errNotFound)
		return
	}
	rows, err := s.store.Blame(p.ID)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"blame": rows})
}

func (s *Server) handleStoryPreview(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("url")
	st, err := FetchStory(raw)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"story": st})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "service": "gitpo.st", "time": time.Now().UTC()})
}

func (s *Server) handleStats(_ http.ResponseWriter, _ *http.Request) {}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
