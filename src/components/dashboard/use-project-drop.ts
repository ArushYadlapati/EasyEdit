"use client";

import { useState, type DragEvent } from "react";
import { PROJECT_DRAG_TYPE } from "@/components/dashboard/drag";

// The look of a place a dragged project can go, while one is over it: the accent outline and a weak accent fill.
export const DROP_OVER =
  "data-drop-over:bg-ed-accent-weak data-drop-over:outline-2 data-drop-over:-outline-offset-2 data-drop-over:outline-ed-accent";

export type ProjectDropProps = {
  "data-drop-over": true | undefined;
  onDragOver(event: DragEvent<HTMLElement>): void;
  onDragLeave(event: DragEvent<HTMLElement>): void;
  onDrop(event: DragEvent<HTMLElement>): void;
};

const carriesProject = (event: DragEvent) => [...event.dataTransfer.types].includes(PROJECT_DRAG_TYPE);

// Makes an element take a dragged project, for editors: spread the result on it, and give it DROP_OVER. It shows the
// drop look while a project is over it and hands the project's id to onDrop; every other drag (files, text, links) is
// left to the browser.
export function useProjectDrop(canEdit: boolean, onDrop: (projectId: string) => void): ProjectDropProps {
  const [over, setOver] = useState(false);
  const takes = (event: DragEvent) => canEdit && carriesProject(event);

  return {
    "data-drop-over": over || undefined,
    onDragOver(event) {
      if (!takes(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setOver(true);
    },
    onDragLeave(event) {
      // Moving onto the element's own children is not leaving it.
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setOver(false);
    },
    onDrop(event) {
      if (!takes(event)) return;
      event.preventDefault();
      setOver(false);
      onDrop(event.dataTransfer.getData(PROJECT_DRAG_TYPE));
    },
  };
}
