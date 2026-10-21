import type {
  AnchorRevalidationPort,
  AnchorRevalidationResult,
  AnchorResolutionPort,
} from "../../ports/anchor.js";
import type {
  AnchorCandidate,
  NativeRectangle,
  RequestFor,
  ResolvedAnchor,
  ResolveAnchorResult,
} from "../../protocol/types.js";
import {
  normalizeVisibleText,
  rectanglesForTextRange,
  renderTextLayer,
  textInRectangles,
  type NativePageChar,
  type NativeRectTuple,
} from "./text-layer.js";

export interface AnchorPage {
  libraryId: string;
  itemKey: string;
  attachmentKey: string;
  attachmentFingerprint: string;
  pageIndex: number;
  pageLabel: string;
  viewBox: NativeRectTuple;
  chars: NativePageChar[];
}

export interface AnchorPageSource {
  readAnchorPage(
    libraryId: string,
    attachmentKey: string,
    pageIndex: number,
  ): Promise<AnchorPage>;
  /**
   * Confirms that a coordinate-only region is the reader's current native
   * selection. Sources that cannot observe a live selection omit this hook.
   */
  confirmInspectedRegion?(
    page: AnchorPage,
    region: { rectangles: NativeRectangle[]; selectedText?: string },
  ): Promise<
    | { confirmed: true; rectangles: NativeRectangle[]; selectedText?: string }
    | { confirmed: false; reason: string }
  >;
}

interface QuoteMatch {
  start: number;
  end: number;
  rectangles: NativeRectangle[];
}

function allOccurrences(text: string, quote: string): number[] {
  const indexes: number[] = [];
  let from = 0;
  while (from <= text.length - quote.length) {
    const index = text.indexOf(quote, from);
    if (index < 0) break;
    indexes.push(index);
    from = index + 1;
  }
  return indexes;
}

function quoteMatches(
  page: AnchorPage,
  exact: string,
  prefix?: string,
  suffix?: string,
): { all: QuoteMatch[]; contextual: QuoteMatch[]; matchedText: string } {
  const layer = renderTextLayer(page.chars);
  const matchedText = normalizeVisibleText(exact);
  if (matchedText.length === 0) return { all: [], contextual: [], matchedText };
  const normalizedPrefix = prefix === undefined ? undefined : normalizeVisibleText(prefix);
  const normalizedSuffix = suffix === undefined ? undefined : normalizeVisibleText(suffix);
  const all = allOccurrences(layer.text, matchedText)
    .map((start) => ({
      start,
      end: start + matchedText.length,
      rectangles: rectanglesForTextRange(
        page.chars,
        layer,
        start,
        start + matchedText.length,
      ),
    }))
    .filter((match) => match.rectangles.length > 0);
  const contextual = all.filter((match) => {
    if (
      normalizedPrefix !== undefined &&
      !layer.text.slice(0, match.start).trimEnd().endsWith(normalizedPrefix)
    ) {
      return false;
    }
    if (
      normalizedSuffix !== undefined &&
      !layer.text.slice(match.end).trimStart().startsWith(normalizedSuffix)
    ) {
      return false;
    }
    return true;
  });
  return { all, contextual, matchedText };
}

function anchorForMatch(
  page: AnchorPage,
  match: QuoteMatch,
  matchedText: string,
  method: "exact_quote" | "quote_with_context",
): ResolvedAnchor {
  return {
    libraryId: page.libraryId,
    itemKey: page.itemKey,
    attachmentKey: page.attachmentKey,
    attachmentFingerprint: page.attachmentFingerprint,
    pageIndex: page.pageIndex,
    pageLabel: page.pageLabel,
    rectangles: match.rectangles,
    selectedText: matchedText,
    matchEvidence: { method, matchedText, exact: true },
  };
}

function candidatesForMatches(
  page: AnchorPage,
  matches: QuoteMatch[],
  matchedText: string,
  method: "exact_quote" | "quote_with_context",
): AnchorCandidate[] {
  return matches.map((match, index) => ({
    anchor: anchorForMatch(page, match, matchedText, method),
    reason: `Text-layer match ${index + 1} of ${matches.length} on page ${page.pageLabel}`,
  }));
}

function rectangleInsidePage(rectangle: NativeRectangle, viewBox: NativeRectTuple): boolean {
  const [left, bottom, right, top] = viewBox;
  return (
    [left, bottom, right, top].every(Number.isFinite) &&
    left >= 0 &&
    bottom >= 0 &&
    right > left &&
    top > bottom &&
    rectangle.x1 >= left &&
    rectangle.y1 >= bottom &&
    rectangle.x2 <= right &&
    rectangle.y2 <= top
  );
}

function rectanglesEqual(
  first: readonly NativeRectangle[],
  second: readonly NativeRectangle[],
): boolean {
  if (first.length !== second.length) return false;
  const close = (left: number, right: number): boolean => Math.abs(left - right) <= 0.001;
  return first.every((rectangle, index) => {
    const other = second[index];
    return (
      other !== undefined &&
      close(rectangle.x1, other.x1) &&
      close(rectangle.y1, other.y1) &&
      close(rectangle.x2, other.x2) &&
      close(rectangle.y2, other.y2)
    );
  });
}

function matchesTextLayerGeometry(
  page: AnchorPage,
  selectedText: string,
  rectangles: readonly NativeRectangle[],
): boolean {
  return quoteMatches(page, selectedText).all.some((match) =>
    rectanglesEqual(match.rectangles, rectangles),
  );
}

export class ZoteroAnchorResolver implements AnchorResolutionPort, AnchorRevalidationPort {
  readonly #pages: AnchorPageSource;

  constructor(pages: AnchorPageSource) {
    this.#pages = pages;
  }

  async resolve(request: RequestFor<"resolve_anchor">): Promise<ResolveAnchorResult> {
    const payload = request.payload;
    const page = await this.#pages.readAnchorPage(
      payload.libraryId,
      payload.attachmentKey,
      payload.pageIndex,
    );
    if (page.attachmentFingerprint !== payload.fingerprint) {
      return {
        status: "unresolved",
        reason: "The PDF fingerprint changed; read the attachment and resolve the passage again",
        candidates: [],
      };
    }

    if (payload.quote !== undefined) {
      if (page.chars.length === 0) {
        return {
          status: "unresolved",
          reason: "The page has no native text layer for quote resolution",
          candidates: [],
        };
      }
      const { all, contextual, matchedText } = quoteMatches(
        page,
        payload.quote.exact,
        payload.quote.prefix,
        payload.quote.suffix,
      );
      const usesContext = payload.quote.prefix !== undefined || payload.quote.suffix !== undefined;
      const matches = usesContext ? contextual : all;
      const method = usesContext ? "quote_with_context" : "exact_quote";
      if (matches.length === 1) {
        const match = matches[0];
        if (match === undefined) throw new Error("Resolved match disappeared");
        return { status: "resolved", anchor: anchorForMatch(page, match, matchedText, method) };
      }
      const evidence = matches.length > 0 ? matches : all;
      const reason =
        matches.length > 1
          ? `The quote has ${matches.length} matches on the page`
          : all.length > 0 && usesContext
            ? "The quote exists, but no occurrence matches the supplied context"
            : "The quote was not found in the current native text layer";
      return {
        status: "unresolved",
        reason,
        candidates: candidatesForMatches(page, evidence, matchedText, method),
      };
    }

    const inspected = payload.inspectedRegion;
    if (inspected === undefined) {
      return { status: "unresolved", reason: "No anchor locator was supplied", candidates: [] };
    }
    if (!inspected.rectangles.every((rectangle) => rectangleInsidePage(rectangle, page.viewBox))) {
      return {
        status: "unresolved",
        reason: "The inspected region is outside the current native page bounds",
        candidates: [],
      };
    }
    const suppliedText =
      inspected.selectedText === undefined
        ? undefined
        : normalizeVisibleText(inspected.selectedText);
    if (
      suppliedText !== undefined &&
      suppliedText.length > 0 &&
      !matchesTextLayerGeometry(page, suppliedText, inspected.rectangles)
    ) {
      return {
        status: "unresolved",
        reason: "The supplied selected text and rectangles do not match current native text-layer geometry",
        candidates: [],
      };
    }

    let confirmedRectangles = inspected.rectangles;
    let selectedText = suppliedText;
    if (suppliedText === undefined || suppliedText.length === 0) {
      const confirm = this.#pages.confirmInspectedRegion;
      if (confirm === undefined) {
        return {
          status: "unresolved",
          reason: "A live native reader selection is required for a coordinate-only inspected region",
          candidates: [],
        };
      }
      const evidence = await confirm.call(this.#pages, page, inspected);
      if (!evidence.confirmed) {
        return { status: "unresolved", reason: evidence.reason, candidates: [] };
      }
      if (!rectanglesEqual(evidence.rectangles, inspected.rectangles)) {
        return {
          status: "unresolved",
          reason: "The live native reader selection does not match the supplied rectangles",
          candidates: [],
        };
      }
      confirmedRectangles = evidence.rectangles;
      selectedText =
        evidence.selectedText === undefined
          ? undefined
          : normalizeVisibleText(evidence.selectedText);
    }
    return {
      status: "resolved",
      anchor: {
        libraryId: page.libraryId,
        itemKey: page.itemKey,
        attachmentKey: page.attachmentKey,
        attachmentFingerprint: page.attachmentFingerprint,
        pageIndex: page.pageIndex,
        pageLabel: page.pageLabel,
        rectangles: confirmedRectangles.map((rectangle) => ({ ...rectangle })),
        ...(selectedText === undefined ? {} : { selectedText }),
        matchEvidence: {
          method: "inspected_region",
          ...(selectedText === undefined ? {} : { matchedText: selectedText }),
          exact: true,
        },
      },
    };
  }

  async revalidate(anchor: ResolvedAnchor): Promise<AnchorRevalidationResult> {
    const page = await this.#pages.readAnchorPage(
      anchor.libraryId,
      anchor.attachmentKey,
      anchor.pageIndex,
    );
    if (page.attachmentFingerprint !== anchor.attachmentFingerprint) {
      return {
        status: "stale_attachment",
        reason: "The PDF fingerprint changed after the anchor was resolved",
        actualFingerprint: page.attachmentFingerprint,
      };
    }
    if (
      page.libraryId !== anchor.libraryId ||
      page.itemKey !== anchor.itemKey ||
      page.attachmentKey !== anchor.attachmentKey ||
      page.pageIndex !== anchor.pageIndex
    ) {
      return { status: "unresolved", reason: "The current native page belongs to a different target" };
    }

    if (anchor.matchEvidence.method === "inspected_region") {
      if (!anchor.rectangles.every((rectangle) => rectangleInsidePage(rectangle, page.viewBox))) {
        return { status: "unresolved", reason: "The inspected region is outside the current page" };
      }
      if (
        anchor.selectedText !== undefined &&
        normalizeVisibleText(anchor.selectedText).length > 0 &&
        matchesTextLayerGeometry(page, anchor.selectedText, anchor.rectangles)
      ) {
        return {
          status: "confirmed",
          anchor: { ...anchor, pageLabel: page.pageLabel },
          description: "Current fingerprint, text-layer geometry, and selected text were confirmed",
        };
      }
      const confirm = this.#pages.confirmInspectedRegion;
      if (confirm === undefined) {
        return {
          status: "unresolved",
          reason: "A live native reader selection is required to revalidate this inspected region",
        };
      }
      const evidence = await confirm.call(this.#pages, page, {
        rectangles: anchor.rectangles,
        ...(anchor.selectedText === undefined ? {} : { selectedText: anchor.selectedText }),
      });
      if (!evidence.confirmed) return { status: "unresolved", reason: evidence.reason };
      if (!rectanglesEqual(evidence.rectangles, anchor.rectangles)) {
        return {
          status: "unresolved",
          reason: "The live native reader selection no longer matches the anchored rectangles",
        };
      }
      return {
        status: "confirmed",
        anchor: {
          ...anchor,
          pageLabel: page.pageLabel,
          ...(evidence.selectedText === undefined
            ? {}
            : { selectedText: normalizeVisibleText(evidence.selectedText) }),
        },
        description: "Current fingerprint and live native reader selection were confirmed",
      };
    }

    const matchedText = anchor.matchEvidence.matchedText;
    if (matchedText === undefined) {
      return { status: "unresolved", reason: "Quote evidence has no matched text" };
    }
    const matches = quoteMatches(page, matchedText).all;
    const geometryMatches = matches.filter((match) =>
      rectanglesEqual(match.rectangles, anchor.rectangles),
    );
    if (geometryMatches.length === 0) {
      return {
        status: "unresolved",
        reason: "The quote no longer matches the anchored native geometry",
      };
    }
    if (geometryMatches.length > 1) {
      return {
        status: "ambiguous",
        reason: "More than one current quote match has the anchored geometry",
        candidates: candidatesForMatches(
          page,
          geometryMatches,
          normalizeVisibleText(matchedText),
          "exact_quote",
        ),
      };
    }
    const match = geometryMatches[0];
    if (match === undefined) throw new Error("Confirmed match disappeared");
    return {
      status: "confirmed",
      anchor: anchorForMatch(
        page,
        match,
        normalizeVisibleText(matchedText),
        anchor.matchEvidence.method,
      ),
      description: "Current fingerprint, quote text, and native geometry were confirmed",
    };
  }
}
