import {
  CELLS, SIZE, at, createBoard, findRuns, hasMove, isBox, isPiece, newGame, playExtraMoves, playHammer, playSwap, shuffle, swap,
  type Board, type Piece, type Special, type Tile,
} from './match3';

/** Build a board from rows of characters: digits = colour, '.' = random filler, H/V/B/R = specials, X/Y = box hp 1/2. */
function boardFrom(rows: string[], specialsColor = 0): Board {
  // filler pattern that never forms runs on its own (period-3 diagonal of colours 3,4,5)
  const filler = (r: number, c: number) => 3 + ((r + c * 2) % 3);
  let id = 1;
  const tiles: Tile[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const ch = rows[r]?.[c] ?? '.';
      const piece = (color: number, special: Special = 'none'): Piece => ({ kind: 'piece', id: id++, color: special === 'rainbow' ? -1 : color, special });
      if (ch === '.') tiles.push(piece(filler(r, c)));
      else if (ch === 'X' || ch === 'Y') tiles.push({ kind: 'box', id: id++, hp: ch === 'X' ? 1 : 2 });
      else if (ch === 'H') tiles.push(piece(specialsColor, 'line-h'));
      else if (ch === 'V') tiles.push(piece(specialsColor, 'line-v'));
      else if (ch === 'B') tiles.push(piece(specialsColor, 'bomb'));
      else if (ch === 'R') tiles.push(piece(-1, 'rainbow'));
      else tiles.push(piece(Number(ch)));
    }
  }
  return { tiles, colors: 6, rng: 12345, nextId: id };
}

const noHoles = (b: Board) => b.tiles.every((t) => t !== null);

describe('board creation', () => {
  it('has no runs, at least one move, and is reproducible', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const b = createBoard(5, seed);
      expect(findRuns(b)).toHaveLength(0);
      expect(hasMove(b)).toBe(true);
    }
    expect(createBoard(6, 99)).toEqual(createBoard(6, 99));
  });

  it('keeps boxes where they were placed', () => {
    const b = createBoard(5, 7, [{ index: 20, hp: 2 }]);
    expect(b.tiles[20]).toMatchObject({ kind: 'box', hp: 2 });
  });
});

describe('matching', () => {
  it('finds horizontal and vertical runs', () => {
    const b = boardFrom(['000.....', '1.......', '1.......', '1.......']);
    const runs = findRuns(b);
    expect(runs.map((r) => [r.dir, r.cells.length]).sort()).toEqual([['h', 3], ['v', 3]]);
  });

  it('rejects swaps that make no match', () => {
    const b = boardFrom(['01......']);
    expect(swap(b, at(0, 0), at(0, 1))).toBeNull();
  });

  it('clears a simple match and refills without holes', () => {
    // moving the 0 at (0,3) left makes 0 0 0 in row 0
    const b = boardFrom(['00.0....']);
    const res = swap(b, at(0, 3), at(0, 2))!;
    expect(res.steps[0].cleared.map((c) => c.index).sort((x, y) => x - y)).toEqual([at(0, 0), at(0, 1), at(0, 2)]);
    expect(noHoles(res.board)).toBe(true);
    expect(findRuns(res.board)).toHaveLength(0);
  });

  it('only swaps neighbours', () => {
    expect(swap(boardFrom(['00.0....']), at(0, 3), at(0, 1))).toBeNull();
  });
});

describe('specials', () => {
  it('four in a row makes a line brick at the swapped cell', () => {
    const res = swap(boardFrom(['00.0....', '..0.....']), at(1, 2), at(0, 2))!;
    expect(res.steps[0].created).toHaveLength(1);
    expect(res.steps[0].created[0]).toMatchObject({ index: at(0, 2), piece: { special: 'line-h', color: 0 } });
  });

  it('five in a row makes a rainbow brick', () => {
    const res = swap(boardFrom(['00.00...', '..0.....']), at(1, 2), at(0, 2))!;
    expect(res.steps[0].created[0]).toMatchObject({ index: at(0, 2), piece: { special: 'rainbow' } });
  });

  it('an L shape makes a bomb where the lines meet', () => {
    // column 0 rows 0-2 and row 2 cols 0-2 once the 0 at (3,0) moves up
    const res = swap(boardFrom(['0.......', '0.......', '.00.....', '0.......']), at(3, 0), at(2, 0))!;
    expect(res.steps[0].created[0]).toMatchObject({ index: at(2, 0), piece: { special: 'bomb' } });
  });

  it('a line brick in a match clears its whole row', () => {
    const res = swap(boardFrom(['0.H0....', '.0......']), at(1, 1), at(0, 1))!;
    expect(res.steps[0].cleared.filter((c) => Math.floor(c.index / SIZE) === 0)).toHaveLength(SIZE);
  });

  it('a bomb clears the 3×3 around it', () => {
    const res = swap(boardFrom(['........', '0.B0....', '.0......']), at(2, 1), at(1, 1))!; // row 1 becomes 0 0 B 0
    const area = [0, 1, 2].flatMap((rr) => [1, 2, 3].map((cc) => at(rr, cc)));
    const cleared = new Set(res.steps[0].cleared.map((c) => c.index));
    expect(area.every((i) => cleared.has(i))).toBe(true);
  });

  it('rainbow swapped with a colour clears every piece of that colour', () => {
    const b = boardFrom(['R1......', '1.1.....', '..1.....']);
    const ones = b.tiles.filter((t) => isPiece(t) && t.color === 1).length;
    const res = swap(b, at(0, 0), at(0, 1))!;
    expect(res.steps[0].cleared.filter((c) => c.piece.color === 1)).toHaveLength(ones);
    expect(noHoles(res.board)).toBe(true);
  });

  it('two specials swapped together go off as a combo', () => {
    const res = swap(boardFrom(['HV......']), at(0, 0), at(0, 1))!;
    expect(res.steps[0].cleared.length).toBeGreaterThanOrEqual(15); // row 0 + column 1
  });
});

describe('boxes', () => {
  it('are damaged by neighbouring clears and break at 0 hp', () => {
    const res = swap(boardFrom(['00.0....', 'XY......']), at(0, 3), at(0, 2))!;
    expect(res.steps[0].boxesBroken).toBe(1); // the 1-hp box under (0,0)
    expect(res.board.tiles[at(1, 1)]).toMatchObject({ kind: 'box', hp: 1 }); // the 2-hp box survives
  });

  it('never move while pieces fall around them', () => {
    const res = swap(boardFrom(['00.0....', '........', 'X.......']), at(0, 3), at(0, 2))!;
    expect(isBox(res.board.tiles[at(2, 0)])).toBe(true);
    expect(noHoles(res.board)).toBe(true);
  });
});

describe('game', () => {
  const setup = { level: 1, colors: 5, moves: 3, goals: [{ type: 'score' as const, count: 999999 }], boxes: [], seed: 4 };

  it('is deterministic for the same seed and never mutates its input', () => {
    const g = newGame(setup);
    const copy = structuredClone(g);
    let move: [number, number] | null = null;
    for (let i = 0; i < CELLS && !move; i++) {
      if (i % SIZE < SIZE - 1 && playSwap(g, i, i + 1)) move = [i, i + 1];
      else if (i < CELLS - SIZE && playSwap(g, i, i + SIZE)) move = [i, i + SIZE];
    }
    expect(move).not.toBeNull();
    const a = playSwap(g, ...move!)!;
    const b = playSwap(newGame(setup), ...move!)!;
    expect(a.game).toEqual(b.game);
    expect(g).toEqual(copy);
    expect(a.game.moves).toBe(2);
  });

  it('loses when moves run out and can be revived with +5', () => {
    let g = newGame({ ...setup, moves: 1 });
    for (let i = 0; i < CELLS; i++) {
      const r = playSwap(g, i, i + 1) ?? playSwap(g, i, i + SIZE);
      if (r) {
        g = r.game;
        break;
      }
    }
    expect(g.status).toBe('lost');
    const revived = playExtraMoves(g);
    expect(revived).toMatchObject({ status: 'playing', moves: 5 });
  });

  it('wins with stars once every goal is met', () => {
    const g = newGame({ ...setup, goals: [{ type: 'score', count: 1 }] });
    const res = playHammer(g, 10)!;
    expect(res.game.status).toBe('won');
    expect(res.game.stars).toBe(3);
  });

  it('shuffle keeps boxes and leaves a playable board', () => {
    const b = createBoard(6, 3, [{ index: 30, hp: 1 }]);
    const s = shuffle(b);
    expect(isBox(s.tiles[30])).toBe(true);
    expect(findRuns(s)).toHaveLength(0);
    expect(hasMove(s)).toBe(true);
  });

  it('survives long random play without holes or stuck boards', () => {
    for (let seed = 1; seed <= 15; seed++) {
      let g = newGame({ ...setup, moves: 40, seed, boxes: [{ index: 40, hp: 2 }, { index: 45, hp: 1 }] });
      for (let turn = 0; turn < 40 && g.status === 'playing'; turn++) {
        let moved = false;
        for (let i = (turn * 7) % CELLS, n = 0; n < CELLS && !moved; i = (i + 1) % CELLS, n++) {
          const r = (i % SIZE < SIZE - 1 ? playSwap(g, i, i + 1) : null) ?? (i < CELLS - SIZE ? playSwap(g, i, i + SIZE) : null);
          if (r) {
            g = r.game;
            moved = true;
          }
        }
        expect(moved).toBe(true);
        expect(noHoles(g.board)).toBe(true);
        expect(findRuns(g.board)).toHaveLength(0);
      }
    }
  });
});
