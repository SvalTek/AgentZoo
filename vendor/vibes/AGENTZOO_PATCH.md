# Local Vibes patch

This is the source of `@vibesjs/sdk` 1.0.13 from JSR. It is vendored because
that release does not pass AI SDK's `allowSystemInMessages` option through its
`ModelSettings` adapter.

The local changes:

- add that boolean setting and forward it to `generateText` and `streamText`;
- add a run-level `messageRole` option so a new activation can append an actual
  system message instead of always coercing the prompt to a user message.
- add `appendPrompt: false` so a system-only activation does not fabricate an
  empty user message.
- add `systemPromptAsMessage` for the system-only case, keeping one leading
  system message while satisfying the AI SDK's non-empty message requirement.
- make `tokenTrimHistoryProcessor` generic over run dependencies and export it
  through the narrow application entry point.

AgentZoo merges runtime observations into the single leading system message.
System-only activations use `appendPrompt: false` with
`systemPromptAsMessage`; `allowSystemInMessages` permits that leading message
and the explicit system-role idle wake messages.
Configured context windows use Vibes' token history processor before each
provider request while leaving the persistent conversation untouched.
