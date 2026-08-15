package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var (
	reGHCommit = regexp.MustCompile(`(?i)github\.com/([^/]+)/([^/]+)/commit/([0-9a-f]{7,40})`)
	reGHPR     = regexp.MustCompile(`(?i)github\.com/([^/]+)/([^/]+)/pull/(\d+)`)
	reGLCommit = regexp.MustCompile(`(?i)gitlab\.com/(.+)/-/commit/([0-9a-f]{7,40})`)
)

func FetchStory(rawURL string) (*Story, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return nil, errBadRequest
	}
	if m := reGHCommit.FindStringSubmatch(rawURL); m != nil {
		return fetchGHCommit(m[1], strings.TrimSuffix(m[2], ".git"), m[3], rawURL)
	}
	if m := reGHPR.FindStringSubmatch(rawURL); m != nil {
		return fetchGHPR(m[1], strings.TrimSuffix(m[2], ".git"), m[3], rawURL)
	}
	if m := reGLCommit.FindStringSubmatch(rawURL); m != nil {
		return &Story{
			URL:      rawURL,
			Provider: "gitlab",
			Repo:     m[1],
			SHA:      m[2],
			HTMLURL:  rawURL,
			Message:  "GitLab commit",
		}, nil
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return nil, errBadRequest
	}
	return &Story{URL: rawURL, Provider: "link", HTMLURL: rawURL, Message: rawURL}, nil
}

func fetchJSON(u string, dest any) error {
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "gitpo.st")
	client := &http.Client{Timeout: 8 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return fmt.Errorf("github %d: %s", res.StatusCode, strings.TrimSpace(string(b)))
	}
	return json.NewDecoder(res.Body).Decode(dest)
}

func fetchGHCommit(owner, repo, sha, raw string) (*Story, error) {
	var payload struct {
		SHA     string `json:"sha"`
		HTMLURL string `json:"html_url"`
		Commit  struct {
			Message string `json:"message"`
			Author  struct {
				Name string `json:"name"`
				Date string `json:"date"`
			} `json:"author"`
		} `json:"commit"`
		Stats struct {
			Additions int `json:"additions"`
			Deletions int `json:"deletions"`
		} `json:"stats"`
		Files []struct {
			Filename string `json:"filename"`
			Patch    string `json:"patch"`
		} `json:"files"`
	}
	if err := fetchJSON(fmt.Sprintf("https://api.github.com/repos/%s/%s/commits/%s", owner, repo, sha), &payload); err != nil {
		// still return a usable stub so compose never dies
		return &Story{
			URL: raw, Provider: "github", Repo: owner + "/" + repo, SHA: sha, HTMLURL: raw,
			Message: "Could not fetch commit — saved the link.",
		}, nil
	}
	snippet := ""
	if len(payload.Files) > 0 {
		snippet = payload.Files[0].Patch
		if len(snippet) > 4000 {
			snippet = snippet[:4000]
		}
	}
	msg := payload.Commit.Message
	return &Story{
		URL:       raw,
		Provider:  "github",
		Repo:      owner + "/" + repo,
		SHA:       payload.SHA,
		Message:   msg,
		Author:    payload.Commit.Author.Name,
		Date:      payload.Commit.Author.Date,
		HTMLURL:   payload.HTMLURL,
		Additions: payload.Stats.Additions,
		Deletions: payload.Stats.Deletions,
		Snippet:   snippet,
	}, nil
}

func fetchGHPR(owner, repo, num, raw string) (*Story, error) {
	var payload struct {
		Title   string `json:"title"`
		Body    string `json:"body"`
		HTMLURL string `json:"html_url"`
		User    struct {
			Login string `json:"login"`
		} `json:"user"`
		Head struct {
			SHA string `json:"sha"`
		} `json:"head"`
		Additions int `json:"additions"`
		Deletions int `json:"deletions"`
	}
	if err := fetchJSON(fmt.Sprintf("https://api.github.com/repos/%s/%s/pulls/%s", owner, repo, num), &payload); err != nil {
		return &Story{
			URL: raw, Provider: "github", Repo: owner + "/" + repo, HTMLURL: raw,
			Message: "Pull request " + num,
		}, nil
	}
	return &Story{
		URL:       raw,
		Provider:  "github",
		Repo:      owner + "/" + repo,
		SHA:       payload.Head.SHA,
		Message:   payload.Title + "\n\n" + payload.Body,
		Author:    payload.User.Login,
		HTMLURL:   payload.HTMLURL,
		Additions: payload.Additions,
		Deletions: payload.Deletions,
	}, nil
}
