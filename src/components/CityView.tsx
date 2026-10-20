import { useEffect, useMemo, useRef, useState } from 'react';
import {
  JOBS, RADIUS, RESIDENTS, TOOLS, cellAt, hasRoadAccess, placeError, zoneName, type Cell, type Tool,
} from '../city/engine';
import { CELL, TOP, canvasSize, drawCity, stepCitizens, syncCitizens, type Citizen, type LandmarkInfo } from '../city/render';
import { CATEGORIES, isRecurring, streak } from '../tasks/types';
import type { AppApi } from '../useApp';

const TOOL_ORDER: Tool[] = ['inspect', 'road', 'R', 'C', 'park', 'police', 'fire', 'landmark', 'bulldoze'];
const PAINTABLE = new Set<Tool>(['road', 'R', 'C', 'bulldoze']);

function useSheet(): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = `${import.meta.env.BASE_URL}assets/modern.png`;
  }, []);
  return img;
}

function describe(cell: Cell, app: AppApi, x: number, y: number): { title: string; lines: string[] } {
  const { data, ctx } = app;
  if (cell.t === 'empty') return { title: '空地', lines: ['選一個工具在這裡蓋東西。'] };
  if (cell.t === 'road') return { title: '道路', lines: ['住宅區和商業區要緊鄰道路才會發展。'] };
  if (cell.t === 'zone') {
    const lines = [];
    if (!hasRoadAccess(data.city, x, y)) lines.push('⚠️ 沒有接到道路，不會發展');
    if (cell.level === 0) lines.push('完成事項累積建設點，這裡就會長出建築。');
    else if (cell.zone === 'R') lines.push(`住了 ${RESIDENTS[cell.level]} 位市民（${cell.level}/3 級）`);
    else lines.push(`提供 ${JOBS[cell.level]} 個工作（${cell.level}/3 級）`);
    if (cell.zone === 'R' && cell.level >= app.cityStats.maxResidential && cell.level < 3) lines.push('幸福度提高後才能繼續升級');
    return { title: zoneName(cell), lines };
  }
  if (cell.t === 'service') {
    const names = { park: '公園', police: '警察局', fire: '消防局' };
    return { title: names[cell.kind], lines: [`照顧周圍 ${RADIUS[cell.kind]} 格內的住宅，提高幸福度。`] };
  }
  const task = data.tasks.find((t) => t.id === cell.taskId);
  if (!task) return { title: '地標', lines: [] };
  const s = streak(task, Date.now());
  return {
    title: `${CATEGORIES[task.category].building}・${task.title}`,
    lines: [`🔥 連續 ${s} 次，${ctx.landmarkLevels[task.id] ?? 0} 級`, '連續 7／30／100 次會升級。'],
  };
}

export default function CityView({ app }: { app: AppApi }) {
  const { data, cityStats, away } = app;
  const { city } = data;
  const img = useSheet();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const citizens = useRef<Citizen[]>([]);
  const [tool, setTool] = useState<Tool>('inspect');
  const [landmarkTask, setLandmarkTask] = useState<string>('');
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const painting = useRef<string | null>(null);
  const [editingName, setEditingName] = useState(false);

  const habits = data.tasks.filter(isRecurring);
  const placedIds = new Set(city.cells.flatMap((c) => (c.t === 'landmark' ? [c.taskId] : [])));
  const landmarks = useMemo(() => {
    const out: Record<string, LandmarkInfo> = {};
    for (const t of habits) out[t.id] = { category: t.category, level: app.ctx.landmarkLevels[t.id] ?? 0 };
    return out;
  }, [habits, app.ctx]);

  useEffect(() => {
    citizens.current = syncCitizens(citizens.current, city, away ? 0 : cityStats.population, city.rng >>> 0);
  }, [city, cityStats.population, away]);

  // draw loop
  const frame = useRef({ city, landmarks, away, selected, preview: null as null | { x: number; y: number; ok: boolean } });
  frame.current = {
    city, landmarks, away, selected: tool === 'inspect' ? selected : null,
    preview: hover && tool !== 'inspect'
      ? { ...hover, ok: !placeError(city, tool, hover.x, hover.y) && data.coins >= TOOLS[tool].cost && (tool !== 'landmark' || !!landmarkTask) }
      : null,
  };
  useEffect(() => {
    if (!img) return;
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const g = canvasRef.current?.getContext('2d');
      const f = frame.current;
      if (g) {
        stepCitizens(citizens.current, f.city, Math.min(64, t - last));
        drawCity(g, img, { city: f.city, landmarks: f.landmarks, night: f.away, selected: f.selected, preview: f.preview, citizens: citizens.current });
      }
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [img]);

  function cellFromEvent(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const x = Math.floor(px / CELL);
    const y = Math.floor((py - TOP) / CELL);
    return cellAt(city, x, y) ? { x, y } : null;
  }

  function apply(pos: { x: number; y: number }) {
    if (tool === 'inspect') {
      setSelected(pos);
      return;
    }
    if (tool === 'landmark') {
      if (!landmarkTask) {
        app.toast('先在上面選一個要放的習慣');
        return;
      }
      if (app.placeTile('landmark', pos.x, pos.y, landmarkTask)) {
        setLandmarkTask('');
        setTool('inspect');
        setSelected(pos);
      }
      return;
    }
    const err = placeError(city, tool, pos.x, pos.y);
    if (err) {
      if (!painting.current) app.toast(err);
      return;
    }
    app.placeTile(tool, pos.x, pos.y);
  }

  const { width, height } = canvasSize(city);
  const selectedCell = selected ? cellAt(city, selected.x, selected.y) : null;
  const info = selected && selectedCell ? describe(selectedCell, app, selected.x, selected.y) : null;
  const unplaced = habits.filter((t) => !placedIds.has(t.id));
  const emptyLots = city.cells.flatMap((c, i) => (c.t === 'zone' && c.level === 0 ? [i] : []));
  const waiting = emptyLots.filter((i) => hasRoadAccess(city, i % city.size, Math.floor(i / city.size))).length;
  const noRoad = emptyLots.length - waiting;

  return (
    <div className="city">
      <section className="city-main">
        <div className="city-head">
          {editingName ? (
            <input
              autoFocus
              defaultValue={city.name}
              maxLength={20}
              onBlur={(e) => {
                app.renameCity(e.target.value.trim() || city.name);
                setEditingName(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <h2 onClick={() => setEditingName(true)} title="點一下改名">{city.name}<small>・{cityStats.title}</small></h2>
          )}
          <div className="city-stats">
            <span>👥 {cityStats.population}</span>
            <span>😊 {cityStats.happiness}</span>
            <span>💰 {data.coins}</span>
            {city.bank > 0 && <span title="還沒用掉的建設點">🏗️ {city.bank}</span>}
          </div>
        </div>

        {!away && waiting > 0 && city.bank === 0 && (
          <div className="banner">🏗️ 有 {waiting} 塊空地等著蓋：到記事本完成事項，每完成 1 件就能蓋 1 次（每天前 3 件可以蓋 2 次）。</div>
        )}
        {noRoad > 0 && <div className="banner muted">⚠️ 有 {noRoad} 塊空地沒接到道路，要緊鄰道路才會蓋房子。</div>}
        {away && <div className="banner night">🌙 城市睡著了……完成一件事，市長回來城市就會天亮，還有回歸獎勵。</div>}

        <div className="toolbar" role="toolbar">
          {TOOL_ORDER.map((t) => (
            <button key={t} className={tool === t ? 'active' : ''} onClick={() => setTool(t)} title={t === 'inspect' ? '查看' : TOOLS[t].label}>
              <span className="t-icon">{t === 'inspect' ? '🔍' : TOOLS[t].icon}</span>
              <span className="t-label">{t === 'inspect' ? '查看' : TOOLS[t].label}</span>
              {t !== 'inspect' && TOOLS[t].cost > 0 && <span className="t-cost">{TOOLS[t].cost}</span>}
            </button>
          ))}
        </div>

        {tool === 'landmark' && (
          <div className="landmark-pick">
            {unplaced.length === 0 ? (
              <span className="hint">{habits.length === 0 ? '先在記事本新增一個每天／每週的習慣。' : '所有習慣都已經有地標了，選一個再放一次可以搬家。'}</span>
            ) : null}
            <select value={landmarkTask} onChange={(e) => setLandmarkTask(e.target.value)}>
              <option value="">選擇習慣…</option>
              {habits.map((t) => (
                <option key={t.id} value={t.id}>
                  {CATEGORIES[t.category].icon} {t.title}{placedIds.has(t.id) ? '（搬家）' : ''}
                </option>
              ))}
            </select>
            <span className="hint">然後點一塊空地。</span>
          </div>
        )}

        <div className="canvas-wrap">
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className={tool === 'inspect' ? '' : 'building'}
            onPointerDown={(e) => {
              const pos = cellFromEvent(e);
              if (!pos) return;
              if (PAINTABLE.has(tool)) {
                e.currentTarget.setPointerCapture(e.pointerId);
                painting.current = `${pos.x},${pos.y}`;
              }
              apply(pos);
            }}
            onPointerMove={(e) => {
              const pos = cellFromEvent(e);
              setHover(pos);
              if (!pos || !painting.current) return;
              const key = `${pos.x},${pos.y}`;
              if (key === painting.current) return;
              painting.current = key;
              apply(pos);
            }}
            onPointerUp={() => (painting.current = null)}
            onPointerLeave={() => setHover(null)}
          />
        </div>
        <p className="hint">道路、住宅區、商業區、拆除可以按住拖曳連續畫。素材：Kenney（CC0）。</p>
      </section>

      <aside className="city-side">
        {info && (
          <div className="card">
            <h3>{info.title}</h3>
            {info.lines.map((l) => <p key={l} className="small">{l}</p>)}
          </div>
        )}

        <div className="card">
          <h3>😊 幸福度 {cityStats.happiness}</h3>
          <div className="meter"><span style={{ width: `${cityStats.happiness}%` }} /></div>
          <ul className="breakdown">
            {cityStats.breakdown.map((b) => (
              <li key={b.label} title={b.tip}>
                <span>{b.label}</span>
                <span>{b.value}/{b.max}</span>
              </li>
            ))}
          </ul>
          <p className="hint">
            {cityStats.maxResidential < 3
              ? `住宅目前最多長到 ${cityStats.maxResidential} 級；幸福度 ${cityStats.maxResidential === 1 ? 50 : 70} 以上可以再升級。`
              : '幸福度很高，住宅可以長成公寓！'}
          </p>
          {cityStats.breakdown.filter((b) => b.tip && b.value < b.max).slice(0, 2).map((b) => (
            <p key={b.label} className="hint">💡 {b.tip}</p>
          ))}
        </div>

        <div className="card">
          <h3>🏛️ 習慣地標</h3>
          {habits.length === 0 && <p className="hint">新增每天或每週的習慣，就能在城市裡放專屬建築，連續做會升級。</p>}
          <ul className="landmarks">
            {habits.map((t) => (
              <li key={t.id}>
                <span>{CATEGORIES[t.category].icon} {t.title}</span>
                <span>
                  {placedIds.has(t.id) ? `${app.ctx.landmarkLevels[t.id] ?? 0} 級` : (
                    <button className="link" onClick={() => { setTool('landmark'); setLandmarkTask(t.id); }}>放置</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h3>📖 怎麼玩</h3>
          <ul className="rules small">
            <li>完成事項賺金幣 💰 和建設點 🏗️。</li>
            <li>劃住宅區、商業區（要靠路），建設點會讓房子、商店、餐廳自己長出來。</li>
            <li>蓋警察局、消防局、公園讓市民更幸福，住宅才會升級成公寓。</li>
            <li>每天前三件事金幣和建設點加倍。</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
