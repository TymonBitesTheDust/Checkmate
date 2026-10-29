// What changed in each version, newest first (Settings → What’s new). [English, 繁體中文]
export const CHANGELOG = [
  {
    v: '3.1.3',
    date: '2026-10',
    notes: [
      ['Settings → General → Open links with: open links from tasks and events in your default browser, Google Chrome, Microsoft Edge or Firefox, or choose each time. On Windows, links no longer open in a small Checkmate window.', '「設定 → 一般 → 開啟連結的方式」：任務和活動中的連結可用預設瀏覽器、Google Chrome、Microsoft Edge 或 Firefox 開啟，或每次選擇。在 Windows 上，連結不再在 Checkmate 的小視窗中開啟。'],
      ['A map link in an event’s location (such as a Google Maps share link) now opens that place. Typing an address still looks it up in Google Maps.', '活動地點中的地圖連結（例如 Google 地圖的分享連結）現在會開啟該地點。輸入地址仍會在 Google 地圖中搜尋。'],
      ['Settings → About links to tymon.website, the developer’s website.', '「設定 → 關於」新增開發者網站 tymon.website 的連結。'],
    ],
  },
  {
    v: '3.1.2',
    date: '2026-10',
    notes: [
      ['Brings in everything from 3.0.2: donations through Stripe, the new style names (Archive, Riot, Tide, Frontier and Neon) and no colour note in Settings → Theme.', '加入 3.0.2 的所有改動：透過 Stripe 捐款、新的風格名稱（Archive、Riot、Tide、Frontier 和 Neon），以及「設定 → 主題」不再顯示配色說明。'],
      ['Settings → Donate has five choices, each with its own Stripe page: a cup of coffee, a lunch money, a month of Claude member, a big thank, or a lunch money every month.', '「設定 → 捐款支持」提供五個選項，各有自己的 Stripe 付款頁面：一杯咖啡、一頓午餐錢、一個月的 Claude 會員、大大的感謝，或每月一頓午餐錢。'],
      ['Settings → About links to Checkmate’s source code on GitHub.', '「設定 → 關於」新增 Checkmate 在 GitHub 上的原始碼連結。'],
      ['In Frontier, Settings → Donate shows an old photograph in the red brush frame: “I have a plan. I just need money.”', '在 Frontier 風格中，「設定 → 捐款支持」會在紅色筆刷框中顯示一張舊照片：「我有個計劃，只差一筆錢。」'],
    ],
  },
  {
    v: '3.1.0',
    date: '2026-10',
    notes: [
      ['A start screen: Checkmate opens with your style’s icon and name for a moment, in that style’s look (Riot’s red slash, Tide’s moonlit water, Archive’s plates, Frontier’s brush stroke, Neon’s glitch). Turn it off in Settings → Theme → Start screen.', '起始畫面：開啟 Checkmate 時會短暫顯示目前風格的圖示和名稱，並採用該風格的造型（Riot 的紅色斜線、Tide 的月光水面、Archive 的選單板、Frontier 的筆刷、Neon 的雜訊閃爍）。可在「設定 → 主題 → 起始畫面」關閉。'],
      ['Checkmate for Chrome and Edge: the whole app as a browser extension that works offline and syncs like the others. Its toolbar button (Alt+Shift+C) adds tasks with the same typing as Add task and shows what’s due today; Alt+Shift+O opens Checkmate.', 'Chrome 和 Edge 版 Checkmate：以瀏覽器擴充功能提供完整的應用程式，可離線使用，並像其他版本一樣同步。工具列按鈕（Alt+Shift+C）可用與「新增任務」相同的寫法加入任務，並顯示今天到期的任務；Alt+Shift+O 開啟 Checkmate。'],
      ['In the extension, reminders arrive as browser notifications even with Checkmate closed, calendar subscriptions and Docs & Sheets links are read directly, and the toolbar button follows your style.', '在擴充功能中，即使關閉了 Checkmate，提醒也會以瀏覽器通知送達；日曆訂閱和 Docs 及 Sheets 連結可直接讀取，工具列按鈕亦會跟隨風格。'],
    ],
  },
  {
    v: '3.0.2',
    date: '2026-10',
    notes: [
      ['Settings → Donate now takes donations through Stripe: pick any amount and pay by card, Apple Pay or Google Pay.', '「設定 → 捐款支持」改用 Stripe 收取捐款：金額由你決定，可用信用卡、Apple Pay 或 Google Pay 付款。'],
      ['The styles have new names: Archive, Riot, Tide, Frontier and Neon. They look and sound the same, and the one you picked stays picked.', '各風格換上新名稱：Archive、Riot、Tide、Frontier 和 Neon。外觀和音效不變，你選用的風格也保持不變。'],
      ['Settings → Theme no longer shows a note about colours in the styles that bring their own.', '「設定 → 主題」在自帶配色的風格中，不再顯示有關配色的說明。'],
      ['Neon’s dark mode is now called Night.', 'Neon 風格的深色模式改稱「夜色」。'],
    ],
  },
  {
    v: '3.0.1',
    date: '2026-10',
    notes: [
      ['Settings → General → Hide completed tasks: ticked tasks leave your projects, even ones set to show completed tasks. They stay on the Completed page.', '「設定 → 一般 → 隱藏已完成的任務」：勾選完成的任務會從專案中消失，即使該專案設定為顯示已完成的任務。它們仍會留在「已完成」頁面。'],
      ['Settings → General → Hide completed subtasks: ticked subtasks leave the task panel and your project lists, while counts such as 3/5 still include them.', '「設定 → 一般 → 隱藏已完成的子任務」：勾選完成的子任務會從任務面板和專案清單中消失，3/5 這類計數仍會把它們算在內。'],
      ['A task whose subtasks are all hidden no longer shows an arrow that opens nothing.', '子任務全部被隱藏的任務，不再顯示一個打開後空無一物的箭咀。'],
    ],
  },
  {
    v: '3.0.0',
    date: '2026-10',
    notes: [
      ['Riot has a new look: a blood-red page over a field of pulsing stars, menu words and page titles in cut-out letters, a red and cyan highlight that wiggles behind what you pick, black menus and white paper dialogs.', 'Riot 風格換上新造型：血紅色的畫面配上一片脈動的星星，選單和頁面標題用剪貼字母，選中的項目背後有紅色和青色的高光晃動，黑色選單和白紙對話框。'],
      ['In Riot, the menu shows today’s date and how many tasks are due. Finishing a task slashes it in red and stamps it “Clear!”, changing page sweeps a wipe across and shakes the screen, and it has new menu sounds.', '在 Riot 風格中，選單會顯示今天的日期和到期任務的數目。完成任務時會劃上一道紅線並蓋上「搞定！」印章，切換頁面時畫面會掃過一道轉場並震動一下，還有新的選單音效。'],
      ['New app icons to match the new looks: Riot is a red star with a white tick on black; Archive is the picked menu plate with its square marker between thin rules; Tide is the red and white cursor under a black tick on deep water, with the moon; Frontier is a rough red brush frame round an ink tick. They show in the app, the browser tab, and on Windows and Android when the icon follows the style.', '配合新造型的應用程式圖示：Riot 是黑底上一顆紅星和白色剔號；Archive 是夾在細線之間、帶方形標記的選中選單板；Tide 是深藍水面上的紅白游標和黑色剔號，旁邊有月亮；Frontier 是一個粗糙的紅色筆刷框圍著墨色剔號。圖示用於應用程式內、瀏覽器分頁，以及圖示跟隨風格時的 Windows 和 Android。'],
      ['Settings → Theme, with Riot picked: choose how much moves (Match device, Full or Reduced) and turn the star field on or off. Riot is always dark.', '「設定 → 主題」（選了 Riot 時）：選擇動畫多少（跟隨裝置、完整或減少），並可開關星空。Riot 風格一律使用深色。'],
      ['Tide has a new pause-menu look: light dancing on the water’s surface, a tilted stack of command words with the page you’re on in white over the red and white cursor, the page name standing huge on a white ribbon (long names shrink to fit), white boxes for today’s numbers and a help line with button prompts.', 'Tide 風格換上新的暫停選單造型：水面上跳動的光影、傾斜疊放的指令文字，目前頁面以白色顯示在紅白游標上、頁面名稱以巨大字體豎立在白色緞帶上（較長的名稱會縮小以完整顯示）、以白色方框顯示今天的數字，還有附按鍵提示的說明列。'],
      ['Archive, Frontier and Neon have new looks: Archive’s beige menu plates that fill dark from the left with lines above and below; Frontier’s black ink-roller menu with brush banners, a red brush frame around the chosen item and a “3 of 9” counter; Neon’s salmon-red rows on black with cut-corner frames, cyan for what’s chosen and “‹ ON ›” switches.', 'Archive、Frontier 和 Neon 風格換上新造型：Archive 的米色選單板，由左至右填滿深色並在上下滑出細線；Frontier 的黑色墨輥選單，配上筆刷標題、選中項目的紅色筆刷框和「第 3 項，共 9 項」計數；Neon 的黑底鮭紅色列、切角框、以青色標示選中項目和「‹ 開 ›」開關。'],
    ],
  },
  {
    v: '2.2.0',
    date: '2026-10',
    notes: [
      ['Birthdays: add your own and your friends’, get reminded on the day, see how old everyone is turning, and find them on the calendar, Today and Upcoming. Lunar (農曆) birthdays can be turned on in Settings → Calendar.', '生日：加入你和朋友的生日，當天會提醒你，顯示將滿幾歲，並會出現在日曆、今天和即將到來。可在「設定 → 日曆」開啟農曆生日。'],
      ['Files: attach files of up to 100 MB to any task. They sync to your other devices through your own Firebase project.', '檔案：每個任務都可以附加最多 100 MB 的檔案，並透過你自己的 Firebase 專案同步到其他裝置。'],
      ['Reminders: choose when each task reminds you, set your defaults in Settings → Reminders, and pick any custom time for tasks, birthdays and events.', '提醒：為每個任務選擇提醒時間，在「設定 → 提醒」設定預設值，任務、生日和活動都可以自訂任何提醒時間。'],
      ['Typing a time in a new task keeps it in the name (“Watch Live Aid at 12pm”) while still setting the due time.', '新增任務時輸入的時間會保留在名稱中（例如「中午12點 看 Live Aid」），同時照樣設定到期時間。'],
      ['A new default colour: Checkmate orange (#F46B25). Pine is still there in Settings → Theme.', '新的預設顏色：Checkmate 橙（#F46B25）。松綠仍可在「設定 → 主題」選用。'],
      ['The Tide app icon’s moon no longer overlaps the tick.', 'Tide 圖示中的月亮不再與剔號重疊。'],
      ['This page: Settings → What’s new.', '新增此頁：「設定 → 更新內容」。'],
    ],
  },
  {
    v: '2.1.7',
    date: '2026-10',
    notes: [['Settings → Theme brings the style, the app icon switch, light or dark, and the theme colour together.', '「設定 → 主題」集中了風格、應用程式圖示開關、淺色或深色，以及主題色。']],
  },
  {
    v: '2.1.6',
    date: '2026-10',
    notes: [['The task name box shows a different example each time, with special ones on certain days of the year.', '任務名稱欄每次都會顯示不同的例子，一年中某些日子還有專屬的例子。']],
  },
  {
    v: '2.1.5',
    date: '2026-10',
    notes: [
      ['Settings → Sidebar: choose which pages show in the sidebar and whether task counts appear.', '「設定 → 側邊欄」：選擇側邊欄顯示哪些頁面，以及是否顯示任務數目。'],
      ['Settings → About and Settings → Donate.', '新增「設定 → 關於」和「設定 → 捐款支持」。'],
    ],
  },
  {
    v: '2.1.4',
    date: '2026-10',
    notes: [['Calendar: in Tide the toolbar no longer disappears after picking a day in the month view, and Riot scrolls back up properly.', '日曆：Tide 在月檢視選擇日子後，工具列不再消失；Riot 可以正常向上捲動。']],
  },
  {
    v: '2.1.3',
    date: '2026-10',
    notes: [['The app icon changes with the style in the Windows and Android apps.', 'Windows 和 Android 版的應用程式圖示會隨風格改變。']],
  },
  {
    v: '2.1.2',
    date: '2026-10',
    notes: [['Neon: the drag handle is visible again, and hovering the subtask arrow no longer repeats the page sound.', 'Neon：拖曳手柄重新出現，滑鼠移到子任務箭咀時不再重複播放換頁音效。']],
  },
  {
    v: '2.1.1',
    date: '2026-10',
    notes: [['The subtask arrow no longer overlaps the drag handle, and shows on Tide’s white hover bar.', '子任務箭咀不再與拖曳手柄重疊，在Tide 的白色懸停列上也看得見。']],
  },
  {
    v: '2.1.0',
    date: '2026-10',
    notes: [['Checkmate for Claude: connect Claude to add, find and change your tasks and calendar (Settings → Claude).', 'Checkmate 連接 Claude：讓 Claude 新增、尋找和修改你的任務與日曆（「設定 → Claude」）。']],
  },
  {
    v: 'earlier',
    notes: [
      ['Tasks with projects, sections, subtasks, priorities, labels, filters, comments and repeats; Today, Upcoming and a productivity view.', '任務：專案、分類、子任務、優先級、標籤、篩選器、留言和重複；今天、即將到來和生產力檢視。'],
      ['A calendar in the spirit of Google Calendar, with subscribed calendars, holidays and .ics import and export.', '仿 Google 日曆的日曆，支援訂閱日曆、公眾假期，以及匯入和匯出 .ics。'],
      ['Sync through your own Firebase project, six styles with their own sounds, Traditional Chinese, and Docs & Sheets syncing.', '透過你自己的 Firebase 專案同步、六種各有音效的風格、繁體中文，以及文件與試算表同步。'],
      ['Tickwise became Checkmate.', 'Tickwise 改名為 Checkmate。'],
    ],
  },
];
