// The tools on the rail beside the preview. One is current at a time; it changes what a click on the preview or the
// timeline does. It is this person's own, never saved or shared, and is Selection whenever the editor opens.
// Shape draws the shape picked from its list (a rectangle, an ellipse, a star, ...). Line is one button for two things:
// it draws a line or an arrow, whichever it is switched to.
export type Tool = "select" | "razor" | "text" | "shape" | "line" | "guide" | "crop";

// In the rail's order.
export const TOOLS: readonly Tool[] = ["select", "razor", "text", "shape", "line", "guide", "crop"];

// The tools that draw on the preview with a drag.
export function drawsShape(tool: Tool): tool is "shape" | "line" {
  return tool === "shape" || tool === "line";
}

// Every tool but Selection changes the project, so someone who can't edit keeps Selection.
export function toolNeedsEdit(tool: Tool): boolean {
  return tool !== "select";
}
