package app.tickwise;

import android.content.Context;

/** The few words the Android side shows itself, in the app's chosen language. */
final class Strings {
    private Strings() {}

    static void setLanguage(Context c, String lang) {
        c.getSharedPreferences("tickwise", Context.MODE_PRIVATE).edit().putString("lang", lang == null ? "en" : lang).apply();
    }

    static boolean zh(Context c) {
        return "zh-Hant".equals(c.getSharedPreferences("tickwise", Context.MODE_PRIVATE).getString("lang", "en"));
    }

    static String get(Context c, String key) {
        boolean zh = zh(c);
        switch (key) {
            case "backup_saved": return zh ? "已儲存備份" : "Backup saved";
            case "file_saved": return zh ? "已儲存檔案" : "File saved";
            case "save_failed": return zh ? "無法儲存檔案" : "Could not save the file";
            case "no_file_app": return zh ? "沒有可以儲存檔案的應用程式" : "No app available to save files";
            case "channel_name": return zh ? "提醒" : "Reminders";
            case "channel_desc": return zh ? "任務到期和活動開始前提醒你" : "Alerts when a task is due or an event is about to start";
            case "task_due": return zh ? "任務到期" : "Task due";
            default: return key;
        }
    }
}
