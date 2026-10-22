/**
 * Endless levels generated from the level number: same number → same level.
 * Difficulty ramps up to level 60 and then plateaus; goals and box layouts keep varying.
 */
import { CELLS, SIZE, type GameSetup, type Goal } from './match3';
import { rand } from './rng';

export const PLATEAU = 60;
export const MIN_MOVES = 15;
export const MAX_BOXES = Math.floor(CELLS / 4);

export interface LevelConfig extends GameSetup {
  chapter: number;
  bonus: boolean; // every 10th level: two goals and an extra booster
}

type GoalType = Goal['type'];

export function colorsFor(n: number): number {
  return n >= 31 ? 6 : n >= 6 ? 5 : 4;
}

export function movesFor(n: number): number {
  return Math.max(MIN_MOVES, 25 - Math.floor((n - 1) / 5));
}

function goalTypes(n: number): GoalType[] {
  return n >= 11 ? ['collect', 'score', 'special', 'box'] : ['collect', 'score', 'special'];
}

function makeGoal(type: GoalType, d: number, colors: number, holder: { rng: number }, used: Set<number>): Goal {
  if (type === 'score') return { type, count: 1500 + d * 120 };
  if (type === 'special') return { type, count: 2 + Math.floor(d / 15) };
  if (type === 'box') return { type, count: 0 }; // filled in once boxes are placed
  let color = Math.floor(rand(holder) * colors);
  while (used.has(color)) color = (color + 1) % colors;
  used.add(color);
  return { type: 'collect', color, count: 12 + Math.floor(d * 0.3) };
}

export function levelConfig(level: number): LevelConfig {
  const n = Math.max(1, Math.floor(level));
  const d = Math.min(n, PLATEAU); // difficulty stops growing after the plateau
  const holder = { rng: n * 9973 + 17 };
  const colors = colorsFor(n);
  const bonus = n % 10 === 0;
  const types = goalTypes(n);

  // rotate goal types; boss levels combine two different ones
  const first = types[(n - 1) % types.length];
  const chosen: GoalType[] = [first];
  if (bonus) chosen.push(types[(n + 1) % types.length] === first ? types[(n + 2) % types.length] : types[(n + 1) % types.length]);

  const goals: Goal[] = [];
  const usedColors = new Set<number>();
  for (const type of chosen) {
    if (type === 'collect') {
      const k = Math.min(colors, 1 + (d > 15 ? 1 : 0) + (d > 40 ? 1 : 0));
      for (let i = 0; i < k; i++) goals.push(makeGoal('collect', d, colors, holder, usedColors));
    } else goals.push(makeGoal(type, d, colors, holder, usedColors));
  }

  // boxes from level 11; hard (2-hit) ones from level 31
  const boxes: { index: number; hp: number }[] = [];
  if (n >= 11) {
    const count = Math.min(MAX_BOXES, 4 + Math.floor((d - 10) * 0.25) + (chosen.includes('box') ? 4 : 0));
    const free = Array.from({ length: CELLS - 2 * SIZE }, (_, i) => i + 2 * SIZE); // keep the top two rows open
    for (let i = 0; i < count && free.length; i++) {
      const [index] = free.splice(Math.floor(rand(holder) * free.length), 1);
      boxes.push({ index, hp: n >= 31 && rand(holder) < 0.35 ? 2 : 1 });
    }
  }
  for (const g of goals) if (g.type === 'box') g.count = boxes.length;

  return {
    level: n,
    colors,
    moves: movesFor(n) + (bonus ? 5 : 0),
    goals,
    boxes,
    seed: holder.rng,
    chapter: Math.ceil(n / 10),
    bonus,
  };
}

/** Chapter palette for the level map / board background. */
export const CHAPTER_THEMES = [
  { name: '草地公園', bg: '#d9f2d0' },
  { name: '海邊沙灘', bg: '#fdf0c8' },
  { name: '糖果工廠', bg: '#fbd9e8' },
  { name: '星空城市', bg: '#d6dcf7' },
  { name: '冰雪山谷', bg: '#d9f1f7' },
  { name: '秋日森林', bg: '#f6dfc8' },
];

export function themeFor(chapter: number) {
  return CHAPTER_THEMES[(chapter - 1) % CHAPTER_THEMES.length];
}
