"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";

type ActionResult = { error?: string };

type Outcome<R> = { onStart?: () => void; onSuccess?: (result: R) => void; onFailure?: (message: string) => void };

export function useAction<R extends ActionResult = ActionResult>(action: (formData: FormData) => Promise<R>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function submit(formData: FormData, { onStart, onSuccess, onFailure }: Outcome<R> = {}) {
    onStart?.();
    startTransition(async () => {
      let message: string | null;
      let result: R | null = null;
      try {
        result = await action(formData);
        message = result.error ?? null;
      } catch (e) {
        unstable_rethrow(e);
        message = "Something went wrong. Try again.";
      }
      setError(message);
      if (message === null && result !== null) onSuccess?.(result);
      else onFailure?.(message ?? "Something went wrong. Try again.");
    });
  }
  return { error, pending, submit };
}
