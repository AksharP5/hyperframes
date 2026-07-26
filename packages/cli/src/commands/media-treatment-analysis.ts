import {
  analyzeMediaGrade,
  type MediaTreatmentAnalysis,
} from "../../../../skills/media-use/scripts/lib/grade-analyzer.mjs";
import { findFFmpeg, findFFprobe, getFFmpegInstallHint } from "../browser/ffmpeg.js";

interface CliMediaTreatmentAnalysis extends Omit<MediaTreatmentAnalysis, "adjust"> {
  suggestedPatch: { adjust: Record<string, number> };
}

export function analyzeMediaTreatment(mediaPath: string): CliMediaTreatmentAnalysis {
  const ffmpegPath = findFFmpeg();
  const ffprobePath = findFFprobe();
  if (!ffmpegPath || !ffprobePath) {
    throw new Error(`FFmpeg and ffprobe are required. ${getFFmpegInstallHint()}`);
  }
  const analysis = analyzeMediaGrade(mediaPath, { ffmpegPath, ffprobePath });
  const { adjust, ...evidence } = analysis;
  return { ...evidence, suggestedPatch: { adjust } };
}
