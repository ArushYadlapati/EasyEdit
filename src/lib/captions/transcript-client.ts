import type { CaptionWord } from "@/lib/timeline";

const urlOf = (assetId: string) => `/api/media/${encodeURIComponent(assetId)}/transcript`;

// The words saved on the server for a file. Null when there are none, or when the request fails: the caller then
// transcribes the file itself.
export async function fetchSavedTranscript(assetId: string): Promise<CaptionWord[] | null> {
  try {
    const response = await fetch(urlOf(assetId), { cache: "no-store" });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const transcript = (body as { transcript?: { words?: unknown } | null } | null)?.transcript;
    return transcript && Array.isArray(transcript.words) ? (transcript.words as CaptionWord[]) : null;
  } catch {
    return null;
  }
}

// Saves a file's words so the next project need not transcribe it again. False on any failure; never throws.
export async function saveTranscriptToServer(assetId: string, words: CaptionWord[], model: string): Promise<boolean> {
  try {
    const response = await fetch(urlOf(assetId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ words, model }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
