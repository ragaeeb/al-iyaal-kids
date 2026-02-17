type FfprobeStream = {
  codec_name?: string;
  codec_type?: string;
  pix_fmt?: string;
};

type FfprobeReport = {
  streams?: FfprobeStream[];
};

const isCompatibleVideoStream = (stream: FfprobeStream) => {
  const codec = stream.codec_name?.toLowerCase();
  const pixelFormat = stream.pix_fmt?.toLowerCase();
  return codec === "h264" && pixelFormat === "yuv420p";
};

const isCompatibleAudioStream = (stream: FfprobeStream) => {
  const codec = stream.codec_name?.toLowerCase();
  return codec === "aac";
};

export const isWebPreviewCompatible = (report: FfprobeReport) => {
  const streams = report.streams ?? [];
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const audioStream = streams.find((stream) => stream.codec_type === "audio");

  if (!videoStream || !audioStream) {
    return false;
  }

  return isCompatibleVideoStream(videoStream) && isCompatibleAudioStream(audioStream);
};
