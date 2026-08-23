/**
 * Procedural sound effects using Web Audio API.
 * No external files needed — all sounds are synthesized.
 */

let ctx = null;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (browsers require user gesture)
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  return ctx;
}

// Unlock audio on first user interaction
export function unlockAudio() {
  const unlock = () => {
    getCtx();
    document.removeEventListener('touchstart', unlock);
    document.removeEventListener('mousedown', unlock);
    document.removeEventListener('click', unlock);
  };
  document.addEventListener('touchstart', unlock, { once: true });
  document.addEventListener('mousedown', unlock, { once: true });
  document.addEventListener('click', unlock, { once: true });
}

/**
 * Quick whoosh sound when flicking a pen.
 */
export function playFlick(power = 0.5) {
  const ac = getCtx();
  const duration = 0.2;
  const now = ac.currentTime;

  // Filtered noise sweep — airy whoosh
  const bufferSize = ac.sampleRate * duration;
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
  }

  const source = ac.createBufferSource();
  source.buffer = buffer;

  // Sweeping high-pass filter for whoosh effect
  const filter = ac.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(500, now);
  filter.frequency.exponentialRampToValueAtTime(4000 + power * 4000, now + duration * 0.3);
  filter.frequency.exponentialRampToValueAtTime(800, now + duration);
  filter.Q.value = 0.7;

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.2 + power * 0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  source.start(now);
  source.stop(now + duration);
}

/**
 * Hard plastic clack when pens collide.
 */
export function playCollision(intensity = 0.5) {
  const ac = getCtx();
  const now = ac.currentTime;

  // Sharp attack transient — like plastic hitting plastic
  const osc1 = ac.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(3000 + intensity * 1500, now);
  osc1.frequency.exponentialRampToValueAtTime(500, now + 0.05);

  const gain1 = ac.createGain();
  gain1.gain.setValueAtTime(0.3 * intensity + 0.1, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  osc1.connect(gain1);
  gain1.connect(ac.destination);
  osc1.start(now);
  osc1.stop(now + 0.06);

  // Resonant body — short low "tok"
  const osc2 = ac.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(400 + intensity * 200, now);
  osc2.frequency.exponentialRampToValueAtTime(150, now + 0.1);

  const gain2 = ac.createGain();
  gain2.gain.setValueAtTime(0.2 * intensity, now + 0.005);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

  osc2.connect(gain2);
  gain2.connect(ac.destination);
  osc2.start(now);
  osc2.stop(now + 0.1);
}

/**
 * Thud when a pen falls off the desk.
 */
export function playPenOut() {
  const ac = getCtx();
  const now = ac.currentTime;
  const duration = 0.25;

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + duration);

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(now);
  osc.stop(now + duration);
}

/**
 * Short victory chime for round win.
 */
export function playRoundWin() {
  const ac = getCtx();
  const now = ac.currentTime;

  const notes = [523, 659, 784]; // C5, E5, G5
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, now + i * 0.12);
    gain.gain.linearRampToValueAtTime(0.2, now + i * 0.12 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.4);

    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now + i * 0.12);
    osc.stop(now + i * 0.12 + 0.4);
  });
}

/**
 * Match won — longer fanfare.
 */
export function playMatchWin() {
  const ac = getCtx();
  const now = ac.currentTime;

  const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, now + i * 0.15);
    gain.gain.linearRampToValueAtTime(0.25, now + i * 0.15 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.6);

    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now + i * 0.15);
    osc.stop(now + i * 0.15 + 0.6);
  });
}

/**
 * Subtle ding when it's your turn.
 */
export function playTurnNotify() {
  const ac = getCtx();
  const now = ac.currentTime;

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 880; // A5

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.3);
}
