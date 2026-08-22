import { initPhysics, createWorld, createDesk, createWalls, createPen, getPenState, setPenState, isPenOnDesk, isPenSettled } from './physics/world.js';
import { createScene, createCamera, createRenderer, createDeskMesh, createPenMesh, syncPenMesh, createAimLine, updateAimLine } from './render/scene.js';
import { FlickInput } from './input/flick.js';
import { GameState } from './game/state.js';
import { NetworkManager } from './net/network.js';
import { LobbyUI } from './ui/lobby.js';
import { HUD } from './ui/hud.js';
import { PLAYER_COLORS, MAX_PLAYERS, SIM, SETTLE, INPUT, TURN, getPenStartPosition } from './config.js';

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
        this.lobbyUI.showError(err.message);
      }
    };

    this.lobbyUI.onStartGame = () => {
      this._hostStartGame();
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

    this.network.onPlayerLeft = (seat) => {
      if (this.playing) {
        const player = this.players.find(p => p.seat === seat);
        const name = player ? player.name : 'A player';
        this.hud.notify(`${name} left the game`);

        // Mark their pen as out
        if (!this.gameState.outs.has(seat)) {
          this.gameState.outs.add(seat);
          this.gameState.revision++;
          // Hide their pen
          if (this.penMeshes[seat]) {
            this.penMeshes[seat].visible = false;
          }
        }

        // Check if only 1 player remains — they win
        const alive = this.gameState.getActivePlayers();
        if (alive.length <= 1) {
          const winner = alive.length === 1 ? alive[0] : null;
          if (winner !== null) {
            this.gameState.scores[winner]++;
            this.gameState.winner = winner;
            this.gameState.phase = 'match_end';
            this.gameState.revision++;
            const winnerPlayer = this.players.find(p => p.seat === winner);
            this.hud.showMatchEnd(
              winnerPlayer ? winnerPlayer.name : 'someone',
              this.gameState.scores,
              this.players,
              this.mySeat,
              () => this._onRematch(),
              () => this._onLeave()
            );
            // Host broadcasts the result
            if (this.network.isHost) {
              this.network.sendSync(this.gameState.serialize(), this._getAllPenStates());
            }
          }
        } else {
          // If the disconnected player was the active shooter, advance turn
          if (this.gameState.phase === 'aiming' && this.gameState.activeSeat === seat) {
            const next = this.gameState.getNextSeat(seat);
            if (next !== null) {
              this.gameState.activeSeat = next;
              this.gameState.revision++;
              this.turnStartTime = performance.now();
              this.turnWarned = false;
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
              this.turnWarned = false;
            }
          }
          // Host syncs state to keep everyone aligned
          if (this.network.isHost) {
            this.network.sendSync(this.gameState.serialize(), this._getAllPenStates());
          }
        }

        this._updateHUD();
      }
    };

    this.network.onError = (msg) => {
      if (!this.playing) {
        this.lobbyUI.showError(msg);
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
    this.camera = createCamera(this.renderer);
    createDeskMesh(this.scene);
    this.aimLine = createAimLine(this.scene);

    // Setup physics
    this.world = createWorld();
    createDesk(this.world);
    createWalls(this.world);

    // Create pens
    this.penBodies = [];
    this.penMeshes = [];
    for (let i = 0; i < totalPlayers; i++) {
      const pos = getPenStartPosition(i, totalPlayers);
      const body = createPen(this.world, pos.x, pos.z, pos.yaw);
      this.penBodies.push(body);

      const mesh = createPenMesh(this.scene, i);
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
    this.hud = new HUD(document.getElementById('hud'));
    this._updateHUD();

    // Handle resize
    window.addEventListener('resize', () => this._onResize());

    // Start game loop
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.settleFrames = 0;
    this.turnStartTime = performance.now();
    this.turnWarned = false;
    this._gameLoop(performance.now());
  }

  _canFlick() {
    if (!this.gameState) return null;
    if (this.gameState.canShoot(this.mySeat)) return this.mySeat;
    return null;
  }

  _onFlick(flickData) {
    if (!this.gameState.canShoot(this.mySeat)) return;

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

    // Check if all pens have settled
    let allSettled = true;
    for (let i = 0; i < this.penBodies.length; i++) {
      if (this.gameState.outs.has(i)) continue;
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
      const text = result.kind === 'round_tied'
        ? `Round ${this.gameState.round} draw · ${this.gameState.scores.join('-')}`
        : `${this._seatName(result.winner)} wins round ${this.gameState.round}!`;
      this.hud.showRoundResult(text);

      // Auto advance to next round after delay
      setTimeout(() => {
        if (this.gameState.phase === 'round_result') {
          this._advanceRound();
        }
      }, 3000);
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
      const names = msg.newOuts.map(s => this._seatName(s));
      this.hud.notify(`${names.join(' & ')} knocked out!`);
    }

    this.turnStartTime = performance.now();
    this.turnWarned = false;
    this._updateHUD();
  }

  _applySync(msg) {
    if (!this.gameState) return;
    this.gameState.restore(msg.state);
    if (msg.pens) {
      this._setAllPenStates(msg.pens);
    }
    this._updateHUD();
  }

  _advanceRound() {
    if (!this.gameState.nextRound()) return;

    // Reset pen positions
    const totalPlayers = this.gameState.totalPlayers;
    for (let i = 0; i < totalPlayers; i++) {
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

    // Host broadcasts
    if (this.network.isHost) {
      this.network.sendNextRound({
        state: this.gameState.serialize(),
        pens: this._getAllPenStates(),
      });
    }

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
    this.hud.hideResult();
    this.turnStartTime = performance.now();
    this.turnWarned = false;
    this.hud.notify(`Round ${this.gameState.round} · ${this._seatName(this.gameState.opener)} opens`);
    this._updateHUD();
  }

  _onRematch() {
    this.hud.hideResult();
    if (this.network.isHost) {
      // Host restarts the game
      this.gameState = new GameState(this.players.length);
      this._restartGameState();
      const state = this.gameState.serialize();
      this.network.startGame(state);
    } else {
      // Guest waits — show a waiting message
      this.hud.notify('Waiting for host to restart...', 5000);
    }
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

  _checkTurnTimeout() {
    if (!this.gameState || this.gameState.phase !== 'aiming') return;
    if (this.gameState.activeSeat !== this.mySeat) return;

    const elapsed = performance.now() - this.turnStartTime;

    if (!this.turnWarned && elapsed > TURN.timeoutWarnMs) {
      this.turnWarned = true;
      this.hud.notify('Flick soon or lose your turn!', 3000);
    }

    if (elapsed > TURN.timeoutForceMs) {
      // Auto pass
      if (this.gameState.pass(this.mySeat)) {
        this.network.send({ type: 'pass', seat: this.mySeat, state: this.gameState.serialize() });
        this.turnStartTime = performance.now();
        this.turnWarned = false;
        this.hud.notify('Turn skipped (timeout)');
        this._updateHUD();
      }
    }
  }

  _updateHUD() {
    if (!this.hud || !this.gameState) return;

    this.hud.updateScoreboard(this.players, this.gameState.scores, this.gameState.outs, this.mySeat);

    if (this.gameState.phase === 'aiming' && this.gameState.activeSeat !== null) {
      const isMyTurn = this.gameState.activeSeat === this.mySeat;
      const color = PLAYER_COLORS[this.gameState.activeSeat];
      const name = this._seatName(this.gameState.activeSeat);
      const text = isMyTurn ? 'Your turn — flick!' : `${name}'s turn`;
      this.hud.setTurn(`${color.label} · ${text}`, isMyTurn, isMyTurn ? '✎' : '·');
    } else if (this.gameState.phase === 'settling') {
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

    const dt = Math.min(time - this.lastTime, 100); // cap at 100ms
    this.lastTime = time;
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
      // Hide pens that are out OR have fallen off the desk edge
      this.penMeshes[i].visible = !this.gameState.outs.has(i) && isPenOnDesk(this.penBodies[i]);
    }

    // Freeze pens that have gone off desk (stop them sliding forever)
    for (let i = 0; i < this.penBodies.length; i++) {
      if (!isPenOnDesk(this.penBodies[i]) && !this.gameState.outs.has(i)) {
        this.penBodies[i].setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.penBodies[i].setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    // Check settle (host only for authority)
    if (this.network.isHost) {
      this._checkSettle();
      this._checkTurnTimeout();

      // Periodic sync during settling to keep clients aligned
      if (this.gameState && this.gameState.phase === 'settling') {
        if (!this._lastSyncTime || time - this._lastSyncTime > 500) {
          this._lastSyncTime = time;
          this.network.sendSync(this.gameState.serialize(), this._getAllPenStates());
        }
      }
    }

    // Render
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
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
