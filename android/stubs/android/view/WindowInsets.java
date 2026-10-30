package android.view;
public final class WindowInsets {
  public static final WindowInsets CONSUMED = null;
  public android.graphics.Insets getInsets(int typeMask) { return null; }
  public static final class Type {
    public static int systemBars() { return 0; }
    public static int displayCutout() { return 0; }
    public static int ime() { return 0; }
  }
}
