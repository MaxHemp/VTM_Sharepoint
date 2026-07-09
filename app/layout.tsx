import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VTM Teamportal",
  description: "Privates Teamportal für Dokumente, News, Aufgaben und Termine",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
