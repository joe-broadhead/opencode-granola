/** An element of the XML-like text that Granola's meeting tools return. */
export interface Element {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: (Element | string)[]
}

const NAME = "[A-Za-z_][\\w.:-]*"
const TOKEN = new RegExp(
  `<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|<!--[\\s\\S]*?-->|<\\/(${NAME})\\s*>|<(${NAME})((?:\\s+${NAME}\\s*=\\s*(?:"[^"]*"|'[^']*'))*)\\s*(\\/?)>`,
  "g",
)
const ATTRIBUTE = new RegExp(`(${NAME})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "g")
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" }

function decode(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos));/gi, (whole, decimal?: string, hex?: string, name?: string) => {
    if (name) return NAMED[name.toLowerCase()]!
    const code = decimal ? Number(decimal) : Number.parseInt(hex!, 16)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

/** Whether the text holds at least one element, rather than plain prose. */
export function isMarkup(text: string): boolean {
  return new RegExp(`<${NAME}[\\s/>]`).test(text)
}

/**
 * Parses into a synthetic root element. Tolerant rather than strict: a stray closing tag is ignored, an
 * unclosed element ends with its parent, and text that only looks like markup stays text.
 */
export function parse(text: string): Element {
  const root: Element = { name: "", attributes: {}, children: [] }
  const stack = [root]
  const append = (value: string) => {
    if (!value) return
    const children = stack.at(-1)!.children
    const last = children.length - 1
    if (typeof children[last] === "string") children[last] += value
    else children.push(value)
  }
  let offset = 0
  for (const match of text.matchAll(TOKEN)) {
    append(decode(text.slice(offset, match.index)))
    offset = match.index + match[0].length
    const [, cdata, closing, opening, attributes, selfClosing] = match
    if (cdata !== undefined) append(cdata)
    else if (closing !== undefined) {
      const index = stack.findLastIndex((element) => element.name === closing)
      if (index > 0) stack.length = index
    } else if (opening !== undefined) {
      const element: Element = { name: opening, attributes: readAttributes(attributes ?? ""), children: [] }
      stack.at(-1)!.children.push(element)
      if (!selfClosing) stack.push(element)
    }
  }
  append(decode(text.slice(offset)))
  return root
}

function readAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of text.matchAll(ATTRIBUTE)) attributes[match[1]!] = decode(match[2] ?? match[3] ?? "")
  return attributes
}

export function elements(element: Element): Element[] {
  return element.children.filter((child): child is Element => typeof child !== "string")
}

export function textContent(element: Element): string {
  return element.children.map((child) => (typeof child === "string" ? child : textContent(child))).join("")
}

/** Every element with this name, depth first. */
export function findAll(element: Element, name: string): Element[] {
  return elements(element).flatMap((child) => (child.name === name ? [child] : findAll(child, name)))
}
