package android.content.pm;
public abstract class PackageManager {
  public static final int PERMISSION_GRANTED = 0;
  public static final int COMPONENT_ENABLED_STATE_DEFAULT = 0;
  public static final int COMPONENT_ENABLED_STATE_ENABLED = 1;
  public static final int COMPONENT_ENABLED_STATE_DISABLED = 2;
  public static final int DONT_KILL_APP = 1;
  public abstract void setComponentEnabledSetting(android.content.ComponentName name, int state, int flags);
}
