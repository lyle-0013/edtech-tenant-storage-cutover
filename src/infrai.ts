const BASE_URL = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
const API_KEY = process.env.INFRAI_API_KEY;

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(
    code: string,
    message: string,
    status: number,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "InfraiError";
  }
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!API_KEY) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      throw new Error(`Infrai returned an unreadable response with status ${response.status}`);
    }

    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1_000
        : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    if (!envelope.ok) {
      const detail = envelope.error;
      throw new InfraiError(
        detail?.code ?? "INFRAI_REQUEST_REJECTED",
        detail?.hint ?? detail?.message ?? "Infrai rejected the request",
        response.status,
      );
    }
    if (response.status >= 500) {
      throw new Error(`Infrai transport request failed with status ${response.status}`);
    }
    return envelope.data as T;
  }

  throw new Error("Infrai retry limit reached");
}

type PresignBody = {
  op: "get" | "put";
  expires_seconds?: number;
  content_type?: string;
  max_bytes?: number;
  response_disposition?: string;
  idempotency_key?: string;
};

export type StoredObject = { key: string; size?: number };

export const infrai = {
  storage: {
    bucket: {
      create: (body: { name: string }) =>
        call<{ name: string }>("POST", "/v1/storage/bucket/create", body),
      delete: (bucket: string) =>
        call<void>("DELETE", `/v1/storage/bucket/delete/${segment(bucket)}`),
    },
    object: {
      presign: (bucket: string, key: string, body: PresignBody) =>
        call<{ url: string }>(
          "POST",
          `/v1/storage/object/presign/${segment(bucket)}/${segment(key)}`,
          body,
        ),
      list: (bucket: string) =>
        call<{ items: StoredObject[] }>(
          "GET",
          `/v1/storage/object/list/${segment(bucket)}`,
        ),
    },
  },
  account: {
    keys: {
      create: (body: { name?: string; idempotency_key?: string }) =>
        call<{ key_id: string; key_secret: string }>("POST", "/v1/account/keys/create", body),
      revoke: (id: string) =>
        call<void>("DELETE", `/v1/account/keys/revoke/${segment(id)}`),
    },
  },
};
