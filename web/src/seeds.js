// Text for the welcome tasks, so they read in the current language until edited.
import { isZh } from './i18n.js';

const EN = {
  'welcome-1': { title: 'Tick the circle to complete a task' },
  'welcome-2': {
    title: 'Add a task with “Call Sam tomorrow 5pm p1 #Inbox”',
    desc: 'Dates, times, priorities (p1–p4), #projects and @labels are picked up as you type.',
  },
  'welcome-3': { title: 'Open Settings → Sync to use Checkmate on your phone and PC' },
  'welcome-4': { title: 'Press Q to add a task from anywhere, / to search' },
};

const ZH = {
  'welcome-1': { title: '點一下圓圈即可完成任務' },
  'welcome-2': {
    title: '試試輸入「明天下午5點 打電話給阿明 p1 #收件匣」來新增任務',
    desc: '輸入時會自動辨認日期、時間、優先級（p1–p4）、#專案 和 @標籤。',
  },
  'welcome-3': { title: '打開「設定 → 同步」，在手機和電腦上使用 Checkmate' },
  'welcome-4': { title: '按 Q 可在任何地方新增任務，按 / 搜尋' },
};

export const seedTexts = () => (isZh() ? ZH : EN);
