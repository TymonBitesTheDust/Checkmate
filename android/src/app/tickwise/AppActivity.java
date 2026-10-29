package app.tickwise;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import org.json.JSONObject;

import java.io.OutputStream;

/** Hosts the Checkmate web app in a WebView served from a private https origin. */
public class AppActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/index.html";
    static final int REQ_FILE = 41;
    static final int REQ_SAVE = 42;
    static final int REQ_NOTIFICATIONS = 43;
    static final int REQ_SAVE_BINARY = 44;

    FrameLayout frame;
    WebView web;
    ValueCallback<Uri[]> fileCallback;
    String pendingSave;
    String pendingBinary;
    final java.util.Map<String, OutputStream> binaryOut = new java.util.HashMap<String, OutputStream>();
    String pendingTask;
    boolean pageLoaded;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Reminders.ensureChannel(this);

        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int bg = Color.parseColor(dark ? "#151917" : "#ffffff");
        web = new WebView(this);
        web.setBackgroundColor(bg);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false); // short UI sounds made in the page
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " CheckmateAndroid/2.0");
        web.setWebViewClient(new AppWebClient(this));
        web.setWebChromeClient(new AppChromeClient(this));
        web.addJavascriptInterface(new Bridge(this), "TickwiseNative");
        // Android 15+ draws the app behind the status and navigation bars, so the page sits
        // inside a frame padded by the bars (and the keyboard), and the frame's colour shows behind them.
        frame = new FrameLayout(this);
        frame.setBackgroundColor(bg);
        frame.addView(web, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= 35) {
            frame.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                    Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                    v.setPadding(i.left, i.top, i.right, i.bottom);
                    return WindowInsets.CONSUMED;
                }
            });
        }
        setContentView(frame);
        // Android 13+ sends Back here instead of onBackPressed (enableOnBackInvokedCallback in the manifest).
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, new OnBackInvokedCallback() {
                @Override
                public void onBackInvoked() {
                    goBack();
                }
            });
        }

        if (state != null) web.restoreState(state);
        if (web.getUrl() == null) web.loadUrl(START_URL);
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    void handleIntent(Intent intent) {
        if (intent == null) return;
        String id = intent.getStringExtra("taskId");
        if (id == null) return;
        pendingTask = id;
        if (pageLoaded) openPendingTask();
    }

    void onPageLoaded() {
        pageLoaded = true;
        openPendingTask();
    }

    void openPendingTask() {
        if (pendingTask == null || web == null) return;
        String js = "window.tickwiseOpenTask && window.tickwiseOpenTask(" + JSONObject.quote(pendingTask) + ")";
        pendingTask = null;
        web.evaluateJavascript(js, null);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        goBack();
    }

    void goBack() {
        if (web == null) {
            leave();
            return;
        }
        web.evaluateJavascript("(window.appBack && window.appBack()) ? 1 : 0", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (!"1".equals(value)) leave();
            }
        });
    }

    void leave() {
        moveTaskToBack(true);
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("window.__tickwiseFlush && window.__tickwiseFlush()", null);
            web.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onStop() {
        LauncherIcons.applyPending(getApplicationContext());
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        web = null;
        super.onDestroy();
    }

    // ---------------------------------------------------------------- files

    boolean chooseFile(ValueCallback<Uri[]> cb, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = cb;
        try {
            startActivityForResult(params.createIntent(), REQ_FILE);
            return true;
        } catch (Exception e) {
            fileCallback = null;
            return false;
        }
    }

    void saveFile(String name, String mime, String content) {
        pendingSave = content;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(mime == null || mime.length() == 0 ? "application/octet-stream" : mime);
        i.putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(i, REQ_SAVE);
        } catch (Exception e) {
            pendingSave = null;
            Toast.makeText(this, Strings.get(this, "no_file_app"), Toast.LENGTH_LONG).show();
        }
    }

    // A task's file, saved where the user chooses. The page sends the bytes in pieces
    // (saveChunk) once the place is picked, so large files never sit in one string.
    void saveBinary(String token, String name, String mime) {
        pendingBinary = token;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(mime == null || mime.length() == 0 ? "application/octet-stream" : mime);
        i.putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(i, REQ_SAVE_BINARY);
        } catch (Exception e) {
            pendingBinary = null;
            Toast.makeText(this, Strings.get(this, "no_file_app"), Toast.LENGTH_LONG).show();
            saveReady(token, false);
        }
    }

    private void saveReady(String token, boolean ok) {
        if (web == null || token == null) return;
        web.evaluateJavascript("window.__cmSaveReady && window.__cmSaveReady('" + token.replaceAll("[^A-Za-z0-9_-]", "") + "'," + ok + ")", null);
    }

    boolean writeChunk(String token, String b64) {
        OutputStream out;
        synchronized (binaryOut) {
            out = binaryOut.get(token);
        }
        if (out == null) return false;
        try {
            out.write(Base64.decode(b64, Base64.DEFAULT));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    void finishSave(String token, final boolean ok) {
        OutputStream out;
        synchronized (binaryOut) {
            out = binaryOut.remove(token);
        }
        boolean closed = false;
        if (out != null) {
            try {
                out.close();
                closed = true;
            } catch (Exception e) {
                closed = false;
            }
        }
        final boolean good = ok && closed;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(AppActivity.this, Strings.get(AppActivity.this, good ? "file_saved" : "save_failed"), good ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_SAVE_BINARY) {
            String token = pendingBinary;
            pendingBinary = null;
            boolean ok = false;
            if (resultCode == RESULT_OK && data != null && data.getData() != null && token != null) {
                try {
                    OutputStream out = getContentResolver().openOutputStream(data.getData());
                    if (out != null) {
                        synchronized (binaryOut) {
                            binaryOut.put(token, out);
                        }
                        ok = true;
                    }
                } catch (Exception e) {
                    ok = false;
                }
            }
            saveReady(token, ok);
            return;
        }
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        } else if (requestCode == REQ_SAVE) {
            String content = pendingSave;
            pendingSave = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null || content == null) return;
            try {
                OutputStream out = getContentResolver().openOutputStream(data.getData());
                out.write(content.getBytes("UTF-8"));
                out.close();
                Toast.makeText(this, Strings.get(this, "backup_saved"), Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, Strings.get(this, "save_failed"), Toast.LENGTH_LONG).show();
            }
        }
    }

    // ---------------------------------------------------------------- system bars

    void setSystemBars(String color, boolean lightBackground) {
        int c;
        try {
            c = Color.parseColor(color);
        } catch (Exception e) {
            return;
        }
        Window w = getWindow();
        w.setStatusBarColor(c);
        w.setNavigationBarColor(c);
        if (frame != null) frame.setBackgroundColor(c); // what shows behind the bars on Android 15+
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController ic = w.getInsetsController();
            if (ic != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                ic.setSystemBarsAppearance(lightBackground ? mask : 0, mask);
            }
        } else {
            View decor = w.getDecorView();
            int flags = decor.getSystemUiVisibility();
            int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | (Build.VERSION.SDK_INT >= 26 ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0);
            decor.setSystemUiVisibility(lightBackground ? (flags | light) : (flags & ~light));
        }
    }

    // ---------------------------------------------------------------- notifications permission

    void askForNotifications() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") == 0) return;
        SharedPreferences sp = getSharedPreferences("tickwise", MODE_PRIVATE);
        if (sp.getBoolean("askedNotifications", false)) return;
        sp.edit().putBoolean("askedNotifications", true).apply();
        requestPermissions(new String[] {"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIFICATIONS);
    }
}
