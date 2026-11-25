import type { Metadata } from "next";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/noto-sans-sc/500.css";
import "@fontsource/noto-sans-sc/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://censuscurve.top"),
  title: "身份配额曲线",
  description: "只给 Agent ID 的链上发行",
  openGraph: {
    title: "身份配额曲线",
    description: "只给 Agent ID 的链上发行",
    url: "https://censuscurve.top/curve/",
    siteName: "身份配额曲线",
  },
  twitter: {
    card: "summary_large_image",
    site: "@censuscurve",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hans" translate="no" className="notranslate">
      <body>{children}</body>
    </html>
  );
}
