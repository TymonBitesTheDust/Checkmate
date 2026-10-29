package app.tickwise;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import org.json.JSONObject;

/** window.TickwiseNative: small set of calls the web app makes into Android. */
class Bridge {
    private final AppActivity activity;

    Bridge(AppActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String platform() {
        return "android";
    }

    @JavascriptInterface
    public void setSystemBars(final String color, final boolean lightBackground) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.setSystemBars(color, lightBackground);
            }
        });
    }

    @JavascriptInterface
    public void copyText(final String text) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Checkmate", text));
            }
        });
    }

    @JavascriptInterface
    public void saveFile(final String name, final String mime, final String content) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.saveFile(name, mime, content);
            }
        });
    }

    @JavascriptInterface
    public void saveBinary(final String token, final String name, final String mime) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.saveBinary(token, name, mime);
            }
        });
    }

    @JavascriptInterface
    public boolean saveChunk(String token, String base64) {
        return activity.writeChunk(token, base64);
    }

    @JavascriptInterface
    public void saveDone(String token, boolean ok) {
        activity.finishSave(token, ok);
    }

    @JavascriptInterface
    public void scheduleReminders(final String json) {
        final int count = Reminders.schedule(activity.getApplicationContext(), json);
        if (count > 0) {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    activity.askForNotifications();
                }
            });
        }
    }

    /** Remembers which home-screen icon to show; applied when the app goes to the background. */
    @JavascriptInterface
    public void setLauncherIcon(final String style) {
        LauncherIcons.request(activity.getApplicationContext(), style);
    }

    /** The app's interface language, for the words Android shows itself. */
    @JavascriptInterface
    public void setLanguage(final String lang) {
        Strings.setLanguage(activity.getApplicationContext(), lang);
        Reminders.ensureChannel(activity.getApplicationContext());
    }

    /**
     * Docs & Sheets: reads a shared Google Doc/Sheet in the background and answers with
     * window.__twFetchDone(id, status, text), so the page never waits on the network.
     */
    @JavascriptInterface
    public void fetchText(final String id, final String url) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                GoogleFetch.Result r = GoogleFetch.get(url);
                final String js = "window.__twFetchDone&&window.__twFetchDone(" + JSONObject.quote(id) + "," + r.status + "," + JSONObject.quote(r.text) + ")";
                activity.runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (activity.web != null) activity.web.evaluateJavascript(js, null);
                    }
                });
            }
        }, "tickwise-fetch").start();
    }

    /**
     * Opens a web link in the browser picked in Settings → General → Open links with
     * ("chrome", "edge" or "firefox"); anything else, or a browser that isn't installed,
     * uses the phone's default.
     */
    @JavascriptInterface
    public void openUrl(final String url, final String browser) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                String pkg = browserPackage(browser);
                if (pkg != null && open(url, pkg)) return;
                open(url, null);
            }
        });
    }

    static String browserPackage(String browser) {
        if ("chrome".equals(browser)) return "com.android.chrome";
        if ("edge".equals(browser)) return "com.microsoft.emmx";
        if ("firefox".equals(browser)) return "org.mozilla.firefox";
        return null;
    }

    private boolean open(String url, String pkg) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            if (pkg != null) i.setPackage(pkg);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public void toast(final String text) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(activity, text, Toast.LENGTH_SHORT).show();
            }
        });
    }
}
