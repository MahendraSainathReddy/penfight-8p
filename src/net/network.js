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
    this.onPass = null;
    this.onNextRound = null;
    this.onPlayerLeft = null;
    this.onError = null;
    this.onConnected = null;
    this.onDisconnected = null;

    this.players = [];
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
        this._handleDisconnect(conn.peer);
      });

      conn.on('error', () => {
        this._handleDisconnect(conn.peer);
      });
    });
  }

  _setupGuestListeners(conn) {
    conn.on('data', (msg) => {
      this._handleGuestMessage(msg);
    });

    conn.on('close', () => {
      if (this.onDisconnected) this.onDisconnected();
    });

    conn.on('error', () => {
      if (this.onError) this.onError('Connection to host lost');
    });
  }

  _handleHostMessage(conn, msg) {
    switch (msg.type) {
      case 'join': {
        if (this.players.length >= 8) {
          this._send(conn, { type: 'full' });
          return;
        }
        // Check if already in (reconnect)
        const existing = this.players.find(p => p.peerId === msg.peerId);
        if (existing) {
          existing.connected = true;
          this.connections.set(msg.peerId, conn);
          this._send(conn, {
            type: 'welcome',
            seat: existing.seat,
            players: this.players,
            roomCode: this.roomCode,
          });
          this._broadcastRoster();
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
        if (this._joinResolve) {
          this._joinResolve(this.roomCode);
          this._joinResolve = null;
        }
        if (this.onConnected) this.onConnected();
        if (this.onRosterUpdate) this.onRosterUpdate(this.players);
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

      case 'settled':
        if (this.onSettled) this.onSettled(msg);
        break;

      case 'sync':
        if (this.onSync) this.onSync(msg);
        break;

      case 'pass':
        if (this.onPass) this.onPass(msg);
        break;

      case 'next_round':
        if (this.onNextRound) this.onNextRound(msg);
        break;

      case 'player_left':
        if (this.onPlayerLeft) this.onPlayerLeft(msg.seat);
        this.players = msg.players;
        if (this.onRosterUpdate) this.onRosterUpdate(this.players);
        break;

      case 'full':
        if (this.onError) this.onError('Room is full (8 players max)');
        break;
    }
  }

  _handleDisconnect(peerId) {
    const player = this.players.find(p => p.peerId === peerId);
    if (!player) return;

    player.connected = false;
    this.connections.delete(peerId);

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
    const msg = { type: 'sync', state, pens };
    this._broadcast(msg);
  }

  getInviteLink() {
    return `${window.location.origin}${window.location.pathname}?room=${this.roomCode}`;
  }

  destroy() {
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
}
