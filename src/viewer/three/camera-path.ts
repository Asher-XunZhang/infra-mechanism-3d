/*!
 * Camera interpolation adapted from transformer-architecture/dist/camera-path.mjs.
 * Copyright (c) 2026 Peter Gostev. MIT License.
 * Source: https://github.com/petergpt/transformer-architecture/blob/c4259a6f702e78d64e3fb1d86349530dd1cb78b8/dist/camera-path.mjs
 * Changes: typed, independent of story/model data, validated input, no implicit node-specific framing.
 * Full permission notice: LICENSES/PeterGostev-MIT.txt.
 */
export type CameraVector = [number, number, number];
export interface CameraKeyframe {
  time: number;
  target: CameraVector;
  offset: CameraVector;
}
export interface CameraSample {
  target: CameraVector;
  offset: CameraVector;
}

/** Validate once when a path is created, not inside the render loop. */
export function validateCameraPath(points: readonly CameraKeyframe[]): void {
  if (points.length < 2) throw new Error('A camera path requires at least two keyframes.');
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!Number.isFinite(point.time) || (i > 0 && point.time <= points[i - 1].time)) {
      throw new Error('Camera keyframe times must be finite and strictly increasing.');
    }
    for (const key of ['target', 'offset'] as const) {
      if (point[key].length !== 3 || !point[key].every(Number.isFinite)) {
        throw new Error('Camera vectors require three finite coordinates.');
      }
    }
  }
}

// Shape-preserving weighted harmonic tangents from the upstream implementation.
function tangent(points: readonly CameraKeyframe[], i: number, key: 'target' | 'offset', axis: number): number {
  if (i === 0 || i === points.length - 1) return 0;
  const a = points[i - 1], b = points[i], c = points[i + 1];
  const h0 = b.time - a.time, h1 = c.time - b.time;
  const d0 = (b[key][axis] - a[key][axis]) / h0;
  const d1 = (c[key][axis] - b[key][axis]) / h1;
  if (d0 * d1 <= 0) return 0;
  const w0 = 2 * h1 + h0, w1 = h1 + 2 * h0;
  return (w0 + w1) / (w0 / d0 + w1 / d1);
}

/** Sample a validated path. Time is viewing time, never simulated engine latency. */
export function sampleCameraPath(points: readonly CameraKeyframe[], time: number): CameraSample {
  if (!Number.isFinite(time)) throw new Error('Camera sample time must be finite.');
  let index = 0;
  while (index < points.length - 2 && time >= points[index + 1].time) index++;
  const a = points[index], b = points[index + 1], span = b.time - a.time;
  const u = Math.max(0, Math.min(1, (time - a.time) / span));
  const u2 = u * u, u3 = u2 * u;
  const sample = (key: 'target' | 'offset'): CameraVector => a[key].map((v, axis) =>
    (2 * u3 - 3 * u2 + 1) * v +
    (u3 - 2 * u2 + u) * span * tangent(points, index, key, axis) +
    (-2 * u3 + 3 * u2) * b[key][axis] +
    (u3 - u2) * span * tangent(points, index + 1, key, axis)
  ) as CameraVector;
  return { target: sample('target'), offset: sample('offset') };
}
