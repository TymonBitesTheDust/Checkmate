package android.view;
public abstract class Window {
  public abstract void setStatusBarColor(int c);
  public abstract void setNavigationBarColor(int c);
  public abstract View getDecorView();
  public WindowInsetsController getInsetsController() { return null; }
}
