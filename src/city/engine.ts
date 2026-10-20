/** Pure city rules: zoning, growth, population and happiness. */

export type Zone = 'R' | 'C';
export type Service = 'park' | 'police' | 'fire';

export type Cell =
  | { t: 'empty' }
  | { t: 'road' }
  | { t: 'zone'; zone: Zone; level: number; variant: number }
  | { t: 'service'; kind: Service }
  | { t: 'landmark'; taskId: string };

export interface City {
  name: string;
  size: number;
  cells: Cell[];
  rng: number;
  bank: number; // construction ticks earned while nothing could grow
}

export type Tool = 'inspect' | 'road' | Zone | Service | 'landmark' | 'bulldoze';

export const TOOLS: Record<Exclude<Tool, 'inspect'>, { label: string; icon: string; cost: number }> = {
  road: { label: '道路', icon: '🛣️', cost: 10 },
  R: { label: '住宅區', icon: '🏠', cost: 20 },
  C: { label: '商業區', icon: '🏪', cost: 20 },
  park: { label: '公園', icon: '🌳', cost: 80 },
  police: { label: '警察局', icon: '🚓', cost: 250 },
  fire: { label: '消防局', icon: '🚒', cost: 250 },
  landmark: { label: '習慣地標', icon: '🏛️', cost: 0 },
  bulldoze: { label: '拆除', icon: '🧹', cost: 0 },
};

export const RESIDENTS = [0, 4, 10, 20];
export const JOBS = [0, 3, 8, 15];
export const RADIUS: Record<Service, number> = { police: 4, fire: 4, park: 2 };
export const BANK_LIMIT = 30;
export const STREAK_TIERS = [7, 30, 100];

const CITY_TITLES: [number, string][] = [
  [500, '大都會'], [250, '城市'], [100, '城鎮'], [30, '小鎮'], [0, '小村莊'],
];

export interface Context {
  activeDays: number; // days with completions in the last week
  landmarkLevels: Record<string, number>; // taskId -> 0..3
}

// ---------- helpers ----------

function nextRandom(seed: number): [number, number] {
  const t = (seed + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t];
}

function rand(c: City): number {
  const [v, next] = nextRandom(c.rng);
  c.rng = next;
  return v;
}

export function cellAt(c: City, x: number, y: number): Cell | null {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return null;
  return c.cells[y * c.size + x];
}

function coords(c: City, i: number): [number, number] {
  return [i % c.size, Math.floor(i / c.size)];
}

export function hasRoadAccess(c: City, x: number, y: number): boolean {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => cellAt(c, x + dx, y + dy)?.t === 'road');
}

export function landmarkLevel(streak: number): number {
  return STREAK_TIERS.filter((n) => streak >= n).length;
}

export function cityTitle(population: number): string {
  return CITY_TITLES.find(([n]) => population >= n)![1];
}

export function zoneName(cell: Cell): string {
  if (cell.t !== 'zone') return '';
  if (cell.level === 0) return cell.zone === 'R' ? '住宅用地' : '商業用地';
  if (cell.zone === 'R') return ['', '小屋', '透天厝', '公寓'][cell.level];
  return cell.variant % 2 === 0 ? ['', '雜貨店', '商店', '百貨行'][cell.level] : ['', '小吃攤', '餐廳', '美食廣場'][cell.level];
}

// ---------- city creation & placement ----------

export function newCity(name: string, seed: number, size = 10): City {
  const cells: Cell[] = Array.from({ length: size * size }, () => ({ t: 'empty' }));
  const mid = Math.floor(size / 2);
  for (let i = 0; i < size; i++) cells[mid * size + i] = { t: 'road' };
  for (let i = 0; i < mid; i++) cells[i * size + 3] = { t: 'road' };
  return { name, size, cells, rng: seed, bank: 0 };
}

/** Why `tool` can't go at (x, y), or null when it can. Cost is checked by the caller. */
export function placeError(c: City, tool: Tool, x: number, y: number): string | null {
  const cell = cellAt(c, x, y);
  if (!cell || tool === 'inspect') return '這裡不能蓋';
  if (tool === 'bulldoze') return cell.t === 'empty' ? '這裡已經是空地' : null;
  if (cell.t !== 'empty') return '這格已經有東西了，先拆除才能蓋';
  return null;
}

export function place(city: City, tool: Tool, x: number, y: number, taskId?: string): City {
  if (placeError(city, tool, x, y)) return city;
  const c = structuredClone(city);
  const i = y * c.size + x;
  if (tool === 'bulldoze') c.cells[i] = { t: 'empty' };
  else if (tool === 'road') c.cells[i] = { t: 'road' };
  else if (tool === 'R' || tool === 'C') c.cells[i] = { t: 'zone', zone: tool, level: 0, variant: 0 };
  else if (tool === 'landmark') {
    if (!taskId) return city;
    c.cells = c.cells.map((cell) => (cell.t === 'landmark' && cell.taskId === taskId ? { t: 'empty' } : cell));
    c.cells[i] = { t: 'landmark', taskId };
  } else c.cells[i] = { t: 'service', kind: tool as Service };
  return c;
}

/** A deleted habit leaves a park behind instead of a hole. */
export function retireLandmark(city: City, taskId: string): City {
  if (!city.cells.some((cell) => cell.t === 'landmark' && cell.taskId === taskId)) return city;
  return {
    ...city,
    cells: city.cells.map((cell) => (cell.t === 'landmark' && cell.taskId === taskId ? { t: 'service', kind: 'park' } : cell)),
  };
}

// ---------- statistics ----------

export interface Stats {
  population: number;
  jobs: number;
  homes: number; // developed residential lots
  happiness: number;
  breakdown: { label: string; value: number; max: number; tip: string }[];
  maxResidential: number;
  maxCommercial: number;
  title: string;
}

function covered(c: City, x: number, y: number, kind: Service): boolean {
  const r = RADIUS[kind];
  return c.cells.some((cell, i) => {
    if (cell.t !== 'service' || cell.kind !== kind) return false;
    const [sx, sy] = coords(c, i);
    return Math.abs(sx - x) + Math.abs(sy - y) <= r;
  });
}

export function coverage(c: City, kind: Service): number {
  const homes = c.cells.map((cell, i) => [cell, i] as const).filter(([cell]) => cell.t === 'zone' && cell.zone === 'R' && cell.level > 0);
  if (homes.length === 0) return 0;
  return homes.filter(([, i]) => covered(c, ...coords(c, i), kind)).length / homes.length;
}

export function stats(c: City, ctx: Context): Stats {
  let population = 0;
  let jobs = 0;
  let homes = 0;
  for (const cell of c.cells) {
    if (cell.t !== 'zone') continue;
    if (cell.zone === 'R') {
      population += RESIDENTS[cell.level];
      if (cell.level > 0) homes++;
    } else jobs += JOBS[cell.level];
  }
  const landmarks = c.cells.filter((cell): cell is Extract<Cell, { t: 'landmark' }> => cell.t === 'landmark');
  const landmarkScore = Math.min(10, landmarks.reduce((s, l) => s + 2 + (ctx.landmarkLevels[l.taskId] ?? 0), 0));
  const commerce = population === 0 ? 0 : Math.min(1, jobs / (population * 0.3));
  const breakdown = [
    { label: '基本', value: 40, max: 40, tip: '' },
    { label: '治安', value: Math.round(coverage(c, 'police') * 15), max: 15, tip: '在住宅附近 4 格內蓋警察局' },
    { label: '消防', value: Math.round(coverage(c, 'fire') * 15), max: 15, tip: '在住宅附近 4 格內蓋消防局' },
    { label: '綠地', value: Math.round(coverage(c, 'park') * 10), max: 10, tip: '在住宅附近 2 格內蓋公園' },
    { label: '購物', value: Math.round(commerce * 10), max: 10, tip: '商業區的工作數要有人口的三成' },
    { label: '市長勤勞', value: Math.min(14, ctx.activeDays * 2), max: 14, tip: '最近 7 天每天完成至少一件事' },
    { label: '地標', value: landmarkScore, max: 10, tip: '把習慣地標放進城市，連續天數越長越加分' },
  ];
  const happiness = Math.min(100, breakdown.reduce((s, b) => s + b.value, 0));
  return {
    population, jobs, homes, happiness, breakdown,
    maxResidential: happiness < 50 ? 1 : happiness < 70 ? 2 : 3,
    maxCommercial: population < 30 ? 1 : population < 100 ? 2 : 3,
    title: cityTitle(population),
  };
}

// ---------- growth ----------

export interface GrowthResult {
  city: City;
  events: string[];
  used: number;
}

/** Spend `ticks` (plus banked ticks) developing zoned lots that touch a road. */
export function grow(city: City, ticks: number, ctx: Context): GrowthResult {
  const c = structuredClone(city);
  let budget = ticks + c.bank;
  let used = 0;
  let movedIn = 0;
  const opened: string[] = [];
  while (budget > 0) {
    const st = stats(c, ctx);
    const candidates = (zone: Zone, max: number) =>
      c.cells
        .map((cell, i) => [cell, i] as const)
        .filter(([cell, i]) => cell.t === 'zone' && cell.zone === zone && cell.level < max && hasRoadAccess(c, ...coords(c, i)));
    const homes = candidates('R', st.maxResidential);
    const shops = candidates('C', st.maxCommercial);
    const wantShops = st.population > 0 && st.jobs < st.population * 0.3;
    const pool = wantShops && shops.length ? shops : homes.length ? homes : shops;
    if (pool.length === 0) break;
    const lowest = Math.min(...pool.map(([cell]) => (cell as Extract<Cell, { t: 'zone' }>).level));
    const tier = pool.filter(([cell]) => (cell as Extract<Cell, { t: 'zone' }>).level === lowest);
    const [, i] = tier[Math.floor(rand(c) * tier.length)];
    const cell = c.cells[i] as Extract<Cell, { t: 'zone' }>;
    if (cell.level === 0) cell.variant = Math.floor(rand(c) * 6);
    cell.level++;
    if (cell.zone === 'R') movedIn += RESIDENTS[cell.level] - RESIDENTS[cell.level - 1];
    else opened.push(zoneName(cell));
    budget--;
    used++;
  }
  c.bank = Math.min(BANK_LIMIT, budget);
  const events: string[] = [];
  if (movedIn > 0) events.push(`👋 ${movedIn} 位市民搬進來了`);
  for (const name of opened) events.push(`🏪 ${name}開幕了`);
  return { city: c, events, used };
}
