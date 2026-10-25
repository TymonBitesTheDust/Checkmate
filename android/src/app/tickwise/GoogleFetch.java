package app.tickwise;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Docs & Sheets and subscribed calendars: reads a shared Google Doc or Sheet export, or
 * a calendar's .ics link, for the web app, which the page itself can't read because
 * those servers don't allow other sites to. Only https addresses at docs.google.com
 * and calendar links at Google, Outlook and iCloud are fetched (redirects may only go
 * on to the same company's hosts), nothing is signed in, and answers are capped in size.
 */
final class GoogleFetch {
    static final int MAX = 8 << 20;

    /** status 0 means refused or failed. */
    static final class Result {
        final int status;
        final String text;

        Result(int status, String text) {
            this.status = status;
            this.text = text;
        }
    }

    private GoogleFetch() {}

    static boolean startAllowed(URL u) {
        if (!"https".equals(u.getProtocol()) || u.getUserInfo() != null) return false;
        String h = u.getHost().toLowerCase();
        String p = u.getPath() == null ? "" : u.getPath().toLowerCase();
        if (h.equals("docs.google.com")) return true;
        if (h.equals("calendar.google.com")) return p.startsWith("/calendar/ical/");
        if (h.equals("outlook.office365.com") || h.equals("outlook.office.com") || h.equals("outlook.live.com")) return p.startsWith("/owa/calendar/");
        if (h.endsWith(".icloud.com")) return p.startsWith("/published/");
        return false;
    }

    /** Which company a host belongs to; redirects may only stay within one. */
    static String family(URL u) {
        if (!"https".equals(u.getProtocol()) || u.getUserInfo() != null) return "";
        String h = u.getHost().toLowerCase();
        if (h.equals("google.com") || h.endsWith(".google.com") || h.endsWith(".googleusercontent.com")) return "google";
        if (h.endsWith(".office365.com") || h.endsWith(".office.com") || h.equals("outlook.live.com")) return "microsoft";
        if (h.endsWith(".icloud.com")) return "apple";
        return "";
    }

    static boolean redirectAllowed(URL from, URL to) {
        String f = family(from);
        return f.length() > 0 && f.equals(family(to));
    }

    static Result get(String raw) {
        try {
            URL u = new URL(raw);
            final URL first = u;
            if (!startAllowed(u)) return new Result(0, "");
            for (int hop = 0; hop < 6; hop++) {
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                try {
                    c.setInstanceFollowRedirects(false);
                    c.setUseCaches(false);
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(25000);
                    c.setRequestProperty("User-Agent", "Checkmate/2.0 (Android)");
                    int code = c.getResponseCode();
                    if (code >= 300 && code < 400) {
                        String loc = c.getHeaderField("Location");
                        if (loc == null) return new Result(code, "");
                        u = new URL(u, loc);
                        if (!redirectAllowed(first, u)) return new Result(0, "");
                        continue;
                    }
                    InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                    return new Result(code, in == null ? "" : read(in));
                } finally {
                    c.disconnect();
                }
            }
        } catch (Exception ignored) {
            // offline, timed out, bad address: the page decides what to say
        }
        return new Result(0, "");
    }

    private static String read(InputStream in) throws Exception {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) {
                if (out.size() + n > MAX) break;
                out.write(buf, 0, n);
            }
            return new String(out.toByteArray(), "UTF-8");
        } finally {
            in.close();
        }
    }
}
