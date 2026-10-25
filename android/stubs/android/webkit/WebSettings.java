package android.webkit;
public abstract class WebSettings {
  public abstract void setJavaScriptEnabled(boolean b);
  public abstract void setDomStorageEnabled(boolean b);
  public abstract void setAllowFileAccess(boolean b);
  public abstract void setAllowContentAccess(boolean b);
  public abstract void setMediaPlaybackRequiresUserGesture(boolean b);
  public abstract void setSupportMultipleWindows(boolean b);
  public abstract String getUserAgentString();
  public abstract void setUserAgentString(String ua);
}
