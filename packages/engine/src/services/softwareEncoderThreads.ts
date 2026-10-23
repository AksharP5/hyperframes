import { availableParallelism } from "node:os";

/** x264/x265 bitstreams depend on the thread count, so it comes from the CPU quota, never ffmpeg's host-core guess. */
export function appendSoftwareEncoderThreadsArg(
  args: string[],
  parallelism: number = availableParallelism(),
): void {
  args.push("-threads", String(Math.max(1, Math.floor(parallelism))));
}
