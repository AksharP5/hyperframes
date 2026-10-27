/** Delivery encoder options: their fail-fast gate and the one resolved value every encoder path spreads. */

import { appendRateCapArgs, keyframeIntervalToGopSize } from "@hyperframes/engine";
import type { Fps } from "@hyperframes/core";
import { resolveHlsEncoderGopLock } from "./hlsConfig.js";

export interface DeliveryEncoderConfig {
  format?: string;
  fps: Fps;
  hlsSegmentSeconds?: number;
  keyframeIntervalSeconds?: number;
  maxBitrate?: string;
  bufferSize?: string;
}

/** The `EncoderOptions` fields the delivery config sets, ready to spread into any encoder input. */
export interface DeliveryEncoderOptions {
  maxBitrate?: string;
  bufferSize?: string;
  lockGopForChunkConcat: boolean;
  gopSize: number | undefined;
}

/** Reject what the encoders cannot honor, before any frame is captured. */
export function validateDeliveryEncoderConfig(config: DeliveryEncoderConfig): void {
  const { keyframeIntervalSeconds, maxBitrate, bufferSize, format } = config;
  if (keyframeIntervalSeconds === undefined && maxBitrate === undefined && bufferSize === undefined)
    return;
  if (keyframeIntervalSeconds !== undefined) {
    if (!Number.isFinite(keyframeIntervalSeconds) || keyframeIntervalSeconds <= 0) {
      throw new Error(
        `keyframeIntervalSeconds must be a positive number of seconds; got ${keyframeIntervalSeconds}`,
      );
    }
    if (format === "hls") {
      throw new Error(
        "keyframeIntervalSeconds does not apply to hls; hlsSegmentSeconds sets its keyframes",
      );
    }
  }
  if (format !== undefined && format !== "mp4") {
    throw new Error(`keyframeIntervalSeconds and maxBitrate apply to mp4 renders, not ${format}`);
  }
  // The engine owns bitrate parsing; running its builder here rejects a bad value up front.
  appendRateCapArgs([], { maxBitrate, bufferSize });
}

/** A chunk starts on a keyframe, so its GOP is the chunk, or the interval when that is shorter. */
export function chunkGopFrames(framesInChunk: number, intervalFrames?: number): number {
  return Math.min(framesInChunk, intervalFrames ?? framesInChunk);
}

export function resolveDeliveryEncoderOptions(
  config: DeliveryEncoderConfig,
): DeliveryEncoderOptions {
  const { maxBitrate, bufferSize, keyframeIntervalSeconds } = config;
  const gop =
    keyframeIntervalSeconds === undefined
      ? resolveHlsEncoderGopLock(config.format ?? "mp4", config.fps, config.hlsSegmentSeconds)
      : {
          lockGopForChunkConcat: true,
          gopSize: keyframeIntervalToGopSize(config.fps, keyframeIntervalSeconds),
        };
  return { maxBitrate, bufferSize, ...gop };
}
