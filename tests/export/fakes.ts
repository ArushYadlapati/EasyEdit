// One turn of the event loop: every promise that can settle now has settled.
export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
