import { TIMELINE_VIEWPORT_BUDGETS, type TimelineViewportBudgets } from "./timelineViewportBudgets";
import {
  createThumbnailKey,
  type ThumbnailLoadedResult,
  type ThumbnailValue,
} from "./thumbnailScheduler";
import { MediaFetchError, reportMediaFetchFailure } from "./mediaFetch";
import {
  acquireThumbnailSource,
  timedOut,
  type SourceInfo,
  type ThumbnailSource,
} from "./thumbnailSourcePool";
import {
  releaseSharedFrames,
  shareFrame,
  takeSharedFrame,
  type HeldFrame,
} from "./thumbnailFrameCache";

export interface VideoThumbnailDecodeRequest {
  source: string;
  contentVersion?: string;
  sourceStart?: number;
  sourceRangeDuration?: number;
  frameCount: number;
  fit?: "contain" | "cover";
}

const LAST_FRAME_INSET_S = 0.001;

export function videoThumbnailTimestamps(
  start: number,
  duration: number,
  frameCount: number,
): number[] {
  const safeStart = Math.max(0, Number.isFinite(start) ? start : 0);
  const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);
  const count = Math.max(1, Number.isFinite(frameCount) ? Math.floor(frameCount) : 1);
  if (count === 1) return [safeStart + safeDuration / 2];
  const edges = Array.from(
    { length: count },
    (_, index) => safeStart + (safeDuration * index) / count,
  );
  return [...edges, safeStart + Math.max(0, safeDuration - LAST_FRAME_INSET_S)];
}

interface FrameWindow {
  sourceStart: number;
  lead: number;
  end: number;
}

const sourceInfos = new Map<string, { version: string | undefined; info: SourceInfo }>();

const accepts = (window: FrameWindow, time: number, decodedAt: number) =>
  decodedAt >= window.sourceStart && time - decodedAt <= (time >= window.end ? 0 : window.lead);

class ClipResultError extends Error {}

async function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new ClipResultError("Video thumbnail encode failed")),
        "image/jpeg",
        0.72,
      );
    });
  }
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 }).catch(() => {
    throw new ClipResultError("Video thumbnail encode failed");
  });
}

interface DecodedResources {
  urls: (string | undefined)[];
  held: HeldFrame[];
  canvases: Set<HTMLCanvasElement | OffscreenCanvas>;
  releasedFrameBytes: number;
  decodedByJob: number;
}

interface ThumbnailCanvasSink {
  canvasesAtTimestamps(
    timestamps: AsyncIterable<number>,
  ): AsyncIterable<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null>;
}

const timeoutWithoutProgress = () => new MediaFetchError("thumbnail", null, "timeout");

const isAbortError = (error: unknown) =>
  (error as { name?: unknown } | null)?.name === "AbortError";
const isSourceFailure = (error: unknown) =>
  !isAbortError(error) && !(error instanceof ClipResultError);
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

function releaseDecodedResources(resources: DecodedResources): void {
  resources.urls.length = 0;
  releaseSharedFrames(resources.held, resources.releasedFrameBytes);
  for (const canvas of resources.canvases) {
    canvas.width = 0;
    canvas.height = 0;
  }
  resources.canvases.clear();
}

function targetDimensions(
  aspect: number,
  budgets: Readonly<TimelineViewportBudgets>,
): { width: number; height: number } {
  const width = Math.max(
    1,
    Math.min(budgets.posterMaxPhysicalWidth, Math.round(budgets.posterMaxPhysicalHeight * aspect)),
  );
  return {
    width,
    height: Math.max(1, Math.min(budgets.posterMaxPhysicalHeight, Math.round(width / aspect))),
  };
}

function stripTimes(
  request: VideoThumbnailDecodeRequest,
  info: SourceInfo,
  budgets: Readonly<TimelineViewportBudgets>,
) {
  const requestedStart = Math.max(0, request.sourceStart ?? 0);
  const sourceDuration = Math.max(
    0,
    info.metadataDuration ?? requestedStart + (request.sourceRangeDuration ?? 0),
  );
  const sourceStart = Math.min(requestedStart, sourceDuration);
  const requestedDuration =
    request.sourceRangeDuration ?? Math.max(0, sourceDuration - sourceStart);
  const duration = Math.min(
    Math.max(0, requestedDuration),
    Math.max(0, sourceDuration - sourceStart),
  );
  const timestamps = videoThumbnailTimestamps(
    sourceStart,
    duration,
    Math.min(request.frameCount, budgets.richPreviewFrameCount),
  );
  const slices = Math.max(1, timestamps.length - 1);
  const window: FrameWindow = {
    sourceStart,
    lead: duration / Math.max(2, slices) / 2,
    end: timestamps.length > 1 ? timestamps.at(-1)! : Infinity,
  };
  return { window, timestamps };
}

function takeDecodedFrames(
  { timestamps, window }: ReturnType<typeof stripTimes>,
  keyOf: (time: number) => string,
  resources: DecodedResources,
): number[] {
  const missing: number[] = [];
  timestamps.forEach((time, slot) => {
    const key = keyOf(time);
    const frame = takeSharedFrame(key, (decodedAt) => accepts(window, time, decodedAt));
    if (!frame) return void missing.push(slot);
    resources.urls[slot] = frame.url;
    resources.held.push({ key, frame });
  });
  return missing;
}

async function decodeFrames(
  sink: ThumbnailCanvasSink,
  times: AsyncIterable<number>,
  slots: { slot: number; key: string; decodedAt?: number }[],
  signal: AbortSignal,
  resources: DecodedResources,
): Promise<void> {
  let next = 0;
  for await (const wrapped of sink.canvasesAtTimestamps(times)) {
    throwIfAborted(signal);
    const target = slots[next++];
    if (!wrapped || target?.decodedAt === undefined) continue;
    resources.canvases.add(wrapped.canvas);
    const blob = await canvasToBlob(wrapped.canvas);
    throwIfAborted(signal);
    const frame = shareFrame(target.key, target.decodedAt, URL.createObjectURL(blob), blob.size);
    resources.decodedByJob += 1;
    resources.urls[target.slot] = frame.url;
    resources.held.push({ key: target.key, frame });
  }
  throwIfAborted(signal);
}

function loadedResult(
  resources: DecodedResources,
  aspect: number,
  budgets: Readonly<TimelineViewportBudgets>,
  frameCount = resources.urls.length,
): ThumbnailLoadedResult {
  const decoded = resources.urls.filter((url): url is string => url !== undefined);
  const firstUrl = decoded[0];
  if (!firstUrl) throw new ClipResultError("Video source returned no thumbnail frames");
  let nearest = firstUrl;
  const urls = Array.from(
    { length: frameCount },
    (_, slot) => (nearest = resources.urls[slot] ?? nearest),
  );
  const { width, height } = targetDimensions(aspect, budgets);
  const value: ThumbnailValue =
    urls.length === 1
      ? { kind: "image", url: firstUrl, aspect }
      : { kind: "filmstrip", urls, aspect };
  return {
    value,
    weight: width * height * 4 * decoded.length,
    dispose: () => releaseDecodedResources(resources),
  };
}

/** Sparse Mediabunny extraction with one pooled canvas and one cleanup owner. */
export async function decodeVideoThumbnail(
  request: VideoThumbnailDecodeRequest,
  signal: AbortSignal,
  budgets: Readonly<TimelineViewportBudgets> = TIMELINE_VIEWPORT_BUDGETS,
): Promise<ThumbnailLoadedResult> {
  const fit = request.fit ?? "cover";
  const sourceKey = createThumbnailKey({ source: request.source, version: request.contentVersion });
  const keyOf = (time: number) => `${sourceKey}\u0000${fit}\u0000${time}`;
  const resources: DecodedResources = {
    urls: [],
    held: [],
    canvases: new Set(),
    releasedFrameBytes: budgets.sharedFrameCacheBytes,
    decodedByJob: 0,
  };
  const entry = sourceInfos.get(request.source);
  const known = entry?.version === request.contentVersion ? entry?.info : undefined;
  try {
    if (known) {
      if (takeDecodedFrames(stripTimes(request, known, budgets), keyOf, resources).length === 0) {
        throwIfAborted(signal);
        return loadedResult(resources, known.aspect, budgets);
      }
      releaseDecodedResources(resources);
    }
    return await decodeMissingFrames(request, signal, budgets, keyOf, resources);
  } catch (error) {
    releaseDecodedResources(resources);
    reportMediaFetchFailure(error);
    throw error;
  }
}

async function decodeMissingFrames(
  request: VideoThumbnailDecodeRequest,
  signal: AbortSignal,
  budgets: Readonly<TimelineViewportBudgets>,
  keyOf: (time: number) => string,
  resources: DecodedResources,
): Promise<ThumbnailLoadedResult> {
  let source: ThumbnailSource;
  try {
    source = await acquireThumbnailSource(
      request.source,
      request.contentVersion,
      signal,
      budgets.thumbnailSourceIdleMs,
    );
  } catch (error) {
    if (timedOut(signal)) reportMediaFetchFailure(timeoutWithoutProgress());
    throw error;
  }
  const releaseOnAbort = () => {
    const madeProgress = source.waitedForOpen || resources.decodedByJob > 0;
    const failed = timedOut(signal) && !madeProgress;
    if (failed) reportMediaFetchFailure(timeoutWithoutProgress());
    source.release(failed);
  };
  signal.addEventListener("abort", releaseOnAbort, { once: true });
  try {
    throwIfAborted(signal);
    const { mediabunny, track, info } = source;
    sourceInfos.set(request.source, { version: request.contentVersion, info });
    const strip = stripTimes(request, info, budgets);
    const { timestamps, window } = strip;
    const slots: { slot: number; key: string; decodedAt?: number }[] = takeDecodedFrames(
      strip,
      keyOf,
      resources,
    ).map((slot) => ({ slot, key: keyOf(timestamps[slot]!) }));
    if (slots.length > 0) {
      const keys = new mediabunny.EncodedPacketSink(track);
      async function* decodeTimesAtNearbyKeyframes() {
        for (const target of slots) {
          const time = timestamps[target.slot]!;
          const key = await keys.getKeyPacket(time, { metadataOnly: true });
          if (signal.aborted) return;
          target.decodedAt = key && accepts(window, time, key.timestamp) ? key.timestamp : time;
          yield target.decodedAt;
        }
      }
      const target = targetDimensions(info.aspect, budgets);
      const sink = new mediabunny.CanvasSink(track, {
        width: target.width,
        height: target.height,
        fit: request.fit ?? "cover",
        poolSize: 1,
      });
      await decodeFrames(sink, decodeTimesAtNearbyKeyframes(), slots, signal, resources);
    }
    const result = loadedResult(resources, info.aspect, budgets, timestamps.length);
    source.release(false);
    return result;
  } catch (error) {
    source.release(isSourceFailure(error));
    throw error;
  } finally {
    signal.removeEventListener("abort", releaseOnAbort);
  }
}
