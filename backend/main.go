package main

import (
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Server struct {
	store     *Store
	staticDir string
}

func main() {
	data := env("GITPOST_DATA", "/workspace/data")
	addr := env("GITPOST_ADDR", "127.0.0.1:8090")
	static := env("GITPOST_STATIC", "")

	store, err := NewStore(data)
	if err != nil {
		log.Fatal(err)
	}
	if err := store.SeedIfEmpty(); err != nil {
		log.Fatalf("seed: %v", err)
	}

	s := &Server{store: store, staticDir: static}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/auth/me", s.handleMe)
	mux.HandleFunc("GET /api/auth/config", s.handleAuthConfig)
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("POST /api/security/password", s.handleChangePassword)
	mux.HandleFunc("GET /api/security/sessions", s.handleMySessions)
	mux.HandleFunc("DELETE /api/security/sessions/{token}", s.handleRevokeSession)
	mux.HandleFunc("POST /api/security/sessions/revoke-all", s.handleRevokeAllSessions)

	mux.HandleFunc("GET /api/admin/overview", s.handleAdminOverview)
	mux.HandleFunc("GET /api/admin/users", s.handleAdminUsers)
	mux.HandleFunc("POST /api/admin/users/{handle}/disable", s.handleAdminDisable)
	mux.HandleFunc("POST /api/admin/users/{handle}/enable", s.handleAdminEnable)
	mux.HandleFunc("DELETE /api/admin/users/{handle}", s.handleAdminDeleteUser)
	mux.HandleFunc("POST /api/admin/users/{handle}/role", s.handleAdminRole)
	mux.HandleFunc("GET /api/admin/invites", s.handleAdminInvites)
	mux.HandleFunc("POST /api/admin/invites", s.handleAdminCreateInvite)
	mux.HandleFunc("DELETE /api/admin/invites/{code}", s.handleAdminRevokeInvite)
	mux.HandleFunc("GET /api/admin/audit", s.handleAdminAudit)
	mux.HandleFunc("GET /api/admin/sessions", s.handleAdminSessions)
	mux.HandleFunc("DELETE /api/admin/sessions/{token}", s.handleAdminRevokeSession)
	mux.HandleFunc("GET /api/admin/settings", s.handleAdminSettings)
	mux.HandleFunc("PUT /api/admin/settings", s.handleAdminSettings)
	mux.HandleFunc("DELETE /api/admin/posts/{id}", s.handleAdminDeletePost)

	mux.HandleFunc("GET /api/feed", s.handleFeed)
	mux.HandleFunc("POST /api/posts", s.handleCreatePost)
	mux.HandleFunc("GET /api/posts/{id}", s.handleGetPost)
	mux.HandleFunc("PUT /api/posts/{id}", s.handleUpdatePost)
	mux.HandleFunc("GET /api/posts/{id}/history", s.handleHistory)
	mux.HandleFunc("GET /api/posts/{id}/diff", s.handleDiff)
	mux.HandleFunc("GET /api/posts/{id}/blob", s.handleBlob)
	mux.HandleFunc("POST /api/posts/{id}/star", s.handleStar)
	mux.HandleFunc("POST /api/posts/{id}/watch", s.handleWatch)
	mux.HandleFunc("POST /api/posts/{id}/fork", s.handleFork)
	mux.HandleFunc("GET /api/posts/{id}/forks", s.handleForks)
	mux.HandleFunc("GET /api/posts/{id}/diverge", s.handleDiverge)
	mux.HandleFunc("GET /api/posts/{id}/paragraphs", s.handleParagraphs)
	mux.HandleFunc("GET /api/posts/{id}/branches", s.handleBranches)
	mux.HandleFunc("POST /api/posts/{id}/branches", s.handleCreateBranch)
	mux.HandleFunc("POST /api/posts/{id}/checkout", s.handleCheckout)
	mux.HandleFunc("POST /api/posts/{id}/cherry-pick", s.handleCherryPick)

	mux.HandleFunc("GET /api/prs", s.handleListPRs)
	mux.HandleFunc("POST /api/prs", s.handleCreatePR)
	mux.HandleFunc("GET /api/prs/{id}", s.handleGetPR)
	mux.HandleFunc("POST /api/prs/{id}/merge", s.handleMergePR)
	mux.HandleFunc("POST /api/prs/{id}/close", s.handleClosePR)
	mux.HandleFunc("POST /api/prs/{id}/comment", s.handleCommentPR)

	mux.HandleFunc("GET /api/users/{handle}", s.handleUser)
	mux.HandleFunc("GET /api/story/preview", s.handleStoryPreview)

	var handler http.Handler = withCORS(withLog(mux))
	if static != "" {
		handler = s.withStatic(handler)
	}

	log.Printf("gitpo.st api on %s (data=%s static=%s)", addr, data, static)
	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 8 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}

func (s *Server) withStatic(api http.Handler) http.Handler {
	root := os.DirFS(s.staticDir)
	fileServer := http.FileServer(http.FS(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			api.ServeHTTP(w, r)
			return
		}
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(root, p); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}
		// SPA fallback
		f, err := root.Open("index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.Copy(w, f)
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func withLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Truncate(time.Millisecond))
	})
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func abs(p string) string {
	a, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return a
}
