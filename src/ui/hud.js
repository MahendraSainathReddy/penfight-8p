import { PLAYER_COLORS } from '../config.js';

const REACTION_EMOJIS = ['😂', '🔥', '💀', '👏', '😤', '😭'];

/**
 * In-game HUD: scoreboard, turn indicator, results, notifications, reactions.
 */
export class HUD {
  constructor(container, onReaction, onLeave) {
    this.container = container;
    this.onReaction = onReaction; // callback when user sends a reaction
    this.onLeave = onLeave; // callback when user wants to leave
    this.container.innerHTML = `
      <div id="hud-scoreboard" class="hud-scoreboard"></div>
      <div id="hud-reactions" class="hud-reactions"></div>
      <div id="hud-turn" class="hud-turn"></div>
      <div id="hud-notify" class="hud-notify"></div>
      <div id="hud-result" class="hud-result hidden"></div>
      <button id="hud-leave" class="hud-leave-btn" title="Leave game">&#x2715;</button>
      <button id="hud-landscape" class="hud-landscape-btn" title="Fullscreen">&#x26F6;</button>
      <div id="hud-reaction-toast" class="hud-reaction-toast"></div>
    `;
    this.scoreboard = document.getElementById('hud-scoreboard');
    this.turnEl = document.getElementById('hud-turn');
    this.notifyEl = document.getElementById('hud-notify');
    this.resultEl = document.getElementById('hud-result');
    this.reactionsEl = document.getElementById('hud-reactions');
    this.reactionToastEl = document.getElementById('hud-reaction-toast');
    this.notifyTimer = null;

    this._setupLandscapeButton();
    this._setupLeaveButton();
    this._setupReactions();
  }

  _setupLeaveButton() {
    const btn = document.getElementById('hud-leave');
    btn.addEventListener('click', () => {
      if (confirm('Leave the game?')) {
        if (this.onLeave) this.onLeave();
      }
    });
  }

  _setupLandscapeButton() {
    const btn = document.getElementById('hud-landscape');
    btn.addEventListener('click', async () => {
      try {
        if (screen.orientation && screen.orientation.lock) {
          const isLandscape = screen.orientation.type.includes('landscape');
          if (isLandscape) {
            await screen.orientation.unlock();
            if (document.fullscreenElement) await document.exitFullscreen();
          } else {
            await document.documentElement.requestFullscreen();
            await screen.orientation.lock('landscape');
          }
        } else {
          if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
          } else {
            await document.exitFullscreen();
          }
        }
      } catch (e) {
        try {
          if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
          } else {
            await document.exitFullscreen();
          }
        } catch (e2) { /* not supported */ }
      }
    });
  }

  _setupReactions() {
    const html = REACTION_EMOJIS.map(emoji =>
      `<button class="reaction-btn" data-emoji="${emoji}">${emoji}</button>`
    ).join('');
    this.reactionsEl.innerHTML = html;

    this.reactionsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.reaction-btn');
      if (!btn) return;
      const emoji = btn.dataset.emoji;
      if (this.onReaction) this.onReaction(emoji);
      // Brief visual feedback
      btn.classList.add('sent');
      setTimeout(() => btn.classList.remove('sent'), 400);
    });
  }

  showReaction(playerName, emoji, color) {
    const toast = document.createElement('div');
    toast.className = 'reaction-toast-item';
    toast.innerHTML = `<span style="color:${color}">${escapeHtml(playerName)}</span> ${emoji}`;
    this.reactionToastEl.appendChild(toast);
    // Animate in then remove
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  updateScoreboard(players, scores, outs, mySeat) {
    const items = players.map((p) => {
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

  setSpectatorBadge(isSpectator, spectatorCount) {
    if (isSpectator) {
      this.turnEl.className = 'hud-turn';
      this.turnEl.innerHTML = '<span class="turn-icon">👁</span> Spectating';
    }
    // Show spectator count below scoreboard if there are spectators
    let badge = document.getElementById('hud-spectator-count');
    if (spectatorCount > 0) {
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'hud-spectator-count';
        badge.className = 'hud-spectator-count';
        this.scoreboard.parentElement.appendChild(badge);
      }
      badge.textContent = `👁 ${spectatorCount} watching`;
    } else if (badge) {
      badge.remove();
    }
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
    }).join(' &middot; ');

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
      btn.textContent = 'Voted \u2713';
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
