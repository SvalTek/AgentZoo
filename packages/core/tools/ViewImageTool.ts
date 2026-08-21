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

import type { BinaryContent, ToolDefinition } from "@vibesjs/sdk";
import { z } from "zod";
import Context from "@agent-zoo/context";
import type { AgentRunDeps } from "../Agent.ts";
import type { Feature } from "../Feature.ts";
import type { CommandResult } from "../types.ts";
import type { ModelRegistry } from "../ModelRegistry.ts";
import {
  actionableToolError,
  observedToolResult,
  ToolExecutionError,
} from "../ToolSupport.ts";

const ReadImageParameters = z.object({
  path: z.string().optional().describe(
    "The image file to view, as an absolute path or a path relative to the current working directory. Required for execution. Reads the complete image and returns it to you so you can see its contents.",
  ),
  cwd: z.string().optional().describe(
    "The directory from which the image path is resolved, as an absolute path or a path relative to the current working directory. Defaults to the current working directory.",
  ),
});

/**
 * Read an image as base64, mirroring the read_file script's exit-code
 * contract. The runtime container has no `file(1)`, so MIME type is
 * detected from magic bytes in TypeScript rather than shelling out.
 */
const READ_IMAGE_SCRIPT = String.raw`
path=$1
test -e "$path" || exit 40
test -f "$path" || exit 41
test -r "$path" || exit 49
size=$(stat -Lc %s -- "$path") || exit 50
test "$size" -le 209715200 || exit 52
base64 -w0 -- "$path"
`;

const MAX_IMAGE_BYTES = 209_715_200;

/** Map the leading bytes of an image to a MIME type. */
function detectImageMime(bytes: Uint8Array): string | undefined {
  const len = bytes.length;
  const u32 = (off: number) =>
    (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) |
    bytes[off + 3];
  if (
    len >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (len >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    len >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    len >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 &&
    bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    len >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d
  ) {
    return "image/bmp";
  }
  if (
    len >= 4 && u32(0) === 0x0000000c && bytes[4] === 0x6a &&
    bytes[5] === 0x50 &&
    bytes[6] === 0x20 && bytes[7] === 0x20
  ) {
    return "image/jp2";
  }
  return undefined;
}

/**
 * Deliberately scoped image access. It never reads outside the calling
 * agent's isolated root: the command enters that root first, like the
 * filesystem and shell features.
 */
export class VisionFeature implements Feature<AgentRunDeps> {
  readonly id = "vision";
  readonly description = "View an image file from the computer.";

  async createTools(): Promise<readonly ToolDefinition<AgentRunDeps>[]> {
    return [await this.createTool()];
  }

  async createTool(): Promise<ToolDefinition<AgentRunDeps>> {
    const { tool } = await import("@vibesjs/sdk");
    return tool<AgentRunDeps, typeof ReadImageParameters>({
      name: "view_image",
      description: this.description,
      parameters: ReadImageParameters,
      argsValidator: validateViewImageArguments,
      execute: async (context, input) => {
        const path = input.path!;
        const cwd = input.cwd ?? context.deps.cwd;
        const raw = await execute(context.deps, [
          "/bin/bash",
          "-c",
          READ_IMAGE_SCRIPT,
          "view_image",
          path,
        ], cwd);

        const encoded = raw.stdout.trim();
        let binary: Uint8Array;
        try {
          binary = encoded.length > 0
            ? Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
            : new Uint8Array(0);
        } catch {
          throw actionableToolError([
            "The image data could not be decoded.",
            "No image was shown.",
            "Retry once; if it persists, choose another image or inspect the file with shell.",
          ], { command: raw, path });
        }
        const mimeType = detectImageMime(binary);
        if (!mimeType) {
          throw actionableToolError(
            [
              "The file is not a supported image.",
              "Choose a PNG, JPEG, GIF, WebP, BMP, or JPEG 2000 image.",
            ],
            { command: raw, path },
          );
        }

        const telemetry = {
          command: raw,
          path,
          mimeType,
          bytesRead: binary.length,
        };

        // Determine if we need to describe the image via a separate request.
        // - If captioningModel is configured, always use it (works for any model).
        // - If provider is Ollama, use the current model (Ollama can't handle
        //   images in tool results, but can via direct user messages).
        // - Otherwise, return BinaryContent for the model to handle natively.
        const captionModel = context.deps.captioningModel;
        const needsCaptionRequest = captionModel ||
          context.deps.provider === "ollama";

        if (needsCaptionRequest) {
          const modelName = captionModel ?? context.deps.model;
          const description = await describeImageViaModel(
            modelName,
            binary,
            mimeType,
            path,
          );
          return observedToolResult(description, telemetry);
        }

        const result: BinaryContent = {
          type: "binary",
          mimeType,
          data: binary,
        };
        return observedToolResult(result, telemetry);
      },
    });
  }
}

function validateViewImageArguments(
  input: z.infer<typeof ReadImageParameters>,
): void {
  if (!input.path?.trim()) {
    throw actionableToolError(
      [
        "No image path was provided.",
        "Provide the image file to view in path.",
      ],
    );
  }
  if (input.cwd !== undefined && !input.cwd.trim()) {
    throw actionableToolError([
      "cwd is empty.",
      "No image was read.",
      "Provide a directory path in cwd, or omit cwd to use the current working directory.",
    ]);
  }
}

async function execute(
  deps: AgentRunDeps,
  command: string[],
  cwd: string,
): Promise<CommandResult> {
  let raw: CommandResult;
  try {
    raw = await deps.runtime.exec(command, {
      cwd,
      signal: deps.signal,
      timeoutMs: 30_000,
    });
  } catch (error) {
    throw new ToolExecutionError("The image could not be read.", { error });
  }
  switch (raw.exitCode) {
    case 0:
      return raw;
    case 40:
      throw actionableToolError(
        [
          "The image path does not exist.",
          "Check the path or list its parent directory to find the correct name.",
        ],
        { command: raw },
      );
    case 41:
      throw actionableToolError(
        [
          "The image path is not a regular file.",
          "Choose a file path; use list_directory when the path is a directory.",
        ],
        { command: raw },
      );
    case 49:
      throw actionableToolError(
        [
          "The image file could not be read.",
          "Check the file permissions and retry.",
        ],
        { command: raw },
      );
    case 50:
      throw actionableToolError(
        [
          "The image file size could not be determined.",
          "Check the file and retry.",
        ],
        { command: raw },
      );
    case 52:
      throw actionableToolError(
        [
          `The image exceeds the ${MAX_IMAGE_BYTES} byte limit.`,
          "Choose a smaller image, or downscale or crop it before viewing.",
        ],
        { command: raw },
      );
    default:
      throw new ToolExecutionError(
        "Reading the image file failed unexpectedly.",
        { command: raw },
      );
  }
}

/**
 * Describe an image by making a separate vision request to the specified model.
 * Used when the model cannot handle images in tool results (e.g., Ollama) or
 * when a dedicated captioningModel is configured for non-vision models.
 */
async function describeImageViaModel(
  modelName: string,
  imageBytes: Uint8Array,
  mimeType: string,
  imagePath: string,
): Promise<string> {
  const models = Context.tryGet<ModelRegistry>("models");
  if (!models) {
    return `[Image at ${imagePath}: ${mimeType}, ${imageBytes.length} bytes - could not describe: model registry unavailable]`;
  }

  try {
    const { createLanguageModel } = await import("../Providers.ts");
    const { generateText } = await import("npm:ai@^6");

    const model = await createLanguageModel(modelName, models);

    // Convert bytes to base64 for the data URI (chunked to avoid call stack limits)
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < imageBytes.length; i += chunkSize) {
      const chunk = imageBytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const base64 = btoa(binary);
    const dataUri = `data:${mimeType};base64,${base64}`;

    const result = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image" as const,
              image: dataUri,
            },
            {
              type: "text" as const,
              text:
                "Describe this image concisely. Focus on what it shows, any text visible, and notable details.",
            },
          ],
        },
      ],
      maxOutputTokens: 1024,
    });

    const description = result.text?.trim() || "(no description generated)";
    return `[Image: ${imagePath}] ${description}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `[Image at ${imagePath}: ${mimeType}, ${imageBytes.length} bytes - could not describe: ${message}]`;
  }
}
