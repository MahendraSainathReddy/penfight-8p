import Peer from 'peerjs';

/**
 * PeerJS-based P2P multiplayer networking.
 * Host creates a room (PeerJS ID = room code prefix + code).
 * Guests connect to the host's peer ID.
 * Host acts as relay + authority for state.
 * 
 * Message types:
 *  - join: guest requesting to join
 *  - welcome: host confirming join with seat assignment
 *  - roster: host broadcasting updated player list
 *  - start: host starting the game
 *  - shot: player flicked their pen
 *  - settled: host reporting physics settle result
 *  - sync: full state sync from host
 *  - pass: turn timeout
 *  - leave: player left
 *  - next_round: host advancing to next round
 */

const ROOM_PREFIX = 'penfight8-';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

export class NetworkManager {
  constructor() {
    this.peer = null;
    this.connections = new Map(); // peerId -> DataConnection
    this.isHost = false;
    this.roomCode = '';
    this.myPeerId = '';
    this.mySeat = -1;
    this.myName = '';
    this.hostConnection = null; // guest's connection to host

    // Callbacks
    this.onRosterUpdate = null;
    this.onGameStart = null;
    this.onShot = null;
    this.onSettled = null;
    this.onSync = null;
    this.onNextRound = null;
    this.onPlayerLeft = null;
    this.onRematchVote = null;
    this.onSyncRequest = null;
    this.onReaction = null;
    this.onSpectateStart = null;
    this.onSpectatorUpdate = null;
    this.onGameRejoin = null;
    this.onError = null;
    this.onConnected = null;
    this.onDisconnected = null;

    this.players = [];
    this.spectators = []; // { name, peerId, conn }
    this.gameStarted = false;
  }

  generateRoomCode() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  _getHostPeerId(code) {
    return ROOM_PREFIX + code;
  }

  async createRoom(playerName) {
    this.isHost = true;
    this.roomCode = this.generateRoomCode();
    this.myName = playerName;

    return new Promise((resolve, reject) => {
      const peerId = this._getHostPeerId(this.roomCode);

      this.peer = new Peer(peerId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
          ]
        }
      });

      const timeout = setTimeout(() => {
        reject(new Error('Connection timed out. Try again.'));
        this.peer.destroy();
      }, 15000);

      this.peer.on('open', (id) => {
        clearTimeout(timeout);
        this.myPeerId = id;
        this.mySeat = 0;
        this.players = [{
          seat: 0,
          name: playerName,
          peerId: id,
          connected: true,
        }];
        this._setupHostListeners();
        this._startKeepAlive();
        resolve(this.roomCode);
      });

      this.peer.on('error', (err) => {
        clearTimeout(timeout);
        console.error('Host peer error:', err.type, err.message);
        if (err.type === 'unavailable-id') {
          // Room code collision — generate a new one and retry
          this.roomCode = this.generateRoomCode();
          this.peer.destroy();
          this.createRoom(playerName).then(resolve).catch(reject);
        } else {
          reject(new Error(`Failed to create room: ${err.type}. Check your connection.`));
        }
      });

      this.peer.on('disconnected', () => {
        // Try to reconnect
        if (!this.peer.destroyed) {
          this.peer.reconnect();
        }
      });
    });
  }

  async joinRoom(roomCode, playerName) {
    this.isHost = false;
    this.roomCode = roomCode.toLowerCase().trim();
    this.myName = playerName;

    return this._attemptJoin(0);
  }

  async _attemptJoin(attempt) {
    return new Promise((resolve, reject) => {
      // Create our peer with a random ID
      this.peer = new Peer(undefined, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
          ]
        }
      });

      const timeout = setTimeout(() => {
        if (this.mySeat === -1) {
          this.peer.destroy();
          if (attempt < MAX_RETRIES) {
            setTimeout(() => {
              this._attemptJoin(attempt + 1).then(resolve).catch(reject);
            }, RETRY_DELAY);
          } else {
            reject(new Error('Could not reach the room. Make sure the host is online and the code is correct.'));
          }
        }
      }, 10000);

      this.peer.on('open', (id) => {
        this.myPeerId = id;
        const hostPeerId = this._getHostPeerId(this.roomCode);

        const conn = this.peer.connect(hostPeerId, {
          reliable: true,
          serialization: 'json',
        });

        conn.on('open', () => {
          this.hostConnection = conn;
          this._send(conn, { type: 'join', name: this.myName, peerId: id });
          this._setupGuestListeners(conn);
        });

        conn.on('error', (err) => {
          clearTimeout(timeout);
          console.error('Connection error:', err);
          if (attempt < MAX_RETRIES) {
            this.peer.destroy();
            setTimeout(() => {
              this._attemptJoin(attempt + 1).then(resolve).catch(reject);
            }, RETRY_DELAY);
          } else {
            reject(new Error('Could not connect to room. The host may have left.'));
          }
        });
      });

      this.peer.on('error', (err) => {
        clearTimeout(timeout);
        console.error('Guest peer error:', err.type, err.message);

        if (err.type === 'peer-unavailable') {
          // Host not found — retry
          this.peer.destroy();
          if (attempt < MAX_RETRIES) {
            setTimeout(() => {
              this._attemptJoin(attempt + 1).then(resolve).catch(reject);
            }, RETRY_DELAY);
          } else {
            reject(new Error('Room not found. Check the code or ask the host to recreate.'));
          }
        } else if (err.type === 'network' || err.type === 'server-error') {
          this.peer.destroy();
          if (attempt < MAX_RETRIES) {
            setTimeout(() => {
              this._attemptJoin(attempt + 1).then(resolve).catch(reject);
            }, RETRY_DELAY);
          } else {
            reject(new Error(`Network error: ${err.type}. Try again.`));
          }
        } else {
          reject(new Error(`Connection error: ${err.type}`));
        }
      });

      // Resolve when we get our seat assignment
      this._joinResolve = (code) => {
        clearTimeout(timeout);
        resolve(code);
      };
    });
  }

  _setupHostListeners() {
    this.peer.on('connection', (conn) => {
      conn.on('open', () => {
        // Connection open, wait for join message
      });

      conn.on('data', (msg) => {
        this._handleHostMessage(conn, msg);
      });

      conn.on('close', () => {
        // Brief delay to allow reconnects, then mark as disconnected
        setTimeout(() => {
          // Check if they reconnected with a new connection
          const currentConn = this.connections.get(conn.peer);
          if (currentConn === conn || !currentConn) {
            this._handleDisconnect(conn.peer);
          }
        }, 3000);
      });

      conn.on('error', () => {
        // Don't immediately disconnect — wait for close event
      });
    });
  }

  _setupGuestListeners(conn) {
    conn.on('data', (msg) => {
      this._handleGuestMessage(msg);
    });

    conn.on('close', () => {
      // Connection closed — try to reconnect before declaring lost
      console.warn('Connection to host closed, will attempt reconnect...');
      setTimeout(() => {
        if (this.peer && !this.peer.destroyed && this.roomCode) {
          const hostPeerId = this._getHostPeerId(this.roomCode);
          const newConn = this.peer.connect(hostPeerId, { reliable: true, serialization: 'json' });
          newConn.on('open', () => {
            this.hostConnection = newConn;
            this._setupGuestListeners(newConn);
            this._send(newConn, { type: 'join', name: this.myName, peerId: this.myPeerId });
          });
          newConn.on('error', () => {
            if (this.onDisconnected) this.onDisconnected();
            if (this.onError) this.onError('Lost connection to host');
          });
        } else {
          if (this.onDisconnected) this.onDisconnected();
        }
      }, 2000);
    });

    conn.on('error', (err) => {
      console.warn('Guest connection error:', err);
      // Don't immediately declare disconnected — the close handler will attempt reconnect
    });
  }

  _handleHostMessage(conn, msg) {
    switch (msg.type) {
      case 'join': {
        // Check if already in (reconnect or duplicate) — MUST be checked before gameStarted
        // so disconnected players can rejoin active games
        const existing = this.players.find(p => p.peerId === msg.peerId);
        if (existing) {
          existing.connected = true;
          this.connections.set(msg.peerId, conn);
          if (this._lastPong) this._lastPong.set(msg.peerId, Date.now());
          this._send(conn, {
            type: 'welcome',
            seat: existing.seat,
            players: this.players,
            roomCode: this.roomCode,
            gameActive: this.gameStarted,
          });
          this._broadcastRoster();
          // If game is active, send them current state so they resync
          if (this.gameStarted && this.onSyncRequest) {
            this.onSyncRequest(existing.seat);
          }
          return;
        }

        // Check if same name exists (reconnect from same browser with new peerId)
        const sameName = this.players.find(p => p.name === msg.name);
        if (sameName) {
          sameName.peerId = msg.peerId;
          sameName.connected = true;
          this.connections.set(msg.peerId, conn);
          if (this._lastPong) this._lastPong.set(msg.peerId, Date.now());
          this._send(conn, {
            type: 'welcome',
            seat: sameName.seat,
            players: this.players,
            roomCode: this.roomCode,
            gameActive: this.gameStarted,
          });
          this._broadcastRoster();
          if (this.gameStarted && this.onSyncRequest) {
            this.onSyncRequest(sameName.seat);
          }
          return;
        }

        // New player — reject if game already started or room full
        if (this.gameStarted) {
          // Check if they want to spectate
          if (msg.spectator) {
            // Accept as spectator
            const spec = { name: msg.name, peerId: msg.peerId };
            this.spectators.push(spec);
            this.connections.set(msg.peerId, conn);
            if (this._lastPong) this._lastPong.set(msg.peerId, Date.now());
            this._send(conn, {
              type: 'spectate_welcome',
              players: this.players,
              spectatorCount: this.spectators.length,
              roomCode: this.roomCode,
            });
            // Send them current game state so they can render the board
            if (this.onSyncRequest) this.onSyncRequest(-1); // -1 signals "send to all"
            // Notify players that a spectator joined
            const specNames = this.spectators.map(s => s.name);
            const specMsg = { type: 'spectator_update', count: this.spectators.length, names: specNames };
            this._broadcast(specMsg);
            // Also notify the host itself
            if (this.onSpectatorUpdate) this.onSpectatorUpdate(specMsg);
            return;
          }
          this._send(conn, { type: 'game_in_progress' });
          return;
        }
        if (this.players.length >= 8) {
          this._send(conn, { type: 'full' });
          return;
        }

        const seat = this.players.length;
        const player = {
          seat,
          name: msg.name,
          peerId: msg.peerId,
          connected: true,
        };
        this.players.push(player);
        this.connections.set(msg.peerId, conn);
        if (this._lastPong) this._lastPong.set(msg.peerId, Date.now());

        // Send welcome to joiner
        this._send(conn, {
          type: 'welcome',
          seat,
          players: this.players,
          roomCode: this.roomCode,
        });

        // Broadcast updated roster to all
        this._broadcastRoster();
        break;
      }

      case 'shot': {
        // Relay to all other players
        this._broadcast(msg, conn.peer);
        if (this.onShot) this.onShot(msg);
        break;
      }

      case 'rematch_vote': {
        // Relay to all other players
        this._broadcast(msg, conn.peer);
        if (this.onRematchVote) this.onRematchVote(msg);
        break;
      }

      case 'pong': {
        // Client is alive — record last seen time
        if (this._lastPong) {
          this._lastPong.set(conn.peer, Date.now());
        }
        break;
      }

      case 'request_sync': {
        // Client came back from background and needs current state
        if (this.onSyncRequest) this.onSyncRequest(msg.seat);
        break;
      }

      case 'reaction': {
        // Relay reaction to all other players
        this._broadcast(msg, conn.peer);
        if (this.onReaction) this.onReaction(msg);
        break;
      }

      case 'leave': {
        this._handleDisconnect(conn.peer);
        break;
      }

      default:
        // Relay any other message to all
        this._broadcast(msg, conn.peer);
        break;
    }
  }

  _handleGuestMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        this.mySeat = msg.seat;
        this.players = msg.players;
        this.gameActive = msg.gameActive || false;
        if (this._joinResolve) {
          this._joinResolve(this.roomCode);
          this._joinResolve = null;
        }
        this._startKeepAlive();
        if (this.onConnected) this.onConnected();
        if (this.onRosterUpdate) this.onRosterUpdate(this.players);
        // If game is already active, trigger game start for this rejoining player
        if (this.gameActive && this.onGameRejoin) {
          this.onGameRejoin();
        }
        break;

      case 'roster':
        this.players = msg.players;
        if (this.onRosterUpdate) this.onRosterUpdate(this.players);
        break;

      case 'start':
        if (this.onGameStart) this.onGameStart(msg.state);
        break;

      case 'shot':
        if (this.onShot) this.onShot(msg);
        break;

      case 'ping':
        // Host sent a ping — respond with pong to keep connection alive
        if (this.hostConnection) {
          this._send(this.hostConnection, { type: 'pong', seat: this.mySeat, t: Date.now() });
        }
        break;

      case 'reaction':
        if (this.onReaction) this.onReaction(msg);
        break;

      case 'rematch_vote':
        if (this.onRematchVote) this.onRematchVote(msg);
        break;

      case 'settled':
        if (this.onSettled) this.onSettled(msg);
        break;

      case 'sync':
        if (this.onSync) this.onSync(msg);
        break;

      case 'next_round':
        if (this.onNextRound) this.onNextRound(msg);
        break;

      case 'player_left':
        if (this.onPlayerLeft) this.onPlayerLeft(msg.seat);
        this.players = msg.players;
        if (this.onRosterUpdate) this.onRosterUpdate(this.players);
        break;

      case 'spectate_welcome':
        this.mySeat = -1; // spectator has no seat
        this.players = msg.players;
        if (this._joinResolve) {
          this._joinResolve(this.roomCode);
          this._joinResolve = null;
        }
        this._startKeepAlive();
        if (this.onSpectateStart) this.onSpectateStart(msg);
        break;

      case 'spectator_update':
        // Show spectator info
        if (this.onSpectatorUpdate) this.onSpectatorUpdate(msg);
        break;

      case 'full':
        if (this.onError) this.onError('Room is full (8 players max)');
        break;

      case 'game_in_progress':
        if (this.onError) this.onError('Game already started. Wait for the next match.');
        break;
    }
  }

  _handleDisconnect(peerId) {
    const player = this.players.find(p => p.peerId === peerId);
    if (!player) return;
    if (!player.connected) return; // Already disconnected — don't fire twice

    player.connected = false;
    this.connections.delete(peerId);
    if (this._lastPong) this._lastPong.delete(peerId);

    if (this.isHost) {
      this._broadcast({ type: 'player_left', seat: player.seat, players: this.players });
      if (this.onPlayerLeft) this.onPlayerLeft(player.seat);
      if (this.onRosterUpdate) this.onRosterUpdate(this.players);
    }
  }

  _broadcastRoster() {
    this._broadcast({ type: 'roster', players: this.players });
    if (this.onRosterUpdate) this.onRosterUpdate(this.players);
  }

  _broadcast(msg, excludePeerId = null) {
    for (const [peerId, conn] of this.connections) {
      if (peerId !== excludePeerId && conn.open) {
        this._send(conn, msg);
      }
    }
  }

  _send(conn, msg) {
    try {
      if (conn && conn.open) {
        conn.send(msg);
      }
    } catch (e) {
      console.warn('Send failed:', e);
    }
  }

  // Public: send message (guest sends to host, host broadcasts)
  send(msg) {
    if (this.isHost) {
      this._broadcast(msg);
    } else if (this.hostConnection) {
      this._send(this.hostConnection, msg);
    }
  }

  // Host: start the game
  startGame(state) {
    if (!this.isHost) return;
    this.gameStarted = true;
    const msg = { type: 'start', state };
    this._broadcast(msg);
    if (this.onGameStart) this.onGameStart(state);
  }

  // Host: send settle result
  sendSettle(data) {
    if (!this.isHost) return;
    const msg = { type: 'settled', ...data };
    this._broadcast(msg);
  }

  // Host: advance round
  sendNextRound(data) {
    if (!this.isHost) return;
    const msg = { type: 'next_round', ...data };
    this._broadcast(msg);
  }

  // Any: send shot
  sendShot(data) {
    const msg = { type: 'shot', ...data };
    this.send(msg);
    if (this.isHost && this.onShot) this.onShot(msg);
  }

  // Sync full state
  sendSync(state, pens) {
    if (!this.isHost) return;
    const msg = { type: 'sync', state, pens, players: this.players };
    this._broadcast(msg);
  }

  // Join as spectator (guest-only)
  async joinAsSpectator(roomCode, name) {
    this.isHost = false;
    this.roomCode = roomCode.toLowerCase().trim();
    this.myName = name;
    this.isSpectator = true;

    return new Promise((resolve, reject) => {
      this.peer = new Peer(undefined, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
          ]
        }
      });

      const timeout = setTimeout(() => {
        this.peer.destroy();
        reject(new Error('Could not connect to room for spectating.'));
      }, 10000);

      this.peer.on('open', (id) => {
        this.myPeerId = id;
        const hostPeerId = this._getHostPeerId(this.roomCode);
        const conn = this.peer.connect(hostPeerId, { reliable: true, serialization: 'json' });

        conn.on('open', () => {
          this.hostConnection = conn;
          this._send(conn, { type: 'join', name, peerId: id, spectator: true });
          this._setupGuestListeners(conn);
        });

        conn.on('error', () => {
          clearTimeout(timeout);
          reject(new Error('Could not connect to room.'));
        });
      });

      this.peer.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Connection error: ${err.type}`));
      });

      this._joinResolve = () => {
        clearTimeout(timeout);
        resolve(this.roomCode);
      };
    });
  }

  getInviteLink() {
    return `${window.location.origin}${window.location.pathname}?room=${this.roomCode}`;
  }

  destroy() {
    this._stopKeepAlive();
    if (this.hostConnection) {
      this._send(this.hostConnection, { type: 'leave', seat: this.mySeat });
      this.hostConnection.close();
    }
    for (const conn of this.connections.values()) {
      conn.close();
    }
    if (this.peer) {
      this.peer.destroy();
    }
  }

  // Keepalive: host pings all clients every 8s, clients respond with pong.
  // Host force-disconnects clients that haven't responded in 20s.
  _startKeepAlive() {
    this._lastPong = new Map(); // peerId -> timestamp

    this._keepAliveInterval = setInterval(() => {
      if (this.isHost) {
        // Host pings all clients
        this._broadcast({ type: 'ping', t: Date.now() });

        // Check for dead connections (no pong in 20s)
        const now = Date.now();
        for (const [peerId, conn] of this.connections) {
          const lastSeen = this._lastPong.get(peerId) || now;
          if (now - lastSeen > 20000) {
            // Player hasn't responded — force disconnect
            console.warn('Force disconnecting unresponsive player:', peerId);
            this._lastPong.delete(peerId);
            this._handleDisconnect(peerId);
          }
        }
      } else if (this.hostConnection) {
        // Guest sends pong to host
        this._send(this.hostConnection, { type: 'pong', seat: this.mySeat, t: Date.now() });
      }
    }, 8000);

    // Handle page visibility changes (orientation change, tab switch, etc.)
    // Prevent false disconnects when the page is briefly hidden
    this._visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        // Page came back — send an immediate keepalive to show we're still here
        if (this.isHost) {
          this._broadcast({ type: 'ping', t: Date.now() });
        } else if (this.hostConnection && this.hostConnection.open) {
          this._send(this.hostConnection, { type: 'pong', seat: this.mySeat, t: Date.now() });
        }
        // Reconnect peer to signaling server if disconnected
        if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
          this.peer.reconnect();
        }
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  _stopKeepAlive() {
    if (this._keepAliveInterval) {
      clearInterval(this._keepAliveInterval);
      this._keepAliveInterval = null;
    }
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }
}
