import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Drive Mad — Offline Archive",
  description: "A local, versioned archive of Drive Mad.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
