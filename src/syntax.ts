import { createError } from "./errors";

export interface LexedSource {
  readonly comments: string;
  readonly structure: string;
}

function maskKeepingNewlines(slice: string): string {
  return slice.replace(/[^\r\n]/g, " ");
}

// Replace each non-newline code unit with a single ASCII space so every
// offset in `comments` and `structure` maps 1:1 to `text`.
export function lexSource(text: string, gradle: boolean): LexedSource {
  const commentParts: string[] = [];
  const structureParts: string[] = [];
  let cursor = 0;
  let i = 0;
  const length = text.length;

  while (i < length) {
    const ch = text.charCodeAt(i);
    const next = i + 1 < length ? text.charCodeAt(i + 1) : -1;
    let isComment = false;
    let end = i;

    if (ch === 47 && next === 47) {
      // `//` line comment
      isComment = true;
      const newline = text.indexOf("\n", i + 2);
      end = newline === -1 ? length : newline;
    } else if (ch === 47 && next === 42) {
      // `/* ... */` block comment
      isComment = true;
      const close = text.indexOf("*/", i + 2);
      end = close === -1 ? length : close + 2;
    } else if (ch === 34 || (gradle && ch === 39)) {
      // Quoted string (`"..."`, `'...'`, or Groovy/Kotlin triple quotes)
      const quote = text[i]!;
      const triple = gradle && text.startsWith(quote + quote + quote, i);
      const width = triple ? 3 : 1;
      const delimiter = triple ? quote + quote + quote : quote;
      let j = i + width;
      while (j < length) {
        if (text.startsWith(delimiter, j)) {
          j += width;
          break;
        }
        if (width === 1 && text.charCodeAt(j) === 92) {
          j = Math.min(j + 2, length);
        } else {
          j += 1;
        }
      }
      end = j;
    } else {
      i += 1;
      continue;
    }

    if (i > cursor) {
      const plain = text.slice(cursor, i);
      commentParts.push(plain);
      structureParts.push(plain);
    }

    const token = text.slice(i, end);
    const masked = maskKeepingNewlines(token);
    structureParts.push(masked);
    commentParts.push(isComment ? masked : token);
    cursor = end;
    i = end;
  }

  if (cursor < length) {
    const tail = text.slice(cursor);
    commentParts.push(tail);
    structureParts.push(tail);
  }

  return {
    comments: commentParts.join(""),
    structure: structureParts.join(""),
  };
}

export function matchBraces(text: string): Map<number, number> {
  const stack: number[] = [];
  const pairs = new Map<number, number>();
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 123) {
      stack.push(i);
    } else if (code === 125) {
      const open = stack.pop();
      if (open !== undefined) {
        pairs.set(open, i);
      }
    }
  }
  return pairs;
}

export function closingBrace(
  pairs: Map<number, number>,
  open: number,
  message: string,
  path: string,
): number {
  const close = pairs.get(open);
  if (close === undefined) {
    throw createError("PARSE_ERROR", message, path);
  }
  return close;
}
