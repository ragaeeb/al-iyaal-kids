export const toSrtSidecarPath = (path: string) => path.replace(/\.[^.]+$/, ".srt");

export const toAnalysisSidecarPath = (path: string) => path.replace(/\.[^.]+$/, ".analysis.json");

export const toCutRangesSidecarPath = (path: string) => path.replace(/\.[^.]+$/, ".ranges.json");

export const buildVideoDeleteTargets = (videoPath: string) => [
  videoPath,
  toSrtSidecarPath(videoPath),
  toAnalysisSidecarPath(videoPath),
  toCutRangesSidecarPath(videoPath),
];
