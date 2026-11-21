"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createSoundBus, type SoundBus } from "@/lib/audio/sound-bus";

const SoundContext = createContext<SoundBus | null>(null);

// The preview's mix, for the preview that plays into it and the meter that reads it. Null outside a provider, as in
// tests: the preview's elements then keep to their own volume and the meter stays at rest.
export function useSoundBus(): SoundBus | null {
  return useContext(SoundContext);
}

// Holds the editor's one mix. A browser lets a page make sound only after the person has pressed something on it, so
// the first press or key anywhere in the window sets the mix up, in that press, before anything can play; later ones
// wake it if the browser put it to sleep. bus: a mix made elsewhere, as tests do.
export function SoundProvider({ bus: given, children }: { bus?: SoundBus; children: ReactNode }) {
  const [bus] = useState(() => given ?? createSoundBus());
  useEffect(() => {
    const unlock = () => bus.unlock();
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      bus.close();
    };
  }, [bus]);
  return <SoundContext value={bus}>{children}</SoundContext>;
}
