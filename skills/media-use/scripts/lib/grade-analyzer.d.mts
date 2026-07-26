export interface GradeSignalFrame {
  ptsTime?: number;
  YMIN?: number;
  YLOW?: number;
  YAVG?: number;
  YHIGH?: number;
  YMAX?: number;
  UAVG?: number;
  VAVG?: number;
  SATAVG?: number;
}

export interface GradeMediaProbe {
  duration: number | null;
  colorSpace: string;
  transfer: string;
  primaries: string;
  pixelFormat: string;
}

export interface MediaTreatmentAnalysis {
  adjust: Record<string, number>;
  measured: {
    frames: number;
    yMin: number;
    yLow: number;
    yAvg: number;
    yHigh: number;
    yMax: number;
    uAvg: number;
    vAvg: number;
    satAvg: number;
    shadowClipRisk: number;
    highlightClipRisk: number;
  };
  source: {
    colorSpace: string;
    transfer: string;
    primaries: string;
    pixelFormat: string;
    hdr: boolean;
    log: "unknown";
  };
  diagnosis: string[];
  warnings: string[];
}

export function parseMediaTreatmentSignalStats(raw: string): GradeSignalFrame[];
export function statsToAdjust(
  stats: Record<string, number>,
): Pick<MediaTreatmentAnalysis, "adjust" | "measured">;
export function summarizeMediaTreatmentAnalysis(
  probe: GradeMediaProbe,
  frames: readonly GradeSignalFrame[],
): MediaTreatmentAnalysis;
export function analyzeMediaGrade(
  mediaPath: string,
  options?: {
    ffmpegPath?: string;
    ffprobePath?: string;
  },
): MediaTreatmentAnalysis;
export function formatMeasuredNote(
  mediaPath: string,
  measured: MediaTreatmentAnalysis["measured"],
): string;
