// 游戏循环测试文件
const { 
  initializeSeats, 
  assignRoles, 
  killPlayer, 
  canUseAbility,
  allPlayersHaveRoles,
  getAlivePlayerCount,
  getDeadPlayerCount
} = require('./app/gameLogic.ts');

describe('游戏核心逻辑测试', () => {
  
  describe('基本流程测试：游戏能正常开始，所有玩家分配到了角色', () => {
    
    test('应该能够初始化5个玩家的座位', () => {
      const seats = initializeSeats(5);
      expect(seats).toHaveLength(5);
      expect(seats[0].id).toBe(0);
      expect(seats[4].id).toBe(4);
      expect(seats.every(s => s.role === null)).toBe(true);
      expect(seats.every(s => s.isDead === false)).toBe(true);
    });

    test('应该能够为所有玩家分配角色', () => {
      const seats = initializeSeats(5);
      const roleIds = ['washerwoman', 'librarian', 'investigator', 'poisoner', 'imp'];
      
      const updatedSeats = assignRoles(seats, roleIds);
      
      // 验证所有玩家都有角色
      expect(allPlayersHaveRoles(updatedSeats)).toBe(true);
      
      // 验证角色分配正确
      expect(updatedSeats[0].role?.id).toBe('washerwoman');
      expect(updatedSeats[1].role?.id).toBe('librarian');
      expect(updatedSeats[2].role?.id).toBe('investigator');
      expect(updatedSeats[3].role?.id).toBe('poisoner');
      expect(updatedSeats[4].role?.id).toBe('imp');
    });

    test('应该能够为15个玩家分配角色', () => {
      const seats = initializeSeats(15);
      const roleIds = [
        'washerwoman', 'librarian', 'investigator', 'chef', 'empath',
        'fortune_teller', 'undertaker', 'monk', 'ravenkeeper', 'virgin',
        'slayer', 'soldier', 'mayor', 'butler', 'imp'
      ];
      
      const updatedSeats = assignRoles(seats, roleIds);
      
      expect(allPlayersHaveRoles(updatedSeats)).toBe(true);
      expect(updatedSeats).toHaveLength(15);
    });

    test('角色数量不匹配应该抛出错误', () => {
      const seats = initializeSeats(5);
      const roleIds = ['washerwoman', 'librarian'];
      
      expect(() => {
        assignRoles(seats, roleIds);
      }).toThrow('座位数量(5)与角色数量(2)不匹配');
    });

    test('无效角色ID应该抛出错误', () => {
      const seats = initializeSeats(2);
      const roleIds = ['invalid_role', 'washerwoman'];
      
      expect(() => {
        assignRoles(seats, roleIds);
      }).toThrow('找不到角色ID: invalid_role');
    });

    test('酒鬼角色应该自动标记为醉酒', () => {
      const seats = initializeSeats(1);
      const roleIds = ['drunk'];
      
      const updatedSeats = assignRoles(seats, roleIds);
      
      expect(updatedSeats[0].role?.id).toBe('drunk');
      expect(updatedSeats[0].isDrunk).toBe(true);
    });
  });

  describe('规则冲突测试：如果一个玩家被"杀死"了，验证他的状态确实变成了"死亡"，且无法再发动技能', () => {
    
    test('应该能够杀死一个玩家', () => {
      const seats = initializeSeats(5);
      const roleIds = ['washerwoman', 'librarian', 'investigator', 'poisoner', 'imp'];
      let updatedSeats = assignRoles(seats, roleIds);
      
      // 杀死0号玩家
      updatedSeats = killPlayer(updatedSeats, 0);
      
      expect(updatedSeats[0].isDead).toBe(true);
      expect(getDeadPlayerCount(updatedSeats)).toBe(1);
      expect(getAlivePlayerCount(updatedSeats)).toBe(4);
    });

    test('死亡的玩家不应该能够发动技能', () => {
      const seats = initializeSeats(5);
      const roleIds = ['washerwoman', 'librarian', 'investigator', 'poisoner', 'imp'];
      let updatedSeats = assignRoles(seats, roleIds);
      
      // 杀死0号玩家（洗衣妇）
      updatedSeats = killPlayer(updatedSeats, 0);
      
      const deadPlayer = updatedSeats[0];
      expect(deadPlayer.isDead).toBe(true);
      expect(canUseAbility(deadPlayer)).toBe(false);
    });

    test('存活的玩家应该能够发动技能', () => {
      const seats = initializeSeats(5);
      const roleIds = ['washerwoman', 'librarian', 'investigator', 'poisoner', 'imp'];
      let updatedSeats = assignRoles(seats, roleIds);
      
      // 杀死0号玩家，但1号玩家存活
      updatedSeats = killPlayer(updatedSeats, 0);
      
      const alivePlayer = updatedSeats[1];
      expect(alivePlayer.isDead).toBe(false);
      expect(canUseAbility(alivePlayer)).toBe(true);
    });

    test('应该能够杀死多个玩家', () => {
      const seats = initializeSeats(5);
      const roleIds = ['washerwoman', 'librarian', 'investigator', 'poisoner', 'imp'];
      let updatedSeats = assignRoles(seats, roleIds);
      
      // 杀死多个玩家
      updatedSeats = killPlayer(updatedSeats, 0);
      updatedSeats = killPlayer(updatedSeats, 1);
      updatedSeats = killPlayer(updatedSeats, 2);
      
      expect(updatedSeats[0].isDead).toBe(true);
      expect(updatedSeats[1].isDead).toBe(true);
      expect(updatedSeats[2].isDead).toBe(true);
      expect(updatedSeats[3].isDead).toBe(false);
      expect(updatedSeats[4].isDead).toBe(false);
      
      expect(getDeadPlayerCount(updatedSeats)).toBe(3);
      expect(getAlivePlayerCount(updatedSeats)).toBe(2);
    });

    test('重复杀死同一个玩家不应该改变状态', () => {
      const seats = initializeSeats(5);
      const roleIds = ['washerwoman', 'librarian', 'investigator', 'poisoner', 'imp'];
      let updatedSeats = assignRoles(seats, roleIds);
      
      // 第一次杀死
      updatedSeats = killPlayer(updatedSeats, 0);
      expect(updatedSeats[0].isDead).toBe(true);
      
      // 第二次杀死（应该保持不变）
      const beforeCount = getDeadPlayerCount(updatedSeats);
      updatedSeats = killPlayer(updatedSeats, 0);
      expect(updatedSeats[0].isDead).toBe(true);
      expect(getDeadPlayerCount(updatedSeats)).toBe(beforeCount);
    });

    test('所有玩家死亡后，存活玩家数量应该为0', () => {
      const seats = initializeSeats(5);
      const roleIds = ['washerwoman', 'librarian', 'investigator', 'poisoner', 'imp'];
      let updatedSeats = assignRoles(seats, roleIds);
      
      // 杀死所有玩家
      for (let i = 0; i < 5; i++) {
        updatedSeats = killPlayer(updatedSeats, i);
      }
      
      expect(getAlivePlayerCount(updatedSeats)).toBe(0);
      expect(getDeadPlayerCount(updatedSeats)).toBe(5);
      expect(updatedSeats.every(s => s.isDead)).toBe(true);
    });

    test('没有角色的玩家不应该能够发动技能', () => {
      const seats = initializeSeats(1);
      // 不分配角色
      
      expect(canUseAbility(seats[0])).toBe(false);
    });

    test('有特殊标记的死亡玩家（hasAbilityEvenDead）应该能够发动技能', () => {
      const seats = initializeSeats(2);
      const roleIds = ['washerwoman', 'poisoner'];
      let updatedSeats = assignRoles(seats, roleIds);
      
      // 杀死0号玩家，但标记为保留能力
      updatedSeats = killPlayer(updatedSeats, 0);
      updatedSeats[0].hasAbilityEvenDead = true;
      
      expect(updatedSeats[0].isDead).toBe(true);
      expect(canUseAbility(updatedSeats[0])).toBe(true);
    });
  });

  describe('综合场景测试', () => {
    
    test('完整游戏流程：初始化 -> 分配角色 -> 杀死玩家 -> 验证状态', () => {
      // 1. 初始化游戏
      const seats = initializeSeats(5);
      expect(seats).toHaveLength(5);
      
      // 2. 分配角色
      const roleIds = ['washerwoman', 'librarian', 'investigator', 'poisoner', 'imp'];
      let updatedSeats = assignRoles(seats, roleIds);
      expect(allPlayersHaveRoles(updatedSeats)).toBe(true);
      
      // 3. 验证初始状态
      expect(getAlivePlayerCount(updatedSeats)).toBe(5);
      expect(getDeadPlayerCount(updatedSeats)).toBe(0);
      
      // 4. 杀死一个玩家
      updatedSeats = killPlayer(updatedSeats, 0);
      expect(updatedSeats[0].isDead).toBe(true);
      expect(canUseAbility(updatedSeats[0])).toBe(false);
      
      // 5. 验证其他玩家仍然存活
      expect(updatedSeats[1].isDead).toBe(false);
      expect(canUseAbility(updatedSeats[1])).toBe(true);
      
      // 6. 验证统计
      expect(getAlivePlayerCount(updatedSeats)).toBe(4);
      expect(getDeadPlayerCount(updatedSeats)).toBe(1);
    });
  });
});

