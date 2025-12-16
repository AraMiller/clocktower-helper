/**
 * 单局文字战报模拟（Node运行）
 * 运行：node tests/single_sim_run.js
 */

const { roles } = require('../app/data.ts');

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

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

const initGame = () => {
  const total = randomInt(5, 15);
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

  return { seats, day: 1, night: 1, winner: null, log: [], preset };
};

const aliveSeats = (ctx) => ctx.seats.filter((s) => !s.isDead);
const aliveDemons = (ctx) => aliveSeats(ctx).filter((s) => s.role?.type === 'demon' || s.isDemonSuccessor);
const aliveGoods = (ctx) => aliveSeats(ctx).filter((s) => isGood(s));
const randomAlive = (ctx, predicate = () => true) => {
  const candidates = aliveSeats(ctx).filter(predicate);
  if (candidates.length === 0) return null;
  return candidates[randomInt(0, candidates.length - 1)];
};

const checkGameOver = (ctx, reason) => {
  const demons = aliveDemons(ctx);
  const goods = aliveGoods(ctx);
  if (demons.length === 0) {
    ctx.winner = 'good';
    ctx.log.push(`[结算] 恶魔全灭，好人胜（${reason}）`);
    return true;
  }
  if (goods.length === 0 || aliveSeats(ctx).length <= 2) {
    ctx.winner = 'evil';
    ctx.log.push(`[结算] 好人耗尽/仅余2人，邪恶胜（${reason}）`);
    return true;
  }
  return false;
};

const simulateNight = (ctx) => {
  const phase = ctx.night === 1 ? '首夜' : `第${ctx.night}夜`;
  ctx.log.push(`=== ${phase} ===`);

  // 投毒
  const poisoners = aliveSeats(ctx).filter((s) => s.role?.id === 'poisoner' || s.role?.id === 'poisoner_mr');
  poisoners.forEach((p) => {
    const t = randomAlive(ctx, (x) => x.id !== p.id);
    if (t) {
      t.isPoisoned = true;
      ctx.log.push(`[夜晚] 投毒者(${p.id + 1}-${p.role.name}) 毒了 玩家${t.id + 1}-${t.role.name}`);
    }
  });

  // 僧侣保护
  const monks = aliveSeats(ctx).filter((s) => s.role?.id === 'monk');
  monks.forEach((m) => {
    const t = randomAlive(ctx, (x) => x.id !== m.id);
    if (t) {
      t.isProtected = true;
      t.protectedBy = m.id;
      ctx.log.push(`[夜晚] 僧侣(${m.id + 1}) 保护 玩家${t.id + 1}`);
    }
  });

  // 旅店老板：两人不死，一人醉酒
  const innkeepers = aliveSeats(ctx).filter((s) => s.role?.id === 'innkeeper');
  innkeepers.forEach((i) => {
    const picks = shuffle(aliveSeats(ctx).filter((x) => x.id !== i.id)).slice(0, 2);
    picks.forEach((t) => (t.isProtected = true));
    if (picks.length > 0) {
      picks[0].isDrunk = true;
      ctx.log.push(`[夜晚] 旅店老板(${i.id + 1}) 保护 ${picks.map((t) => t.id + 1).join('、')}，其中 ${picks[0].id + 1} 醉酒`);
    }
  });

  // 恶魔杀人（首夜禁止攻击）
  const demons = aliveDemons(ctx);
  const demonAttackAllowed = ctx.night > 1;
  demons.forEach((d) => {
    if (!demonAttackAllowed) {
      ctx.log.push(`[夜晚] 首夜规则：恶魔(${d.id + 1}-${d.role.name}) 不进行攻击`);
      return;
    }
    const target = randomAlive(ctx, (t) => t.id !== d.id && !t.isProtected && t.role?.id !== 'soldier');
    if (target) {
      target.isDead = true;
      ctx.log.push(`[夜晚] 恶魔(${d.id + 1}-${d.role.name}) 杀死 玩家${target.id + 1}-${target.role.name}`);
    } else {
      ctx.log.push(`[夜晚] 恶魔(${d.id + 1}-${d.role.name}) 未能成功击杀（可能被保护/士兵）`);
    }
  });

  // 清保护
  ctx.seats.forEach((s) => {
    s.isProtected = false;
    s.protectedBy = null;
  });

  ctx.night += 1;
  return checkGameOver(ctx, '夜晚');
};

const simulateDay = (ctx) => {
  const label = `第${ctx.day}天白天`;
  ctx.log.push(`=== ${label} ===`);

  const alive = aliveSeats(ctx);
  if (alive.length <= 1) {
    ctx.log.push('[白天] 存活不足以提名，跳过');
    ctx.day += 1;
    return checkGameOver(ctx, '白天');
  }

  // 盲投：随机提名 + 50% 投票
  const proposer = alive[randomInt(0, alive.length - 1)];
  let target = proposer;
  while (target === proposer && alive.length > 1) {
    target = alive[randomInt(0, alive.length - 1)];
  }

  // 投票意愿：基础 65%，天数 >2 时每天额外 +5%，上限 85%
  const baseProb = 0.65;
  const panicBonus = Math.min(0.20, Math.max(0, (ctx.day - 2) * 0.05));
  const voteProb = Math.min(0.85, baseProb + panicBonus);

  let votes = 0;
  alive.forEach((p) => {
    const voteYes = Math.random() < voteProb;
    if (voteYes) votes += 1;
  });
  const needed = Math.floor(alive.length / 2) + 1;

  const executed = votes >= needed;
  if (executed) target.isDead = true;

  ctx.log.push(
    `[提名] 玩家${proposer.id + 1}-${proposer.role.name} 提名 玩家${target.id + 1}-${target.role.name} | 票数 ${votes}/${alive.length} (需要 ${needed}) | ${executed ? '处决' : '未处决'}`
  );

  ctx.day += 1;
  ctx.dayCount = (ctx.dayCount || 0) + 1;
  return checkGameOver(ctx, '白天');
};

const simulateGame = (maxRounds = 50) => {
  const ctx = initGame();
  ctx.log.push(`[初始化] 玩家数 ${ctx.seats.length}，阵容建议 ${JSON.stringify(ctx.preset)}`);
  ctx.log.push('[身份分配] ' + ctx.seats.map((s) => `${s.id + 1}:${s.role.name}`).join(' | '));

  let rounds = 0;
  let ended = false;
  while (!ended && rounds < maxRounds) {
    ended = simulateNight(ctx);
    if (ended) break;
    ended = simulateDay(ctx);
    rounds += 1;
  }
  if (!ended) {
    ctx.winner = '未结束/超时';
    ctx.log.push('[结算] 超过最大回合，强制终止');
  }
  return ctx;
};

const runOnce = () => {
  const start = Date.now();
  const ctx = simulateGame(50);
  const duration = ((Date.now() - start) / 1000).toFixed(2);
  console.log(ctx.log.join('\n'));
  console.log(`\n【结果】胜者：${ctx.winner}，耗时：${duration}s`);
};

runOnce();

