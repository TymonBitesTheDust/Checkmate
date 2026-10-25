package android.content;
public class Intent {
  public static final String ACTION_VIEW = "android.intent.action.VIEW";
  public static final String ACTION_CREATE_DOCUMENT = "android.intent.action.CREATE_DOCUMENT";
  public static final String ACTION_BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED";
  public static final String ACTION_MY_PACKAGE_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED";
  public static final String CATEGORY_OPENABLE = "android.intent.category.OPENABLE";
  public static final String EXTRA_TITLE = "android.intent.extra.TITLE";
  public static final int FLAG_ACTIVITY_NEW_TASK = 0x10000000;
  public static final int FLAG_ACTIVITY_SINGLE_TOP = 0x20000000;
  public static final int FLAG_ACTIVITY_CLEAR_TOP = 0x04000000;
  public Intent(String action, android.net.Uri uri) {}
  public Intent(String action) {}
  public Intent(Context c, Class<?> cls) {}
  public Intent putExtra(String name, String value) { return this; }
  public String getStringExtra(String name) { return null; }
  public String getAction() { return null; }
  public Intent setFlags(int flags) { return this; }
  public Intent addCategory(String c) { return this; }
  public Intent setType(String t) { return this; }
  public Intent setAction(String a) { return this; }
  public android.net.Uri getData() { return null; }
}
