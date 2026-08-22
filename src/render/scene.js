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
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.01, 50);
  // Angled top-down view, like looking at a desk
  camera.position.set(0, 0.85, 0.5);
  camera.lookAt(0, 0, -0.02);
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

export function createDeskMesh(scene) {
  // === Desk top surface ===
  const deskGeo = new THREE.BoxGeometry(DESK.width, DESK.height, DESK.depth);
  
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
  const borderHeight = DESK.height + 0.008;
  const borderColor = 0x5c3d2e;
  
  const borders = [
    { w: DESK.width + borderThickness * 2, h: borderHeight, d: borderThickness, x: 0, z: DESK.depth / 2 + borderThickness / 2 },
    { w: DESK.width + borderThickness * 2, h: borderHeight, d: borderThickness, x: 0, z: -DESK.depth / 2 - borderThickness / 2 },
    { w: borderThickness, h: borderHeight, d: DESK.depth, x: DESK.width / 2 + borderThickness / 2, z: 0 },
    { w: borderThickness, h: borderHeight, d: DESK.depth, x: -DESK.width / 2 - borderThickness / 2, z: 0 },
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
  const legGeo = new THREE.CylinderGeometry(0.012, 0.014, 0.35, 8);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.9, metalness: 0.2 });
  const legOffsetX = DESK.width / 2 - 0.04;
  const legOffsetZ = DESK.depth / 2 - 0.04;
  const legY = -DESK.height - 0.175;
  
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
  floor.position.y = -DESK.height - 0.35;
  floor.receiveShadow = true;
  scene.add(floor);

  return deskMesh;
}

export function createPenMesh(scene, seatIndex) {
  const color = PLAYER_COLORS[seatIndex];
  const group = new THREE.Group();

  // Pen body — capsule lying along Z axis
  const bodyGeo = new THREE.CapsuleGeometry(PEN.radius, PEN.halfLength * 2, 12, 20);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: color.three,
    roughness: 0.2,
    metalness: 0.7,
    envMapIntensity: 0.5,
  });
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  // Rotate capsule to lie flat along Z
  bodyMesh.rotation.x = Math.PI / 2;
  group.add(bodyMesh);

  // Pen grip section (slightly wider band near center)
  const gripGeo = new THREE.CylinderGeometry(PEN.radius * 1.15, PEN.radius * 1.15, 0.025, 12);
  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.4,
    metalness: 0.5,
  });
  const gripMesh = new THREE.Mesh(gripGeo, gripMat);
  gripMesh.rotation.x = Math.PI / 2;
  gripMesh.position.z = -PEN.halfLength * 0.4;
  group.add(gripMesh);

  // Pen tip (silver/chrome)
  const tipGeo = new THREE.ConeGeometry(PEN.radius * 0.5, 0.014, 10);
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.1,
    metalness: 0.9,
  });
  const tipMesh = new THREE.Mesh(tipGeo, tipMat);
  tipMesh.rotation.x = -Math.PI / 2;
  tipMesh.position.z = PEN.halfLength + 0.007;
  tipMesh.castShadow = true;
  group.add(tipMesh);

  // Pen cap (at back end)
  const capGeo = new THREE.SphereGeometry(PEN.radius * 1.0, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const capMat = new THREE.MeshStandardMaterial({
    color: color.three,
    roughness: 0.25,
    metalness: 0.6,
  });
  const capMesh = new THREE.Mesh(capGeo, capMat);
  capMesh.rotation.x = Math.PI / 2;
  capMesh.position.z = -PEN.halfLength - PEN.radius * 0.5;
  group.add(capMesh);

  // Pen clip (metallic strip)
  const clipGeo = new THREE.BoxGeometry(0.002, 0.003, PEN.halfLength * 0.7);
  const clipMat = new THREE.MeshStandardMaterial({
    color: 0xdddddd,
    metalness: 0.95,
    roughness: 0.1,
  });
  const clipMesh = new THREE.Mesh(clipGeo, clipMat);
  clipMesh.position.set(0, PEN.radius + 0.001, -PEN.halfLength * 0.2);
  group.add(clipMesh);

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
  const material = new THREE.LineDashedMaterial({
    color: 0xff6666,
    dashSize: 0.008,
    gapSize: 0.004,
    linewidth: 2,
    transparent: true,
    opacity: 0.8,
  });
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(6);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
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
  positions[1] = startWorld.y + 0.005;
  positions[2] = startWorld.z;
  positions[3] = endWorld.x;
  positions[4] = endWorld.y + 0.005;
  positions[5] = endWorld.z;
  line.geometry.attributes.position.needsUpdate = true;
  line.computeLineDistances();
  line.visible = true;
}
