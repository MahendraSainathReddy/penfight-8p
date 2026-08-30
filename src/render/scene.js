import * as THREE from 'three';
import { DESK, PEN, PLAYER_COLORS, MAX_PLAYERS } from '../config.js';

export function createScene() {
  const scene = new THREE.Scene();

  // Soft radial gradient background (cozy room vibe)
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 512;
  bgCanvas.height = 512;
  const bgCtx = bgCanvas.getContext('2d');
  const grad = bgCtx.createRadialGradient(256, 200, 60, 256, 256, 400);
  grad.addColorStop(0, '#4a6b5a');   // lighter warm green center
  grad.addColorStop(0.5, '#33503f');
  grad.addColorStop(1, '#1e3327');   // darker edges (vignette)
  bgCtx.fillStyle = grad;
  bgCtx.fillRect(0, 0, 512, 512);
  const bgTexture = new THREE.CanvasTexture(bgCanvas);
  scene.background = bgTexture;

  scene.fog = new THREE.Fog(0x2a4234, 2.5, 7);

  // Soft ambient light
  const ambient = new THREE.AmbientLight(0xfff2e0, 0.55);
  scene.add(ambient);

  // Hemisphere light for natural sky/ground bounce
  const hemi = new THREE.HemisphereLight(0xffffff, 0x4a6b5a, 0.4);
  scene.add(hemi);

  // Main key light — warm overhead
  const dirLight = new THREE.DirectionalLight(0xfff0dd, 1.1);
  dirLight.position.set(0.6, 3, 1.2);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 6;
  dirLight.shadow.camera.left = -1;
  dirLight.shadow.camera.right = 1;
  dirLight.shadow.camera.top = 1;
  dirLight.shadow.camera.bottom = -1;
  dirLight.shadow.bias = -0.0005;
  dirLight.shadow.radius = 4; // softer shadow edges
  scene.add(dirLight);

  // Cool rim/fill light from opposite side for depth
  const fillLight = new THREE.DirectionalLight(0xa0c0ff, 0.25);
  fillLight.position.set(-2, 1.5, -1.5);
  scene.add(fillLight);

  // Warm accent spotlight over the desk center — pool of light
  const spot = new THREE.SpotLight(0xffe4b8, 0.6, 3.5, Math.PI / 4, 0.5, 1.5);
  spot.position.set(0, 1.6, 0.3);
  spot.target.position.set(0, 0, 0);
  scene.add(spot);
  scene.add(spot.target);

  return scene;
}

export function createCamera(renderer, scale = 1.0) {
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.01, 50);

  // More overhead view — looking almost straight down at the desk
  if (aspect < 1) {
    // Portrait
    camera.position.set(0, 0.7 * scale, 0.25 * scale);
    camera.lookAt(0, 0, 0);
  } else {
    // Landscape
    camera.position.set(0, 0.6 * scale, 0.2 * scale);
    camera.lookAt(0, 0, 0);
  }
  return camera;
}

export function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  return renderer;
}

export function createDeskMesh(scene, scale = 1.0) {
  // === Desk top surface ===
  const w = DESK.width * scale;
  const d = DESK.depth * scale;
  const deskGeo = new THREE.BoxGeometry(w, DESK.height, d);

  // Rich procedural wood grain texture
  const woodCanvas = document.createElement('canvas');
  woodCanvas.width = 1024;
  woodCanvas.height = 1024;
  const ctx = woodCanvas.getContext('2d');

  // Base wood gradient (warm honey tones with variation)
  const woodGrad = ctx.createLinearGradient(0, 0, 1024, 1024);
  woodGrad.addColorStop(0, '#cba174');
  woodGrad.addColorStop(0.3, '#c8a06e');
  woodGrad.addColorStop(0.6, '#bd9560');
  woodGrad.addColorStop(1, '#c49c68');
  ctx.fillStyle = woodGrad;
  ctx.fillRect(0, 0, 1024, 1024);

  // Long flowing wood grain lines (planks)
  for (let i = 0; i < 120; i++) {
    const y = Math.random() * 1024;
    const shade = 100 + Math.random() * 60;
    ctx.strokeStyle = `rgba(${shade}, ${shade * 0.72}, ${shade * 0.45}, ${0.15 + Math.random() * 0.25})`;
    ctx.lineWidth = 0.5 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      256, y + (Math.random() - 0.5) * 30,
      768, y + (Math.random() - 0.5) * 30,
      1024, y + (Math.random() - 0.5) * 15
    );
    ctx.stroke();
  }

  // Plank separators (horizontal boards)
  ctx.strokeStyle = 'rgba(90, 65, 40, 0.35)';
  ctx.lineWidth = 2;
  for (let py = 128; py < 1024; py += 170) {
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(1024, py);
    ctx.stroke();
  }

  // Subtle highlights / sheen streaks
  ctx.strokeStyle = 'rgba(255, 240, 210, 0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const y = Math.random() * 1024;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1024, y + (Math.random() - 0.5) * 20);
    ctx.stroke();
  }

  const woodTexture = new THREE.CanvasTexture(woodCanvas);
  woodTexture.wrapS = THREE.RepeatWrapping;
  woodTexture.wrapT = THREE.RepeatWrapping;
  woodTexture.anisotropy = 8;

  const deskMat = new THREE.MeshStandardMaterial({
    map: woodTexture,
    roughness: 0.5,
    metalness: 0.05,
    color: 0xd8ab78,
  });

  const deskMesh = new THREE.Mesh(deskGeo, deskMat);
  deskMesh.position.set(0, -DESK.height / 2, 0);
  deskMesh.receiveShadow = true;
  deskMesh.castShadow = true;
  scene.add(deskMesh);

  // Thin polished edge trim around the desk for a finished look
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x8a6a45,
    roughness: 0.35,
    metalness: 0.15,
  });
  const edgeThickness = 0.006;
  const edgeH = DESK.height + 0.001;
  const edges = [
    { w: w + edgeThickness, h: edgeH, d: edgeThickness, x: 0, z: d / 2 },
    { w: w + edgeThickness, h: edgeH, d: edgeThickness, x: 0, z: -d / 2 },
    { w: edgeThickness, h: edgeH, d: d, x: w / 2, z: 0 },
    { w: edgeThickness, h: edgeH, d: d, x: -w / 2, z: 0 },
  ];
  const edgeGroup = new THREE.Group();
  for (const e of edges) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(e.w, e.h, e.d), edgeMat);
    m.position.set(e.x, -DESK.height / 2, e.z);
    m.castShadow = true;
    m.receiveShadow = true;
    edgeGroup.add(m);
  }
  // Attach edges to desk mesh so they scale together during shrink
  deskMesh.add(edgeGroup);
  // Compensate for parent scale — edges use local coords, fine

  // === Floor — soft radial gradient (subtle, keeps focus on desk) ===
  const floorGeo = new THREE.PlaneGeometry(8, 8);
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = 512;
  floorCanvas.height = 512;
  const fctx = floorCanvas.getContext('2d');

  // Radial gradient — bright under desk, fading to dark edges
  const fgrad = fctx.createRadialGradient(256, 256, 40, 256, 256, 280);
  fgrad.addColorStop(0, '#7d8f6e');
  fgrad.addColorStop(0.5, '#67785a');
  fgrad.addColorStop(1, '#3f4d38');
  fctx.fillStyle = fgrad;
  fctx.fillRect(0, 0, 512, 512);

  // Very subtle tile hint (faint)
  fctx.strokeStyle = 'rgba(60, 75, 52, 0.25)';
  fctx.lineWidth = 1;
  const tileSize = 64;
  for (let x = 0; x <= 512; x += tileSize) {
    fctx.beginPath(); fctx.moveTo(x, 0); fctx.lineTo(x, 512); fctx.stroke();
    fctx.beginPath(); fctx.moveTo(0, x); fctx.lineTo(512, x); fctx.stroke();
  }

  const floorTexture = new THREE.CanvasTexture(floorCanvas);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTexture,
    roughness: 0.95,
    metalness: 0.0,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -DESK.height - 0.01;
  floor.receiveShadow = true;
  scene.add(floor);

  return deskMesh;
}

export function createPenMesh(scene, seatIndex) {
  const color = PLAYER_COLORS[seatIndex];
  const group = new THREE.Group();
  const R = PEN.radius;
  const HL = PEN.halfLength;

  // Simple but good-looking pen: cylinder body + cone tip + cap
  // Everything built lying along Z axis (matching physics)

  // === Main barrel (cylinder along Z) — glossy plastic ===
  const barrelGeo = new THREE.CylinderGeometry(R, R, HL * 2, 24);
  const barrelMat = new THREE.MeshStandardMaterial({
    color: color.three,
    roughness: 0.22,
    metalness: 0.15,
  });
  const barrel = new THREE.Mesh(barrelGeo, barrelMat);
  barrel.rotation.x = Math.PI / 2; // lie along Z
  barrel.castShadow = true;
  barrel.receiveShadow = true;
  group.add(barrel);

  // === Cap section (slightly wider cylinder at -Z end) ===
  const capLength = HL * 0.4;
  const capGeo = new THREE.CylinderGeometry(R * 1.05, R * 1.05, capLength, 16);
  const capMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color.three).multiplyScalar(0.7),
    roughness: 0.3,
    metalness: 0.15,
  });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = -HL + capLength / 2 - 0.002;
  group.add(cap);

  // === Cap end (flat circle at very back) ===
  const capEndGeo = new THREE.CircleGeometry(R * 1.05, 16);
  const capEnd = new THREE.Mesh(capEndGeo, capMat);
  capEnd.rotation.y = Math.PI;
  capEnd.position.z = -HL - 0.002;
  group.add(capEnd);

  // === Gold band (ring between body and cap) ===
  const bandGeo = new THREE.TorusGeometry(R * 1.02, 0.0008, 8, 24);
  const bandMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    roughness: 0.1,
    metalness: 0.9,
  });
  const band = new THREE.Mesh(bandGeo, bandMat);
  band.position.z = -HL + capLength - 0.002;
  group.add(band);

  // === Pocket clip ===
  const clipGeo = new THREE.BoxGeometry(0.002, 0.0015, capLength * 0.8);
  const clipMat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    metalness: 0.85,
    roughness: 0.15,
  });
  const clip = new THREE.Mesh(clipGeo, clipMat);
  clip.position.set(0, R + 0.001, -HL + capLength * 0.4);
  group.add(clip);

  scene.add(group);
  return group;
}

export function addPenLabel(penGroup, name, color) {
  // Create a high-res canvas texture with the player name
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Truncate name to fit
  const maxChars = 10;
  const displayName = name.length > maxChars ? name.slice(0, maxChars) : name;

  ctx.clearRect(0, 0, 512, 128);

  // Rounded dark pill background for readability
  const padX = 20;
  ctx.font = 'bold 64px Inter, Arial, sans-serif';
  const textW = ctx.measureText(displayName).width;
  const pillW = Math.min(textW + padX * 2, 500);
  const pillH = 90;
  const pillX = (512 - pillW) / 2;
  const pillY = (128 - pillH) / 2;
  const radius = pillH / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  ctx.moveTo(pillX + radius, pillY);
  ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pillH, radius);
  ctx.arcTo(pillX + pillW, pillY + pillH, pillX, pillY + pillH, radius);
  ctx.arcTo(pillX, pillY + pillH, pillX, pillY, radius);
  ctx.arcTo(pillX, pillY, pillX + pillW, pillY, radius);
  ctx.closePath();
  ctx.fill();

  // Text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 6;
  ctx.strokeText(displayName, 256, 66);
  ctx.fillText(displayName, 256, 66);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(0.1, 0.025, 1); // larger label
  sprite.position.set(0, 0.03, 0); // float higher above pen
  sprite.renderOrder = 999; // always on top
  penGroup.add(sprite);
  return sprite;
}

export function syncPenMesh(mesh, body) {
  const pos = body.translation();
  const rot = body.rotation();
  mesh.position.set(pos.x, pos.y, pos.z);
  mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
}

export function createAimLine(scene) {
  const material = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.6,
  });
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(6);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(geometry, material);
  line.visible = false;
  scene.add(line);
  return line;
}

export function updateAimLine(line, startWorld, endWorld) {
  if (!startWorld || !endWorld) {
    line.visible = false;
    return;
  }
  const positions = line.geometry.attributes.position.array;
  positions[0] = startWorld.x;
  positions[1] = startWorld.y;
  positions[2] = startWorld.z;
  positions[3] = endWorld.x;
  positions[4] = endWorld.y;
  positions[5] = endWorld.z;
  line.geometry.attributes.position.needsUpdate = true;

  // Color shifts white->red as pull power increases
  const dx = endWorld.x - startWorld.x;
  const dz = endWorld.z - startWorld.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const power = Math.min(dist / 0.15, 1.0);
  line.material.color.setRGB(1.0, 1.0 - power * 0.7, 1.0 - power * 0.8);
  line.material.opacity = 0.4 + power * 0.5;

  line.visible = true;
}
