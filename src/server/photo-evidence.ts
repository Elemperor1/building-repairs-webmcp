import { controlledLiveConfig } from "./controlled-live.js";

const maxPhotoBytes = 5 * 1024 * 1024;
const supportedContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export class RejectedPhotoEvidence extends Error {}

export interface TwilioPhotoSource {
  sourceUrl: string;
  messageSid: string;
  expectedContentType: string;
}

export interface DownloadedPhotoEvidence {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  dataBase64: string;
}

const normalizedContentType = (value: string) => {
  const contentType = value.split(";", 1)[0]!.trim().toLowerCase();
  return contentType === "image/jpg" ? "image/jpeg" : contentType;
};

const validateMediaUrl = (sourceUrl: string, accountSid: string, messageSid: string) => {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new RejectedPhotoEvidence("The MMS media URL is invalid.");
  }
  let parts: string[];
  try {
    parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new RejectedPhotoEvidence("The MMS media URL is invalid.");
  }
  if (
    url.origin !== "https://api.twilio.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length !== 7 ||
    parts[0] !== "2010-04-01" ||
    parts[1] !== "Accounts" ||
    parts[2] !== accountSid ||
    parts[3] !== "Messages" ||
    parts[4] !== messageSid ||
    parts[5] !== "Media" ||
    !/^ME[0-9a-f]{32}$/i.test(parts[6] ?? "")
  ) {
    throw new RejectedPhotoEvidence("The MMS media URL is outside the bound Twilio message.");
  }
};

export const twilioPhotoSources = (
  payload: Record<string, unknown>,
  accountSid: string,
  messageSid: string,
): TwilioPhotoSource[] => {
  const count = Number(payload.NumMedia ?? 0);
  if (!Number.isInteger(count) || count < 0 || count > 10) {
    throw new RejectedPhotoEvidence("The MMS attachment count is invalid.");
  }
  return Array.from({ length: count }, (_, index) => {
    const sourceUrl = payload[`MediaUrl${index}`];
    const expectedContentType = payload[`MediaContentType${index}`];
    if (typeof sourceUrl !== "string" || typeof expectedContentType !== "string") {
      throw new RejectedPhotoEvidence("The MMS attachment metadata is incomplete.");
    }
    validateMediaUrl(sourceUrl, accountSid, messageSid);
    return { sourceUrl, messageSid, expectedContentType };
  });
};

const readLimited = async (response: Response) => {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxPhotoBytes) {
    throw new RejectedPhotoEvidence("The photo is larger than 5 MB.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Twilio returned no media body.");
  const chunks: Buffer[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxPhotoBytes) {
      await reader.cancel();
      throw new RejectedPhotoEvidence("The photo is larger than 5 MB.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
};

const hasValidMagic = (contentType: string, bytes: Buffer) => {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  );
};

export const createTwilioPhotoDownloader = ({
  fetch: fetchMedia = globalThis.fetch,
  env = process.env,
}: {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
} = {}) => {
  const config = controlledLiveConfig(env);
  return async (source: TwilioPhotoSource): Promise<DownloadedPhotoEvidence> => {
    validateMediaUrl(source.sourceUrl, config.accountSid, source.messageSid);
    const expectedContentType = normalizedContentType(source.expectedContentType);
    if (!supportedContentTypes.has(expectedContentType)) {
      throw new RejectedPhotoEvidence("Only JPEG, PNG, or WebP photo evidence is accepted.");
    }
    const response = await fetchMedia(source.sourceUrl, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
      },
    });
    if (!response.ok) throw new Error(`Twilio media download failed (${response.status}).`);
    const contentType = normalizedContentType(response.headers.get("content-type") ?? "");
    if (contentType !== expectedContentType) {
      throw new RejectedPhotoEvidence("The downloaded photo type did not match the MMS metadata.");
    }
    const bytes = await readLimited(response);
    if (!hasValidMagic(contentType, bytes)) {
      throw new RejectedPhotoEvidence("The MMS attachment was not a valid photo.");
    }
    return {
      contentType: contentType as DownloadedPhotoEvidence["contentType"],
      dataBase64: bytes.toString("base64"),
    };
  };
};
