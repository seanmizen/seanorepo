export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">
        Sean&apos;s Converter
      </h1>
      <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
        Fast, free, no-watermark video conversion. Powered by ffmpeg.
      </p>
      <p className="mt-8 text-sm text-gray-500">
        Phase 1 scaffold. Tool pages, drop zone, and pSEO matrix arrive in
        subsequent tickets.
      </p>
      <p className="mt-4 text-sm text-gray-500">
        API is proxied through{' '}
        <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-800">
          /api/*
        </code>{' '}
        to the Go backend.
      </p>
    </main>
  );
}
