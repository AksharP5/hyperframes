/**
 * A wall of finished HyperFrames films.
 *
 * Every tile is a silent six-second loop that plays where it sits, so the
 * section shows motion without asking for a click. Selecting one swaps it for
 * the full film with its sound, which is the only point at which the heavy file
 * is fetched — the loops are 37-241KB each, the films are 1-8MB.
 *
 * Constraints this works within: no third-party packages, named export only,
 * hooks are pre-injected, and Mintlify rewrites Tailwind utilities into its own
 * namespace — so anything load-bearing here is an inline style.
 */

export const ShowcaseWall = () => {
  // Declared inside the component deliberately: Mintlify compiles only the
  // exported component out of a snippet file and drops module-level consts,
  // so constants defined above this line arrive undefined at render time.
  const CDN = "https://static.heygen.ai/hyperframes-oss/docs/images/showcase";

  const FILMS = [
    {
      id: "grading",
      title: "Colour grading and media effects",
      note: "Real footage graded with LUTs, curves, and scopes — inside Studio.",
      length: "48s",
    },
    {
      id: "variables",
      title: "One shoot, many cuts",
      note: "The same footage rendered as several vertical videos from one project.",
      length: "44s",
    },
    {
      id: "music",
      title: "Cut to the music",
      note: "A track analysed for beats and sections, then everything snapped to that grid.",
      length: "90s",
    },
    {
      id: "prvideo",
      title: "A pull request, explained",
      note: "A code change turned into a review anyone on the team can watch.",
      length: "32s",
    },
    {
      id: "timeline",
      title: "Editing on a timeline",
      note: "Trimming, splitting, and retiming a project by hand.",
      length: "34s",
    },
    {
      id: "hypecard",
      title: "A year in review",
      note: "Personal data turned into a shareable card, generated per person.",
      length: "27s",
    },
  ];

  const [openId, setOpenId] = useState(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const onChange = (e) => setReduced(e.matches);
    q.addEventListener("change", onChange);
    return () => q.removeEventListener("change", onChange);
  }, []);

  const open = FILMS.find((f) => f.id === openId) || null;

  if (open) {
    return (
      <div style={{ margin: "1.5rem 0" }}>
        <video
          key={open.id}
          src={`${CDN}/full-${open.id}.mp4`}
          poster={`${CDN}/tile-${open.id}.jpg`}
          controls
          autoPlay
          playsInline
          style={{
            width: "100%",
            display: "block",
            borderRadius: "12px",
            background: "#000",
            margin: 0,
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "1rem",
            marginTop: "0.6rem",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "0.875rem", opacity: 0.75 }}>
            <strong>{open.title}</strong> · {open.length} · made with HyperFrames
          </span>
          <button
            type="button"
            onClick={() => setOpenId(null)}
            style={{
              fontSize: "0.8125rem",
              padding: "0.35rem 0.7rem",
              borderRadius: "7px",
              border: "1px solid currentColor",
              background: "transparent",
              color: "inherit",
              opacity: 0.7,
              cursor: "pointer",
            }}
          >
            ← Back to all films
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: "0.85rem",
        margin: "1.5rem 0",
      }}
    >
      {FILMS.map((film) => (
        <button
          key={film.id}
          type="button"
          onClick={() => setOpenId(film.id)}
          aria-label={`Play ${film.title}, ${film.length}, with sound`}
          style={{
            display: "block",
            width: "100%",
            padding: 0,
            border: "1px solid rgba(128,128,128,0.28)",
            borderRadius: "11px",
            overflow: "hidden",
            background: "transparent",
            color: "inherit",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <video
            src={reduced ? undefined : `${CDN}/tile-${film.id}.mp4`}
            poster={`${CDN}/tile-${film.id}.jpg`}
            autoPlay={!reduced}
            muted
            loop={!reduced}
            playsInline
            preload="metadata"
            style={{
              width: "100%",
              aspectRatio: "16 / 9",
              objectFit: "cover",
              display: "block",
              background: "#000",
              margin: 0,
            }}
          />
          <span style={{ display: "block", padding: "0.7rem 0.85rem 0.85rem" }}>
            <span style={{ display: "block", fontWeight: 600, fontSize: "0.9375rem" }}>
              {film.title}
            </span>
            <span
              style={{
                display: "block",
                fontSize: "0.8125rem",
                opacity: 0.7,
                marginTop: "0.15rem",
              }}
            >
              {film.note}
            </span>
            <span
              style={{
                display: "block",
                fontSize: "0.75rem",
                opacity: 0.55,
                marginTop: "0.35rem",
              }}
            >
              ▶ Play with sound · {film.length}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
};
