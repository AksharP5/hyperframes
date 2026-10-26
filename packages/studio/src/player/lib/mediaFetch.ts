export type MediaReader = "probe" | "thumbnail";

const describe = (
  reader: MediaReader,
  status: number | null,
  code: string | null,
  retries: number,
) =>
  `${reader} range fetch failed: ${status === null ? `network ${code}` : `HTTP ${status}`} after ${retries} retries`;

/** A media range fetch that gave up: which reader, the HTTP status or network code, and the retries. Never the URL. */
export class MediaFetchError extends Error {
  override readonly name = "MediaFetchError";
  retries = 0;

  constructor(
    readonly reader: MediaReader,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(describe(reader, status, code, 0));
  }

  setRetries(retries: number): void {
    this.retries = retries;
    this.message = describe(this.reader, this.status, this.code, retries);
  }
}

const MAX_RETRIES = 2;

const isAbort = (error: unknown) => (error as { name?: unknown } | null)?.name === "AbortError";

function networkCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  if (typeof cause?.code === "string") return cause.code;
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "unknown";
}

const typedFailure = (reader: MediaReader, error: unknown) =>
  isAbort(error) ? error : new MediaFetchError(reader, null, networkCode(error));

/** The body, failing a broken read with a MediaFetchError: mediabunny rethrows a body error as-is. */
function typedBody(
  reader: MediaReader,
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const source = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await source.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(typedFailure(reader, error));
      }
    },
    cancel: (reason) => source.cancel(reason),
  });
}

/**
 * Options for a mediabunny `UrlSource`. Its default retries a same-origin network failure
 * forever and logs a bare `TypeError` each time; these retry twice and fail with a MediaFetchError.
 */
export function mediaUrlSourceOptions(reader: MediaReader) {
  let failures = 0;
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let response: Response;
    try {
      // oxlint-disable-next-line no-restricted-globals -- a media read, on the media's sockets like mediabunny's own
      response = await fetch(input, init);
    } catch (error) {
      throw typedFailure(reader, error);
    }
    if (!response.ok) throw new MediaFetchError(reader, response.status, null);
    if (!response.body) return response;
    const { status, statusText, headers } = response;
    return new Response(typedBody(reader, response.body), { status, statusText, headers });
  };
  // Counted per source: mediabunny passes 1 for every failed mid-stream read.
  const getRetryDelay = (_previousAttempts: number, error: unknown): number | null => {
    const clientError =
      error instanceof MediaFetchError && error.status !== null && error.status < 500;
    if (error instanceof MediaFetchError) error.setRetries(failures);
    if (clientError || failures >= MAX_RETRIES) return null;
    failures++;
    return 0.5 * failures;
  };
  return { fetchFn, getRetryDelay };
}

export function reportMediaFetchFailure(error: unknown): void {
  if (!(error instanceof MediaFetchError)) return;
  console.warn(`[Studio] ${error.message}`);
}
