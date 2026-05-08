// SEAN-55 — JSON-LD renderer.
//
// Tiny server component that emits one `<script type="application/ld+json">`
// tag per schema object passed in. Server-rendered into the HTML at build
// time so Lighthouse SEO sees the structured data on first paint — never
// injected client-side.
//
// We render one script tag per schema rather than wrapping them in a
// `@graph` array so each schema is independently visible to Google's rich
// result tester (multiple separate scripts is the documented Google
// recommendation when types are unrelated).

export interface JsonLdProps {
  /** One schema.org object per script tag. Order is preserved in the HTML. */
  schemas: ReadonlyArray<Record<string, unknown>>;
}

export function JsonLd({ schemas }: JsonLdProps) {
  if (!schemas || schemas.length === 0) return null;
  return (
    <>
      {schemas.map((schema, i) => (
        <script
          // biome-ignore lint/suspicious/noArrayIndexKey: schemas array is static for the lifetime of the page render and never reordered
          key={i}
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD requires the JSON to be the literal text content of a <script> tag
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  );
}
