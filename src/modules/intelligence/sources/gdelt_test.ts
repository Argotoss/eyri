import { parseGdeltResponseText } from "./gdelt.ts";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("parseGdeltResponseText parses valid article JSON", () => {
  const parsed = parseGdeltResponseText(
    JSON.stringify({ articles: [{ title: "Micron news" }] }),
  );

  assert(parsed?.articles?.[0]?.title === "Micron news", "expected article");
});

Deno.test("parseGdeltResponseText rejects non-JSON rate-limit bodies", () => {
  assert(
    parseGdeltResponseText("Your search was rate limited") === null,
    "expected null for non-JSON",
  );
});
