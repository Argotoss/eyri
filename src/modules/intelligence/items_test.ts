import { dedupeRawItemInputs } from "./items.ts";
import type { IntelRawItemInput } from "./types.ts";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("dedupeRawItemInputs collapses canonical URL duplicates", () => {
  const now = new Date();
  const items: IntelRawItemInput[] = [
    {
      source: "google_news",
      sourceType: "news",
      sourceId: "a",
      title: "Micron shares rally",
      url: "https://example.com/story?utm_source=x#section",
      publishedAt: now,
    },
    {
      source: "gdelt",
      sourceType: "news",
      sourceId: "b",
      title: "Micron shares rally",
      url: "https://example.com/story",
      publishedAt: now,
    },
  ];

  const result = dedupeRawItemInputs(items);

  assert(result.items.length === 1, "expected one deduped item");
  assert(result.duplicateCount === 1, "expected one duplicate");
});
