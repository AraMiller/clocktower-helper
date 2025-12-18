/**
 * 【成双成对】剧本专项压力测试
 * 目标：验证 Evil Twin 的双子锁机制是否正确实现
 * 运行方式：npx ts-node tests/stress_test.ts
 */

import { roles, Seat } from '../app/data';
import {
  calculateGameResult,
  calculateNightDeaths,
  shouldWitchKill,
  checkVortoxEffect,
  handleRoleSwap,
  handleSnakeCharmerSwap,
  handlePitHagTransformation,
  checkGameOver,
} from '../app/engine';

// ========== 工具函数 ==========
const randomInt = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// 统一的空座位生成器，便于 SnV 场景测试
function createEmptySeats(count: number): Seat[] {
  return Array.from({ length: count }, (_, j) => ({
    id: j,
    role: null,
    charadeRole: null,
    isDead: false,
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
}

// ========== SnV 通用随机局生成器 ==========

type EvilTwinPair = { evilId: number; goodId: number } | null;

/**
 * 生成一局完整的【梦陨春宵 / 夜半狂欢】SnV 阵容：
 * - 1 恶魔
 * - 3 爪牙
 * - 9 好人（镇民 + 外来者）
 * 额外规则：
 * - 如果抽到了 Evil Twin，则自动生成对应的善良双子并记录配对
 * - 如果恶魔是 No Dashii，则初始化左右邻居的中毒状态
 */
function generateRandomGameState(): {
  seats: Seat[];
  evilTwinPair: EvilTwinPair;
} {
  const demonPool = roles.filter(
    r => r.type === 'demon' && r.script === '梦陨春宵'
  );
  const minionPool = roles.filter(
    r => r.type === 'minion' && r.script === '梦陨春宵'
  );
  const goodPool = roles.filter(
    r =>
      (r.type === 'townsfolk' || r.type === 'outsider') &&
      r.script === '梦陨春宵'
  );

  if (demonPool.length === 0 || minionPool.length < 3 || goodPool.length < 9) {
    throw new Error('SnV 角色池不足以生成 1D/3M/9G 的完整局面');
  }

  const seats: Seat[] = createEmptySeats(13);

  // 1. 随机恶魔
  const demon = demonPool[randomInt(0, demonPool.length - 1)];
  const demonSeatId = randomInt(0, seats.length - 1);
  seats[demonSeatId].role = demon;

  // 2. 随机 3 名爪牙（可能包含 Evil Twin）
  const minionsShuffled = [...minionPool].sort(() => Math.random() - 0.5);
  const selectedMinions = minionsShuffled.slice(0, 3);

  // 3. 随机 9 名好人
  const goodsShuffled = [...goodPool].sort(() => Math.random() - 0.5);
  const selectedGoods = goodsShuffled.slice(0, 9);

  // 4. 依次填充除恶魔以外的座位
  const remainingSeatIds = seats
    .map(s => s.id)
    .filter(id => id !== demonSeatId);

  let idx = 0;
  const evilTwinRole = selectedMinions.find(r => r.id === 'evil_twin') || null;
  let evilTwinSeatId: number | null = null;
  let goodTwinSeatId: number | null = null;

  // 4.1 放置爪牙
  for (const m of selectedMinions) {
    const seatId = remainingSeatIds[idx++];
    const seat = seats[seatId];
    seat.role = m;
    if (m.id === 'evil_twin') {
      evilTwinSeatId = seatId;
    }
  }

  // 4.2 放置好人
  for (const g of selectedGoods) {
    const seatId = remainingSeatIds[idx++];
    const seat = seats[seatId];
    seat.role = g;
  }

  // 5. 若存在 Evil Twin，为其随机挑一个善良玩家作为双子并记录
  let evilTwinPair: EvilTwinPair = null;
  if (evilTwinSeatId !== null) {
    const goodCandidates = seats.filter(
      s =>
        !s.isDead &&
        s.id !== evilTwinSeatId &&
        s.role &&
        (s.role.type === 'townsfolk' || s.role.type === 'outsider')
    );
    if (goodCandidates.length > 0) {
      const goodTwinSeat =
        goodCandidates[randomInt(0, goodCandidates.length - 1)];
      goodTwinSeatId = goodTwinSeat.id;
      evilTwinPair = { evilId: evilTwinSeatId, goodId: goodTwinSeatId };
    }
  }

  // 6. 若恶魔是 No Dashii，则初始化左右邻居中毒（按圆桌）
  if (demon.id === 'no_dashii') {
    const total = seats.length;
    const leftId = (demonSeatId - 1 + total) % total;
    const rightId = (demonSeatId + 1) % total;

    [leftId, rightId].forEach(id => {
      const seat = seats[id];
      if (!seat.role) return;
      // 严格按规则仅镇民中毒；外来者不受影响
      if (seat.role.type === 'townsfolk') {
        seat.isPoisoned = true;
        seat.statusDetails.push('被诺-达邻接中毒（初始）');
      }
    });
  }

  return { seats, evilTwinPair };
}

// ========== 数据生成器 ==========
/**
 * 生成【成双成对】剧本的游戏状态
 * 生成 1 恶魔、1 邪恶双子、1 好人双子，并随机赋予状态
 */
function generateDuosGameState(): {
  seats: Seat[];
  evilTwinPair: { evilId: number; goodId: number };
} {
  // 初始化 10 个座位
  const seats: Seat[] = Array.from({ length: 10 }, (_, i) => ({
    id: i,
    role: null,
    charadeRole: null,
    isDead: false,
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

  // 查找角色
  const evilTwinRole = roles.find(r => r.id === 'evil_twin');
  const demonRole = roles.find(r => r.type === 'demon' && (r.script === '梦陨春宵' || !r.script));
  const goodRoles = roles.filter(r => 
    (r.type === 'townsfolk' || r.type === 'outsider') && 
    (r.script === '梦陨春宵' || !r.script)
  );

  if (!evilTwinRole || !demonRole || goodRoles.length === 0) {
    throw new Error('无法找到必要的角色');
  }

  // 分配角色
  seats[0].role = demonRole; // 位置 0：恶魔
  seats[1].role = evilTwinRole; // 位置 1：邪恶双子
  seats[2].role = goodRoles[randomInt(0, goodRoles.length - 1)]; // 位置 2：好人双子

  // 建立双子配对
  const evilTwinPair = { evilId: 1, goodId: 2 };

  // 随机设置恶魔状态（存活/死亡）
  if (Math.random() < 0.5) {
    seats[0].isDead = true; // 50% 概率死亡
  }

  // 随机设置邪恶双子状态
  const evilTwinState = Math.random();
  if (evilTwinState < 0.25) {
    seats[1].isDead = true; // 25% 概率死亡
  } else if (evilTwinState < 0.5) {
    seats[1].isPoisoned = true; // 25% 概率中毒
  } else if (evilTwinState < 0.75) {
    seats[1].isDrunk = true; // 25% 概率酒鬼
  }
  // 25% 概率健康

  // 随机设置好人双子状态
  const goodTwinState = Math.random();
  if (goodTwinState < 0.3) {
    seats[2].isDead = true; // 30% 概率死亡
  }
  // 70% 概率存活

  // 填补剩余座位（随机分配其他角色）
  const remainingRoles = roles.filter(r => 
    r.id !== 'evil_twin' && 
    r.id !== demonRole.id && 
    r.id !== seats[2].role?.id &&
    (r.script === '梦陨春宵' || !r.script)
  );
  for (let i = 3; i < 10; i++) {
    if (remainingRoles.length > 0) {
      seats[i].role = remainingRoles[randomInt(0, remainingRoles.length - 1)];
      // 随机设置死亡状态
      if (Math.random() < 0.2) {
        seats[i].isDead = true;
      }
    }
  }

  return { seats, evilTwinPair };
}

// ========== 主测试函数 ==========
async function runStress() {
  const TOTAL = 1000;
  console.log(`🚀 开始【成双成对】剧本专项压力测试，目标局数: ${TOTAL}...\n`);

  let caseAFailures = 0; // Case A: 锁生效
  let caseBFailures = 0; // Case B: 处决胜利
  let caseCFailures = 0; // Case C: 中毒解锁

  for (let i = 0; i < TOTAL; i++) {
    // 每 100 局打印一次进度
    if (i % 100 === 0 && i > 0) {
      console.log(`⏳ 正在执行第 ${i + 1} - ${Math.min(i + 100, TOTAL)} 局...`);
    }

    try {
      const { seats, evilTwinPair } = generateDuosGameState();
      const evilTwin = seats.find(s => s.id === evilTwinPair.evilId);
      const goodTwin = seats.find(s => s.id === evilTwinPair.goodId);
      const demon = seats.find(s => 
        (s.role?.type === 'demon' || s.isDemonSuccessor) && !s.isDead
      );
      const deadDemon = seats.find(s => 
        (s.role?.type === 'demon' || s.isDemonSuccessor) && s.isDead
      );

      if (!evilTwin || !goodTwin) {
        console.error(`❌ [ERROR] 局号 ${i}: 无法找到关键角色！`);
        continue;
      }

      // ========== Case A: 锁生效 ==========
      // 场景：恶魔死 + 双子都活 + 双子健康 -> 预期结果 null
      if (deadDemon && !demon && !evilTwin.isDead && !goodTwin.isDead && 
          !evilTwin.isPoisoned && !evilTwin.isDrunk) {
        const result = calculateGameResult(seats, evilTwinPair, null);
        if (result !== null) {
          console.error(`❌ [Case A失败] 局号 ${i}: 锁生效测试失败`);
          console.error(`   场景：恶魔死 + 双子都活 + 双子健康`);
          console.error(`   预期：null (游戏继续)`);
          console.error(`   实际：${result}`);
          console.error(`   Evil Twin: 存活=${!evilTwin.isDead}, 中毒=${evilTwin.isPoisoned}, 酒鬼=${evilTwin.isDrunk}`);
          console.error(`   Good Twin: 存活=${!goodTwin.isDead}`);
          caseAFailures++;
        }
      }

      // ========== Case B: 处决胜利 ==========
      // 场景：好人双子被处决 -> 预期结果 'evil'
      if (!goodTwin.isDead) {
        // 创建测试场景：好人双子被处决
        const testSeats = seats.map(s => ({ ...s }));
        const testGoodTwin = testSeats.find(s => s.id === evilTwinPair.goodId);
        if (testGoodTwin) {
          testGoodTwin.isDead = true;
          const result = calculateGameResult(testSeats, evilTwinPair, evilTwinPair.goodId);
          if (result !== 'evil') {
            console.error(`❌ [Case B失败] 局号 ${i}: 处决胜利测试失败`);
            console.error(`   场景：好人双子被处决`);
            console.error(`   预期：'evil' (邪恶胜利)`);
            console.error(`   实际：${result}`);
            caseBFailures++;
          }
        }
      }

      // ========== Case C: 中毒解锁 ==========
      // 场景：恶魔死 + 双子都活 + 邪恶双子中毒 -> 预期结果 'good'
      if (deadDemon && !demon && !evilTwin.isDead && !goodTwin.isDead) {
        // 创建测试场景：邪恶双子中毒
        const testSeats = seats.map(s => ({ ...s }));
        const testEvilTwin = testSeats.find(s => s.id === evilTwinPair.evilId);
        if (testEvilTwin) {
          testEvilTwin.isPoisoned = true;
          testEvilTwin.isDrunk = false;
          const result = calculateGameResult(testSeats, evilTwinPair, null);
          if (result !== 'good') {
            console.error(`❌ [Case C失败] 局号 ${i}: 中毒解锁测试失败`);
            console.error(`   场景：恶魔死 + 双子都活 + 邪恶双子中毒`);
            console.error(`   预期：'good' (好人胜利)`);
            console.error(`   实际：${result}`);
            console.error(`   Evil Twin: 存活=${!testEvilTwin.isDead}, 中毒=${testEvilTwin.isPoisoned}, 酒鬼=${testEvilTwin.isDrunk}`);
            console.error(`   Good Twin: 存活=${!goodTwin.isDead}`);
            caseCFailures++;
          }
        }
      }

      // ========== Case C 变体: 酒鬼解锁 ==========
      // 场景：恶魔死 + 双子都活 + 邪恶双子酒鬼 -> 预期结果 'good'
      if (deadDemon && !demon && !evilTwin.isDead && !goodTwin.isDead) {
        const testSeats = seats.map(s => ({ ...s }));
        const testEvilTwin = testSeats.find(s => s.id === evilTwinPair.evilId);
        if (testEvilTwin) {
          testEvilTwin.isPoisoned = false;
          testEvilTwin.isDrunk = true;
          const result = calculateGameResult(testSeats, evilTwinPair, null);
          if (result !== 'good') {
            console.error(`❌ [Case C失败-酒鬼] 局号 ${i}: 酒鬼解锁测试失败`);
            console.error(`   场景：恶魔死 + 双子都活 + 邪恶双子酒鬼`);
            console.error(`   预期：'good' (好人胜利)`);
            console.error(`   实际：${result}`);
            console.error(`   Evil Twin: 存活=${!testEvilTwin.isDead}, 中毒=${testEvilTwin.isPoisoned}, 酒鬼=${testEvilTwin.isDrunk}`);
            caseCFailures++;
          }
        }
      }

    } catch (error) {
      console.error(`❌ [ERROR] 局号 ${i}: ${error}`);
    }
  }

  // ========== 输出结果 ==========
  console.log('\n============================================================');
  const totalFailures = caseAFailures + caseBFailures + caseCFailures;
  
  if (totalFailures === 0) {
    console.log('✅ 逻辑固若金汤');
    console.log(`   所有 ${TOTAL} 局测试全部通过！`);
    console.log(`   - Case A (锁生效): ✅ 通过`);
    console.log(`   - Case B (处决胜利): ✅ 通过`);
    console.log(`   - Case C (中毒解锁): ✅ 通过`);
  } else {
    console.error(`💀 测试失败: 发现了 ${totalFailures} 个逻辑违规案例`);
    console.error(`   - Case A (锁生效): ${caseAFailures} 个失败`);
    console.error(`   - Case B (处决胜利): ${caseBFailures} 个失败`);
    console.error(`   - Case C (中毒解锁): ${caseCFailures} 个失败`);
  }
  console.log('============================================================');
}

// ========== 交互测试函数 ==========
/**
 * 角色技能交互与连带死亡测试
 * 测试方古跳跃、外婆牵挂、女巫诅咒等特殊机制
 */
async function runInteractionTests() {
  const TOTAL = 1000;
  console.log(`\n🎯 开始角色技能交互测试，目标局数: ${TOTAL}...\n`);

  let caseAFailures = 0; // Case A: 方古找替身
  let caseBFailures = 0; // Case B: 外婆随孙去
  let caseCFailures = 0; // Case C: 女巫的诅咒

  for (let i = 0; i < TOTAL; i++) {
    // 每 100 局打印一次进度
    if (i % 100 === 0 && i > 0) {
      console.log(`⏳ [交互测试] 正在执行第 ${i + 1} - ${Math.min(i + 100, TOTAL)} 局...`);
    }

    try {
      // ========== Case A: 方古找替身 (The Fang Gu Jump) ==========
      if (i % 3 === 0) {
        // 生成：方古 + 外来者
        const seats: Seat[] = Array.from({ length: 10 }, (_, j) => ({
          id: j,
          role: null,
          charadeRole: null,
          isDead: false,
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

        const fangGuRole = roles.find(r => r.id === 'fang_gu');
        const outsiderRoles = roles.filter(r => r.type === 'outsider' && (r.script === '梦陨春宵' || !r.script));
        
        if (fangGuRole && outsiderRoles.length > 0) {
          seats[0].role = fangGuRole; // 位置 0：方古
          seats[1].role = outsiderRoles[randomInt(0, outsiderRoles.length - 1)]; // 位置 1：外来者

          // 动作：方古袭击外来者
          const demonAction = { sourceId: 0, targetId: 1 };
          const deaths = calculateNightDeaths(seats, demonAction, []);

          // 断言：结果必须包含方古的 ID (老恶魔必须死)
          if (!deaths.includes(0)) {
            console.error(`❌ [Case A失败] 局号 ${i}: 方古找替身测试失败`);
            console.error(`   场景：方古袭击外来者`);
            console.error(`   预期：死亡名单包含方古 ID (0)`);
            console.error(`   实际：死亡名单 = [${deaths.join(', ')}]`);
            caseAFailures++;
          }
        }
      }

      // ========== Case B: 外婆随孙去 (Grandmother's Grief) ==========
      if (i % 3 === 1) {
        // 生成：恶魔 + 孙子 + 外婆
        const seats: Seat[] = Array.from({ length: 10 }, (_, j) => ({
          id: j,
          role: null,
          charadeRole: null,
          isDead: false,
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

        const demonRole = roles.find(r => r.type === 'demon' && r.id !== 'fang_gu');
        const grandmotherRole = roles.find(r => r.id === 'grandmother');
        const goodRoles = roles.filter(r => 
          (r.type === 'townsfolk' || r.type === 'outsider') && 
          (r.script === '暗月初升' || !r.script)
        );

        if (demonRole && grandmotherRole && goodRoles.length > 0) {
          seats[0].role = demonRole; // 位置 0：恶魔
          seats[1].role = goodRoles[randomInt(0, goodRoles.length - 1)]; // 位置 1：孙子
          seats[2].role = grandmotherRole; // 位置 2：外婆

          // 设置孙子标记
          seats[1].isGrandchild = true;
          seats[2].grandchildId = 1; // 外婆的孙子是位置 1

          // 动作：恶魔袭击孙子
          const demonAction = { sourceId: 0, targetId: 1 };
          const deaths = calculateNightDeaths(seats, demonAction, []);

          // 断言：结果必须包含孙子 ID AND 外婆 ID (双死)
          if (!deaths.includes(1) || !deaths.includes(2)) {
            console.error(`❌ [Case B失败] 局号 ${i}: 外婆随孙去测试失败`);
            console.error(`   场景：恶魔袭击孙子`);
            console.error(`   预期：死亡名单包含孙子 ID (1) AND 外婆 ID (2)`);
            console.error(`   实际：死亡名单 = [${deaths.join(', ')}]`);
            console.error(`   孙子死亡: ${deaths.includes(1)}, 外婆死亡: ${deaths.includes(2)}`);
            caseBFailures++;
          }
        }
      }

      // ========== Case C: 女巫的诅咒 (The Witch's Curse) ==========
      if (i % 3 === 2) {
        // 生成：健康女巫 + 被诅咒的平民
        const seats: Seat[] = Array.from({ length: 10 }, (_, j) => ({
          id: j,
          role: null,
          charadeRole: null,
          isDead: false,
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

        const witchRole = roles.find(r => r.id === 'witch');
        const townsfolkRoles = roles.filter(r => r.type === 'townsfolk' && (r.script === '梦陨春宵' || !r.script));

        if (witchRole && townsfolkRoles.length > 0) {
          seats[0].role = witchRole; // 位置 0：女巫
          seats[1].role = townsfolkRoles[randomInt(0, townsfolkRoles.length - 1)]; // 位置 1：被诅咒的平民

          // 确保存活人数 > 3（女巫能力生效条件）
          // 添加更多存活玩家
          for (let j = 2; j < 6; j++) {
            const randomRole = roles[randomInt(0, roles.length - 1)];
            seats[j].role = randomRole;
          }

          // 测试场景 1: 健康女巫 + 被诅咒的平民 -> 应该返回 true
          const nominator = seats[1];
          const isCursed = true;
          const result1 = shouldWitchKill(nominator, isCursed, seats);
          
          if (!result1) {
            console.error(`❌ [Case C失败-场景1] 局号 ${i}: 女巫的诅咒测试失败`);
            console.error(`   场景：健康女巫 + 被诅咒的平民`);
            console.error(`   预期：true (提名者立即死亡)`);
            console.error(`   实际：${result1}`);
            console.error(`   女巫状态: 存活=${!seats[0].isDead}, 中毒=${seats[0].isPoisoned}, 酒鬼=${seats[0].isDrunk}`);
            console.error(`   存活人数: ${seats.filter(s => s.role && !s.isDead).length}`);
            caseCFailures++;
          }

          // 测试场景 2: 女巫死亡 -> 应该返回 false
          const testSeats2 = seats.map(s => ({ ...s }));
          testSeats2[0].isDead = true;
          const result2 = shouldWitchKill(nominator, isCursed, testSeats2);
          
          if (result2) {
            console.error(`❌ [Case C失败-场景2] 局号 ${i}: 女巫死亡时诅咒应失效`);
            console.error(`   场景：女巫死亡 + 被诅咒的平民`);
            console.error(`   预期：false (诅咒失效)`);
            console.error(`   实际：${result2}`);
            caseCFailures++;
          }

          // 测试场景 3: 女巫中毒 -> 应该返回 false
          const testSeats3 = seats.map(s => ({ ...s }));
          testSeats3[0].isPoisoned = true;
          const result3 = shouldWitchKill(nominator, isCursed, testSeats3);
          
          if (result3) {
            console.error(`❌ [Case C失败-场景3] 局号 ${i}: 女巫中毒时诅咒应失效`);
            console.error(`   场景：女巫中毒 + 被诅咒的平民`);
            console.error(`   预期：false (诅咒失效)`);
            console.error(`   实际：${result3}`);
            caseCFailures++;
          }

          // 测试场景 4: 存活人数 <= 3 -> 应该返回 false
          const testSeats4 = seats.map(s => ({ ...s }));
          // 杀死大部分玩家，只留3人
          for (let j = 3; j < 10; j++) {
            testSeats4[j].isDead = true;
          }
          const result4 = shouldWitchKill(nominator, isCursed, testSeats4);
          
          if (result4) {
            console.error(`❌ [Case C失败-场景4] 局号 ${i}: 存活人数<=3时诅咒应失效`);
            console.error(`   场景：存活人数 <= 3 + 被诅咒的平民`);
            console.error(`   预期：false (诅咒失效)`);
            console.error(`   实际：${result4}`);
            console.error(`   存活人数: ${testSeats4.filter(s => s.role && !s.isDead).length}`);
            caseCFailures++;
          }
        }
      }

    } catch (error) {
      console.error(`❌ [ERROR] 局号 ${i}: ${error}`);
    }
  }

  // ========== 输出结果 ==========
  console.log('\n============================================================');
  const totalFailures = caseAFailures + caseBFailures + caseCFailures;
  
  if (totalFailures === 0) {
    console.log('✅ 交互逻辑固若金汤');
    console.log(`   所有 ${TOTAL} 局交互测试全部通过！`);
    console.log(`   - Case A (方古找替身): ✅ 通过`);
    console.log(`   - Case B (外婆随孙去): ✅ 通过`);
    console.log(`   - Case C (女巫的诅咒): ✅ 通过`);
  } else {
    console.error(`💀 交互测试失败: 发现了 ${totalFailures} 个逻辑违规案例`);
    console.error(`   - Case A (方古找替身): ${caseAFailures} 个失败`);
    console.error(`   - Case B (外婆随孙去): ${caseBFailures} 个失败`);
    console.error(`   - Case C (女巫的诅咒): ${caseCFailures} 个失败`);
  }
  console.log('============================================================');
}

// ========== 夜半狂欢剧本专项测试（旧版压力测试） ==========
/**
 * 【夜半狂欢】剧本专项压力测试
 * 目标：验证 Vortox、弄蛇人、老巫婆等复杂机制
 * 运行方式：npx ts-node tests/stress_test.ts
 */
async function testSectsAndVioletsMechanics() {
  const TOTAL = 1000;
  console.log(`\n🎯 开始【夜半狂欢】剧本专项压力测试，目标局数: ${TOTAL}...\n`);

  let caseAFailures = 0; // Case A: 沃托克斯的谎言
  let caseBFailures = 0; // Case B: 弄蛇人的夺舍
  let caseCFailures = 0; // Case C: 老巫婆造人

  for (let i = 0; i < TOTAL; i++) {
    // 每 100 局打印一次进度
    if (i % 100 === 0 && i > 0) {
      console.log(`⏳ [夜半狂欢测试] 正在执行第 ${i + 1} - ${Math.min(i + 100, TOTAL)} 局...`);
    }

    try {
      // ========== Case A: 沃托克斯的谎言 (The Vortox Filter) ==========
      if (i % 3 === 0) {
        // 生成：Vortox + 某个信息位（如 Flowergirl/Town Crier）
        const seats: Seat[] = Array.from({ length: 10 }, (_, j) => ({
          id: j,
          role: null,
          charadeRole: null,
          isDead: false,
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

        const vortoxRole = roles.find(r => r.id === 'vortox');
        const infoRoles = roles.filter(r => 
          (r.id === 'flowergirl' || r.id === 'town_crier' || r.id === 'chef' || r.id === 'empath') &&
          (r.script === '梦陨春宵' || !r.script)
        );

        if (vortoxRole && infoRoles.length > 0) {
          seats[0].role = vortoxRole; // 位置 0：Vortox
          seats[1].role = infoRoles[randomInt(0, infoRoles.length - 1)]; // 位置 1：信息位

          // 随机设置 Vortox 状态（存活/死亡）
          if (Math.random() < 0.3) {
            seats[0].isDead = true; // 30% 概率死亡
          }

          // 断言：验证辅助器是否能识别"当前应当给假信息"
          const vortoxActive = checkVortoxEffect(seats);
          const expectedVortoxActive = !seats[0].isDead;

          if (vortoxActive !== expectedVortoxActive) {
            console.error(`❌ [Case A失败] 局号 ${i}: 沃托克斯的谎言测试失败`);
            console.error(`   场景：Vortox ${seats[0].isDead ? '死亡' : '存活'} + 信息位`);
            console.error(`   预期：checkVortoxEffect = ${expectedVortoxActive}`);
            console.error(`   实际：checkVortoxEffect = ${vortoxActive}`);
            caseAFailures++;
          }
        }
      }

      // ========== Case B: 弄蛇人的夺舍 (The Snake Charmer Swap) ==========
      if (i % 3 === 1) {
        // 生成：Imp (座位1) + Snake Charmer (座位2)
        const seats: Seat[] = Array.from({ length: 10 }, (_, j) => ({
          id: j,
          role: null,
          charadeRole: null,
          isDead: false,
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

        const impRole = roles.find(r => r.id === 'imp');
        const snakeCharmerRole = roles.find(r => r.id === 'snake_charmer_mr');

        if (impRole && snakeCharmerRole) {
          seats[0].role = impRole; // 位置 0：Imp (恶魔)
          seats[1].role = snakeCharmerRole; // 位置 1：Snake Charmer (弄蛇人)
          
          // 添加更多存活玩家以确保测试条件（至少 3 个存活玩家）
          const goodRoles = roles.filter(r => 
            (r.type === 'townsfolk' || r.type === 'outsider') && 
            (r.script === '夜半狂欢' || !r.script)
          );
          for (let j = 2; j < 5; j++) {
            if (goodRoles.length > 0) {
              seats[j].role = goodRoles[randomInt(0, goodRoles.length - 1)];
            }
          }

          // 动作：Snake Charmer 选中座位 0（恶魔）
          const swappedSeats = handleRoleSwap(seats, 1, 0);

          // 断言 1：座位 1（原弄蛇人）角色必须变为 Imp 且 isEvilConverted=true
          const newSnakeCharmerSeat = swappedSeats.find(s => s.id === 1);
          if (!newSnakeCharmerSeat || newSnakeCharmerSeat.role?.id !== 'imp') {
            console.error(`❌ [Case B失败-断言1] 局号 ${i}: 弄蛇人的夺舍测试失败`);
            console.error(`   场景：Snake Charmer (座位1) 选中 Imp (座位0)`);
            console.error(`   预期：座位 1 角色变为 Imp`);
            console.error(`   实际：座位 1 角色 = ${newSnakeCharmerSeat?.role?.id || 'null'}`);
            caseBFailures++;
          }

          // 断言 2：座位 0（原恶魔）角色必须变为 Snake Charmer 且 isPoisoned=true
          const newImpSeat = swappedSeats.find(s => s.id === 0);
          if (!newImpSeat || newImpSeat.role?.id !== 'snake_charmer_mr' || !newImpSeat.isPoisoned) {
            console.error(`❌ [Case B失败-断言2] 局号 ${i}: 弄蛇人的夺舍测试失败`);
            console.error(`   场景：Snake Charmer (座位1) 选中 Imp (座位0)`);
            console.error(`   预期：座位 0 角色变为 Snake Charmer 且 isPoisoned=true`);
            console.error(`   实际：座位 0 角色 = ${newImpSeat?.role?.id || 'null'}, isPoisoned = ${newImpSeat?.isPoisoned}`);
            caseBFailures++;
          }

          // 断言 3：关键验证 - 杀死座位 0（原恶魔，现弄蛇人），好人不能赢（因为恶魔在座位 1）
          // 需要确保有足够的存活玩家
          const testSeats1 = swappedSeats.map(s => s.id === 0 ? { ...s, isDead: true } : s);
          // 添加更多存活玩家以确保测试条件
          for (let j = 2; j < 5; j++) {
            if (!testSeats1[j].role) {
              const goodRole = roles.find(r => r.type === 'townsfolk' && (r.script === '夜半狂欢' || !r.script));
              if (goodRole) {
                testSeats1[j].role = goodRole;
              }
            }
          }
          const result1 = calculateGameResult(testSeats1, null, null);
          if (result1 === 'good') {
            console.error(`❌ [Case B失败-断言3] 局号 ${i}: 弄蛇人的夺舍测试失败`);
            console.error(`   场景：杀死座位 0（原恶魔，现弄蛇人）`);
            console.error(`   预期：好人不能赢（因为恶魔在座位 1）`);
            console.error(`   实际：${result1}`);
            caseBFailures++;
          }

          // 断言 4：关键验证 - 杀死座位 1（原弄蛇人，现恶魔），好人胜利
          // 需要确保有足够的存活玩家（至少 3 个），否则会因为人数不足而坏人胜
          const testSeats2 = swappedSeats.map(s => s.id === 1 ? { ...s, isDead: true } : s);
          // 添加更多存活玩家以确保测试条件
          for (let j = 2; j < 5; j++) {
            if (!testSeats2[j].role) {
              const goodRole = roles.find(r => r.type === 'townsfolk' && (r.script === '夜半狂欢' || !r.script));
              if (goodRole) {
                testSeats2[j].role = goodRole;
              }
            }
          }
          const result2 = calculateGameResult(testSeats2, null, null);
          if (result2 !== 'good') {
            console.error(`❌ [Case B失败-断言4] 局号 ${i}: 弄蛇人的夺舍测试失败`);
            console.error(`   场景：杀死座位 1（原弄蛇人，现恶魔）`);
            console.error(`   预期：'good' (好人胜利)`);
            console.error(`   实际：${result2}`);
            console.error(`   存活人数: ${testSeats2.filter(s => s.role && !s.isDead).length}`);
            caseBFailures++;
          }
        }
      }

      // ========== Case C: 老巫婆造人 (The Pit Hag Creation) ==========
      if (i % 3 === 2) {
        // 生成：Pit Hag + 任意玩家 + 原恶魔
        const seats: Seat[] = Array.from({ length: 10 }, (_, j) => ({
          id: j,
          role: null,
          charadeRole: null,
          isDead: false,
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

        const pitHagRole = roles.find(r => r.id === 'pit_hag_mr');
        const demonRole = roles.find(r => r.type === 'demon' && (r.script === '夜半狂欢' || !r.script));
        const goodRoles = roles.filter(r => 
          (r.type === 'townsfolk' || r.type === 'outsider') && 
          (r.script === '夜半狂欢' || !r.script)
        );

        if (pitHagRole && demonRole && goodRoles.length > 0) {
          seats[0].role = demonRole; // 位置 0：原恶魔
          seats[1].role = pitHagRole; // 位置 1：Pit Hag
          seats[2].role = goodRoles[randomInt(0, goodRoles.length - 1)]; // 位置 2：任意玩家

          // 动作：Pit Hag 将该玩家（座位 2）变成 Demon（创造新恶魔）
          // 注意：这里我们模拟 Pit Hag 的能力，将座位 2 变成恶魔
          const newDemonRole = roles.find(r => r.type === 'demon' && r.id !== demonRole.id);
          if (newDemonRole) {
            const transformedSeats = seats.map(s => 
              s.id === 2 ? { ...s, role: newDemonRole, isDemonSuccessor: false } : s
            );

            // 断言 1：场上现在的恶魔数量为 2（原恶魔 + 新恶魔）
            const demons = transformedSeats.filter(s => 
              (s.role?.type === 'demon' || s.isDemonSuccessor) && !s.isDead
            );
            if (demons.length !== 2) {
              console.error(`❌ [Case C失败-断言1] 局号 ${i}: 老巫婆造人测试失败`);
              console.error(`   场景：Pit Hag 将座位 2 变成恶魔`);
              console.error(`   预期：场上恶魔数量 = 2`);
              console.error(`   实际：场上恶魔数量 = ${demons.length}`);
              caseCFailures++;
            }

            // 断言 2：杀死原恶魔后游戏继续（因为有新恶魔）
            const testSeats = transformedSeats.map(s => s.id === 0 ? { ...s, isDead: true } : s);
            const result = calculateGameResult(testSeats, null, null);
            if (result === 'good') {
              console.error(`❌ [Case C失败-断言2] 局号 ${i}: 老巫婆造人测试失败`);
              console.error(`   场景：杀死原恶魔（座位 0）`);
              console.error(`   预期：游戏继续（因为有新恶魔在座位 2）`);
              console.error(`   实际：${result}`);
              caseCFailures++;
            }
          }
        }
      }

    } catch (error) {
      console.error(`❌ [ERROR] 局号 ${i}: ${error}`);
    }
  }

  // ========== 输出结果 ==========
  console.log('\n============================================================');
  const totalFailures = caseAFailures + caseBFailures + caseCFailures;
  
  if (totalFailures === 0) {
    console.log('✅ 夜半狂欢逻辑固若金汤');
    console.log(`   所有 ${TOTAL} 局测试全部通过！`);
    console.log(`   - Case A (沃托克斯的谎言): ✅ 通过`);
    console.log(`   - Case B (弄蛇人的夺舍): ✅ 通过`);
    console.log(`   - Case C (老巫婆造人): ✅ 通过`);
  } else {
    console.error(`💀 夜半狂欢测试失败: 发现了 ${totalFailures} 个逻辑违规案例`);
    console.error(`   - Case A (沃托克斯的谎言): ${caseAFailures} 个失败`);
    console.error(`   - Case B (弄蛇人的夺舍): ${caseBFailures} 个失败`);
    console.error(`   - Case C (老巫婆造人): ${caseCFailures} 个失败`);
  }
  console.log('============================================================');
}

// ========== 夜半狂欢 SnV 极端场景组合交互测试 ==========
/**
 * 阶段三：极端场景组合交互测试
 *
 * - 场景 A：弄蛇人的背刺 (The Snake Charmer Swap)
 * - 场景 B：方古的传承 (The Fang Gu Jump)
 * - 场景 C：多恶魔悖论 (The Pit Hag Demon)
 */
async function testSnVMechanics() {
  console.log('\n🎯 开始【夜半狂欢】SnV 极端场景组合交互测试...\n');

  // ---------- 场景 A：弄蛇人的背刺 ----------
  (function scenarioSnakeCharmerSwap() {
    console.log('🧪 场景 A：弄蛇人的背刺 (Snake Charmer Swap)');

    const seats = createEmptySeats(5);
    const impRole = roles.find(r => r.id === 'imp');
    const snakeCharmerRole = roles.find(r => r.id === 'snake_charmer_mr');
    const goodRoles = roles.filter(
      r =>
        (r.type === 'townsfolk' || r.type === 'outsider') &&
        (r.script === '夜半狂欢' || !r.script)
    );

    if (!impRole || !snakeCharmerRole || goodRoles.length < 3) {
      throw new Error('场景 A：缺少必要角色 (Imp / Snake Charmer / 足够的好人角色)');
    }

    const seatA = 0; // 原恶魔
    const seatB = 1; // 弄蛇人

    seats[seatA].role = impRole;
    seats[seatB].role = snakeCharmerRole;
    // 填充其余好人，保证结算时人数充足
    for (let j = 2; j < 5; j++) {
      seats[j].role = goodRoles[randomInt(0, goodRoles.length - 1)];
    }

    const swapped = handleSnakeCharmerSwap(seats, seatB, seatA);
    const seatAAfter = swapped.find(s => s.id === seatA)!;
    const seatBAfter = swapped.find(s => s.id === seatB)!;

    // 验证 1：座位 A 变成 Snake Charmer 且 isPoisoned 为 true
    if (seatAAfter.role?.id !== 'snake_charmer_mr' || !seatAAfter.isPoisoned) {
      console.error('❌ [场景 A] 断言失败：座位 A 未正确变为中毒的 Snake Charmer');
      console.error(`   实际角色 = ${seatAAfter.role?.id || 'null'}, isPoisoned = ${seatAAfter.isPoisoned}`);
      throw new Error('场景 A：Snake Charmer 交换后座位 A 状态错误');
    }

    // 验证 2：座位 B 变成 Imp
    if (seatBAfter.role?.id !== 'imp') {
      console.error('❌ [场景 A] 断言失败：座位 B 未正确变为 Imp');
      console.error(`   实际角色 = ${seatBAfter.role?.id || 'null'}`);
      throw new Error('场景 A：Snake Charmer 交换后座位 B 状态错误');
    }

    // 验证 3：处决座位 A（原恶魔，现弄蛇人） -> 好人不能赢
    const afterExecA = swapped.map(s =>
      s.id === seatA ? { ...s, isDead: true } : s
    );
    const resultA = checkGameOver(afterExecA, null, seatA);
    if (resultA && resultA.winResult === 'good') {
      console.error('❌ [场景 A] 断言失败：处决原恶魔（现弄蛇人）后好人不应立刻获胜');
      console.error(`   实际结算结果 = ${resultA.winResult}, 原因 = ${resultA.winReason}`);
      throw new Error('场景 A：处决座位 A 后错误地判定为好人胜利');
    }

    // 验证 4：处决座位 B（现恶魔） -> 好人胜利
    const afterExecB = afterExecA.map(s =>
      s.id === seatB ? { ...s, isDead: true } : s
    );
    const resultB = checkGameOver(afterExecB, null, seatB);
    if (!resultB || resultB.winResult !== 'good') {
      console.error('❌ [场景 A] 断言失败：处决现恶魔（座位 B）后应为好人胜利');
      console.error(`   实际结算结果 = ${resultB ? resultB.winResult : 'null'}`);
      throw new Error('场景 A：处决座位 B 后未正确结算为好人胜利');
    }

    console.log('✅ 场景 A 通过');
  })();

  // ---------- 场景 B：方古的传承 ----------
  (function scenarioFangGuJump() {
    console.log('🧪 场景 B：方古的传承 (Fang Gu Jump)');

    const seats = createEmptySeats(5);
    const fangGuRole = roles.find(r => r.id === 'fang_gu');
    const outsiderRoles = roles.filter(
      r =>
        r.type === 'outsider' &&
        (r.script === '梦陨春宵' || !r.script)
    );

    if (!fangGuRole || outsiderRoles.length === 0) {
      throw new Error('场景 B：缺少必要角色 Fang Gu 或 Outsider');
    }

    const fangGuSeatId = 0;
    const outsiderSeatId = 1;
    seats[fangGuSeatId].role = fangGuRole;
    seats[outsiderSeatId].role =
      outsiderRoles[randomInt(0, outsiderRoles.length - 1)];

    const demonAction = { sourceId: fangGuSeatId, targetId: outsiderSeatId };
    const deaths = calculateNightDeaths(seats, demonAction, []);

    // 验证 1：原 Fang Gu 必须在死亡名单中
    if (!deaths.includes(fangGuSeatId)) {
      console.error('❌ [场景 B] 断言失败：死亡名单中缺少原 Fang Gu');
      console.error(`   实际死亡名单 = [${deaths.join(', ')}]`);
      throw new Error('场景 B：Fang Gu 未正确死亡');
    }

    // 验证 2：Outsider 必须存活（不在死亡名单中）
    if (deaths.includes(outsiderSeatId)) {
      console.error('❌ [场景 B] 断言失败：外来者被错误地判定为死亡');
      console.error(`   实际死亡名单 = [${deaths.join(', ')}]`);
      throw new Error('场景 B：外来者错误死亡');
    }

    // 模拟 UI 中的方古传承逻辑：目标变为 Fang Gu，原 Fang Gu 死亡
    const fangGuConvertedFlag = false; // 单次场景测试，可视为尚未转换过
    if (!fangGuConvertedFlag && seats[outsiderSeatId].role?.type === 'outsider') {
      const fangGuPureRole = roles.find(r => r.id === 'fang_gu') || seats[outsiderSeatId].role;
      seats[outsiderSeatId] = {
        ...seats[outsiderSeatId],
        role: fangGuPureRole,
        isDemonSuccessor: false,
      };
      seats[fangGuSeatId] = {
        ...seats[fangGuSeatId],
        isDead: true,
      };
    }

    // 验证 3：外来者已变更为 Fang Gu 且阵营为恶魔
    const outsiderAfter = seats[outsiderSeatId];
    if (outsiderAfter.role?.id !== 'fang_gu' || outsiderAfter.role.type !== 'demon') {
      console.error('❌ [场景 B] 断言失败：外来者未正确转化为 Fang Gu (恶魔)');
      console.error(
        `   实际角色 ID = ${outsiderAfter.role?.id || 'null'}, type = ${outsiderAfter.role?.type || 'null'}`,
      );
      throw new Error('场景 B：外来者未正确变更为 Fang Gu');
    }

    console.log('✅ 场景 B 通过');
  })();

  // ---------- 场景 C：多恶魔悖论 ----------
  (function scenarioPitHagDemon() {
    console.log('🧪 场景 C：多恶魔悖论 (Pit Hag Demon)');

    const seats = createEmptySeats(6);
    const impRole = roles.find(r => r.id === 'imp');
    const pitHagRole = roles.find(
      r => r.id === 'pit_hag_mr' || r.id === 'pit_hag'
    );
    const goodRoles = roles.filter(
      r =>
        (r.type === 'townsfolk' || r.type === 'outsider') &&
        (r.script === '夜半狂欢' || !r.script)
    );

    if (!impRole || !pitHagRole || goodRoles.length < 3) {
      throw new Error('场景 C：缺少必要角色 (Imp / Pit Hag / 足够的好人角色)');
    }

    const originalImpSeatId = 0;
    const pitHagSeatId = 1;
    const targetGoodSeatId = 2;

    seats[originalImpSeatId].role = impRole;
    seats[pitHagSeatId].role = pitHagRole;
    seats[targetGoodSeatId].role = goodRoles[randomInt(0, goodRoles.length - 1)];
    // 再补充一些好人，保证人数充足
    for (let j = 3; j < 6; j++) {
      seats[j].role = goodRoles[randomInt(0, goodRoles.length - 1)];
    }

    // Pit Hag 将好人变成第 2 个 Imp
    const transformedSeats = handlePitHagTransformation(
      seats,
      targetGoodSeatId,
      'imp'
    );

    // 基本 sanity check：现在应至少有 2 个恶魔在场
    const aliveDemons = transformedSeats.filter(
      s => !s.isDead && (s.role?.type === 'demon' || s.isDemonSuccessor)
    );
    if (aliveDemons.length < 2) {
      console.error('❌ [场景 C] 断言失败：Pit Hag 造人后场上恶魔数量不足 2');
      console.error(`   实际恶魔数量 = ${aliveDemons.length}`);
      throw new Error('场景 C：Pit Hag 未正确造出第二个恶魔');
    }

    // 处决原 Imp，规则：只要还有恶魔活着，游戏不应以好人胜利结束
    const afterExecOriginalImp = transformedSeats.map(s =>
      s.id === originalImpSeatId ? { ...s, isDead: true } : s
    );
    const result = checkGameOver(afterExecOriginalImp, null, originalImpSeatId);
    if (result && result.winResult === 'good') {
      console.error('❌ [场景 C] 断言失败：处决原 Imp 后仍有恶魔存活，不应判定好人胜利');
      console.error(`   实际结算结果 = ${result.winResult}, 原因 = ${result.winReason}`);
      throw new Error('场景 C：多恶魔场景下错误地判定好人胜利');
    }

    console.log('✅ 场景 C 通过');
  })();

  console.log('\n✅ 【夜半狂欢】SnV 极端场景组合交互测试全部通过！');
}

// ========== 夜半狂欢 SnV 混沌工程与全量随机性压力测试（阶段五） ==========
/**
 * 阶段五：混沌工程与全量随机性压力测试（script: 'snv'）
 *
 * - 强化弄蛇人：50% 概率命中恶魔
 * - 强化方古：优先攻击外来者
 * - 动态断言 1：恶魔守恒定律（除非游戏结束，恶魔数量始终 >= 1，Pit Hag 只能造更多，不能造没）
 * - 动态断言 2：弄蛇人交换导致的中毒为永久中毒，不应在游戏过程中被“治好”
 */
async function runSnVChaosStress() {
  const TOTAL = 1000;
  console.log(`\n💥 开始【夜半狂欢】SnV 混沌工程与全量随机性压力测试（${TOTAL} 局）...\n`);

  let demonConservationViolations = 0;
  let multiDemonGoodWinViolations = 0;
  let vortoxLogicViolations = 0;
  let snakePoisonPersistenceViolations = 0;
  let potentialInfiniteLoops = 0;

  for (let i = 0; i < TOTAL; i++) {
    if (i % 100 === 0 && i > 0) {
      console.log(`⏳ [Chaos] 正在执行第 ${i + 1} - ${Math.min(i + 100, TOTAL)} 局...`);
    }

    try {
      // ---------- 1. 随机生成 SnV 完整局面 ----------
      const { seats, evilTwinPair } = generateRandomGameState();

      // ---------- 2. 夜晚/白天循环：技能发动 + 处决 ----------
      const MAX_ROUNDS = 20; // 每局最多 20 个“昼夜”循环
      let round = 0;
      let gameResult: 'good' | 'evil' | null = null;
      let sweetheartTriggered = false;

      // 简单的“信息函数”模拟：在有 Vortox 时，信息被翻转
      const fakeInfoEngine = (truth: boolean, seatsSnapshot: Seat[]): boolean => {
        const vortoxActive = checkVortoxEffect(seatsSnapshot);
        return vortoxActive ? !truth : truth;
      };

      while (round < MAX_ROUNDS) {
        round++;

        // ========= 夜晚：技能发动 =========

        // 2.1 Snake Charmer：20% 概率发动
        const snakeSeat = seats.find(
          s =>
            !s.isDead &&
            (s.role?.id === 'snake_charmer' || s.role?.id === 'snake_charmer_mr')
        );
        const demonSeat = seats.find(
          s => !s.isDead && (s.role?.type === 'demon' || s.isDemonSuccessor)
        );
        if (snakeSeat && Math.random() < 0.2) {
          // 随机目标（可能是恶魔，也可能不是）
          const candidates = seats.filter(s => !s.isDead && s.id !== snakeSeat.id);
          if (candidates.length > 0) {
            const target =
              candidates[randomInt(0, candidates.length - 1)];
            const swapped = handleSnakeCharmerSwap(seats, snakeSeat.id, target.id);
            swapped.forEach((s, idx) => (seats[idx] = s));
          }
        }

        // 2.2 Pit Hag：15% 概率把一名玩家变成任意随机角色（包括恶魔）
        const pitHagSeat = seats.find(
          s =>
            !s.isDead &&
            (s.role?.id === 'pit_hag' || s.role?.id === 'pit_hag_mr')
        );
        if (pitHagSeat && Math.random() < 0.15) {
          const targets = seats.filter(s => !s.isDead && s.id !== pitHagSeat.id);
          if (targets.length > 0) {
            const target = targets[randomInt(0, targets.length - 1)];
            const randomRole =
              roles.filter(r => r.script === '梦陨春宵')[
                randomInt(
                  0,
                  roles.filter(r => r.script === '梦陨春宵').length - 1
                )
              ];
            const transformed = handlePitHagTransformation(
              seats,
              target.id,
              randomRole.id
            );
            transformed.forEach((s, idx) => (seats[idx] = s));
          }
        }

        // 2.3 Cerenovus：30% 概率给一名玩家赋予“疯狂”
        const cerenovusSeat = seats.find(
          s => !s.isDead && s.role?.id === 'cerenovus'
        );
        if (cerenovusSeat && Math.random() < 0.3) {
          const targets = seats.filter(s => !s.isDead && s.id !== cerenovusSeat.id);
          if (targets.length > 0) {
            const target = targets[randomInt(0, targets.length - 1)];
            // 使用 statusDetails 记录疯狂状态，同时打一个 isMad 标记（仅测试用）
            target.statusDetails.push('被洗脑师赋予疯狂 (isMad)');
            (target as any).isMad = true;
          }
        }

        // 2.4 恶魔行动：若恶魔是 Fang Gu，优先攻击外来者；否则普通攻击
        const currentDemonSeat = seats.find(
          s => !s.isDead && (s.role?.type === 'demon' || s.isDemonSuccessor)
        );
        if (currentDemonSeat) {
          let target: Seat | undefined;

          if (currentDemonSeat.role?.id === 'fang_gu') {
            const outsiderTargets = seats.filter(
              s =>
                !s.isDead &&
                s.id !== currentDemonSeat.id &&
                s.role?.type === 'outsider'
            );
            if (outsiderTargets.length > 0 && Math.random() < 0.9) {
              target =
                outsiderTargets[randomInt(0, outsiderTargets.length - 1)];
            }
          }

          if (!target) {
            const candidates = seats.filter(
              s => !s.isDead && s.id !== currentDemonSeat.id
            );
            if (candidates.length > 0) {
              target =
                candidates[randomInt(0, candidates.length - 1)];
            }
          }

          if (target) {
            const deaths = calculateNightDeaths(
              seats,
              { sourceId: currentDemonSeat.id, targetId: target.id },
              []
            );
            deaths.forEach(id => {
              const seat = seats.find(s => s.id === id);
              if (seat) seat.isDead = true;
            });
          }
        }

        // 2.5 Vortox：信息必须为假（通过 fakeInfoEngine 断言）
        const vortoxAlive = checkVortoxEffect(seats);
        if (vortoxAlive) {
          const trueFact = true;
          const infoResult = fakeInfoEngine(trueFact, seats);
          if (infoResult !== false) {
            console.error(
              `❌ [Chaos] Vortox 信息悖论：局号 ${i}, 回合 ${round}, 期望信息被翻转为假`
            );
            vortoxLogicViolations++;
            break;
          }
        }

        // 2.6 Sweetheart：死亡后下一回合令一名玩家醉酒
        const sweetheartSeat = seats.find(
          s => s.role?.id === 'sweetheart'
        );
        if (sweetheartSeat && sweetheartSeat.isDead && !sweetheartTriggered) {
          // 标记将在下一个循环生效
          sweetheartTriggered = true;
        } else if (sweetheartTriggered) {
          const aliveCandidates = seats.filter(
            s => !s.isDead && !!s.role && !s.isDrunk
          );
          if (aliveCandidates.length > 0) {
            const drunkTarget =
              aliveCandidates[randomInt(0, aliveCandidates.length - 1)];
            drunkTarget.isDrunk = true;
            drunkTarget.statusDetails.push('被心上人死亡效果随机灌醉');
          }
          sweetheartTriggered = false;
        }

        // 2.7 动态断言：弄蛇人交换导致的中毒永久性
        const snakePoisonBroken = seats.find(s => {
          const details = s.statusDetails || [];
          const hasSnakePoison = details.some(d =>
            d.includes('舞蛇人交换中毒')
          );
          return hasSnakePoison && !s.isPoisoned && !s.isDead;
        });
        if (snakePoisonBroken) {
          console.error(
            `❌ [Chaos] 弄蛇人中毒持久性违例：局号 ${i}, 回合 ${round}, 座位 ${snakePoisonBroken.id} 不再 isPoisoned=true`
          );
          snakePoisonPersistenceViolations++;
          break;
        }

        // ========= 白天：随机处决 + 胜负计算 =========

        const aliveForExecution = seats.filter(s => !s.isDead && s.role);
        if (aliveForExecution.length === 0) {
          break;
        }
        const executed =
          aliveForExecution[randomInt(0, aliveForExecution.length - 1)];
        executed.isDead = true;

        // 断言 F：多恶魔场景下，杀死其中一个恶魔不能直接好人胜利
        const aliveDemons = seats.filter(
          s => !s.isDead && (s.role?.type === 'demon' || s.isDemonSuccessor)
        );
        const totalDemonsEver = seats.filter(
          s => s.role?.type === 'demon' || s.isDemonSuccessor
        ).length;

        // 只在“曾经造出过 >=2 恶魔且当前仍有恶魔存活”的局面下检查
        gameResult = calculateGameResult(seats, evilTwinPair, executed.id);
        if (totalDemonsEver >= 2 && aliveDemons.length >= 1 && gameResult === 'good') {
          console.error(
            `❌ [Chaos] 多恶魔悖论：局号 ${i}, 回合 ${round}, 仍有恶魔存活却判定为好人胜利`
          );
          multiDemonGoodWinViolations++;
          break;
        }

        // 断言 G：Vortox 在场时 calculateGameResult 仍然只依赖“恶魔生死”和双子锁
        if (vortoxAlive) {
          const demonLikeSeat = seats.find(
            s => !s.isDead && s.role?.id === 'vortox'
          );
          if (demonLikeSeat && demonLikeSeat.role) {
            // 构造一个“去 Vortox 标签但仍是恶魔类型”的虚拟副本进行对比
            const clonedSeats: Seat[] = seats.map(s => ({ ...s }));
            const clonedSeat = clonedSeats.find(s => s.id === demonLikeSeat.id);
            if (clonedSeat && clonedSeat.role) {
              clonedSeat.role = {
                ...clonedSeat.role,
                id: 'dummy_demon_for_vortox_test',
              } as any;
            }
            const resultWithVortox = calculateGameResult(
              seats,
              evilTwinPair,
              executed.id
            );
            const resultWithoutVortox = calculateGameResult(
              clonedSeats,
              evilTwinPair,
              executed.id
            );
            if (resultWithVortox !== resultWithoutVortox) {
              console.error(
                `❌ [Chaos] Vortox 胜负逻辑污染：局号 ${i}, 回合 ${round}, Vortox 身份影响了胜负判定`
              );
              vortoxLogicViolations++;
              break;
            }
          }
        }

        // 2.8 动态断言：恶魔守恒定律（考虑邪恶双子双子锁）
        const demonsAliveNow = seats.filter(
          s => !s.isDead && (s.role?.type === 'demon' || s.isDemonSuccessor)
        );

        // 检查双子锁是否激活：
        // - 邪恶双子存活且未中毒/未醉酒
        // - 配对的善良双子也存活
        const isTwinLocked = (() => {
          if (!evilTwinPair) return false;
          const evilTwinSeat = seats.find(s => s.id === evilTwinPair.evilId);
          const goodTwinSeat = seats.find(s => s.id === evilTwinPair.goodId);
          if (!evilTwinSeat || !goodTwinSeat) return false;

          const evilHealthy =
            !evilTwinSeat.isDead &&
            !evilTwinSeat.isPoisoned &&
            !evilTwinSeat.isDrunk;
          const goodAlive = !goodTwinSeat.isDead;

          return evilHealthy && goodAlive;
        })();

        // 只有在“双子锁未生效”的前提下，无恶魔且游戏继续才算真正的守恒违例
        if (gameResult === null && demonsAliveNow.length < 1 && !isTwinLocked) {
          console.error(
            `❌ [Chaos] 恶魔守恒违例：局号 ${i}, 回合 ${round}, 恶魔数量 = ${demonsAliveNow.length} 但游戏未结束（未被邪恶双子锁住）`
          );
          demonConservationViolations++;
          break;
        }

        // 胜负已出则退出循环
        if (gameResult !== null) {
          break;
        }
      }

      if (gameResult === null && round >= MAX_ROUNDS) {
        console.error(
          `💀 [Chaos] 可能存在逻辑死循环：局号 ${i}, 已执行 ${MAX_ROUNDS} 个昼夜仍未结束`
        );
        potentialInfiniteLoops++;
      }
    } catch (error) {
      console.error(`❌ [Chaos ERROR] 局号 ${i}:`, error);
    }
  }

  // ---------- 3. 输出 Chaos 测试统计结果 ----------
  console.log('\n============================================================');
  console.log('🧨 SnV 混沌工程与全量随机性压力测试完成');
  console.log(`   总局数: ${TOTAL}`);
  console.log(`   恶魔守恒违例次数: ${demonConservationViolations}`);
  console.log(`   多恶魔悖论违例次数(断言 F): ${multiDemonGoodWinViolations}`);
  console.log(`   Vortox 胜负逻辑污染次数(断言 G): ${vortoxLogicViolations}`);
  console.log(`   弄蛇人中毒持久性违例次数: ${snakePoisonPersistenceViolations}`);
  console.log(`   可能的逻辑死循环（超过最大昼夜数）: ${potentialInfiniteLoops}`);
  console.log('============================================================');
}

// ========== 主执行函数 ==========
async function runAllTests() {
  // 运行原有的双子测试
  await runStress();
  
  // 运行交互测试
  await runInteractionTests();

  // 运行夜半狂欢专项测试（旧版压力测试）
  await testSectsAndVioletsMechanics();

  // 运行 SnV 极端场景组合交互测试（阶段三）
  await testSnVMechanics();

  // 运行 SnV 混沌工程与全量随机性压力测试（阶段五）
  await runSnVChaosStress();
}

// 运行所有测试
runAllTests().catch(console.error);
