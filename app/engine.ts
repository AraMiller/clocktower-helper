import { Seat, roles } from "./data";

/**
 * 核心逻辑引擎：计算夜晚死亡结果
 * 这是一个纯函数，不依赖 React 状态，方便测试和复用。
 * @param seats 当前座位状态
 * @param demonAction 恶魔的行动（谁杀了谁）
 * @param protectiveActions 保护类角色的行动（谁保护了谁）
 * @returns 死亡玩家 ID 列表
 */
export function calculateNightDeaths(
  seats: Seat[],
  demonAction: { sourceId: number; targetId: number } | null,
  protectiveActions: { sourceId: number; targetId: number; roleId: string }[] = []
): number[] {
  // 日志：检测恶魔是否正在攻击士兵
  if (demonAction) {
    const t = seats.find(s => s.id === demonAction.targetId);
    if (t?.role?.id === 'soldier') {
      console.log(`👀 引擎检测：恶魔正在攻击士兵！(SoldierID: ${t.id})`);
    }
  }

  const deaths: number[] = [];

  // 1. 如果没有恶魔行动，直接返回空
  if (!demonAction) return [];

  const demonSeat = seats.find(s => s.id === demonAction.sourceId);
  const targetSeat = seats.find(s => s.id === demonAction.targetId);

  if (!demonSeat || !targetSeat) return [];

  // 失忆者能力代理：确定实际的执行角色
  let actualRole = demonSeat.role;
  if (demonSeat.role?.id === 'amnesiac' && demonSeat.amnesiacAbilityId) {
    const hiddenRole = roles.find(r => r.id === demonSeat.amnesiacAbilityId);
    if (hiddenRole) {
      actualRole = hiddenRole;
      console.log(`🎭 失忆者(${demonSeat.id + 1}号)代理执行【${hiddenRole.name}】的能力`);
    }
  }

  // 2. 检查攻击发起者（恶魔）状态
  // 如果恶魔中毒或醉酒，攻击失效（无事发生）
  if (demonSeat.isPoisoned || demonSeat.isDrunk) {
    return [];
  }

  // 3. 检查目标防御状态（防御优先级计算）

  // A. 僧侣 (Monk) 保护
  // 查找是否有僧侣保护了该目标，且僧侣自身未中毒/醉酒
  const monkProtection = protectiveActions.find(
    p => p.targetId === targetSeat.id && p.roleId === 'monk'
  );
  if (monkProtection) {
    const monkSeat = seats.find(s => s.id === monkProtection.sourceId);
    // 只有当僧侣健康时，保护才有效
    if (monkSeat && !monkSeat.isPoisoned && !monkSeat.isDrunk) {
      return []; // 攻击被僧侣阻挡
    }
  }

  // B. 旅店老板 (Innkeeper) 保护
  // (逻辑同上，需确认旅店老板是否中毒)
  const innkeeperProtection = protectiveActions.find(
    p => p.targetId === targetSeat.id && p.roleId === 'innkeeper'
  );
  if (innkeeperProtection) {
    const innkeeperSeat = seats.find(s => s.id === innkeeperProtection.sourceId);
    if (innkeeperSeat && !innkeeperSeat.isPoisoned && !innkeeperSeat.isDrunk) {
      return []; // 攻击被旅店老板阻挡
    }
  }

  // C. 士兵 (Soldier) 被动技能
  // 士兵被恶魔攻击不会死亡，除非士兵中毒/醉酒
  if (targetSeat.role?.id === 'soldier') {
    if (!targetSeat.isPoisoned && !targetSeat.isDrunk) {
      return []; // 攻击被士兵自身防御阻挡
    }
  }

  // D. 茶艺师 (Tea Lady) 被动技能
  // (此处简化逻辑，如需完整实现需结合 verifyTeaLady 函数)

  // 4. 确认死亡 / 方古特殊逻辑（使用actualRole判断）
  if (actualRole?.id === 'fang_gu' && targetSeat.role?.type === 'outsider') {
    // 方古袭击外来者：目标不死，而是被转化为恶魔；原方古死亡
    if (!deaths.includes(demonSeat.id)) {
      deaths.push(demonSeat.id);
    }
  } else {
    // 默认情况：目标死亡
    deaths.push(targetSeat.id);
  }

  // ========== 5. 特殊连带死亡逻辑 ==========

  // 5.1 外婆牵挂 (Grandmother's Bond)
  // 条件：如果死亡名单中包含了被标记为"孙子 (Grandchild)"的玩家 ID
  // 结果：场上活着的、未中毒的外婆 (Grandmother) 也必须加入死亡名单
  const grandchildIds = deaths.filter(deathId => {
    const deadSeat = seats.find(s => s.id === deathId);
    return deadSeat?.isGrandchild === true;
  });

  if (grandchildIds.length > 0) {
    // 查找所有活着的、未中毒的外婆
    const grandmothers = seats.filter(s => 
      s.role?.id === 'grandmother' && 
      !s.isDead && 
      !s.isPoisoned && 
      !s.isDrunk
    );

    // 将外婆加入死亡名单
    grandmothers.forEach(grandmother => {
      if (!deaths.includes(grandmother.id)) {
        deaths.push(grandmother.id);
      }
    });
  }

  return deaths;
}

/**
 * 辅助函数：判断是否应该触发市长(Mayor)的"替死"逻辑
 */
export function shouldTriggerMayorBounce(
  seats: Seat[],
  targetId: number
): boolean {
  const target = seats.find(s => s.id === targetId);
  if (!target || target.role?.id !== 'mayor') return false;
  
  // 市长只有在未中毒/未醉酒时才能触发替死
  if (target.isPoisoned || target.isDrunk) return false;

  return true;
}

/**
 * 检查女巫诅咒是否应该触发（提名者立即死亡）
 * 这是一个纯函数，不依赖 React 状态，方便测试和复用。
 * 
 * @param nominator 发起提名的玩家
 * @param isCursed 该玩家是否被女巫诅咒
 * @param seats 当前座位状态（用于检查女巫是否存活/健康）
 * @returns true 如果提名者应该立即死亡，false 否则
 */
export function shouldWitchKill(
  nominator: Seat,
  isCursed: boolean,
  seats: Seat[]
): boolean {
  // 如果提名者未被诅咒，不触发
  if (!isCursed) {
    return false;
  }

  // 查找女巫
  const witch = seats.find(s => s.role?.id === 'witch');
  
  // 如果女巫不存在，诅咒无效
  if (!witch) {
    return false;
  }

  // 如果女巫已死亡，诅咒无效
  if (witch.isDead) {
    return false;
  }

  // 如果女巫中毒或醉酒，诅咒无效
  if (witch.isPoisoned || witch.isDrunk) {
    return false;
  }

  // 检查存活人数：如果只有三名或更少存活的玩家，女巫失去此能力
  const aliveCount = seats.filter(s => s.role && !s.isDead).length;
  if (aliveCount <= 3) {
    return false;
  }

  // 所有条件满足，诅咒生效，提名者立即死亡
  return true;
}

/**
 * 计算游戏结果（核心胜利判定逻辑）
 * 这是一个纯函数，不依赖 React 状态，方便测试和复用。
 * 专门针对【成双成对】剧本的胜负判定，包含 Evil Twin 的双子锁机制。
 * 
 * @param seats 当前座位状态
 * @param evilTwinPair 邪恶双子配对信息（evilId: 邪恶双子ID, goodId: 好人双子ID），如果为 null 则按标准逻辑判定
 * @param executedPlayerId 被处决的玩家ID（如果有），用于判断好人双子是否被处决
 * @returns 'good' (好人胜) | 'evil' (坏人胜) | null (游戏继续)
 */
export function calculateGameResult(
  seats: Seat[],
  evilTwinPair: { evilId: number; goodId: number } | null = null,
  executedPlayerId: number | null = null
): 'good' | 'evil' | null {
  // ========== 1. 基础统计 ==========
  const aliveCount = seats.filter(s => s.role && !s.isDead).length;
  const livingDemons = seats.filter(
    s => !s.isDead && (s.role?.type === 'demon' || s.isDemonSuccessor)
  );
  const deadDemon = seats.find(
    s => (s.role?.type === 'demon' || s.isDemonSuccessor) && s.isDead
  );

  // ========== 2. 邪恶双子逻辑（双子锁 & 处决胜利） ==========
  if (evilTwinPair) {
    const evilTwin = seats.find(s => s.id === evilTwinPair.evilId);
    const goodTwin = seats.find(s => s.id === evilTwinPair.goodId);

    if (evilTwin && goodTwin) {
      // 3.1 邪恶胜利：如果好人双子被处决
      if (executedPlayerId !== null && executedPlayerId === evilTwinPair.goodId && goodTwin.isDead) {
        return 'evil';
      }

      // 2.2 计算"双子锁" (Twin Lock)
      // 锁生效条件：!evilTwin.isDead AND !goodTwin.isDead AND !evilTwin.isPoisoned AND !evilTwin.isDrunk
      const lockActive = 
        !evilTwin.isDead && 
        !goodTwin.isDead && 
        !evilTwin.isPoisoned && 
        !evilTwin.isDrunk;

      // 2.3 如果锁生效且场上已没有任何活着的恶魔，阻止好人胜利（返回 null）
      if (lockActive && livingDemons.length === 0) {
        return null; // 游戏继续，好人无法获胜（双子锁住局面）
      }
    }
  }

  // ========== 3. 好人胜利：场上没有任何活着的恶魔（包括被 Pit Hag 变走的情况） ==========
  if (livingDemons.length === 0) {
    return 'good';
  }

  // ========== 4. 邪恶胜利：存活人数过少 ==========
  if (aliveCount <= 2) {
    return 'evil';
  }

  // ========== 5. 其他情况：游戏继续 ==========
  return null;
}

/**
 * 游戏结束检查（兼容性函数）
 * @deprecated 请使用 calculateGameResult 代替
 */
export interface GameOverResult {
  winResult: 'good' | 'evil';
  winReason: string;
}

export function checkGameOver(
  seats: Seat[],
  evilTwinPair: { evilId: number; goodId: number } | null = null,
  executedPlayerId: number | null = null
): GameOverResult | null {
  const result = calculateGameResult(seats, evilTwinPair, executedPlayerId);
  
  if (result === null) {
    return null;
  }

  // 生成原因
  let winReason = '';
  if (result === 'evil') {
    if (executedPlayerId !== null && evilTwinPair && executedPlayerId === evilTwinPair.goodId) {
      winReason = '镜像双子：善良双子被处决';
    } else {
      winReason = '场上仅存2位或更少存活玩家';
    }
  } else {
    const deadDemon = seats.find(s => 
      (s.role?.type === 'demon' || s.isDemonSuccessor) && s.isDead
    );
    winReason = deadDemon?.isDemonSuccessor ? '小恶魔（传）死亡' : '小恶魔死亡';
  }

  return {
    winResult: result,
    winReason,
  };
}

/**
 * 检查 Vortox (沃托克斯) 效果是否激活
 * 如果场上有存活的 Vortox，返回 true（提示信息必须为假）
 * 
 * @param seats 当前座位状态
 * @returns true 如果 Vortox 存活且效果激活，false 否则
 */
export function checkVortoxEffect(seats: Seat[]): boolean {
  const aliveVortox = seats.find(s => 
    !s.isDead && 
    (s.role?.id === 'vortox' || (s.isDemonSuccessor && s.role?.id === 'vortox'))
  );
  return !!aliveVortox;
}

/**
 * 检查 Vortox (沃托克斯) 是否处于激活状态（语义别名）
 * 与 `checkVortoxEffect` 完全等价，用于夜半狂欢脚本中的可读命名。
 */
export function checkVortoxActive(seats: Seat[]): boolean {
  return checkVortoxEffect(seats);
}

/**
 * 处理角色交换（针对弄蛇人/老巫婆等角色）
 * 当发生角色交换时，更新 seats 中的 role 字段，并正确转移状态（如 isPoisoned）
 * 
 * @param seats 当前座位状态数组
 * @param sourceId 源玩家 ID（例如：弄蛇人）
 * @param targetId 目标玩家 ID（例如：恶魔）
 * @returns 更新后的座位状态数组
 */
export function handleRoleSwap(
  seats: Seat[],
  sourceId: number,
  targetId: number
): Seat[] {
  const sourceSeat = seats.find(s => s.id === sourceId);
  const targetSeat = seats.find(s => s.id === targetId);
  
  if (!sourceSeat || !targetSeat || !sourceSeat.role || !targetSeat.role) {
    return seats; // 无效交换，返回原数组
  }

  // 保存源角色的状态
  const sourceRole = sourceSeat.role;
  const sourceIsPoisoned = sourceSeat.isPoisoned;
  const sourceIsDrunk = sourceSeat.isDrunk;
  const sourceIsDemonSuccessor = sourceSeat.isDemonSuccessor;
  const sourceIsEvilConverted = sourceSeat.isEvilConverted;
  const sourceIsGoodConverted = sourceSeat.isGoodConverted;
  const sourceStatusDetails = sourceSeat.statusDetails || [];
  const sourceStatuses = sourceSeat.statuses || [];

  // 保存目标角色的状态
  const targetRole = targetSeat.role;
  const targetIsPoisoned = targetSeat.isPoisoned;
  const targetIsDrunk = targetSeat.isDrunk;
  const targetIsDemonSuccessor = targetSeat.isDemonSuccessor;
  const targetIsEvilConverted = targetSeat.isEvilConverted;
  const targetIsGoodConverted = targetSeat.isGoodConverted;
  const targetStatusDetails = targetSeat.statusDetails || [];
  const targetStatuses = targetSeat.statuses || [];

  // 执行角色交换
  return seats.map(s => {
    if (s.id === sourceId) {
      // 源玩家（例如：弄蛇人）变成目标角色（例如：恶魔）
      return {
        ...s,
        role: targetRole,
        isPoisoned: targetIsPoisoned, // 保持目标的中毒状态
        isDrunk: targetIsDrunk, // 保持目标的醉酒状态
        isDemonSuccessor: targetIsDemonSuccessor,
        isEvilConverted: targetIsEvilConverted || (targetRole.type === 'demon' || targetIsDemonSuccessor),
        isGoodConverted: false,
        statusDetails: targetStatusDetails,
        statuses: targetStatuses,
      };
    } else if (s.id === targetId) {
      // 目标玩家（例如：恶魔）变成源角色（例如：弄蛇人），并中毒
      return {
        ...s,
        role: sourceRole,
        isPoisoned: true, // 关键：交换后目标玩家中毒（弄蛇人规则）
        isDrunk: sourceIsDrunk,
        isDemonSuccessor: false, // 不再是恶魔继任者
        isEvilConverted: false,
        isGoodConverted: true, // 变成好人
        statusDetails: [...sourceStatusDetails, '舞蛇人交换中毒（永久）'],
        statuses: sourceStatuses,
      };
    }
    return s;
  });
}

/**
 * 弄蛇人命中恶魔时的专用交换逻辑
 * - snakeCharmerSeatId: 弄蛇人座位 ID
 * - targetDemonSeatId: 被命中的恶魔座位 ID
 *
 * 内部复用通用的 `handleRoleSwap`，以保持状态转移规则一致：
 * - 弄蛇人获得恶魔角色与阵营
 * - 原恶魔变成弄蛇人并永久中毒
 */
export function handleSnakeCharmerSwap(
  seats: Seat[],
  snakeCharmerSeatId: number,
  targetDemonSeatId: number
): Seat[] {
  return handleRoleSwap(seats, snakeCharmerSeatId, targetDemonSeatId);
}

/**
 * 老巫婆变形：将目标玩家变成指定角色
 *
 * @param seats 当前座位状态数组
 * @param targetId 目标玩家座位 ID
 * @param newRoleId 要变成的新角色 ID（来自 `roles` 列表）
 * @returns 更新后的座位状态数组
 */
export function handlePitHagTransformation(
  seats: Seat[],
  targetId: number,
  newRoleId: string
): Seat[] {
  const newRole = roles.find(r => r.id === newRoleId);
  if (!newRole) {
    console.warn?.(`[engine] handlePitHagTransformation: 未找到角色ID=${newRoleId}`);
    return seats;
  }

  return seats.map(s => {
    if (s.id !== targetId) return s;

    // 老巫婆变形只负责角色与恶魔数量相关的标记；
    // 其他诸如中毒/状态明细由上层 UI 负责。
    return {
      ...s,
      role: newRole,
      // 变形会重置恶魔继任者标记，由新角色类型决定是否被视为恶魔
      isDemonSuccessor: false,
    };
  });
}