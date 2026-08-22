// Game configuration constants

export const MAX_PLAYERS = 8;
export const WIN_SCORE = 3; // First to 3 round wins

export const DESK = {
  width: 0.7,   // meters (wider for 8 pens)
  depth: 0.7,
  height: 0.02,
  friction: 0.45,
  restitution: 0.3,
};

export const PEN = {
  radius: 0.008,
  halfLength: 0.07,
  mass: 0.02,
  friction: 0.36,
  restitution: 0.4,
  linearDamping: 4.0,
  angularDamping: 5.0,
  selectionRadius: 0.06,
};

export const SIM = {
  dt: 1 / 120,
  maxSubSteps: 4,
  gravity: { x: 0, y: -9.81, z: 0 },
};

export const INPUT = {
  maxPullPx: 180,
  maxForce: 0.035,
  deadzone: 5, // px
};

export const SETTLE = {
  speedThreshold: 0.008,
  frames: 15, // consecutive frames below threshold = settled
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
    // Two players face each other vertically
    const positions = [
      { x: 0, z: -DESK.depth * 0.28, yaw: Math.PI * 0.1 },   // top (slight angle)
      { x: 0, z:  DESK.depth * 0.28, yaw: -Math.PI * 0.1 },  // bottom (slight angle)
    ];
    return positions[seatIndex];
  }

  if (totalPlayers === 3) {
    // Triangle layout matching penfight.xyz style
    const positions = [
      { x: -DESK.width * 0.22, z: -DESK.depth * 0.18, yaw: Math.PI * 0.35 },  // top-left, angled
      { x:  DESK.width * 0.22, z: -DESK.depth * 0.05, yaw: -Math.PI * 0.3 },  // right, angled
      { x: 0,                  z:  DESK.depth * 0.25,  yaw: 0 },                // bottom-center, vertical
    ];
    return positions[seatIndex];
  }

  if (totalPlayers === 4) {
    // Four corners
    const hw = DESK.width * 0.24;
    const hd = DESK.depth * 0.24;
    const positions = [
      { x: -hw, z: -hd, yaw:  Math.PI * 0.25 },
      { x:  hw, z: -hd, yaw: -Math.PI * 0.25 },
      { x:  hw, z:  hd, yaw: -Math.PI * 0.75 },
      { x: -hw, z:  hd, yaw:  Math.PI * 0.75 },
    ];
    return positions[seatIndex];
  }

  // 5-8 players: evenly spaced circle
  const radius = Math.min(DESK.width, DESK.depth) * 0.28;
  const angle = (2 * Math.PI * seatIndex) / totalPlayers - Math.PI / 2;
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    yaw: angle + Math.PI / 2, // pen points toward center
  };
}
