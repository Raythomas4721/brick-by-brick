import type { Category } from '../tasks/types';
import type { City } from './engine';
import { GROUND, SHEET_COLS, TILE, groundFor, scenery, spriteFor, type Sprite, type Tile } from './sprites';

export const CELL = TILE * 2;
/** Headroom so tall buildings on the first row aren't clipped. */
export const TOP = TILE;
const CONE = 680;

export interface Citizen {
  x: number; // canvas px
  y: number;
  tx: number;
  ty: number;
  color: string;
  step: number;
}

export interface LandmarkInfo {
  category: Category;
  level: number;
}

export interface RenderOptions {
  city: City;
  landmarks: Record<string, LandmarkInfo>;
  night: boolean;
  selected: { x: number; y: number } | null;
  preview: { x: number; y: number; ok: boolean } | null;
  citizens: Citizen[];
}

export function canvasSize(city: City): { width: number; height: number } {
  return { width: city.size * CELL, height: city.size * CELL + TOP };
}

function drawTile(g: CanvasRenderingContext2D, img: HTMLImageElement, tile: Tile, px: number, py: number) {
  for (const id of ([] as number[]).concat(tile)) {
    if (id < 0) continue;
    g.drawImage(img, (id % SHEET_COLS) * TILE, Math.floor(id / SHEET_COLS) * TILE, TILE, TILE, px, py, TILE, TILE);
  }
}

/** Draw a sprite whose bottom row sits on the bottom half of cell (x, y). */
function drawSprite(g: CanvasRenderingContext2D, img: HTMLImageElement, sprite: Sprite, x: number, y: number) {
  const bottom = TOP + y * CELL + TILE;
  sprite.forEach((row, r) => {
    const py = bottom - (sprite.length - 1 - r) * TILE;
    row.forEach((tile, c) => drawTile(g, img, tile, x * CELL + c * TILE, py));
  });
}

function drawCitizen(g: CanvasRenderingContext2D, c: Citizen) {
  const x = Math.round(c.x) - 1;
  const y = Math.round(c.y) - 6;
  g.fillStyle = '#f1c27d';
  g.fillRect(x + 1, y, 2, 2);
  g.fillStyle = c.color;
  g.fillRect(x, y + 2, 4, 3);
  g.fillStyle = '#2d2a3a';
  const stride = Math.floor(c.step) % 2;
  g.fillRect(x + (stride ? 0 : 1), y + 5, 1, 1);
  g.fillRect(x + (stride ? 3 : 2), y + 5, 1, 1);
}

export function drawCity(g: CanvasRenderingContext2D, img: HTMLImageElement, o: RenderOptions) {
  const { city } = o;
  const { width, height } = canvasSize(city);
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#5f9e4f';
  g.fillRect(0, 0, width, height);
  for (let x = 0; x < city.size * 2; x++) for (let r = 0; r < TOP / TILE; r++) drawTile(g, img, GROUND.grass[(x + r) % 2], x * TILE, r * TILE);

  for (let y = 0; y < city.size; y++) {
    for (let x = 0; x < city.size; x++) {
      const cell = city.cells[y * city.size + x];
      groundFor(cell, x, y).forEach((row, r) =>
        row.forEach((tile, c) => drawTile(g, img, tile, x * CELL + c * TILE, TOP + y * CELL + r * TILE)),
      );
      if (cell.t === 'zone' && cell.level === 0) {
        const color = cell.zone === 'R' ? 'rgba(46, 160, 67, 0.95)' : 'rgba(37, 99, 235, 0.95)';
        const px = x * CELL;
        const py = TOP + y * CELL;
        g.strokeStyle = color;
        g.setLineDash([3, 2]);
        g.strokeRect(px + 2.5, py + 2.5, CELL - 5, CELL - 5);
        g.setLineDash([]);
        // "coming soon" signboard + traffic cone so an empty lot reads as a building site
        g.fillStyle = '#6b4a2b';
        g.fillRect(px + 9, py + 12, 1, 9);
        g.fillStyle = color;
        g.fillRect(px + 5, py + 7, 9, 6);
        g.fillStyle = '#fff';
        g.fillRect(px + 7, py + 9, 5, 1);
        g.fillRect(px + 7, py + 11, 3, 1);
        drawTile(g, img, CONE, px + TILE, py + TILE);
      }
    }
  }

  for (const c of o.citizens) drawCitizen(g, c);

  for (let y = 0; y < city.size; y++) {
    for (let x = 0; x < city.size; x++) {
      const cell = city.cells[y * city.size + x];
      const sprite = cell.t === 'empty' ? scenery(x, y) : spriteFor(cell, cell.t === 'landmark' ? o.landmarks[cell.taskId] : undefined);
      if (sprite) drawSprite(g, img, sprite, x, y);
    }
  }

  if (o.night) {
    g.fillStyle = 'rgba(12, 18, 52, 0.58)';
    g.fillRect(0, 0, width, height);
    // a few lit windows so the city looks asleep, not abandoned
    g.fillStyle = 'rgba(255, 214, 110, 0.85)';
    city.cells.forEach((cell, i) => {
      if (cell.t === 'zone' && cell.level > 0 && i % 3 !== 0) {
        const x = (i % city.size) * CELL;
        const y = TOP + Math.floor(i / city.size) * CELL;
        g.fillRect(x + 21, y + 21, 3, 3);
      }
    });
  }

  if (o.preview) {
    g.fillStyle = o.preview.ok ? 'rgba(255, 255, 255, 0.28)' : 'rgba(220, 38, 38, 0.35)';
    g.fillRect(o.preview.x * CELL, TOP + o.preview.y * CELL, CELL, CELL);
  }
  if (o.selected) {
    g.strokeStyle = '#facc15';
    g.lineWidth = 2;
    g.strokeRect(o.selected.x * CELL + 1, TOP + o.selected.y * CELL + 1, CELL - 2, CELL - 2);
    g.lineWidth = 1;
  }
}

const SHIRTS = ['#e85d75', '#4f8ff7', '#f2b134', '#43b581', '#a06cd5', '#f07f3c'];

/** Keep the walking crowd in step with the population and the road network. */
export function syncCitizens(list: Citizen[], city: City, population: number, seed: number): Citizen[] {
  const roads = city.cells.flatMap((cell, i) => (cell.t === 'road' ? [i] : []));
  if (roads.length === 0) return [];
  const want = Math.min(28, Math.ceil(population / 5));
  const kept = list.slice(0, want).filter((c) => isRoad(city, c.tx, c.ty));
  while (kept.length < want) {
    const i = roads[(seed + kept.length * 7919) % roads.length];
    const [x, y] = cellCenter(city, i, kept.length);
    kept.push({ x, y, tx: x, ty: y, color: SHIRTS[kept.length % SHIRTS.length], step: 0 });
  }
  return kept;
}

function isRoad(city: City, px: number, py: number): boolean {
  const x = Math.floor(px / CELL);
  const y = Math.floor((py - TOP) / CELL);
  return city.cells[y * city.size + x]?.t === 'road' && x >= 0 && x < city.size;
}

function cellCenter(city: City, i: number, jitter: number): [number, number] {
  const x = (i % city.size) * CELL + 8 + ((jitter * 5) % 16);
  const y = TOP + Math.floor(i / city.size) * CELL + 10 + ((jitter * 3) % 14);
  return [x, y];
}

/** Advance every citizen a little; pick a neighbouring road cell when they arrive. */
export function stepCitizens(list: Citizen[], city: City, dt: number): void {
  for (const c of list) {
    const dx = c.tx - c.x;
    const dy = c.ty - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) {
      const cx = Math.floor(c.x / CELL);
      const cy = Math.floor((c.y - TOP) / CELL);
      const options = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([ox, oy]) => [cx + ox, cy + oy])
        .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < city.size && ny < city.size && city.cells[ny * city.size + nx].t === 'road');
      if (options.length === 0) continue;
      const [nx, ny] = options[Math.floor(Math.random() * options.length)];
      [c.tx, c.ty] = cellCenter(city, ny * city.size + nx, Math.floor(Math.random() * 6));
      continue;
    }
    const speed = Math.min(dist, dt * 0.012);
    c.x += (dx / dist) * speed;
    c.y += (dy / dist) * speed;
    c.step += dt * 0.008;
  }
}
