import * as THREE from 'three';
import { DESK, PEN, PLAYER_COLORS, MAX_PLAYERS } from '../config.js';

export function createScene() {
  const scene = new THREE.Scene();
  
  // Warm classroom gradient background
  const bgColor = new THREE.Color(0x3d5a40);
  scene.background = bgColor;
  scene.fog = new THREE.Fog(bgColor, 2, 6);

  // Ambient light — warm classroom feel
  const ambient = new THREE.AmbientLight(0xfff5e6, 0.5);
  scene.add(ambient);

  // Main overhead light (like a classroom tube light)
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(0.5, 3, 1);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 6;
  dirLight.shadow.camera.left = -1;
  dirLight.shadow.camera.right = 1;
  dirLight.shadow.camera.top = 1;
  dirLight.shadow.camera.bottom = -1;
  dirLight.shadow.bias = -0.001;
  scene.add(dirLight);

  // Warm fill light from below-left
  const fillLight = new THREE.DirectionalLight(0xffd4a0, 0.3);
  fillLight.position.set(-2, 1, -1);
  scene.add(fillLight);

  // Subtle point light above desk center for highlights
  const pointLight = new THREE.PointLight(0xffeedd, 0.3, 2.5);
  pointLight.position.set(0, 1.0, 0);
  scene.add(pointLight);

  return scene;
}

export function createCamera(renderer) {
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.01, 50);

  // Camera positioned to see the full desk with margin on all sides
  if (aspect < 1) {
    // Portrait — higher up, further back
    camera.position.set(0, 0.6, 0.55);
    camera.lookAt(0, 0, 0);
  } else {
    // Landscape — higher and further back so bottom edge is visible
    camera.position.set(0, 0.5, 0.45);
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
  renderer.toneMappingExposure = 1.1;
  return renderer;
}

export function createDeskMesh(scene, scale = 1.0) {
  // === Desk top surface ===
  const w = DESK.width * scale;
  const d = DESK.depth * scale;
  const deskGeo = new THREE.BoxGeometry(w, DESK.height, d);
  
  // Create a canvas texture for wood grain
  const woodCanvas = document.createElement('canvas');
  woodCanvas.width = 512;
  woodCanvas.height = 512;
  const ctx = woodCanvas.getContext('2d');
  
  // Base wood color
  ctx.fillStyle = '#c8a06e';
  ctx.fillRect(0, 0, 512, 512);
  
  // Wood grain lines
  ctx.strokeStyle = '#b8905e';
  ctx.lineWidth = 1;
  for (let i = 0; i < 60; i++) {
    ctx.beginPath();
    const y = Math.random() * 512;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      128, y + (Math.random() - 0.5) * 20,
      384, y + (Math.random() - 0.5) * 20,
      512, y + (Math.random() - 0.5) * 10
    );
    ctx.stroke();
  }
  
  // Subtle scratches
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 30; i++) {
    ctx.beginPath();
    const x1 = Math.random() * 512;
    const y1 = Math.random() * 512;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + (Math.random() - 0.5) * 80, y1 + (Math.random() - 0.5) * 80);
    ctx.stroke();
  }
  
  const woodTexture = new THREE.CanvasTexture(woodCanvas);
  woodTexture.wrapS = THREE.RepeatWrapping;
  woodTexture.wrapT = THREE.RepeatWrapping;
  
  const deskMat = new THREE.MeshStandardMaterial({
    map: woodTexture,
    roughness: 0.65,
    metalness: 0.0,
    color: 0xd4a574,
  });
  
  const deskMesh = new THREE.Mesh(deskGeo, deskMat);
  deskMesh.position.set(0, -DESK.height / 2, 0);
  deskMesh.receiveShadow = true;
  deskMesh.castShadow = true;
  scene.add(deskMesh);

  // === Desk border / frame (darker wood edge) ===
  const borderThickness = 0.012;
  const borderHeight = DESK.height + 0.007;
  const borderColor = 0x5c3d2e;
  
  const borders = [
    { w: w + borderThickness * 2, h: borderHeight, d: borderThickness, x: 0, z: d / 2 + borderThickness / 2 },
    { w: w + borderThickness * 2, h: borderHeight, d: borderThickness, x: 0, z: -d / 2 - borderThickness / 2 },
    { w: borderThickness, h: borderHeight, d: d, x: w / 2 + borderThickness / 2, z: 0 },
    { w: borderThickness, h: borderHeight, d: d, x: -w / 2 - borderThickness / 2, z: 0 },
  ];
  
  for (const b of borders) {
    const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
    const mat = new THREE.MeshStandardMaterial({ color: borderColor, roughness: 0.8, metalness: 0.1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(b.x, -DESK.height / 2 + borderHeight / 2 - 0.004, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // === Desk legs ===
  const legGeo = new THREE.CylinderGeometry(0.012, 0.014, 0.32, 8);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.9, metalness: 0.2 });
  const legOffsetX = w / 2 - 0.035;
  const legOffsetZ = d / 2 - 0.035;
  const legY = -DESK.height - 0.16;
  
  const legPositions = [
    [legOffsetX, legY, legOffsetZ],
    [-legOffsetX, legY, legOffsetZ],
    [legOffsetX, legY, -legOffsetZ],
    [-legOffsetX, legY, -legOffsetZ],
  ];
  
  for (const pos of legPositions) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(...pos);
    leg.castShadow = true;
    scene.add(leg);
  }

  // === Floor ===
  const floorGeo = new THREE.PlaneGeometry(5, 5);
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = 256;
  floorCanvas.height = 256;
  const fctx = floorCanvas.getContext('2d');
  
  // Tile pattern floor
  fctx.fillStyle = '#8a9a7b';
  fctx.fillRect(0, 0, 256, 256);
  fctx.strokeStyle = '#7a8a6b';
  fctx.lineWidth = 2;
  const tileSize = 32;
  for (let x = 0; x < 256; x += tileSize) {
    for (let y = 0; y < 256; y += tileSize) {
      fctx.strokeRect(x, y, tileSize, tileSize);
    }
  }
  
  const floorTexture = new THREE.CanvasTexture(floorCanvas);
  floorTexture.wrapS = THREE.RepeatWrapping;
  floorTexture.wrapT = THREE.RepeatWrapping;
  floorTexture.repeat.set(4, 4);
  
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTexture,
    roughness: 0.9,
    metalness: 0.0,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -DESK.height - 0.32;
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

  // === Main barrel (cylinder along Z) ===
  const barrelGeo = new THREE.CylinderGeometry(R, R, HL * 2, 16);
  const barrelMat = new THREE.MeshStandardMaterial({
    color: color.three,
    roughness: 0.35,
    metalness: 0.1,
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
