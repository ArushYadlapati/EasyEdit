// search and fetch answer in the shape OpenAI documents for ChatGPT: the result object as structuredContent, and the
// same object as JSON in the one text item, for clients that read only text. Their text is that JSON when they succeed;
// a refusal or a failure stays plain text. Other tools may add pictures after their text; these two never do.
type Block = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Answer = { content: Block[]; isError?: boolean };

export function withStructuredContent<Input>(handler: (input: Input) => Promise<Answer>) {
  return async (input: Input): Promise<Answer & { structuredContent?: Record<string, unknown> }> => {
    const result = await handler(input);
    const first = result.content[0];
    if (result.isError || first?.type !== "text") return result;
    return { ...result, structuredContent: JSON.parse(first.text) as Record<string, unknown> };
  };
}
