import { describe, expect, it } from "vitest";
import { redactTelemetryString } from "./telemetryRedaction.js";

describe("redactTelemetryString", () => {
  it("redacts macOS, Linux, Windows, file URLs, and URL query strings", () => {
    expect(
      redactTelemetryString(
        [
          "/Users/alice/project/video.mp4",
          "/home/ubuntu/project/video.mp4",
          "/workspace/app/video.mp4",
          "C:\\Users\\Alice\\project\\video.mp4",
          "file:///tmp/render/video.mp4",
          "https://example.com/video.mp4?token=secret",
        ].join(" "),
      ),
    ).toBe("[path] [path] [path] [path] [file-url] https://example.com/video.mp4?…");
  });

  // The redactor used to enumerate roots (/Users, /home, /opt, /tmp, …). Any
  // root outside that list reached telemetry verbatim, which is most of them.
  it.each([
    "/data/media/interview.mov",
    "/mnt2/nfs/share/take3.wav",
    "/srv2/renders/2026/final.mp4",
    "/nix/store/abc123/asset.png",
  ])("redacts the non-allowlisted absolute root in %s", (path) => {
    const out = redactTelemetryString(`ffprobe failed reading ${path}`);
    expect(out).not.toContain("/");
    expect(out).toContain("[path]");
  });

  it("redacts relative paths, including a dash-prefixed one", () => {
    expect(redactTelemetryString("could not open ./assets/-weird-name.mp3")).toBe(
      "could not open [path]",
    );
    expect(redactTelemetryString("could not open ../-out.wav")).toBe("could not open [path]");
    expect(redactTelemetryString("could not open .\\tmp\\-x.aac")).toBe("could not open [path]");
  });

  it("redacts a bare basename — a caller may pass one instead of a path", () => {
    expect(redactTelemetryString("Invalid data found in my-client-cut.mp4")).toBe(
      "Invalid data found in [file]",
    );
  });

  // Over-redaction is cheap; these are ordinary in ffprobe stderr and turning
  // them into [path] would make a diagnostic string useless.
  it.each(["N/A", "24/1", "Stream #0:0", "moov atom not found", "48000/1001"])(
    "leaves %s alone",
    (text) => {
      expect(redactTelemetryString(`ffprobe: ${text}`)).toBe(`ffprobe: ${text}`);
    },
  );

  // A `?` is illegal in a Windows filename, so this is not a query string —
  // the whole token is path, and must not survive by hiding behind a `?`.
  it("consumes the rest of the token once a path is established", () => {
    expect(redactTelemetryString("Navigation failed for C:\\Users\\A\\v.mov?not-a-query")).toBe(
      "Navigation failed for [path]",
    );
  });

  it("truncates after redacting, so a long path cannot survive by being cut", () => {
    const out = redactTelemetryString(`/data/${"x".repeat(500)}/a.mp4`, 40);
    expect(out).not.toContain("xxx");
  });
});
