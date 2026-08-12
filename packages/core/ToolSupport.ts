/** Copyright (C) 2026 Theros <https://github.com/therosin> GPL-3.0-or-later */

const ObservedResult = Symbol("observed-tool-result");

export interface ObservedToolResult<T> {
  readonly [ObservedResult]: true;
  readonly result: T;
  readonly telemetry: unknown;
}

/** Return a bounded model result while retaining richer durable telemetry. */
export function observedToolResult<T>(
  result: T,
  telemetry: unknown = result,
): ObservedToolResult<T> {
  return { [ObservedResult]: true, result, telemetry };
}

export function unwrapObservedToolResult(value: unknown): {
  result: unknown;
  telemetry: unknown;
} {
  if (
    value !== null && typeof value === "object" &&
    ObservedResult in value
  ) {
    const observed = value as ObservedToolResult<unknown>;
    return { result: observed.result, telemetry: observed.telemetry };
  }
  return { result: value, telemetry: value };
}

/** Neutral model-facing failure with richer internal diagnostic telemetry. */
export class ToolExecutionError extends Error {
  readonly telemetry!: unknown;

  constructor(message: string, telemetry?: unknown) {
    super(message);
    this.name = "ToolExecutionError";
    Object.defineProperty(this, "telemetry", {
      value: telemetry,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}

/** Create a model-facing failure that states both the problem and a safe repair. */
export function actionableToolError(
  problem: string,
  repair: string,
  telemetry?: unknown,
): ToolExecutionError {
  return new ToolExecutionError(`${problem} ${repair}`, telemetry);
}
