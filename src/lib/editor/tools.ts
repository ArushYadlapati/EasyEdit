// The tools on the rail beside the preview. One is current at a time; it changes what a click on the preview or the
// timeline does. It is this person's own, never saved or shared, and is Selection whenever the editor opens.
export type Tool = "select" | "razor" | "text" | "guide" | "crop";

// In the rail's order.
export const TOOLS: readonly Tool[] = ["select", "razor", "text", "guide", "crop"];

// Every tool but Selection changes the project, so someone who can't edit keeps Selection.
export function toolNeedsEdit(tool: Tool): boolean {
  return tool !== "select";
}
