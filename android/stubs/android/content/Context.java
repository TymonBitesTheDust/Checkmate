package android.content;
public abstract class Context {
  public static final String CLIPBOARD_SERVICE = "clipboard";
  public static final String ALARM_SERVICE = "alarm";
  public static final String NOTIFICATION_SERVICE = "notification";
  public static final int MODE_PRIVATE = 0;
  public abstract android.content.res.AssetManager getAssets();
  public abstract android.content.res.Resources getResources();
  public abstract ContentResolver getContentResolver();
  public abstract Object getSystemService(String name);
  public abstract SharedPreferences getSharedPreferences(String name, int mode);
  public abstract String getPackageName();
  public abstract void startActivity(Intent intent);
  public abstract int checkSelfPermission(String permission);
  public abstract Context getApplicationContext();
  public abstract android.content.pm.PackageManager getPackageManager();
}
