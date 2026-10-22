/**
 * Wire contract between AgentZoo and the resident runtime-host service.
 *
 * Text frames carry JSON control messages. Binary frames carry payloads as
 * `[uint32 request sequence, big-endian][bytes]`, so responses for concurrent
 * requests can be matched without base64.
 */

import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const HELPER_VERSION = "0.1.0";
export const DEFAULT_PORT = 8787;

/** Largest payload sent in one response. */
export const MAX_RESPONSE_BYTES = 1_048_576;
/** Default and maximum byte window for a byte read. */
export const DEFAULT_BYTE_LIMIT = 65_536;
/** Default line window for a line read. */
export const DEFAULT_LINE_LIMIT = 200;
/** Largest number of lines returned by one line read. */
export const MAX_LINE_LIMIT = 20_000;
/** Line reads scan the whole file; larger files must use byte ranges. */
export const MAX_LINE_FILE_BYTES = 33_554_432;

export const HostErrorCodeSchema = z.enum([
  "invalid_request",
  "unauthorized",
  "unknown_agent",
  "path_escape",
  "not_found",
  "not_a_file",
  "not_a_directory",
  "permission_denied",
  "binary",
  "invalid_utf8",
  "too_large",
  "watch_limit",
  "range",
  "conflict",
  "timeout",
  "cancelled",
  "internal",
]);
export type HostErrorCode = z.infer<typeof HostErrorCodeSchema>;

export class HostError extends Error {
  constructor(readonly code: HostErrorCode, message: string) {
    super(message);
    this.name = "HostError";
  }
}

export const HelloSchema = z.object({
  op: z.literal("hello"),
  protocol: z.number().int(),
  token: z.string().min(1),
});

export const RequestSchema = z.object({
  id: z.string().min(1),
  op: z.string().min(1),
  agent: z.string().optional(),
  params: z.unknown().optional(),
});

export const SubscribeSchema = z.object({
  op: z.literal("subscribe"),
  sub: z.string().min(1),
  channel: z.literal("fs.watch"),
  agent: z.string().min(1),
  params: z.unknown().optional(),
});

export const UnsubscribeSchema = z.object({
  op: z.literal("unsubscribe"),
  sub: z.string().min(1),
});

export type Hello = z.infer<typeof HelloSchema>;
export type Request = z.infer<typeof RequestSchema>;

export interface ServerSuccess {
  readonly ok: true;
  readonly id?: string;
  /** Present on subscription acknowledgements. */
  readonly sub?: string;
  /** Present when a binary frame carries this response's payload. */
  readonly seq?: number;
  readonly result: Record<string, unknown>;
}

export interface ServerFailure {
  readonly ok: false;
  readonly id?: string;
  /** Present on subscription failures. */
  readonly sub?: string;
  readonly error: { readonly code: HostErrorCode; readonly message: string };
}

export type ServerMessage = ServerSuccess | ServerFailure;

export interface SubscriptionEvent {
  readonly sub: string;
  readonly event: Record<string, unknown>;
}

export function encodeBinaryFrame(
  sequence: number,
  payload: Uint8Array,
): Uint8Array {
  const frame = new Uint8Array(payload.length + 4);
  new DataView(frame.buffer).setUint32(0, sequence);
  frame.set(payload, 4);
  return frame;
}

export function decodeBinaryFrame(
  frame: Uint8Array,
): { sequence: number; payload: Uint8Array } {
  if (frame.length < 4) {
    throw new HostError("invalid_request", "binary frame is too short");
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  return { sequence: view.getUint32(0), payload: frame.subarray(4) };
}
