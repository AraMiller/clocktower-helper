// app/data.ts

export type RoleType = "townsfolk" | "outsider" | "minion" | "demon";
export type NightActionType = "poison" | "kill" | "protect" | "mark" | "inspect" | "inspect_death" | "spy_info" | "none";
export type GamePhase = "setup" | "check" | "firstNight" | "day" | "dusk" | "night" | "dawnReport" | "gameOver";
export type WinResult = "good" | "evil" | null;

export interface Role {
  id: string;
  name: string;
  type: RoleType;
  ability: string;
  firstNight: boolean;
  otherNight: boolean;
  firstNightOrder: number;
  otherNightOrder: number;
  firstNightReminder?: string;
  otherNightReminder?: string;
  nightActionType?: NightActionType; 
}

export interface Seat {
  id: number;
  role: Role | null;
  charadeRole: Role | null;
  isDead: boolean;
  isDrunk: boolean;
  isPoisoned: boolean;
  isProtected: boolean;
  isRedHerring: boolean;
  isSentenced: boolean;
  masterId: number | null;
  hasUsedSlayerAbility: boolean;
  hasUsedVirginAbility: boolean;
  isDemonSuccessor: boolean;
  statusDetails: string[]; 
  voteCount?: number;
  isCandidate?: boolean;
}

export interface LogEntry {
  day: number;
  phase: string;
  message: string;
}

// --- 工具 ---
export const formatTime = (date: Date) => {
    return date.toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
    }).replace(/\//g, '-');
};

export function getSeatPosition(index: number) {
  const angle = (index / 15) * 2 * Math.PI - Math.PI / 2;
  const radius = 40; 
  const x = 50 + radius * Math.cos(angle);
  const y = 50 + radius * Math.sin(angle);
  return { x: x.toFixed(2), y: y.toFixed(2) };
}

// --- 样式常量 ---
export const typeColors: Record<string, string> = { 
    townsfolk: "border-blue-500 text-blue-400", 
    outsider: "border-purple-500 text-purple-400", 
    minion: "border-orange-500 text-orange-500", 
    demon: "border-red-600 text-red-600" 
};
export const typeBgColors: Record<string, string> = { 
    townsfolk: "bg-blue-900/50 hover:bg-blue-800", 
    outsider: "bg-purple-900/50 hover:bg-purple-800", 
    minion: "bg-orange-900/50 hover:bg-orange-800", 
    demon: "bg-red-900/50 hover:bg-red-800" 
};
export const typeLabels: Record<string, string> = { 
    townsfolk: "🔵 镇民", outsider: "🟣 外来者", minion: "UTRECHT 爪牙", demon: "🔴 恶魔" 
};

// --- 角色数据 ---
export const roles: Role[] = [
  { id: "poisoner", name: "投毒者", type: "minion", ability: "每晚选一名玩家中毒。", firstNight: true, otherNight: true, firstNightOrder: 1, otherNightOrder: 1, nightActionType: "poison" },
  { id: "spy", name: "间谍", type: "minion", ability: "每晚看魔典。", firstNight: true, otherNight: true, firstNightOrder: 15, otherNightOrder: 15, nightActionType: "spy_info" },
  { id: "scarlet_woman", name: "红唇女郎", type: "minion", ability: "恶魔死后变身。", firstNight: true, otherNight: true, firstNightOrder: 0, otherNightOrder: 0, nightActionType: "none" },
  { id: "baron", name: "男爵", type: "minion", ability: "增加外来者。", firstNight: true, otherNight: false, firstNightOrder: 0, otherNightOrder: 0, nightActionType: "none" },
  { id: "imp", name: "小恶魔", type: "demon", ability: "每晚杀一人。", firstNight: true, otherNight: true, firstNightOrder: 2, otherNightOrder: 3, nightActionType: "kill" },
  { id: "washerwoman", name: "洗衣妇", type: "townsfolk", ability: "得知村民身份。", firstNight: true, otherNight: false, firstNightOrder: 4, otherNightOrder: 0, nightActionType: "none" },
  { id: "librarian", name: "图书管理员", type: "townsfolk", ability: "得知外来者身份。", firstNight: true, otherNight: false, firstNightOrder: 5, otherNightOrder: 0, nightActionType: "none" },
  { id: "investigator", name: "调查员", type: "townsfolk", ability: "得知爪牙身份。", firstNight: true, otherNight: false, firstNightOrder: 6, otherNightOrder: 0, nightActionType: "none" },
  { id: "chef", name: "厨师", type: "townsfolk", ability: "得知邪恶相邻数。", firstNight: true, otherNight: false, firstNightOrder: 7, otherNightOrder: 0, nightActionType: "none" },
  { id: "empath", name: "共情者", type: "townsfolk", ability: "得知邪恶邻居数。", firstNight: true, otherNight: true, firstNightOrder: 8, otherNightOrder: 8, nightActionType: "none" },
  { id: "fortune_teller", name: "占卜师", type: "townsfolk", ability: "查验恶魔。", firstNight: true, otherNight: true, firstNightOrder: 9, otherNightOrder: 9, nightActionType: "inspect" },
  { id: "undertaker", name: "送葬者", type: "townsfolk", ability: "得知处决者身份。", firstNight: false, otherNight: true, firstNightOrder: 0, otherNightOrder: 10, nightActionType: "none" },
  { id: "monk", name: "僧侣", type: "townsfolk", ability: "保护。", firstNight: false, otherNight: true, firstNightOrder: 0, otherNightOrder: 2, nightActionType: "protect" },
  { id: "ravenkeeper", name: "守鸦人", type: "townsfolk", ability: "死后查验。", firstNight: false, otherNight: true, firstNightOrder: 0, otherNightOrder: 11, nightActionType: "inspect_death" },
  { id: "virgin", name: "贞洁者", type: "townsfolk", ability: "被提名处决提名者。", firstNight: false, otherNight: false, firstNightOrder: 0, otherNightOrder: 0, nightActionType: "none" },
  { id: "slayer", name: "猎手", type: "townsfolk", ability: "击杀恶魔。", firstNight: false, otherNight: false, firstNightOrder: 0, otherNightOrder: 0, nightActionType: "none" },
  { id: "soldier", name: "士兵", type: "townsfolk", ability: "免死。", firstNight: false, otherNight: false, firstNightOrder: 0, otherNightOrder: 0, nightActionType: "none" },
  { id: "mayor", name: "镇长", type: "townsfolk", ability: "苟活获胜。", firstNight: false, otherNight: false, firstNightOrder: 0, otherNightOrder: 0, nightActionType: "none" },
  { id: "butler", name: "管家", type: "outsider", ability: "选主人。", firstNight: true, otherNight: true, firstNightOrder: 10, otherNightOrder: 12, nightActionType: "mark" },
  { id: "drunk", name: "酒鬼", type: "outsider", ability: "以为自己是村民。", firstNight: true, otherNight: true, firstNightOrder: 0, otherNightOrder: 0, nightActionType: "none" },
  { id: "recluse", name: "陌客", type: "outsider", ability: "误判。", firstNight: false, otherNight: false, firstNightOrder: 0, otherNightOrder: 0, nightActionType: "none" },
  { id: "saint", name: "圣徒", type: "outsider", ability: "被处决输。", firstNight: false, otherNight: false, firstNightOrder: 0, otherNightOrder: 0, nightActionType: "none" }
];

export const groupedRoles = {
    townsfolk: roles.filter(r => r.type === 'townsfolk'),
    outsider: roles.filter(r => r.type === 'outsider'),
    minion: roles.filter(r => r.type === 'minion'),
    demon: roles.filter(r => r.type === 'demon')
};