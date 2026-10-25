package main

import (
	"net/url"
	"strings"
	"testing"
)

func TestFetchAllowed(t *testing.T) {
	ok := []string{
		"https://docs.google.com/spreadsheets/d/abc/gviz/tq?tqx=out:json",
		"https://DOCS.google.com/document/d/abc/export?format=md",
		"https://calendar.google.com/calendar/ical/someone%40gmail.com/private-abc/basic.ics",
		"https://calendar.google.com/calendar/ical/en.hong_kong%23holiday%40group.v.calendar.google.com/public/basic.ics",
		"https://outlook.office365.com/owa/calendar/abc@example.com/xyz/calendar.ics",
		"https://p34-caldav.icloud.com/published/2/abc",
	}
	bad := []string{
		"http://docs.google.com/document/d/abc/export?format=md",
		"https://docs.google.com.evil.example/x",
		"https://evil.example/?docs.google.com",
		"https://user@docs.google.com/x",
		"https://www.googleapis.com/drive/v3/files/abc",
		"https://calendar.google.com/calendar/u/0/r",
		"https://evil.example/calendar/ical/x.ics",
		"https://icloud.com.evil.example/published/2/abc",
		"https://outlook.office365.com/mail/",
		"https://127.0.0.1:47821/",
		"file:///C:/Windows/win.ini",
	}
	for _, s := range ok {
		u, _ := url.Parse(s)
		if !fetchAllowed(u) {
			t.Errorf("should allow %s", s)
		}
	}
	for _, s := range bad {
		u, _ := url.Parse(s)
		if fetchAllowed(u) {
			t.Errorf("should refuse %s", s)
		}
		if st, body := fetchText(s); st != 0 || body != "" {
			t.Errorf("fetchText(%s) = %d", s, st)
		}
	}
}

func TestRedirectHosts(t *testing.T) {
	for s, want := range map[string]bool{
		"https://doc-0s-4k-docs.googleusercontent.com/export/x": true,
		"https://accounts.google.com/ServiceLogin":              true,
		"https://notgoogle.com/":                                false,
		"https://googleusercontent.com.evil.example/":           false,
		"http://doc-0s-docs.googleusercontent.com/":             false,
	} {
		u, _ := url.Parse(s)
		if googleHost(u) != want {
			t.Errorf("googleHost(%s) != %v", s, want)
		}
	}
}

func TestRedirectFamilies(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{"https://calendar.google.com/calendar/ical/x/basic.ics", "https://calendar.google.com/calendar/ical/y/basic.ics", true},
		{"https://docs.google.com/x", "https://doc-0s.googleusercontent.com/y", true},
		{"https://p34-caldav.icloud.com/published/2/abc", "https://p35-caldav.icloud.com/published/2/abc", true},
		{"https://calendar.google.com/calendar/ical/x/basic.ics", "https://evil.example/", false},
		{"https://outlook.office365.com/owa/calendar/a/b.ics", "https://calendar.google.com/x", false},
		{"https://p34-caldav.icloud.com/published/2/abc", "http://p35-caldav.icloud.com/published/2/abc", false},
	}
	for _, c := range cases {
		a, _ := url.Parse(c.from)
		b, _ := url.Parse(c.to)
		if sameFamily(a, b) != c.want {
			t.Errorf("sameFamily(%s, %s) != %v", c.from, c.to, c.want)
		}
	}
}

func TestFetchReply(t *testing.T) {
	js := fetchReply("f1", 200, "line \"one\"\n</script>\u2028")
	if !strings.HasPrefix(js, `window.__twFetchDone&&window.__twFetchDone("f1",200,"line \"one\"\n\u003c/script\u003e\u2028")`) {
		t.Fatalf("unexpected %s", js)
	}
}
