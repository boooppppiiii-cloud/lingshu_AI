export type FleeOffset = { x: number; y: number };

const FLEE_STEP_PX = 56;
const FLEE_MAX_RADIUS_PX = 88;

/** 沿「远离鼠标」方向位移一步，并限制在侧栏内可移动半径 */
export function nextFleeOffset(
  botCenter: { x: number; y: number },
  pointer: { x: number; y: number },
  current: FleeOffset,
): FleeOffset {
  let dx = botCenter.x - pointer.x;
  let dy = botCenter.y - pointer.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) {
    const angle = Math.random() * Math.PI * 2;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
  } else {
    dx /= len;
    dy /= len;
  }
  return clampFleeRadius({
    x: current.x + dx * FLEE_STEP_PX,
    y: current.y + dy * FLEE_STEP_PX,
  });
}

export function clampFleeRadius(offset: FleeOffset, max = FLEE_MAX_RADIUS_PX): FleeOffset {
  const len = Math.hypot(offset.x, offset.y);
  if (len <= max) return offset;
  const s = max / len;
  return { x: offset.x * s, y: offset.y * s };
}
