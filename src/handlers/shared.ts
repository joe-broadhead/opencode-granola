/** The shapes and refusals the handlers share. */
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import type { JsonSchema } from "@we-the-rebel-alliance/plugin-contract/manifest"

/** A method that takes no input. */
export const EMPTY: JsonSchema = { type: "object", properties: {}, additionalProperties: false }

/** A method whose answer the contract's own checks describe, rather than a second copy of them. */
export const OBJECT: JsonSchema = { type: "object", additionalProperties: true }

/** The `list` snapshot answer a source with `output: "list"` returns: `{ data: { items, editable }, asOf, trust }`. */
export const LIST_SNAPSHOT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        items: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              id: { type: "string", minLength: 1, maxLength: 128 },
              text: { type: "string", maxLength: 200 },
            },
            required: ["id", "text"],
            additionalProperties: false,
          },
        },
        editable: { type: "boolean", const: false },
      },
      required: ["items", "editable"],
      additionalProperties: false,
    },
    asOf: { type: "string", minLength: 1 },
    trust: { type: "string", const: "untrusted" },
  },
  required: ["data", "asOf", "trust"],
  additionalProperties: false,
}

/** Refuse an input the contract's parser rejected, in the contract's one form. */
export function refuseInput(problems: readonly string[]): never {
  throw new SourceError({ code: "INPUT_INVALID", what: problems.join("; "), next: "Pass only the input the method's schema describes." })
}
