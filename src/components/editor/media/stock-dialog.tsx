"use client";

import { Check, Plus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { TextInput } from "@/components/ui/text-input";
import { searchStock, stockFile } from "@/lib/stock/client";
import { STOCK_MESSAGES, type StockItem, type StockKind } from "@/lib/stock/types";

const KINDS: { value: StockKind; label: string }[] = [
  { value: "video", label: "Videos" },
  { value: "image", label: "Photos" },
];
const length = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

type Found = { items: StockItem[]; more: boolean; page: number };
type Getting = "getting" | "added" | "failed";
export type StockDeps = { search: typeof searchStock; file: typeof stockFile };
const REAL: StockDeps = { search: searchStock, file: stockFile };

// The stock library: free videos and photos from Pexels. A search shows a grid; Add fetches the file and hands it
// to onAdd (the upload queue), so it lands in the space's library like any upload. The dialog stays open, so several
// can be added. Opened, it shows what is popular until something is searched for.
export function StockDialog({ open, onClose, onAdd, deps = REAL }: { open: boolean; onClose(): void; onAdd(file: File): void; deps?: StockDeps }) {
  const [kind, setKind] = useState<StockKind>("video");
  const [words, setWords] = useState("");
  const [asked, setAsked] = useState(""); // the words of the search on screen
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [getting, setGetting] = useState<Record<string, Getting>>({});
  const run = useRef<AbortController | null>(null);

  // A search's answer onto the screen. page 1 replaces the grid; a later page adds to it.
  function show(answer: Awaited<ReturnType<StockDeps["search"]>>, page: number) {
    setBusy(false);
    if (!answer.ok) return setProblem(answer.message);
    if (!answer.result.on) return setProblem(STOCK_MESSAGES.failed);
    const { items, more } = answer.result;
    setProblem(null);
    setFound((before) => ({ items: page === 1 || !before ? items : [...before.items, ...items.filter((item) => !before.items.some((had) => had.id === item.id))], more, page }));
  }
  // One search at a time: a new one drops the one before it.
  function ask(nextKind: StockKind, query: string, page: number): Promise<void> {
    run.current?.abort();
    const mine = (run.current = new AbortController());
    return deps.search(nextKind, query, page, mine.signal).then((answer) => {
      if (!mine.signal.aborted) show(answer, page);
    });
  }
  function search(nextKind: StockKind, query: string, page: number) {
    setBusy(true);
    setProblem(null);
    void ask(nextKind, query, page);
  }

  // Opening shows what is popular (or the last search again). Nothing is set here before the answer comes.
  useEffect(() => {
    if (!open) return;
    void ask(kind, asked, 1);
    return () => run.current?.abort();
    // Only opening asks: a change of kind and a sent search ask from their own handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setAsked(words.trim());
    search(kind, words.trim(), 1);
  }

  async function add(item: StockItem) {
    const key = `${item.kind}:${item.id}`;
    setGetting((all) => ({ ...all, [key]: "getting" }));
    const file = await deps.file(item);
    setGetting((all) => ({ ...all, [key]: file ? "added" : "failed" }));
    if (file) onAdd(file);
  }

  return (
    <Dialog
      title="Stock library"
      open={open}
      onClose={onClose}
      size="lg"
      bar={
        <form className="flex flex-wrap items-center gap-2" role="search" onSubmit={onSubmit}>
          <TextInput data-autofocus aria-label="Search stock videos and photos" className="min-w-0 flex-1" placeholder="robot arm, city at night, ocean…" maxLength={100} value={words} onChange={(event) => setWords(event.target.value)} />
          <Button type="submit" variant="primary" disabled={busy}>
            Search
          </Button>
          <Segmented
            label="Kind"
            value={kind}
            options={KINDS}
            onChange={(value) => {
              setKind(value);
              setFound(null);
              search(value, asked, 1);
            }}
          />
        </form>
      }
      footer={
        <p className="mr-auto text-[13px] leading-5 text-ed-muted">
          Free to use, from{" "}
          <a className="underline" href="https://www.pexels.com" target="_blank" rel="noreferrer noopener">
            Pexels
          </a>
          . A file you add goes into this space&apos;s library.
        </p>
      }
    >
      <div className="flex flex-col gap-3">
        <p role="status" className="text-ed-muted">
          {problem ?? (!found ? "Searching…" : found && found.items.length === 0 ? STOCK_MESSAGES.none : asked ? `Results for “${asked}”` : "Popular now")}
        </p>
        {found && found.items.length > 0 && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {found.items.map((item) => {
              const state = getting[`${item.kind}:${item.id}`];
              const what = item.kind === "video" ? "video" : "photo";
              return (
                <li key={`${item.kind}:${item.id}`} className="flex min-w-0 flex-col gap-1">
                  <div className="relative aspect-video overflow-hidden rounded-md bg-ed-bg">
                    {/* Pexels is told nothing about the page that shows its picture. */}
                    {/* eslint-disable-next-line @next/next/no-img-element -- a small picture on Pexels' own servers; next/image would fetch it through ours. */}
                    <img src={item.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} className="size-full object-cover" />
                    {item.seconds !== null && <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-xs text-white tabular-nums">{length(item.seconds)}</span>}
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-ed-muted">
                      {item.byUrl ? (
                        <a className="hover:underline" href={item.byUrl} target="_blank" rel="noreferrer noopener">
                          {item.by}
                        </a>
                      ) : (
                        item.by
                      )}
                    </span>
                    <Button aria-label={`Add the ${what} by ${item.by} to the library`} disabled={state === "getting" || state === "added"} onClick={() => void add(item)}>
                      {state === "added" ? <Check /> : <Plus />}
                      {state === "getting" ? "Getting…" : state === "added" ? "Added" : state === "failed" ? "Try again" : "Add"}
                    </Button>
                  </div>
                  {state === "failed" && <p role="alert" className="text-xs text-ed-danger">{STOCK_MESSAGES.fileFailed}</p>}
                </li>
              );
            })}
          </ul>
        )}
        {found?.more && (
          <Button className="self-center" disabled={busy} onClick={() => search(kind, asked, found.page + 1)}>
            {busy ? "Loading…" : "Show more"}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
