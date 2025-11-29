// app/utils.ts
import { Seat, Role, GamePhase, roles } from "./data";

export function getSeatPosition(index: number) {
  const angle = (index / 15) * 2 * Math.PI - Math.PI / 2;
  const radius = 40;
  const x = 50 + radius * Math.cos(angle);
  const y = 50 + radius * Math.sin(angle);
  return { x: x.toFixed(2), y: y.toFixed(2) };
}

export function calculateNightInfo(seats: Seat[], currentSeatId: number, gamePhase: GamePhase) {
    const targetSeat = seats.find(s => s.id === currentSeatId);
    if (!targetSeat || !targetSeat.role) return null;

    const effectiveRole = targetSeat.role.id === "drunk" ? targetSeat.charadeRole : targetSeat.role;
    if (!effectiveRole) return null;

    const isPoisoned = targetSeat.isPoisoned || targetSeat.isDrunk || targetSeat.role.id === "drunk";
    const reason = targetSeat.isPoisoned ? "中毒" : "酒鬼";
    let real = "", fake = "";

    const typeLabels: Record<string, string> = { townsfolk: "镇民", outsider: "外来者", minion: "爪牙", demon: "恶魔" };

    if (effectiveRole.id === 'imp') {
        real = gamePhase==='firstNight' ? "展示爪牙" : "选择玩家杀害";
        fake = "展示伪造爪牙/选择玩家(无效)";
    } else if (effectiveRole.id === 'poisoner') {
        real = "选择玩家下毒"; fake = "选择玩家(无效)";
    } else if (effectiveRole.id === 'fortune_teller') {
        real = "查验2名玩家"; fake = "随意查验";
    } else if (effectiveRole.id === 'spy') {
        real = "查看魔典"; fake = "查看魔典";
    } else if (['washerwoman','librarian','investigator'].includes(effectiveRole.id) && gamePhase==='firstNight') {
        let type = effectiveRole.id==='washerwoman'?"townsfolk":effectiveRole.id==='librarian'?"outsider":"minion";
        const pool = seats.filter(s => s.role?.type === type && s.id !== targetSeat.id);
        if(pool.length > 0) {
            const t = pool[Math.floor(Math.random()*pool.length)];
            const d = seats.find(s => s.id !== t.id && s.id !== targetSeat.id);
            real = `展示【${t.role?.name}】，指向 [${t.id+1}号] 和 [${d?.id+1}号]`;
            fake = "展示错误信息";
        } else { real="无角色显示0"; fake="显示1"; }
    } else {
        real = gamePhase==='firstNight' ? effectiveRole.firstNightReminder||"" : effectiveRole.otherNightReminder||"";
        fake = "提供无效信息";
    }

    if(!real) real = "无行动";
    return { seat: targetSeat, effectiveRole, isPoisoned, reason, real, fake };
}