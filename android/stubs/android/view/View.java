package android.view;
public class View {
  public View() {}
  public View(android.content.Context c) {}
  public ViewGroup.LayoutParams getLayoutParams() { return null; }
  public void requestLayout() {}
  public static final int SYSTEM_UI_FLAG_LIGHT_STATUS_BAR = 0x2000;
  public static final int SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR = 0x10;
  public void setSystemUiVisibility(int v) {}
  public int getSystemUiVisibility() { return 0; }
  public void setBackgroundColor(int c) {}
  public void setPadding(int left, int top, int right, int bottom) {}
  public void setOnApplyWindowInsetsListener(OnApplyWindowInsetsListener l) {}
  public interface OnApplyWindowInsetsListener {
    WindowInsets onApplyWindowInsets(View v, WindowInsets insets);
  }
}
