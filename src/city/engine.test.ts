import { cellAt, grow, landmarkLevel, newCity, place, placeError, retireLandmark, stats, type City } from './engine';

const ctx = { activeDays: 0, landmarkLevels: {} };

/** Zone a strip of lots right above the main road (row 4 touches row 5). */
function zoned(zone: 'R' | 'C', xs: number[], city: City = newCity('測試市', 1)): City {
  return xs.reduce((c, x) => place(c, zone, x, 4), city);
}

describe('city', () => {
  it('starts with roads and lets you zone empty land only', () => {
    const c = newCity('測試市', 1);
    expect(cellAt(c, 0, 5)!.t).toBe('road');
    expect(placeError(c, 'R', 0, 5)).not.toBeNull();
    expect(placeError(c, 'R', 0, 4)).toBeNull();
  });

  it('only grows lots that touch a road', () => {
    let c = place(newCity('測試市', 1), 'R', 0, 0); // far from roads
    c = grow(c, 3, ctx).city;
    expect(cellAt(c, 0, 0)).toMatchObject({ level: 0 });
    expect(c.bank).toBe(3);
  });

  it('spends banked ticks once there is something to build', () => {
    let c = { ...newCity('測試市', 1), bank: 2 };
    c = zoned('R', [0, 1]);
    c.bank = 2;
    const r = grow(c, 0, ctx);
    expect(r.used).toBe(2);
    expect(r.city.bank).toBe(0);
    expect(stats(r.city, ctx).population).toBe(8);
    expect(r.events[0]).toContain('8 位市民');
  });

  it('caps houses at level 1 until happiness rises', () => {
    let c = zoned('R', [0, 1]);
    c = grow(c, 10, ctx).city;
    expect(stats(c, ctx).population).toBe(8);
    // police + fire + park next to the homes push happiness past 70
    c = place(place(place(c, 'police', 0, 3), 'fire', 1, 3), 'park', 2, 4);
    const happy = { activeDays: 7, landmarkLevels: {} };
    expect(stats(c, happy).maxResidential).toBe(3);
    c = grow(c, 10, happy).city;
    expect(stats(c, happy).population).toBe(40);
  });

  it('builds shops when residents need them', () => {
    let c = zoned('R', [0, 1, 2]);
    c = zoned('C', [6], c);
    c = grow(c, 1, ctx).city; // first residents move in
    const r = grow(c, 1, ctx); // then they need somewhere to shop
    expect(cellAt(r.city, 6, 4)).toMatchObject({ level: 1 });
    expect(r.events[0]).toContain('開幕');
  });

  it('keeps one landmark per habit and turns retired ones into parks', () => {
    let c = place(newCity('測試市', 1), 'landmark', 0, 0, 'eng');
    c = place(c, 'landmark', 1, 0, 'eng');
    expect(cellAt(c, 0, 0)!.t).toBe('empty');
    expect(cellAt(c, 1, 0)).toMatchObject({ t: 'landmark', taskId: 'eng' });
    c = retireLandmark(c, 'eng');
    expect(cellAt(c, 1, 0)).toMatchObject({ t: 'service', kind: 'park' });
  });

  it('maps streaks to landmark levels', () => {
    expect([0, 6, 7, 29, 30, 100].map(landmarkLevel)).toEqual([0, 0, 1, 1, 2, 3]);
  });

  it('never mutates the input city', () => {
    const c = zoned('R', [0]);
    const copy = structuredClone(c);
    grow(c, 5, ctx);
    place(c, 'road', 9, 9);
    expect(c).toEqual(copy);
  });
});
