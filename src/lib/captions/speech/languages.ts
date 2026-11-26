import { SPEECH_MODEL } from "./protocol";

// The languages Auto captions can hear, and how a choice of one is kept. The speech model (Whisper) hears about a
// hundred; these are the widely spoken ones, by the names the model takes. It can also write what it hears in
// English, whatever was spoken.

// translateOnly: written without spaces between words (Chinese, Japanese, Thai…). Caption lines are built, wrapped,
// lit and retyped word by word with spaces between, so these are captioned in English only.
export type SpeechLanguage = { id: string; label: string; translateOnly?: true };

export const SPEECH_LANGUAGES: readonly SpeechLanguage[] = [
  { id: "english", label: "English" },
  { id: "spanish", label: "Spanish" },
  { id: "french", label: "French" },
  { id: "german", label: "German" },
  { id: "italian", label: "Italian" },
  { id: "portuguese", label: "Portuguese" },
  { id: "dutch", label: "Dutch" },
  { id: "catalan", label: "Catalan" },
  { id: "swedish", label: "Swedish" },
  { id: "norwegian", label: "Norwegian" },
  { id: "danish", label: "Danish" },
  { id: "finnish", label: "Finnish" },
  { id: "polish", label: "Polish" },
  { id: "czech", label: "Czech" },
  { id: "hungarian", label: "Hungarian" },
  { id: "romanian", label: "Romanian" },
  { id: "greek", label: "Greek" },
  { id: "russian", label: "Russian" },
  { id: "ukrainian", label: "Ukrainian" },
  { id: "turkish", label: "Turkish" },
  { id: "arabic", label: "Arabic" },
  { id: "hebrew", label: "Hebrew" },
  { id: "persian", label: "Persian" },
  { id: "urdu", label: "Urdu" },
  { id: "hindi", label: "Hindi" },
  { id: "bengali", label: "Bengali" },
  { id: "punjabi", label: "Punjabi" },
  { id: "gujarati", label: "Gujarati" },
  { id: "marathi", label: "Marathi" },
  { id: "tamil", label: "Tamil" },
  { id: "telugu", label: "Telugu" },
  { id: "kannada", label: "Kannada" },
  { id: "malayalam", label: "Malayalam" },
  { id: "nepali", label: "Nepali" },
  { id: "indonesian", label: "Indonesian" },
  { id: "malay", label: "Malay" },
  { id: "tagalog", label: "Tagalog" },
  { id: "vietnamese", label: "Vietnamese" },
  { id: "swahili", label: "Swahili" },
  { id: "korean", label: "Korean" },
  { id: "chinese", label: "Chinese", translateOnly: true },
  { id: "japanese", label: "Japanese", translateOnly: true },
  { id: "thai", label: "Thai", translateOnly: true },
  { id: "khmer", label: "Khmer", translateOnly: true },
  { id: "lao", label: "Lao", translateOnly: true },
  { id: "myanmar", label: "Burmese", translateOnly: true },
];

// What is spoken, and whether the captions are that or English.
export type SpeechChoice = { language: string; translate: boolean };

export const DEFAULT_SPEECH: SpeechChoice = { language: "english", translate: false };

export const speechLanguage = (id: string): SpeechLanguage | undefined => SPEECH_LANGUAGES.find((l) => l.id === id);

// A choice made whole: a language that is not on the list is English; English is never translated; a language
// written without spaces always is. Takes anything, so a remembered choice can be read back safely.
export function speechChoice(raw: unknown): SpeechChoice {
  const given = (typeof raw === "object" && raw !== null ? raw : {}) as { language?: unknown; translate?: unknown };
  const language = typeof given.language === "string" ? speechLanguage(given.language) : undefined;
  if (!language || language.id === "english") return { ...DEFAULT_SPEECH };
  return { language: language.id, translate: language.translateOnly === true || given.translate === true };
}

// What a file's saved words are marked with, so words heard as one language are never handed out as another's. English
// as spoken keeps the bare model name, which is what words saved before there was a choice carry.
export function speechTag(choice: SpeechChoice): string {
  const { language, translate } = speechChoice(choice);
  if (language === "english") return SPEECH_MODEL;
  return `${SPEECH_MODEL}#${language}${translate ? ">english" : ""}`;
}

// Arabic, Hebrew and the scripts written like them: a line of these runs right to left.
const RIGHT_TO_LEFT = /[֐-ࣿיִ-﷿ﹰ-﻿]/u;
export const isRightToLeft = (text: string): boolean => RIGHT_TO_LEFT.test(text);
