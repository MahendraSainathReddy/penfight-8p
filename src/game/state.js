import { MAX_PLAYERS, WIN_SCORE, getPenStartPosition } from '../config.js';

/**
 * Game state machine for 8-player pen fight.
 * Phases: lobby -> playing (aiming -> settling -> round_result) -> match_end
 * Elimination-style: last pen standing wins the round.
 */

export class GameState {
  constructor(totalPlayers) {
    this.totalPlayers = totalPlayers;
    this.reset();
  }

  reset() {
    this.round = 1;
    this.turn = 0;
    this.phase = 'aiming'; // aiming | settling | round_result | match_end
    this.scores = new Array(this.totalPlayers).fill(0);
    this.outs = new Set(); // seats knocked out this round
    this.activeSeat = 0;
    this.opener = 0;
    this.roundWinners = [];
    this.winner = null;
    this.revision = 0;
  }

  getActivePlayers() {
    const active = [];
    for (let i = 0; i < this.totalPlayers; i++) {
      if (!this.outs.has(i)) active.push(i);
    }
    return active;
  }

  getNextSeat(currentSeat) {
    for (let i = 1; i <= this.totalPlayers; i++) {
      const next = (currentSeat + i) % this.totalPlayers;
      if (!this.outs.has(next)) return next;
    }
    return null;
  }

  canShoot(seat) {
    return this.phase === 'aiming' && this.activeSeat === seat && !this.outs.has(seat);
  }

  beginShot(seat) {
    if (!this.canShoot(seat)) return false;
    this.phase = 'settling';
    this.revision++;
    return true;
  }

  /**
   * Called when physics settles. newOuts is array of seats that went out.
   * Returns: { kind, winner, state }
   */
  settle(newOuts) {
    if (this.phase !== 'settling') return { kind: 'continue', state: this.serialize() };

    for (const seat of newOuts) {
      this.outs.add(seat);
    }
    this.revision++;

    const alive = this.getActivePlayers();

    if (alive.length >= 2) {
      // Continue — advance turn
      this.turn++;
      this.activeSeat = this.getNextSeat(this.activeSeat);
      this.phase = 'aiming';
      return { kind: 'continue', winner: null, state: this.serialize() };
    }

    // Round ended
    const roundWinner = alive.length === 1 ? alive[0] : null;
    this.roundWinners.push(roundWinner);

    if (roundWinner !== null) {
      this.scores[roundWinner]++;
    }

    // Check match win
    if (roundWinner !== null && this.scores[roundWinner] >= WIN_SCORE) {
      this.winner = roundWinner;
      this.phase = 'match_end';
      return { kind: 'match_won', winner: roundWinner, state: this.serialize() };
    }

    this.phase = 'round_result';
    return {
      kind: roundWinner === null ? 'round_tied' : 'round_won',
      winner: roundWinner,
      state: this.serialize(),
    };
  }

  nextRound() {
    if (this.phase !== 'round_result') return false;
    this.round++;
    this.turn++;
    this.opener = (this.opener + 1) % this.totalPlayers;
    this.activeSeat = this.opener;
    this.outs = new Set();
    this.phase = 'aiming';
    this.revision++;
    return true;
  }

  pass(seat) {
    if (!this.canShoot(seat)) return false;
    const next = this.getNextSeat(seat);
    if (next === null) return false;
    this.turn++;
    this.activeSeat = next;
    this.revision++;
    return true;
  }

  serialize() {
    return {
      round: this.round,
      turn: this.turn,
      phase: this.phase,
      scores: [...this.scores],
      outs: [...this.outs],
      activeSeat: this.activeSeat,
      opener: this.opener,
      roundWinners: [...this.roundWinners],
      winner: this.winner,
      revision: this.revision,
      totalPlayers: this.totalPlayers,
    };
  }

  restore(data) {
    this.round = data.round;
    this.turn = data.turn;
    this.phase = data.phase;
    this.scores = [...data.scores];
    this.outs = new Set(data.outs);
    this.activeSeat = data.activeSeat;
    this.opener = data.opener;
    this.roundWinners = [...data.roundWinners];
    this.winner = data.winner;
    this.revision = data.revision;
    this.totalPlayers = data.totalPlayers;
  }
}
