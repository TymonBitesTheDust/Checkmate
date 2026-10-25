package app.tickwise;

import android.net.Uri;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

/** Lets <input type="file"> open the system file picker (used to restore backups). */
class AppChromeClient extends WebChromeClient {
    private final AppActivity activity;

    AppChromeClient(AppActivity activity) {
        this.activity = activity;
    }

    @Override
    public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        return activity.chooseFile(callback, params);
    }
}
