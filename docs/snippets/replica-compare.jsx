export const ReplicaCompare = ({
  title,
  meta,
  refSrc,
  refPoster,
  replicaSrc,
  replicaPoster,
}) => {
  const refVideo = useRef(null);
  const repVideo = useRef(null);
  const [muted, setMuted] = useState(true);

  // Lazy initializer, not a post-mount effect: with useState(false) the first
  // committed render would emit `<video src autoPlay loop>` and only then pull the
  // attributes, so a reduce-motion visitor has already started fetching both films.
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // React can drop src/autoPlay/loop from the DOM, but that neither pauses a
  // playing element nor aborts its resource: pause(), removeAttribute("src") and
  // load() are all required when the preference flips to reduce mid-session.
  useEffect(() => {
    if (!reduced) return;
    for (const video of [refVideo.current, repVideo.current]) {
      if (!video) continue;
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }, [reduced]);

  // Keep the replica (right) locked to the reference (left) clock.
  useEffect(() => {
    const a = refVideo.current;
    const b = repVideo.current;
    if (!a || !b || reduced) return;

    const resync = () => {
      if (Number.isFinite(a.currentTime) && Math.abs((b.currentTime || 0) - a.currentTime) > 0.15) {
        try {
          b.currentTime = a.currentTime;
        } catch {}
      }
      if (a.paused && !b.paused) b.pause();
      if (!a.paused && b.paused) b.play().catch(() => {});
    };
    const onPlay = () => b.play().catch(() => {});
    const onPause = () => b.pause();

    a.addEventListener("timeupdate", resync);
    a.addEventListener("seeked", resync);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("timeupdate", resync);
      a.removeEventListener("seeked", resync);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, [reduced]);

  const toggleSound = () => {
    const a = refVideo.current;
    if (!a) return;
    const next = !muted;
    setMuted(next);
    a.muted = next; // only the reference carries audio; replica stays silent
    if (!next) a.play().catch(() => {});
  };

  const card =
    "overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";
  const video = "aspect-video w-full object-cover bg-zinc-100 dark:bg-zinc-900";
  const cap = "text-xs font-semibold uppercase tracking-wide";

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <strong className="text-sm">{title}</strong>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{meta}</span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={`relative ${card}`}>
          <video
            ref={refVideo}
            className={video}
            src={reduced ? undefined : refSrc}
            poster={refPoster}
            autoPlay={!reduced}
            muted
            loop={!reduced}
            playsInline
            preload="metadata"
          />
          <button
            type="button"
            onClick={toggleSound}
            aria-label={muted ? "Unmute the reference" : "Mute the reference"}
            className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition hover:bg-black/75"
          >
            {muted ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>
            )}
            {muted ? "Sound off" : "Sound on"}
          </button>
          <div className="p-3">
            <span className={`${cap} text-zinc-500 dark:text-zinc-400`}>Reference — original film</span>
          </div>
        </div>
        <div className={card}>
          <video
            ref={repVideo}
            className={video}
            src={reduced ? undefined : replicaSrc}
            poster={replicaPoster}
            autoPlay={!reduced}
            muted
            loop={!reduced}
            playsInline
            preload="metadata"
          />
          <div className="p-3">
            <span className={`${cap} text-zinc-700 dark:text-zinc-300`}>HyperFrames replica</span>
          </div>
        </div>
      </div>
    </div>
  );
};
