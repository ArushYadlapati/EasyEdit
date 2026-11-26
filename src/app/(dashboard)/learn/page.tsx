import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { firstLesson } from "@/lib/tutorial/guide";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";
import { LessonView } from "./lesson-view";

export const metadata: Metadata = { title: TUTORIAL_WORDS.learn };

// Learn: the guide, open on its first lesson. The header's Learn link and the account menu's Learn lead here.
export default async function LearnPage({ searchParams }: PageProps<"/learn">): Promise<ReactNode> {
  const first = firstLesson();
  if (!first) notFound();
  return <LessonView slug={first.slug} t={(await searchParams).t} />;
}
