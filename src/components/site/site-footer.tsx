import Link from "next/link";
import { LogoMark } from "@/components/ui/logo";
import "./site.css";

// The public pages the footer links to, by name: the one being shown is marked as the current page.
export type SitePageName = "login" | "privacy" | "terms";

const PAGES: { name: SitePageName; href: string; label: string }[] = [
  { name: "login", href: "/login", label: "Sign in" },
  { name: "privacy", href: "/privacy", label: "Privacy" },
  { name: "terms", href: "/terms", label: "Terms" },
];

// The end of every public page: the name, the pages a visitor may still want, and the address for questions (the same
// one the terms give).
export function SiteFooter({ current }: { current?: SitePageName }) {
  return (
    <footer className="h-footer">
      <span className="h-brand">
        <LogoMark size={20} />
        <span>EasyEdit</span>
      </span>
      <nav aria-label="Footer">
        {PAGES.map((page) => (
          <Link key={page.name} href={page.href} aria-current={page.name === current ? "page" : undefined}>
            {page.label}
          </Link>
        ))}
        <a href="mailto:help@arush.dev">help@arush.dev</a>
      </nav>
      <span>© 2026 EasyEdit</span>
    </footer>
  );
}
