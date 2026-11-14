// search and fetch answer in the shape OpenAI documents for ChatGPT: the result object as structuredContent, and the
// same object as JSON in the one text item, for clients that read only text. Their text is that JSON when they succeed;
// a refusal or a failure stays plain text.
type Answer = { content: { type: "text"; text: string }[]; isError?: boolean };

export function withStructuredContent<Input>(handler: (input: Input) => Promise<Answer>) {
  return async (input: Input): Promise<Answer & { structuredContent?: Record<string, unknown> }> => {
    const result = await handler(input);
    if (result.isError) return result;
    return { ...result, structuredContent: JSON.parse(result.content[0].text) as Record<string, unknown> };
  };
}
