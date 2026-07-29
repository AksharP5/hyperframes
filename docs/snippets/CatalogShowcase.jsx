export const CatalogShowcase = () => {
  const items = [
    {
      title: "Code animation",
      href: "/catalog/blocks/code-typing",
      video:
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/code-typing.mp4",
      poster:
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/code-typing.png",
    },
    {
      title: "Captions",
      href: "/catalog/components/caption-highlight",
      video:
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/components/caption-highlight.mp4",
      poster:
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/components/caption-highlight.png",
    },
    {
      title: "Transitions",
      href: "/catalog/blocks/cinematic-zoom",
      video:
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/cinematic-zoom.mp4",
      poster:
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/cinematic-zoom.png",
    },
    {
      title: "Social overlays",
      href: "/catalog/blocks/x-post",
      video:
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/x-post.mp4",
      poster:
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/x-post.png",
    },
    {
      title: "Data and maps",
      href: "/catalog/blocks/data-chart",
      video:
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/data-chart.mp4",
      poster:
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/data-chart.png",
    },
    {
      title: "Showcase scenes",
      href: "/catalog/blocks/app-showcase",
      video:
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/app-showcase.mp4",
      poster:
        "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/app-showcase.png",
    },
  ];

  return (
    <div className="hf-catalog-showcase">
      {items.map((item) => (
        <a key={item.href} href={item.href}>
          <video
            src={item.video}
            poster={item.poster}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
          />
          <span>{item.title} →</span>
        </a>
      ))}
    </div>
  );
};
