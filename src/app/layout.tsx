import type { Metadata } from "next";
import type React from "react";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Launchctl Admin",
  description: "Local launchctl and plist inspector for macOS.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
