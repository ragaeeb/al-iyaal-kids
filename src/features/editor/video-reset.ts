export const canResetVideoToOriginal = (
  displayedVideoPath: string | null,
  originalVideoPath: string | null,
) => Boolean(displayedVideoPath && originalVideoPath && displayedVideoPath !== originalVideoPath);
