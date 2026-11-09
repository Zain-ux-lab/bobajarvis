import type { Metadata } from "next";
import { Bricolage_Grotesque, Atkinson_Hyperlegible_Next } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ variable: "--font-display", subsets: ["latin"] });
const data = Atkinson_Hyperlegible_Next({ variable: "--font-data", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BobaJarvis",
  description: "Earpiece-first voice assistant prototype for a lone bubble tea barista (simulated POS).",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${data.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
