import { describe, expect, it } from "vitest";
import { DEFAULT_SPEECH, SPEECH_LANGUAGES, isRightToLeft, speechChoice, speechLanguage, speechTag } from "@/lib/captions/speech/languages";
import { SPEECH_MODEL } from "@/lib/captions/speech/protocol";

describe("the languages Auto captions hears", () => {
  it("start with English, each once, by the model's own lowercase name", () => {
    expect(SPEECH_LANGUAGES[0]).toEqual({ id: "english", label: "English" });
    expect(new Set(SPEECH_LANGUAGES.map((l) => l.id)).size).toBe(SPEECH_LANGUAGES.length);
    expect(SPEECH_LANGUAGES.every((l) => /^[a-z]+$/.test(l.id) && l.label.length > 0)).toBe(true);
    expect(SPEECH_LANGUAGES.length).toBeGreaterThan(40);
    expect(speechLanguage("hindi")?.label).toBe("Hindi");
    expect(speechLanguage("klingon")).toBeUndefined();
  });
  it("mark the ones written without spaces as captioned in English only", () => {
    expect(SPEECH_LANGUAGES.filter((l) => l.translateOnly).map((l) => l.id)).toEqual(["chinese", "japanese", "thai", "khmer", "lao", "myanmar"]);
    expect(speechLanguage("korean")?.translateOnly).toBeUndefined(); // Korean puts spaces between words
  });
});

describe("a choice of language", () => {
  it("is English as spoken unless it says otherwise, and from anything that is not a choice", () => {
    expect(DEFAULT_SPEECH).toEqual({ language: "english", translate: false });
    for (const raw of [null, undefined, "spanish", 7, {}, { language: 5 }, { language: "klingon", translate: true }]) expect(speechChoice(raw)).toEqual(DEFAULT_SPEECH);
  });
  it("never translates English, always translates a language written without spaces, and otherwise does as asked", () => {
    expect(speechChoice({ language: "english", translate: true })).toEqual({ language: "english", translate: false });
    expect(speechChoice({ language: "japanese", translate: false })).toEqual({ language: "japanese", translate: true });
    expect(speechChoice({ language: "french", translate: true })).toEqual({ language: "french", translate: true });
    expect(speechChoice({ language: "french" })).toEqual({ language: "french", translate: false });
    expect(speechChoice({ language: "french", translate: "yes" })).toEqual({ language: "french", translate: false });
  });
});

describe("what saved words are marked with", () => {
  it("is the bare model for English as spoken, which is what words saved before there was a choice carry", () => {
    expect(speechTag(DEFAULT_SPEECH)).toBe(SPEECH_MODEL);
    expect(speechTag({ language: "english", translate: true })).toBe(SPEECH_MODEL);
  });
  it("names the language, and that it was written in English, and fits the database's hundred characters", () => {
    expect(speechTag({ language: "spanish", translate: false })).toBe(`${SPEECH_MODEL}#spanish`);
    expect(speechTag({ language: "spanish", translate: true })).toBe(`${SPEECH_MODEL}#spanish>english`);
    expect(speechTag({ language: "thai", translate: false })).toBe(`${SPEECH_MODEL}#thai>english`);
    for (const l of SPEECH_LANGUAGES) expect(speechTag({ language: l.id, translate: true }).length).toBeLessThanOrEqual(100);
  });
});

describe("which lines run right to left", () => {
  it("are the ones with Arabic or Hebrew letters in them", () => {
    expect(["مرحبا بالعالم", "שלום עולם", "سلام دنیا", "hello مرحبا"].map(isRightToLeft)).toEqual([true, true, true, true]);
    expect(["hello world", "नमस्ते दुनिया", "Привет", "안녕하세요", "¿Qué tal?", ""].map(isRightToLeft)).toEqual([false, false, false, false, false, false]);
  });
});
