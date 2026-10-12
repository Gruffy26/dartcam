// Orientation de la cible : quel secteur est le 20 ?
// Les couleurs (double rouge pour les secteurs pairs) fixent la parité ; la position
// 3D de la caméra, déduite de la calibration, départage les rotations restantes.

import { SECTOR_ANGLE } from './board';
import { invertH, multiplyH, type Mat3 } from './homography';
import { cameraFromHomography, defaultFocalFor } from './detector/camera-model';

/** Homographie corrigée d'un décalage de `shift` secteurs (rotation de la cible). */
export function rotateCalibration(frameToBoard: Mat3, shift: number): Mat3 {
  if (!shift) return frameToBoard;
  // La case k contient SECTORS[k + shift] : la vraie position est tournée de −shift·18°
  // (sens horaire positif) → rotation de +shift·18° dans le repère (x, y vers le haut).
  const a = (-shift * SECTOR_ANGLE * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Angle depuis le haut dans le sens horaire : (x, y) = (r sin θ, r cos θ).
  // Tourner θ de +δ (horaire) : x' = x cos δ + y sin δ ; y' = −x sin δ + y cos δ.
  const R: Mat3 = [c, s, 0, -s, c, 0, 0, 0, 1];
  return multiplyH(R, frameToBoard);
}

/**
 * Orientation par la position 3D de la caméra (sans lire les chiffres) :
 * parmi les rotations compatibles avec les couleurs (décalages pairs), on garde celle
 * pour laquelle la direction du 20 (axe +y de la cible), vue depuis la caméra, pointe
 * vers le haut de l'image. Hypothèses : cible accrochée normalement et téléphone à peu
 * près droit (moins de ±18° d'inclinaison). Fonctionne quels que soient la position
 * et l'angle de la caméra, contrairement à « le secteur rouge le plus haut à l'image ».
 */
export function uprightShift(frameToBoard: Mat3, width: number, height: number): { shift: number; cos: number } {
  let best = { shift: 0, cos: -Infinity };
  for (let shift = 0; shift < 20; shift += 2) {
    const F = rotateCalibration(frameToBoard, shift);
    const cam = cameraFromHomography(invertH(F), width, height, defaultFocalFor(width, height));
    if (!cam) continue;
    // r2 = axe +y de la cible (vers le 20) dans le repère caméra (x droite, y bas).
    const [x, y] = cam.r2;
    const cos = -y / (Math.hypot(x, y) || 1);
    if (cos > best.cos) best = { shift, cos };
  }
  return best;
}
