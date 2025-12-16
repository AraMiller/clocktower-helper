/**
 * 压力测试脚本（Node 直接运行，非 Jest）
 * 目标：连续模拟 1000 局随机对局，统计胜率与稳定性。
 * 运行方式：node tests/stress_test.js
 */

const { roles } = require('../app/data.ts');

// -------- 基础工具 --------
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// 暗流涌动阵容建议
const TB_PRESETS = [
  { total: 5, townsfolk: 3, outsider: 0, minion: 1, demon: 1 },
  { total: 6, townsfolk: 3, outsider: 1, minion: 1, demon: 1 },
  { total: 7, townsfolk: 5, outsider: 0, minion: 1, demon: 1 },
  { total: 8, townsfolk: 5, outsider: 1, minion: 1, demon: 1 },
  { total: 9, townsfolk: 5, outsider: 2, minion: 1, demon: 1 },
  { total: 10, townsfolk: 7, outsider: 0, minion: 2, demon: 1 },
  { total: 11, townsfolk: 7, outsider: 1, minion: 2, demon: 1 },
  { total: 12, townsfolk: 7, outsider: 2, minion: 2, demon: 1 },
  { total: 13, townsfolk: 9, outsider: 0, minion: 3, demon: 1 },
  { total: 14, townsfolk: 9, outsider: 1, minion: 3, demon: 1 },
  { total: 15, townsfolk: 9, outsider: 4, minion: 2, demon: 1 },
];
const pickPreset = (count) => TB_PRESETS.find((p) => p.total === count);
const filterRoles = (type) =>
  roles.filter((r) => (r.script === '暗流涌动' || !r.script) && r.type === type);

const isEvil = (seat) =>
  seat.role?.type === 'minion' ||
  seat.role?.type === 'demon' ||
  seat.isEvilConverted ||
  seat.isDemonSuccessor;
const isGood = (seat) => seat.role && !isEvil(seat);

// -------- 初始化与状态 --------
const initGame = () => {
  // 随机 9~15 人，期望平均人数约 12+
  const total = randomInt(9, 15);
  const preset = pickPreset(total);
  const seats = Array.from({ length: total }, (_, id) => ({
    id,
    role: null,
    charadeRole: null,
    isDead: false,
    isEvilConverted: false,
    isGoodConverted: false,
    isDrunk: false,
    isPoisoned: false,
    isProtected: false,
    protectedBy: null,
    isRedHerring: false,
    isFortuneTellerRedHerring: false,
    isSentenced: false,
    masterId: null,
    hasUsedSlayerAbility: false,
    hasUsedVirginAbility: false,
    isDemonSuccessor: false,
    hasAbilityEvenDead: false,
    statusDetails: [],
    statuses: [],
    grandchildId: null,
    isGrandchild: false,
  }));

  const pickByType = (type, count) => shuffle(filterRoles(type)).slice(0, count);
  const picked = [
    ...pickByType('townsfolk', preset.townsfolk),
    ...pickByType('outsider', preset.outsider),
    ...pickByType('minion', preset.minion),
    ...pickByType('demon', preset.demon),
  ];
  const shuffled = shuffle(picked);
  seats.forEach((s, i) => {
    s.role = shuffled[i];
    if (s.role.id === 'drunk') s.isDrunk = true;
  });

  return { seats, day: 1, night: 1, winner: null, log: [] };
};

const aliveSeats = (ctx) => ctx.seats.filter((s) => !s.isDead);
const aliveDemons = (ctx) => aliveSeats(ctx).filter((s) => s.role?.type === 'demon' || s.isDemonSuccessor);
const aliveGoods = (ctx) => aliveSeats(ctx).filter((s) => isGood(s));
const randomAlive = (ctx, predicate = () => true) => {
  const candidates = aliveSeats(ctx).filter(predicate);
  if (candidates.length === 0) return null;
  return candidates[randomInt(0, candidates.length - 1)];
};

// -------- 结算与行动 --------
const checkGameOver = (ctx, reason) => {
  const demons = aliveDemons(ctx);
  const goods = aliveGoods(ctx);
  if (demons.length === 0) {
    ctx.winner = 'good';
    return true;
  }
  if (goods.length === 0 || aliveSeats(ctx).length <= 2) {
    ctx.winner = 'evil';
    return true;
  }
  return false;
};

const simulateNight = (ctx) => {
  // 全随机行动：投毒者、僧侣、旅店老板、恶魔
  const poisoners = aliveSeats(ctx).filter((s) => s.role?.id === 'poisoner' || s.role?.id === 'poisoner_mr');
  poisoners.forEach((p) => {
    const t = randomAlive(ctx, (x) => x.id !== p.id);
    if (t) t.isPoisoned = true;
  });

  const monks = aliveSeats(ctx).filter((s) => s.role?.id === 'monk');
  monks.forEach((m) => {
    const t = randomAlive(ctx, (x) => x.id !== m.id);
    if (t) {
      t.isProtected = true;
      t.protectedBy = m.id;
    }
  });

  const innkeepers = aliveSeats(ctx).filter((s) => s.role?.id === 'innkeeper');
  innkeepers.forEach((i) => {
    const picks = shuffle(aliveSeats(ctx).filter((x) => x.id !== i.id)).slice(0, 2);
    picks.forEach((t) => (t.isProtected = true));
    if (picks.length > 0) picks[0].isDrunk = true;
  });

  const demons = aliveDemons(ctx);
  demons.forEach((d) => {
    const target = randomAlive(ctx, (t) => t.id !== d.id && !t.isProtected && t.role?.id !== 'soldier');
    if (target) target.isDead = true;
  });

  // 清理保护（仅本夜）
  ctx.seats.forEach((s) => {
    s.isProtected = false;
    s.protectedBy = null;
  });

  ctx.night += 1;
  return checkGameOver(ctx, 'night');
};

const simulateDay = (ctx) => {
  // 盲投：随机提名 + 50% 随机投票，多数同意则处决
  const alive = aliveSeats(ctx);
  if (alive.length <= 1) {
    ctx.day += 1;
    return checkGameOver(ctx, 'day');
  }

  const proposer = alive[randomInt(0, alive.length - 1)];
  let target = proposer;
  while (target === proposer && alive.length > 1) {
    target = alive[randomInt(0, alive.length - 1)];
  }

  let votes = 0;
  alive.forEach((p) => {
    const voteYes = Math.random() < 0.5; // 50% 概率举手
    if (voteYes) votes += 1;
  });

  const needed = Math.floor(alive.length / 2) + 1; // 过半数
  if (votes >= needed) {
    target.isDead = true;
  }

  ctx.day += 1;
  ctx.dayCount = (ctx.dayCount || 0) + 1;
  return checkGameOver(ctx, 'day');
};

const simulateGame = (maxRounds = 120) => {
  const ctx = initGame();
  ctx.dayCount = 0;
  let rounds = 0;
  let ended = false;
  while (!ended && rounds < maxRounds) {
    ended = simulateNight(ctx);
    if (ended) break;
    ended = simulateDay(ctx);
    rounds += 1;
  }
  if (!ended) {
    throw new Error('超过最大回合未结束');
  }
  return ctx;
};

// -------- 主执行 --------
const runStress = async () => {
  const TOTAL = 1000;
  let success = 0;
  let fail = 0;
  let goodWins = 0;
  let evilWins = 0;
  let demonAliveSum = 0;
  let demonTotalSum = 0;
  let daysSum = 0;

  const start = Date.now();

  for (let i = 0; i < TOTAL; i++) {
    try {
      const ctx = simulateGame(100);
      success += 1;
      if (ctx.winner === 'good') goodWins += 1;
      if (ctx.winner === 'evil') evilWins += 1;
      daysSum += ctx.dayCount || 0;
      const demonsNow = ctx.seats.filter((s) => s.role?.type === 'demon' || s.isDemonSuccessor);
      const demonsAlive = demonsNow.filter((s) => !s.isDead).length;
      demonAliveSum += demonsAlive;
      demonTotalSum += demonsNow.length;
    } catch (err) {
      fail += 1;
    }
  }

  const durationMs = Date.now() - start;
  const demonSurvivalRate =
    demonTotalSum === 0 ? 0 : (demonAliveSum / demonTotalSum) * 100;
  const avgDays = success === 0 ? 0 : daysSum / success;

  console.log('=== 压力测试结果 ===');
  console.log(`总耗时: ${(durationMs / 1000).toFixed(2)}s`);
  console.log(`成功局数: ${success} / ${TOTAL}`);
  console.log(`失败局数: ${fail} / ${TOTAL}`);
  console.log(`好人获胜: ${goodWins}`);
  console.log(`邪恶获胜: ${evilWins}`);
  console.log(`恶魔终局平均存活率: ${demonSurvivalRate.toFixed(2)}%`);
  console.log(`平均游戏天数: ${avgDays.toFixed(2)} 天`);
};

runStress();

