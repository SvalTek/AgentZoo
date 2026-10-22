/**
 * Copyright (C) 2026 Theros <https://github.com/therosin>
 *
 * This file is part of AgentZoo.
 *
 * AgentZoo is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * AgentZoo is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with AgentZoo.  If not, see <https://www.gnu.org/licenses/>.
 */

// ===========================================================================
// Model / provider configuration
// ===========================================================================
//
// AgentZoo uses NAMED model configurations rather than embedding endpoint
// details throughout agent code. An agent references a model by key; the
// registry resolves that key to a provider + model. This keeps provider
// selection, local/cloud interchangeability and credential handling in one
// place. Provider-specific translation to an actual inference client belongs
// to the Vibes/provider integration layer, not here.

export type ModelProviderId = string;
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "max";

/** Provider-neutral conversation and generation limits. */
export interface ModelContextConfig {
  /** Total input plus output context window, in tokens. */
  window?: number;
  /** Maximum tokens the model may generate in one response. */
  maxOutputTokens?: number;
}

/** Provider-neutral sampling controls shared by supported text backends. */
export interface ModelSamplingConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  typicalP?: number;
  repeatPenalty?: number;
  repeatLastN?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  stopSequences?: string[];
}

export interface ModelRuntimeConfig {
  context?: ModelContextConfig;
  sampling?: ModelSamplingConfig;
}

export interface BaseModelConfig extends ModelRuntimeConfig {
  /** Provider identifier, e.g. "ollama" or "openai-compatible". */
  provider: ModelProviderId;
  /** Model name as the provider expects it, e.g. "qwen3:8b". */
  model: string;
  /** Optional human label for traces/observability. */
  name?: string;
  /** Optional API key, resolved from configuration before provider creation. */
  apiKey?: string;
  /** Enable or disable reasoning for models that expose that capability. */
  reasoning?: boolean;
  /** Requested reasoning effort; auto leaves the provider default unchanged. */
  reasoningEffort?: ReasoningEffort;
}

export interface OllamaModelConfig extends BaseModelConfig {
  provider: "ollama";
  /** Defaults to http://localhost:11434 when omitted. */
  baseUrl?: string;
}

export interface OpenAICompatibleModelConfig extends BaseModelConfig {
  provider: "openai-compatible";
  /** Base URL of the OpenAI-compatible endpoint. */
  baseUrl: string;
  /** Extra headers forwarded to the endpoint. */
  headers?: Record<string, string>;
}

export type ModelConfig =
  | OllamaModelConfig
  | OpenAICompatibleModelConfig;

/** Map of named model configuration key -> configuration. */
export type ModelRegistrySource = Record<string, ModelConfig>;

// ===========================================================================
// Agents
// ===========================================================================
//
// An Agent definition identifies a stable actor. Agent identity is kept
// SEPARATE from model identity: the same agent can switch models without
// becoming a different conceptual agent.

export interface AgentConfig {
  /** Stable unique identifier. */
  id: string;
  /** Optional display name. */
  name?: string;
  /** Configured agent kind/profile, used for identity and observability. */
  type?: string;
  /** Key into the model registry. */
  model: string;
  /**
   * Optional key into the model registry for image captioning.
   * When set, view_image delegates to this model for image description.
   * Useful for non-vision models or Ollama (which can't handle images
   * in tool results). Falls back to the agent's own model when unset.
   */
  captioningModel?: string;
  /** Configured instructions, resolved by Vibes for each model turn. */
  systemPrompt?: string | (() => string | Promise<string>);
  /**
   * IDs of Features this agent may use. Concrete Services grant the
   * actual tools; this is the agent's declared capability set.
   */
  features?: string[];
  /** Runtime environment id this agent is assigned to. */
  runtime?: string;
  /** Service this agent belongs to, where relevant. */
  service?: string;
  /** Whether this agent can see the shared workspace. */
  workspace?: boolean;
  /** Working directory used for the taskless environment observation. */
  cwd?: string;
  /** Maximum model/tool turns within one activation. Defaults to 100. */
  maxTurns?: number;
  /** Effective model context limits after applying agent overrides. */
  context?: ModelContextConfig;
  /** Effective sampling controls after applying agent overrides. */
  sampling?: ModelSamplingConfig;
}

// ===========================================================================
// Runtime (execution environment)
// ===========================================================================
//
// Where agent-requested EXECUTABLE work happens (shell, compiler, scripts).
// This is deliberately separate from where inference happens. Concrete
// Docker currently implements this contract with per-agent OverlayFS/chroot
// roots. A future backend must preserve the same isolation semantics.

export interface CommandOptions {
  /** Working directory inside the agent environment. */
  cwd?: string;
  /** Controlled environment variables for the command. */
  env?: Record<string, string>;
  /** Hard timeout in milliseconds; the command's process group is stopped. */
  timeoutMs?: number;
  /** Cancellation signal. */
  signal?: AbortSignal;
  /** Bytes supplied to the command's standard input. */
  stdin?: string | Uint8Array;
}

export interface CommandResult {
  /** Process exit code, or null if it was killed/aborted. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True if the command was terminated by timeout. */
  timedOut: boolean;
  /** True if the command was cancelled via AbortSignal. */
  aborted: boolean;
}

/** One entry from a directory listing. */
export interface RuntimeListEntry {
  readonly name: string;
  readonly type: "file" | "directory" | "symlink" | "other";
  readonly sizeBytes: number | null;
}

/** One match from a recursive name or text search. */
export interface RuntimeSearchMatch {
  readonly path: string;
  readonly type?: "file" | "directory" | "symlink" | "other";
  readonly line?: number;
  readonly snippet?: string;
}

export interface RuntimeSearchOptions {
  readonly path: string;
  readonly kind: "name" | "text";
  readonly name?: string;
  readonly text?: string;
  readonly maxResults?: number;
}

export interface RuntimeStat {
  readonly type: "file" | "directory" | "symlink" | "other";
  readonly sizeBytes: number;
  readonly mode: number | null;
  readonly mtimeMs: number | null;
  readonly symlink: boolean;
}

/** Byte-exact read-only filesystem operations served by the runtime host. */
export interface RuntimeFiles {
  readBytes(
    path: string,
    offset: number,
    limit: number,
  ): Promise<{
    readonly bytes: Uint8Array;
    readonly offset: number;
    readonly sizeBytes: number;
    readonly truncated: boolean;
    readonly nextOffset?: number;
  }>;
  readLines(
    path: string,
    startLine: number,
    lineLimit: number,
  ): Promise<{
    readonly text: string;
    readonly startLine: number;
    readonly linesReturned: number;
    readonly totalLines: number;
    readonly truncated: boolean;
    readonly nextLine?: number;
  }>;
  list(
    path: string,
    limit?: number,
  ): Promise<{
    readonly entries: readonly RuntimeListEntry[];
    readonly truncated: boolean;
  }>;
  search(options: RuntimeSearchOptions): Promise<{
    readonly results: readonly RuntimeSearchMatch[];
    readonly truncated: boolean;
  }>;
  write(
    path: string,
    mode: "create" | "overwrite" | "append",
    bytes: Uint8Array,
  ): Promise<{ readonly created: boolean; readonly sizeBytes: number }>;
  stat(path: string): Promise<RuntimeStat>;
  remove(path: string): Promise<{ readonly removed: boolean }>;
  /** Read a UTF-8 text file up to `maxBytes`, in bounded protocol pages. */
  readText(path: string, maxBytes: number): Promise<string>;
  /** Release the transport; the next call may reconnect. */
  close?(): void;
}

export interface RuntimeEnv {
  /** Agent this environment belongs to. */
  readonly agentId: string;
  /** Host-backed read-only filesystem access, when the backend provides it. */
  readonly files?: RuntimeFiles;
  /** Prepare/check the environment (create chroot, mount shared, etc.). */
  prepare(): Promise<void>;
  /** Execute a command scoped to this agent's environment. */
  exec(
    command: string | string[],
    options?: CommandOptions,
  ): Promise<CommandResult>;
  /** Stop/release the active environment without deleting persistent agent state. */
  destroy(): Promise<void>;
  /** Discard the private environment state and recreate it. */
  reset(): Promise<void>;
}

export interface RuntimeManager {
  /** Check/prepare the runtime backend itself. */
  prepare(): Promise<void>;
  /** Create (or fetch) a private environment for an agent. */
  createEnv(
    agentId: string,
    options?: Record<string, unknown>,
  ): Promise<RuntimeEnv>;
  /** Get an already-created environment by agent id. */
  getEnv(agentId: string): RuntimeEnv | undefined;
  /** Stop/release an agent environment without purging its persistent state. */
  destroyEnv(agentId: string): Promise<void>;
}

// ===========================================================================
// Shared workspace
// ===========================================================================
//
// The shared filesystem is a first-class coordination substrate. The
// framework imposes no mandatory file protocol; agents use it naturally.

export interface Workspace {
  /** Host-side root path of the shared directory. */
  readonly root: string;
  /** Join segments under the shared root. */
  resolve(...segments: string[]): string;
}

// ===========================================================================
// Top-level Zoo configuration (user-facing YAML)
// ===========================================================================

export interface RuntimeConfig {
  /** Operational runtime backend. Docker is currently the only one. */
  backend?: "docker";
  /** Host-side path of the shared workspace. */
  sharedWorkspace?: string;
}

// ===========================================================================
// Runner / observability
// ===========================================================================

export type ZooAgentState =
  | "created"
  | "ready"
  | "active"
  | "idle"
  | "completed"
  | "errored"
  | "stopped";

export type ZooState =
  | "created"
  | "starting"
  | "running"
  | "stopping"
  | "completed"
  | "stopped"
  | "errored";

export type AgentActivationOutcome = "yield" | "complete" | "response";

export interface AgentActivationOptions {
  /** Role of the stimulus appended to the persistent conversation. */
  readonly role?: "user" | "system";
  /** Context appended to the leading system prompt before the first request. */
  readonly initialSystemContext?: string;
  /** Whether prompt is appended to message history. Defaults to true. */
  readonly appendPrompt?: boolean;
}

export interface AgentActivationResult {
  outcome: AgentActivationOutcome;
  output?: string;
  /** Exact messages added by Vibes during this activation. */
  messages?: readonly unknown[];
  /** Exact resolved system prompt used by the persistent Vibes agent. */
  systemPrompt?: string;
  /** Provider/Vibes accounting and run correlation data. */
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ZooActivityEvent {
  readonly sequence: number;
  readonly at: number;
  readonly kind:
    | "zoo:start"
    | "zoo:complete"
    | "zoo:stop"
    | "agent:wake"
    | "agent:response"
    | "agent:yield"
    | "agent:complete"
    | "agent:model:request"
    | "agent:model:response"
    | "agent:model:error"
    | "agent:tool:start"
    | "agent:tool:end"
    | "agent:tool:error"
    | "agent:mcp:unavailable"
    | "agent:error";
  readonly agentId?: string;
  /** Optional configured display name for the identified agent. */
  readonly agentName?: string;
  readonly message: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly detail?: unknown;
}

export interface ZooAgentSnapshot {
  readonly id: string;
  readonly name: string;
  readonly type?: string;
  readonly model: string;
  readonly state: ZooAgentState;
  readonly currentActivity: string;
  readonly stateSince: number;
  readonly activeForMs: number;
  readonly idleForMs: number;
  readonly activations: number;
  readonly recentActivity: readonly ZooActivityEvent[];
  readonly error?: string;
}

export interface ZooSnapshot {
  readonly state: ZooState;
  readonly stateSince: number;
  readonly activeAgentId?: string;
  readonly stopReason?: string;
  readonly agents: readonly ZooAgentSnapshot[];
  readonly recentActivity: readonly ZooActivityEvent[];
}
