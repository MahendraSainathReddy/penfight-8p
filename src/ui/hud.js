import { PLAYER_COLORS } from '../config.js';

/**
 * In-game HUD: scoreboard, turn indicator, results, notifications.
 */
export class HUD {
  constructor(container) {
    this.container = container;
    this.container.innerHTML = `
      <div id="hud-scoreboard" class="hud-scoreboard"></div>
      <div id="hud-turn" class="hud-turn"></div>
      <div id="hud-notify" class="hud-notify"></div>
      <div id="hud-result" class="hud-result hidden"></div>
    `;
    this.scoreboard = document.getElementById('hud-scoreboard');
    this.turnEl = document.getElementById('hud-turn');
    this.notifyEl = document.getElementById('hud-notify');
    this.resultEl = document.getElementById('hud-result');
    this.notifyTimer = null;
  }

  updateScoreboard(players, scores, outs, mySeat) {
    const items = players.map((p, idx) => {
      const color = PLAYER_COLORS[p.seat];
      const isOut = outs.has ? outs.has(p.seat) : (outs || []).includes(p.seat);
      const isMe = p.seat === mySeat;
      return `
        <div class="score-item ${isOut ? 'out' : ''} ${isMe ? 'me' : ''}"
             style="--pc: ${color.hex}">
          <span class="score-dot"></span>
          <span class="score-name">${escapeHtml(p.name)}</span>
          <span class="score-val">${scores[p.seat] || 0}</span>
        </div>
      `;
    }).join('');
    this.scoreboard.innerHTML = items;
  }

  setTurn(text, isMyTurn, icon = '') {
    this.turnEl.className = `hud-turn ${isMyTurn ? 'my-turn' : ''}`;
    this.turnEl.innerHTML = `${icon ? `<span class="turn-icon">${icon}</span>` : ''}${text}`;
  }

  clearTurn() {
    this.turnEl.innerHTML = '';
    this.turnEl.className = 'hud-turn';
  }

  notify(text, duration = 2500) {
    this.notifyEl.textContent = text;
    this.notifyEl.classList.add('show');
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = setTimeout(() => {
      this.notifyEl.classList.remove('show');
    }, duration);
  }

  showRoundResult(text) {
    this.resultEl.textContent = text;
    this.resultEl.classList.remove('hidden');
    this.resultEl.classList.add('show');
    setTimeout(() => {
      this.resultEl.classList.remove('show');
      setTimeout(() => this.resultEl.classList.add('hidden'), 500);
    }, 2800);
  }

  showMatchEnd(winnerName, scores, players, mySeat, onRematch, onLeave) {
    const scoreText = players.map(p => {
      const color = PLAYER_COLORS[p.seat];
      return `<span style="color:${color.hex}">${escapeHtml(p.name)}: ${scores[p.seat]}</span>`;
    }).join(' · ');

    this.resultEl.innerHTML = `
      <div class="match-end">
        <h2>${escapeHtml(winnerName)} wins the match!</h2>
        <p class="final-scores">${scoreText}</p>
        <div class="match-end-btns">
          <button id="btn-rematch" class="btn btn-primary">Rematch</button>
          <button id="btn-leave" class="btn btn-secondary">Leave</button>
        </div>
        <p id="rematch-status" class="rematch-status"></p>
      </div>
    `;
    this.resultEl.classList.remove('hidden');
    this.resultEl.classList.add('show');

    document.getElementById('btn-rematch').addEventListener('click', onRematch);
    document.getElementById('btn-leave').addEventListener('click', onLeave);
  }

  updateRematchStatus(votedNames, totalNeeded) {
    const el = document.getElementById('rematch-status');
    if (!el) return;
    if (votedNames.length === 0) {
      el.textContent = '';
    } else {
      el.textContent = `Rematch: ${votedNames.join(', ')} (${votedNames.length}/${totalNeeded})`;
    }
  }

  disableRematchButton() {
    const btn = document.getElementById('btn-rematch');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Voted ✓';
    }
  }

  hideResult() {
    this.resultEl.classList.remove('show');
    this.resultEl.classList.add('hidden');
  }

  destroy() {
    this.container.innerHTML = '';
  }
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
