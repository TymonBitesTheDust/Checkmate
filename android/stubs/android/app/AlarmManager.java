package android.app;
public class AlarmManager {
  public static final int RTC_WAKEUP = 0;
  public void set(int type, long at, PendingIntent op) {}
  public void setAndAllowWhileIdle(int type, long at, PendingIntent op) {}
  public void setExactAndAllowWhileIdle(int type, long at, PendingIntent op) {}
  public void cancel(PendingIntent op) {}
  public boolean canScheduleExactAlarms() { return false; }
}
