import {Easing, interpolate, useCurrentFrame, useVideoConfig} from "remotion";

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

export const ease = Easing.bezier(0.16, 1, 0.3, 1);

export const useSceneFrame = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return {frame, fps};
};

export const enterProgress = (
  frame: number,
  fps: number,
  delaySeconds = 0,
  durationSeconds = 0.8,
) =>
  interpolate(
    frame,
    [delaySeconds * fps, (delaySeconds + durationSeconds) * fps],
    [0, 1],
    {
      ...clamp,
      easing: ease,
    },
  );

export const exitProgress = (
  frame: number,
  fps: number,
  startSeconds: number,
  durationSeconds = 0.45,
) =>
  interpolate(
    frame,
    [startSeconds * fps, (startSeconds + durationSeconds) * fps],
    [0, 1],
    {
      ...clamp,
      easing: Easing.in(Easing.cubic),
    },
  );

export const drift = (frame: number, amount: number, speed = 120) =>
  Math.sin(frame / speed) * amount;
