export const HoverVideo = ({ src, poster, className }) => {
  const videoRef = useRef(null);
  const [muted, setMuted] = useState(true);

  // Lazy initializer, not a post-mount effect: with useState(false) the first
  // committed render would emit `<video src autoPlay loop>` and only then pull the
  // attributes, so a reduce-motion visitor has already started fetching the file.
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
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }, [reduced]);

  const hear = () => {
    if (reduced) return;
    const video = videoRef.current;
    if (!video) return;
    setMuted(false);
    video.muted = false;
    video.play().catch(() => {});
  };
  const silence = () => {
    setMuted(true);
    const video = videoRef.current;
    if (video) video.muted = true;
  };

  return (
    <video
      ref={videoRef}
      className={className}
      src={reduced ? undefined : src}
      poster={poster}
      autoPlay={!reduced}
      muted={muted}
      loop={!reduced}
      playsInline
      preload="none"
      onMouseEnter={hear}
      onMouseLeave={silence}
    />
  );
};
