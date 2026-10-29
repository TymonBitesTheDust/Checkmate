# Checkmate Privacy Policy

*Last updated 29 October 2026.* This policy is also at [tymon.website/checkmate/privacy](https://tymon.website/checkmate/privacy).

Checkmate is a to-do list and calendar app for Android, Windows, Chrome/Edge and the web, made by Tymon Ng in Melbourne, Australia. This policy explains what happens to your data when you use it.

**In short:**

- I (the developer) don't collect, see, sell or share any of your data.
- Your tasks and events are stored on your device.
- If you turn on sync, they're stored in a Firebase project that **you** own, not on my servers.
- No ads, no analytics and no tracking.

## What data Checkmate stores

Checkmate stores what you put into it:

- tasks, projects, sections, labels, filters, comments, events and birthdays;
- files you attach to tasks;
- your settings, such as your style, language and reminder times.

Without sync, all of this stays on your device. Reminders are scheduled on your device and shown as local notifications.

## Sync (optional)

Sync is off until you set it up. To sync between devices, you create your own free Firebase project (a Google service) and paste its settings into Checkmate. You then create a Checkmate account in that project with an email address and password.

- Your email address, password and data are sent only to your own Firebase project.
- The developer has no access to your Firebase project and can't see your data.
- Data is sent over encrypted connections (HTTPS).
- Google stores the data for you as part of Firebase. See [Firebase's privacy information](https://firebase.google.com/support/privacy).

## Other optional features

- **Subscribed calendars.** If you add a calendar link (for example Google Calendar's iCal address), Checkmate reads it directly from your device to show those events.
- **Google Docs and Sheets.** If you turn a document into a task list, Checkmate reads the link you give it directly from your device.
- **Claude connector.** If you connect Checkmate to Claude, the connector runs on your own Cloudflare account and signs in to your own Firebase project. It keeps no data of its own. What you ask Claude is covered by Anthropic's privacy policy.
- **Links.** Links in the app (such as the source code on GitHub or the Donate page) open in your browser. Those websites have their own privacy policies.

## Android permissions

- **Internet**: for sync and the optional features above.
- **Notifications, exact alarms, vibration and start at boot**: so reminders for your tasks and events appear at the exact time you set, even after your phone restarts.

## Sharing and selling

The developer doesn't collect your data, so it's never shared with or sold to anyone. Checkmate has no advertising, analytics or crash-reporting services.

## Deleting your account and data

**Data on your device:** uninstall Checkmate, or clear its storage in your phone's settings (Settings → Apps → Checkmate → Storage → Clear storage).

**Your sync account and synced data** are in your own Firebase project, so you can delete them yourself at any time:

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and open the project you made for Checkmate.
2. To delete everything at once, open **Project settings** and choose **Delete project**.
3. Or, to delete just one account: in **Authentication → Users**, delete the user; then in **Firestore Database**, delete that user's data.

### Deleting some of your data (without deleting your account)

- In Checkmate, delete any task, project, event, comment or attached file. If sync is on, it's also deleted from your Firebase project.
- Or, in the [Firebase console](https://console.firebase.google.com), open **Firestore Database** in your project and delete any of the data there.

### What is deleted and what is kept

- Deleting your account deletes your email address, password and all your synced data: tasks, projects, events, comments, files and settings. Deleting the whole Firebase project deletes everything in it.
- The developer doesn't keep any copy of your data, so nothing is kept by Checkmate.
- Google may keep deleted data in its backups for a limited time before it is permanently erased, as described on [Google Cloud's data deletion](https://cloud.google.com/docs/security/deletion) page.

If you need help, email me at [tymonai0903@gmail.com](mailto:tymonai0903@gmail.com).

## Children

Checkmate isn't aimed at children under 13 and doesn't knowingly collect data from them.

## Changes to this policy

If this policy changes, the new version will be posted here with a new "Last updated" date.

## Contact

Questions about privacy? Email [tymonai0903@gmail.com](mailto:tymonai0903@gmail.com) or [open an issue](https://github.com/TymonBitesTheDust/Checkmate/issues).
