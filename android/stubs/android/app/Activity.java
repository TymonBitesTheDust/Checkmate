package android.app;
public class Activity extends android.content.Context {
  public static final int RESULT_OK = -1;
  protected void onCreate(android.os.Bundle b) {}
  protected void onNewIntent(android.content.Intent i) {}
  protected void onSaveInstanceState(android.os.Bundle b) {}
  protected void onPause() {}
  protected void onStop() {}
  protected void onResume() {}
  protected void onDestroy() {}
  protected void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {}
  public void onBackPressed() {}
  public void setContentView(android.view.View v) {}
  public android.view.Window getWindow() { return null; }
  public android.content.Intent getIntent() { return null; }
  public void setIntent(android.content.Intent i) {}
  public final void runOnUiThread(Runnable r) {}
  public void startActivityForResult(android.content.Intent i, int code) {}
  public final void requestPermissions(String[] p, int code) {}
  public void finish() {}
  public boolean moveTaskToBack(boolean nonRoot) { return false; }
  public android.content.res.AssetManager getAssets() { return null; }
  public android.content.res.Resources getResources() { return null; }
  public android.content.ContentResolver getContentResolver() { return null; }
  public Object getSystemService(String name) { return null; }
  public android.content.SharedPreferences getSharedPreferences(String name, int mode) { return null; }
  public String getPackageName() { return null; }
  public void startActivity(android.content.Intent intent) {}
  public int checkSelfPermission(String permission) { return 0; }
  public android.content.Context getApplicationContext() { return null; }
  public android.content.pm.PackageManager getPackageManager() { return null; }
}
