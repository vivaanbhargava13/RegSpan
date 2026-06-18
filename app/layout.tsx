import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RegSpan | Reg S-P Evidence Mapping",
  description: "AI-assisted Reg S-P evidence mapping for financial firms.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
