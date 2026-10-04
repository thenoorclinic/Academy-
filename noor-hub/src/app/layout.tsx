import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NOOR Hub",
  description: "Gestión de facturas, banco y gestoría de The NOOR Clinic",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "NOOR Hub", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#f6f2ec", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
