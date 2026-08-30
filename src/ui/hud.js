import { PLAYER_COLORS } from '../config.js';

const REACTION_EMOJIS = ['😂', '🔥', '💀', '👏', '😤', '😭'];

// Fun & evil preset taunts friends use
const TAUNT_MESSAGES = [
  'Too easy! 😎',
  'Get rekt! 💥',
  'Say bye bye 👋',
  'Nice try loser 😏',
  'Is that all? 🥱',
  'You\'re done! 🔪',
  'Cry about it 😢',
  'Skill issue 🤓',
  'Watch this! 🎯',
  'Boom! 💣',
  'GG EZ 🏆',
  'Sit down 💺',
];

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
      <div id="hud-timers" class="hud-timers"></div>
      <div id="hud-reactions" class="hud-reactions"></div>
      <button id="hud-taunt-btn" class="reaction-btn hud-taunt-btn" title="Taunt">&#x1F4AC;</button>
      <div id="hud-taunt-panel" class="hud-taunt-panel hidden"></div>
      <div id="hud-turn" class="hud-turn"></div>
      <div id="hud-notify" class="hud-notify"></div>
      <div id="hud-result" class="hud-result hidden"></div>
      <button id="hud-leave" class="hud-leave-btn" title="Leave game">&#x2715;</button>
      <button id="hud-landscape" class="hud-landscape-btn" title="Fullscreen">&#x26F6;</button>
      <div id="hud-reaction-toast" class="hud-reaction-toast"></div>
    `;
    this.scoreboard = document.getElementById('hud-scoreboard');
    this.timersEl = document.getElementById('hud-timers');
    this.turnEl = document.getElementById('hud-turn');
    this.notifyEl = document.getElementById('hud-notify');
    this.resultEl = document.getElementById('hud-result');
    this.reactionsEl = document.getElementById('hud-reactions');
    this.reactionToastEl = document.getElementById('hud-reaction-toast');
    this.notifyTimer = null;

    this._setupLandscapeButton();
    this._setupLeaveButton();
    this._setupReactions();
    this._setupTaunts();
  }

  _setupTaunts() {
    const btn = document.getElementById('hud-taunt-btn');
    const panel = document.getElementById('hud-taunt-panel');
    if (!btn || !panel) return;

    // Build the taunt list
    panel.innerHTML = TAUNT_MESSAGES.map(msg =>
      `<button class="taunt-item" data-msg="${escapeHtml(msg)}">${escapeHtml(msg)}</button>`
    ).join('');

    // Toggle panel on button click
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('hidden');
    });

    // Send taunt on item click
    panel.addEventListener('click', (e) => {
      const item = e.target.closest('.taunt-item');
      if (!item) return;
      const msg = item.dataset.msg;
      if (this.onReaction) this.onReaction(msg, true); // true = isTaunt
      panel.classList.add('hidden');
    });

    // Close panel when clicking elsewhere
    document.addEventListener('click', () => {
      panel.classList.add('hidden');
    });
  }

  updateTimers(turnSeconds, shrinkSeconds) {
    if (!this.timersEl) return;
    let html = '';
    if (turnSeconds !== null && turnSeconds !== undefined) {
      const urgent = turnSeconds <= 5 ? ' urgent' : '';
      html += `<div class="timer-row${urgent}">⏱ Turn: ${turnSeconds}s</div>`;
    }
    if (shrinkSeconds !== null && shrinkSeconds !== undefined) {
      html += `<div class="timer-row shrink">▣ Shrink: ${shrinkSeconds}s</div>`;
    }
    this.timersEl.innerHTML = html;
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
      const el = document.documentElement;
      const requestFS = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      const exitFS = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      const isFS = document.fullscreenElement || document.webkitFullscreenElement;

      try {
        if (isFS) {
          if (exitFS) await exitFS.call(document);
          if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
          }
        } else {
          if (requestFS) {
            await requestFS.call(el);
            if (screen.orientation && screen.orientation.lock) {
              try { await screen.orientation.lock('landscape'); } catch (e) { /* not supported */ }
            }
          } else {
            // No fullscreen API (iPhone) — inform user
            if (this.notifyEl) {
              this.notifyEl.textContent = 'Rotate your phone to landscape';
              this.notifyEl.classList.add('show');
              setTimeout(() => this.notifyEl.classList.remove('show'), 2000);
            }
          }
        }
      } catch (e) {
        try {
          if (requestFS && !isFS) await requestFS.call(el);
        } catch (e2) { /* give up */ }
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

  showReaction(playerName, content, color, isTaunt = false) {
    // Limit toast count to prevent DOM accumulation
    while (this.reactionToastEl.children.length >= 5) {
      this.reactionToastEl.firstChild.remove();
    }
    const toast = document.createElement('div');
    toast.className = isTaunt ? 'reaction-toast-item taunt' : 'reaction-toast-item';
    if (isTaunt) {
      toast.innerHTML = `<span style="color:${color}">${escapeHtml(playerName)}:</span> ${escapeHtml(content)}`;
    } else {
      toast.innerHTML = `<span style="color:${color}">${escapeHtml(playerName)}</span> ${content}`;
    }
    this.reactionToastEl.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
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

  setSpectatorBadge(isSpectator, spectatorCount, spectatorNames) {
    if (isSpectator) {
      this.turnEl.className = 'hud-turn';
      this.turnEl.innerHTML = '<span class="turn-icon">👁</span> Spectating';
    }
    // Show spectator info for everyone
    let badge = document.getElementById('hud-spectator-count');
    if (spectatorCount > 0 || (spectatorNames && spectatorNames.length > 0)) {
      const count = spectatorCount || (spectatorNames ? spectatorNames.length : 0);
      const names = spectatorNames ? spectatorNames.join(', ') : '';
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'hud-spectator-count';
        badge.className = 'hud-spectator-count';
        this.scoreboard.parentElement.appendChild(badge);
      }
      badge.textContent = names ? `👁 ${names}` : `👁 ${count} watching`;
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

  showHostLeft(onLeave) {
    this.resultEl.innerHTML = `
      <div class="match-end">
        <h2>Host left the game</h2>
        <p class="final-scores">The room is closed. Start a new game to keep playing!</p>
        <div class="match-end-btns">
          <button id="btn-newgame" class="btn btn-primary">New Game</button>
          <button id="btn-leave" class="btn btn-secondary">Leave</button>
        </div>
      </div>
    `;
    this.resultEl.classList.remove('hidden');
    this.resultEl.classList.add('show');

    const newGameBtn = document.getElementById('btn-newgame');
    if (newGameBtn) newGameBtn.addEventListener('click', () => {
      window.location.href = window.location.pathname;
    });
    const leaveBtn = document.getElementById('btn-leave');
    if (leaveBtn) leaveBtn.addEventListener('click', onLeave);
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
