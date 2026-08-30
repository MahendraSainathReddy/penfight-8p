import { initPhysics, createWorld, createDesk, createWalls, createPen, getPenState, setPenState, isPenOnDesk, isPenSettled, setDeskScale } from './physics/world.js';
import { createScene, createCamera, createRenderer, createDeskMesh, createPenMesh, syncPenMesh, createAimLine, updateAimLine, addPenLabel } from './render/scene.js';
import { FlickInput } from './input/flick.js';
import { GameState } from './game/state.js';
import { NetworkManager } from './net/network.js';
import { LobbyUI } from './ui/lobby.js';
import { HUD } from './ui/hud.js';
import { PLAYER_COLORS, MAX_PLAYERS, SIM, SETTLE, INPUT, TURN, DESK, SHRINK, getDeskScale, getPenStartPosition } from './config.js';
import { unlockAudio, playFlick, playCollision, playPenOut, playRoundWin, playMatchWin, playTurnNotify } from './audio/sfx.js';

class PenFightGame {
  constructor() {
    this.network = new NetworkManager();
    this.lobbyUI = new LobbyUI(document.getElementById('lobby'));
    this.hud = null;
    this.gameState = null;

    // Three.js
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.aimLine = null;

    // Physics
    this.world = null;
    this.penBodies = [];
    this.penMeshes = [];

    // Game loop
    this.animFrame = null;
    this.lastTime = 0;
    this.accumulator = 0;
    this.settleFrames = 0;

    // State
    this.mySeat = -1;
    this.players = [];
    this.playing = false;
    this.turnStartTime = 0;
    this.turnWarned = false;
  }

  async init() {
    // Init physics WASM
    await initPhysics();

    // Unlock audio on first interaction
    unlockAudio();

    // Show lobby menu
    this.lobbyUI.showMenu();
    this._setupLobbyCallbacks();
    this._setupNetworkCallbacks();
  }

  _setupLobbyCallbacks() {
    this.lobbyUI.onCreateRoom = async (name) => {
      this.lobbyUI.showConnecting('creating room...');
      try {
        const code = await this.network.createRoom(name);
        localStorage.setItem('pf8_active_room', code);
        // Update URL so host can reload and rejoin
        window.history.replaceState(null, '', `${window.location.pathname}?room=${code}`);
        this.mySeat = 0;
        this.players = this.network.players;
        this.lobbyUI.showLobby(code, this.players, true, this.mySeat);
      } catch (err) {
        this.lobbyUI.showError(err.message);
      }
    };

    this.lobbyUI.onJoinRoom = async (code, name) => {
      this.lobbyUI.showConnecting('joining room...');

      // Timeout: if still joining after 12s, show error
      const joinTimeout = setTimeout(() => {
        if (!this.playing && this.mySeat === -1) {
          this.lobbyUI.showError('Could not reach the room. The host may have left or the code is wrong.');
        }
      }, 12000);

      try {
        await this.network.joinRoom(code, name);
        clearTimeout(joinTimeout);
        this.mySeat = this.network.mySeat;
        this.players = this.network.players;
        this.lobbyUI.showLobby(code, this.players, false, this.mySeat);
      } catch (err) {
        clearTimeout(joinTimeout);
        localStorage.removeItem('pf8_active_room');
        this.lobbyUI.showError(err.message);
      }
    };

    this.lobbyUI.onStartGame = () => {
      this._hostStartGame();
    };

    this.lobbyUI.onSpectate = async (code, name) => {
      try {
        await this.network.joinAsSpectator(code, name);
        // spectate_welcome will trigger onSpectateStart
      } catch (err) {
        this.lobbyUI.showError(err.message);
      }
    };
  }

  _setupNetworkCallbacks() {
    this.network.onRosterUpdate = (players) => {
      this.players = players;
      if (!this.playing) {
        this.lobbyUI.showLobby(
          this.network.roomCode,
          this.players,
          this.network.isHost,
          this.mySeat
        );
      }
    };

    this.network.onGameStart = (state) => {
      if (this.playing) {
        // Rematch — reuse existing scene, just reset state
        this._handleRematchStart(state);
      } else {
        this._startGame(state);
      }
    };

    this.network.onShot = (msg) => {
      if (msg.seat === this.mySeat) return; // Already applied locally
      this._applyShot(msg);
    };

    this.network.onSettled = (msg) => {
      this._applySettle(msg);
    };

    this.network.onSync = (msg) => {
      this._applySync(msg);
    };

    this.network.onNextRound = (msg) => {
      this._applyNextRound(msg);
    };

    this.network.onRematchVote = (msg) => {
      this._handleRematchVote(msg.seat);
    };

    this.network.onSyncRequest = (seat) => {
      // A client came back from background — send them current state
      if (this.network.isHost && this.gameState) {
        this.network.sendSync(this.gameState.serialize(), this._getAllPenStates());
      }
    };

    this.network.onReaction = (msg) => {
      this._handleReaction(msg);
    };

    this.network.onSpectateStart = (msg) => {
      // We joined as spectator — start game rendering in watch-only mode
      this.isSpectator = true;
      this.mySeat = -1;
      this.players = msg.players;
      const totalPlayers = msg.players.length;
      this._startSpectatorMode(totalPlayers);
    };

    this.network.onSpectatorUpdate = (msg) => {
      // A spectator joined/left — show notification and badge
      if (this.hud && msg.names) {
        this.hud.setSpectatorBadge(this.isSpectator, msg.count, msg.names);
        if (!this.isSpectator) {
          this.hud.notify(`${msg.names[msg.names.length - 1]} is watching`, 2000);
        }
      }
    };

    this.network.onGameRejoin = () => {
      // We reconnected to an active game — start game rendering
      // The host will send a sync shortly with correct state
      if (!this.playing) {
        this.mySeat = this.network.mySeat;
        this.players = this.network.players;
        const totalPlayers = this.players.length;
        // Create a temporary state — will be overwritten by sync
        const tempState = { totalPlayers, phase: 'aiming', scores: new Array(totalPlayers).fill(0), outs: [], activeSeat: 0, opener: 0, round: 1, turn: 0, roundWinners: [], winner: null, revision: 0 };
        this._startGame(tempState);
        this.hud.notify('Reconnected! Syncing...', 2000);
      }
    };

    this.network.onPlayerLeft = (seat) => {
      if (this.playing && !this.isSpectator) {
        const player = this.players.find(p => p.seat === seat);
        const name = player ? player.name : 'A player';
        this.hud.notify(`${name} left the game`);

        // Mark their pen as out
        if (!this.gameState.outs.has(seat)) {
          this.gameState.outs.add(seat);
          this.gameState.revision++;
          // Hide their pen and freeze it
          if (this.penMeshes[seat]) {
            this.penMeshes[seat].visible = false;
          }
          if (this.penBodies[seat]) {
            this.penBodies[seat].setLinvel({ x: 0, y: 0, z: 0 }, true);
            this.penBodies[seat].setAngvel({ x: 0, y: 0, z: 0 }, true);
            this.penBodies[seat].setTranslation({ x: 10, y: -1, z: 10 }, true); // move far off
          }
        }

        // Check if only 1 player remains — they win the round
        // Only host modifies scores — guests receive updates via sync
        const alive = this.gameState.getActivePlayers();
        if (alive.length <= 1 && this.gameState.phase !== 'match_end' && this.gameState.phase !== 'round_result' && this.network.isHost) {
          const winner = alive.length === 1 ? alive[0] : null;
          if (winner !== null) {
            this.gameState.scores[winner]++;
            this.gameState.revision++;

            // Check if they've won the match
            if (this.gameState.scores[winner] >= 3) {
              this.gameState.winner = winner;
              this.gameState.phase = 'match_end';
              const winnerPlayer = this.players.find(p => p.seat === winner);
              this.hud.showMatchEnd(
                winnerPlayer ? winnerPlayer.name : 'someone',
                this.gameState.scores,
                this.players,
                this.mySeat,
                () => this._onRematch(),
                () => this._onLeave()
              );
            } else {
              // Just a round win — advance to next round
              this.gameState.phase = 'round_result';
              this.hud.notify(`${this._seatName(winner)} wins the round! (player left)`);
              setTimeout(() => {
                if (this.gameState.phase === 'round_result') {
                  this._advanceRound();
                }
              }, 3000);
            }

            // Host broadcasts the result to all
            this.network.sendSync(this.gameState.serialize(), this._getAllPenStates());
          }
        } else if (alive.length >= 2) {
          // If the disconnected player was the active shooter, advance turn
          // Only host should modify game state — guests will receive sync
          if (this.network.isHost) {
            if (this.gameState.phase === 'aiming' && this.gameState.activeSeat === seat) {
              const next = this.gameState.getNextSeat(seat);
              if (next !== null) {
                this.gameState.activeSeat = next;
                this.gameState.revision++;
                this.turnStartTime = performance.now();
              }
            }
            // If settling and active seat was this player, move on
            if (this.gameState.phase === 'settling' && this.gameState.activeSeat === seat) {
              this.gameState.phase = 'aiming';
              const next = this.gameState.getNextSeat(seat);
              if (next !== null) {
                this.gameState.activeSeat = next;
                this.gameState.revision++;
                this.turnStartTime = performance.now();
              }
            }
            // Host syncs state to keep everyone aligned
            this.network.sendSync(this.gameState.serialize(), this._getAllPenStates());
          }
        }

        this._updateHUD();
      }
    };

    this.network.onError = (msg) => {
      if (!this.playing) {
        if (msg === 'Game already started. Wait for the next match.') {
          const params = new URLSearchParams(window.location.search);
          const roomCode = params.get('room') || this.network.roomCode;
          this.lobbyUI.showSpectateOffer(roomCode);
        } else {
          this.lobbyUI.showError(msg);
        }
      }
    };

    this.network.onDisconnected = () => {
      // Host connection permanently lost — show error and offer to reload
      if (this.playing && this.hud) {
        if (this.isSpectator) {
          this.hud.notify('Connection to game lost', 5000);
          setTimeout(() => this._onLeave(), 5000);
        } else {
          this.hud.notify('Connection to host lost!', 10000);
          setTimeout(() => {
            if (this.playing && this.hud) {
              this.hud.showMatchEnd(
                'Connection lost',
                this.gameState ? this.gameState.scores : [],
                this.players,
                this.mySeat,
                () => { window.location.reload(); },
                () => this._onLeave()
              );
            }
          }, 3000);
        }
      }
    };
  }

  _hostStartGame() {
    if (!this.network.isHost) return;
    if (this.players.length < 2) return;

    const totalPlayers = this.players.length;
    this.gameState = new GameState(totalPlayers);
    const state = this.gameState.serialize();
    // Pens will be created and synced after _startGame runs
    this.network.startGame(state);
  }

  _startGame(stateData) {
    this.playing = true;
    this.lobbyUI.hide();

    // Init game state
    const totalPlayers = stateData.totalPlayers;
    this.gameState = new GameState(totalPlayers);
    this.gameState.restore(stateData);

    // Setup rendering
    this.renderer = createRenderer();
    document.getElementById('game-canvas').appendChild(this.renderer.domElement);
    this.scene = createScene();
    const deskScale = getDeskScale(totalPlayers);
    setDeskScale(deskScale);
    this._currentDeskScale = deskScale;
    this.camera = createCamera(this.renderer, deskScale);
    this.deskMesh = createDeskMesh(this.scene, deskScale);
    this.aimLine = createAimLine(this.scene);

    // Setup physics
    this.world = createWorld();
    createDesk(this.world, deskScale);
    createWalls(this.world);

    // Create pens
    this.penBodies = [];
    this.penMeshes = [];
    for (let i = 0; i < totalPlayers; i++) {
      const pos = getPenStartPosition(i, totalPlayers);
      const body = createPen(this.world, pos.x, pos.z, pos.yaw);
      this.penBodies.push(body);

      const mesh = createPenMesh(this.scene, i);
      // Add player name label on pen
      const player = this.players.find(p => p.seat === i);
      if (player) addPenLabel(mesh, player.name, PLAYER_COLORS[i].hex);
      this.penMeshes.push(mesh);
    }

    // If we received initial pen positions (from host), apply them
    if (stateData.pens) {
      this._setAllPenStates(stateData.pens);
    }

    // Host: send initial state sync to all clients after a brief physics settle
    if (this.network.isHost) {
      // Step physics a couple times to let pens settle onto the desk
      for (let i = 0; i < 10; i++) {
        this.world.step();
      }
      // Broadcast the authoritative starting positions
      setTimeout(() => {
        this.network.sendSync(this.gameState.serialize(), this._getAllPenStates());
      }, 200);
    }

    // Setup input
    this.flickInput = new FlickInput(
      this.renderer,
      this.camera,
      (flickData) => this._onFlick(flickData),
      () => this._canFlick(),
      (aim) => this._onAimUpdate(aim)
    );
    this.flickInput.setPenBodies(this.penBodies);

    // Setup HUD
    this.hud = new HUD(document.getElementById('hud'), (emoji) => this._onReaction(emoji), () => this._onLeave());
    this._updateHUD();

    // Handle resize (only bind once)
    if (!this._resizeBound) {
      this._resizeBound = true;
      window.addEventListener('resize', () => {
        this._onResize();
        this._checkLandscapeWarning();
      });
    }

    // Send leave message when tab is closed (only bind once)
    if (!this._beforeUnloadBound) {
      this._beforeUnloadBound = true;
      window.addEventListener('beforeunload', () => {
        localStorage.removeItem('pf8_active_room');
        this.network.destroy();
      });
    }

    // Start game loop
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.settleFrames = 0;
    this.turnStartTime = performance.now();
    this.turnWarned = false;
    this._gameLoop(performance.now());

    // Show landscape warning on mobile portrait
    this._checkLandscapeWarning();
  }

  _startSpectatorMode(totalPlayers) {
    this.playing = true;
    this.lobbyUI.hide();

    // Init game state (will be overwritten by first sync from host)
    this.gameState = new GameState(totalPlayers);

    // Setup rendering
    this.renderer = createRenderer();
    document.getElementById('game-canvas').appendChild(this.renderer.domElement);
    this.scene = createScene();
    const deskScale = getDeskScale(totalPlayers);
    setDeskScale(deskScale);
    this._currentDeskScale = deskScale;
    this.camera = createCamera(this.renderer, deskScale);
    this.deskMesh = createDeskMesh(this.scene, deskScale);
    this.aimLine = createAimLine(this.scene);

    // Setup physics (for visual interpolation on spectator side)
    this.world = createWorld();
    createDesk(this.world, deskScale);
    createWalls(this.world);

    // Create pens
    this.penBodies = [];
    this.penMeshes = [];
    for (let i = 0; i < totalPlayers; i++) {
      const pos = getPenStartPosition(i, totalPlayers);
      const body = createPen(this.world, pos.x, pos.z, pos.yaw);
      this.penBodies.push(body);
      const mesh = createPenMesh(this.scene, i);
      // Add player name label on pen
      const player = this.players.find(p => p.seat === i);
      if (player) addPenLabel(mesh, player.name, PLAYER_COLORS[i].hex);
      this.penMeshes.push(mesh);
    }

    // Setup input (spectator can't flick but might want reactions)
    this.flickInput = new FlickInput(
      this.renderer,
      this.camera,
      () => {}, // no-op flick
      () => null, // can never flick
      () => {} // no-op aim
    );
    this.flickInput.setPenBodies(this.penBodies);

    // Setup HUD (spectator mode)
    this.hud = new HUD(document.getElementById('hud'), (emoji) => this._onReaction(emoji), () => this._onLeave());
    this.hud.notify('Spectating...', 4000);
    this._updateHUD();

    // Handle resize (only bind once)
    if (!this._resizeBound) {
      this._resizeBound = true;
      window.addEventListener('resize', () => {
        this._onResize();
        this._checkLandscapeWarning();
      });
    }

    // Start game loop
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.settleFrames = 0;
    this._gameLoop(performance.now());
    this._checkLandscapeWarning();

    // Request a sync from host after we're fully set up
    setTimeout(() => {
      if (this.network.hostConnection) {
        this.network._send(this.network.hostConnection, { type: 'request_sync', seat: -1 });
      }
    }, 500);
  }

  _checkLandscapeWarning() {
    const warning = document.getElementById('landscape-warning');
    if (!warning) return;
    const isMobile = window.innerWidth < 900;
    const isPortrait = window.innerHeight > window.innerWidth;
    const dismissed = this._landscapeWarningDismissed;

    if (isMobile && isPortrait && !dismissed) {
      warning.classList.remove('hidden');
      const btn = document.getElementById('landscape-warning-dismiss');
      if (btn && !btn._bound) {
        btn._bound = true;
        btn.addEventListener('click', () => {
          warning.classList.add('hidden');
          this._landscapeWarningDismissed = true;
        });
      }
    } else {
      warning.classList.add('hidden');
    }
  }

  _canFlick() {
    if (this.isSpectator) return null;
    if (!this.gameState) return null;
    if (this.gameState.canShoot(this.mySeat)) return this.mySeat;
    return null;
  }

  _onFlick(flickData) {
    if (!this.gameState.canShoot(this.mySeat)) return;

    // Reset timeout skip counter
    this._timeoutSkips = 0;
    this._turnWarned = false;

    // Play flick sound
    playFlick(flickData.power);

    // Apply locally
    this.gameState.beginShot(this.mySeat);
    this._applyImpulse(flickData);
    this.settleFrames = 0;

    // Send to network
    this.network.sendShot({
      seat: flickData.seat,
      strikePoint: flickData.strikePoint,
      direction: flickData.direction,
      power: flickData.power,
    });

    this._updateHUD();
  }

  _applyShot(msg) {
    if (!this.gameState) return;
    playFlick(msg.power);
    this.gameState.beginShot(msg.seat);
    this._applyImpulse(msg);
    this.settleFrames = 0;
    this._updateHUD();
  }

  _applyImpulse(data) {
    const body = this.penBodies[data.seat];
    if (!body) return;

    const force = data.power * INPUT.maxForce;
    const impulse = {
      x: data.direction.x * force,
      y: 0,
      z: data.direction.z * force,
    };

    // Apply impulse at the strike point (where the player clicked on the pen)
    // Off-center strikes create torque = spin!
    if (data.strikePoint) {
      body.applyImpulseAtPoint(impulse, data.strikePoint, true);
    } else {
      body.applyImpulse(impulse, true);
    }
  }

  _checkSettle() {
    if (this.gameState.phase !== 'settling') return;

    // Track how long we've been in settling phase
    if (!this._settleStartTime) {
      this._settleStartTime = performance.now();
    }

    // Force settle after max time to prevent getting stuck
    const settleElapsed = performance.now() - this._settleStartTime;
    if (settleElapsed > SETTLE.maxSettleMs) {
      this._settleStartTime = null;
      this._doSettle();
      return;
    }

    // Check if all pens have settled (off-desk pens count as settled)
    let allSettled = true;
    for (let i = 0; i < this.penBodies.length; i++) {
      if (this.gameState.outs.has(i)) continue;
      // Off-desk pens are effectively settled (they'll be declared out)
      if (!isPenOnDesk(this.penBodies[i])) continue;
      if (!isPenSettled(this.penBodies[i])) {
        allSettled = false;
        break;
      }
    }

    if (allSettled) {
      this.settleFrames++;
    } else {
      this.settleFrames = 0;
    }

    if (this.settleFrames >= SETTLE.frames) {
      this._settleStartTime = null;
      this._doSettle();
    }
  }

  _doSettle() {
    // Determine who went out
    const newOuts = [];
    for (let i = 0; i < this.penBodies.length; i++) {
      if (this.gameState.outs.has(i)) continue;
      if (!isPenOnDesk(this.penBodies[i])) {
        newOuts.push(i);
      }
    }

    const result = this.gameState.settle(newOuts);

    // Notify outs
    if (newOuts.length > 0) {
      const names = newOuts.map(s => {
        const p = this.players.find(pl => pl.seat === s);
        return s === this.mySeat ? 'You' : (p ? p.name : 'someone');
      });
      this.hud.notify(`${names.join(' & ')} knocked out!`);
    }

    // Handle result
    if (result.kind === 'match_won') {
      playMatchWin();
      const winner = this.players.find(p => p.seat === result.winner);
      this.hud.showMatchEnd(
        winner ? winner.name : 'someone',
        this.gameState.scores,
        this.players,
        this.mySeat,
        () => this._onRematch(),
        () => this._onLeave()
      );
    } else if (result.kind === 'round_won' || result.kind === 'round_tied') {
      playRoundWin();
      const text = result.kind === 'round_tied'
        ? `Round ${this.gameState.round} draw · ${this.gameState.scores.join('-')}`
        : `${this._seatName(result.winner)} wins round ${this.gameState.round}!`;
      this.hud.showRoundResult(text);

      // Only the host auto-advances to next round after delay
      // Guests wait for the host's next_round message
      if (this.network.isHost) {
        setTimeout(() => {
          if (this.gameState.phase === 'round_result') {
            this._advanceRound();
          }
        }, 3000);
      }
    }

    // Host broadcasts settle
    if (this.network.isHost) {
      this.network.sendSettle({
        newOuts,
        state: this.gameState.serialize(),
        pens: this._getAllPenStates(),
      });
    }

    this.turnStartTime = performance.now();
    this.turnWarned = false;
    this._updateHUD();
  }

  _applySettle(msg) {
    if (!this.gameState) return;
    this.gameState.restore(msg.state);
    if (msg.pens) {
      this._setAllPenStates(msg.pens);
    }

    if (msg.state.phase === 'match_end') {
      playMatchWin();
      const winner = this.players.find(p => p.seat === msg.state.winner);
      this.hud.showMatchEnd(
        winner ? winner.name : 'someone',
        this.gameState.scores,
        this.players,
        this.mySeat,
        () => this._onRematch(),
        () => this._onLeave()
      );
    } else if (msg.newOuts && msg.newOuts.length > 0) {
      playPenOut();
      const names = msg.newOuts.map(s => this._seatName(s));
      this.hud.notify(`${names.join(' & ')} knocked out!`);

      // Play round win if the state indicates round ended
      if (msg.state.phase === 'round_result') {
        playRoundWin();
      }
    }

    this.turnStartTime = performance.now();
    this.turnWarned = false;
    this._updateHUD();
  }

  _applySync(msg) {
    if (!this.gameState) return;
    this.gameState.restore(msg.state);

    // Update players list if provided in sync
    if (msg.players) {
      this.players = msg.players;
    }

    if (msg.pens) {
      // Hard-set pen positions — this is only sent for reconnects,
      // spectators, and background recovery (not during normal gameplay)
      this._setAllPenStates(msg.pens);
    }

    // If we synced into match_end state, show the end screen
    if (msg.state.phase === 'match_end' && msg.state.winner !== null) {
      const winner = this.players.find(p => p.seat === msg.state.winner);
      this.hud.showMatchEnd(
        winner ? winner.name : 'someone',
        this.gameState.scores,
        this.players,
        this.mySeat,
        () => this._onRematch(),
        () => this._onLeave()
      );
    }

    this._updateHUD();
  }

  _advanceRound() {
    if (!this.gameState.nextRound()) return;

    // Reset pen positions — but keep disconnected players out
    const totalPlayers = this.gameState.totalPlayers;
    for (let i = 0; i < totalPlayers; i++) {
      // Check if this player is disconnected — keep them out
      const player = this.players.find(p => p.seat === i);
      if (player && player.connected === false) {
        this.gameState.outs.add(i);
        if (this.penMeshes[i]) this.penMeshes[i].visible = false;
        continue;
      }

      const pos = getPenStartPosition(i, totalPlayers);
      const body = this.penBodies[i];
      body.setTranslation({ x: pos.x, y: 0.004, z: pos.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      // Set yaw rotation (Y-axis only)
      const cosHalf = Math.cos(pos.yaw / 2);
      const sinHalf = Math.sin(pos.yaw / 2);
      body.setRotation({ x: 0, y: sinHalf, z: 0, w: cosHalf }, true);
    }

    // Make sure opener is a connected player
    while (this.gameState.outs.has(this.gameState.activeSeat)) {
      const next = this.gameState.getNextSeat(this.gameState.activeSeat);
      if (next === null) break;
      this.gameState.activeSeat = next;
      this.gameState.opener = next;
    }

    // Host broadcasts
    if (this.network.isHost) {
      this.network.sendNextRound({
        state: this.gameState.serialize(),
        pens: this._getAllPenStates(),
      });
    }

    this._penOutSounded = null; // Reset for new round
    this._resetShrink();
    this.hud.hideResult();
    this.turnStartTime = performance.now();
    this.turnWarned = false;
    this.hud.notify(`Round ${this.gameState.round} · ${this._seatName(this.gameState.opener)} opens`);
    this._updateHUD();
  }

  _applyNextRound(msg) {
    if (!this.gameState) return;
    this.gameState.restore(msg.state);
    if (msg.pens) {
      this._setAllPenStates(msg.pens);
    }
    this._resetShrink();
    this.hud.hideResult();
    this.turnStartTime = performance.now();
    this.turnWarned = false;
    this.hud.notify(`Round ${this.gameState.round} · ${this._seatName(this.gameState.opener)} opens`);
    this._updateHUD();
  }

  _onRematch() {
    // Send rematch vote — game only restarts when all connected players agree
    if (this.rematchVotes && this.rematchVotes.has(this.mySeat)) return; // Already voted

    if (!this.rematchVotes) {
      this.rematchVotes = new Set();
    }
    this.rematchVotes.add(this.mySeat);
    this.hud.disableRematchButton();

    // Send vote to network
    this.network.send({ type: 'rematch_vote', seat: this.mySeat });

    // If host, also handle own vote
    if (this.network.isHost) {
      this._handleRematchVote(this.mySeat);
    }

    this._updateRematchStatus();
  }

  _handleRematchVote(seat) {
    if (!this.rematchVotes) {
      this.rematchVotes = new Set();
    }
    this.rematchVotes.add(seat);
    this._updateRematchStatus();

    // Check if all connected players have voted
    const connectedPlayers = this.players.filter(p => p.connected !== false);
    const allVoted = connectedPlayers.every(p => this.rematchVotes.has(p.seat));

    if (allVoted && connectedPlayers.length >= 2) {
      // Everyone agreed — start the rematch
      this.rematchVotes = null;
      this.hud.hideResult();
      if (this.network.isHost) {
        this.gameState = new GameState(this.players.length);
        this._restartGameState();
        const state = this.gameState.serialize();
        this.network.startGame(state);
      }
    }
  }

  _updateRematchStatus() {
    if (!this.rematchVotes || !this.hud) return;
    const connectedPlayers = this.players.filter(p => p.connected !== false);
    const votedNames = [];
    for (const seat of this.rematchVotes) {
      const p = this.players.find(pl => pl.seat === seat);
      if (p) votedNames.push(p.name);
    }
    this.hud.updateRematchStatus(votedNames, connectedPlayers.length);
  }

  _restartGameState() {
    // Reset pen positions for new match
    const totalPlayers = this.gameState.totalPlayers;
    for (let i = 0; i < totalPlayers; i++) {
      const pos = getPenStartPosition(i, totalPlayers);
      const body = this.penBodies[i];
      body.setTranslation({ x: pos.x, y: 0.004, z: pos.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      const cosHalf = Math.cos(pos.yaw / 2);
      const sinHalf = Math.sin(pos.yaw / 2);
      body.setRotation({ x: 0, y: sinHalf, z: 0, w: cosHalf }, true);
    }
  }

  _onLeave() {
    localStorage.removeItem('pf8_active_room');
    this.network.destroy();
    window.location.href = window.location.pathname;
  }

  _handleRematchStart(stateData) {
    // Reuse existing scene — just reset game state and pens
    this.gameState = new GameState(stateData.totalPlayers);
    this.gameState.restore(stateData);
    this.settleFrames = 0;
    this.turnStartTime = performance.now();
    this.turnWarned = false;
    this.rematchVotes = null; // Reset votes

    // Re-apply desk scale in case player count changed
    const deskScale = getDeskScale(stateData.totalPlayers);
    setDeskScale(deskScale);
    this._currentDeskScale = deskScale;
    this._penOutSounded = null; // Reset sound tracker for new match
    this._resetShrink();

    // Reset pen positions
    this._restartGameState();

    // Host sends sync after short delay
    if (this.network.isHost) {
      setTimeout(() => {
        this.network.sendSync(this.gameState.serialize(), this._getAllPenStates());
      }, 200);
    }

    this.hud.hideResult();
    this.hud.notify(`New match! Round 1 · ${this._seatName(this.gameState.opener)} opens`);
    this._updateHUD();
  }

  _onAimUpdate(aim) {
    if (!aim) {
      updateAimLine(this.aimLine, null, null);
      return;
    }
    updateAimLine(this.aimLine, aim.penPos, aim.endPos);
  }

  _onReaction(emoji) {
    // Send reaction to all players
    this.network.send({ type: 'reaction', seat: this.mySeat, emoji });
    // Show locally too
    const color = PLAYER_COLORS[this.mySeat] || { hex: '#ffffff' };
    this.hud.showReaction('You', emoji, color.hex);
  }

  _handleReaction(msg) {
    if (msg.seat === this.mySeat) return; // Already shown locally
    const player = this.players.find(p => p.seat === msg.seat);
    const name = player ? player.name : 'someone';
    const color = PLAYER_COLORS[msg.seat] || { hex: '#ffffff' };
    this.hud.showReaction(name, msg.emoji, color.hex);
  }

  _checkTurnTimeout() {
    if (!this.gameState || this.gameState.phase !== 'aiming') return;
    // Host enforces timeout for all players
    if (!this.network.isHost) return;

    const elapsed = performance.now() - this.turnStartTime;

    // Warn at 30 seconds remaining
    if (elapsed > TURN.timeoutMs - 30000 && !this._turnWarned) {
      this._turnWarned = true;
      this.hud.notify(`${this._seatName(this.gameState.activeSeat)} — 30s left!`, 3000);
    }

    if (elapsed > TURN.timeoutMs) {
      this._turnWarned = false;
      // Auto skip active player's turn
      const currentSeat = this.gameState.activeSeat;
      const next = this.gameState.getNextSeat(currentSeat);
      if (next !== null) {
        // Track consecutive timeouts — if we've cycled through all players, force settle
        if (!this._timeoutSkips) this._timeoutSkips = 0;
        this._timeoutSkips++;
        const alivePlayers = this.gameState.getActivePlayers().length;
        if (this._timeoutSkips >= alivePlayers * 2) {
          // Everyone timed out twice — end the round as a draw
          this._timeoutSkips = 0;
          this.gameState.phase = 'round_result';
          this.hud.notify('Round ended (all players inactive)');
          this.network.sendSync(this.gameState.serialize(), this._getAllPenStates());
          setTimeout(() => {
            if (this.gameState.phase === 'round_result') {
              this._advanceRound();
            }
          }, 3000);
          this._updateHUD();
          return;
        }

        this.gameState.activeSeat = next;
        this.gameState.turn++;
        this.gameState.revision++;
        this.turnStartTime = performance.now();
        this.hud.notify(`${this._seatName(currentSeat)}'s turn skipped (timeout)`);
        this.network.sendSync(this.gameState.serialize(), this._getAllPenStates());
        this._updateHUD();
      }
    }
  }

  _checkShrink() {
    if (!this.gameState || this.gameState.phase === 'match_end' || this.gameState.phase === 'round_result') return;
    if (!this._roundStartTime) this._roundStartTime = performance.now();

    const elapsed = performance.now() - this._roundStartTime;
    if (elapsed < SHRINK.startDelayMs) return;

    // Calculate how many shrink steps should have occurred by now
    const stepsSinceStart = Math.floor((elapsed - SHRINK.startDelayMs) / SHRINK.intervalMs) + 1;
    if (this._shrinkStep === undefined) this._shrinkStep = 0;

    if (stepsSinceStart > this._shrinkStep) {
      // Don't advance past the minimum scale
      const nextFactor = 1 - ((this._shrinkStep + 1) * SHRINK.stepPercent);
      if (nextFactor < SHRINK.minScale && this._shrinkStep > 0) return; // Already at minimum

      const wasMultipleStepsBehind = (stepsSinceStart - this._shrinkStep) > 1;
      this._shrinkStep = stepsSinceStart;
      const shrinkFactor = Math.max(1 - (this._shrinkStep * SHRINK.stepPercent), SHRINK.minScale);

      // Update physics boundary for all clients
      const baseScale = getDeskScale(this.gameState.totalPlayers);
      const absoluteNewScale = baseScale * shrinkFactor;
      setDeskScale(absoluteNewScale);

      // Visually shrink the desk mesh
      if (this.deskMesh) {
        this.deskMesh.scale.set(shrinkFactor, 1, shrinkFactor);
      }

      // Notify players (only on normal single-step advances, not catch-up jumps)
      if (!wasMultipleStepsBehind) {
        this.hud.notify(`Table shrinking! (${Math.round((1 - shrinkFactor) * 100)}% smaller)`, 3000);
      }

      // Host checks if any pens are now outside the new boundary — eliminate immediately
      // Skip during settling — _doSettle will handle it
      if (this.network.isHost && this.gameState.phase === 'aiming') {
        const newOuts = [];
        for (let i = 0; i < this.penBodies.length; i++) {
          if (this.gameState.outs.has(i)) continue;
          if (!isPenOnDesk(this.penBodies[i])) {
            newOuts.push(i);
          }
        }
        if (newOuts.length > 0) {
          const activeWasEliminated = newOuts.includes(this.gameState.activeSeat);
          for (const seat of newOuts) {
            this.gameState.outs.add(seat);
            this.gameState.revision++;
          }
          playPenOut();
          const names = newOuts.map(s => this._seatName(s));
          this.hud.notify(`${names.join(' & ')} caught in shrink zone!`);

          // Check if round should end
          const alive = this.gameState.getActivePlayers();
          if (alive.length <= 1) {
            this.gameState.phase = 'settling';
            this._doSettle();
            return;
          }

          // If the active player was eliminated, advance the turn to the next player
          if (activeWasEliminated) {
            const next = this.gameState.getNextSeat(this.gameState.activeSeat);
            if (next !== null) {
              this.gameState.activeSeat = next;
              this.gameState.turn++;
              this.gameState.revision++;
              this.turnStartTime = performance.now();
              this._turnWarned = false;
              this._timeoutSkips = 0;
            }
          }

          // Sync eliminations + turn to guests
          this.network.sendSync(this.gameState.serialize(), this._getAllPenStates());
          this._updateHUD();
        }
      }
    }
  }

  _resetShrink() {
    this._roundStartTime = performance.now();
    this._shrinkStep = 0;
    // Reset desk to full scale
    const baseScale = getDeskScale(this.gameState ? this.gameState.totalPlayers : 2);
    setDeskScale(baseScale);
    this._currentDeskScale = baseScale;
    if (this.deskMesh) {
      this.deskMesh.scale.set(1, 1, 1);
    }
  }

  _updateTimers() {
    if (!this.hud || !this.gameState) return;

    let turnSeconds = null;
    let shrinkSeconds = null;

    // Turn timer — only during aiming, and not for spectators
    if (!this.isSpectator && this.gameState.phase === 'aiming' && this.turnStartTime) {
      const elapsed = performance.now() - this.turnStartTime;
      turnSeconds = Math.max(0, Math.ceil((TURN.timeoutMs - elapsed) / 1000));
    }

    // Shrink timer — time until next shrink (everyone sees this)
    if (this._roundStartTime && this.gameState.phase !== 'match_end' && this.gameState.phase !== 'round_result') {
      const elapsed = performance.now() - this._roundStartTime;
      const shrinkStep = this._shrinkStep || 0;
      const nextFactor = 1 - ((shrinkStep + 1) * SHRINK.stepPercent);
      // Only show if not yet at minimum
      if (nextFactor >= SHRINK.minScale || shrinkStep === 0) {
        const nextShrinkAt = elapsed < SHRINK.startDelayMs
          ? SHRINK.startDelayMs
          : SHRINK.startDelayMs + shrinkStep * SHRINK.intervalMs;
        shrinkSeconds = Math.max(0, Math.ceil((nextShrinkAt - elapsed) / 1000));
      }
    }

    this.hud.updateTimers(turnSeconds, shrinkSeconds);
  }

  _updateHUD() {
    if (!this.hud || !this.gameState) return;

    this.hud.updateScoreboard(this.players, this.gameState.scores, this.gameState.outs, this.mySeat);

    if (this.isSpectator) {
      this.hud.setSpectatorBadge(true, 0);
      return;
    }

    if (this.gameState.phase === 'aiming' && this.gameState.activeSeat !== null) {
      const isMyTurn = this.gameState.activeSeat === this.mySeat;
      // Play ding only when turn first becomes ours
      if (isMyTurn && !this._turnDingPlayed) {
        this._turnDingPlayed = true;
        playTurnNotify();
      } else if (!isMyTurn) {
        this._turnDingPlayed = false;
      }
      const color = PLAYER_COLORS[this.gameState.activeSeat];
      const name = this._seatName(this.gameState.activeSeat);
      const text = isMyTurn ? 'Your turn — flick!' : `${name}'s turn`;
      this.hud.setTurn(`${color.label} · ${text}`, isMyTurn, isMyTurn ? '✎' : '·');
    } else if (this.gameState.phase === 'settling') {
      this._turnDingPlayed = false;
      this.hud.setTurn('settling...', false, '↻');
    } else {
      this.hud.clearTurn();
    }
  }

  _getAllPenStates() {
    return this.penBodies.map(body => getPenState(body));
  }

  _setAllPenStates(pens) {
    for (let i = 0; i < pens.length && i < this.penBodies.length; i++) {
      setPenState(this.penBodies[i], pens[i]);
    }
  }

  _seatName(seat) {
    if (seat === this.mySeat) return 'You';
    const p = this.players.find(pl => pl.seat === seat);
    return p ? p.name : 'someone';
  }

  _gameLoop(time) {
    this.animFrame = requestAnimationFrame((t) => this._gameLoop(t));

    const rawDt = time - this.lastTime;
    this.lastTime = time;

    // If returning from background (>500ms gap), don't run physics catch-up.
    // Instead, request a state sync from host to get back in sync.
    if (rawDt > 500) {
      this.accumulator = 0;
      // Request sync from host if we're a guest
      if (!this.network.isHost && this.network.hostConnection) {
        this.network._send(this.network.hostConnection, { type: 'request_sync', seat: this.mySeat });
      }
      // Render current state
      for (let i = 0; i < this.penBodies.length; i++) {
        syncPenMesh(this.penMeshes[i], this.penBodies[i]);
        this.penMeshes[i].visible = !this.gameState.outs.has(i);
      }
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const dt = Math.min(rawDt, 50); // tighter cap
    this.accumulator += dt / 1000;

    // Step physics — all clients simulate for visual smoothness
    // Only the host determines the settle outcome
    let steps = 0;
    while (this.accumulator >= SIM.dt && steps < SIM.maxSubSteps) {
      this.world.step();
      this.accumulator -= SIM.dt;
      steps++;
    }
    if (steps === SIM.maxSubSteps) this.accumulator = 0;

    // Sync meshes to physics
    for (let i = 0; i < this.penBodies.length; i++) {
      syncPenMesh(this.penMeshes[i], this.penBodies[i]);
      // Host: hide pens that are out OR off-desk (local authority)
      // Guests: only hide pens the host confirmed as out (avoid false positives from physics divergence)
      if (this.network.isHost) {
        this.penMeshes[i].visible = !this.gameState.outs.has(i) && isPenOnDesk(this.penBodies[i]);
      } else {
        this.penMeshes[i].visible = !this.gameState.outs.has(i);
      }
    }

    // Detect pen collisions (velocity spike) and play sound
    for (let i = 0; i < this.penBodies.length; i++) {
      if (this.gameState.outs.has(i)) continue;
      const lv = this.penBodies[i].linvel();
      const speed = Math.sqrt(lv.x * lv.x + lv.z * lv.z);
      const prev = this._prevSpeeds ? this._prevSpeeds[i] : 0;
      // If speed increased sharply (something hit it), play collision
      if (speed - prev > 0.03 && prev < 0.01) {
        playCollision(Math.min((speed - prev) * 10, 1));
      }
      if (!this._prevSpeeds) this._prevSpeeds = new Array(this.penBodies.length).fill(0);
      this._prevSpeeds[i] = speed;
    }

    // Freeze pens that have gone off desk (stop them sliding forever)
    // Only host plays the instant sound — guests get it from _applySettle to avoid false positives
    for (let i = 0; i < this.penBodies.length; i++) {
      if (!isPenOnDesk(this.penBodies[i]) && !this.gameState.outs.has(i)) {
        this.penBodies[i].setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.penBodies[i].setAngvel({ x: 0, y: 0, z: 0 }, true);
        // Host plays sound instantly when pen crosses edge
        if (this.network.isHost) {
          if (!this._penOutSounded) this._penOutSounded = new Set();
          if (!this._penOutSounded.has(i)) {
            this._penOutSounded.add(i);
            playPenOut();
          }
        }
      }
    }

    // Check settle (host only for authority)
    // Check settle and timeout (host only for authority)
    if (this.network.isHost) {
      this._checkSettle();
      this._checkTurnTimeout();

      // No periodic position syncs during settling — all clients run identical physics
      // with identical inputs, so positions match naturally. Only the settle RESULT
      // (who's out) is sent via sendSettle when physics fully stops.
    }

    // Shrink runs on ALL clients for visual consistency
    this._checkShrink();

    // Update timers display
    this._updateTimers();

    // Render
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    if (!this.camera || !this.renderer) return;
    const aspect = window.innerWidth / window.innerHeight;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Scale camera position based on current desk scale
    const scale = this._currentDeskScale || 1.0;
    if (aspect < 1) {
      // Portrait — more overhead
      this.camera.position.set(0, 0.7 * scale, 0.25 * scale);
      this.camera.lookAt(0, 0, 0);
    } else {
      // Landscape — more overhead
      this.camera.position.set(0, 0.6 * scale, 0.2 * scale);
      this.camera.lookAt(0, 0, 0);
    }
  }
}

// Bootstrap
const game = new PenFightGame();
game.init().catch(err => {
  console.error('Failed to init:', err);
  document.getElementById('lobby').innerHTML = `
    <div class="lobby-card">
      <h1 class="logo">PEN FIGHT</h1>
      <p class="lobby-error">Failed to load game engine. Please refresh.</p>
      <button class="btn btn-primary" onclick="location.reload()">Reload</button>
    </div>
  `;
});
