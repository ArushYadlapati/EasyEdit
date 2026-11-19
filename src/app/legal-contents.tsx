import { LEGAL_H2 } from "@/app/legal";

// The terms and privacy pages' sections: each heading gets an address of its own (#who-can-use-easyedit), and the list
// beside the text links to them, so a long page can be read in any order and a section can be linked to.

export const legalId = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function LegalH2({ children }: { children: string }) {
  return (
    <h2 id={legalId(children)} className={LEGAL_H2}>
      {children}
    </h2>
  );
}

// Beside the text on a wide window, held in view while the page scrolls; left out on a narrow one, where the text is
// the whole page.
export function LegalContents({ sections }: { sections: string[] }) {
  return (
    <nav aria-label="On this page" className="h-legalToc">
      <p className="h-legalTocName">On this page</p>
      <ol>
        {sections.map((title) => (
          <li key={title}>
            <a href={`#${legalId(title)}`}>{title}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
