import { MAX_BOXES, MIN_MOVES, PLATEAU, colorsFor, levelConfig, movesFor } from './levels';
import { findRuns, hasMove, isBox, newGame } from './match3';

describe('levels', () => {
  it('generates levels 1–300 that start playable', () => {
    for (let n = 1; n <= 300; n++) {
      const cfg = levelConfig(n);
      expect(cfg.goals.length).toBeGreaterThan(0);
      expect(cfg.moves).toBeGreaterThanOrEqual(MIN_MOVES);
      expect(cfg.boxes.length).toBeLessThanOrEqual(MAX_BOXES);
      const g = newGame(cfg);
      expect(findRuns(g.board)).toHaveLength(0);
      expect(hasMove(g.board)).toBe(true);
      for (const b of cfg.boxes) expect(isBox(g.board.tiles[b.index])).toBe(true);
      for (const goal of cfg.goals) {
        expect(goal.count).toBeGreaterThan(0);
        if (goal.type === 'collect') expect(goal.color).toBeLessThan(cfg.colors);
      }
    }
  });

  it('is the same level every time', () => {
    expect(levelConfig(42)).toEqual(levelConfig(42));
    expect(newGame(levelConfig(42))).toEqual(newGame(levelConfig(42)));
  });

  it('follows the difficulty curve', () => {
    expect([1, 5, 6, 30, 31, 500].map(colorsFor)).toEqual([4, 4, 5, 5, 6, 6]);
    expect(movesFor(1)).toBe(25);
    expect(movesFor(6)).toBe(24);
    expect(movesFor(200)).toBe(MIN_MOVES);
    expect(levelConfig(10).boxes).toHaveLength(0);
    expect(levelConfig(11).boxes.length).toBeGreaterThan(0);
    expect(levelConfig(30).boxes.every((b) => b.hp === 1)).toBe(true);
    expect(Array.from({ length: 60 }, (_, i) => levelConfig(31 + i)).some((c) => c.boxes.some((b) => b.hp === 2))).toBe(true);
  });

  it('stops getting harder after the plateau but keeps varying', () => {
    const counts = (n: number) => levelConfig(n).goals.map((g) => g.count);
    // the same goal type at the same rotation position has the same size past the plateau
    expect(counts(PLATEAU + 4)).toEqual(counts(PLATEAU + 4 + 40));
    const layouts = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(levelConfig(PLATEAU + 1 + i * 4).boxes)));
    expect(layouts.size).toBeGreaterThan(10);
  });

  it('makes every 10th level a two-goal bonus level', () => {
    for (const n of [10, 20, 50, 100]) {
      const cfg = levelConfig(n);
      expect(cfg.bonus).toBe(true);
      expect(new Set(cfg.goals.map((g) => g.type)).size).toBe(2);
      expect(cfg.chapter).toBe(n / 10);
    }
    expect(levelConfig(11).bonus).toBe(false);
  });
});
