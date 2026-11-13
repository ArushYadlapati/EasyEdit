type DragInit = {
  clientX?: number;
  clientY?: number;
  relatedTarget?: EventTarget | null;
  types?: string[];
  files?: File[];
  data?: Record<string, string>;
};

// A drag event as a browser sends it, which happy-dom cannot make: its DragEvent is a plain Event, with no position,
// no relatedTarget and no dataTransfer. It bubbles and can be cancelled. Its dataTransfer is a plain object whose
// dropEffect the test reads after dispatch. The types default to the data's, plus "Files" when files are given.
export function dragEvent(
  type: "dragstart" | "dragenter" | "dragover" | "dragleave" | "drop" | "dragend",
  init: DragInit = {},
): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0 });
  const data: Record<string, string> = { ...init.data };
  const files = init.files ?? [];
  const types = init.types ?? [...Object.keys(data), ...(files.length > 0 ? ["Files"] : [])];
  const dataTransfer = {
    types,
    files,
    dropEffect: "none",
    effectAllowed: "all",
    getData: (format: string) => data[format] ?? "",
    setData: (format: string, value: string) => void (data[format] = value),
    clearData: () => {
      for (const key of Object.keys(data)) delete data[key];
    },
    setDragImage: () => {},
  };
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  if (init.relatedTarget !== undefined) Object.defineProperty(event, "relatedTarget", { value: init.relatedTarget });
  return event;
}
