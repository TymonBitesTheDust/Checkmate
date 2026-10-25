package app.tickwise;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;

/** Keeps one alarm per upcoming timed task so reminders fire with the app closed. */
final class Reminders {
    static final String CHANNEL = "reminders";
    static final String ACTION_REMIND = "app.tickwise.REMIND";
    private static final String PREFS = "reminders";
    private static final String KEY = "list";
    private static final int MAX = 60;

    private Reminders() {}

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        // Creating it again with the same id just renames it.
        NotificationChannel ch = new NotificationChannel(CHANNEL, Strings.get(c, "channel_name"), NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(Strings.get(c, "channel_desc"));
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);
    }

    /** Replaces every scheduled reminder with the given JSON list. Returns how many are set. */
    static synchronized int schedule(Context c, String json) {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        cancelAll(c, sp.getString(KEY, "[]"));
        sp.edit().putString(KEY, json == null ? "[]" : json).apply();
        return setAll(c, json);
    }

    /** After a reboot or app update, alarms are gone: set them again. */
    static synchronized void reschedule(Context c) {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        setAll(c, sp.getString(KEY, "[]"));
    }

    private static PendingIntent pending(Context c, int slot, String id, String title, String body) {
        Intent i = new Intent(c, ReminderReceiver.class);
        i.setAction(ACTION_REMIND);
        if (id != null) {
            i.putExtra("id", id);
            i.putExtra("title", title);
            i.putExtra("body", body);
        }
        return PendingIntent.getBroadcast(c, 7000 + slot, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void cancelAll(Context c, String json) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        int n = MAX;
        try {
            n = Math.max(new JSONArray(json).length(), 0);
        } catch (Exception ignored) {
        }
        for (int slot = 0; slot < Math.min(Math.max(n, 1), MAX); slot++) {
            am.cancel(pending(c, slot, null, null, null));
        }
    }

    private static int setAll(Context c, String json) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null || json == null) return 0;
        int set = 0;
        try {
            JSONArray arr = new JSONArray(json);
            long now = System.currentTimeMillis();
            for (int i = 0; i < arr.length() && i < MAX; i++) {
                JSONObject o = arr.getJSONObject(i);
                long at = o.getLong("at");
                if (at < now - 60000L) continue;
                PendingIntent pi = pending(c, i, o.getString("id"), o.optString("title"), o.optString("body"));
                if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                } else {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                }
                set++;
            }
        } catch (Exception ignored) {
        }
        return set;
    }
}
