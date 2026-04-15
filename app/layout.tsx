import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AllTheRepos",
  description: "Your personal developer repo hub",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
