import { Seat, roles, Role, scripts, getRolesByScript, getRoleById } from "./data";

/**
 * 根据剧本或自定义列表解析角色池
 * @param scriptId 标准剧本 ID 或 'custom'
 * @param customRoleList 自定义角色列表（Role 对象或角色 ID）
 */
export function setupGame(
  scriptId: string,
  customRoleList?: Array<Role | string>
): Role[] {
  if (scriptId === "custom") {
    const resolved = (customRoleList || [])
      .map(item => {
        if (typeof item === "string") return getRoleById(item);
        return item;
      })
      .filter((r): r is Role => Boolean(r));
    // 去重，保持先选先留
    const map = new Map<string, Role>();
    resolved.forEach(r => {
      if (!map.has(r.id)) map.set(r.id, r);
    });
    return Array.from(map.values());
  }

  // 标准剧本，走原有逻辑
  const scriptExists = scripts.some(s => s.id === scriptId);
  if (!scriptExists) return [];
  const fromScript = getRolesByScript(scriptId);
  // 兜底：确保引用 MASTER_ROLES 中的定义
  return fromScript.map(r => getRoleById(r.id) || r);
}

/**
 * 辅助函数：获取目标的存活邻居（圆桌邻居）
 */
function getAliveNeighbors(allSeats: Seat[], targetId: number): Seat[] {
  const originIndex = allSeats.findIndex((s) => s.id === targetId);
  if (originIndex === -1 || allSeats.length <= 1) return [];
  const total = allSeats.length;
  const neighbors: Seat[] = [];

  for (let step = 1; step < total && neighbors.length < 2; step++) {
    const left = allSeats[(originIndex - step + total) % total];
    if (!left.isDead && !left.appearsDead && left.id !== targetId) {
      neighbors.push(left);
    }
    if (neighbors.length >= 2) break;

    const right = allSeats[(originIndex + step) % total];
    if (!right.isDead && !right.appearsDead && right.id !== targetId && !neighbors.some(n => n.id === right.id)) {
      neighbors.push(right);
    }
  }

  return neighbors;
}

/**
 * 辅助函数：判断玩家是否属于好人阵营
 */
function isGoodAlignment(seat: Seat): boolean {
  if (!seat.role) return false;
  const roleType = seat.role.type;
  if (seat.isEvilConverted) return false;
  if (seat.isGoodConverted) return true;
  return roleType !== 'demon' && roleType !== 'minion' && !seat.isDemonSuccessor;
}

/**
 * 辅助函数：检查 Tea Lady 保护
 * 规则：
 * 1. 如果目标是茶女，且茶女的两个邻居都是好人，茶女不死
 * 2. 如果目标是茶女的邻居（好人），且茶女的另一个邻居也是好人，目标不死
 */
function hasTeaLadyProtection(targetSeat: Seat, allSeats: Seat[]): boolean {
  if (!targetSeat || !targetSeat.role) return false;
  
  // 只有好人阵营的玩家才能被茶女保护
  if (!isGoodAlignment(targetSeat)) return false;
  
  // 情况1：目标是茶女本身
  if (targetSeat.role.id === 'tea_lady') {
    const neighbors = getAliveNeighbors(allSeats, targetSeat.id);
    if (neighbors.length < 2) return false;
    // 茶女的两个邻居都必须是好人阵营
    return neighbors.every(n => isGoodAlignment(n));
  }
  
  // 情况2：目标是茶女的邻居
  const neighbors = getAliveNeighbors(allSeats, targetSeat.id);
  return neighbors.some((neighbor) => {
    if (!neighbor.role) return false;
    // 检查邻居是否是茶女
    if (neighbor.role.id !== 'tea_lady') return false;
    
    // 检查茶女是否是好人阵营
    if (!isGoodAlignment(neighbor)) return false;
    
    // 检查茶女的两个邻居是否都是好人阵营
    const teaLadyNeighbors = getAliveNeighbors(allSeats, neighbor.id);
    if (teaLadyNeighbors.length < 2) return false;
    
    // 两个邻居都必须是好人阵营
    return teaLadyNeighbors.every(n => isGoodAlignment(n));
  });
}

/**
 * Shabaloth 吞噬记录类型
 */
export interface ShabalothSwallowedRecord {
  playerId: number;
  nightSwallowed: number; // 被吞噬的夜晚编号
}

/**
 * 夜晚死亡计算结果
 */
export interface NightDeathsResult {
  deaths: number[]; // 死亡玩家 ID 列表
  shabalothSwallowed?: number[]; // Shabaloth 本次吞噬的玩家 ID（用于记录）
  shabalothRegurgitated?: number[]; // Shabaloth 本次反刍复活的玩家 ID
  pukkaPreviousTarget?: number | null; // Pukka 上一晚的目标 ID（用于延迟毒杀）
  hadesiaChoices?: Record<number, 'live' | 'die'>; // Al-Hadikhia 选择的目标及其选择结果（用于模拟）
}

/**
 * 核心逻辑引擎：计算夜晚死亡结果
 * 这是一个纯函数，不依赖 React 状态，方便测试和复用。
 * @param seats 当前座位状态
 * @param demonAction 恶魔的行动（谁杀了谁，对于 Po 可以是多个目标，对于 Shabaloth 是两个目标）
 * @param protectiveActions 保护类角色的行动（谁保护了谁）
 * @param options 可选参数
 * @param options.pukkaPreviousTarget Pukka 上一晚的目标 ID（用于延迟毒杀）
 * @param options.shabalothSwallowedHistory Shabaloth 之前吞噬的玩家记录（用于反刍）
 * @param options.poChargeState Po 的蓄力状态（seatId -> isCharged）
 * @param options.currentNight 当前夜晚编号（用于 Shabaloth 反刍判断）
 * @param options.hadesiaChoices Al-Hadikhia 选择的目标及其选择结果（用于模拟死亡选择）
 * @returns 夜晚死亡计算结果
 */
export function calculateNightDeaths(
  seats: Seat[],
  demonAction: { sourceId: number; targetId: number | number[] } | null,
  protectiveActions: { sourceId: number; targetId: number; roleId: string }[] = [],
  options: {
    pukkaPreviousTarget?: number | null;
    shabalothSwallowedHistory?: ShabalothSwallowedRecord[];
    poChargeState?: Record<number, boolean>;
    currentNight?: number;
    hadesiaChoices?: Record<number, 'live' | 'die'>;
  } = {}
): NightDeathsResult {
  // 日志：检测恶魔是否正在攻击士兵
  if (demonAction) {
    const targetIds = Array.isArray(demonAction.targetId) ? demonAction.targetId : [demonAction.targetId];
    targetIds.forEach(targetId => {
      const t = seats.find(s => s.id === targetId);
      if (t?.role?.id === 'soldier') {
        console.log(`👀 引擎检测：恶魔正在攻击士兵！(SoldierID: ${t.id})`);
      }
    });
  }

  const deaths: number[] = [];
  let shabalothSwallowed: number[] = [];
  let shabalothRegurgitated: number[] = [];
  let pukkaPreviousTarget: number | null = null;

  // 1. 如果没有恶魔行动，需要处理 Pukka 延迟毒杀和 Shabaloth 反刍
  if (!demonAction) {
    // 处理 Pukka 延迟毒杀：上一晚的目标在本晚死亡
    if (options.pukkaPreviousTarget !== undefined && options.pukkaPreviousTarget !== null) {
      const previousTarget = seats.find(s => s.id === options.pukkaPreviousTarget!);
      // 如果上一晚的目标仍然存活（且未在其他地方死亡），在本晚死亡
      if (previousTarget && !previousTarget.isDead && !previousTarget.appearsDead) {
        deaths.push(options.pukkaPreviousTarget);
      }
    }
    
    // 处理 Shabaloth 反刍（随机复活之前吞噬的玩家）
    if (options.shabalothSwallowedHistory && options.shabalothSwallowedHistory.length > 0) {
      const shabaloth = seats.find(s => s.role?.id === 'shabaloth' && !s.isDead && !s.appearsDead);
      if (shabaloth && !shabaloth.isPoisoned && !shabaloth.isDrunk) {
        // 找出当前死亡的、之前被 Shabaloth 吞噬的玩家
        const candidatesToRegurgitate = options.shabalothSwallowedHistory
          .filter(record => {
            const seat = seats.find(s => s.id === record.playerId);
            return seat && seat.isDead && !seat.appearsDead;
          })
          .map(record => record.playerId);
        
        // 随机反刍（极低概率，或说书人决定）
        // 这里使用简单的随机逻辑：每个候选者有 10% 的概率被反刍
        candidatesToRegurgitate.forEach(playerId => {
          if (Math.random() < 0.1) { // 10% 概率反刍
            shabalothRegurgitated.push(playerId);
          }
        });
      }
    }
    
    return {
      deaths,
      shabalothSwallowed,
      shabalothRegurgitated: shabalothRegurgitated.length > 0 ? shabalothRegurgitated : undefined,
      pukkaPreviousTarget: options.pukkaPreviousTarget ?? undefined
    };
  }

  const demonSeat = seats.find(s => s.id === demonAction.sourceId);
  if (!demonSeat) {
    return {
      deaths,
      shabalothSwallowed,
      shabalothRegurgitated: shabalothRegurgitated.length > 0 ? shabalothRegurgitated : undefined,
      pukkaPreviousTarget: options.pukkaPreviousTarget ?? undefined
    };
  }

  // 处理多目标情况（Shabaloth 和蓄力后的 Po）
  const targetIds = Array.isArray(demonAction.targetId) 
    ? demonAction.targetId 
    : [demonAction.targetId];

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
    // 但仍然需要处理 Pukka 延迟毒杀和 Shabaloth 反刍
    if (options.pukkaPreviousTarget !== undefined && options.pukkaPreviousTarget !== null) {
      const previousTarget = seats.find(s => s.id === options.pukkaPreviousTarget!);
      if (previousTarget && !previousTarget.isDead && !previousTarget.appearsDead) {
        deaths.push(options.pukkaPreviousTarget);
        pukkaPreviousTarget = null; // Pukka 中毒已结算
      }
    }
    return {
      deaths,
      shabalothSwallowed,
      shabalothRegurgitated: shabalothRegurgitated.length > 0 ? shabalothRegurgitated : undefined,
      pukkaPreviousTarget
    };
  }

  // 3. 处理 Pukka 延迟毒杀：上一晚的目标在本晚死亡
  if (actualRole?.id === 'pukka' && options.pukkaPreviousTarget !== undefined && options.pukkaPreviousTarget !== null) {
    const previousTarget = seats.find(s => s.id === options.pukkaPreviousTarget!);
    if (previousTarget && !previousTarget.isDead && !previousTarget.appearsDead) {
      deaths.push(options.pukkaPreviousTarget);
      pukkaPreviousTarget = null; // 已结算，清空
    }
    // 记录本晚的新目标（将在下晚死亡）
    if (targetIds.length > 0) {
      pukkaPreviousTarget = targetIds[0];
    }
  }

  // 4. 处理 Shabaloth 反刍（在计算新死亡之前）
  if (actualRole?.id === 'shabaloth' && options.shabalothSwallowedHistory && options.shabalothSwallowedHistory.length > 0) {
    if (!demonSeat.isPoisoned && !demonSeat.isDrunk) {
      const candidatesToRegurgitate = options.shabalothSwallowedHistory
        .filter(record => {
          const seat = seats.find(s => s.id === record.playerId);
          return seat && seat.isDead && !seat.appearsDead;
        })
        .map(record => record.playerId);
      
      // 随机反刍（极低概率，或说书人决定）
      // 这里使用简单的随机逻辑：每个候选者有 10% 的概率被反刍
      candidatesToRegurgitate.forEach(playerId => {
        if (Math.random() < 0.1) { // 10% 概率反刍
          shabalothRegurgitated.push(playerId);
        }
      });
    }
  }

  // 5. 检查 Po 蓄力状态：如果蓄力，必须选择3个目标
  if (actualRole?.id === 'po') {
    const isCharged = options.poChargeState?.[demonSeat.id] === true;
    if (isCharged) {
      // 蓄力状态：必须选择3个目标
      if (targetIds.length !== 3) {
        // 目标数量不正确，返回错误（实际应该由上层验证）
        return {
          deaths,
          shabalothSwallowed,
          shabalothRegurgitated: shabalothRegurgitated.length > 0 ? shabalothRegurgitated : undefined,
          pukkaPreviousTarget
        };
      }
    } else {
      // 未蓄力：只能选择0或1个目标（0个目标会蓄力，由上层处理）
      if (targetIds.length > 1) {
        return {
          deaths,
          shabalothSwallowed,
          shabalothRegurgitated: shabalothRegurgitated.length > 0 ? shabalothRegurgitated : undefined,
          pukkaPreviousTarget
        };
      }
    }
  }

  // 6. 检查 Shabaloth：必须选择2个目标
  if (actualRole?.id === 'shabaloth') {
    if (targetIds.length !== 2) {
      // 目标数量不正确
      return {
        deaths,
        shabalothSwallowed,
        shabalothRegurgitated: shabalothRegurgitated.length > 0 ? shabalothRegurgitated : undefined,
        pukkaPreviousTarget
      };
    }
  }

  // 6.5. 处理 Al-Hadikhia (哈迪寂亚) 的特殊机制
  // 机制：选择3名玩家，这些玩家必须（在现实中）选择"生"或"死"
  // 如果没有足够的人选择"死"，则所有人都死
  if (actualRole?.id === 'hadesia') {
    if (targetIds.length !== 3) {
      // 目标数量不正确（必须是3个）
      return {
        deaths,
        shabalothSwallowed,
        shabalothRegurgitated: shabalothRegurgitated.length > 0 ? shabalothRegurgitated : undefined,
        pukkaPreviousTarget
      };
    }

    // 如果提供了选择结果，使用提供的选择；否则使用模拟策略
    const choices = options.hadesiaChoices || {};
    
    // 模拟策略：如果目标是好人，倾向于选择"死"来救人（30%概率）
    // 如果目标是邪恶，倾向于选择"生"（70%概率）
    const simulatedChoices: Record<number, 'live' | 'die'> = {};
    let allChooseLive = true;
    
    for (const targetId of targetIds) {
      const targetSeat = seats.find(s => s.id === targetId);
      if (!targetSeat) continue;
      
      // 如果已经有选择，使用已有选择
      if (choices[targetId]) {
        simulatedChoices[targetId] = choices[targetId];
        if (choices[targetId] === 'die') {
          allChooseLive = false;
        }
      } else {
        // 模拟选择：好人更倾向于选择"死"来救人，邪恶更倾向于选择"生"
        const isGood = isGoodAlignment(targetSeat);
        const chooseDie = isGood ? Math.random() < 0.3 : Math.random() < 0.3;
        simulatedChoices[targetId] = chooseDie ? 'die' : 'live';
        if (chooseDie) {
          allChooseLive = false;
        }
      }
    }
    
    // 如果所有人都选择"生"，则所有人死亡
    if (allChooseLive) {
      targetIds.forEach(targetId => {
        if (!deaths.includes(targetId)) {
          deaths.push(targetId);
        }
      });
    } else {
      // 否则，只有选择"死"的玩家死亡
      targetIds.forEach(targetId => {
        if (simulatedChoices[targetId] === 'die' && !deaths.includes(targetId)) {
          deaths.push(targetId);
        }
      });
    }
    
    // 返回选择结果（用于日志记录）
    return {
      deaths,
      shabalothSwallowed,
      shabalothRegurgitated: shabalothRegurgitated.length > 0 ? shabalothRegurgitated : undefined,
      pukkaPreviousTarget,
      hadesiaChoices: simulatedChoices
    };
  }

  // 7. 处理每个目标
  for (const targetId of targetIds) {
    const targetSeat = seats.find(s => s.id === targetId);
    if (!targetSeat) continue;

    // 检查目标防御状态（防御优先级计算）

    // A. 僧侣 (Monk) 保护
    const monkProtection = protectiveActions.find(
      p => p.targetId === targetSeat.id && p.roleId === 'monk'
    );
    if (monkProtection) {
      const monkSeat = seats.find(s => s.id === monkProtection.sourceId);
      if (monkSeat && !monkSeat.isPoisoned && !monkSeat.isDrunk) {
        continue; // 攻击被僧侣阻挡，跳过此目标
      }
    }

    // B. 旅店老板 (Innkeeper) 保护
    const innkeeperProtection = protectiveActions.find(
      p => p.targetId === targetSeat.id && p.roleId === 'innkeeper'
    );
    if (innkeeperProtection) {
      const innkeeperSeat = seats.find(s => s.id === innkeeperProtection.sourceId);
      if (innkeeperSeat && !innkeeperSeat.isPoisoned && !innkeeperSeat.isDrunk) {
        continue; // 攻击被旅店老板阻挡，跳过此目标
      }
    }

    // C. 士兵 (Soldier) 被动技能
    if (targetSeat.role?.id === 'soldier') {
      if (!targetSeat.isPoisoned && !targetSeat.isDrunk) {
        continue; // 攻击被士兵自身防御阻挡，跳过此目标
      }
    }

    // D. 茶艺师 (Tea Lady) 被动技能
    // 条件：目标有茶女邻居，且茶女的两个邻居都是好人阵营
    if (hasTeaLadyProtection(targetSeat, seats)) {
      continue; // 攻击被茶女保护阻挡，跳过此目标
    }

    // E. 水手 (Sailor) 被动技能
    // 条件：如果目标角色是水手且未醉酒，绝对不死
    if (targetSeat.role?.id === 'sailor') {
      if (!targetSeat.isDrunk && !targetSeat.isPoisoned) {
        continue; // 水手清醒时绝对不死，跳过此目标
      }
      // 如果水手醉酒或中毒，可能死亡（正常流程）
    }

    // F. 弄臣 (Fool) 被动技能
    // 条件：弄臣第一次死亡免疫（如果尚未使用过免疫能力）
    if (targetSeat.role?.id === 'fool') {
      if (!targetSeat.hasUsedFoolAbility) {
        continue; // 弄臣第一次死亡免疫，跳过此目标
        // 注意：实际使用免疫时，上层应该设置 hasUsedFoolAbility = true
      }
    }

    // 8. 确认死亡 / 特殊逻辑（使用actualRole判断）
    if (actualRole?.id === 'fang_gu' && targetSeat.role?.type === 'outsider') {
      // 方古袭击外来者：目标不死，而是被转化为恶魔；原方古死亡
      if (!deaths.includes(demonSeat.id)) {
        deaths.push(demonSeat.id);
      }
    } else if (actualRole?.id === 'pukka') {
      // Pukka：目标中毒，不立即死亡（由下晚的延迟毒杀处理）
      // 这里不加入死亡列表，只是记录目标（已在上面处理）
      if (!pukkaPreviousTarget && targetIds.length > 0) {
        pukkaPreviousTarget = targetId;
      }
    } else {
      // 默认情况：目标死亡
      if (!deaths.includes(targetSeat.id)) {
        deaths.push(targetSeat.id);
      }
      
      // Shabaloth：记录被吞噬的玩家
      if (actualRole?.id === 'shabaloth') {
        shabalothSwallowed.push(targetSeat.id);
      }
    }
  }

  // ========== 9. 特殊连带死亡逻辑 ==========

  // 9.1 外婆牵挂 (Grandmother's Bond)
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
      !s.appearsDead &&
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

  return {
    deaths,
    shabalothSwallowed: shabalothSwallowed.length > 0 ? shabalothSwallowed : undefined,
    shabalothRegurgitated: shabalothRegurgitated.length > 0 ? shabalothRegurgitated : undefined,
    pukkaPreviousTarget: pukkaPreviousTarget ?? options.pukkaPreviousTarget ?? undefined
  };
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
  // 注意：假死状态（appearsDead）不计入存活人数
  const aliveCount = seats.filter(s => {
    if (!s.role) return false;
    if (s.appearsDead === true) return true; // 假死状态视为存活
    if (s.role?.id === 'zombuul' && s.isFirstDeathForZombuul && !s.isZombuulTrulyDead) return true;
    return !s.isDead;
  }).length;
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
 * @param options 可选参数
 * @param options.currentRound 当前回合数（天数），用于 Leviathan 判断
 * @returns 'good' (好人胜) | 'evil' (坏人胜) | null (游戏继续)
 */
export function calculateGameResult(
  seats: Seat[],
  evilTwinPair: { evilId: number; goodId: number } | null = null,
  executedPlayerId: number | null = null,
  options: {
    currentRound?: number;
  } = {}
): 'good' | 'evil' | null {
  // ========== 1. 基础统计 ==========
  // 计算存活人数：僵怖假死状态（appearsDead=true 或 isFirstDeathForZombuul=true）不算真正死亡
  const aliveCount = seats.filter(s => {
    if (!s.role) return false;
    // 僵怖假死状态：appearsDead=true 或 (isFirstDeathForZombuul=true 且 !isZombuulTrulyDead)
    if (s.appearsDead === true) return true;
    if (s.role?.id === 'zombuul' && s.isFirstDeathForZombuul && !s.isZombuulTrulyDead) return true;
    return !s.isDead;
  }).length;
  
  // 计算活着的恶魔：僵怖假死状态仍视为存活
  const livingDemons = seats.filter(s => {
    const isDemon = s.role?.type === 'demon' || s.isDemonSuccessor;
    if (!isDemon) return false;
    // 僵怖假死状态仍视为存活
    if (s.appearsDead === true) return true;
    if (s.role?.id === 'zombuul' && s.isFirstDeathForZombuul && !s.isZombuulTrulyDead) return true;
    return !s.isDead;
  });
  
  const deadDemon = seats.find(s => {
    const isDemon = s.role?.type === 'demon' || s.isDemonSuccessor;
    if (!isDemon) return false;
    // 僵怖假死状态不算真正死亡
    if (s.appearsDead === true) return false;
    if (s.role?.id === 'zombuul' && s.isFirstDeathForZombuul && !s.isZombuulTrulyDead) return false;
    return s.isDead;
  });

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

  // ========== 3. 主谋 (Mastermind) 的绝唱 ==========
  // 如果恶魔被处决死亡，但场上有活着的主谋，游戏继续
  // 注意：只有当被处决的玩家是恶魔时，才检查主谋逻辑
  if (deadDemon && executedPlayerId !== null) {
    // 检查被处决的玩家是否是恶魔
    const executedSeat = seats.find(s => s.id === executedPlayerId);
    const executedIsDemon = executedSeat && 
      ((executedSeat.role?.type === 'demon' || executedSeat.isDemonSuccessor) &&
       executedSeat.isDead);
    
    // 只有当被处决的是恶魔时，才检查主谋逻辑
    if (executedIsDemon) {
      const mastermind = seats.find(s => 
        s.role?.id === 'mastermind' && 
        !s.isDead && 
        !s.appearsDead
      );
      if (mastermind) {
        // 主谋在场，恶魔被处决后游戏继续，返回 null
        return null;
      }
    }
  }

  // ========== 4. Leviathan (利维坦) - 时间吞噬者 ==========
  // 机制：第 5 天结束时，如果利维坦还活着，邪恶直接胜利
  const leviathan = seats.find(s => 
    s.role?.id === 'leviathan' && 
    !s.isDead && 
    !s.appearsDead &&
    !s.isPoisoned &&
    !s.isDrunk
  );
  if (leviathan && options.currentRound !== undefined && options.currentRound >= 5) {
    return 'evil'; // 第5天结束时，利维坦存活，邪恶直接胜利
  }

  // ========== 5. Legion (军团) - 多恶魔判定 ==========
  // 机制：场上有多个 Legion（视为恶魔）
  // 只有当**所有** Legion 都死亡时，好人才算胜利（除非有异端）
  const livingLegions = seats.filter(s => {
    const isLegion = s.role?.id === 'legion';
    if (!isLegion) return false;
    // 僵怖假死状态仍视为存活
    if (s.appearsDead === true) return true;
    if (s.role?.id === 'zombuul' && s.isFirstDeathForZombuul && !s.isZombuulTrulyDead) return true;
    return !s.isDead;
  });
  
  // 如果场上有活着的 Legion，只要还有一个 Legion 活着，游戏继续
  // 注意：Legion 被视为恶魔，所以会被包含在 livingDemons 的判断中
  // 但我们需要单独处理 Legion，因为 Legion 的胜利条件不同

  // ========== 6. Atheist (无神论者) - 无神论 ==========
  // 机制：说书人可以破坏规则。如果没有恶魔，游戏继续。
  // 如果 setup.demon 为空，但有 Atheist，允许游戏开始且不判定"好人赢"（需配合 UI 手动结算）
  const atheist = seats.find(s => s.role?.id === 'atheist');
  if (atheist && livingDemons.length === 0 && livingLegions.length === 0) {
    // 无神论者在场且没有恶魔，游戏可以继续（不自动判定好人胜利）
    // 返回 null 表示游戏继续，由说书人手动结算
    return null;
  }

  // ========== 7. 好人胜利：场上没有任何活着的恶魔（包括被 Pit Hag 变走的情况） ==========
  // 注意：Legion 的特殊情况需要单独处理
  // 如果场上有活着的 Legion，游戏继续（因为 Legion 被视为恶魔）
  if (livingLegions.length > 0) {
    // 只要还有一个 Legion 活着，游戏继续
    return null;
  }
  
  // 检查是否有其他恶魔（非 Legion）
  const nonLegionDemons = livingDemons.filter(s => s.role?.id !== 'legion');
  
  if (nonLegionDemons.length === 0) {
    const result = 'good';
    
    // ========== 8. Heretic (异端) - 胜负反转 ==========
    // 机制：如果异端在场（且未中毒），胜负规则完全颠倒
    const heretic = seats.find(s => 
      s.role?.id === 'heretic' && 
      !s.isDead && 
      !s.appearsDead &&
      !s.isPoisoned &&
      !s.isDrunk
    );
    
    if (heretic) {
      // 异端在场，反转结果
      return 'evil'; // result 是 'good'，反转后是 'evil'
    }
    
    return result;
  }

  // ========== 9. 邪恶胜利：存活人数过少 ==========
  if (aliveCount <= 2) {
    const result = 'evil';
    
    // 检查异端反转
    const heretic = seats.find(s => 
      s.role?.id === 'heretic' && 
      !s.isDead && 
      !s.appearsDead &&
      !s.isPoisoned &&
      !s.isDrunk
    );
    
    if (heretic) {
      // 异端在场，反转结果
      return 'good'; // result 是 'evil'，反转后是 'good'
    }
    
    return result;
  }

  // ========== 10. 其他情况：游戏继续 ==========
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
  executedPlayerId: number | null = null,
  options: {
    currentRound?: number;
  } = {}
): GameOverResult | null {
  const result = calculateGameResult(seats, evilTwinPair, executedPlayerId, options);
  
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