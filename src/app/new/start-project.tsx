"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAction } from "@/app/(app)/action-ui";
import { PLAIN_ERROR } from "@/components/ui/cx";
import { clearDraft, draftFormData, readDraft, writeDraft } from "@/lib/home/first-project";
import type { FormState } from "@/lib/projects/dashboard-actions";

// Reads the project the home page's form asked for in this tab and has the server make it; the server then opens it in
// the editor. Nothing asked for: on to the person's projects. Asked for once only, so a reload or Back makes no second
// one. A refusal (a daily limit, say) is said here in the site's error words, with the way on.
export function StartProject({ action }: { action: (formData: FormData) => Promise<FormState> }) {
  const router = useRouter();
  const started = useRef(false);
  // What was asked for in this tab: nothing on the server, where the words shown are the same either way.
  const [asked] = useState(() => {
    const draft = readDraft();
    return draft?.asked ? { draft, form: draftFormData(draft) } : null;
  });
  const { error, pending, submit } = useAction(action);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!asked) {
      router.replace("/dashboard");
      return;
    }
    writeDraft({ ...asked.draft, asked: false });
    submit(asked.form, { onSuccess: clearDraft });
  }, [asked, router, submit]);

  if (error === null || pending) {
    return (
      <>
        <h1 className="h-plainTitle">Making your project</h1>
        <p className="h-plainLead" aria-live="polite">
          It opens in the editor in a moment.
        </p>
      </>
    );
  }
  return (
    <>
      <h1 className="h-plainTitle">Your project wasn&apos;t made</h1>
      <p role="alert" className={PLAIN_ERROR}>
        {error}
      </p>
      <div className="flex flex-col gap-3">
        {asked && (
          <button type="button" className="h-btn w-full" onClick={() => submit(asked.form, { onSuccess: clearDraft })}>
            Try again
          </button>
        )}
        <Link href="/dashboard" className="h-btn h-btnGhost w-full">
          Go to your projects
        </Link>
      </div>
    </>
  );
}
