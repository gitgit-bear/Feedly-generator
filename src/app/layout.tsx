import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, Noto_Sans_TC, Orbitron } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm",
});

const cjk = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-cjk",
  display: "swap",
});

const display = Orbitron({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-orbitron",
});

export const metadata: Metadata = {
  title: "CyberGuard Intelligence",
  description: "Cybersecurity RSS briefing for Feedly News Letter",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CyberGuard",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#05080f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-HK" className={`${sans.variable} ${cjk.variable} ${display.variable}`} suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
