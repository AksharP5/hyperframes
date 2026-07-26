// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  formatMeasuredNote,
  parseMediaTreatmentSignalStats,
  statsToAdjust,
  summarizeMediaTreatmentAnalysis,
  type GradeMediaProbe,
} from "./mediaGradeAnalyzer";

const SIGNALSTATS = `frame:0 pts:0 pts_time:0
lavfi.signalstats.YMIN=4
lavfi.signalstats.YLOW=8
lavfi.signalstats.YAVG=100
lavfi.signalstats.YHIGH=240
lavfi.signalstats.YMAX=250
lavfi.signalstats.UAVG=120
lavfi.signalstats.VAVG=140
lavfi.signalstats.SATAVG=40
frame:1 pts:1 pts_time:1
lavfi.signalstats.YMIN=20
lavfi.signalstats.YLOW=20
lavfi.signalstats.YAVG=120
lavfi.signalstats.YHIGH=220
lavfi.signalstats.YMAX=230
lavfi.signalstats.UAVG=125
lavfi.signalstats.VAVG=135
lavfi.signalstats.SATAVG=60`;

const PROBE: GradeMediaProbe = {
  duration: 4,
  colorSpace: "bt2020nc",
  transfer: "smpte2084",
  primaries: "bt2020",
  pixelFormat: "yuv420p10le",
};

function productResult() {
  const frames = parseMediaTreatmentSignalStats(SIGNALSTATS);
  const summary = summarizeMediaTreatmentAnalysis(PROBE, frames);
  return {
    frames,
    summary,
    adjust: statsToAdjust(summary.measured),
    note: formatMeasuredNote("/tmp/frame.png", summary.measured),
  };
}

async function vendoredResult() {
  const moduleUrl = new URL(
    "../../../skills/media-use/scripts/lib/grade-analyzer.mjs",
    import.meta.url,
  );
  const analyzer = await import(moduleUrl.href);
  const frames = analyzer.parseMediaTreatmentSignalStats(SIGNALSTATS);
  const summary = analyzer.summarizeMediaTreatmentAnalysis(PROBE, frames);
  return {
    frames,
    summary,
    adjust: analyzer.statsToAdjust(summary.measured),
    note: analyzer.formatMeasuredNote("/tmp/frame.png", summary.measured),
  };
}

describe("vendored media grade analyzer parity", () => {
  it("keeps the standalone skill copy aligned with the typed product module", async () => {
    expect(await vendoredResult()).toEqual(productResult());
  });
});
