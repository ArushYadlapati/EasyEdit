"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { makeDashboardActions, type FormState } from "@/lib/projects/dashboard-actions";

const actions = makeDashboardActions({ db: getDb, requireUser, revalidate: (path) => revalidatePath(path, "page"), redirect });

export async function createProjectAction(spaceId: string, prev: FormState, formData: FormData): Promise<FormState> {
  return actions.create(spaceId, prev, formData);
}

export async function renameProjectAction(spaceId: string, formData: FormData): Promise<FormState> {
  return actions.rename(spaceId, formData);
}

export async function deleteProjectAction(spaceId: string, formData: FormData): Promise<FormState> {
  return actions.remove(spaceId, formData);
}

export async function duplicateProjectAction(spaceId: string, formData: FormData): Promise<FormState> {
  return actions.duplicate(spaceId, formData);
}

export async function moveProjectAction(spaceId: string, formData: FormData): Promise<FormState> {
  return actions.move(spaceId, formData);
}

export async function createFolderAction(spaceId: string, formData: FormData): Promise<FormState> {
  return actions.createFolder(spaceId, formData);
}

export async function renameFolderAction(spaceId: string, formData: FormData): Promise<FormState> {
  return actions.renameFolder(spaceId, formData);
}

export async function deleteFolderAction(spaceId: string, formData: FormData): Promise<FormState> {
  return actions.deleteFolder(spaceId, formData);
}
