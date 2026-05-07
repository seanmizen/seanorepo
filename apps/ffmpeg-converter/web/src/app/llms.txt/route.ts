// Phase 5 placeholder. The real /llms.txt — generated from the operations
// matrix per spec §10 — ships alongside the MCP server in Phase 5. This stub
// is a valid llms.txt body so the footer link doesn't 404 in the meantime.
// Do NOT remove this route without also removing the footer link — see SEAN-51.

export const dynamic = 'force-static';

const BODY = `# Sean's Converter

> Free, in-browser file converter for video, audio, and images. No watermark,
> no signup, no email gate. Every job shows the equivalent ffmpeg command.

This llms.txt is a Phase 5 placeholder. The full machine-readable index of
every tool page and recipe lives at /llms-full.txt once Phase 5 ships.

## Links

- [Homepage](https://seansconverter.com/)
- [Source](https://github.com/seanmizen/seanorepo)
`;

export function GET() {
  return new Response(BODY, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
