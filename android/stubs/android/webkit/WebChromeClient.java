package android.webkit;
public class WebChromeClient {
  public boolean onShowFileChooser(WebView v, ValueCallback<android.net.Uri[]> cb, FileChooserParams p) { return false; }
  public abstract static class FileChooserParams {
    public abstract android.content.Intent createIntent();
    public static android.net.Uri[] parseResult(int resultCode, android.content.Intent data) { return null; }
  }
}
