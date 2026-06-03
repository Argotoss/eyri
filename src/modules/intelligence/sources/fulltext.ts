import type {
  DeepResearchPreset,
  IntelRawItemInput,
  SourceCollectionResult,
  SourceDiagnostic,
} from "../types.ts";

function envNumber(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function presetLimit(
  preset: DeepResearchPreset,
  values: { fast: number; deep: number; exhaustive: number },
) {
  return values[preset];
}

function parseDate(value: string | undefined | null) {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function extractMetaContent(html: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regexes = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
        "i",
      ),
    ];
    for (const regex of regexes) {
      const match = html.match(regex);
      if (match?.[1]) {
        return match[1];
      }
    }
  }
  return undefined;
}

function extractJsonLdDate(html: string) {
  const scripts =
    html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi,
    ) ?? [];
  for (const script of scripts) {
    const content = script
      .replace(/<script[^>]*>/i, "")
      .replace(/<\/script>/i, "")
      .trim();
    try {
      const parsed = JSON.parse(content);
      const graph =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)["@graph"]
          : undefined;
      const nodes = Array.isArray(parsed)
        ? parsed
        : [parsed, graph].flat().filter(Boolean);
      for (const node of nodes) {
        const date = parseDate(node?.datePublished ?? node?.dateCreated);
        if (date) {
          return date;
        }
      }
    } catch {
      // Ignore malformed publisher JSON-LD.
    }
  }
  return undefined;
}

function extractPublishedAt(html: string) {
  return (
    extractJsonLdDate(html) ??
    parseDate(
      extractMetaContent(html, [
        "article:published_time",
        "datePublished",
        "pubdate",
        "publishdate",
        "sailthru.date",
        "parsely-pub-date",
        "date",
      ]),
    ) ??
    parseDate(html.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i)?.[1])
  );
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
  const timeoutMs = envNumber("INTEL_FULLTEXT_TIMEOUT_MS", 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Eyri market intelligence" },
      signal: controller.signal,
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
    const html = await response.text();
    return {
      text: contentSnippet(html),
      publishedAt: extractPublishedAt(html),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const results: R[] = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, values.length)) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function enrichItemsWithFullText(
  items: IntelRawItemInput[],
  preset: DeepResearchPreset = "deep",
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const limit = envNumber(
    "INTEL_FULLTEXT_LIMIT",
    presetLimit(preset, { fast: 10, deep: 40, exhaustive: 100 }),
  );
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
  const concurrency = envNumber("INTEL_FULLTEXT_CONCURRENCY", 5);
  const candidates = enriched
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.url && item.source !== "reddit")
    .slice(0, limit);
  const results = await mapConcurrent(
    candidates,
    concurrency,
    async (candidate) => ({
      ...candidate,
      result: await fetchUrlText(candidate.item.url ?? ""),
    }),
  );
  let successCount = 0;
  let publishDateCount = 0;
  for (const { item, index, result } of results) {
    if (!result?.text || result.text.length < 300) {
      continue;
    }
    successCount += 1;
    if (result.publishedAt) {
      publishDateCount += 1;
    }
    enriched[index] = {
      ...item,
      publishedAt: result.publishedAt ?? item.publishedAt,
      discoveredAt: item.discoveredAt ?? item.publishedAt,
      body: [item.body, "Fetched article text:", result.text]
        .filter(Boolean)
        .join("\n\n"),
      rawPayload: {
        itemPayload: item.rawPayload,
        fullTextFetched: true,
        fullTextLength: result.text.length,
        extractedPublishedAt: result.publishedAt?.toISOString(),
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
          concurrency,
          publishDateCount,
        },
      }),
    ],
  };
}
