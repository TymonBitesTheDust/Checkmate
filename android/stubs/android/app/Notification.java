package android.app;
public class Notification {
  public static final String CATEGORY_REMINDER = "reminder";
  public static final int PRIORITY_HIGH = 1;
  public static final int DEFAULT_ALL = -1;
  public static class Builder {
    public Builder(android.content.Context c) {}
    public Builder(android.content.Context c, String channelId) {}
    public Builder setSmallIcon(int icon) { return this; }
    public Builder setContentTitle(CharSequence t) { return this; }
    public Builder setContentText(CharSequence t) { return this; }
    public Builder setContentIntent(PendingIntent i) { return this; }
    public Builder setAutoCancel(boolean b) { return this; }
    public Builder setColor(int c) { return this; }
    public Builder setCategory(String c) { return this; }
    public Builder setPriority(int p) { return this; }
    public Builder setDefaults(int d) { return this; }
    public Builder setWhen(long w) { return this; }
    public Builder setShowWhen(boolean b) { return this; }
    public Notification build() { return null; }
  }
}
