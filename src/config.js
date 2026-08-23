// Game configuration constants

export const MAX_PLAYERS = 8;
export const WIN_SCORE = 3; // First to 3 round wins

export const DESK = {
  width: 0.50,   // base size — scaled up for more players
  depth: 0.50,
  height: 0.02,
  friction: 1.1,
  restitution: 0.15,
};

// Returns scaled desk dimensions based on player count
export function getDeskScale(totalPlayers) {
  // 2 players: base size, 3-4: slightly bigger, 5+: larger
  if (totalPlayers <= 2) return 1.0;
  if (totalPlayers <= 3) return 1.1;
  if (totalPlayers <= 4) return 1.2;
  if (totalPlayers <= 5) return 1.3;
  return 1.35 + (totalPlayers - 6) * 0.05; // 6=1.35, 7=1.40, 8=1.45
}

export const PEN = {
  radius: 0.004,       // smaller visible pens
  halfLength: 0.038,   // shorter pens — less dominant on board
  mass: 0.012,
  friction: 0.9,       // good grip between pens
  restitution: 0.2,    // moderate bounce on collision
  linearDamping: 6.0,  // high drag — stops skating after collisions
  angularDamping: 6.0, // spin dies fast
  selectionRadius: 0.05,
};

export const SIM = {
  dt: 1 / 120,
  maxSubSteps: 4,
  gravity: { x: 0, y: -9.81, z: 0 },
};

export const INPUT = {
  maxPullPx: 150,
  maxForce: 0.018,   // slightly stronger flicks for better collisions
  deadzone: 5, // px
};

export const SETTLE = {
  speedThreshold: 0.015,   // raised threshold — high damping means very slow residual movement
  frames: 15,              // fewer frames needed (pens stop faster with high damping)
  maxSettleMs: 5000,       // force settle after 5s to prevent getting stuck
};

export const TURN = {
  timeoutMs: 90000, // 1.5 minutes per turn, then auto-skip
};

// 8 player colors
export const PLAYER_COLORS = [
  { label: 'red',    hex: '#e63946', three: 0xe63946 },
  { label: 'blue',   hex: '#2458b8', three: 0x2458b8 },
  { label: 'green',  hex: '#2a9d8f', three: 0x2a9d8f },
  { label: 'orange', hex: '#f77f00', three: 0xf77f00 },
  { label: 'purple', hex: '#7b2cbf', three: 0x7b2cbf },
  { label: 'pink',   hex: '#e056a0', three: 0xe056a0 },
  { label: 'yellow', hex: '#d4a017', three: 0xd4a017 },
  { label: 'cyan',   hex: '#00b4d8', three: 0x00b4d8 },
];

// Pen starting positions — layout depends on player count
// For 2: vertical face-off (top vs bottom)
// For 3: triangle layout like penfight.xyz
// For 4+: spread around the desk
export function getPenStartPosition(seatIndex, totalPlayers) {
  const scale = getDeskScale(totalPlayers);
  const dw = DESK.width * scale; // scaled desk width
  const dd = DESK.depth * scale; // scaled desk depth

  if (totalPlayers === 2) {
    const positions = [
      { x: 0, z: -dd * 0.2, yaw: Math.PI / 2 },
      { x: 0, z:  dd * 0.2, yaw: Math.PI / 2 },
    ];
    return positions[seatIndex];
  }

  if (totalPlayers === 3) {
    const positions = [
      { x: -dw * 0.2, z: -dd * 0.15, yaw: Math.PI * 0.83 },
      { x:  dw * 0.2, z: -dd * 0.15, yaw: Math.PI * 0.17 },
      { x: 0,         z:  dd * 0.22,  yaw: Math.PI / 2 },
    ];
    return positions[seatIndex];
  }

  if (totalPlayers === 4) {
    const hw = dw * 0.22;
    const hd = dd * 0.22;
    const positions = [
      { x: -hw, z: -hd, yaw:  Math.PI * 0.75 },
      { x:  hw, z: -hd, yaw:  Math.PI * 0.25 },
      { x:  hw, z:  hd, yaw: -Math.PI * 0.25 },
      { x: -hw, z:  hd, yaw: -Math.PI * 0.75 },
    ];
    return positions[seatIndex];
  }

  // 5-8 players: evenly spaced circle, wider spread
  const radius = Math.min(dw, dd) * 0.28;
  const angle = (2 * Math.PI * seatIndex) / totalPlayers - Math.PI / 2;
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    yaw: angle + Math.PI,
  };
}
