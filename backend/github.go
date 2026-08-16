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
	reGHCommit  = regexp.MustCompile(`(?i)github\.com/([^/]+)/([^/]+)/commit/([0-9a-f]{7,40})`)
	reGHPR      = regexp.MustCompile(`(?i)github\.com/([^/]+)/([^/]+)/pull/(\d+)`)
	reGHIssue   = regexp.MustCompile(`(?i)github\.com/([^/]+)/([^/]+)/issues/(\d+)`)
	reGHRelease = regexp.MustCompile(`(?i)github\.com/([^/]+)/([^/]+)/releases/tag/([^/?#]+)`)
	reGHRepo    = regexp.MustCompile(`(?i)^(?:https?://github\.com/)?([^/\s]+)/([^/\s#?]+)`)
	reGLCommit  = regexp.MustCompile(`(?i)gitlab\.com/(.+)/-/commit/([0-9a-f]{7,40})`)
	reGLMR      = regexp.MustCompile(`(?i)gitlab\.com/(.+)/-/merge_requests/(\d+)`)
	reGLIssue   = regexp.MustCompile(`(?i)gitlab\.com/(.+)/-/issues/(\d+)`)
)

func FetchStory(rawURL string) (*Story, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return nil, errBadRequest
	}
	if m := reGHCommit.FindStringSubmatch(rawURL); m != nil {
		return fetchGHCommit(m[1], trimGit(m[2]), m[3], rawURL)
	}
	if m := reGHPR.FindStringSubmatch(rawURL); m != nil {
		return fetchGHPR(m[1], trimGit(m[2]), m[3], rawURL)
	}
	if m := reGHIssue.FindStringSubmatch(rawURL); m != nil {
		return fetchGHIssue(m[1], trimGit(m[2]), m[3], rawURL)
	}
	if m := reGHRelease.FindStringSubmatch(rawURL); m != nil {
		return fetchGHReleaseTag(m[1], trimGit(m[2]), m[3], rawURL)
	}
	if m := reGLCommit.FindStringSubmatch(rawURL); m != nil {
		return fetchGLCommit(m[1], m[2], rawURL)
	}
	if m := reGLMR.FindStringSubmatch(rawURL); m != nil {
		return fetchGLMR(m[1], m[2], rawURL)
	}
	if m := reGLIssue.FindStringSubmatch(rawURL); m != nil {
		return fetchGLIssue(m[1], m[2], rawURL)
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return nil, errBadRequest
	}
	return &Story{URL: rawURL, Provider: "link", HTMLURL: rawURL, Kind: "link", Message: rawURL}, nil
}

func trimGit(s string) string { return strings.TrimSuffix(s, ".git") }

func parseRepoRef(raw string) (owner, repo string, ok bool) {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "https://")
	raw = strings.TrimPrefix(raw, "http://")
	m := reGHRepo.FindStringSubmatch(raw)
	if m == nil {
		return "", "", false
	}
	return m[1], trimGit(m[2]), true
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

func clipPatch(s string, n int) string {
	if n <= 0 {
		n = 6000
	}
	if len(s) > n {
		return s[:n] + "\n…\n"
	}
	return s
}

func joinPatches(files []struct {
	Filename  string `json:"filename"`
	Patch     string `json:"patch"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}) (snippet string, listed []StoryFile) {
	var b strings.Builder
	for i, f := range files {
		if i >= 4 {
			break
		}
		listed = append(listed, StoryFile{Filename: f.Filename, Additions: f.Additions, Deletions: f.Deletions})
		if f.Patch == "" {
			continue
		}
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "diff --git a/%s b/%s\n", f.Filename, f.Filename)
		b.WriteString(f.Patch)
		if !strings.HasSuffix(f.Patch, "\n") {
			b.WriteByte('\n')
		}
	}
	return clipPatch(b.String(), 8000), listed
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
			Filename  string `json:"filename"`
			Patch     string `json:"patch"`
			Additions int    `json:"additions"`
			Deletions int    `json:"deletions"`
		} `json:"files"`
	}
	if err := fetchJSON(fmt.Sprintf("https://api.github.com/repos/%s/%s/commits/%s", owner, repo, sha), &payload); err != nil {
		return &Story{
			URL: raw, Provider: "github", Repo: owner + "/" + repo, SHA: sha, HTMLURL: raw,
			Kind: "commit", Message: "Could not fetch commit — saved the link.",
		}, nil
	}
	snip, files := joinPatches(payload.Files)
	return &Story{
		URL: raw, Provider: "github", Repo: owner + "/" + repo, SHA: payload.SHA,
		Kind: "commit", Message: payload.Commit.Message, Title: strings.Split(payload.Commit.Message, "\n")[0],
		Author: payload.Commit.Author.Name, Date: payload.Commit.Author.Date, HTMLURL: payload.HTMLURL,
		Additions: payload.Stats.Additions, Deletions: payload.Stats.Deletions, Snippet: snip, Files: files,
	}, nil
}

func fetchGHPR(owner, repo, num, raw string) (*Story, error) {
	var payload struct {
		Title   string `json:"title"`
		Body    string `json:"body"`
		HTMLURL string `json:"html_url"`
		State   string `json:"state"`
		Merged  bool   `json:"merged"`
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
			Kind: "pull", Number: num, Message: "Pull request " + num,
		}, nil
	}
	state := payload.State
	if payload.Merged {
		state = "merged"
	}
	var files []struct {
		Filename  string `json:"filename"`
		Patch     string `json:"patch"`
		Additions int    `json:"additions"`
		Deletions int    `json:"deletions"`
	}
	_ = fetchJSON(fmt.Sprintf("https://api.github.com/repos/%s/%s/pulls/%s/files?per_page=10", owner, repo, num), &files)
	snip, listed := joinPatches(files)
	return &Story{
		URL: raw, Provider: "github", Repo: owner + "/" + repo, SHA: payload.Head.SHA,
		Kind: "pull", Number: num, Title: payload.Title, State: state,
		Message: strings.TrimSpace(payload.Title + "\n\n" + payload.Body),
		Author:  payload.User.Login, HTMLURL: payload.HTMLURL,
		Additions: payload.Additions, Deletions: payload.Deletions, Snippet: snip, Files: listed,
	}, nil
}

func fetchGHIssue(owner, repo, num, raw string) (*Story, error) {
	var payload struct {
		Title   string `json:"title"`
		Body    string `json:"body"`
		HTMLURL string `json:"html_url"`
		State   string `json:"state"`
		User    struct {
			Login string `json:"login"`
		} `json:"user"`
		PullRequest *struct {
			HTMLURL string `json:"html_url"`
		} `json:"pull_request"`
	}
	if err := fetchJSON(fmt.Sprintf("https://api.github.com/repos/%s/%s/issues/%s", owner, repo, num), &payload); err != nil {
		return &Story{
			URL: raw, Provider: "github", Repo: owner + "/" + repo, HTMLURL: raw,
			Kind: "issue", Number: num, Message: "Issue " + num,
		}, nil
	}
	if payload.PullRequest != nil {
		return fetchGHPR(owner, repo, num, raw)
	}
	return &Story{
		URL: raw, Provider: "github", Repo: owner + "/" + repo,
		Kind: "issue", Number: num, Title: payload.Title, State: payload.State,
		Message: strings.TrimSpace(payload.Title + "\n\n" + payload.Body),
		Author:  payload.User.Login, HTMLURL: payload.HTMLURL,
	}, nil
}

func fetchGHReleaseTag(owner, repo, tag, raw string) (*Story, error) {
	rel, err := FetchGHRelease(owner, repo, tag)
	if err != nil || rel == nil {
		return &Story{
			URL: raw, Provider: "github", Repo: owner + "/" + repo, HTMLURL: raw,
			Kind: "release", Title: tag, Message: tag,
		}, nil
	}
	rel.URL = raw
	return rel, nil
}

type ghRelease struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	HTMLURL     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
	Draft       bool   `json:"draft"`
	Prerelease  bool   `json:"prerelease"`
	Author      struct {
		Login string `json:"login"`
	} `json:"author"`
}

func FetchGHRelease(owner, repo, tag string) (*Story, error) {
	path := "latest"
	if tag != "" && tag != "latest" {
		path = "tags/" + url.PathEscape(tag)
	}
	var payload ghRelease
	if err := fetchJSON(fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/%s", owner, repo, path), &payload); err != nil {
		return nil, err
	}
	title := payload.Name
	if title == "" {
		title = payload.TagName
	}
	return &Story{
		Provider: "github", Repo: owner + "/" + repo, Kind: "release",
		Title: title, Message: strings.TrimSpace(title + "\n\n" + payload.Body),
		Author: payload.Author.Login, Date: payload.PublishedAt, HTMLURL: payload.HTMLURL,
		Number: payload.TagName, State: "published", URL: payload.HTMLURL,
	}, nil
}

func ListGHReleases(owner, repo string, n int) ([]ghRelease, error) {
	if n <= 0 || n > 10 {
		n = 5
	}
	var list []ghRelease
	err := fetchJSON(fmt.Sprintf("https://api.github.com/repos/%s/%s/releases?per_page=%d", owner, repo, n), &list)
	return list, err
}

func fetchGLJSON(u string, dest any) error {
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "gitpo.st")
	client := &http.Client{Timeout: 8 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("gitlab %d", res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(dest)
}

func glProject(path string) string {
	return url.PathEscape(strings.Trim(path, "/"))
}

func fetchGLCommit(project, sha, raw string) (*Story, error) {
	var payload struct {
		ID      string `json:"id"`
		Title   string `json:"title"`
		Message string `json:"message"`
		Author  string `json:"author_name"`
		Date    string `json:"authored_date"`
		WebURL  string `json:"web_url"`
		Stats   struct {
			Additions int `json:"additions"`
			Deletions int `json:"deletions"`
		} `json:"stats"`
	}
	if err := fetchGLJSON(fmt.Sprintf("https://gitlab.com/api/v4/projects/%s/repository/commits/%s", glProject(project), sha), &payload); err != nil {
		return &Story{
			URL: raw, Provider: "gitlab", Repo: project, SHA: sha, HTMLURL: raw,
			Kind: "commit", Message: "GitLab commit",
		}, nil
	}
	html := payload.WebURL
	if html == "" {
		html = raw
	}
	return &Story{
		URL: raw, Provider: "gitlab", Repo: project, SHA: payload.ID, Kind: "commit",
		Title: payload.Title, Message: payload.Message, Author: payload.Author, Date: payload.Date,
		HTMLURL: html, Additions: payload.Stats.Additions, Deletions: payload.Stats.Deletions,
	}, nil
}

func fetchGLMR(project, num, raw string) (*Story, error) {
	var payload struct {
		Title        string `json:"title"`
		Description  string `json:"description"`
		State        string `json:"state"`
		WebURL       string `json:"web_url"`
		SHA          string `json:"sha"`
		Author       struct{ Username string `json:"username"` } `json:"author"`
	}
	if err := fetchGLJSON(fmt.Sprintf("https://gitlab.com/api/v4/projects/%s/merge_requests/%s", glProject(project), num), &payload); err != nil {
		return &Story{URL: raw, Provider: "gitlab", Repo: project, Kind: "pull", Number: num, HTMLURL: raw, Message: "Merge request " + num}, nil
	}
	return &Story{
		URL: raw, Provider: "gitlab", Repo: project, Kind: "pull", Number: num,
		Title: payload.Title, State: payload.State, SHA: payload.SHA,
		Message: strings.TrimSpace(payload.Title + "\n\n" + payload.Description),
		Author: payload.Author.Username, HTMLURL: payload.WebURL,
	}, nil
}

func fetchGLIssue(project, num, raw string) (*Story, error) {
	var payload struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		State       string `json:"state"`
		WebURL      string `json:"web_url"`
		Author      struct{ Username string `json:"username"` } `json:"author"`
	}
	if err := fetchGLJSON(fmt.Sprintf("https://gitlab.com/api/v4/projects/%s/issues/%s", glProject(project), num), &payload); err != nil {
		return &Story{URL: raw, Provider: "gitlab", Repo: project, Kind: "issue", Number: num, HTMLURL: raw, Message: "Issue " + num}, nil
	}
	return &Story{
		URL: raw, Provider: "gitlab", Repo: project, Kind: "issue", Number: num,
		Title: payload.Title, State: payload.State,
		Message: strings.TrimSpace(payload.Title + "\n\n" + payload.Description),
		Author: payload.Author.Username, HTMLURL: payload.WebURL,
	}, nil
}

func storyToBridge(st *Story, actor, direction string) Bridge {
	if st == nil {
		return Bridge{}
	}
	kind := st.Kind
	if kind == "" || kind == "link" {
		return Bridge{}
	}
	title := st.Title
	if title == "" {
		title = strings.Split(st.Message, "\n")[0]
	}
	return Bridge{
		URL:       st.URL,
		Provider:  st.Provider,
		Repo:      st.Repo,
		Kind:      kind,
		Number:    st.Number,
		Title:     title,
		State:     st.State,
		SHA:       st.SHA,
		HTMLURL:   st.HTMLURL,
		Direction: direction,
		CreatedBy: actor,
		CreatedAt: time.Now().UTC(),
	}
}
