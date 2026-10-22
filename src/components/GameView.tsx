import { useEffect, useRef, useState } from 'react';
import { BOOSTERS, type Booster } from '../economy/rewards';
import { levelConfig, themeFor } from '../game/levels';
import {
  SIZE, adjacent, at, col, isBox, isPiece, playExtraMoves, playHammer, playRainbow, playShuffle, playSwap, row,
  type Board, type Game, type Goal, type Piece, type Step,
} from '../game/match3';
import type { AppApi } from '../useApp';

export const BRICK_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#facc15', '#a855f7', '#f97316'];
const COLOR_NAMES = ['紅', '藍', '綠', '黃', '紫', '橘'];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function GoalIcon({ goal }: { goal: Goal }) {
  if (goal.type === 'collect') return <span className="mini-brick" style={{ '--c': BRICK_COLORS[goal.color] } as React.CSSProperties} />;
  return <span className="goal-icon">{goal.type === 'score' ? '🎯' : goal.type === 'special' ? '✨' : '📦'}</span>;
}

function goalLabel(goal: Goal): string {
  if (goal.type === 'collect') return `${COLOR_NAMES[goal.color]}色積木 ${goal.count} 個`;
  if (goal.type === 'score') return `達到 ${goal.count} 分`;
  if (goal.type === 'special') return `做出 ${goal.count} 個特殊積木`;
  return `打破 ${goal.count} 個木箱`;
}

function Stars({ n, of = 3 }: { n: number; of?: number }) {
  return <span className="stars" aria-label={`${n} 顆星`}>{'★'.repeat(n)}<span className="off">{'★'.repeat(of - n)}</span></span>;
}

// ---------------- level map ----------------

function LevelMap({ app }: { app: AppApi }) {
  const { game } = app.data;
  const unlocked = app.level;
  const [chapter, setChapter] = useState(Math.ceil(unlocked / 10));
  const [picked, setPicked] = useState<number | null>(null);
  const theme = themeFor(chapter);
  const levels = Array.from({ length: 10 }, (_, i) => (chapter - 1) * 10 + i + 1);
  const cfg = picked ? levelConfig(picked) : null;
  const currentRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, [chapter]);

  return (
    <div className="level-map">
      <div className="card inventory">
        <span className="hearts">❤️ {game.hearts}</span>
        {(Object.keys(BOOSTERS) as Booster[]).map((b) => (
          <span key={b} title={BOOSTERS[b].hint}>{BOOSTERS[b].icon} {game.boosters[b]}</span>
        ))}
      </div>

      <div className="chapter" style={{ background: theme.bg }}>
        <div className="chapter-head">
          <button className="ghost" disabled={chapter <= 1} onClick={() => setChapter(chapter - 1)} aria-label="上一章">◀</button>
          <h2>第 {chapter} 章・{theme.name}</h2>
          <button className="ghost" disabled={chapter * 10 + 1 > unlocked} onClick={() => setChapter(chapter + 1)} aria-label="下一章">▶</button>
        </div>
        <div className="level-path">
          {levels.map((n, i) => {
            const locked = n > unlocked;
            const stars = game.stars[n] ?? 0;
            return (
              <button
                key={n}
                ref={n === unlocked ? currentRef : undefined}
                className={`level-node ${locked ? 'locked' : ''} ${n === unlocked ? 'current' : ''} ${n % 10 === 0 ? 'boss' : ''}`}
                style={{ '--offset': `${[0, 30, 55, 30, 0, -30, -55, -30, 0, 30][i]}px` } as React.CSSProperties}
                disabled={locked}
                onClick={() => setPicked(n)}
              >
                <span className="num">{locked ? '🔒' : n}</span>
                {!locked && <Stars n={stars} />}
              </button>
            );
          })}
        </div>
      </div>

      {cfg && (
        <div className="overlay" onClick={() => setPicked(null)}>
          <div className="card level-card" onClick={(e) => e.stopPropagation()}>
            <h2>第 {cfg.level} 關{cfg.bonus ? '・大關 👑' : ''}</h2>
            <ul className="goal-list">
              {cfg.goals.map((g, i) => (
                <li key={i}><GoalIcon goal={g} /> {goalLabel(g)}</li>
              ))}
            </ul>
            <p className="hint">{cfg.moves} 步・{cfg.colors} 種顏色{cfg.boxes.length ? `・${cfg.boxes.length} 個木箱` : ''}{cfg.bonus ? '・過關多送一個道具' : ''}</p>
            {(game.stars[cfg.level] ?? 0) > 0 && <p>最佳紀錄 <Stars n={game.stars[cfg.level]} /></p>}
            <div className="row">
              <button className="ghost" onClick={() => setPicked(null)}>取消</button>
              <button className="primary" disabled={game.hearts < 1} onClick={() => app.startLevel(cfg.level) && setPicked(null)}>
                開始（❤️ -1，過關退回）
              </button>
            </div>
            {game.hearts < 1 && <p className="hint">體力用完了：完成一件事就能拿到 ❤️，每天也會送 2 顆。</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- board ----------------

function TileView({ index, tile, extra, style }: { index: number; tile: Board['tiles'][number]; extra?: string; style?: React.CSSProperties }) {
  if (!tile) return null;
  const pos = { left: `${col(index) * 12.5}%`, top: `${row(index) * 12.5}%`, ...style } as React.CSSProperties;
  if (isBox(tile)) return <div className={`tile box hp${tile.hp} ${extra ?? ''}`} style={pos} />;
  const p = tile as Piece;
  return (
    <div
      className={`tile brick ${p.special} ${extra ?? ''}`}
      style={{ ...pos, '--c': p.special === 'rainbow' ? '#fff' : BRICK_COLORS[p.color] } as React.CSSProperties}
    />
  );
}

function Play({ app, game }: { app: AppApi; game: Game }) {
  const [view, setView] = useState<Board | null>(null);
  const [busy, setBusy] = useState(false);
  const [popping, setPopping] = useState<Step['cleared']>([]);
  const [drops, setDrops] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<'hammer' | 'rainbow' | null>(null);
  const [combo, setCombo] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; x: number; y: number } | null>(null);
  const cfg = levelConfig(game.level);
  const board = view ?? game.board;
  const { boosters } = app.data.game;

  // show pieces arriving from above only for the frame they spawn in
  useEffect(() => {
    if (!busy) setDrops({});
  }, [busy]);

  async function animate(steps: Step[]) {
    for (let k = 0; k < steps.length; k++) {
      const s = steps[k];
      setCombo(s.shuffle ? 0 : k + 1);
      setPopping(s.cleared);
      setDrops({});
      setView(s.afterClear);
      await wait(s.shuffle ? 0 : 230);
      setPopping([]);
      setDrops(Object.fromEntries(s.spawned.map((x) => [x.id, x.drop])));
      setView(s.afterFall);
      await wait(s.shuffle ? 450 : 300);
    }
    setCombo(0);
  }

  async function run(result: { game: Game; steps: Step[] } | null, swapped?: Board) {
    if (!result) {
      if (swapped) {
        // show the attempted swap, then bounce back
        setView(swapped);
        await wait(170);
        setView(null);
      }
      return;
    }
    setBusy(true);
    if (swapped) {
      setView(swapped);
      await wait(170);
    }
    await animate(result.steps);
    app.saveGame(result.game);
    setView(null);
    setBusy(false);
  }

  function trySwap(a: number, b: number) {
    if (busy || !adjacent(a, b)) return;
    setSelected(null);
    const swapped = { ...game.board, tiles: game.board.tiles.slice() };
    [swapped.tiles[a], swapped.tiles[b]] = [swapped.tiles[b], swapped.tiles[a]];
    if (!isPiece(game.board.tiles[a]) || !isPiece(game.board.tiles[b])) return;
    run(playSwap(game, a, b), swapped);
  }

  function tap(index: number) {
    if (busy) return;
    if (mode === 'hammer') {
      if (!game.board.tiles[index] || !app.spendBooster('hammer')) return;
      setMode(null);
      run(playHammer(game, index));
      return;
    }
    if (mode === 'rainbow') {
      const next = playRainbow(game, index);
      if (!next || !app.spendBooster('rainbow')) return;
      setMode(null);
      app.saveGame(next);
      return;
    }
    if (selected === null || selected === index) setSelected(selected === index ? null : index);
    else if (adjacent(selected, index)) trySwap(selected, index);
    else setSelected(index);
  }

  function cellAt(e: React.PointerEvent): number | null {
    const rect = boardRef.current!.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * SIZE);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * SIZE);
    return r >= 0 && c >= 0 && r < SIZE && c < SIZE ? at(r, c) : null;
  }

  function onDown(e: React.PointerEvent) {
    const i = cellAt(e);
    if (i === null) return;
    drag.current = { index: i, x: e.clientX, y: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keep receiving moves when the finger leaves the tile
    } catch {
      // synthetic or already-released pointers can't be captured; swiping still works within the board
    }
  }

  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || mode) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const threshold = boardRef.current!.getBoundingClientRect().width / SIZE / 3;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return;
    drag.current = null;
    const r = row(d.index) + (Math.abs(dy) > Math.abs(dx) ? Math.sign(dy) : 0);
    const c = col(d.index) + (Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0);
    if (r >= 0 && c >= 0 && r < SIZE && c < SIZE) trySwap(d.index, at(r, c));
  }

  function onUp() {
    const d = drag.current;
    drag.current = null;
    if (d) tap(d.index);
  }

  function booster(b: Booster) {
    if (busy || boosters[b] < 1) return;
    if (b === 'hammer' || b === 'rainbow') {
      setMode(mode === b ? null : b);
      return;
    }
    if (!app.spendBooster(b)) return;
    if (b === 'shuffle') {
      const next = playShuffle(game);
      setDrops({});
      app.saveGame(next);
    } else app.saveGame(playExtraMoves(game));
  }

  function quit() {
    if (game.status === 'playing' && !confirm('放棄這一關？這次用掉的體力不會退回。')) return;
    app.finishLevel({ ...game, status: game.status === 'won' ? 'won' : 'lost' });
  }

  const theme = themeFor(cfg.chapter);

  return (
    <div className="play">
      <div className="play-head">
        <button className="ghost" onClick={quit}>← 地圖</button>
        <strong>第 {game.level} 關{cfg.bonus ? ' 👑' : ''}</strong>
        <span className={`moves ${game.moves <= 3 ? 'low' : ''}`}>{game.moves} 步</span>
      </div>

      <div className="goals">
        {game.goals.map((g, i) => {
          const done = game.progress[i] >= g.count;
          return (
            <span key={i} className={`goal ${done ? 'done' : ''}`}>
              <GoalIcon goal={g} />
              {done ? '✓' : g.type === 'score' ? `${game.score}/${g.count}` : `${Math.max(0, g.count - game.progress[i])}`}
            </span>
          );
        })}
        <span className="score">🏅 {game.score}</span>
      </div>

      <div className="board-wrap" style={{ background: theme.bg }}>
        <div
          ref={boardRef}
          className={`board ${mode ? `mode-${mode}` : ''}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => (drag.current = null)}
        >
          {Array.from({ length: SIZE * SIZE }, (_, i) => (
            <div key={`bg${i}`} className="cell-bg" style={{ left: `${col(i) * 12.5}%`, top: `${row(i) * 12.5}%` }} />
          ))}
          {board.tiles.map((t, i) =>
            t ? (
              <TileView
                key={t.id}
                index={i}
                tile={t}
                extra={`${selected === i ? 'selected' : ''} ${drops[t.id] ? 'spawn' : ''}`}
                style={drops[t.id] ? ({ '--drop': drops[t.id] } as React.CSSProperties) : undefined}
              />
            ) : null,
          )}
          {popping.map((c) => (
            <TileView key={`pop${c.piece.id}`} index={c.index} tile={c.piece} extra="pop" />
          ))}
          {combo >= 3 && <div className="combo">連鎖 ×{combo}!</div>}
        </div>
      </div>

      <div className="booster-bar">
        {(Object.keys(BOOSTERS) as Booster[]).map((b) => (
          <button key={b} className={mode === b ? 'active' : ''} disabled={busy || boosters[b] < 1 || game.status !== 'playing'} onClick={() => booster(b)} title={BOOSTERS[b].hint}>
            <span>{BOOSTERS[b].icon}</span>
            <small>{boosters[b]}</small>
          </button>
        ))}
      </div>
      {mode && <p className="hint center">{BOOSTERS[mode].hint}（再點一次道具取消）</p>}

      {game.status !== 'playing' && !busy && (
        <div className="overlay">
          <div className="card level-card">
            {game.status === 'won' ? (
              <>
                <h2>🎉 過關！</h2>
                <p className="big-stars"><Stars n={game.stars} /></p>
                <p>得分 {game.score}・體力已退回 ❤️</p>
                <div className="row">
                  <button className="ghost" onClick={() => app.finishLevel(game)}>回地圖</button>
                  <button
                    className="primary"
                    onClick={() => {
                      app.finishLevel(game);
                      app.startLevel(game.level + 1);
                    }}
                  >
                    下一關（❤️ -1）
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>步數用完了</h2>
                <ul className="goal-list">
                  {game.goals.map((g, i) => (
                    <li key={i}><GoalIcon goal={g} /> {goalLabel(g)}：{g.type === 'score' ? game.score : game.progress[i]}/{g.count}</li>
                  ))}
                </ul>
                <div className="row">
                  <button className="ghost" onClick={() => app.finishLevel(game)}>放棄</button>
                  <button className="primary" disabled={boosters.moves < 1} onClick={() => app.spendBooster('moves') && app.saveGame(playExtraMoves(game))}>
                    ➕ 再 5 步（剩 {boosters.moves}）
                  </button>
                </div>
                {boosters.moves < 1 && <p className="hint">沒有 ➕ 道具了：每天前三件完成的事有機會拿到。</p>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function GameView({ app }: { app: AppApi }) {
  const current = app.data.game.current;
  return current ? <Play key={`${current.level}-${current.maxMoves}`} app={app} game={current} /> : <LevelMap app={app} />;
}
