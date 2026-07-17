import { SITE_DESCRIPTION, SITE_URL } from "@/lib/site";
import { LANDING_FAQ } from "./faq-section";

// Structured data for the public landing page, emitted as three separate
// ld+json scripts a search or answer engine can read verbatim: who runs it
// (Organization), what it is (a free WebApplication), and the FAQ. The FAQ nodes
// are generated 1:1 from LANDING_FAQ, so the answers a crawler is told are
// exactly the ones a visitor reads on the page — same honesty bar, no oversell.
const graphs: Record<string, unknown>[] = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: "tellmewhy",
    url: SITE_URL,
    description: SITE_DESCRIPTION,
  },
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": `${SITE_URL}/#webapplication`,
    name: "tellmewhy",
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    applicationCategory: "HealthApplication",
    operatingSystem: "Web",
    publisher: { "@id": `${SITE_URL}/#organization` },
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_URL}/#faq`,
    mainEntity: LANDING_FAQ.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  },
];

export function JsonLd() {
  return (
    <>
      {graphs.map((graph) => (
        <script
          key={graph["@type"] as string}
          type="application/ld+json"
          // Static, author-controlled copy only — no user input is interpolated.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
        />
      ))}
    </>
  );
}
