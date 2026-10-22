interface XmlElement {
  name: string;
  localName: string;
  namespaceUri: string | null;
  namespaceScope: NamespaceScope;
  attributes: ReadonlyMap<string, string>;
  contents: Array<string | XmlElement>;
}

interface NamespaceScope {
  parent?: NamespaceScope;
  bindings: ReadonlyMap<string, string | null>;
}

const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*/u;
const XML_NAME_PART = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;
const MAX_XML_DEPTH = 64;
const MAX_XML_ELEMENTS = 20_000;
const ATOM_NAMESPACE = "http://www.w3.org/2005/Atom";
const ARXIV_ATOM_NAMESPACE = "http://arxiv.org/schemas/atom";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
const ROOT_NAMESPACE_SCOPE: NamespaceScope = {
  bindings: new Map([["xml", XML_NAMESPACE]]),
};

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

function assertValidXmlCharacters(value: string): void {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || !validXmlCodePoint(codePoint)) {
      throw new Error("XML contains an invalid character");
    }
  }
}

function isXmlWhitespace(value: string | undefined): boolean {
  return value === " " || value === "\t" || value === "\r" || value === "\n";
}

function isOnlyXmlWhitespace(value: string): boolean {
  for (const character of value) {
    if (!isXmlWhitespace(character)) return false;
  }
  return true;
}

interface QualifiedName {
  prefix?: string;
  localName: string;
}

function qualifiedName(value: string): QualifiedName {
  const pieces = value.split(":");
  if (pieces.length === 1) {
    const localName = pieces[0] ?? "";
    if (!XML_NAME_PART.test(localName)) throw new Error("invalid XML qualified name");
    return { localName };
  }
  if (pieces.length !== 2) throw new Error("invalid XML qualified name");
  const prefix = pieces[0] ?? "";
  const localName = pieces[1] ?? "";
  if (!XML_NAME_PART.test(prefix) || !XML_NAME_PART.test(localName)) {
    throw new Error("invalid XML qualified name");
  }
  return { prefix, localName };
}

function resolveNamespace(scope: NamespaceScope, prefix: string): string | undefined {
  let current: NamespaceScope | undefined = scope;
  while (current !== undefined) {
    if (current.bindings.has(prefix)) {
      return current.bindings.get(prefix) ?? undefined;
    }
    current = current.parent;
  }
  return undefined;
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

interface ParsedStartTag {
  name: string;
  attributes: ReadonlyMap<string, string>;
  selfClosing: boolean;
}

function parseStartTag(source: string): ParsedStartTag {
  if (source === "" || isXmlWhitespace(source[0])) {
    throw new Error("invalid XML element name");
  }
  const selfClosing = source.endsWith("/");
  const content = selfClosing ? source.slice(0, -1) : source;
  const nameMatch = XML_NAME.exec(content);
  if (nameMatch === null) throw new Error("invalid XML element name");
  const name = nameMatch[0];
  qualifiedName(name);
  let offset = name.length;
  const attributes = new Map<string, string>();
  while (offset < content.length) {
    if (!isXmlWhitespace(content[offset])) {
      throw new Error("XML attributes must be separated by whitespace");
    }
    while (isXmlWhitespace(content[offset])) offset += 1;
    if (offset >= content.length) break;
    const attributeMatch = XML_NAME.exec(content.slice(offset));
    if (attributeMatch === null) throw new Error("invalid XML attribute name");
    const attributeName = attributeMatch[0];
    qualifiedName(attributeName);
    if (attributes.has(attributeName)) throw new Error("duplicate XML attribute");
    offset += attributeName.length;
    while (isXmlWhitespace(content[offset])) offset += 1;
    if (content[offset] !== "=") throw new Error("XML attribute is missing equals");
    offset += 1;
    while (isXmlWhitespace(content[offset])) offset += 1;
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

function elementFromTag(parsed: ParsedStartTag, parent: XmlElement | undefined): XmlElement {
  const parentScope = parent?.namespaceScope ?? ROOT_NAMESPACE_SCOPE;
  const localBindings = new Map<string, string | null>();
  for (const [name, value] of parsed.attributes) {
    if (name === "xmlns") {
      if (value === XMLNS_NAMESPACE || value === XML_NAMESPACE) {
        throw new Error("invalid default XML namespace declaration");
      }
      localBindings.set("", value === "" ? null : value);
      continue;
    }
    const attributeName = qualifiedName(name);
    if (attributeName.prefix !== "xmlns") continue;
    if (
      attributeName.localName === "xmlns" ||
      value === "" ||
      value === XMLNS_NAMESPACE ||
      (attributeName.localName === "xml" && value !== XML_NAMESPACE) ||
      (attributeName.localName !== "xml" && value === XML_NAMESPACE)
    ) {
      throw new Error("invalid XML namespace declaration");
    }
    localBindings.set(attributeName.localName, value);
  }
  const namespaceScope = localBindings.size === 0
    ? parentScope
    : { parent: parentScope, bindings: localBindings };

  const name = qualifiedName(parsed.name);
  if (name.prefix === "xmlns") throw new Error("elements cannot use the xmlns prefix");
  const namespaceUri = name.prefix === undefined
    ? resolveNamespace(namespaceScope, "") ?? null
    : resolveNamespace(namespaceScope, name.prefix);
  if (name.prefix !== undefined && namespaceUri === undefined) {
    throw new Error("XML element uses an unbound namespace prefix");
  }

  const expandedAttributes = new Set<string>();
  for (const attribute of parsed.attributes.keys()) {
    if (attribute === "xmlns") continue;
    const attributeName = qualifiedName(attribute);
    if (attributeName.prefix === "xmlns") continue;
    const attributeNamespace = attributeName.prefix === undefined
      ? ""
      : resolveNamespace(namespaceScope, attributeName.prefix);
    if (attributeName.prefix !== undefined && attributeNamespace === undefined) {
      throw new Error("XML attribute uses an unbound namespace prefix");
    }
    const expanded = `{${attributeNamespace ?? ""}}${attributeName.localName}`;
    if (expandedAttributes.has(expanded)) throw new Error("duplicate expanded XML attribute");
    expandedAttributes.add(expanded);
  }

  return {
    name: parsed.name,
    localName: name.localName,
    namespaceUri: namespaceUri ?? null,
    namespaceScope,
    attributes: parsed.attributes,
    contents: [],
  };
}

function closingName(source: string): string {
  if (source === "" || isXmlWhitespace(source[0])) {
    throw new Error("invalid XML closing tag");
  }
  let end = source.length;
  while (end > 0 && isXmlWhitespace(source[end - 1])) end -= 1;
  const name = source.slice(0, end);
  qualifiedName(name);
  return name;
}

/** Minimal namespace-aware, non-resolving XML parser for a bounded Atom response. */
export function parseSafeXml(xml: string): XmlElement {
  assertValidXmlCharacters(xml);
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let elementCount = 0;
  let offset = 0;
  while (offset < xml.length) {
    const opening = xml.indexOf("<", offset);
    if (opening < 0) {
      const rawTail = xml.slice(offset);
      if (rawTail.includes("]]>")) throw new Error("invalid XML character data");
      const tail = decodeXmlText(rawTail);
      if (stack.length === 0) {
        if (!isOnlyXmlWhitespace(tail)) throw new Error("text appears outside the XML root");
      } else {
        stack.at(-1)?.contents.push(tail);
      }
      break;
    }
    const rawText = xml.slice(offset, opening);
    if (rawText.includes("]]>")) throw new Error("invalid XML character data");
    const text = decodeXmlText(rawText);
    if (stack.length === 0) {
      if (!isOnlyXmlWhitespace(text)) throw new Error("text appears outside the XML root");
    } else {
      stack.at(-1)?.contents.push(text);
    }

    if (xml.startsWith("<!--", opening)) {
      const end = xml.indexOf("-->", opening + 4);
      if (end < 0) throw new Error("unterminated XML comment");
      const comment = xml.slice(opening + 4, end);
      if (comment.includes("--") || comment.endsWith("-")) {
        throw new Error("invalid XML comment");
      }
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
      const instruction = xml.slice(opening + 2, end);
      const target = XML_NAME.exec(instruction)?.[0];
      if (
        target === undefined ||
        isXmlWhitespace(instruction[0]) ||
        (instruction.length > target.length && !isXmlWhitespace(instruction[target.length]))
      ) {
        throw new Error("invalid XML processing instruction");
      }
      qualifiedName(target);
      if (/^xml$/iu.test(target)) {
        if (target !== "xml" || opening !== 0 || root !== undefined) {
          throw new Error("invalid or misplaced XML declaration");
        }
        const declaration = instruction.slice(target.length);
        if (!/^\s+version\s*=\s*(?:"1\.[01]"|'1\.[01]')(?:\s+encoding\s*=\s*(?:"[A-Za-z][A-Za-z0-9._-]*"|'[A-Za-z][A-Za-z0-9._-]*'))?(?:\s+standalone\s*=\s*(?:"(?:yes|no)"|'(?:yes|no)'))?\s*$/u.test(declaration)) {
          throw new Error("invalid XML declaration");
        }
      }
      offset = end + 2;
      continue;
    }
    if (xml.startsWith("<!", opening)) {
      throw new Error("XML declarations and external entities are not supported");
    }
    const tagEnd = findTagEnd(xml, opening + 1);
    const tag = xml.slice(opening + 1, tagEnd);
    if (tag.startsWith("/")) {
      const endName = closingName(tag.slice(1));
      const current = stack.pop();
      if (current === undefined || current.name !== endName) {
        throw new Error("mismatched XML closing tag");
      }
    } else {
      const parsed = parseStartTag(tag);
      elementCount += 1;
      if (elementCount > MAX_XML_ELEMENTS) throw new Error("XML element limit exceeded");
      const parent = stack.at(-1);
      const element = elementFromTag(parsed, parent);
      if (parent === undefined) {
        if (root !== undefined) throw new Error("XML has multiple root elements");
        root = element;
      } else {
        parent.contents.push(element);
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

function childElements(element: XmlElement, namespaceUri: string, localName: string): XmlElement[] {
  return element.contents.filter(
    (entry): entry is XmlElement =>
      typeof entry !== "string" &&
      entry.namespaceUri === namespaceUri &&
      entry.localName === localName,
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
  const children = childElements(element, ATOM_NAMESPACE, name);
  if (children.length === 0) return undefined;
  if (children.length !== 1) throw new Error(`Atom entry contains duplicate ${name} fields`);
  return textContent(children[0] as XmlElement);
}

function optionalArxivText(element: XmlElement, name: string): string | undefined {
  const children = childElements(element, ARXIV_ATOM_NAMESPACE, name);
  if (children.length === 0) return undefined;
  if (children.length !== 1) throw new Error(`Atom entry contains duplicate arXiv ${name} fields`);
  return textContent(children[0] as XmlElement);
}

export function atomEntries(root: XmlElement): AtomEntryFields[] {
  if (root.localName !== "feed" || root.namespaceUri !== ATOM_NAMESPACE) {
    throw new Error("metadata root is not an Atom feed");
  }
  return childElements(root, ATOM_NAMESPACE, "entry").map((entry) => {
    const authors = childElements(entry, ATOM_NAMESPACE, "author").map((author) => {
      const names = childElements(author, ATOM_NAMESPACE, "name");
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
    const doi = optionalArxivText(entry, "doi");
    const comment = optionalArxivText(entry, "comment");
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
