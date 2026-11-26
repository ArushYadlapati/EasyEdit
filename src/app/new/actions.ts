"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import type { FormState } from "@/lib/projects/dashboard-actions";
import { startProject } from "@/lib/projects/start-project";

// Makes the project the home page's form asked for and opens it in the editor.
export async function startProjectAction(formData: FormData): Promise<FormState> {
  return startProject({ db: getDb, requireUser, revalidate: (path) => revalidatePath(path, "page"), redirect }, formData);
}
