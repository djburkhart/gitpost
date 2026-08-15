package main

import (
	"log"
	"os"
	"path/filepath"
	"strings"
)

func (s *Store) SeedIfEmpty() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if u := s.byHandle["danny"]; u != nil {
		if u.Role != RoleSuperAdmin {
			u.Role = RoleSuperAdmin
			u.Disabled = false
			_ = s.save()
		}
		return nil
	}

	// Drop leftover demo identities if this store was previously seeded.
	demo := map[string]bool{"ada": true, "linus": true, "maya": true, "guest": true}
	for h, u := range s.byHandle {
		if demo[h] {
			delete(s.users, u.ID)
			delete(s.byHandle, h)
		}
	}

	pw := adminPassword(s.root)
	u := &User{
		ID:           idHex(8),
		Handle:       "danny",
		Name:         "Danny",
		Email:        "danny@gitpo.st",
		Bio:          "Super admin.",
		PasswordHash: hashPass(pw),
		Role:         RoleSuperAdmin,
		CreatedAt:    nowUTC(),
	}
	s.users[u.ID] = u
	s.byHandle["danny"] = u
	if s.settings.SignupMode == "" {
		s.settings.SignupMode = SignupInvite
	}
	if s.settings.MinPassword < 12 {
		s.settings.MinPassword = 12
	}
	s.auditUnlocked("system", "bootstrap", "danny", "seeded super admin")
	log.Printf("seeded super admin @danny — password in %s", filepath.Join(s.root, ".admin-password"))
	return s.save()
}

func adminPassword(root string) string {
	if v := strings.TrimSpace(os.Getenv("GITPOST_ADMIN_PASSWORD")); v != "" {
		return v
	}
	path := filepath.Join(root, ".admin-password")
	if b, err := os.ReadFile(path); err == nil {
		if pw := strings.TrimSpace(string(b)); pw != "" {
			return pw
		}
	}
	pw := randomPassword()
	_ = os.WriteFile(path, []byte(pw+"\n"), 0o600)
	return pw
}

func randomPassword() string {
	return strings.ToUpper(idHex(3)[:4]) + idHex(3)[:3] + "-" + idHex(4)[:5] + "-" + idHex(4)[:5] + "-" + idHex(4)[:5]
}
