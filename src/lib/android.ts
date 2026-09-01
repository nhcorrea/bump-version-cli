import * as fs from "fs";

import { AndroidConfig } from "../types/types";
import { BumpVersionError } from "./errors";
import {
  validateAndroidVersionCode,
  validateSemanticVersion,
} from "../core/version";
import {
  AppliedChange,
  buildChangePlan,
  ChangePlan,
} from "../core/change-plan";
import { commitChangePlan } from "./safe-write";
import { androidGroovyAdapter } from "./android-groovy";
import { androidKotlinAdapter } from "./android-kotlin";
import { AndroidSyntaxAdapter } from "./android-syntax";

const ENCODING: BufferEncoding = "utf8";

export interface AndroidWriteOptions {
  allowDowngrade?: boolean;
}

interface SourceAssignment {
  field: "versionCode" | "versionName";
  fieldStart: number;
  valueStart: number;
  valueEnd: number;
  value: string;
}

interface SourceOccurrence {
  field: "versionCode" | "versionName";
  fieldStart: number;
  line: number;
  expression: string;
  insideDefaultConfig: boolean;
}

interface AndroidSourceAnalysis {
  config: AndroidConfig;
  buildAssignment: SourceAssignment;
  marketingAssignment: SourceAssignment;
}

function syntaxForPath(path: string): AndroidSyntaxAdapter {
  return path.endsWith(".gradle.kts") || path.endsWith(".kts")
    ? androidKotlinAdapter
    : androidGroovyAdapter;
}

function maskLexicalContent(source: string, maskStrings: boolean): string {
  const result = source.split("");
  let index = 0;
  let state: "code" | "line-comment" | "block-comment" | "string" =
    "code";
  let delimiter = "";

  const mask = (position: number): void => {
    if (source[position] !== "\r" && source[position] !== "\n") {
      result[position] = " ";
    }
  };

  while (index < source.length) {
    if (state === "line-comment") {
      if (source[index] === "\n") {
        state = "code";
      } else {
        mask(index);
      }
      index += 1;
      continue;
    }

    if (state === "block-comment") {
      mask(index);

      if (source[index] === "*" && source[index + 1] === "/") {
        mask(index + 1);
        index += 2;
        state = "code";
      } else {
        index += 1;
      }
      continue;
    }

    if (state === "string") {
      if (maskStrings) {
        mask(index);
      }

      if (source.startsWith(delimiter, index)) {
        for (let offset = 0; offset < delimiter.length; offset += 1) {
          if (maskStrings) {
            mask(index + offset);
          }
        }
        index += delimiter.length;
        state = "code";
      } else if (
        delimiter.length === 1 &&
        source[index] === "\\" &&
        index + 1 < source.length
      ) {
        if (maskStrings) {
          mask(index + 1);
        }
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (source[index] === "/" && source[index + 1] === "/") {
      mask(index);
      mask(index + 1);
      index += 2;
      state = "line-comment";
      continue;
    }

    if (source[index] === "/" && source[index + 1] === "*") {
      mask(index);
      mask(index + 1);
      index += 2;
      state = "block-comment";
      continue;
    }

    const triple = source.slice(index, index + 3);

    if (triple === '"""' || triple === "'''") {
      delimiter = triple;
      state = "string";

      if (maskStrings) {
        mask(index);
        mask(index + 1);
        mask(index + 2);
      }

      index += 3;
      continue;
    }

    if (source[index] === '"' || source[index] === "'") {
      delimiter = source[index];
      state = "string";

      if (maskStrings) {
        mask(index);
      }

      index += 1;
      continue;
    }

    index += 1;
  }

  return result.join("");
}

function findDefaultConfigBlock(
  structuralSource: string,
  path: string
): { open: number; close: number } {
  const matches = Array.from(
    structuralSource.matchAll(/^[ \t]*defaultConfig[ \t]*\{/gm)
  );

  if (matches.length === 0) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      "Could not find a supported defaultConfig block.",
      path
    );
  }

  if (matches.length > 1) {
    throw new BumpVersionError(
      "AMBIGUOUS",
      "Multiple defaultConfig blocks were found.",
      path,
      undefined,
      { matches: matches.length }
    );
  }

  const match = matches[0];
  const open = match.index! + match[0].lastIndexOf("{");
  let depth = 0;

  for (let index = open; index < structuralSource.length; index += 1) {
    if (structuralSource[index] === "{") {
      depth += 1;
    } else if (structuralSource[index] === "}") {
      depth -= 1;

      if (depth === 0) {
        return { open, close: index };
      }
    }
  }

  throw new BumpVersionError(
    "PARSE_ERROR",
    "The defaultConfig block is not balanced.",
    path
  );
}

function collectAssignments(
  source: string,
  structuralSource: string,
  pattern: RegExp,
  field: SourceAssignment["field"]
): SourceAssignment[] {
  return Array.from(source.matchAll(pattern))
    .map((match) => {
      const fieldOffset = match[0].indexOf(field);
      const fieldStart = match.index! + fieldOffset;

      if (structuralSource.slice(fieldStart, fieldStart + field.length) !== field) {
        return undefined;
      }

      const isMarketingVersion = field === "versionName";
      const value = isMarketingVersion ? match[3] : match[2];
      const valuePrefixLength = isMarketingVersion
        ? match[1].length + match[2].length
        : match[1].length;
      const valueStart = match.index! + valuePrefixLength;

      return {
        field,
        fieldStart,
        valueStart,
        valueEnd: valueStart + value.length,
        value,
      };
    })
    .filter((assignment): assignment is SourceAssignment => assignment !== undefined);
}

function collectOccurrences(
  source: string,
  structuralSource: string,
  block: { open: number; close: number }
): SourceOccurrence[] {
  return Array.from(
    source.matchAll(/^[ \t]*(versionCode|versionName)\b[^\r\n]*/gm)
  )
    .map((match) => {
      const field = match[1] as SourceOccurrence["field"];
      const fieldStart = match.index! + match[0].indexOf(field);

      if (structuralSource.slice(fieldStart, fieldStart + field.length) !== field) {
        return undefined;
      }

      return {
        field,
        fieldStart,
        line: source.slice(0, fieldStart).split(/\r?\n/).length,
        expression: match[0].trim(),
        insideDefaultConfig: fieldStart > block.open && fieldStart < block.close,
      };
    })
    .filter((occurrence): occurrence is SourceOccurrence => occurrence !== undefined);
}

function candidateDetails(occurrences: SourceOccurrence[]) {
  return occurrences.map(({ field, line, expression, insideDefaultConfig }) => ({
    field,
    line,
    expression,
    scope: insideDefaultConfig ? "defaultConfig" : "override",
  }));
}

function requireDirectAssignment(options: {
  field: SourceAssignment["field"];
  assignments: SourceAssignment[];
  occurrences: SourceOccurrence[];
  block: { open: number; close: number };
  syntax: AndroidSyntaxAdapter;
  path: string;
}): SourceAssignment {
  const occurrences = options.occurrences.filter(
    ({ field, insideDefaultConfig }) =>
      field === options.field && insideDefaultConfig
  );
  const assignments = options.assignments.filter(
    ({ fieldStart }) =>
      fieldStart > options.block.open && fieldStart < options.block.close
  );

  if (occurrences.length === 0) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      `Could not find ${options.field} inside defaultConfig.`,
      options.path
    );
  }

  if (occurrences.length > 1 || assignments.length > 1) {
    throw new BumpVersionError(
      "AMBIGUOUS",
      `Multiple ${options.field} assignments were found inside defaultConfig.`,
      options.path,
      undefined,
      { candidates: candidateDetails(occurrences) }
    );
  }

  if (assignments.length !== 1 || assignments[0].fieldStart !== occurrences[0].fieldStart) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      `${options.field} must be a direct ${options.syntax.kind} literal assignment.`,
      options.path,
      undefined,
      { candidates: candidateDetails(occurrences) }
    );
  }

  return assignments[0];
}

function analyzeAndroidBuildGradle(
  file: string,
  path: string
): AndroidSourceAnalysis {
  const syntax = syntaxForPath(path);
  const commentMasked = maskLexicalContent(file, false);
  const structuralSource = maskLexicalContent(file, true);
  const block = findDefaultConfigBlock(structuralSource, path);
  const occurrences = collectOccurrences(commentMasked, structuralSource, block);
  const overrides = occurrences.filter(({ insideDefaultConfig }) => !insideDefaultConfig);

  if (overrides.length > 0) {
    throw new BumpVersionError(
      "AMBIGUOUS",
      "Android version overrides outside defaultConfig require an explicit source policy.",
      path,
      undefined,
      { candidates: candidateDetails(overrides) }
    );
  }

  const buildAssignment = requireDirectAssignment({
    field: "versionCode",
    assignments: collectAssignments(
      commentMasked,
      structuralSource,
      syntax.versionCodePattern(),
      "versionCode"
    ),
    occurrences,
    block,
    syntax,
    path,
  });
  const marketingAssignment = requireDirectAssignment({
    field: "versionName",
    assignments: collectAssignments(
      commentMasked,
      structuralSource,
      syntax.versionNamePattern(),
      "versionName"
    ),
    occurrences,
    block,
    syntax,
    path,
  });

  try {
    validateAndroidVersionCode(buildAssignment.value);
    validateSemanticVersion(marketingAssignment.value, "Android");
  } catch (error) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      "Android defaultConfig contains an unsupported version literal.",
      path,
      error
    );
  }

  return {
    config: {
      buildVersion: buildAssignment.value,
      marketingVersion: marketingAssignment.value,
    },
    buildAssignment,
    marketingAssignment,
  };
}

export function parseAndroidBuildGradle(
  file: string,
  path: string
): AndroidConfig {
  return analyzeAndroidBuildGradle(file, path).config;
}

function readAndroidFile(path: string): string {
  try {
    return fs.readFileSync(path, ENCODING);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error && error.code === "ENOENT"
        ? "NOT_FOUND"
        : "PARSE_ERROR";

    throw new BumpVersionError(
      code,
      "Could not read the Android Gradle project file.",
      path,
      error
    );
  }
}

export function readAndroidBuildGradle(path: string): AndroidConfig {
  return parseAndroidBuildGradle(readAndroidFile(path), path);
}

export function transformAndroidBuildGradle(
  file: string,
  path: string,
  newVersionCode: string,
  newVersionName: string,
  options: AndroidWriteOptions = {}
): string {
  const analysis = analyzeAndroidBuildGradle(file, path);
  const normalizedVersionCode = validateAndroidVersionCode(
    newVersionCode,
    analysis.config.buildVersion,
    options.allowDowngrade ?? false
  );
  validateSemanticVersion(newVersionName, "Android");
  const replacements = [
    { assignment: analysis.buildAssignment, value: normalizedVersionCode },
    { assignment: analysis.marketingAssignment, value: newVersionName },
  ].sort((left, right) => right.assignment.valueStart - left.assignment.valueStart);
  let transformed = file;

  for (const { assignment, value } of replacements) {
    transformed =
      transformed.slice(0, assignment.valueStart) +
      value +
      transformed.slice(assignment.valueEnd);
  }

  const result = parseAndroidBuildGradle(transformed, path);

  if (
    result.buildVersion !== normalizedVersionCode ||
    result.marketingVersion !== newVersionName
  ) {
    throw new BumpVersionError(
      "VERIFY_ERROR",
      "The transformed Android version does not match the requested values.",
      path
    );
  }

  return transformed;
}

export function createAndroidChangePlan(
  path: string,
  newVersionCode: string,
  newVersionName: string,
  options: AndroidWriteOptions = {}
): ChangePlan<AndroidConfig> {
  const file = readAndroidFile(path);
  const before = parseAndroidBuildGradle(file, path);
  const transformed = transformAndroidBuildGradle(
    file,
    path,
    newVersionCode,
    newVersionName,
    options
  );
  const after = parseAndroidBuildGradle(transformed, path);

  return buildChangePlan({
    platform: "android",
    path,
    before,
    after,
    beforeContent: file,
    afterContent: transformed,
    buildMatches: 1,
    marketingMatches: 1,
  });
}

export function applyAndroidChangePlan(
  plan: ChangePlan<AndroidConfig>
): AppliedChange<AndroidConfig> {
  if (plan.platform !== "android") {
    throw new BumpVersionError(
      "VERIFY_ERROR",
      "Cannot apply a non-Android plan with the Android adapter.",
      plan.path
    );
  }

  const applied = commitChangePlan(plan, parseAndroidBuildGradle);

  if (
    applied.config.buildVersion !== plan.after.buildVersion ||
    applied.config.marketingVersion !== plan.after.marketingVersion
  ) {
    throw new BumpVersionError(
      "VERIFY_ERROR",
      "The committed Android values do not match the plan.",
      plan.path
    );
  }

  return applied;
}

export function writeNewAndroidBuildGradle(
  path: string,
  newVersionCode: string,
  newVersionName: string,
  options: AndroidWriteOptions = {}
): AppliedChange<AndroidConfig> {
  return applyAndroidChangePlan(
    createAndroidChangePlan(path, newVersionCode, newVersionName, options)
  );
}
