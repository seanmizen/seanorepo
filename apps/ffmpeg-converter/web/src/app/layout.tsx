import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "Sean's Converter",
  description: 'Fast, free, no-watermark video conversion. Powered by ffmpeg.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
