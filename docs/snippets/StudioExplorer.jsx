export const StudioExplorer = () => {
  const views = [
    {
      label: "Workspace",
      image: "/images/studio/overview.jpg",
      alt: "Studio workspace with the canvas, timeline, and editing panels",
    },
    {
      label: "Storyboard",
      image: "/images/studio/storyboard.jpg",
      alt: "Storyboard with planned scenes and their status",
    },
    {
      label: "Inspector",
      image: "/images/studio/inspector.jpg",
      alt: "Inspector controls for the selected element",
    },
    {
      label: "Export",
      image: "/images/studio/export.jpg",
      alt: "Renders panel with export controls",
    },
  ];
  const [active, setActive] = useState(0);
  const view = views[active];

  return (
    <div className="hf-studio-explorer">
      <div className="hf-studio-explorer__tabs">
        {views.map((item, index) => (
          <button
            key={item.label}
            type="button"
            aria-pressed={active === index}
            className={
              active === index
                ? "hf-studio-explorer__tab is-active"
                : "hf-studio-explorer__tab"
            }
            onClick={() => setActive(index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <img src={view.image} alt={view.alt} />
    </div>
  );
};
