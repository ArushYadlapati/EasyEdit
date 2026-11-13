"use client";

import { useEffect } from "react";

// Tells the server once per page load that you opened this project, for your Recent list on the dashboard. The
// page's render writes nothing; this post does, from the browser.
export function RecordOpen({ projectId }: { projectId: string }): null {
  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(projectId)}/opened`, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {
      // Offline or cut off: the project is simply missing from Recent until the next open.
    });
  }, [projectId]);

  return null;
}
