// 全自动对局模拟器（文字版）
// 依赖 ts-jest：允许直接引入 TypeScript 源文件
const { roles } = require('../app/data.ts');

// 暗流涌动阵容建议（与页面逻辑保持一致）
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

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const pickPreset = (count) => TB_PRESETS.find((p) => p.total === count);
const filterRoles = (type) =>
  roles.filter((r) => (r.script === '暗流涌动' || !r.script) && r.type === type);

const isEvil = (seat) =>
  seat.role?.type === 'minion' ||
  seat.role?.type === 'demon' ||
  seat.isEvilConverted ||
  seat.isDemonSuccessor;

const isGood = (seat) => seat.role && !isEvil(seat);

const assertValidSeats = (seats) => {
  const ids = new Set();
  seats.forEach((s, idx) => {
    expect(s).toBeDefined();
    expect(typeof s.id).toBe('number');
    expect(s.id).toBe(idx);
    expect(ids.has(s.id)).toBe(false);
    ids.add(s.id);
    expect(s.role).toBeTruthy();
  });
};

// 初始化并分配身份
const initGame = () => {
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

  const assignType = (pool, count) => shuffle(pool).slice(0, count);
  const pickByType = (type, count) => assignType(filterRoles(type), count);

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

  return { seats, log: [], day: 1, night: 1, phase: 'firstNight', winner: null };
};

const aliveSeats = (ctx) => ctx.seats.filter((s) => !s.isDead);
const aliveDemons = (ctx) => aliveSeats(ctx).filter((s) => s.role?.type === 'demon' || s.isDemonSuccessor);
const aliveGoods = (ctx) => aliveSeats(ctx).filter((s) => isGood(s));
const randomAlive = (ctx, predicate = () => true) => {
  const candidates = aliveSeats(ctx).filter(predicate);
  if (candidates.length === 0) return null;
  return candidates[randomInt(0, candidates.length - 1)];
};

// 判定游戏结束
const checkGameOver = (ctx, reason) => {
  const demons = aliveDemons(ctx);
  const goods = aliveGoods(ctx);
  if (demons.length === 0) {
    ctx.winner = 'good';
    ctx.log.push(`[结束] 恶魔全部死亡，好人获胜（${reason || '默认判定'}）`);
    return true;
  }
  if (goods.length === 0 || aliveSeats(ctx).length <= 2) {
    ctx.winner = 'evil';
    ctx.log.push(`[结束] 好人全部阵亡或仅余2人，邪恶获胜（${reason || '默认判定'}）`);
    return true;
  }
  return false;
};

// 夜晚行动：随机恶魔杀人，投毒者投毒，旅店老板/僧侣随机保护等（简单化）
const simulateNight = (ctx) => {
  const phaseLabel = ctx.night === 1 ? '首夜' : `第${ctx.night}夜`;
  ctx.log.push(`=== ${phaseLabel} ===`);

  // 投毒者：随机选一名存活者（不含自己）标记中毒
  const poisoners = aliveSeats(ctx).filter((s) => s.role?.id === 'poisoner' || s.role?.id === 'poisoner_mr');
  poisoners.forEach((p) => {
    const target = randomAlive(ctx, (t) => t.id !== p.id);
    if (target) {
      target.isPoisoned = true;
      ctx.log.push(`[夜晚] 投毒者(${p.id + 1}-${p.role.name}) 毒了 玩家${target.id + 1}-${target.role.name}`);
    }
  });

  // 僧侣：随机保护一人（非自己）
  const monks = aliveSeats(ctx).filter((s) => s.role?.id === 'monk');
  monks.forEach((m) => {
    const target = randomAlive(ctx, (t) => t.id !== m.id);
    if (target) {
      target.isProtected = true;
      target.protectedBy = m.id;
      ctx.log.push(`[夜晚] 僧侣(${m.id + 1}) 保护 玩家${target.id + 1}`);
    }
  });

  // 旅店老板：选择两人不死，其中一人醉酒
  const innkeepers = aliveSeats(ctx).filter((s) => s.role?.id === 'innkeeper');
  innkeepers.forEach((i) => {
    const picks = shuffle(aliveSeats(ctx).filter((t) => t.id !== i.id)).slice(0, 2);
    picks.forEach((t) => (t.isProtected = true));
    if (picks.length > 0) {
      const drunkOne = picks[0];
      drunkOne.isDrunk = true;
      ctx.log.push(`[夜晚] 旅店老板(${i.id + 1}) 保护 ${picks.map((t) => t.id + 1).join('、')}，其中 ${drunkOne.id + 1} 醉酒`);
    }
  });

  // 恶魔：随机杀一人（避开受保护者和士兵）
  const demons = aliveDemons(ctx);
  demons.forEach((d) => {
    const target = randomAlive(ctx, (t) => t.id !== d.id && !t.isProtected && t.role?.id !== 'soldier');
    if (target) {
      target.isDead = true;
      ctx.log.push(`[夜晚] 恶魔(${d.id + 1}-${d.role.name}) 杀死了 玩家${target.id + 1}-${target.role.name}`);
    } else {
      ctx.log.push(`[夜晚] 恶魔(${d.id + 1}-${d.role.name}) 未能找到可杀目标（可能被保护/士兵）`);
    }
  });

  ctx.night += 1;
  checkGameOver(ctx, '夜晚结算');
};

// 白天：随机处决一名非死亡玩家
const simulateDay = (ctx) => {
  const label = `第${ctx.day}天白天`;
  ctx.log.push(`=== ${label} ===`);

  const candidate = randomAlive(ctx);
  if (candidate) {
    candidate.isDead = true;
    ctx.log.push(`[白天] 多数票处决 玩家${candidate.id + 1}-${candidate.role.name}`);
  } else {
    ctx.log.push('[白天] 无可处决的目标');
  }

  ctx.day += 1;
  checkGameOver(ctx, '白天处决');
};

// 逐步模拟直到结束或超过轮次上限
const simulateGame = () => {
  const ctx = initGame();
  ctx.log.push(`[初始化] 玩家数 ${ctx.seats.length}，随机分配暗流涌动阵容`);
  assertValidSeats(ctx.seats);

  let round = 0;
  const MAX_ROUND = 20; // 防御性上限，避免无限循环

  while (!ctx.winner && round < MAX_ROUND) {
    simulateNight(ctx);
    if (ctx.winner) break;
    simulateDay(ctx);
    if (ctx.winner) break;
    round += 1;
  }

  if (!ctx.winner) {
    ctx.winner = '平局/超时';
    ctx.log.push('[结束] 达到最大回合数，自动终止');
  }

  return ctx;
};

describe('全自动对局模拟器', () => {
  test('模拟一场完整文字版对局并输出日志', () => {
    const ctx = simulateGame();

    // 验证无异常状态
    assertValidSeats(ctx.seats);

    // 打印关键日志，便于观察
    console.log(ctx.log.join('\n'));

    // 确认游戏结束
    expect(ctx.winner).toBeTruthy();
    expect(['good', 'evil', '平局/超时']).toContain(ctx.winner);
  });
});

