package android.net;
public abstract class Uri {
  public static Uri parse(String s) { return null; }
  public abstract String getHost();
  public abstract String getPath();
  public abstract String getScheme();
}
