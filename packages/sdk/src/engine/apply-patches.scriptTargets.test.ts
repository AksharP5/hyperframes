import { describe, expect, it } from "vitest";
import { parseMutable } from "./model.js";
import { applyOverrideSet, applyPatchesToDocument } from "./apply-patches.js";
import { serializeDocument } from "./serialize.js";
import { openComposition } from "../session.js";

// The failing shape: the script dereferences the lookup unguarded, so a removed node throws.
const HTML = `<!DOCTYPE html><html><body>
<div data-composition-id="c" data-width="1920" data-height="1080">
<svg><path data-hf-id="hf-arch" id="arch-path" d="M0 0"></path></svg>
<audio data-hf-id="hf-aud" id="narration" src="a.mp3" data-start="0" data-duration="9"></audio>
<div data-hf-id="hf-plain" id="plain">keep</div>
</div>
<script>document.getElementById('arch-path').getTotalLength(); document.getElementById('narration');</script>
</body></html>`;

describe("a stored delete a script looks up", () => {
  it("leaves the live document, and serializes back hidden", () => {
    const parsed = parseMutable(HTML);
    applyOverrideSet(parsed, { "hf-arch": null });
    expect(parsed.document.getElementById("arch-path")).toBeNull();
    const out = serializeDocument(parsed);
    expect(out).toContain('id="arch-path"');
    expect(out).toContain("display: none");
    expect(parsed.document.getElementById("arch-path")).toBeNull();
  });

  it("is no longer a clip once serialized, so its media is not mixed", () => {
    const parsed = parseMutable(HTML);
    applyOverrideSet(parsed, { "hf-aud": null });
    const out = serializeDocument(parsed);
    expect(out).toContain('id="narration"');
    expect(out).not.toMatch(/id="narration"[^>]*data-start|data-start[^>]*id="narration"/);
    expect(out).not.toContain('data-duration="9"');
    // The audio mixer and the runtime skip [data-hidden]; display:none alone would still play the track.
    expect(out).toMatch(/<audio[^>]*data-hidden/);
  });

  it("is still absent from the session model", async () => {
    const comp = await openComposition(HTML, { overrides: { "hf-arch": null }, history: false });
    expect(comp.getElements().some((el) => el.id === "hf-arch")).toBe(false);
    expect(comp.getElement("hf-arch")).toBeNull();
    expect(comp.serialize()).toContain('id="arch-path"');
  });

  it("is not written back twice once an undo has put it back", () => {
    const parsed = parseMutable(HTML);
    applyOverrideSet(parsed, { "hf-arch": null });
    const [kept] = parsed.keptDeletes ?? [];
    applyPatchesToDocument(parsed, [
      {
        op: "add",
        path: "/elements/hf-arch",
        value: { html: kept?.html, parentId: kept?.parentId, siblingIndex: kept?.siblingIndex },
      },
    ]);
    expect(serializeDocument(parsed).match(/id="arch-path"/g)).toHaveLength(1);
  });

  it("is removed as before when no script looks it up", () => {
    const parsed = parseMutable(HTML);
    applyOverrideSet(parsed, { "hf-plain": null });
    expect(serializeDocument(parsed)).not.toContain('id="plain"');
  });

  it("is removed by a plain patch, which undo and redo rely on", () => {
    const parsed = parseMutable(HTML);
    applyPatchesToDocument(parsed, [{ op: "remove", path: "/elements/hf-arch" }]);
    expect(serializeDocument(parsed)).not.toContain('id="arch-path"');
  });
});
