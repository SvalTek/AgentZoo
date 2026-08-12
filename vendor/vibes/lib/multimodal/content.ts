/**
 * Multi-modal user message helpers.
 *
 * Provides strongly-typed content part types and factory functions for
 * constructing `UserModelMessage` values (AI SDK `CoreUserMessage`) that
 * contain images, audio, files, or mixed text+binary content.
 *
 * @example
 * ```ts
 * import { imageMessage, audioMessage, fileMessage } from "./content.ts";
 *
 * const msg = imageMessage(myImageBytes, "Describe this image");
 * const result = await agent.run([msg]);
 * ```
 */

import type { UserModelMessage } from "npm:ai@^6";

// ---------------------------------------------------------------------------
// Content part types
// ---------------------------------------------------------------------------

/** A plain-text content part within a user message. */
export type TextPart = {
  type: "text";
  text: string;
};

/**
 * An image content part within a user message.
 * `image` may be a base64 string, raw bytes, or a URL.
 * `mediaType` is an optional IANA MIME type (e.g. "image/png").
 */
export type ImagePart = {
  type: "image";
  image: string | Uint8Array | URL;
  mediaType?: string;
};

/**
 * An audio content part within a user message.
 * Because the AI SDK `UserContent` union does not include a dedicated audio
 * type, audio is carried as a `FilePart` (type "file") with an audio MIME
 * type. This alias exists to give callers a familiar surface.
 *
 * The `audio` field maps to `FilePart.data`; `mimeType` maps to
 * `FilePart.mediaType`.
 */
export type AudioPart = {
  type: "file";
  data: string | Uint8Array;
  mediaType: string;
};

/**
 * A generic file content part within a user message.
 * Maps directly to the AI SDK `FilePart`.
 */
export type FilePart = {
  type: "file";
  data: string | Uint8Array;
  mediaType: string;
};

/** Union of all supported content parts in a user message. */
export type UserMessagePart = TextPart | ImagePart | AudioPart | FilePart;

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Build a `UserModelMessage` (AI SDK `CoreUserMessage`) that contains an
 * image, with an optional accompanying text prompt.
 *
 * @param image - The image data as a base64 string, raw `Uint8Array`, or URL.
 * @param text  - Optional text prompt accompanying the image.
 * @param mediaType - Optional IANA MIME type (e.g. "image/png", "image/jpeg").
 *
 * @example
 * ```ts
 * const msg = imageMessage(myPngBytes, "What is in this photo?", "image/png");
 * ```
 */
export function imageMessage(
  image: string | Uint8Array | URL,
  text?: string,
  mediaType?: string,
): UserModelMessage {
  const imagePart: ImagePart = { type: "image", image, mediaType };
  const parts: Array<TextPart | ImagePart> = text !== undefined
    ? [{ type: "text", text }, imagePart]
    : [imagePart];
  return { role: "user", content: parts };
}

/**
 * Build a `UserModelMessage` (AI SDK `CoreUserMessage`) that contains an
 * audio file, with an optional accompanying text prompt.
 *
 * Audio content is encoded as a `FilePart` (type "file") because the AI SDK
 * `UserContent` union does not include a separate audio part at the top level.
 * Providers that support audio (e.g. Gemini, OpenAI) consume it via `FilePart`.
 *
 * @param audio    - The audio data as a base64 string or raw `Uint8Array`.
 * @param mediaType - IANA MIME type of the audio (e.g. "audio/wav", "audio/mp3").
 * @param text     - Optional text prompt accompanying the audio.
 *
 * @example
 * ```ts
 * const msg = audioMessage(wavBytes, "audio/wav", "Transcribe this audio");
 * ```
 */
export function audioMessage(
  audio: string | Uint8Array,
  mediaType: string,
  text?: string,
): UserModelMessage {
  const audioPart: FilePart = { type: "file", data: audio, mediaType };
  const parts: Array<TextPart | FilePart> = text !== undefined
    ? [{ type: "text", text }, audioPart]
    : [audioPart];
  return { role: "user", content: parts };
}

/**
 * Build a `UserModelMessage` (AI SDK `CoreUserMessage`) that contains a
 * generic file (PDF, Word doc, etc.), with an optional text prompt.
 *
 * @param data      - The file data as a base64 string or raw `Uint8Array`.
 * @param mediaType - IANA MIME type (e.g. "application/pdf", "text/csv").
 * @param text      - Optional text prompt accompanying the file.
 *
 * @example
 * ```ts
 * const msg = fileMessage(pdfBytes, "application/pdf", "Summarize this document");
 * ```
 */
export function fileMessage(
  data: string | Uint8Array,
  mediaType: string,
  text?: string,
): UserModelMessage {
  const filePart: FilePart = { type: "file", data, mediaType };
  const parts: Array<TextPart | FilePart> = text !== undefined
    ? [{ type: "text", text }, filePart]
    : [filePart];
  return { role: "user", content: parts };
}

// denoCacheMetadata={"headers":{"x-jsr-backend":"modules","date":"Thu, 11 Jun 2026 13:33:23 GMT","cache-control":"public, max-age=31536000, immutable","access-control-expose-headers":"*","x-content-type-options":"nosniff","x-robots-tag":"noindex","access-control-allow-origin":"*","content-encoding":"identity","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","cross-origin-resource-policy":"cross-origin","server":"cloudflare","content-type":"text/typescript","etag":"\"8cc21b11ee4f81ba763b632a54c73f75\"","vary":"Origin","content-length":"4836","cf-ray":"a0a0fcb86f9231aa-LHR","alt-svc":"h3=\":443\"; ma=86400","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=gaGsLMvMLdPWzAqCWPK%2FW8CuLwgIv37NsgcsWV9%2FPqEq0jwQFsucIRbz5PMiCbBndR%2B7P4%2FX%2BqTN0VMKjER8pYMXNty7LF0lK3yNBBP5IyYZ4FSipsaf9YE%3D\"}]}","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/multimodal/content.ts","time":1781184802}