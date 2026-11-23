import { createError } from "./errors";
import {
  closingBrace,
  lexSource,
  matchBraces,
  type LexedSource,
} from "./syntax";
import {
  isExplicitSelection,
  type Selection,
  type Source,
  type TextRange,
} from "./types";
import {
  isAsciiDigits,
  parsePositiveBuild,
  validateSemanticVersion,
} from "./version";

interface Block {
  open: number;
  close: number;
  id: string;
  name: string;
  targets: string[];
  base: boolean;
}

interface PbxObject {
  id: string;
  isa: string;
  name: string;
  list: string;
  ids: string[];
  block: number | undefined;
  base: boolean;
}

interface Assignment {
  field: "CURRENT_PROJECT_VERSION" | "MARKETING_VERSION";
  expr: string;
  value: string;
  span: TextRange;
  block: number | undefined;
  line: number;
}

function blockMetadata(block: Block): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (block.id.length > 0) {
    data.configurationId = block.id;
  }
  if (block.name.length > 0) {
    data.configuration = block.name;
  }
  if (block.targets.length > 0) {
    data.targets = block.targets;
  }
  return data;
}

function assignmentDetail(
  assignment: Assignment,
  blocks: readonly Block[],
): Record<string, unknown> {
  const base =
    assignment.block !== undefined
      ? blockMetadata(blocks[assignment.block]!)
      : {};
  return {
    ...base,
    field: assignment.field,
    value: assignment.value,
    expression: assignment.expr,
    line: assignment.line,
    buildSettings:
      assignment.block !== undefined ? assignment.block + 1 : null,
  };
}

function decodePbxValue(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch {
    // Fall back to trimming surrounding quotes for unquoted/non-JSON strings.
  }
  return value.replace(/^"+|"+$/g, "");
}

function partitionPoint<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (predicate(items[mid]!)) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function countNewlines(text: string, from: number, to: number): number {
  let count = 0;
  for (let i = from; i < to; i += 1) {
    if (text.charCodeAt(i) === 10) {
      count += 1;
    }
  }
  return count;
}

class PbxGraph {
  readonly configs: Map<string, PbxObject>;
  readonly targets: PbxObject[];

  constructor(configs: Map<string, PbxObject>, targets: PbxObject[]) {
    this.configs = configs;
    this.targets = targets;
  }

  select(
    selection: Selection,
    active: Set<number>,
    path: string,
  ): number[] {
    if (selection.target !== undefined && selection.allTargets) {
      throw createError(
        "VALIDATION_ERROR",
        "--ios-target and --all-targets cannot be used together.",
        "--ios-target",
      );
    }

    if (this.targets.length === 0) {
      if (isExplicitSelection(selection)) {
        throw createError(
          "PARSE_ERROR",
          "Explicit iOS target/configuration selection requires PBXNativeTarget metadata.",
          path,
        );
      }
      return [...active].sort((a, b) => a - b);
    }

    const targetDetails = () => ({
      targets: this.targets.map((target) => ({
        name: target.name,
        configurations: target.ids.map(
          (id) => this.configs.get(id)?.name ?? id,
        ),
      })),
    });

    const matchedTargets = this.targets.filter(
      (target) =>
        selection.target === undefined || selection.target === target.name,
    );

    if (selection.target !== undefined) {
      if (matchedTargets.length === 0) {
        throw createError(
          "NOT_FOUND",
          `Could not find iOS target ${selection.target}.`,
          path,
          targetDetails(),
        );
      }
      if (matchedTargets.length > 1) {
        throw createError(
          "AMBIGUOUS",
          `Multiple iOS targets are named ${selection.target}.`,
          path,
          targetDetails(),
        );
      }
    } else if (!selection.allTargets && matchedTargets.length > 1) {
      throw createError(
        "AMBIGUOUS",
        "Multiple iOS targets were found; use --ios-target or --all-targets.",
        path,
        targetDetails(),
      );
    }

    const selected = new Set<number>();
    for (const target of matchedTargets) {
      let matches = 0;
      for (const id of target.ids) {
        const config = this.configs.get(id);
        if (config === undefined) {
          throw createError(
            "PARSE_ERROR",
            "An iOS target references an unknown build configuration.",
            path,
            { target: target.name, configurationId: id },
          );
        }
        if (
          selection.configuration !== undefined &&
          selection.configuration !== config.name
        ) {
          continue;
        }
        matches += 1;
        if (config.block === undefined) {
          throw createError(
            "PARSE_ERROR",
            "A selected iOS configuration has no buildSettings block.",
            path,
            {
              configurationId: id,
              configuration: config.name,
              source: config.base ? "xcconfig" : "pbxproj",
            },
          );
        }
        selected.add(config.block);
      }

      const configName = selection.configuration ?? "undefined";
      if (matches === 0) {
        throw createError(
          "NOT_FOUND",
          `Could not find iOS configuration ${configName} for target ${target.name}.`,
          path,
          targetDetails(),
        );
      }
      if (matches > 1 && selection.configuration !== undefined) {
        throw createError(
          "AMBIGUOUS",
          `Target ${target.name} has multiple configurations named ${configName}.`,
          path,
          targetDetails(),
        );
      }
    }

    return [...selected].sort((a, b) => a - b);
  }
}

function parseGraph(
  lex: LexedSource,
  pairs: Map<number, number>,
  blocks: Block[],
  path: string,
): PbxGraph {
  const targets: PbxObject[] = [];
  const configs = new Map<string, PbxObject>();
  const lists = new Map<string, string[]>();

  const objectPattern = /^[ \t]*([A-Za-z0-9]{4,32})[ \t]*=[ \t]*\{/gm;
  const propertyPattern =
    /\b(isa|name|buildConfigurationList|baseConfigurationReference)[ \t]*=/g;
  const buildConfigsPattern = /\bbuildConfigurations[ \t]*=[ \t]*\(([^)]*)\);/;
  const idPattern = /\b[A-Za-z0-9]{4,32}\b/g;

  for (const cap of lex.structure.matchAll(objectPattern)) {
    const open = cap.index + cap[0].length - 1;
    const end = closingBrace(
      pairs,
      open,
      "An iOS object block is not balanced.",
      path,
    );

    const directParts: string[] = [];
    const structuralParts: string[] = [];
    let start = open + 1;
    while (true) {
      const pos = lex.structure.indexOf("{", start);
      if (pos === -1 || pos >= end) {
        break;
      }
      directParts.push(lex.comments.slice(start, pos), " ");
      structuralParts.push(lex.structure.slice(start, pos), " ");
      const nestedClose = pairs.get(pos);
      if (nestedClose === undefined) {
        throw createError(
          "PARSE_ERROR",
          "An iOS object block is not balanced.",
          path,
        );
      }
      start = nestedClose + 1;
    }
    directParts.push(lex.comments.slice(start, end));
    structuralParts.push(lex.structure.slice(start, end));

    const direct = directParts.join("");
    const structural = structuralParts.join("");

    const obj: PbxObject = {
      id: cap[1]!,
      isa: "",
      name: "",
      list: "",
      ids: [],
      block: undefined,
      base: false,
    };

    for (const prop of structural.matchAll(propertyPattern)) {
      const propEnd = prop.index + prop[0].length;
      const semi = structural.indexOf(";", propEnd);
      if (semi === -1) {
        continue;
      }
      const value = decodePbxValue(direct.slice(propEnd, semi).trim());
      switch (prop[1]) {
        case "isa":
          obj.isa = value;
          break;
        case "name":
          obj.name = value;
          break;
        case "buildConfigurationList":
          obj.list = value;
          break;
        default:
          obj.base = true;
          break;
      }
    }

    if (obj.isa === "XCConfigurationList") {
      const listMatch = buildConfigsPattern.exec(structural);
      const ids = listMatch
        ? Array.from(listMatch[1]!.matchAll(idPattern), (m) => m[0])
        : [];
      lists.set(obj.id, ids);
    } else if (obj.isa === "PBXNativeTarget") {
      targets.push(obj);
    } else if (obj.isa === "XCBuildConfiguration") {
      const first = partitionPoint(blocks, (b) => b.open <= open);
      const last = partitionPoint(blocks, (b) => b.open < end);
      if (last > first + 1) {
        throw createError(
          "AMBIGUOUS",
          "An XCBuildConfiguration contains multiple buildSettings blocks.",
          path,
          { objectId: obj.id },
        );
      }
      if (first < last) {
        const block = blocks[first]!;
        block.id = obj.id;
        block.name = obj.name;
        block.base = obj.base;
        obj.block = first;
      }
      configs.set(obj.id, obj);
    }
  }

  for (const target of targets) {
    if (target.name.length === 0 || target.list.length === 0) {
      throw createError(
        "PARSE_ERROR",
        "A PBXNativeTarget is missing its name or build configuration list.",
        path,
        { targetId: target.id },
      );
    }
    const ids = lists.get(target.list);
    if (ids === undefined) {
      throw createError(
        "PARSE_ERROR",
        "An iOS target references an unknown configuration list.",
        path,
        { target: target.name, configurationList: target.list },
      );
    }
    target.ids = ids;
    for (const id of target.ids) {
      const blockIndex = configs.get(id)?.block;
      if (
        blockIndex !== undefined &&
        !blocks[blockIndex]!.targets.includes(target.name)
      ) {
        blocks[blockIndex]!.targets.push(target.name);
      }
    }
  }

  return new PbxGraph(configs, targets);
}

export function analyzeIos(
  text: string,
  path: string,
  selection: Selection,
): Source {
  const lex = lexSource(text, false);
  const pairs = matchBraces(lex.structure);

  const blocks: Block[] = [];
  for (const match of lex.structure.matchAll(/\bbuildSettings[ \t]*=[ \t]*\{/g)) {
    const open = match.index + match[0].length - 1;
    blocks.push({
      open,
      close: closingBrace(
        pairs,
        open,
        "An iOS buildSettings block is not balanced.",
        path,
      ),
      id: "",
      name: "",
      targets: [],
      base: false,
    });
  }

  const graph = parseGraph(lex, pairs, blocks, path);

  const fields: Assignment[] = [];
  let scan = 0;
  let line = 1;
  const assignmentPattern =
    /^[ \t]*(CURRENT_PROJECT_VERSION|MARKETING_VERSION)[ \t]*=[ \t]*([^;\r\n]*);/gm;

  for (const match of lex.comments.matchAll(assignmentPattern)) {
    const fieldName = match[1] as
      | "CURRENT_PROJECT_VERSION"
      | "MARKETING_VERSION";
    const fieldOffset = match[0].indexOf(fieldName);
    const pos = match.index + fieldOffset;
    if (!lex.structure.startsWith(fieldName, pos)) {
      continue;
    }

    line += countNewlines(text, scan, pos);
    scan = pos;

    const rhsRaw = match[2]!;
    const rhsStart = match.index + match[0].length - 1 - rhsRaw.length;
    const leadingWs = rhsRaw.length - rhsRaw.trimStart().length;
    const expr = rhsRaw.trim();
    const isQuoted =
      expr.length >= 2 && expr.startsWith('"') && expr.endsWith('"');
    const value = isQuoted ? expr.slice(1, -1) : expr;
    const valueStart = rhsStart + leadingWs + (isQuoted ? 1 : 0);

    const candidateIndex = partitionPoint(blocks, (b) => b.open < pos) - 1;
    const block =
      candidateIndex >= 0 && pos < blocks[candidateIndex]!.close
        ? candidateIndex
        : undefined;

    fields.push({
      field: fieldName,
      expr,
      value,
      span: { start: valueStart, end: valueStart + value.length },
      block,
      line,
    });
  }

  const formatCandidates = (items: readonly Assignment[]) => ({
    candidates: items.map((item) => assignmentDetail(item, blocks)),
  });

  const outside = fields.filter((item) => item.block === undefined);
  if (outside.length > 0) {
    throw createError(
      "AMBIGUOUS",
      "iOS version assignments outside buildSettings are not supported.",
      path,
      formatCandidates(outside),
    );
  }

  const activeBlocks = new Set<number>();
  for (const item of fields) {
    if (item.block !== undefined) {
      activeBlocks.add(item.block);
    }
  }
  const selected = graph.select(selection, activeBlocks, path);

  if (selected.length === 0) {
    if (lex.structure.includes("baseConfigurationReference")) {
      throw createError(
        "PARSE_ERROR",
        "No literal iOS versions were found; the project references an .xcconfig source.",
        path,
        { source: "xcconfig" },
      );
    }
    throw createError(
      "PARSE_ERROR",
      "Could not find iOS version assignments inside buildSettings.",
      path,
    );
  }

  const groups = new Map<number, Assignment[]>();
  for (const item of fields) {
    const blockIndex = item.block!;
    const list = groups.get(blockIndex);
    if (list) {
      list.push(item);
    } else {
      groups.set(blockIndex, [item]);
    }
  }

  const picked: Assignment[] = [];
  for (const index of selected) {
    const group = groups.get(index) ?? [];
    if (group.length !== 2 || group[0]!.field === group[1]!.field) {
      const data = blockMetadata(blocks[index]!);
      if (group.length === 0 && blocks[index]!.base) {
        data.source = "xcconfig";
        throw createError(
          "PARSE_ERROR",
          "No literal iOS versions were found in the selected configuration; it references an .xcconfig source.",
          path,
          data,
        );
      }
      data.buildSettings = index + 1;
      data.candidates = formatCandidates(group).candidates;
      throw createError(
        "AMBIGUOUS",
        "Each supported buildSettings block must contain exactly one paired iOS version.",
        path,
        data,
      );
    }
    picked.push(...group);
  }

  const indirect = picked.filter((item) => {
    const parts = item.value.split(".");
    return parts.length > 3 || !parts.every(isAsciiDigits);
  });
  if (indirect.length > 0) {
    throw createError(
      "PARSE_ERROR",
      "iOS versions must be direct numeric literals, not variables or inherited values.",
      path,
      formatCandidates(indirect),
    );
  }

  const builds = picked
    .filter((item) => item.field === "CURRENT_PROJECT_VERSION")
    .map((item) => item.span);
  const marketing = picked
    .filter((item) => item.field === "MARKETING_VERSION")
    .map((item) => item.span);

  const current = {
    build: text.slice(builds[0]!.start, builds[0]!.end),
    marketing: text.slice(marketing[0]!.start, marketing[0]!.end),
  };

  const hasDivergence =
    builds.some((r) => text.slice(r.start, r.end) !== current.build) ||
    marketing.some((r) => text.slice(r.start, r.end) !== current.marketing);
  if (hasDivergence) {
    throw createError(
      "AMBIGUOUS",
      "Divergent iOS versions were found across buildSettings blocks.",
      path,
      formatCandidates(picked),
    );
  }

  try {
    parsePositiveBuild(current.build, "CURRENT_PROJECT_VERSION");
    validateSemanticVersion(current.marketing, "iOS");
  } catch {
    throw createError(
      "PARSE_ERROR",
      "The iOS project contains an unsupported version literal.",
      path,
    );
  }

  return {
    current,
    builds,
    marketing,
  };
}
