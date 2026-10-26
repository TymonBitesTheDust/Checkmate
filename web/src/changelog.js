// What changed in each version, newest first (Settings → What’s new). [English, 繁體中文]
export const CHANGELOG = [
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
      ['Persona 5 has a new look, the Calling Card design: a blood-red page over a field of pulsing stars, menu words and page titles in cut-out letters, a red and cyan highlight that wiggles behind what you pick, black menus and white paper dialogs.', '女神異聞錄 5 風格換上新造型，名為 Calling Card 的設計：血紅色的畫面配上一片脈動的星星，選單和頁面標題用剪貼字母，選中的項目背後有紅色和青色的高光晃動，黑色選單和白紙對話框。'],
      ['In Persona 5, the menu shows today’s date and how many tasks are due. Finishing a task slashes it in red and stamps it “Clear!”, changing page sweeps a wipe across and shakes the screen, and new sounds follow the Persona 5 menu.', '在女神異聞錄 5 風格中，選單會顯示今天的日期和到期任務的數目。完成任務時會劃上一道紅線並蓋上「搞定！」印章，切換頁面時畫面會掃過一道轉場並震動一下，新的音效仿照女神異聞錄 5 的選單。'],
      ['New app icons to match the new looks: Persona 5 is a red star with a white tick on black; NieR: Automata is the picked menu plate with its square marker between thin rules; Persona 3 is the red and white cursor under a black tick on deep water, with the moon; Red Dead Redemption 2 is a rough red brush frame round an ink tick. They show in the app, the browser tab, and on Windows and Android when the icon follows the style.', '配合新造型的應用程式圖示：女神異聞錄 5 是黑底上一顆紅星和白色剔號；NieR: Automata 是夾在細線之間、帶方形標記的選中選單板；女神異聞錄 3 是深藍水面上的紅白游標和黑色剔號，旁邊有月亮；Red Dead Redemption 2 是一個粗糙的紅色筆刷框圍著墨色剔號。圖示用於應用程式內、瀏覽器分頁，以及圖示跟隨風格時的 Windows 和 Android。'],
      ['Settings → Theme, with Persona 5 picked: choose how much moves (Match device, Full or Reduced) and turn the star field on or off. Persona 5 is always dark.', '「設定 → 主題」（選了女神異聞錄 5 時）：選擇動畫多少（跟隨裝置、完整或減少），並可開關星空。女神異聞錄 5 風格一律使用深色。'],
      ['Persona 3 now follows the Persona 3 Reload pause menu: light dancing on the water’s surface, a tilted stack of command words with the page you’re on in white over the red and white cursor, the page name standing huge on a white ribbon (long names shrink to fit), white boxes for today’s numbers and a help line with button prompts.', '女神異聞錄 3 風格改為參照重製版女神異聞錄 3 的暫停選單：水面上跳動的光影、傾斜疊放的指令文字，目前頁面以白色顯示在紅白游標上、頁面名稱以巨大字體豎立在白色緞帶上（較長的名稱會縮小以完整顯示）、以白色方框顯示今天的數字，還有附按鍵提示的說明列。'],
      ['NieR: Automata, Red Dead Redemption 2 and Cyberpunk 2077 look more like their games: NieR’s beige menu plates that fill dark from the left with lines above and below; Red Dead’s black ink-roller menu with brush banners, a red brush frame around the chosen item and a “3 of 9” counter; Cyberpunk’s salmon-red rows on black with cut-corner frames, cyan for what’s chosen and “‹ ON ›” switches.', 'NieR: Automata、Red Dead Redemption 2 和 Cyberpunk 2077 風格更接近各自的遊戲：NieR 的米色選單板，由左至右填滿深色並在上下滑出細線；Red Dead 的黑色墨輥選單，配上筆刷標題、選中項目的紅色筆刷框和「第 3 項，共 9 項」計數；Cyberpunk 的黑底鮭紅色列、切角框、以青色標示選中項目和「‹ 開 ›」開關。'],
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
      ['The Persona 3 app icon’s moon no longer overlaps the tick.', '女神異聞錄 3 圖示中的月亮不再與剔號重疊。'],
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
    notes: [['Calendar: in Persona 3 the toolbar no longer disappears after picking a day in the month view, and Persona 5 scrolls back up properly.', '日曆：女神異聞錄 3 在月檢視選擇日子後，工具列不再消失；女神異聞錄 5 可以正常向上捲動。']],
  },
  {
    v: '2.1.3',
    date: '2026-10',
    notes: [['The app icon changes with the style in the Windows and Android apps.', 'Windows 和 Android 版的應用程式圖示會隨風格改變。']],
  },
  {
    v: '2.1.2',
    date: '2026-10',
    notes: [['Cyberpunk 2077: the drag handle is visible again, and hovering the subtask arrow no longer repeats the page sound.', '電馭叛客 2077：拖曳手柄重新出現，滑鼠移到子任務箭咀時不再重複播放換頁音效。']],
  },
  {
    v: '2.1.1',
    date: '2026-10',
    notes: [['The subtask arrow no longer overlaps the drag handle, and shows on Persona 3’s white hover bar.', '子任務箭咀不再與拖曳手柄重疊，在女神異聞錄 3 的白色懸停列上也看得見。']],
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
