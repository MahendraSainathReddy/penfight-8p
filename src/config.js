// Game configuration constants

export const MAX_PLAYERS = 8;
export const WIN_SCORE = 5; // First to 5 round wins

export const DESK = {
  width: 0.50,   // meters — larger board for better gameplay
  depth: 0.50,
  height: 0.02,
  friction: 1.2,   // very high friction — pens grip hard, no sliding
  restitution: 0.15,
};

export const PEN = {
  radius: 0.004,       // smaller visible pens
  halfLength: 0.038,   // shorter pens — less dominant on board
  mass: 0.012,
  friction: 1.0,       // very high grip between pens
  restitution: 0.2,
  linearDamping: 6.0,  // extremely high drag — pens stop very quickly
  angularDamping: 6.5, // spin dies almost immediately
  selectionRadius: 0.05,
};

export const SIM = {
  dt: 1 / 120,
  maxSubSteps: 4,
  gravity: { x: 0, y: -9.81, z: 0 },
};

export const INPUT = {
  maxPullPx: 150,
  maxForce: 0.015,   // much lower force — pens don't fly off, controlled flicks
  deadzone: 5, // px
};

export const SETTLE = {
  speedThreshold: 0.008,
  frames: 20, // consecutive frames below threshold = settled
};

export const TURN = {
  timeoutWarnMs: 20000,
  timeoutForceMs: 45000,
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
  if (totalPlayers === 2) {
    // Two players — pens placed with their BODIES (sides) facing each other
    // yaw = 0 means pen lies along Z axis. We want pen bodies parallel,
    // so they are side-by-side, not tip-to-tip.
    const positions = [
      { x: 0, z: -DESK.depth * 0.2, yaw: Math.PI / 2 },   // top pen, body faces down
      { x: 0, z:  DESK.depth * 0.2, yaw: Math.PI / 2 },   // bottom pen, body faces up
    ];
    return positions[seatIndex];
  }

  if (totalPlayers === 3) {
    // Triangle layout — pens oriented so their sides face the center
    // (perpendicular to the line from pen to center)
    const positions = [
      { x: -DESK.width * 0.2, z: -DESK.depth * 0.15, yaw: Math.PI * 0.83 },  // top-left, body faces center
      { x:  DESK.width * 0.2, z: -DESK.depth * 0.15, yaw: Math.PI * 0.17 },  // top-right, body faces center
      { x: 0,                 z:  DESK.depth * 0.22,  yaw: Math.PI / 2 },     // bottom-center, body faces up
    ];
    return positions[seatIndex];
  }

  if (totalPlayers === 4) {
    // Four corners — pens perpendicular to the diagonal (body faces center)
    const hw = DESK.width * 0.22;
    const hd = DESK.depth * 0.22;
    const positions = [
      { x: -hw, z: -hd, yaw:  Math.PI * 0.75 },
      { x:  hw, z: -hd, yaw:  Math.PI * 0.25 },
      { x:  hw, z:  hd, yaw: -Math.PI * 0.25 },
      { x: -hw, z:  hd, yaw: -Math.PI * 0.75 },
    ];
    return positions[seatIndex];
  }

  // 5-8 players: evenly spaced circle, body (side) faces center
  const radius = Math.min(DESK.width, DESK.depth) * 0.26;
  const angle = (2 * Math.PI * seatIndex) / totalPlayers - Math.PI / 2;
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    yaw: angle + Math.PI, // pen body (side) faces center, not tip
  };
}
