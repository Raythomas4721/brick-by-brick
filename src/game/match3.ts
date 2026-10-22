/**
 * Pure match-3 engine. Nothing here touches the DOM; every function returns new objects.
 * A swap resolves into a list of steps (clear → fall/refill → clear …) the UI animates in order.
 */
import { rand } from './rng';

export const SIZE = 8;
export const CELLS = SIZE * SIZE;

export type Special = 'none' | 'line-h' | 'line-v' | 'bomb' | 'rainbow';

export interface Piece {
  kind: 'piece';
  id: number;
  color: number; // 0..colors-1, -1 for rainbow
  special: Special;
}

export interface BoxTile {
  kind: 'box';
  id: number;
  hp: number; // 1 or 2; boxes never move and break when hit hp times
}

export type Tile = Piece | BoxTile | null;

export interface Board {
  tiles: Tile[];
  colors: number;
  rng: number;
  nextId: number;
}

export interface Step {
  /** board right after pieces are removed / specials created */
  afterClear: Board;
  /** board after gravity and refill */
  afterFall: Board;
  cleared: { index: number; piece: Piece }[];
  created: { index: number; piece: Piece }[];
  boxesHit: { index: number; id: number; hp: number }[];
  boxesBroken: number;
  moves: { id: number; from: number; to: number }[];
  spawned: { id: number; index: number; drop: number }[]; // drop = how many rows it falls in from above
  score: number;
  shuffle?: boolean;
}

// ---------- helpers ----------

export const row = (i: number) => Math.floor(i / SIZE);
export const col = (i: number) => i % SIZE;
export const at = (r: number, c: number) => r * SIZE + c;
const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < SIZE && c < SIZE;

export function isPiece(t: Tile | undefined): t is Piece {
  return !!t && t.kind === 'piece';
}

export function isBox(t: Tile | undefined): t is BoxTile {
  return !!t && t.kind === 'box';
}

export function cloneBoard(b: Board): Board {
  return { ...b, tiles: b.tiles.map((t) => (t ? { ...t } : t)) };
}

function newPiece(b: Board, color = Math.floor(rand(b) * b.colors), special: Special = 'none'): Piece {
  return { kind: 'piece', id: b.nextId++, color: special === 'rainbow' ? -1 : color, special };
}

export function adjacent(a: number, b: number): boolean {
  return Math.abs(row(a) - row(b)) + Math.abs(col(a) - col(b)) === 1;
}

const neighbours = (i: number) =>
  [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dr, dc]) => [row(i) + dr, col(i) + dc]).filter(([r, c]) => inside(r, c)).map(([r, c]) => at(r, c));

// ---------- creation ----------

/** A board with no ready-made runs and at least one legal move. */
export function createBoard(colors: number, seed: number, boxes: { index: number; hp: number }[] = []): Board {
  const b: Board = { tiles: new Array(CELLS).fill(null), colors, rng: seed, nextId: 1 };
  for (const box of boxes) b.tiles[box.index] = { kind: 'box', id: b.nextId++, hp: box.hp };
  for (let attempt = 0; attempt < 200; attempt++) {
    for (let i = 0; i < CELLS; i++) {
      if (isBox(b.tiles[i])) continue;
      const banned = new Set<number>();
      const [r, c] = [row(i), col(i)];
      const colorOf = (rr: number, cc: number) => {
        const t = inside(rr, cc) ? b.tiles[at(rr, cc)] : null;
        return isPiece(t) ? t.color : -2;
      };
      if (colorOf(r, c - 1) >= 0 && colorOf(r, c - 1) === colorOf(r, c - 2)) banned.add(colorOf(r, c - 1));
      if (colorOf(r - 1, c) >= 0 && colorOf(r - 1, c) === colorOf(r - 2, c)) banned.add(colorOf(r - 1, c));
      const allowed = Array.from({ length: colors }, (_, k) => k).filter((k) => !banned.has(k));
      b.tiles[i] = newPiece(b, allowed[Math.floor(rand(b) * allowed.length)]);
    }
    if (hasMove(b)) return b;
  }
  return b;
}

// ---------- matching ----------

export interface Run {
  cells: number[];
  dir: 'h' | 'v';
  color: number;
}

export function findRuns(b: Board): Run[] {
  const runs: Run[] = [];
  const colorAt = (i: number) => {
    const t = b.tiles[i];
    return isPiece(t) && t.special !== 'rainbow' ? t.color : -1;
  };
  for (const dir of ['h', 'v'] as const) {
    for (let line = 0; line < SIZE; line++) {
      let start = 0;
      for (let k = 1; k <= SIZE; k++) {
        const idx = (n: number) => (dir === 'h' ? at(line, n) : at(n, line));
        const same = k < SIZE && colorAt(idx(k)) >= 0 && colorAt(idx(k)) === colorAt(idx(start));
        if (same) continue;
        if (k - start >= 3 && colorAt(idx(start)) >= 0) {
          runs.push({ cells: Array.from({ length: k - start }, (_, n) => idx(start + n)), dir, color: colorAt(idx(start)) });
        }
        start = k;
      }
    }
  }
  return runs;
}

interface Group {
  cells: Set<number>;
  runs: Run[];
  color: number;
}

function groupRuns(runs: Run[]): Group[] {
  const groups: Group[] = [];
  for (const run of runs) {
    const touching = groups.filter((g) => g.color === run.color && run.cells.some((c) => g.cells.has(c)));
    const merged: Group = { cells: new Set(run.cells), runs: [run], color: run.color };
    for (const g of touching) {
      g.cells.forEach((c) => merged.cells.add(c));
      merged.runs.push(...g.runs);
      groups.splice(groups.indexOf(g), 1);
    }
    groups.push(merged);
  }
  return groups;
}

/** Which special (if any) a group earns and where it appears. */
function specialFor(g: Group, preferred: number[]): { index: number; special: Special } | null {
  const longest = g.runs.reduce((a, r) => (r.cells.length > a.cells.length ? r : a), g.runs[0]);
  const hasH = g.runs.some((r) => r.dir === 'h');
  const hasV = g.runs.some((r) => r.dir === 'v');
  let special: Special = 'none';
  if (longest.cells.length >= 5) special = 'rainbow';
  else if (hasH && hasV) special = 'bomb';
  else if (longest.cells.length === 4) special = longest.dir === 'h' ? 'line-h' : 'line-v';
  if (special === 'none') return null;
  const pref = preferred.find((p) => g.cells.has(p));
  if (pref !== undefined) return { index: pref, special };
  if (special === 'bomb') {
    const h = g.runs.find((r) => r.dir === 'h')!;
    const v = g.runs.find((r) => r.dir === 'v')!;
    const cross = h.cells.find((c) => v.cells.includes(c));
    if (cross !== undefined) return { index: cross, special };
  }
  return { index: longest.cells[Math.floor(longest.cells.length / 2)], special };
}

// ---------- clearing ----------

function mostCommonColor(b: Board): number {
  const counts = new Map<number, number>();
  for (const t of b.tiles) if (isPiece(t) && t.color >= 0) counts.set(t.color, (counts.get(t.color) ?? 0) + 1);
  let best = 0;
  let n = -1;
  counts.forEach((v, k) => {
    if (v > n) [best, n] = [k, v];
  });
  return best;
}

/** Cells a special clears when it goes off at `i`. */
function blastArea(b: Board, i: number, special: Special): number[] {
  const [r, c] = [row(i), col(i)];
  if (special === 'line-h') return Array.from({ length: SIZE }, (_, k) => at(r, k));
  if (special === 'line-v') return Array.from({ length: SIZE }, (_, k) => at(k, c));
  if (special === 'bomb') return square(r, c, 1);
  if (special === 'rainbow') {
    const color = mostCommonColor(b);
    return b.tiles.flatMap((t, k) => (isPiece(t) && t.color === color ? [k] : []));
  }
  return [];
}

function square(r: number, c: number, radius: number): number[] {
  const out: number[] = [];
  for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) if (inside(r + dr, c + dc)) out.push(at(r + dr, c + dc));
  return out;
}

/** Follow chain reactions: specials inside the set add their blast areas. */
function expand(b: Board, start: Iterable<number>, inert: Set<number>): Set<number> {
  const set = new Set(start);
  const queue = [...set];
  while (queue.length) {
    const i = queue.pop()!;
    const t = b.tiles[i];
    if (!isPiece(t) || t.special === 'none' || inert.has(i)) continue;
    for (const k of blastArea(b, i, t.special)) {
      if (!set.has(k)) {
        set.add(k);
        queue.push(k);
      }
    }
  }
  return set;
}

/** Remove cleared pieces, damage boxes, place newly earned specials. Mutates `b`. */
function applyClear(b: Board, clear: Set<number>, creations: { index: number; special: Special; color: number }[]) {
  const cleared: Step['cleared'] = [];
  const hit = new Set<number>();
  for (const i of clear) {
    const t = b.tiles[i];
    if (isPiece(t)) {
      cleared.push({ index: i, piece: t });
      b.tiles[i] = null;
      for (const n of neighbours(i)) if (isBox(b.tiles[n])) hit.add(n);
    } else if (isBox(t)) hit.add(i);
  }
  const boxesHit: Step['boxesHit'] = [];
  let boxesBroken = 0;
  for (const i of hit) {
    const box = b.tiles[i] as BoxTile;
    box.hp -= 1;
    boxesHit.push({ index: i, id: box.id, hp: box.hp });
    if (box.hp <= 0) {
      b.tiles[i] = null;
      boxesBroken++;
    }
  }
  const created: Step['created'] = [];
  for (const cr of creations) {
    if (b.tiles[cr.index] !== null) continue;
    const piece = newPiece(b, cr.color, cr.special);
    b.tiles[cr.index] = piece;
    created.push({ index: cr.index, piece });
  }
  return { cleared, boxesHit, boxesBroken, created };
}

/**
 * Pieces fall within column segments separated by boxes; empty slots at the top of
 * each segment get new pieces. Mutates `b`.
 */
function applyGravity(b: Board) {
  const moves: Step['moves'] = [];
  const spawned: Step['spawned'] = [];
  for (let c = 0; c < SIZE; c++) {
    let bottom = SIZE - 1;
    while (bottom >= 0) {
      if (isBox(b.tiles[at(bottom, c)])) {
        bottom--;
        continue;
      }
      let top = bottom;
      while (top > 0 && !isBox(b.tiles[at(top - 1, c)])) top--;
      // segment rows top..bottom
      let write = bottom;
      for (let r = bottom; r >= top; r--) {
        const t = b.tiles[at(r, c)];
        if (!isPiece(t)) continue;
        if (r !== write) {
          b.tiles[at(write, c)] = t;
          b.tiles[at(r, c)] = null;
          moves.push({ id: t.id, from: at(r, c), to: at(write, c) });
        }
        write--;
      }
      const missing = write - top + 1;
      for (let r = write; r >= top; r--) {
        const p = newPiece(b);
        b.tiles[at(r, c)] = p;
        spawned.push({ id: p.id, index: at(r, c), drop: missing });
      }
      bottom = top - 1;
    }
  }
  return { moves, spawned };
}

/**
 * Resolve until the board is stable. `first` lets swaps/boosters supply the opening clear;
 * otherwise each round clears whatever runs exist.
 */
function cascade(board: Board, first: { clear: Set<number>; inert?: Set<number> } | null, preferred: number[]): { board: Board; steps: Step[] } {
  let b = board;
  const steps: Step[] = [];
  let pending = first;
  for (let round = 0; round < 60; round++) {
    let clear: Set<number>;
    let creations: { index: number; special: Special; color: number }[] = [];
    let inert = new Set<number>();
    if (pending) {
      clear = pending.clear;
      inert = pending.inert ?? inert;
    } else {
      const groups = groupRuns(findRuns(b));
      if (groups.length === 0) break;
      clear = new Set<number>();
      for (const g of groups) {
        g.cells.forEach((c) => clear.add(c));
        const sp = specialFor(g, round === 0 ? preferred : []);
        if (sp) creations.push({ index: sp.index, special: sp.special, color: g.color });
      }
    }
    pending = null;
    const expanded = expand(b, clear, inert);
    const afterClear = cloneBoard(b);
    const res = applyClear(afterClear, expanded, creations);
    const afterFall = cloneBoard(afterClear);
    const fall = applyGravity(afterFall);
    steps.push({
      afterClear, afterFall, ...res, ...fall,
      score: res.cleared.length * 60 * (round + 1) + res.created.length * 120 + res.boxesBroken * 100,
    });
    b = afterFall;
  }
  return { board: b, steps };
}

// ---------- moves ----------

/** Would swapping a and b be allowed (without resolving it)? */
export function isValidSwap(b: Board, a: number, c: number): boolean {
  if (!adjacent(a, c)) return false;
  const pa = b.tiles[a];
  const pc = b.tiles[c];
  if (!isPiece(pa) || !isPiece(pc)) return false;
  if (pa.special === 'rainbow' || pc.special === 'rainbow') return true;
  if (pa.special !== 'none' && pc.special !== 'none') return true;
  const t = b.tiles.slice();
  [t[a], t[c]] = [t[c], t[a]];
  return findRuns({ ...b, tiles: t }).length > 0;
}

export function hasMove(b: Board): boolean {
  for (let i = 0; i < CELLS; i++) {
    if (col(i) < SIZE - 1 && isValidSwap(b, i, i + 1)) return true;
    if (row(i) < SIZE - 1 && isValidSwap(b, i, i + SIZE)) return true;
  }
  return false;
}

/** Swap two adjacent pieces and resolve everything. Returns null when the swap isn't allowed. */
export function swap(board: Board, a: number, c: number): { board: Board; steps: Step[] } | null {
  if (!isValidSwap(board, a, c)) return null;
  const b = cloneBoard(board);
  [b.tiles[a], b.tiles[c]] = [b.tiles[c], b.tiles[a]];
  const pa = b.tiles[c] as Piece; // moved piece now sits at c
  const pc = b.tiles[a] as Piece;

  if (pa.special === 'rainbow' || pc.special === 'rainbow') {
    const [rainbowAt, other, otherAt] = pa.special === 'rainbow' ? [c, pc, a] : [a, pa, c];
    let clear: Set<number>;
    if (other.special === 'rainbow') {
      clear = new Set(b.tiles.flatMap((t, k) => (isPiece(t) ? [k] : [])));
    } else {
      const targets = b.tiles.flatMap((t, k) => (isPiece(t) && t.color === other.color ? [k] : []));
      if (other.special !== 'none') {
        // every piece of that colour becomes the same kind of special, then they all go off
        for (const k of targets) {
          const p = b.tiles[k] as Piece;
          p.special = other.special === 'bomb' ? 'bomb' : rand(b) < 0.5 ? 'line-h' : 'line-v';
        }
      }
      clear = new Set([...targets, rainbowAt, otherAt]);
    }
    return cascade(b, { clear, inert: new Set([rainbowAt]) }, []);
  }

  if (pa.special !== 'none' && pc.special !== 'none') {
    const kinds = [pa.special, pc.special];
    const [r, cc] = [row(c), col(c)];
    let area: number[];
    if (kinds.every((k) => k === 'bomb')) area = square(r, cc, 2);
    else if (kinds.includes('bomb')) {
      area = [];
      for (let d = -1; d <= 1; d++) {
        for (let k = 0; k < SIZE; k++) {
          if (inside(r + d, k)) area.push(at(r + d, k));
          if (inside(k, cc + d)) area.push(at(k, cc + d));
        }
      }
    } else area = [...blastArea(b, c, 'line-h'), ...blastArea(b, c, 'line-v')];
    return cascade(b, { clear: new Set([...area, a, c]), inert: new Set([a, c]) }, []);
  }

  return cascade(b, null, [a, c]);
}

// ---------- boosters ----------

/** 🔨 knock out one cell (a piece, or one hit on a box). */
export function hammer(board: Board, index: number): { board: Board; steps: Step[] } | null {
  if (!board.tiles[index]) return null;
  return cascade(cloneBoard(board), { clear: new Set([index]) }, []);
}

/** 💎 turn one piece into a rainbow brick. */
export function makeRainbow(board: Board, index: number): Board | null {
  if (!isPiece(board.tiles[index])) return null;
  const b = cloneBoard(board);
  b.tiles[index] = newPiece(b, -1, 'rainbow');
  return b;
}

/** Rearrange the pieces (boxes stay) so there are no runs and at least one move. */
export function shuffle(board: Board): Board {
  const b = cloneBoard(board);
  const slots = b.tiles.flatMap((t, i) => (isPiece(t) ? [i] : []));
  const pieces = slots.map((i) => b.tiles[i] as Piece);
  for (let attempt = 0; attempt < 200; attempt++) {
    for (let i = pieces.length - 1; i > 0; i--) {
      const j = Math.floor(rand(b) * (i + 1));
      [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
    }
    slots.forEach((s, k) => (b.tiles[s] = pieces[k]));
    if (findRuns(b).length === 0 && hasMove(b)) return b;
  }
  // extremely unlikely: recolour plain pieces until it works
  for (let attempt = 0; attempt < 200; attempt++) {
    for (const s of slots) {
      const p = b.tiles[s] as Piece;
      if (p.special === 'none') p.color = Math.floor(rand(b) * b.colors);
    }
    if (findRuns(b).length === 0 && hasMove(b)) break;
  }
  return b;
}

// ---------- game ----------

export type Goal =
  | { type: 'collect'; color: number; count: number }
  | { type: 'score'; count: number }
  | { type: 'special'; count: number }
  | { type: 'box'; count: number };

export interface Game {
  level: number;
  board: Board;
  moves: number;
  maxMoves: number;
  score: number;
  goals: Goal[];
  progress: number[];
  status: 'playing' | 'won' | 'lost';
  stars: number;
}

export interface GameSetup {
  level: number;
  colors: number;
  moves: number;
  goals: Goal[];
  boxes: { index: number; hp: number }[];
  seed: number;
}

export function newGame(setup: GameSetup): Game {
  return {
    level: setup.level,
    board: createBoard(setup.colors, setup.seed, setup.boxes),
    moves: setup.moves,
    maxMoves: setup.moves,
    score: 0,
    goals: setup.goals,
    progress: setup.goals.map(() => 0),
    status: 'playing',
    stars: 0,
  };
}

export function starsFor(movesLeft: number, maxMoves: number): number {
  if (movesLeft >= Math.ceil(maxMoves * 0.3)) return 3;
  if (movesLeft >= Math.ceil(maxMoves * 0.15)) return 2;
  return 1;
}

function tally(game: Game, steps: Step[]): Game {
  const g = { ...game, progress: [...game.progress] };
  for (const s of steps) {
    g.score += s.score;
    g.goals.forEach((goal, k) => {
      if (goal.type === 'collect') g.progress[k] += s.cleared.filter((c) => c.piece.color === goal.color).length;
      if (goal.type === 'special') g.progress[k] += s.created.length;
      if (goal.type === 'box') g.progress[k] += s.boxesBroken;
    });
  }
  g.goals.forEach((goal, k) => {
    if (goal.type === 'score') g.progress[k] = g.score;
  });
  return g;
}

export function goalsMet(g: Game): boolean {
  return g.goals.every((goal, k) => g.progress[k] >= goal.count);
}

/** After a move or booster: update status and reshuffle when stuck. */
function settle(game: Game, steps: Step[]): { game: Game; steps: Step[] } {
  let g = tally(game, steps);
  if (goalsMet(g)) g = { ...g, status: 'won', stars: starsFor(g.moves, g.maxMoves) };
  else if (g.moves <= 0) g = { ...g, status: 'lost' };
  if (g.status === 'playing' && !hasMove(g.board)) {
    const shuffled = shuffle(g.board);
    steps = [...steps, {
      afterClear: g.board, afterFall: shuffled, cleared: [], created: [], boxesHit: [], boxesBroken: 0, moves: [], spawned: [], score: 0, shuffle: true,
    }];
    g = { ...g, board: shuffled };
  }
  return { game: g, steps };
}

export function playSwap(game: Game, a: number, c: number): { game: Game; steps: Step[] } | null {
  if (game.status !== 'playing') return null;
  const res = swap(game.board, a, c);
  if (!res) return null;
  return settle({ ...game, board: res.board, moves: game.moves - 1 }, res.steps);
}

export function playHammer(game: Game, index: number): { game: Game; steps: Step[] } | null {
  if (game.status !== 'playing') return null;
  const res = hammer(game.board, index);
  if (!res) return null;
  return settle({ ...game, board: res.board }, res.steps);
}

export function playShuffle(game: Game): Game {
  if (game.status !== 'playing') return game;
  return { ...game, board: shuffle(game.board) };
}

export function playRainbow(game: Game, index: number): Game | null {
  if (game.status !== 'playing') return null;
  const board = makeRainbow(game.board, index);
  return board ? { ...game, board } : null;
}

/** ➕5 moves; also revives a lost game. */
export function playExtraMoves(game: Game, n = 5): Game {
  if (game.status === 'won') return game;
  return { ...game, moves: game.moves + n, status: 'playing' };
}
