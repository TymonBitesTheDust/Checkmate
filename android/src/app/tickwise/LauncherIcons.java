package app.tickwise;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

/**
 * Switches the home-screen icon by enabling one launcher alias and disabling the others.
 * The switch is applied when the app goes to the background, so the open screen isn't interrupted.
 */
final class LauncherIcons {
    private static final String PREFS = "tickwise";
    private static final String WANTED = "launcherIcon";
    private static final String APPLIED = "launcherIconApplied";
    // style -> alias declared in AndroidManifest.xml (".MainActivity" keeps old shortcuts working)
    private static final String[][] ALIASES = {
        {"tickwise", ".MainActivity"},
        {"archive", ".IconArchive"},
        {"riot", ".IconRiot"},
        {"tide", ".IconTide"},
        {"frontier", ".IconFrontier"},
        {"neon", ".IconNeon"},
    };

    private LauncherIcons() {}

    static void request(Context c, String style) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(WANTED, known(style)).apply();
    }

    static void applyPending(Context c) {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String wanted = known(sp.getString(WANTED, "tickwise"));
        String applied = sp.getString(APPLIED, "tickwise");
        if (wanted.equals(applied)) return;
        PackageManager pm = c.getPackageManager();
        // The aliases' class names stay app.tickwise.* when the Google Play build renames the package.
        String pkg = c.getPackageName();
        String cls = "app.tickwise";
        try {
            // Enable the new alias first so there is always one launcher entry.
            for (String[] a : ALIASES) {
                if (a[0].equals(wanted)) {
                    pm.setComponentEnabledSetting(new ComponentName(pkg, cls + a[1]), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
                }
            }
            for (String[] a : ALIASES) {
                if (!a[0].equals(wanted)) {
                    pm.setComponentEnabledSetting(new ComponentName(pkg, cls + a[1]), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
                }
            }
            sp.edit().putString(APPLIED, wanted).apply();
        } catch (Exception ignored) {
        }
    }

    private static String known(String style) {
        for (String[] a : ALIASES) if (a[0].equals(style)) return style;
        return "tickwise";
    }
}
