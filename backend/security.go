package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	RoleSuperAdmin = "superadmin"
	RoleAdmin      = "admin"
	RoleMember     = "member"

	SignupInvite = "invite"
	SignupOpen   = "open"
	SignupClosed = "closed"

	pbkdf2Iter = 120000
	lockAfter  = 5
	lockFor    = 15 * time.Minute
)

var (
	errLocked        = errors.New("account locked")
	errDisabled      = errors.New("account disabled")
	errWeakPassword  = errors.New("password does not meet policy")
	errInviteReq     = errors.New("invite required")
	errInviteBad     = errors.New("invite invalid")
	errSignupClosed  = errors.New("registration is closed")
	errLastSuper     = errors.New("cannot modify the last super admin")
)

type Settings struct {
	SignupMode  string `json:"signupMode"`
	MinPassword int    `json:"minPassword"`
}

type Invite struct {
	Code      string     `json:"code"`
	CreatedBy string     `json:"createdBy"`
	UsedBy    string     `json:"usedBy,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt time.Time  `json:"expiresAt"`
	UsedAt    *time.Time `json:"usedAt,omitempty"`
}

type AuditEvent struct {
	ID        string    `json:"id"`
	Actor     string    `json:"actor"`
	Action    string    `json:"action"`
	Target    string    `json:"target"`
	Detail    string    `json:"detail"`
	CreatedAt time.Time `json:"createdAt"`
}

func nowUTC() time.Time { return time.Now().UTC() }

func (u *User) IsSuper() bool { return u != nil && u.Role == RoleSuperAdmin }
func (u *User) IsAdmin() bool { return u != nil && (u.Role == RoleAdmin || u.Role == RoleSuperAdmin) }

func (u User) Public() map[string]any {
	role := u.Role
	if role == "" {
		role = RoleMember
	}
	return map[string]any{
		"id":           u.ID,
		"handle":       u.Handle,
		"name":         u.Name,
		"email":        u.Email,
		"bio":          u.Bio,
		"role":         role,
		"disabled":     u.Disabled,
		"isAdmin":      u.IsAdmin(),
		"isSuperAdmin": u.IsSuper(),
		"createdAt":    u.CreatedAt,
	}
}

func hashPass(pw string) string {
	salt := make([]byte, 16)
	_, _ = hex.Decode(salt, []byte(idHex(8)))
	if n, _ := hex.Decode(salt, []byte(idHex(8))); n < 16 {
		copy(salt, []byte(idHex(16)))
	}
	salt = []byte(idHex(8))
	dk := pbkdf2(pw, salt, pbkdf2Iter, 32)
	return "pbkdf2$" + strconv.Itoa(pbkdf2Iter) + "$" + hex.EncodeToString(salt) + "$" + hex.EncodeToString(dk)
}

func checkPass(stored, pw string) bool {
	if stored == "" {
		return false
	}
	if strings.HasPrefix(stored, "pbkdf2$") {
		parts := strings.Split(stored, "$")
		if len(parts) != 4 {
			return false
		}
		iter, _ := strconv.Atoi(parts[1])
		salt, err1 := hex.DecodeString(parts[2])
		want, err2 := hex.DecodeString(parts[3])
		if err1 != nil || err2 != nil || iter < 1 {
			return false
		}
		got := pbkdf2(pw, salt, iter, len(want))
		return subtle.ConstantTimeCompare(got, want) == 1
	}
	sum := sha256.Sum256([]byte("gitpost:" + pw))
	legacy := hex.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(legacy), []byte(stored)) == 1
}

func pbkdf2(password string, salt []byte, iter, keyLen int) []byte {
	prf := func(in []byte) []byte {
		m := hmac.New(sha256.New, []byte(password))
		m.Write(in)
		return m.Sum(nil)
	}
	var out []byte
	block := 1
	for len(out) < keyLen {
		u := prf(append(append([]byte{}, salt...), byte(block>>24), byte(block>>16), byte(block>>8), byte(block)))
		t := append([]byte{}, u...)
		for i := 1; i < iter; i++ {
			u = prf(u)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		out = append(out, t...)
		block++
	}
	return out[:keyLen]
}

func validatePassword(pw string, min int) error {
	if min < 12 {
		min = 12
	}
	if len(pw) < min {
		return errWeakPassword
	}
	var letter, digit bool
	for _, r := range pw {
		if r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' {
			letter = true
		}
		if r >= '0' && r <= '9' {
			digit = true
		}
	}
	if !letter || !digit {
		return errWeakPassword
	}
	return nil
}

func (s *Store) Settings() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st := s.settings
	if st.SignupMode == "" {
		st.SignupMode = SignupInvite
	}
	if st.MinPassword < 12 {
		st.MinPassword = 12
	}
	return st
}

func (s *Store) UpdateSettings(actor *User, mode string, min int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !actor.IsAdmin() {
		return errForbidden
	}
	switch mode {
	case SignupInvite, SignupOpen, SignupClosed:
		s.settings.SignupMode = mode
	case "":
	default:
		return errBadRequest
	}
	if min >= 12 && min <= 64 {
		s.settings.MinPassword = min
	}
	s.auditUnlocked(actor.Handle, "settings.update", "", s.settings.SignupMode)
	return s.save()
}

func (s *Store) auditUnlocked(actor, action, target, detail string) {
	s.audits = append([]AuditEvent{{
		ID:        idHex(6),
		Actor:     actor,
		Action:    action,
		Target:    target,
		Detail:    detail,
		CreatedAt: nowUTC(),
	}}, s.audits...)
	if len(s.audits) > 400 {
		s.audits = s.audits[:400]
	}
}

func (s *Store) ListAudit(limit int) []AuditEvent {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if limit <= 0 || limit > len(s.audits) {
		limit = len(s.audits)
	}
	out := make([]AuditEvent, limit)
	copy(out, s.audits[:limit])
	return out
}

func (s *Store) ListUsers() []User {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]User, 0, len(s.users))
	for _, u := range s.users {
		cp := *u
		out = append(out, cp)
	}
	return out
}

func (s *Store) SetDisabled(actor *User, handle string, disabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !actor.IsAdmin() {
		return errForbidden
	}
	u := s.byHandle[strings.ToLower(handle)]
	if u == nil {
		return errNotFound
	}
	if u.IsSuper() {
		return errLastSuper
	}
	u.Disabled = disabled
	if disabled {
		for tok, sess := range s.sessions {
			if sess.UserID == u.ID {
				delete(s.sessions, tok)
			}
		}
	}
	act := "user.enable"
	if disabled {
		act = "user.disable"
	}
	s.auditUnlocked(actor.Handle, act, u.Handle, "")
	return s.save()
}

func (s *Store) DeleteUser(actor *User, handle string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !actor.IsSuper() {
		return errForbidden
	}
	u := s.byHandle[strings.ToLower(handle)]
	if u == nil {
		return errNotFound
	}
	if u.IsSuper() {
		return errLastSuper
	}
	for tok, sess := range s.sessions {
		if sess.UserID == u.ID {
			delete(s.sessions, tok)
		}
	}
	delete(s.users, u.ID)
	delete(s.byHandle, u.Handle)
	s.auditUnlocked(actor.Handle, "user.delete", u.Handle, "")
	return s.save()
}

func (s *Store) SetRole(actor *User, handle, role string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !actor.IsSuper() {
		return errForbidden
	}
	switch role {
	case RoleAdmin, RoleMember:
	default:
		return errBadRequest
	}
	u := s.byHandle[strings.ToLower(handle)]
	if u == nil {
		return errNotFound
	}
	if u.IsSuper() {
		return errLastSuper
	}
	u.Role = role
	s.auditUnlocked(actor.Handle, "user.role", u.Handle, role)
	return s.save()
}

func (s *Store) CreateInvite(actor *User, days int) (*Invite, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !actor.IsAdmin() {
		return nil, errForbidden
	}
	if days <= 0 || days > 90 {
		days = 14
	}
	inv := &Invite{
		Code:      idHex(10),
		CreatedBy: actor.Handle,
		CreatedAt: nowUTC(),
		ExpiresAt: nowUTC().Add(time.Duration(days) * 24 * time.Hour),
	}
	s.invites[inv.Code] = inv
	s.auditUnlocked(actor.Handle, "invite.create", inv.Code[:8], "")
	return inv, s.save()
}

func (s *Store) ListInvites() []Invite {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Invite, 0, len(s.invites))
	for _, i := range s.invites {
		out = append(out, *i)
	}
	return out
}

func (s *Store) RevokeInvite(actor *User, code string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !actor.IsAdmin() {
		return errForbidden
	}
	if s.invites[code] == nil {
		return errNotFound
	}
	delete(s.invites, code)
	s.auditUnlocked(actor.Handle, "invite.revoke", code[:min(8, len(code))], "")
	return s.save()
}

func (s *Store) consumeInvite(code string, handle string) error {
	code = strings.TrimSpace(code)
	if s.settings.SignupMode == SignupClosed {
		return errSignupClosed
	}
	if s.settings.SignupMode == SignupOpen {
		return nil
	}
	if code == "" {
		return errInviteReq
	}
	inv := s.invites[code]
	if inv == nil || inv.UsedBy != "" || inv.ExpiresAt.Before(nowUTC()) {
		return errInviteBad
	}
	t := nowUTC()
	inv.UsedBy = handle
	inv.UsedAt = &t
	return nil
}

func (s *Store) ChangePassword(u *User, current, next string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !checkPass(u.PasswordHash, current) {
		return errUnauthorized
	}
	if err := validatePassword(next, s.settings.MinPassword); err != nil {
		return err
	}
	live := s.users[u.ID]
	if live == nil {
		return errNotFound
	}
	live.PasswordHash = hashPass(next)
	for tok, sess := range s.sessions {
		if sess.UserID == u.ID {
			delete(s.sessions, tok)
		}
	}
	s.auditUnlocked(u.Handle, "password.change", u.Handle, "")
	return s.save()
}

func (s *Store) ListSessionsFor(userID string) []Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Session{}
	for _, sess := range s.sessions {
		if sess.UserID == userID && sess.ExpiresAt.After(nowUTC()) {
			cp := *sess
			out = append(out, cp)
		}
	}
	return out
}

func (s *Store) ListAllSessions() []Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Session{}
	for _, sess := range s.sessions {
		if sess.ExpiresAt.After(nowUTC()) {
			cp := *sess
			out = append(out, cp)
		}
	}
	return out
}

func (s *Store) RevokeSession(actor *User, token string, anyUser bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess := s.sessions[token]
	if sess == nil {
		return errNotFound
	}
	if sess.UserID != actor.ID && !(anyUser && actor.IsAdmin()) {
		return errForbidden
	}
	delete(s.sessions, token)
	s.auditUnlocked(actor.Handle, "session.revoke", sess.UserID, "")
	return s.save()
}

func (s *Store) RevokeAllSessions(userID, except string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for tok, sess := range s.sessions {
		if sess.UserID == userID && tok != except {
			delete(s.sessions, tok)
		}
	}
	_ = s.save()
}

func (s *Store) DeletePostAdmin(actor *User, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !actor.IsAdmin() {
		return errForbidden
	}
	p := s.posts[id]
	if p == nil {
		for _, x := range s.posts {
			if x.ID == id || strings.HasPrefix(x.HeadSHA, id) {
				p = x
				break
			}
		}
	}
	if p == nil {
		return errNotFound
	}
	delete(s.posts, p.ID)
	s.auditUnlocked(actor.Handle, "post.delete", p.ID, p.Subject)
	return s.save()
}

func clientIP(r *http.Request) string {
	if x := r.Header.Get("CF-Connecting-IP"); x != "" {
		return x
	}
	if x := r.Header.Get("X-Forwarded-For"); x != "" {
		return strings.Split(x, ",")[0]
	}
	return r.RemoteAddr
}

func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) *User {
	u := s.requireUser(w, r)
	if u == nil {
		return nil
	}
	if !u.IsAdmin() {
		writeErr(w, errForbidden)
		return nil
	}
	return u
}

func (s *Server) requireSuper(w http.ResponseWriter, r *http.Request) *User {
	u := s.requireUser(w, r)
	if u == nil {
		return nil
	}
	if !u.IsSuper() {
		writeErr(w, errForbidden)
		return nil
	}
	return u
}

func (s *Server) handleAuthConfig(w http.ResponseWriter, r *http.Request) {
	st := s.store.Settings()
	writeJSON(w, 200, map[string]any{
		"signupMode":  st.SignupMode,
		"minPassword": st.MinPassword,
	})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var in struct {
		Current string `json:"current"`
		Next    string `json:"next"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	if err := s.store.ChangePassword(u, in.Current, in.Next); err != nil {
		writeErr(w, err)
		return
	}
	tok, err := s.store.CreateSession(u.ID, r.UserAgent(), clientIP(r))
	if err != nil {
		writeErr(w, err)
		return
	}
	setSession(w, tok)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleMySessions(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	cur := ""
	if c, err := r.Cookie("gp_session"); err == nil {
		cur = c.Value
	}
	list := s.store.ListSessionsFor(u.ID)
	out := make([]map[string]any, 0, len(list))
	for _, sess := range list {
		out = append(out, map[string]any{
			"id":        sess.Token[:min(12, len(sess.Token))],
			"token":     sess.Token,
			"ip":        sess.IP,
			"userAgent": sess.UserAgent,
			"createdAt": sess.CreatedAt,
			"expiresAt": sess.ExpiresAt,
			"current":   sess.Token == cur,
		})
	}
	writeJSON(w, 200, map[string]any{"sessions": out})
}

func (s *Server) handleRevokeSession(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	if err := s.store.RevokeSession(u, r.PathValue("token"), false); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleRevokeAllSessions(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	except := ""
	if c, err := r.Cookie("gp_session"); err == nil {
		except = c.Value
	}
	s.store.RevokeAllSessions(u.ID, except)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleAdminOverview(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	users := s.store.ListUsers()
	disabled := 0
	admins := 0
	for _, u := range users {
		if u.Disabled {
			disabled++
		}
		if u.IsAdmin() {
			admins++
		}
	}
	writeJSON(w, 200, map[string]any{
		"users":     len(users),
		"disabled":  disabled,
		"admins":    admins,
		"posts":     len(s.store.Feed()),
		"sessions":  len(s.store.ListAllSessions()),
		"invites":   len(s.store.ListInvites()),
		"settings":  s.store.Settings(),
	})
}

func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	list := s.store.ListUsers()
	out := make([]map[string]any, 0, len(list))
	for _, u := range list {
		item := u.Public()
		item["failedLogins"] = u.FailedLogins
		item["lockedUntil"] = u.LockedUntil
		out = append(out, item)
	}
	writeJSON(w, 200, map[string]any{"users": out})
}

func (s *Server) handleAdminDisable(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	if err := s.store.SetDisabled(u, r.PathValue("handle"), true); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleAdminEnable(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	if err := s.store.SetDisabled(u, r.PathValue("handle"), false); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	u := s.requireSuper(w, r)
	if u == nil {
		return
	}
	if err := s.store.DeleteUser(u, r.PathValue("handle")); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleAdminRole(w http.ResponseWriter, r *http.Request) {
	u := s.requireSuper(w, r)
	if u == nil {
		return
	}
	var in struct {
		Role string `json:"role"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	if err := s.store.SetRole(u, r.PathValue("handle"), in.Role); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleAdminInvites(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	writeJSON(w, 200, map[string]any{"invites": s.store.ListInvites()})
}

func (s *Server) handleAdminCreateInvite(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	var in struct {
		Days int `json:"days"`
	}
	_ = readJSON(r, &in)
	inv, err := s.store.CreateInvite(u, in.Days)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"invite": inv})
}

func (s *Server) handleAdminRevokeInvite(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	if err := s.store.RevokeInvite(u, r.PathValue("code")); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleAdminAudit(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	writeJSON(w, 200, map[string]any{"events": s.store.ListAudit(200)})
}

func (s *Server) handleAdminSessions(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	list := s.store.ListAllSessions()
	out := make([]map[string]any, 0, len(list))
	for _, sess := range list {
		handle := ""
		if u := s.store.UserByID(sess.UserID); u != nil {
			handle = u.Handle
		}
		out = append(out, map[string]any{
			"token":     sess.Token,
			"handle":    handle,
			"ip":        sess.IP,
			"userAgent": sess.UserAgent,
			"createdAt": sess.CreatedAt,
			"expiresAt": sess.ExpiresAt,
		})
	}
	writeJSON(w, 200, map[string]any{"sessions": out})
}

func (s *Server) handleAdminRevokeSession(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	if err := s.store.RevokeSession(u, r.PathValue("token"), true); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleAdminSettings(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	if r.Method == http.MethodGet {
		writeJSON(w, 200, map[string]any{"settings": s.store.Settings()})
		return
	}
	var in struct {
		SignupMode  string `json:"signupMode"`
		MinPassword int    `json:"minPassword"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, errBadRequest)
		return
	}
	if err := s.store.UpdateSettings(u, in.SignupMode, in.MinPassword); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"settings": s.store.Settings()})
}

func (s *Server) handleAdminDeletePost(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	if err := s.store.DeletePostAdmin(u, r.PathValue("id")); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
