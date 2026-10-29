import { describe, expect, it } from 'vitest';
import { sampleCameraPath, validateCameraPath, type CameraKeyframe } from './camera-path';

const path: CameraKeyframe[] = [
  { time: 0, target: [0, 0, 0], offset: [3, 4, 12] },
  { time: 1, target: [2, 1, 0], offset: [4, 5, 10] },
  { time: 4, target: [6, 3, 0], offset: [6, 6, 8] },
];

describe('reusable camera path', () => {
  it('lands on each waypoint and clamps outside the path', () => {
    validateCameraPath(path);
    for (const point of path) {
      const pose = sampleCameraPath(path, point.time);
      expect(pose.target).toEqual(point.target);
      expect(pose.offset).toEqual(point.offset);
    }
    expect(sampleCameraPath(path, -10).target).toEqual(path[0].target);
    expect(sampleCameraPath(path, 20).offset).toEqual(path[2].offset);
  });
  it('preserves monotone framing without overshoot on uneven intervals', () => {
    let previous = -Infinity;
    for (let t = 0; t <= 4; t += 0.01) {
      const pose = sampleCameraPath(path, t);
      expect(pose.target[0]).toBeGreaterThanOrEqual(previous);
      expect(pose.target[0]).toBeLessThanOrEqual(6);
      expect(pose.offset[2]).toBeGreaterThanOrEqual(8);
      expect(pose.offset[2]).toBeLessThanOrEqual(12);
      previous = pose.target[0];
    }
  });
  it('keeps velocity continuous at an intermediate waypoint', () => {
    const epsilon = 1e-5, center = sampleCameraPath(path, 1).target[0];
    const left = (center - sampleCameraPath(path, 1 - epsilon).target[0]) / epsilon;
    const right = (sampleCameraPath(path, 1 + epsilon).target[0] - center) / epsilon;
    expect(Math.abs(left - right)).toBeLessThan(0.0001);
  });
  it('rejects unusable paths before a render loop can divide by zero', () => {
    expect(() => validateCameraPath(path.slice(0, 1))).toThrow();
    expect(() => validateCameraPath([path[0], { ...path[1], time: 0 }])).toThrow();
    expect(() => validateCameraPath([path[0], { ...path[1], target: [0, NaN, 0] }])).toThrow();
    expect(() => sampleCameraPath(path, NaN)).toThrow();
  });
});
