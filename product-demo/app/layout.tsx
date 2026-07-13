import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);

  return {
    title: "Draft Coach — Explainable champ-select recommendations",
    description: "An interactive, privacy-safe demonstration of Draft Coach, a read-only League of Legends champ-select companion.",
    metadataBase: base,
    openGraph: {
      title: "Draft Coach — Understand the draft before you lock in",
      description: "Explore a simulated draft and see how Draft Coach explains several champion choices without acting on your behalf.",
      type: "website",
      images: [{ url: new URL("/og.png", base).toString(), width: 1200, height: 630, alt: "Draft Coach interactive product demonstration" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Draft Coach",
      description: "Explainable, read-only champ-select recommendations.",
      images: [new URL("/og.png", base).toString()],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
