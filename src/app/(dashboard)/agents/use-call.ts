"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";

const FAILED = "Something went wrong. Try again.";

// useAction for a server action that takes plain arguments instead of a form: it runs in a transition, keeps the
// refusal to show, and hands a successful result to onSuccess. A redirect or not-found from the action still goes
// through to Next.
export function useCall<A extends unknown[], R extends { error?: string }>(action: (...args: A) => Promise<R>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(args: A, { onSuccess }: { onSuccess?: (result: R) => void } = {}) {
    setError(null);
    startTransition(async () => {
      let result: R | null = null;
      let message: string | null;
      try {
        result = await action(...args);
        message = result.error ?? null;
      } catch (e) {
        unstable_rethrow(e);
        message = FAILED;
      }
      setError(message);
      if (message === null && result !== null) onSuccess?.(result);
    });
  }

  return { error, pending, run, clear: () => setError(null) };
}
