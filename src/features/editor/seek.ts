export const clampSeekTime = (time: number, duration: number) => {
  const upperBound =
    Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(time, upperBound));
};
