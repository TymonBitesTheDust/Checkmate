package app.tickwise;

import android.content.Intent;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/** Serves bundled assets from https://appassets.androidplatform.net and sends other links to the browser. */
class AppWebClient extends WebViewClient {
    private final AppActivity activity;

    AppWebClient(AppActivity activity) {
        this.activity = activity;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (!AppActivity.HOST.equals(url.getHost())) return null;
        String path = url.getPath();
        if (path == null || path.length() <= 1) path = "/index.html";
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Cache-Control", "no-cache");
        headers.put("X-Content-Type-Options", "nosniff");
        try {
            InputStream in = activity.getAssets().open(path.substring(1));
            return new WebResourceResponse(mimeFor(path), "UTF-8", 200, "OK", headers, in);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", headers, new ByteArrayInputStream(new byte[0]));
        }
    }

    static String mimeFor(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (AppActivity.HOST.equals(url.getHost())) return false;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, url);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
        } catch (Exception ignored) {
        }
        return true;
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        activity.onPageLoaded();
    }
}
