/** Head tags for a merchant screen: private tools, so never indexed. */
export function merchantHead(title: string, description: string) {
  const full = `${title} — CPSE for shops`;
  return {
    meta: [
      { title: full },
      { name: "description", content: description },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: full },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  };
}
