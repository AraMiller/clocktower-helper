import { useRef, useCallback } from 'react';

interface UseGameInteractionOptions {
  /**
   * 短按/左键点击的回调
   */
  onShortPress?: (seatId: number) => void;
  
  /**
   * 长按/右键点击的回调（打开操作菜单）
   */
  onLongPress?: (seatId: number, event?: React.MouseEvent | React.TouchEvent) => void;
  
  /**
   * 长按持续时间（毫秒），默认500ms
   */
  longPressDuration?: number;
}

interface UseGameInteractionReturn {
  /**
   * PC端：左键点击事件处理器
   */
  onClick: (e: React.MouseEvent, seatId: number) => void;
  
  /**
   * PC端：右键点击事件处理器
   */
  onContextMenu: (e: React.MouseEvent, seatId: number) => void;
  
  /**
   * 触屏端：触摸开始事件处理器
   */
  onTouchStart: (e: React.TouchEvent, seatId: number) => void;
  
  /**
   * 触屏端：触摸结束事件处理器
   */
  onTouchEnd: (e: React.TouchEvent, seatId: number) => void;
  
  /**
   * 触屏端：触摸移动事件处理器（用于取消长按）
   */
  onTouchMove: (e: React.TouchEvent, seatId: number) => void;
}

/**
 * 统一的事件处理Hook，同时支持PC鼠标右键和触屏设备长按
 * 
 * @param options 配置选项
 * @returns 事件处理器对象
 */
export function useGameInteraction(
  options: UseGameInteractionOptions
): UseGameInteractionReturn {
  const {
    onShortPress,
    onLongPress,
    longPressDuration = 500,
  } = options;

  // 存储每个座位的长按定时器
  const longPressTimersRef = useRef<Map<number, NodeJS.Timeout>>(new Map());
  
  // 记录哪些座位已经触发了长按（避免短按被触发）
  const longPressTriggeredRef = useRef<Set<number>>(new Set());
  
  // 记录触摸开始时的位置（用于检测是否移动）
  const touchStartPosRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  /**
   * 清除指定座位的长按定时器
   */
  const clearLongPressTimer = useCallback((seatId: number) => {
    const timer = longPressTimersRef.current.get(seatId);
    if (timer) {
      clearTimeout(timer);
      longPressTimersRef.current.delete(seatId);
    }
  }, []);

  /**
   * PC端：左键点击处理
   */
  const handleClick = useCallback((e: React.MouseEvent, seatId: number) => {
    e.stopPropagation();
    // 只有左键点击才触发短按
    if (e.button === undefined || e.button === 0) {
      onShortPress?.(seatId);
    }
  }, [onShortPress]);

  /**
   * PC端：右键点击处理
   */
  const handleContextMenu = useCallback((e: React.MouseEvent, seatId: number) => {
    e.preventDefault();
    e.stopPropagation();
    onLongPress?.(seatId, e);
  }, [onLongPress]);

  /**
   * 触屏端：触摸开始处理
   */
  const handleTouchStart = useCallback((e: React.TouchEvent, seatId: number) => {
    e.stopPropagation();
    // 注意：不在这里调用preventDefault，让外层组件决定是否需要阻止默认行为
    
    // 清除可能存在的旧定时器
    clearLongPressTimer(seatId);
    
    // 重置长按触发标记
    longPressTriggeredRef.current.delete(seatId);
    
    // 记录触摸开始位置
    const touch = e.touches[0];
    if (touch) {
      touchStartPosRef.current.set(seatId, {
        x: touch.clientX,
        y: touch.clientY,
      });
    }
    
    // 设置长按定时器
    const timer = setTimeout(() => {
      // 检查手指是否还在原位置（简单检测：如果位置记录还在，认为未移动）
      if (touchStartPosRef.current.has(seatId)) {
        longPressTriggeredRef.current.add(seatId);
        onLongPress?.(seatId, e);
      }
      clearLongPressTimer(seatId);
      touchStartPosRef.current.delete(seatId);
    }, longPressDuration);
    
    longPressTimersRef.current.set(seatId, timer);
  }, [onLongPress, longPressDuration, clearLongPressTimer]);

  /**
   * 触屏端：触摸移动处理（取消长按）
   */
  const handleTouchMove = useCallback((e: React.TouchEvent, seatId: number) => {
    e.stopPropagation();
    
    // 检查是否移动超过阈值（10px）
    const startPos = touchStartPosRef.current.get(seatId);
    if (startPos && e.touches[0]) {
      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - startPos.x);
      const deltaY = Math.abs(touch.clientY - startPos.y);
      
      // 如果移动超过阈值，取消长按
      if (deltaX > 10 || deltaY > 10) {
        clearLongPressTimer(seatId);
        touchStartPosRef.current.delete(seatId);
      }
    } else {
      // 如果没有起始位置记录，直接取消
      clearLongPressTimer(seatId);
      touchStartPosRef.current.delete(seatId);
    }
  }, [clearLongPressTimer]);

  /**
   * 触屏端：触摸结束处理
   */
  const handleTouchEnd = useCallback((e: React.TouchEvent, seatId: number) => {
    e.stopPropagation();
    
    // 清除长按定时器
    clearLongPressTimer(seatId);
    
    // 如果未触发长按，视为短按
    if (!longPressTriggeredRef.current.has(seatId)) {
      onShortPress?.(seatId);
    } else {
      // 如果已触发长按，清除标记
      longPressTriggeredRef.current.delete(seatId);
    }
    
    // 清除位置记录
    touchStartPosRef.current.delete(seatId);
  }, [onShortPress, clearLongPressTimer]);

  return {
    onClick: handleClick,
    onContextMenu: handleContextMenu,
    onTouchStart: handleTouchStart,
    onTouchEnd: handleTouchEnd,
    onTouchMove: handleTouchMove,
  };
}

