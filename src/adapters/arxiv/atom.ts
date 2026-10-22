interface XmlElement {
  name: string;
  attributes: ReadonlyMap<string, string>;
  contents: Array<string | XmlElement>;
}

const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*/u;
const MAX_XML_DEPTH = 64;
const MAX_XML_ELEMENTS = 20_000;
const ATOM_NAMESPACE = "http://www.w3.org/2005/Atom";
const ARXIV_ATOM_NAMESPACE = "http://arxiv.org/schemas/atom";

function validXmlCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

function decodeEntity(entity: string): string {
  switch (entity) {
    case "amp": return "&";
    case "lt": return "<";
    case "gt": return ">";
    case "quot": return '"';
    case "apos": return "'";
    default: {
      const numeric = entity.startsWith("#x")
        ? Number.parseInt(entity.slice(2), 16)
        : entity.startsWith("#")
          ? Number.parseInt(entity.slice(1), 10)
          : Number.NaN;
      const canonical = entity.startsWith("#x")
        ? /^#x[0-9A-Fa-f]+$/u.test(entity)
        : /^#[0-9]+$/u.test(entity);
      if (!canonical || !Number.isSafeInteger(numeric) || !validXmlCodePoint(numeric)) {
        throw new Error("unsupported or invalid XML entity");
      }
      return String.fromCodePoint(numeric);
    }
  }
}

function decodeXmlText(value: string): string {
  let result = "";
  let offset = 0;
  while (offset < value.length) {
    const ampersand = value.indexOf("&", offset);
    if (ampersand < 0) return result + value.slice(offset);
    result += value.slice(offset, ampersand);
    const semicolon = value.indexOf(";", ampersand + 1);
    if (semicolon < 0 || semicolon - ampersand > 32) {
      throw new Error("unterminated XML entity");
    }
    result += decodeEntity(value.slice(ampersand + 1, semicolon));
    offset = semicolon + 1;
  }
  return result;
}

function findTagEnd(xml: string, start: number): number {
  let quote = "";
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote !== "") {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  throw new Error("unterminated XML tag");
}

function parseStartTag(source: string): {
  name: string;
  attributes: ReadonlyMap<string, string>;
  selfClosing: boolean;
} {
  let content = source.trim();
  let selfClosing = false;
  if (content.endsWith("/")) {
    selfClosing = true;
    content = content.slice(0, -1).trimEnd();
  }
  const nameMatch = XML_NAME.exec(content);
  if (nameMatch === null) throw new Error("invalid XML element name");
  const name = nameMatch[0];
  let offset = name.length;
  const attributes = new Map<string, string>();
  while (offset < content.length) {
    while (/\s/u.test(content[offset] ?? "")) offset += 1;
    if (offset >= content.length) break;
    const attributeMatch = XML_NAME.exec(content.slice(offset));
    if (attributeMatch === null) throw new Error("invalid XML attribute name");
    const attributeName = attributeMatch[0];
    if (attributes.has(attributeName)) throw new Error("duplicate XML attribute");
    offset += attributeName.length;
    while (/\s/u.test(content[offset] ?? "")) offset += 1;
    if (content[offset] !== "=") throw new Error("XML attribute is missing equals");
    offset += 1;
    while (/\s/u.test(content[offset] ?? "")) offset += 1;
    const quote = content[offset];
    if (quote !== '"' && quote !== "'") throw new Error("XML attribute is not quoted");
    offset += 1;
    const end = content.indexOf(quote, offset);
    if (end < 0) throw new Error("unterminated XML attribute");
    const raw = content.slice(offset, end);
    if (raw.includes("<")) throw new Error("invalid XML attribute content");
    attributes.set(attributeName, decodeXmlText(raw));
    offset = end + 1;
  }
  return { name, attributes, selfClosing };
}

/** Minimal non-resolving XML parser for a bounded Atom response. */
export function parseSafeXml(xml: string): XmlElement {
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let elementCount = 0;
  let offset = 0;
  while (offset < xml.length) {
    const opening = xml.indexOf("<", offset);
    if (opening < 0) {
      const tail = decodeXmlText(xml.slice(offset));
      if (stack.length === 0) {
        if (tail.trim() !== "") throw new Error("text appears outside the XML root");
      } else {
        stack.at(-1)?.contents.push(tail);
      }
      break;
    }
    const text = decodeXmlText(xml.slice(offset, opening));
    if (stack.length === 0) {
      if (text.trim() !== "") throw new Error("text appears outside the XML root");
    } else {
      stack.at(-1)?.contents.push(text);
    }

    if (xml.startsWith("<!--", opening)) {
      const end = xml.indexOf("-->", opening + 4);
      if (end < 0) throw new Error("unterminated XML comment");
      offset = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", opening)) {
      const end = xml.indexOf("]]>", opening + 9);
      if (end < 0) throw new Error("unterminated XML CDATA");
      if (stack.length === 0) throw new Error("CDATA appears outside the XML root");
      stack.at(-1)?.contents.push(xml.slice(opening + 9, end));
      offset = end + 3;
      continue;
    }
    if (xml.startsWith("<?", opening)) {
      const end = xml.indexOf("?>", opening + 2);
      if (end < 0) throw new Error("unterminated XML processing instruction");
      offset = end + 2;
      continue;
    }
    if (xml.startsWith("<!", opening)) {
      throw new Error("XML declarations and external entities are not supported");
    }
    const tagEnd = findTagEnd(xml, opening + 1);
    const tag = xml.slice(opening + 1, tagEnd);
    if (tag.startsWith("/")) {
      const endName = tag.slice(1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(endName)) {
        throw new Error("invalid XML closing tag");
      }
      const current = stack.pop();
      if (current === undefined || current.name !== endName) {
        throw new Error("mismatched XML closing tag");
      }
    } else {
      const parsed = parseStartTag(tag);
      elementCount += 1;
      if (elementCount > MAX_XML_ELEMENTS) throw new Error("XML element limit exceeded");
      const element: XmlElement = {
        name: parsed.name,
        attributes: parsed.attributes,
        contents: [],
      };
      if (stack.length === 0) {
        if (root !== undefined) throw new Error("XML has multiple root elements");
        root = element;
      } else {
        stack.at(-1)?.contents.push(element);
      }
      if (!parsed.selfClosing) {
        stack.push(element);
        if (stack.length > MAX_XML_DEPTH) throw new Error("XML depth limit exceeded");
      }
    }
    offset = tagEnd + 1;
  }
  if (stack.length !== 0 || root === undefined) throw new Error("XML document is incomplete");
  return root;
}

function childElements(element: XmlElement, name: string): XmlElement[] {
  return element.contents.filter(
    (entry): entry is XmlElement => typeof entry !== "string" && entry.name === name,
  );
}

function textContent(element: XmlElement): string {
  return element.contents.map((entry) => typeof entry === "string" ? entry : textContent(entry)).join("");
}

export interface AtomEntryFields {
  id: string;
  title: string;
  summary: string;
  published: string;
  updated: string;
  authors: string[];
  doi?: string;
  comment?: string;
}

function optionalChildText(element: XmlElement, name: string): string | undefined {
  const children = childElements(element, name);
  if (children.length === 0) return undefined;
  if (children.length !== 1) throw new Error(`Atom entry contains duplicate ${name} fields`);
  return textContent(children[0] as XmlElement);
}

function optionalArxivText(root: XmlElement, element: XmlElement, name: string): string | undefined {
  const children = childElements(element, `arxiv:${name}`);
  if (children.length === 0) return undefined;
  if (root.attributes.get("xmlns:arxiv") !== ARXIV_ATOM_NAMESPACE) {
    throw new Error("arXiv extension metadata uses an invalid namespace");
  }
  if (children.length !== 1) throw new Error(`Atom entry contains duplicate arxiv:${name} fields`);
  return textContent(children[0] as XmlElement);
}

export function atomEntries(root: XmlElement): AtomEntryFields[] {
  if (root.name !== "feed" || root.attributes.get("xmlns") !== ATOM_NAMESPACE) {
    throw new Error("metadata root is not an Atom feed");
  }
  return childElements(root, "entry").map((entry) => {
    const authors = childElements(entry, "author").map((author) => {
      const names = childElements(author, "name");
      if (names.length !== 1) throw new Error("Atom author must contain one name");
      return textContent(names[0] as XmlElement);
    });
    const id = optionalChildText(entry, "id");
    const title = optionalChildText(entry, "title");
    const summary = optionalChildText(entry, "summary");
    const published = optionalChildText(entry, "published");
    const updated = optionalChildText(entry, "updated");
    const errorEntry =
      id !== undefined && title !== undefined &&
      /\/api\/errors(?:#|\/)/iu.test(id) && /^\s*error\b/iu.test(title);
    if (errorEntry) {
      return {
        id,
        title,
        summary: summary ?? "",
        published: published ?? "",
        updated: updated ?? "",
        authors,
      };
    }
    if (
      id === undefined || title === undefined || summary === undefined ||
      published === undefined || updated === undefined
    ) {
      throw new Error("Atom entry is missing required metadata");
    }
    const doi = optionalArxivText(root, entry, "doi");
    const comment = optionalArxivText(root, entry, "comment");
    return {
      id,
      title,
      summary,
      published,
      updated,
      authors,
      ...(doi === undefined ? {} : { doi }),
      ...(comment === undefined ? {} : { comment }),
    };
  });
}
