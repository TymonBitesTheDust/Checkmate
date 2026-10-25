package main

// Docs & Sheets and subscribed calendars: the web page can't read a Google Doc or Sheet
// export, or a Google Calendar .ics link, itself, because those servers don't let
// other sites read their answers. The app reads them for it. Only https addresses at
// docs.google.com and calendar links at Google, Outlook and iCloud are fetched
// (redirects may only go on to the same company's hosts), no cookies or sign-in are
// sent, and answers are capped in size.

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxFetch = 8 << 20

var fetchClient = &http.Client{
	Timeout: 25 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 6 {
			return errors.New("too many redirects")
		}
		if len(via) == 0 || !sameFamily(via[0].URL, req.URL) {
			return errors.New("redirect to another site")
		}
		return nil
	},
}

// fetchAllowed: where a fetch may start.
func fetchAllowed(u *url.URL) bool {
	if u == nil || u.Scheme != "https" || u.User != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	p := strings.ToLower(u.EscapedPath())
	switch {
	case h == "docs.google.com":
		return true
	case h == "calendar.google.com":
		return strings.HasPrefix(p, "/calendar/ical/")
	case h == "outlook.office365.com" || h == "outlook.office.com" || h == "outlook.live.com":
		return strings.HasPrefix(p, "/owa/calendar/")
	case strings.HasSuffix(h, ".icloud.com"):
		return strings.HasPrefix(p, "/published/")
	}
	return false
}

// family groups the hosts a redirect may move between.
func family(u *url.URL) string {
	if u == nil || u.Scheme != "https" || u.User != nil {
		return ""
	}
	if googleHost(u) {
		return "google"
	}
	h := strings.ToLower(u.Hostname())
	if strings.HasSuffix(h, ".office365.com") || strings.HasSuffix(h, ".office.com") || h == "outlook.live.com" {
		return "microsoft"
	}
	if strings.HasSuffix(h, ".icloud.com") {
		return "apple"
	}
	return ""
}

func sameFamily(from, to *url.URL) bool {
	f := family(from)
	return f != "" && f == family(to)
}

// googleHost: where a redirect may lead.
func googleHost(u *url.URL) bool {
	if u == nil || u.Scheme != "https" || u.User != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	return h == "google.com" || strings.HasSuffix(h, ".google.com") || strings.HasSuffix(h, ".googleusercontent.com")
}

// fetchText returns the HTTP status and body, or status 0 if it was refused or failed.
func fetchText(raw string) (int, string) {
	u, err := url.Parse(raw)
	if err != nil || !fetchAllowed(u) {
		return 0, ""
	}
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return 0, ""
	}
	req.Header.Set("User-Agent", "Checkmate/2.0 (Windows)")
	resp, err := fetchClient.Do(req)
	if err != nil {
		return 0, ""
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxFetch))
	if err != nil {
		return 0, ""
	}
	return resp.StatusCode, string(b)
}

// fetchReply is the script that hands the answer back to the page.
func fetchReply(id string, status int, text string) string {
	q := func(s string) string {
		b, _ := json.Marshal(s)
		return string(b)
	}
	return "window.__twFetchDone&&window.__twFetchDone(" + q(id) + "," + strconv.Itoa(status) + "," + q(text) + ")"
}
