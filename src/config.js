// Game configuration constants

export const MAX_PLAYERS = 8;
export const WIN_SCORE = 3; // First to 3 round wins

export const DESK = {
  width: 0.38,   // meters — compact desk, doesn't fill screen
  depth: 0.38,
  height: 0.02,
  friction: 0.7,   // higher friction — pens grip the surface more
  restitution: 0.25,
};

export const PEN = {
  radius: 0.005,       // thinner pens
  halfLength: 0.05,    // shorter pens
  mass: 0.015,
  friction: 0.65,      // more grip between pens
  restitution: 0.3,
  linearDamping: 2.8,  // much more friction/drag — pens slow down faster
  angularDamping: 3.5, // spin slows faster too
  selectionRadius: 0.05,
};

export const SIM = {
  dt: 1 / 120,
  maxSubSteps: 4,
  gravity: { x: 0, y: -9.81, z: 0 },
};

export const INPUT = {
  maxPullPx: 160,
  maxForce: 0.025,   // reduced for smaller board
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
    // Two players face each other — tips pointing at opponent
    const positions = [
      { x: -0.05, z: -DESK.depth * 0.22, yaw: Math.PI * 0.6 },  // top pen, tip pointing down-right
      { x:  0.05, z:  DESK.depth * 0.22, yaw: -Math.PI * 0.4 },  // bottom pen, tip pointing up-left
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
