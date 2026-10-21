import type { NativeRectangle, PassageCandidate } from "../../protocol/types.js";

export type NativeRectTuple = readonly [number, number, number, number];

export interface NativePageChar {
  text: string;
  rect: NativeRectTuple;
  inlineRect?: NativeRectTuple;
  spaceAfter?: boolean;
  lineBreakAfter?: boolean;
  paragraphBreakAfter?: boolean;
  ignorable?: boolean;
}

export interface RenderedTextLayer {
  text: string;
  /** UTF-16 text offset to source character index. */
  sourceIndexes: number[];
}

function whitespace(character: string): boolean {
  return /\s/u.test(character);
}

export function normalizeVisibleText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function renderTextLayer(chars: readonly NativePageChar[]): RenderedTextLayer {
  const output: string[] = [];
  const sourceIndexes: number[] = [];

  const append = (value: string, sourceIndex: number): void => {
    for (let offset = 0; offset < value.length; offset += 1) {
      const character = value[offset];
      if (character === undefined) continue;
      if (whitespace(character)) {
        if (output.length === 0 || output[output.length - 1] === " ") continue;
        output.push(" ");
        sourceIndexes.push(sourceIndex);
      } else {
        output.push(character);
        sourceIndexes.push(sourceIndex);
      }
    }
  };

  chars.forEach((character, sourceIndex) => {
    if (character.ignorable === true) return;
    append(character.text, sourceIndex);
    if (
      character.spaceAfter === true ||
      character.lineBreakAfter === true ||
      character.paragraphBreakAfter === true
    ) {
      append(" ", sourceIndex);
    }
  });

  while (output[0] === " ") {
    output.shift();
    sourceIndexes.shift();
  }
  while (output[output.length - 1] === " ") {
    output.pop();
    sourceIndexes.pop();
  }

  return { text: output.join(""), sourceIndexes };
}

function validTuple(rectangle: NativeRectTuple): boolean {
  return (
    rectangle.length === 4 &&
    rectangle.every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0) &&
    rectangle[2] > rectangle[0] &&
    rectangle[3] > rectangle[1]
  );
}

function toRectangle(rectangle: NativeRectTuple): NativeRectangle {
  return {
    x1: rectangle[0],
    y1: rectangle[1],
    x2: rectangle[2],
    y2: rectangle[3],
  };
}

function union(rectangles: readonly NativeRectTuple[]): NativeRectangle | undefined {
  const valid = rectangles.filter(validTuple);
  if (valid.length === 0) return undefined;
  return {
    x1: Math.min(...valid.map((rectangle) => rectangle[0])),
    y1: Math.min(...valid.map((rectangle) => rectangle[1])),
    x2: Math.max(...valid.map((rectangle) => rectangle[2])),
    y2: Math.max(...valid.map((rectangle) => rectangle[3])),
  };
}

export function rectanglesForTextRange(
  chars: readonly NativePageChar[],
  layer: RenderedTextLayer,
  start: number,
  end: number,
): NativeRectangle[] {
  const indexes: number[] = [];
  for (let offset = start; offset < end; offset += 1) {
    const sourceIndex = layer.sourceIndexes[offset];
    if (sourceIndex !== undefined && indexes[indexes.length - 1] !== sourceIndex) {
      indexes.push(sourceIndex);
    }
  }
  if (indexes.length === 0) return [];

  const lines: NativePageChar[][] = [];
  let current: NativePageChar[] = [];
  for (const sourceIndex of indexes) {
    const character = chars[sourceIndex];
    if (character === undefined) continue;
    current.push(character);
    if (character.lineBreakAfter === true || character.paragraphBreakAfter === true) {
      lines.push(current);
      current = [];
    }
  }
  if (current.length > 0) lines.push(current);

  return lines
    .map((line) => union(line.map((character) => character.inlineRect ?? character.rect)))
    .filter((rectangle): rectangle is NativeRectangle => rectangle !== undefined);
}

function intersectsCenter(character: NativePageChar, rectangle: NativeRectangle): boolean {
  const source = character.rect;
  if (!validTuple(source)) return false;
  const centerX = source[0] + (source[2] - source[0]) / 2;
  const centerY = source[1] + (source[3] - source[1]) / 2;
  return (
    centerX >= rectangle.x1 &&
    centerX <= rectangle.x2 &&
    centerY >= rectangle.y1 &&
    centerY <= rectangle.y2
  );
}

export function textInRectangles(
  chars: readonly NativePageChar[],
  rectangles: readonly NativeRectangle[],
): string {
  const selected = chars.filter(
    (character) =>
      character.ignorable !== true &&
      rectangles.some((rectangle) => intersectsCenter(character, rectangle)),
  );
  return renderTextLayer(selected).text;
}

export function passageCandidates(text: string): PassageCandidate[] {
  const candidates: PassageCandidate[] = [];
  const seen = new Set<string>();
  const parts = text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map(normalizeVisibleText)
    .filter((part) => part.length > 0);
  let cursor = 0;
  for (const exact of parts) {
    if (seen.has(exact)) continue;
    seen.add(exact);
    const start = text.indexOf(exact, cursor);
    const end = start < 0 ? cursor : start + exact.length;
    const prefix = normalizeVisibleText(text.slice(Math.max(0, start - 80), Math.max(0, start)));
    const suffix = normalizeVisibleText(text.slice(end, end + 80));
    candidates.push({
      exact,
      ...(prefix.length > 0 ? { prefix } : {}),
      ...(suffix.length > 0 ? { suffix } : {}),
    });
    cursor = end;
    if (candidates.length >= 100) break;
  }
  return candidates;
}

export function tupleToRectangle(tuple: NativeRectTuple): NativeRectangle | undefined {
  return validTuple(tuple) ? toRectangle(tuple) : undefined;
}
