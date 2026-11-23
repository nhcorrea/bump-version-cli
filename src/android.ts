import { createError } from "./errors";
import { closingBrace, lexSource, matchBraces } from "./syntax";
import type { Source, TextRange } from "./types";
import {
  isAsciiDigits,
  validateAndroidVersionCode,
  validateSemanticVersion,
} from "./version";

interface Occurrence {
  field: "versionCode" | "versionName";
  expr: string;
  line: number;
  inside: boolean;
  value: TextRange | undefined;
}

function occurrenceDetail(item: Occurrence): Record<string, unknown> {
  return {
    field: item.field,
    expression: item.expr,
    line: item.line,
    scope: item.inside ? "defaultConfig" : "override",
  };
}

function isIdentChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}

function directAssignment(
  expr: string,
  field: "versionCode" | "versionName",
  start: number,
  kotlin: boolean,
): TextRange | undefined {
  if (!expr.startsWith(field)) {
    return undefined;
  }
  const tail = expr.slice(field.length);
  const trimmedTail = tail.trimStart();
  const afterFieldWs = tail.length - trimmedTail.length;
  let rhs: string;
  let rhsOffset: number;

  if (trimmedTail.startsWith("=")) {
    const afterEq = trimmedTail.slice(1);
    const trimmedAfterEq = afterEq.trimStart();
    rhsOffset =
      field.length +
      afterFieldWs +
      1 +
      (afterEq.length - trimmedAfterEq.length);
    rhs = trimmedAfterEq;
  } else {
    if (kotlin || (tail[0] !== " " && tail[0] !== "\t")) {
      return undefined;
    }
    rhsOffset = field.length + afterFieldWs;
    rhs = trimmedTail;
  }

  rhs = rhs.trimEnd();
  if (rhs.endsWith(";")) {
    rhs = rhs.slice(0, -1).trimEnd();
  }

  if (field === "versionCode") {
    if (!isAsciiDigits(rhs)) {
      return undefined;
    }
    return { start: start + rhsOffset, end: start + rhsOffset + rhs.length };
  }

  const quote = rhs[0];
  if (quote === undefined || (quote !== '"' && (kotlin || quote !== "'"))) {
    return undefined;
  }
  if (rhs.length < 2 || !rhs.endsWith(quote)) {
    return undefined;
  }
  const value = rhs.slice(1, -1);
  return {
    start: start + rhsOffset + 1,
    end: start + rhsOffset + 1 + value.length,
  };
}

export function analyzeAndroid(text: string, path: string): Source {
  const lex = lexSource(text, true);
  const defaultConfigPattern = /^[ \t]*defaultConfig[ \t]*\{/gm;
  const starts: RegExpExecArray[] = [];
  for (const match of lex.structure.matchAll(defaultConfigPattern)) {
    starts.push(match);
  }

  if (starts.length === 0) {
    throw createError(
      "PARSE_ERROR",
      "Could not find a supported defaultConfig block.",
      path,
    );
  }
  if (starts.length > 1) {
    throw createError(
      "AMBIGUOUS",
      "Multiple defaultConfig blocks were found.",
      path,
      { matches: starts.length },
    );
  }

  const firstMatch = starts[0]!;
  const open = firstMatch.index + firstMatch[0].length - 1;
  const close = closingBrace(
    matchBraces(lex.structure),
    open,
    "The defaultConfig block is not balanced.",
    path,
  );

  const kotlin = path.endsWith(".kts");
  const occurrences: Occurrence[] = [];
  const fields: readonly ("versionCode" | "versionName")[] = [
    "versionCode",
    "versionName",
  ];

  let offset = 0;
  let lineNumber = 1;
  while (offset < lex.comments.length) {
    const newline = lex.comments.indexOf("\n", offset);
    const nextOffset = newline === -1 ? lex.comments.length : newline + 1;
    const line = lex.comments.slice(offset, nextOffset);
    const expr = line.trim();
    const start = offset + (line.length - line.trimStart().length);

    for (const field of fields) {
      if (
        !expr.startsWith(field) ||
        !lex.structure.startsWith(field, start)
      ) {
        continue;
      }
      if (
        expr.length > field.length &&
        isIdentChar(expr.charCodeAt(field.length))
      ) {
        continue;
      }
      occurrences.push({
        field,
        expr,
        line: lineNumber,
        inside: open < start && start < close,
        value: directAssignment(expr, field, start, kotlin),
      });
    }

    offset = nextOffset;
    lineNumber += 1;
  }

  const outside = occurrences
    .filter((item) => !item.inside)
    .map(occurrenceDetail);
  if (outside.length > 0) {
    throw createError(
      "AMBIGUOUS",
      "Android version overrides outside defaultConfig require an explicit source policy.",
      path,
      { candidates: outside },
    );
  }

  const findField = (field: "versionCode" | "versionName"): TextRange => {
    const matches = occurrences.filter((item) => item.field === field);
    if (matches.length === 0) {
      throw createError(
        "PARSE_ERROR",
        `Could not find ${field} inside defaultConfig.`,
        path,
      );
    }
    if (matches.length > 1) {
      throw createError(
        "AMBIGUOUS",
        `Multiple ${field} assignments were found inside defaultConfig.`,
        path,
        { candidates: matches.map(occurrenceDetail) },
      );
    }
    const only = matches[0]!;
    if (only.value === undefined) {
      throw createError(
        "PARSE_ERROR",
        `${field} must be a direct ${kotlin ? "kotlin" : "groovy"} literal assignment.`,
        path,
        { candidates: matches.map(occurrenceDetail) },
      );
    }
    return only.value;
  };

  const build = findField("versionCode");
  const marketing = findField("versionName");
  const buildValue = text.slice(build.start, build.end);
  const marketingValue = text.slice(marketing.start, marketing.end);

  try {
    validateAndroidVersionCode(buildValue, undefined, false);
    validateSemanticVersion(marketingValue, "Android");
  } catch {
    throw createError(
      "PARSE_ERROR",
      "Android defaultConfig contains an unsupported version literal.",
      path,
    );
  }

  return {
    current: {
      build: buildValue,
      marketing: marketingValue,
    },
    builds: [build],
    marketing: [marketing],
  };
}
