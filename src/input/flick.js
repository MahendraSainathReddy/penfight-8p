import * as THREE from 'three';
import { INPUT, PEN, DESK } from '../config.js';

/**
 * Handles mouse/touch slingshot input for flicking pens.
 * Drag backward from pen, release to flick in opposite direction.
 */
export class FlickInput {
  constructor(renderer, camera, onFlick, canFlick, onAimUpdate) {
    this.renderer = renderer;
    this.camera = camera;
    this.onFlick = onFlick;
    this.canFlick = canFlick; // () => seatIndex | null
    this.onAimUpdate = onAimUpdate;

    this.dragging = false;
    this.startScreen = null;
    this.currentScreen = null;
    this.penBodies = []; // set externally
    this.raycaster = new THREE.Raycaster();
    // Intersect at pen body height so aim lines align with pen positions
    this.deskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.011);

    this._bindEvents();
  }

  setPenBodies(bodies) {
    this.penBodies = bodies;
  }

  _bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('mousedown', (e) => this._onStart(e.clientX, e.clientY));
    el.addEventListener('mousemove', (e) => this._onMove(e.clientX, e.clientY));
    el.addEventListener('mouseup', (e) => this._onEnd(e.clientX, e.clientY));
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      this._onStart(t.clientX, t.clientY);
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      this._onMove(t.clientX, t.clientY);
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this._onEnd(t.clientX, t.clientY);
    }, { passive: false });
  }

  _screenToNDC(x, y) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1
    );
  }

  _screenToWorld(x, y) {
    const ndc = this._screenToNDC(x, y);
    this.raycaster.setFromCamera(ndc, this.camera);
    const target = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.deskPlane, target);
    return target;
  }

  _isNearPen(worldPos, seatIndex) {
    if (!this.penBodies[seatIndex]) return false;
    const body = this.penBodies[seatIndex];
    const penPos = body.translation();
    const penRot = body.rotation();

    // Get pen's forward direction from its Y-axis rotation quaternion.
    // The pen's local long axis is Z. For a Y-only rotation quat (0, sy, 0, cw),
    // rotating (0,0,1) gives: (2*(sy*cw), 0, cw*cw - sy*sy) = (sin(yaw), 0, cos(yaw))
    const qy = penRot.y, qw = penRot.w;
    const nx = 2 * qy * qw;          // sin(yaw)
    const nz = qw * qw - qy * qy;    // cos(yaw)

    // Pen endpoints in world space (along its length)
    const halfLen = PEN.halfLength;
    const ax = penPos.x - nx * halfLen;
    const az = penPos.z - nz * halfLen;
    const bx = penPos.x + nx * halfLen;
    const bz = penPos.z + nz * halfLen;

    // Distance from click point to the pen's line segment (in XZ plane)
    const dx = bx - ax;
    const dz = bz - az;
    const segLenSq = dx * dx + dz * dz;

    let t = 0;
    if (segLenSq > 0) {
      t = ((worldPos.x - ax) * dx + (worldPos.z - az) * dz) / segLenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const closestX = ax + t * dx;
    const closestZ = az + t * dz;
    const distX = worldPos.x - closestX;
    const distZ = worldPos.z - closestZ;
    const dist = Math.sqrt(distX * distX + distZ * distZ);

    // Generous selection radius
    return dist < PEN.selectionRadius;
  }

  _onStart(sx, sy) {
    const mySeat = this.canFlick();
    if (mySeat === null) return;

    const worldPos = this._screenToWorld(sx, sy);
    if (!worldPos) return;

    if (!this._isNearPen(worldPos, mySeat)) return;

    this.dragging = true;
    this.startScreen = { x: sx, y: sy };
    this.currentScreen = { x: sx, y: sy };
    this.dragSeat = mySeat;
  }

  _onMove(sx, sy) {
    if (!this.dragging) return;
    this.currentScreen = { x: sx, y: sy };

    // Calculate aim visualization — show the drag-back line
    // (from the strike point on the pen to where the finger is now)
    const dx = this.startScreen.x - sx;
    const dy = this.startScreen.y - sy;
    const pullDist = Math.sqrt(dx * dx + dy * dy);
    const power = Math.min(pullDist / INPUT.maxPullPx, 1.0);

    // Strike point (where finger first touched the pen)
    const strikeWorld = this._screenToWorld(this.startScreen.x, this.startScreen.y);
    // Current finger position (where they're dragging back to)
    const currentWorld = this._screenToWorld(sx, sy);

    if (strikeWorld && currentWorld) {
      // Clamp the aim line to a max length so it stays near the desk
      const maxAimLen = 0.2; // max visual line length in world units
      let ex = currentWorld.x;
      let ez = currentWorld.z;
      const adx = ex - strikeWorld.x;
      const adz = ez - strikeWorld.z;
      const aimLen = Math.sqrt(adx * adx + adz * adz);
      if (aimLen > maxAimLen) {
        ex = strikeWorld.x + (adx / aimLen) * maxAimLen;
        ez = strikeWorld.z + (adz / aimLen) * maxAimLen;
      }

      // Show line FROM strike point TO clamped finger position (the pull-back)
      this.onAimUpdate({
        penPos: { x: strikeWorld.x, y: strikeWorld.y + 0.003, z: strikeWorld.z },
        endPos: { x: ex, y: strikeWorld.y + 0.003, z: ez },
        power,
      });
    }
  }

  _onEnd(sx, sy) {
    if (!this.dragging) return;
    this.dragging = false;

    const dx = this.startScreen.x - sx;
    const dy = this.startScreen.y - sy;
    const pullDist = Math.sqrt(dx * dx + dy * dy);

    // Clear aim line
    this.onAimUpdate(null);

    if (pullDist < INPUT.deadzone) return;

    const power = Math.min(pullDist / INPUT.maxPullPx, 1.0);

    // Get direction in world space
    const startWorld = this._screenToWorld(this.startScreen.x, this.startScreen.y);
    const endWorld = this._screenToWorld(sx, sy);

    if (!startWorld || !endWorld) return;

    // Flick direction: from end to start (slingshot)
    const dirX = startWorld.x - endWorld.x;
    const dirZ = startWorld.z - endWorld.z;
    const len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;

    // Strike point: where the player initially clicked (start of drag)
    // This is the actual point on/near the pen — off-center clicks create spin
    const strikeWorld = this._screenToWorld(this.startScreen.x, this.startScreen.y);
    const penPos = this.penBodies[this.dragSeat].translation();

    this.onFlick({
      seat: this.dragSeat,
      strikePoint: {
        x: strikeWorld.x,
        y: penPos.y,
        z: strikeWorld.z,
      },
      direction: { x: dirX / len, z: dirZ / len },
      power,
    });
  }
}
