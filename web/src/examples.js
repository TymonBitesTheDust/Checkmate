// The example in the task name box ("Task name, e.g. …"). Some days of the year have their
// own; on any other day it's one of the others, picked at random each time.
// Each is written so quick add reads it: try typing one in.
import { today } from './dates.js';
import { isZh } from './i18n.js';

// "MM-DD": [English, 繁體中文]
const ON_THE_DAY = {
  '01-26': ['Celebrate Australia Day with your mates', '和朋友一起慶祝澳洲國慶日'],
  '04-25': ['Anzac at 4am p1', '凌晨4點 澳紐軍團日黎明儀式 p1'],
  '06-04': ['Nothing to do today!', '今天無事可做！'],
  '07-13': ['Watch Live Aid at 12pm p1', '中午12點 看 Live Aid p1'],
  '09-03': ['Attend Tymon’s Birthday Party at 7pm p1', '晚上7點 出席 Tymon 的生日派對 p1'],
  '10-15': ['Watch flying car with Elon Musk at 8pm p1', '晚上8點 和 Elon Musk 一起看飛天汽車 p1'],
  '10-16': ['Be responsible for a water bottle p3', '負責好一個水樽 p3'],
  '11-19': ['Play GTA VI before GTA VI p2', '在 GTA VI 推出前玩 GTA VI p2'],
  '12-18': ['Watch Messi cook and roast IShowSpeed', '看 Messi 大展身手，狠狠嗆 IShowSpeed'],
};

const ANY_DAY = [
  ['Hide snacks from future me Friday 4pm p2', '星期五下午4點 把零食藏好，別讓未來的自己找到 p2'],
  ['Pet a dog every day 5pm p2', '每天下午5點 摸一摸狗 p2'],
  ['Call Mum before she calls you tomorrow 5pm p1', '明天下午5點 趕在媽媽打來之前先打給她 p1'],
  ['Rotate the Earth 10000 times at 5pm p2', '下午5點 把地球轉一萬圈 p2'],
  ['You no longer have a manager. You can’t be managed p3', '你再也沒有上司了。沒有人管得了你 p3'],
  ['Fill your bedroom with mirrors so you will be surrounded by winners', '在睡房放滿鏡子，讓自己被贏家包圍'],
];

export function taskExample(date = today(), random = Math.random) {
  const pair = ON_THE_DAY[date.slice(5, 10)] || ANY_DAY[Math.floor(random() * ANY_DAY.length) % ANY_DAY.length];
  return isZh() ? pair[1] : pair[0];
}

export const EXAMPLES = { ON_THE_DAY, ANY_DAY };
