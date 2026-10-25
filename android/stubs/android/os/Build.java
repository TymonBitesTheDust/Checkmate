package android.os;
public class Build {
  public static class VERSION {
    // Not a compile-time constant on purpose, so javac reads the real value at runtime.
    public static final int SDK_INT = Integer.parseInt("0");
  }
}
