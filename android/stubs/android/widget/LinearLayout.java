package android.widget;
public class LinearLayout extends android.view.ViewGroup {
  public static final int VERTICAL = 1;
  public LinearLayout(android.content.Context c) {}
  public void setOrientation(int orientation) {}
  public static class LayoutParams extends android.view.ViewGroup.LayoutParams {
    public LayoutParams(int width, int height, float weight) { super(width, height); }
  }
}
