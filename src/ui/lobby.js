import { PLAYER_COLORS, MAX_PLAYERS } from '../config.js';

/**
 * Lobby UI: room creation/joining, player seats, invite link.
 */
export class LobbyUI {
  constructor(container) {
    this.container = container;
    this.onCreateRoom = null;
    this.onJoinRoom = null;
    this.onStartGame = null;
  }

  showMenu() {
    this.container.innerHTML = `
      <div class="lobby-card">
        <h1 class="logo">PEN FIGHT</h1>
        <p class="subtitle">8-player desk battle</p>
        <div class="menu-section">
          <input type="text" id="player-name" placeholder="your name" maxlength="12" class="input-field" />
        </div>
        <div class="menu-buttons">
          <button id="btn-create" class="btn btn-primary">Create Room</button>
          <div class="divider">or</div>
          <div class="join-row">
            <input type="text" id="room-code" placeholder="room code" maxlength="5" class="input-field input-small" />
            <button id="btn-join" class="btn btn-secondary">Join</button>
          </div>
        </div>
      </div>
    `;

    // Load saved name
    const savedName = localStorage.getItem('pf8_name') || '';
    document.getElementById('player-name').value = savedName;

    document.getElementById('btn-create').addEventListener('click', () => {
      const name = this._getName();
      if (!name) return;
      if (this.onCreateRoom) this.onCreateRoom(name);
    });

    document.getElementById('btn-join').addEventListener('click', () => {
      const name = this._getName();
      if (!name) return;
      const code = document.getElementById('room-code').value.trim().toLowerCase();
      if (code.length < 3) {
        this._showError('Enter a room code');
        return;
      }
      if (this.onJoinRoom) this.onJoinRoom(code, name);
    });

    // Check URL for room code — auto-join if name is saved
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');
    if (roomFromUrl) {
      document.getElementById('room-code').value = roomFromUrl;
      // Auto-join if we have a saved name
      const savedNameForJoin = localStorage.getItem('pf8_name') || '';
      if (savedNameForJoin.length >= 2) {
        // Small delay to allow UI to render, then auto-join
        setTimeout(() => {
          document.getElementById('player-name').value = savedNameForJoin;
          document.getElementById('btn-join').click();
        }, 300);
      } else {
        // Show hint to enter name then join
        this._showError('Enter your name, then click Join');
      }
    }
  }

  _getName() {
    const name = document.getElementById('player-name').value
      .replace(/[^A-Za-z0-9 ._-]/g, '')
      .trim()
      .slice(0, 12);
    if (name.length < 2) {
      this._showError('Enter a name (at least 2 chars)');
      document.getElementById('player-name').focus();
      return null;
    }
    localStorage.setItem('pf8_name', name);
    return name;
  }

  _showError(msg) {
    let err = this.container.querySelector('.lobby-error');
    if (!err) {
      err = document.createElement('p');
      err.className = 'lobby-error';
      this.container.querySelector('.lobby-card').appendChild(err);
    }
    err.textContent = msg;
    setTimeout(() => { if (err) err.textContent = ''; }, 3000);
  }

  showConnecting(msg) {
    this.container.innerHTML = `
      <div class="lobby-card">
        <h1 class="logo">PEN FIGHT</h1>
        <p class="subtitle">${msg || 'connecting...'}</p>
        <div class="loader"></div>
        <p class="lobby-hint">this may take a few seconds</p>
      </div>
    `;
  }

  showLobby(roomCode, players, isHost, mySeat) {
    const seats = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const player = players.find(p => p.seat === i);
      const color = PLAYER_COLORS[i];
      const isMe = i === mySeat;

      if (player) {
        seats.push(`
          <li class="seat filled" style="--seat-color: ${color.hex}">
            <span class="seat-dot"></span>
            <span class="seat-name">${escapeHtml(player.name)}${isMe ? ' <b>(you)</b>' : ''}</span>
            <span class="seat-color">${color.label}</span>
          </li>
        `);
      } else {
        seats.push(`
          <li class="seat empty" style="--seat-color: ${color.hex}">
            <span class="seat-dot"></span>
            <span class="seat-name">empty</span>
            <span class="seat-color">${color.label}</span>
          </li>
        `);
      }
    }

    const inviteLink = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;

    this.container.innerHTML = `
      <div class="lobby-card">
        <h1 class="logo">PEN FIGHT</h1>
        <p class="eyebrow">ROOM: <b>${roomCode.toUpperCase()}</b></p>
        <h2>${players.length < 2 ? 'waiting for players...' : `${players.length} players ready`}</h2>
        <ol class="seat-list">${seats.join('')}</ol>
        <p class="lobby-hint">share the link or room code with friends</p>
        <button id="btn-copy" class="btn btn-secondary">Copy Invite Link</button>
        ${isHost && players.length >= 2 ? '<button id="btn-start" class="btn btn-primary">Start Game</button>' : ''}
        ${!isHost ? '<p class="lobby-hint">waiting for host to start...</p>' : ''}
        ${isHost && players.length < 2 ? '<p class="lobby-hint">need at least 2 players to start</p>' : ''}
      </div>
    `;

    document.getElementById('btn-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(inviteLink);
        document.getElementById('btn-copy').textContent = 'Copied!';
        setTimeout(() => {
          const btn = document.getElementById('btn-copy');
          if (btn) btn.textContent = 'Copy Invite Link';
        }, 2000);
      } catch {
        // Fallback
        const input = document.createElement('input');
        input.value = inviteLink;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
        document.getElementById('btn-copy').textContent = 'Copied!';
      }
    });

    const startBtn = document.getElementById('btn-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        if (this.onStartGame) this.onStartGame();
      });
    }
  }

  showError(msg) {
    this.container.innerHTML = `
      <div class="lobby-card">
        <h1 class="logo">PEN FIGHT</h1>
        <p class="lobby-error">${escapeHtml(msg)}</p>
        <button class="btn btn-primary" onclick="location.reload()">Try Again</button>
      </div>
    `;
  }

  hide() {
    this.container.innerHTML = '';
    this.container.style.display = 'none';
  }

  show() {
    this.container.style.display = 'flex';
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
