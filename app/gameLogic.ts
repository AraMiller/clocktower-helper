// 核心游戏逻辑函数 - 用于测试
import { Seat, Role, roles } from './data';

/**
 * 初始化游戏座位
 * @param playerCount 玩家数量
 * @returns 初始化的座位数组
 */
export function initializeSeats(playerCount: number): Seat[] {
  const seats: Seat[] = [];
  for (let i = 0; i < playerCount; i++) {
    seats.push({
      id: i,
      role: null,
      charadeRole: null,
      isDead: false,
      hasGhostVote: true,
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
      zombuulLives: 1,
    });
  }
  return seats;
}

/**
 * 分配角色给玩家
 * @param seats 座位数组
 * @param roleIds 角色ID数组
 * @returns 更新后的座位数组
 */
export function assignRoles(seats: Seat[], roleIds: string[]): Seat[] {
  if (seats.length !== roleIds.length) {
    throw new Error(`座位数量(${seats.length})与角色数量(${roleIds.length})不匹配`);
  }

  return seats.map((seat, index) => {
    const roleId = roleIds[index];
    const role = roles.find(r => r.id === roleId);
    
    if (!role) {
      throw new Error(`找不到角色ID: ${roleId}`);
    }

    return {
      ...seat,
      role: role,
      isDrunk: role.id === 'drunk',
    };
  });
}

/**
 * 杀死玩家
 * @param seats 座位数组
 * @param targetId 目标玩家ID
 * @param options 可选参数
 * @param options.isNightPhase 是否为夜晚阶段（用于检查士兵免疫）
 * @param options.checkProtection 是否检查保护状态（默认true）
 * @returns 更新后的座位数组，如果被保护则返回原数组
 */
export function killPlayer(
  seats: Seat[], 
  targetId: number,
  options?: { isNightPhase?: boolean; checkProtection?: boolean }
): Seat[] {
  const targetSeat = seats.find(s => s.id === targetId);
  if (!targetSeat) {
    throw new Error(`找不到ID为 ${targetId} 的玩家`);
  }

  if (targetSeat.isDead) {
    // 玩家已经死亡，返回原数组
    return seats;
  }

  const checkProtection = options?.checkProtection !== false;
  const isNightPhase = options?.isNightPhase ?? false;

  // 1. 检查通用保护状态（僧侣等）
  if (checkProtection && targetSeat.isProtected && targetSeat.protectedBy !== null) {
    const protector = seats.find(s => s.id === targetSeat.protectedBy);
    if (protector) {
      // 如果保护者中毒/醉酒，保护无效
      const isProtectorPoisoned = protector.isPoisoned || protector.isDrunk || protector.role?.id === "drunk";
      if (!isProtectorPoisoned) {
        // 保护有效，不杀死目标
        return seats;
      }
    }
  }

  // 2. 检查角色自身免疫（士兵在夜晚免疫恶魔攻击）
  if (isNightPhase && targetSeat.role?.id === 'soldier') {
    // 士兵在夜晚免疫恶魔攻击
    return seats;
  }

  // 3. 执行死亡逻辑
  return seats.map(seat => {
    if (seat.id === targetId) {
      return {
        ...seat,
        isDead: true,
      };
    }
    return seat;
  });
}

/**
 * 检查玩家是否可以发动技能
 * @param seat 玩家座位
 * @returns 是否可以发动技能
 */
export function canUseAbility(seat: Seat): boolean {
  // 死亡玩家通常不能发动技能（除非特殊标记）
  if (seat.isDead && !seat.hasAbilityEvenDead && !(seat.isFirstDeathForZombuul === true)) {
    return false;
  }

  // 必须有角色才能发动技能
  if (!seat.role) {
    return false;
  }

  return true;
}

/**
 * 检查所有玩家是否都分配了角色
 * @param seats 座位数组
 * @returns 是否所有玩家都有角色
 */
export function allPlayersHaveRoles(seats: Seat[]): boolean {
  return seats.every(seat => seat.role !== null);
}

/**
 * 获取存活的玩家数量
 * @param seats 座位数组
 * @returns 存活玩家数量
 */
export function getAlivePlayerCount(seats: Seat[]): number {
  return seats.filter(seat => !seat.isDead).length;
}

/**
 * 获取死亡玩家数量
 * @param seats 座位数组
 * @returns 死亡玩家数量
 */
export function getDeadPlayerCount(seats: Seat[]): number {
  return seats.filter(seat => seat.isDead).length;
}

