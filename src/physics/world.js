import RAPIER from '@dimforge/rapier3d-compat';
import { SIM, DESK, PEN, SETTLE } from '../config.js';

let rapier = null;

export async function initPhysics() {
  await RAPIER.init();
  rapier = RAPIER;
  return rapier;
}

export function createWorld() {
  const world = new rapier.World(SIM.gravity);
  world.timestep = SIM.dt;
  return world;
}

export function createDesk(world) {
  const bodyDesc = rapier.RigidBodyDesc.fixed()
    .setTranslation(0, -DESK.height / 2, 0);
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = rapier.ColliderDesc.cuboid(
    DESK.width / 2,
    DESK.height / 2,
    DESK.depth / 2
  )
    .setFriction(DESK.friction)
    .setRestitution(DESK.restitution);
  world.createCollider(colliderDesc, body);

  return body;
}

export function createWalls(world) {
  // No physical walls — pens slide off the desk and are detected as "out"
  // by the isPenOnDesk check. This matches real pen fight where pens
  // just go off the edge.
}

export function createPen(world, x, z, yaw) {
  // Pen lies flat on desk surface. Modeled as a flat cuboid (box).
  // Dimensions: long and thin, very short height so it stays flat
  const penWidth = PEN.radius * 2;    // ~0.01m diameter
  const penHeight = 0.004;             // very thin (flat on desk)
  const penLength = PEN.halfLength * 2; // ~0.10m long

  const y = penHeight / 2 + 0.001; // resting just above desk

  const bodyDesc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinearDamping(PEN.linearDamping)
    .setAngularDamping(PEN.angularDamping)
    // Lock Y translation (pen stays on desk surface) and only allow Y rotation (yaw)
    .enabledTranslations(true, false, true)
    .enabledRotations(false, true, false);

  const body = world.createRigidBody(bodyDesc);

  // Use a cuboid (box) collider — flat, won't roll
  const colliderDesc = rapier.ColliderDesc.cuboid(
    penWidth / 2,    // half-extent X
    penHeight / 2,   // half-extent Y (height)
    penLength / 2    // half-extent Z (length)
  )
    .setMass(PEN.mass)
    .setFriction(PEN.friction)
    .setRestitution(PEN.restitution);
  world.createCollider(colliderDesc, body);

  // Set initial yaw rotation (pen points in the yaw direction)
  const cosHalf = Math.cos(yaw / 2);
  const sinHalf = Math.sin(yaw / 2);
  body.setRotation({ x: 0, y: sinHalf, z: 0, w: cosHalf }, true);

  return body;
}

export function getPenState(body) {
  const pos = body.translation();
  const rot = body.rotation();
  const linvel = body.linvel();
  const angvel = body.angvel();
  return {
    p: [pos.x, pos.y, pos.z],
    q: [rot.x, rot.y, rot.z, rot.w],
    lv: [linvel.x, linvel.y, linvel.z],
    av: [angvel.x, angvel.y, angvel.z],
  };
}

export function setPenState(body, state) {
  body.setTranslation({ x: state.p[0], y: state.p[1], z: state.p[2] }, true);
  body.setRotation({ x: state.q[0], y: state.q[1], z: state.q[2], w: state.q[3] }, true);
  body.setLinvel({ x: state.lv[0], y: state.lv[1], z: state.lv[2] }, true);
  body.setAngvel({ x: state.av[0], y: state.av[1], z: state.av[2] }, true);
}

export function applyFlick(body, direction, power, maxForce) {
  const force = power * maxForce;
  const impulse = { x: direction.x * force, y: 0, z: direction.z * force };
  body.applyImpulse(impulse, true);
}

export function isPenOnDesk(body) {
  const pos = body.translation();
  const hw = DESK.width / 2 + PEN.halfLength * 0.2;
  const hd = DESK.depth / 2 + PEN.halfLength * 0.2;
  // Pen is "out" if its center is beyond the desk edges (+ small margin)
  if (Math.abs(pos.x) > hw) return false;
  if (Math.abs(pos.z) > hd) return false;
  return true;
}

export function isPenSettled(body) {
  const lv = body.linvel();
  const av = body.angvel();
  const speed = Math.sqrt(lv.x * lv.x + lv.z * lv.z); // XZ only (Y is locked)
  const angSpeed = Math.abs(av.y); // Y rotation only
  return speed < SETTLE.speedThreshold && angSpeed < 0.02;
}

export { rapier };
