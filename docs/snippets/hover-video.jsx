export const HoverVideo = ({ src, poster, className, hasAudio = true }) => {
  const videoRef = useRef(null);
  const wrapRef = useRef(null);
  const [muted, setMuted] = useState(true);
  const [inView, setInView] = useState(false);

  // Lazy initializer, not a post-mount effect: the preference is known on the
  // first committed render, so a reduce-motion visitor never autoplays first.
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

  // Only assign/decode a source near the viewport. Without this every card on
  // the page downloads and decodes its MP4 immediately, on- or off-screen.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver !== "function") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? false),
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Release the decoded resource once the card leaves the viewport. React props
  // alone neither pause an element nor abort its download, so pause() +
  // removeAttribute("src") + load() are all required. This same teardown is what
  // stops autoplay when the reduce-motion preference flips on mid-session.
  useEffect(() => {
    if (inView && !reduced) return;
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    if (!inView) {
      video.removeAttribute("src");
      video.load();
      setMuted(true);
    }
  }, [inView, reduced]);

  const hear = () => {
    const video = videoRef.current;
    if (!video || !hasAudio) return;
    setMuted(false);
    video.muted = false;
    // Voluntary playback — allowed even under reduced motion (autoplay is not).
    video.play().catch(() => {});
  };
  const silence = () => {
    setMuted(true);
    const video = videoRef.current;
    if (video) video.muted = true;
  };
  const toggle = () => (muted ? hear() : silence());

  const autoplaying = inView && !reduced;

  return (
    <div ref={wrapRef} className={`relative overflow-hidden ${className ?? ""}`}>
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        src={inView ? src : undefined}
        poster={poster}
        autoPlay={autoplaying}
        muted={muted}
        loop={autoplaying}
        playsInline
        preload="none"
        onMouseEnter={() => {
          if (hasAudio && !reduced) hear();
        }}
        onMouseLeave={silence}
      />
      {hasAudio && (
        <button
          type="button"
          onClick={toggle}
          aria-pressed={!muted}
          aria-label={muted ? "Play this preview with sound" : "Mute this preview"}
          className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur transition hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {muted ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>
          )}
          {muted ? "Sound" : "On"}
        </button>
      )}
    </div>
  );
};
