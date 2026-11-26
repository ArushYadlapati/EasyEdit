import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { findLesson, firstLesson, momentPath, startFrom } from "@/lib/tutorial/guide";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";
import { LessonView } from "../lesson-view";

export async function generateMetadata({ params }: PageProps<"/learn/[lesson]">): Promise<Metadata> {
  const lesson = findLesson((await params).lesson);
  return { title: lesson ? `${lesson.title} · ${TUTORIAL_WORDS.learn}` : TUTORIAL_WORDS.learn };
}

// One lesson of the guide on the Learn page. The first lesson's own address is /learn, so its name here goes there
// (keeping the moment asked for); a name the guide does not have gets the app's not-found page (LessonView).
export default async function LessonPage({ params, searchParams }: PageProps<"/learn/[lesson]">): Promise<ReactNode> {
  const { lesson: slug } = await params;
  const { t } = await searchParams;
  const first = firstLesson();
  if (first && first.slug === slug) redirect(momentPath(slug, startFrom(t, first)));
  return <LessonView slug={slug} t={t} />;
}
