# 逻辑自查简报：实验性角色规则冲突分析

**生成时间**: 2024年
**检查范围**: `app/engine.ts` - 实验性角色规则破坏机制
**重点**: Heretic (异端) 的代码侵入性分析

---

## 📋 检查清单结果

### ✅ 1. 双子锁 vs 异端 (Evil Twin Lock vs Heretic Flip)

#### 当前代码逻辑顺序：
```
1. 基础统计（存活人数、恶魔数量）
2. 邪恶双子逻辑（双子锁 & 处决胜利）
   - 如果好人双子被处决 → 直接返回 'evil'（跳过异端检查）
   - 如果双子锁生效且没有恶魔 → 返回 null（跳过异端检查）
3. 主谋逻辑
4. Leviathan 逻辑
5. Legion 逻辑
6. Atheist 逻辑
7. 好人胜利判断
   - 如果没有恶魔 → 返回 'good'，但会检查异端反转
8. 邪恶胜利判断
   - 如果存活人数过少 → 返回 'evil'，但会检查异端反转
```

#### ⚠️ 潜在冲突点：

**冲突场景 A：双子锁 + 异端 + 恶魔死亡**
- **情况**：Evil Twin 锁生效（Good cannot win），恶魔死亡，Heretic 在场
- **当前行为**：返回 `null`（游戏继续），异端反转逻辑**不会执行**
- **规则疑问**：
  - 双子锁规则："Good cannot win"（好人无法获胜）
  - 异端规则：反转胜负（Good wins → Evil wins）
  - **问题**：如果恶魔死了，原始结果是"Good wins"，但被双子锁阻止。异端应该将其反转为"Evil wins"，但双子锁是否也应该阻止"Evil wins"？
- **建议**：
  - **选项1（保守）**：保持当前逻辑，双子锁优先，异端反转不执行
  - **选项2（激进）**：在双子锁检查后，如果返回 `null`，检查异端。如果异端在场，将 `null` 转换为 `'evil'`（因为原始"Good wins"被反转）
  - **选项3（规则确认）**：需要确认官方规则：双子锁是否只阻止"Good wins"，还是阻止所有胜利判定？

**冲突场景 B：好人双子被处决 + 异端**
- **情况**：好人双子被处决，Heretic 在场
- **当前行为**：直接返回 `'evil'`（跳过异端检查）
- **规则疑问**：如果异端在场，"Evil wins"应该被反转为"Good wins"吗？
- **建议**：在返回 `'evil'` 之前，检查异端并反转

#### 🔧 修复建议：

```typescript
// 在 calculateGameResult 中，修改双子逻辑部分：

// 2.1 邪恶胜利：如果好人双子被处决
if (executedPlayerId !== null && executedPlayerId === evilTwinPair.goodId && goodTwin.isDead) {
  const result = 'evil';
  
  // 检查异端反转（在返回前）
  const heretic = seats.find(s => 
    s.role?.id === 'heretic' && 
    !s.isDead && 
    !s.appearsDead &&
    !s.isPoisoned &&
    !s.isDrunk
  );
  
  if (heretic) {
    return 'good'; // 反转：Evil wins → Good wins
  }
  
  return result;
}

// 2.3 如果锁生效且场上已没有任何活着的恶魔
if (lockActive && livingDemons.length === 0) {
  // 检查异端：如果异端在场，将 null 转换为 'evil'（因为原始 Good wins 被反转）
  const heretic = seats.find(s => 
    s.role?.id === 'heretic' && 
    !s.isDead && 
    !s.appearsDead &&
    !s.isPoisoned &&
    !s.isDrunk
  );
  
  if (heretic) {
    // 原始结果：Good wins（被双子锁阻止）
    // 异端反转：Good wins → Evil wins
    // 但双子锁是否应该阻止 Evil wins？这里假设不阻止
    return 'evil';
  }
  
  return null; // 游戏继续，好人无法获胜（双子锁住局面）
}
```

---

### ⚠️ 2. 政治家 (Politician) vs 异端

#### 当前状态：
- **未实现**：代码中未找到 Politician 相关逻辑
- **规则**：Politician 是"最邪恶的好人"，如果邪恶阵营获胜，Politician 也算赢

#### 潜在冲突：
- **场景**：异端在场，恶魔死亡 → 原始"Good wins"被反转为"Evil wins"
- **问题**：Politician 是否应该算赢？
- **建议**：
  - 在 UI 层处理 Politician 的胜利判定
  - 在 `calculateGameResult` 中添加注释，说明 Politician 的胜利判定需要特殊处理
  - 考虑返回额外的元数据，标识"名义上的胜利阵营"和"实际胜利阵营"

#### 🔧 建议实现：

```typescript
// 在 calculateGameResult 的返回类型中添加元数据：
export interface GameResultWithMetadata {
  result: 'good' | 'evil' | null;
  nominalResult?: 'good' | 'evil'; // 名义上的结果（用于 Politician 判定）
  isHereticFlipped?: boolean; // 是否被异端反转
}

// 或者添加注释：
/**
 * 注意：如果异端在场，返回的 result 是反转后的结果。
 * Politician 的胜利判定需要检查原始结果（未反转前）。
 * 例如：恶魔死亡 → 原始 Good wins → 异端反转 → Evil wins
 * Politician 应该检查原始结果（Good wins），所以 Politician 算赢。
 */
```

---

### ⚠️ 3. 哈迪寂亚 vs 保护角色 (Al-Hadikhia vs Protection)

#### 当前代码逻辑：

```typescript
// 6.5. 处理 Al-Hadikhia (哈迪寂亚) 的特殊机制
if (actualRole?.id === 'hadesia') {
  // ... 处理选择逻辑 ...
  
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
  
  // 直接返回，跳过保护检查（第7节）
  return { deaths, ... };
}

// 7. 处理每个目标（保护检查在这里）
for (const targetId of targetIds) {
  // A. 僧侣 (Monk) 保护
  // B. 旅店老板 (Innkeeper) 保护
  // C. 士兵 (Soldier) 被动技能
  // D. 茶艺师 (Tea Lady) 被动技能
  // ...
}
```

#### ⚠️ 问题：

1. **保护检查被跳过**：哈迪寂亚的逻辑在第 6.5 节，直接返回结果，跳过了第 7 节的保护检查
2. **规则疑问**：
   - 哈迪寂亚的死亡是"玩家选择的结果"，不是"恶魔攻击"
   - 根据规则，Monk 保护的是"恶魔的能力"，哈迪寂亚的死亡可能不受 Monk 保护
   - 但 Tea Lady 和 Soldier 的被动技能可能仍然有效

#### 🔧 修复建议：

**选项1：在哈迪寂亚逻辑中添加保护检查**

```typescript
// 6.5. 处理 Al-Hadikhia (哈迪寂亚) 的特殊机制
if (actualRole?.id === 'hadesia') {
  // ... 处理选择逻辑 ...
  
  // 确定应该死亡的玩家
  const candidatesToDie: number[] = [];
  if (allChooseLive) {
    candidatesToDie.push(...targetIds);
  } else {
    candidatesToDie.push(...targetIds.filter(id => simulatedChoices[id] === 'die'));
  }
  
  // 对每个候选者检查保护
  for (const targetId of candidatesToDie) {
    const targetSeat = seats.find(s => s.id === targetId);
    if (!targetSeat) continue;
    
    // 检查保护（但注意：哈迪寂亚的死亡可能不受某些保护影响）
    // A. 僧侣保护：可能无效（因为不是"恶魔攻击"）
    // B. 旅店老板保护：可能无效
    // C. 士兵被动技能：可能有效（因为士兵免疫所有恶魔能力）
    // D. 茶艺师被动技能：可能有效
    
    // 士兵检查
    if (targetSeat.role?.id === 'soldier') {
      if (!targetSeat.isPoisoned && !targetSeat.isDrunk) {
        continue; // 士兵免疫
      }
    }
    
    // 茶艺师检查
    if (hasTeaLadyProtection(targetSeat, seats)) {
      continue; // 茶艺师保护
    }
    
    // 其他保护可能无效（需要规则确认）
    
    // 加入死亡列表
    if (!deaths.includes(targetId)) {
      deaths.push(targetId);
    }
  }
  
  return { deaths, ... };
}
```

**选项2：保持当前逻辑，添加注释说明**

```typescript
// 6.5. 处理 Al-Hadikhia (哈迪寂亚) 的特殊机制
// 注意：哈迪寂亚的死亡是"玩家选择的结果"，不是"恶魔攻击"
// 根据规则，Monk 和 Innkeeper 的保护可能无效（因为它们保护的是"恶魔的能力"）
// 但 Soldier 和 Tea Lady 的被动技能可能仍然有效
// 当前实现：跳过所有保护检查，直接应用死亡
// TODO: 需要规则确认，是否需要检查 Soldier 和 Tea Lady 的保护
```

---

## 📊 总结

### 🔴 高风险冲突点：

1. **双子锁 + 异端**：逻辑顺序可能导致异端反转被跳过
   - **影响**：游戏结果可能不正确
   - **优先级**：高
   - **建议**：修改代码，确保异端反转在所有返回点之前检查

2. **哈迪寂亚 + 保护角色**：保护检查被跳过
   - **影响**：保护机制可能失效
   - **优先级**：中
   - **建议**：在哈迪寂亚逻辑中添加保护检查，或添加注释说明规则

### 🟡 中等风险冲突点：

3. **政治家 + 异端**：未实现，但需要提前规划
   - **影响**：未来实现时可能产生冲突
   - **优先级**：低（当前未实现）
   - **建议**：添加注释和元数据支持

### ✅ 无冲突点：

4. **Legion + 异端**：逻辑正确，Legion 检查在异端反转之前
5. **Leviathan + 异端**：逻辑正确，Leviathan 检查在异端反转之前
6. **Atheist + 异端**：逻辑正确，Atheist 检查在异端反转之前

---

## 🔧 推荐修复优先级

1. **立即修复**：双子锁 + 异端的冲突（修改 `calculateGameResult`）
2. **规则确认后修复**：哈迪寂亚 + 保护角色的冲突
3. **未来规划**：政治家 + 异端的元数据支持

---

## 📝 规则确认需求

1. **双子锁规则**：双子锁是否只阻止"Good wins"，还是阻止所有胜利判定？
2. **哈迪寂亚保护规则**：Monk/Innkeeper/Tea Lady/Soldier 的保护是否对哈迪寂亚的死亡有效？
3. **异端反转规则**：异端反转是否在所有情况下都适用，包括双子锁和处决胜利？

