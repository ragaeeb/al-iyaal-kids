const missingDeleteTargetPatterns = [
  "Failed resolving file path",
  "Path is not a file",
  "No such file or directory",
];

const toErrorMessage = (error: unknown) => {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    return typeof error.message === "string" ? error.message : "";
  }

  return "";
};

export const toSrtSidecarPath = (path: string) => path.replace(/\.[^.]+$/, ".srt");

export const toAnalysisSidecarPath = (path: string) => path.replace(/\.[^.]+$/, ".analysis.json");

export const toFrameAnalysisSidecarPath = (path: string) =>
  path.replace(/\.[^.]+$/, ".frames.analysis.json");

export const toCutRangesSidecarPath = (path: string) => path.replace(/\.[^.]+$/, ".ranges.json");

export const buildVideoDeleteTargets = (videoPath: string) => [
  videoPath,
  toSrtSidecarPath(videoPath),
  toAnalysisSidecarPath(videoPath),
  toFrameAnalysisSidecarPath(videoPath),
  toCutRangesSidecarPath(videoPath),
];

export const isMissingDeleteTargetError = (error: unknown) => {
  const message = toErrorMessage(error);
  return missingDeleteTargetPatterns.some((pattern) => message.includes(pattern));
};
