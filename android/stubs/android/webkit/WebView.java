package android.webkit;
public class WebView extends android.view.View {
  public WebView(android.content.Context c) {}
  public WebSettings getSettings() { return null; }
  public void setWebViewClient(WebViewClient c) {}
  public void setWebChromeClient(WebChromeClient c) {}
  public void addJavascriptInterface(Object o, String name) {}
  public void loadUrl(String url) {}
  public void evaluateJavascript(String script, ValueCallback<String> cb) {}
  public WebBackForwardList saveState(android.os.Bundle b) { return null; }
  public WebBackForwardList restoreState(android.os.Bundle b) { return null; }
  public void onPause() {}
  public void onResume() {}
  public void destroy() {}
  public String getUrl() { return null; }
}
