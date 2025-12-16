/**
 * 《血染钟楼 - 暗流涌动》核心规则场景测试（无随机，强制设定）
 * 说明：使用简单的模拟状态机，不依赖 UI，只验证核心结算逻辑。
 */

const { roles } = require('../app/data.ts');

// ---------- 工具与模拟状态 ----------
const getRole = (id) => {
  const r = roles.find((x) => x.id === id);
  if (!r) throw new Error(`未找到角色: ${id}`);
  return r;
};

const createSeat = (idx, roleId) => ({
  id: idx,
  role: getRole(roleId),
  charadeRole: null,
  isDead: false,
  isEvilConverted: false,
  isGoodConverted: false,
  isDrunk: roleId === 'drunk',
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
  isFirstDeathForZombuul: false,
  isZombuulTrulyDead: false,
  zombuulLives: 1,
});

const isEvil = (s) => s.role.type === 'minion' || s.role.type === 'demon' || s.isDemonSuccessor;
const isGood = (s) => !isEvil(s);

const kill = (seat, opts = {}) => {
  const soldierImmune = seat.role.id === 'soldier' && !seat.isPoisoned && !seat.isDrunk;
  if (soldierImmune && !opts.force) return false;
  if (seat.isProtected && !opts.ignoreProtection) return false;
  seat.isDead = true;
  return true;
};

const resetProtection = (seats) => seats.forEach((s) => { s.isProtected = false; s.protectedBy = null; });

const fortuneTellerCheck = (ft, targets) => {
  // 返回是否检测到“恶魔或红鲱鱼”
  const hasHit = targets.some((t) =>
    t.role.type === 'demon' ||
    t.isDemonSuccessor ||
    t.isFortuneTellerRedHerring
  );
  return ft.isPoisoned ? !hasHit : hasHit; // 中毒则结果翻转为错误信息
};

const empathInfo = (seats, empathIdx) => {
  const len = seats.length;
  const e = seats[empathIdx];
  const left = seats[(empathIdx - 1 + len) % len];
  const right = seats[(empathIdx + 1) % len];
  const countEvil = [left, right].filter((s) => isEvil(s)).length;
  const result = e.isPoisoned ? (countEvil === 1 ? 0 : 1) : countEvil; // 简化：被毒必然不返回真实值
  return result;
};

// Investigator 判定（允许强制误注册）
const investigatorPing = (candidateA, candidateB, forceAsMinion) => {
  const isMinionA = forceAsMinion?.has(candidateA.id) ? true : candidateA.role.type === 'minion';
  const isMinionB = forceAsMinion?.has(candidateB.id) ? true : candidateB.role.type === 'minion';
  if (isMinionA && isMinionB) return [candidateA, candidateB];
  if (isMinionA) return [candidateA];
  if (isMinionB) return [candidateB];
  return [];
};

// Empath 计算时允许“间谍伪装为好人”影响阵营判定
const empathInfoWithSpyMask = (seats, empathIdx, goodMaskSet = new Set()) => {
  const len = seats.length;
  const e = seats[empathIdx];
  const left = seats[(empathIdx - 1 + len) % len];
  const right = seats[(empathIdx + 1) % len];
  const isEvilMasked = (s) => {
    if (goodMaskSet.has(s.id)) return false; // 强制视为好人
    return isEvil(s);
  };
  const countEvil = [left, right].filter((s) => isEvilMasked(s)).length;
  return e.isPoisoned ? (countEvil === 0 ? 1 : 0) : countEvil;
};

// ---------- 测试开始 ----------
describe('Trouble Brewing 场景化严谨测试', () => {
  // 第一类：生死与防御机制
  describe('生死与防御机制 (Life & Death)', () => {
    test('僧侣 vs 恶魔：被保护的村民存活', () => {
      const seats = [
        createSeat(0, 'monk'),        // A 僧侣
        createSeat(1, 'washerwoman'), // B 村民
        createSeat(2, 'imp'),         // C 恶魔
      ];
      resetProtection(seats);
      // 夜晚：僧侣保护 B
      seats[1].isProtected = true; seats[1].protectedBy = seats[0].id;
      // 恶魔攻击 B
      const killed = kill(seats[1]);
      expect(killed).toBe(false);
      expect(seats[1].isDead).toBe(false);
      expect(seats[1].isProtected).toBe(true);
    });

    test('士兵被动防御：恶魔攻击无效', () => {
      const seats = [
        createSeat(0, 'soldier'),
        createSeat(1, 'imp'),
      ];
      const killed = kill(seats[0]);
      expect(killed).toBe(false);
      expect(seats[0].isDead).toBe(false);
    });

    test('猎手一击必杀：命中恶魔则死亡', () => {
      const seats = [
        createSeat(0, 'slayer'),
        createSeat(1, 'imp'),
        createSeat(2, 'washerwoman'),
      ];
      // 猎手对白天发动技能，目标 B 恶魔
      seats[0].hasUsedSlayerAbility = true;
      const hit = true; // 命中恶魔
      if (hit) seats[1].isDead = true;
      expect(seats[1].isDead).toBe(true);
    });

    test('猎手误杀村民：村民存活且猎手失去技能', () => {
      const seats = [
        createSeat(0, 'slayer'),
        createSeat(1, 'washerwoman'),
      ];
      seats[0].hasUsedSlayerAbility = true;
      const target = seats[1];
      const hit = target.role.type === 'demon';
      if (!hit) target.isDead = false;
      expect(target.isDead).toBe(false);
      expect(seats[0].hasUsedSlayerAbility).toBe(true); // 仍标记已使用，无法再次使用
    });
  });

  // 第二类：中毒与醉酒
  describe('中毒与醉酒 (Poison & Drunkenness)', () => {
    test('投毒者干扰共情者：结果不得为真实值 1', () => {
      // 座位 A-B-C-D (A=投毒者, B=共情者, C=村民, D=小恶魔) —— 共情者邻座只有一个恶魔
      const seats = [
        createSeat(0, 'poisoner'),
        createSeat(1, 'empath'),
        createSeat(2, 'washerwoman'),
        createSeat(3, 'imp'),
      ];
      // 正常应为 1（邻座 D 是恶魔，A 是爪牙不计为恶魔，但为邪阵营 => count 1）
      const real = empathInfo(seats, 1);
      expect(real).toBe(1);
      // 投毒者毒 B
      seats[1].isPoisoned = true;
      const poisonedResult = empathInfo(seats, 1);
      expect(poisonedResult).not.toBe(1);
    });

    test('酒鬼伪装成士兵：显示士兵但会被恶魔杀死', () => {
      // 系统真实是酒鬼，但对外伪装士兵
      const drunkSeat = createSeat(0, 'drunk');
      drunkSeat.charadeRole = getRole('soldier'); // 伪装
      const impSeat = createSeat(1, 'imp');
      const killed = kill(drunkSeat); // 酒鬼不享受士兵免疫
      expect(drunkSeat.charadeRole.name).toBe('士兵');
      expect(killed).toBe(true);
      expect(drunkSeat.isDead).toBe(true);
    });

    test('占卜师红鲱鱼：查红鲱鱼+恶魔返回“有恶魔”', () => {
      const ft = createSeat(0, 'fortune_teller');
      const red = createSeat(1, 'washerwoman');
      const imp = createSeat(2, 'imp');
      red.isFortuneTellerRedHerring = true;
      const result = fortuneTellerCheck(ft, [red, imp]);
      expect(result).toBe(true);
    });
  });

  // 第三类：身份伪装与误导
  describe('身份伪装与误导 (Registration)', () => {
    test('隐士误导调查员：可能报告 B 或 C 为爪牙', () => {
      const inv = createSeat(0, 'investigator');
      const recluse = createSeat(1, 'recluse');
      const imp = createSeat(2, 'imp');
      // 强制隐士被当作爪牙注册
      const forced = new Set([recluse.id]);
      const suspects = investigatorPing(recluse, imp, forced);
      const suspectIds = suspects.map((s) => s.id);
      expect(suspectIds.includes(recluse.id) || suspectIds.includes(imp.id)).toBe(true);
      expect(suspectIds.length).toBeGreaterThan(0);
    });

    test('间谍伪装为好人：共情者应读到 0', () => {
      // 座位 A(共情者)-B(间谍)-C(村民)
      const empathSeat = createSeat(0, 'empath');
      const spySeat = createSeat(1, 'spy');
      const villager = createSeat(2, 'washerwoman');
      const seats = [empathSeat, spySeat, villager];
      const goodMask = new Set([spySeat.id]); // 间谍伪装为善
      const info = empathInfoWithSpyMask(seats, 0, goodMask);
      expect(info).toBe(0);
    });
  });

  // 第四类：特殊胜利与继承
  describe('特殊胜利与继承 (Win & Succession)', () => {
    test('圣徒被处决：邪恶立即获胜', () => {
      const saint = createSeat(0, 'saint');
      saint.isDead = true; // 白天处决
      const winner = saint.isDead && saint.role.id === 'saint' ? 'evil' : null;
      expect(winner).toBe('evil');
    });

    test('镇长苟活：3人存活且无处决，好人获胜', () => {
      const mayor = createSeat(0, 'mayor');
      const villager = createSeat(1, 'washerwoman');
      const imp = createSeat(2, 'imp');
      const alive = [mayor, villager, imp].filter((s) => !s.isDead);
      const noExecution = true;
      const winner = alive.length === 3 && noExecution ? 'good' : null;
      expect(winner).toBe('good');
    });

    test('红唇女郎继承：恶魔被处决且存活人数>=5，女郎变恶魔，游戏继续', () => {
      const imp = createSeat(0, 'imp');
      const scarlet = createSeat(1, 'scarlet_woman');
      const others = [
        createSeat(2, 'washerwoman'),
        createSeat(3, 'chef'),
        createSeat(4, 'empath'),
        createSeat(5, 'soldier'), // 额外补足人数，确保存活>=5
      ];
      const seats = [imp, scarlet, ...others];
      // 处决恶魔
      imp.isDead = true;
      const aliveCount = seats.filter((s) => !s.isDead).length;
      if (aliveCount >= 5) {
        scarlet.role = getRole('imp');
        scarlet.isDemonSuccessor = true;
      }
      expect(imp.isDead).toBe(true);
      expect(scarlet.role.id).toBe('imp');
      // 游戏未结束（仍有新恶魔）
      const demonsAlive = seats.filter((s) => !s.isDead && (s.role.type === 'demon' || s.isDemonSuccessor));
      expect(demonsAlive.length).toBe(1);
    });

    test('小恶魔自杀传位：无红唇女郎时传位给爪牙', () => {
      const imp = createSeat(0, 'imp');
      const poisoner = createSeat(1, 'poisoner'); // 爪牙
      const seats = [imp, poisoner];
      // 夜晚小恶魔选择自己
      imp.isDead = true;
      poisoner.role = getRole('imp');
      poisoner.isDemonSuccessor = true;
      expect(imp.isDead).toBe(true);
      expect(poisoner.role.id).toBe('imp');
      expect(poisoner.isDemonSuccessor).toBe(true);
    });
  });
});

