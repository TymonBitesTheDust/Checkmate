package app.tickwise;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Shows the reminder notification, and restores alarms after a reboot or update. */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Reminders.reschedule(c);
            return;
        }
        if (!Reminders.ACTION_REMIND.equals(action)) return;
        String id = intent.getStringExtra("id");
        if (id == null) return;
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        Reminders.ensureChannel(c);

        Intent open = new Intent(c, AppActivity.class);
        open.putExtra("taskId", id);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(c, id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, Reminders.CHANNEL) : new Notification.Builder(c);
        // The Google Play build has its own package name, and its resources may keep the code's.
        int icon = c.getResources().getIdentifier("ic_stat_tick", "drawable", c.getPackageName());
        if (icon == 0) icon = c.getResources().getIdentifier("ic_stat_tick", "drawable", "app.tickwise");
        b.setSmallIcon(icon)
                .setContentTitle(title == null || title.length() == 0 ? Strings.get(c, "task_due") : title)
                .setContentText(body == null ? "" : body)
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setColor(0xfff46b25)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true);
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        }
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(id.hashCode(), b.build());
    }
}
