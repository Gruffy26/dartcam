import { describe, expect, it } from 'vitest';
import {
  angleFromTop,
  boardPoint,
  makeScore,
  RADII,
  scoreFromBoardCoords,
  SECTORS,
  sectorCenterAngle,
  sectorIndexAt,
} from './board';

const EPS = 1e-6;

/** Score à un rayon et un angle (depuis le haut, sens horaire) donnés. */
function at(radius: number, angle: number) {
  const p = boardPoint(radius, angle);
  return scoreFromBoardCoords(p.x, p.y);
}

describe('repère de la cible', () => {
  it('le 20 est en haut, le 6 à droite, le 3 en bas, le 11 à gauche', () => {
    expect(angleFromTop(0, 1)).toBeCloseTo(0);
    expect(angleFromTop(1, 0)).toBeCloseTo(90);
    expect(angleFromTop(0, -1)).toBeCloseTo(180);
    expect(angleFromTop(-1, 0)).toBeCloseTo(270);
    expect(sectorCenterAngle(20)).toBe(0);
    expect(sectorCenterAngle(6)).toBe(90);
    expect(sectorCenterAngle(3)).toBe(180);
    expect(sectorCenterAngle(11)).toBe(270);
  });

  it('boardPoint et angleFromTop sont cohérents', () => {
    for (const a of [0, 17, 90, 181, 270, 359]) {
      const p = boardPoint(100, a);
      expect(angleFromTop(p.x, p.y)).toBeCloseTo(a);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(100);
    }
  });

  it('secteur inconnu → erreur', () => {
    expect(() => sectorCenterAngle(21)).toThrow();
  });
});

describe('scoreFromBoardCoords — centre et bull', () => {
  it('centre exact = BULL', () => {
    expect(scoreFromBoardCoords(0, 0)).toEqual({ secteur: 25, multiplicateur: 2, points: 50, libelle: 'BULL' });
  });

  it('limite du bull (6,35) : dedans = BULL, juste après = 25', () => {
    expect(at(RADII.bull, 45).libelle).toBe('BULL');
    expect(at(RADII.bull + EPS, 45)).toEqual({ secteur: 25, multiplicateur: 1, points: 25, libelle: '25' });
  });

  it('limite du 25 (15,9) : dedans = 25, juste après = simple', () => {
    expect(at(RADII.outerBull, 0).libelle).toBe('25');
    expect(at(RADII.outerBull + EPS, 0)).toEqual({ secteur: 20, multiplicateur: 1, points: 20, libelle: '20' });
  });
});

describe('scoreFromBoardCoords — anneaux', () => {
  it('triple : de 99 à 107 inclus', () => {
    expect(at(RADII.tripleInner - EPS, 0).libelle).toBe('20');
    expect(at(RADII.tripleInner, 0).libelle).toBe('T20');
    expect(at(103, 0)).toEqual({ secteur: 20, multiplicateur: 3, points: 60, libelle: 'T20' });
    expect(at(RADII.tripleOuter, 0).libelle).toBe('T20');
    expect(at(RADII.tripleOuter + EPS, 0).libelle).toBe('20');
  });

  it('double : de 162 à 170 inclus', () => {
    expect(at(RADII.doubleInner - EPS, 0).libelle).toBe('20');
    expect(at(RADII.doubleInner, 0).libelle).toBe('D20');
    expect(at(166, sectorCenterAngle(16))).toEqual({ secteur: 16, multiplicateur: 2, points: 32, libelle: 'D16' });
    expect(at(RADII.doubleOuter, 0).libelle).toBe('D20');
  });

  it('hors cible au-delà de 170', () => {
    expect(at(RADII.doubleOuter + EPS, 0)).toEqual({ secteur: 0, multiplicateur: 0, points: 0, libelle: '0' });
    expect(scoreFromBoardCoords(500, -300).points).toBe(0);
  });

  it('les 4 repères de calibration tombent dans le double attendu', () => {
    expect(scoreFromBoardCoords(0, 170).libelle).toBe('D20');
    expect(scoreFromBoardCoords(170, 0).libelle).toBe('D6');
    expect(scoreFromBoardCoords(0, -170).libelle).toBe('D3');
    expect(scoreFromBoardCoords(-170, 0).libelle).toBe('D11');
  });

  it('valeurs non numériques = 0', () => {
    expect(scoreFromBoardCoords(NaN, 0)).toEqual(makeScore(0, 0));
    expect(scoreFromBoardCoords(0, Infinity).points).toBe(0);
  });
});

describe('scoreFromBoardCoords — secteurs', () => {
  it('le milieu de chaque secteur donne le bon numéro, dans chaque zone', () => {
    SECTORS.forEach((s, i) => {
      const a = i * 18;
      expect(at(50, a).libelle).toBe(`${s}`);
      expect(at(103, a).libelle).toBe(`T${s}`);
      expect(at(140, a).libelle).toBe(`${s}`);
      expect(at(166, a).libelle).toBe(`D${s}`);
    });
  });

  it('frontières : de part et d’autre de chaque ligne de secteur', () => {
    SECTORS.forEach((s, i) => {
      const next = SECTORS[(i + 1) % SECTORS.length];
      const boundary = i * 18 + 9;
      expect(at(120, boundary - 0.01).secteur).toBe(s);
      expect(at(120, boundary + 0.01).secteur).toBe(next);
    });
  });

  it('le 20 couvre de −9° à +9°', () => {
    expect(at(120, -8.99).secteur).toBe(20);
    expect(at(120, 8.99).secteur).toBe(20);
    expect(at(120, -9.01).secteur).toBe(5);
    expect(at(120, 9.01).secteur).toBe(1);
  });

  it('une frontière exacte appartient au secteur suivant (sens horaire)', () => {
    expect(SECTORS[sectorIndexAt(9)]).toBe(1);
    expect(SECTORS[sectorIndexAt(-9)]).toBe(20);
    expect(SECTORS[sectorIndexAt(351)]).toBe(20);
    expect(SECTORS[sectorIndexAt(360)]).toBe(20);
  });
});

describe('makeScore', () => {
  it('libellés et points', () => {
    expect(makeScore(20, 3)).toEqual({ secteur: 20, multiplicateur: 3, points: 60, libelle: 'T20' });
    expect(makeScore(16, 2).libelle).toBe('D16');
    expect(makeScore(7, 1).libelle).toBe('7');
    expect(makeScore(25, 1).points).toBe(25);
    expect(makeScore(25, 2).libelle).toBe('BULL');
    expect(makeScore(20, 0).libelle).toBe('0');
  });
});

describe('distance au fil le plus proche', async () => {
  const { distanceToWire } = await import('./board');
  it('centre du T20 : loin des fils radiaux, à 4 mm des bords du triple', () => {
    const p = boardPoint(103, 0);
    expect(distanceToWire(p.x, p.y)).toBeCloseTo(4, 5);
  });
  it('près d’un fil de secteur', () => {
    const p = boardPoint(130, 8.5); // fil 20/1 à 9°
    expect(distanceToWire(p.x, p.y)).toBeCloseTo(130 * Math.sin((0.5 * Math.PI) / 180), 3);
  });
  it('près du bord du double', () => {
    expect(distanceToWire(0, 169)).toBeCloseTo(1, 5);
  });
});
