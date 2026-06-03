import type {
  IntelRawItemInput,
  SourceCollectionResult,
  SourceDiagnostic,
} from "../types.ts";

function envNumber(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentSnippet(text: string) {
  const cleaned = stripHtml(text);
  return cleaned.length > 8000 ? cleaned.slice(0, 8000) : cleaned;
}

function makeDiagnostic(args: {
  label: string;
  startedAt: Date;
  status: SourceDiagnostic["status"];
  itemCount: number;
  message?: string;
  metadata?: Record<string, unknown>;
}): SourceDiagnostic {
  return {
    source: "fulltext",
    label: args.label,
    status: args.status,
    itemCount: args.itemCount,
    startedAt: args.startedAt,
    completedAt: new Date(),
    message: args.message,
    metadata: args.metadata,
  };
}

async function fetchUrlText(url: string) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Eyri market intelligence" },
    });
    if (!response.ok) {
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("text/plain") &&
      !contentType.includes("application/xhtml")
    ) {
      return null;
    }
    return contentSnippet(await response.text());
  } catch {
    return null;
  }
}

export async function enrichItemsWithFullText(
  items: IntelRawItemInput[],
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const limit = envNumber("INTEL_FULLTEXT_LIMIT", 40);
  if (limit === 0) {
    return {
      items,
      diagnostics: [
        makeDiagnostic({
          label: "url-fulltext",
          startedAt,
          status: "ok",
          itemCount: 0,
          message: "Full-text enrichment disabled",
        }),
      ],
    };
  }

  const enriched = [...items];
  const candidates = enriched
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.url && item.source !== "reddit")
    .slice(0, limit);
  let successCount = 0;
  for (const { item, index } of candidates) {
    const text = await fetchUrlText(item.url ?? "");
    if (!text || text.length < 300) {
      continue;
    }
    successCount += 1;
    enriched[index] = {
      ...item,
      body: [item.body, "Fetched article text:", text]
        .filter(Boolean)
        .join("\n\n"),
      rawPayload: {
        itemPayload: item.rawPayload,
        fullTextFetched: true,
        fullTextLength: text.length,
      },
    };
  }

  return {
    items: enriched,
    diagnostics: [
      makeDiagnostic({
        label: "url-fulltext",
        startedAt,
        status: "ok",
        itemCount: successCount,
        metadata: {
          candidateCount: candidates.length,
          limit,
        },
      }),
    ],
  };
}
