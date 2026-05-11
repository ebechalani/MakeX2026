import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'MakeX 2026 – Lebanon National Competition',
  description: 'Live competition management system for MakeX 2026',
  // iPad / iOS Safari: enable add-to-home-screen and fullscreen
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MakeX 2026',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Prevent stray pinch-zoom from breaking the signature canvas during a match
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-50 min-h-screen`}>
        {children}
      </body>
    </html>
  );
}
