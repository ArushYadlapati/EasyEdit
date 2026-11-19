import Link from "next/link";
import { LogoMark } from "@/components/ui/logo";
import { openSignUp } from "@/lib/signup";
import type { SitePageName } from "./site-footer";
import "./site.css";

// The links to the home page's own sections. From another page they open the home page at that section.
const SECTIONS = [
  { href: "/#ai", label: "AI agents" },
  { href: "/#free", label: "Free" },
  { href: "/#teams", label: "Teams" },
];

// The bar at the top of every public page: the name (back to the home page), the home page's sections, Sign in, and
// Start free while anyone may make an account. With sign-up closed, Sign in is the only way in. Both lead to the
// sign-in page, so on that page the bar leaves them out.
// Everyone sees the same bar; for someone already signed in, the sign-in page goes straight on to their projects.
export function SiteHeader({ current }: { current?: SitePageName }) {
  return (
    <header className="h-bar">
      <Link href="/" className="h-brand" aria-label="EasyEdit home">
        <LogoMark size={26} />
        <span>EasyEdit</span>
      </Link>
      <nav aria-label="Main" className="h-barLinks">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="h-barLink">
            {s.label}
          </Link>
        ))}
      </nav>
      {current !== "login" && (
        <div className="h-barActions">
          <Link href="/login" className="h-barLink">
            Sign in
          </Link>
          {openSignUp() && (
            <Link href="/login" className="h-btn h-btnSmall">
              Start free
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
