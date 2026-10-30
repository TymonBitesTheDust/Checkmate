package android.view;
public class ViewGroup extends View {
  public void addView(View child, LayoutParams params) {}
  public static class LayoutParams {
    public static final int MATCH_PARENT = -1;
    public int width, height;
    public LayoutParams(int width, int height) {}
  }
}
