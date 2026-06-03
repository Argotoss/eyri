import { isGenericEventSummary } from "./extract.ts";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("isGenericEventSummary rejects vague model output", () => {
  assert(
    isGenericEventSummary("Potential market-moving event."),
    "expected generic output to be rejected",
  );
  assert(
    isGenericEventSummary("AI catalyst"),
    "expected short output rejection",
  );
});

Deno.test("isGenericEventSummary accepts specific catalyst summaries", () => {
  assert(
    !isGenericEventSummary(
      "Micron filed a Form 4 and shares moved after fresh memory pricing headlines.",
    ),
    "expected specific output to pass",
  );
});
