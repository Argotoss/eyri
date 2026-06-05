import {
  parseGdeltResponseText,
  queuedGdeltRequestForTest,
  resetPersistentGdeltStateForTest,
  resetGdeltRequestStateForTest,
} from "./gdelt.ts";

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

Deno.test("queued GDELT requests are serialized with delay", async () => {
  const previousDelay = Deno.env.get("INTEL_GDELT_DELAY_MS");
  const previousStatePath = Deno.env.get("INTEL_GDELT_STATE_PATH");
  const stateDir = await Deno.makeTempDir();
  Deno.env.set("INTEL_GDELT_STATE_PATH", `${stateDir}/gdelt-state.json`);
  Deno.env.set("INTEL_GDELT_DELAY_MS", "25");
  await resetPersistentGdeltStateForTest();
  try {
    const startedAt: number[] = [];
    await Promise.all([
      queuedGdeltRequestForTest(async () => {
        startedAt.push(Date.now());
      }),
      queuedGdeltRequestForTest(async () => {
        startedAt.push(Date.now());
      }),
      queuedGdeltRequestForTest(async () => {
        startedAt.push(Date.now());
      }),
    ]);

    assert(startedAt.length === 3, "expected all requests to run");
    assert(
      startedAt[1] - startedAt[0] >= 15,
      "expected second request to be delayed",
    );
    assert(
      startedAt[2] - startedAt[1] >= 15,
      "expected third request to be delayed",
    );
  } finally {
    if (previousDelay === undefined) {
      Deno.env.delete("INTEL_GDELT_DELAY_MS");
    } else {
      Deno.env.set("INTEL_GDELT_DELAY_MS", previousDelay);
    }
    if (previousStatePath === undefined) {
      Deno.env.delete("INTEL_GDELT_STATE_PATH");
    } else {
      Deno.env.set("INTEL_GDELT_STATE_PATH", previousStatePath);
    }
    resetGdeltRequestStateForTest();
    await Deno.remove(stateDir, { recursive: true });
  }
});
