/**
 * Building compositions from Kenney's "Roguelike Modern City" sheet (CC0).
 * Tile ids index the packed 37-column sheet; an array stacks tiles bottom-up.
 * Each cell is 2×2 tiles; buildings are at most 3 tiles tall, so they overlap only the
 * lower half of the cell behind them.
 */
import type { Category } from '../tasks/types';
import type { Cell } from './engine';

export type Tile = number | number[];
export type Sprite = Tile[][]; // rows top → bottom, 2 tiles wide

export const SHEET_COLS = 37;
export const TILE = 16;

const ROOF2 = { red: [[0, 1], [37, 38]], gray: [[8, 9], [45, 46]], light: [[16, 17], [53, 54]], tan: [[24, 25], [61, 62]] };
const ROOF1 = { red: [75, 77], gray: [83, 85], light: [91, 93], tan: [99, 101] };
// ground-floor wall (with ledge) and upper-floor wall, left and right halves
const WALL = {
  brick: { low: [296, 299], up: [222, 225] },
  gray: { low: [300, 303], up: [226, 229] },
  tan: { low: [304, 307], up: [230, 233] },
  glass: { low: [308, 311], up: [234, 237] },
};
type Roof = keyof typeof ROOF1;
type Wall = keyof typeof WALL;

const WIN = { wood: 580, paned: 617, gray: 691, wide: 582 };
const DOOR = { glass: 620, framed: 621, gray: 695 };
const AWNING = { green: [467, 470], orange: [471, 473] };
const SIGN = { orange: [290, 292], teal: [182, 184], green: [179, 181] };
const PRODUCE = [676, 677];
const VENT = 543;

export const GROUND = {
  grass: [888, 889],
  road: 714,
  lotR: 706,
  lotC: 703,
  plaza: 709,
};
const TREE_TALL = [[401, 438], [402, 439], [403, 440]];
const BUSH = [512, 513, 514];

/** One wall row: each side is the wall tile with an optional overlay. */
function wallRow(wall: Wall, floor: 'low' | 'up', left?: number, right?: number): Tile[] {
  const [l, r] = WALL[wall][floor];
  return [left === undefined ? l : [l, left], right === undefined ? r : [r, right]];
}

function overlayRow(wall: Wall, pair: number[]): Tile[] {
  return wallRow(wall, 'up', pair[0], pair[1]);
}

function roof2(roof: Roof): Tile[][] {
  return ROOF2[roof];
}

function roof1(roof: Roof, props = false): Tile[] {
  const [l, r] = ROOF1[roof];
  return props ? [l, [r, VENT]] : [l, r];
}

const R_STYLES: { roof: Roof; wall: Wall }[] = [
  { roof: 'red', wall: 'brick' },
  { roof: 'gray', wall: 'gray' },
  { roof: 'tan', wall: 'tan' },
];

function residential(level: number, variant: number): Sprite {
  const { roof, wall } = R_STYLES[variant % R_STYLES.length];
  if (level === 1) return [roof1(roof), wallRow(wall, 'low', DOOR.glass, WIN.wood)];
  if (level === 2) return [...roof2(roof), wallRow(wall, 'low', DOOR.framed, WIN.paned)];
  return [roof1(roof, true), wallRow(wall, 'up', WIN.paned, WIN.paned), wallRow(wall, 'low', DOOR.glass, WIN.paned)];
}

function commercial(level: number, variant: number): Sprite {
  const restaurant = variant % 2 === 1;
  const awning = restaurant ? AWNING.orange : AWNING.green;
  const wall: Wall = variant % 3 === 0 ? 'brick' : variant % 3 === 1 ? 'gray' : 'tan';
  const front = wallRow(wall, 'low', DOOR.glass, restaurant ? WIN.wide : PRODUCE[variant % 2]);
  if (level === 1) return [overlayRow(wall, awning), front];
  if (level === 2) return [roof1('light'), overlayRow(wall, awning), front];
  return [roof1('gray', true), overlayRow('glass', restaurant ? SIGN.orange : SIGN.green), wallRow('glass', 'low', DOOR.glass, restaurant ? WIN.wide : PRODUCE[0])];
}

function park(): Sprite {
  const g = GROUND.grass;
  return [
    [[g[0], TREE_TALL[0][0]], [g[1], TREE_TALL[2][0]]],
    [[g[0], TREE_TALL[0][1]], [g[1], TREE_TALL[2][1]]],
  ];
}

function police(): Sprite {
  return [roof1('gray'), overlayRow('gray', SIGN.teal), wallRow('gray', 'low', DOOR.gray, WIN.gray)];
}

function fire(): Sprite {
  return [roof1('red'), overlayRow('brick', SIGN.orange), wallRow('brick', 'low', DOOR.framed, DOOR.framed)];
}

const LANDMARK_STYLE: Record<Category, { roof: Roof; wall: Wall; sign: number[]; win: number }> = {
  study: { roof: 'tan', wall: 'tan', sign: SIGN.green, win: WIN.paned },
  health: { roof: 'light', wall: 'gray', sign: SIGN.orange, win: WIN.wide },
  life: { roof: 'red', wall: 'brick', sign: SIGN.green, win: WIN.wood },
  work: { roof: 'gray', wall: 'glass', sign: SIGN.teal, win: WIN.gray },
};

function landmark(category: Category, level: number): Sprite {
  const s = LANDMARK_STYLE[category];
  const ground = wallRow(s.wall, 'low', DOOR.glass, s.win);
  if (level === 0) return [roof1(s.roof), ground];
  if (level === 1) return [...roof2(s.roof), ground];
  if (level === 2) return [roof1(s.roof), wallRow(s.wall, 'up', s.win, s.win), ground];
  return [roof1(s.roof, true), overlayRow(s.wall, s.sign), ground];
}

export function groundFor(cell: Cell, x: number, y: number): Tile[][] {
  if (cell.t === 'road') return [[GROUND.road, GROUND.road], [GROUND.road, GROUND.road]];
  if (cell.t === 'zone' && cell.level === 0) {
    const t = cell.zone === 'R' ? GROUND.lotR : GROUND.lotC;
    return [[t, t], [t, t]];
  }
  if (cell.t === 'landmark') return [[GROUND.plaza, GROUND.plaza], [GROUND.plaza, GROUND.plaza]];
  const g = GROUND.grass;
  const a = g[(x + y) % 2];
  const b = g[(x + y + 1) % 2];
  return [[a, b], [b, a]];
}

/** Decoration on otherwise empty grass so the map doesn't look flat. */
export function scenery(x: number, y: number): Sprite | null {
  const h = (x * 73 + y * 151) % 17;
  if (h === 3) return [[-1, -1], [BUSH[(x + y) % 3], -1]];
  if (h === 11) return [[-1, -1], [-1, BUSH[(x * 2 + y) % 3]]];
  return null;
}

export function spriteFor(cell: Cell, landmarkInfo?: { category: Category; level: number }): Sprite | null {
  if (cell.t === 'zone') {
    if (cell.level === 0) return null;
    return cell.zone === 'R' ? residential(cell.level, cell.variant) : commercial(cell.level, cell.variant);
  }
  if (cell.t === 'service') return cell.kind === 'park' ? park() : cell.kind === 'police' ? police() : fire();
  if (cell.t === 'landmark' && landmarkInfo) return landmark(landmarkInfo.category, landmarkInfo.level);
  return null;
}
