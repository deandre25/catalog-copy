import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Catalog Copy",
  description: "Turn raw product specs into SEO-ready catalog copy.",
};

const navigation = [
  { href: "/", label: "New" },
  { href: "/products", label: "Catalog" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 min-h-full flex flex-col">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto flex max-w-3xl items-center gap-6 px-6 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              Catalog<span className="text-zinc-400">Copy</span>
            </Link>
            <nav className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
