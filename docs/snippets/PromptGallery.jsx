export const PromptGallery = () => {
  const examples = [
    {
      label: "Launch a product",
      prompt:
        "Make a short launch video for HyperFrames. Show the product in use and end on the name.",
      video:
        "https://static.heygen.ai/hyperframes-oss/docs/images/showcase/hyperframes-launch-preview.mp4",
    },
    {
      label: "Reveal a feature",
      prompt:
        "Announce the new timeline editor. Show the editing problem, then reveal the visual editor.",
      video:
        "https://static.heygen.ai/hyperframes-oss/docs/images/showcase/timeline-editor-preview.mp4",
    },
    {
      label: "Show a website",
      prompt:
        "Turn this website into a product video. Use the real interface as proof.",
      video:
        "https://static.heygen.ai/hyperframes-oss/docs/images/showcase/website-to-hyperframes-preview.mp4",
    },
    {
      label: "Make a motion piece",
      prompt:
        "Create a short type-led feature video. Let texture and motion carry the message.",
      video:
        "https://static.heygen.ai/hyperframes-oss/docs/images/showcase/texture-launch-preview.mp4",
    },
  ];
  const [active, setActive] = useState(0);
  const example = examples[active];

  return (
    <div className="hf-prompt-demo">
      <div className="hf-prompt-demo__brief">
        <div className="hf-prompt-demo__tabs">
          {examples.map((item, index) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={active === index}
              className={
                active === index
                  ? "hf-prompt-demo__tab is-active"
                  : "hf-prompt-demo__tab"
              }
              onClick={() => setActive(index)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="hf-prompt-demo__prompt">{example.prompt}</p>
        <a className="hf-prompt-demo__link" href="/quickstart">
          Make your first video →
        </a>
      </div>
      <div className="hf-prompt-demo__result">
        <video
          src={example.video}
          controls
          playsInline
          preload="metadata"
        />
      </div>
    </div>
  );
};
