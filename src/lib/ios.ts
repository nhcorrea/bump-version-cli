import * as fs from "fs";
import { IOSConfig } from "../types/types";
import { BumpVersionError } from "./errors";
import {
  validatePositiveBuildVersion,
  validateSemanticVersion,
} from "../core/version";
import {
  AppliedChange,
  buildChangePlan,
  ChangePlan,
} from "../core/change-plan";
import { commitChangePlan } from "./safe-write";

type IOSVersionField = "CURRENT_PROJECT_VERSION" | "MARKETING_VERSION";

export interface IOSSelectionOptions {
  target?: string;
  configuration?: string;
  allTargets?: boolean;
}

interface BuildSettingsBlock {
  index: number;
  open: number;
  close: number;
  objectId?: string;
  configuration?: string;
  targets?: string[];
  hasBaseConfiguration?: boolean;
}

interface PBXObjectBlock {
  id: string;
  open: number;
  close: number;
  isa: string;
  name?: string;
  buildConfigurationList?: string;
  buildConfigurationIds: string[];
  buildSettings?: BuildSettingsBlock;
  hasBaseConfiguration: boolean;
}

interface IOSProjectTarget {
  id: string;
  name: string;
  configurationIds: string[];
}

interface IOSProjectGraph {
  configurations: Map<string, PBXObjectBlock>;
  targets: IOSProjectTarget[];
}

interface IOSAssignment {
  field: IOSVersionField;
  fieldStart: number;
  valueStart: number;
  valueEnd: number;
  value: string;
  expression: string;
  line: number;
  block: number | undefined;
  direct: boolean;
}

interface IOSSourceAnalysis {
  config: IOSConfig;
  buildAssignments: IOSAssignment[];
  marketingAssignments: IOSAssignment[];
}

function findClosingBrace(
  structuralSource: string,
  open: number,
  path: string,
  label: string
): number {
  let depth = 0;

  for (let index = open; index < structuralSource.length; index += 1) {
    if (structuralSource[index] === "{") {
      depth += 1;
    } else if (structuralSource[index] === "}") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  throw new BumpVersionError(
    "PARSE_ERROR",
    `An iOS ${label} block is not balanced.`,
    path
  );
}

function maskPBXLexicalContent(source: string, maskStrings: boolean): string {
  const result = source.split("");
  let state: "code" | "line-comment" | "block-comment" | "string" =
    "code";
  let index = 0;

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

      if (source[index] === "\\" && index + 1 < source.length) {
        if (maskStrings) {
          mask(index + 1);
        }
        index += 2;
      } else if (source[index] === '"') {
        state = "code";
        index += 1;
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

    if (source[index] === '"') {
      if (maskStrings) {
        mask(index);
      }
      index += 1;
      state = "string";
      continue;
    }

    index += 1;
  }

  return result.join("");
}

function collectBuildSettingsBlocks(
  structuralSource: string,
  path: string
): BuildSettingsBlock[] {
  const blocks: BuildSettingsBlock[] = [];

  for (const match of structuralSource.matchAll(/\bbuildSettings[ \t]*=[ \t]*\{/g)) {
    const open = match.index! + match[0].lastIndexOf("{");
    const close = findClosingBrace(
      structuralSource,
      open,
      path,
      "buildSettings"
    );

    blocks.push({ index: blocks.length + 1, open, close });
  }

  return blocks;
}

function directObjectContent(
  commentMasked: string,
  structuralSource: string,
  open: number,
  close: number
): string {
  const result: string[] = [];
  let depth = 1;

  for (let index = open + 1; index < close; index += 1) {
    const structuralCharacter = structuralSource[index];

    if (structuralCharacter === "{") {
      depth += 1;
      result.push(" ");
      continue;
    }

    if (structuralCharacter === "}") {
      depth -= 1;
      result.push(" ");
      continue;
    }

    const sourceCharacter = commentMasked[index];
    result.push(
      depth === 1 || sourceCharacter === "\r" || sourceCharacter === "\n"
        ? sourceCharacter
        : " "
    );
  }

  return result.join("");
}

function decodePBXScalar(value: string): string {
  const trimmed = value.trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

function scalarProperty(source: string, property: string): string | undefined {
  const match = new RegExp(`\\b${property}[ \\t]*=[ \\t]*([^;\\r\\n]+);`).exec(
    source
  );
  return match ? decodePBXScalar(match[1]) : undefined;
}

function collectPBXObjects(
  commentMasked: string,
  structuralSource: string,
  blocks: BuildSettingsBlock[],
  path: string
): PBXObjectBlock[] {
  const objects: PBXObjectBlock[] = [];

  for (const match of structuralSource.matchAll(
    /^[ \t]*([A-Za-z0-9]{4,32})[ \t]*=[ \t]*\{/gm
  )) {
    const id = match[1];
    const open = match.index! + match[0].lastIndexOf("{");
    const close = findClosingBrace(structuralSource, open, path, "object");
    const direct = directObjectContent(
      commentMasked,
      structuralSource,
      open,
      close
    );
    const isa = scalarProperty(direct, "isa");

    if (!isa) {
      continue;
    }

    const configurationList = /\bbuildConfigurations[ \t]*=[ \t]*\(([\s\S]*?)\);/.exec(
      direct
    );
    const buildConfigurationIds = configurationList
      ? Array.from(
          configurationList[1].matchAll(/\b[A-Za-z0-9]{4,32}\b/g),
          ([configurationId]) => configurationId
        )
      : [];
    const containingBuildSettings = blocks.filter(
      (block) => block.open > open && block.close < close
    );

    if (containingBuildSettings.length > 1) {
      throw new BumpVersionError(
        "AMBIGUOUS",
        "An XCBuildConfiguration contains multiple buildSettings blocks.",
        path,
        undefined,
        { objectId: id }
      );
    }

    objects.push({
      id,
      open,
      close,
      isa,
      name: scalarProperty(direct, "name"),
      buildConfigurationList: scalarProperty(
        direct,
        "buildConfigurationList"
      )?.split(/[ \t]/, 1)[0],
      buildConfigurationIds,
      buildSettings: containingBuildSettings[0],
      hasBaseConfiguration: /\bbaseConfigurationReference[ \t]*=/.test(
        direct
      ),
    });
  }

  return objects;
}

function buildIOSProjectGraph(
  objects: PBXObjectBlock[],
  path: string
): IOSProjectGraph {
  const configurations = new Map(
    objects
      .filter(({ isa }) => isa === "XCBuildConfiguration")
      .map((object) => [object.id, object])
  );
  const configurationLists = new Map(
    objects
      .filter(({ isa }) => isa === "XCConfigurationList")
      .map((object) => [object.id, object.buildConfigurationIds])
  );
  const targets = objects
    .filter(({ isa }) => isa === "PBXNativeTarget")
    .map((object) => {
      if (!object.name || !object.buildConfigurationList) {
        throw new BumpVersionError(
          "PARSE_ERROR",
          "A PBXNativeTarget is missing its name or build configuration list.",
          path,
          undefined,
          { targetId: object.id }
        );
      }

      const configurationIds = configurationLists.get(
        object.buildConfigurationList
      );

      if (!configurationIds) {
        throw new BumpVersionError(
          "PARSE_ERROR",
          "An iOS target references an unknown configuration list.",
          path,
          undefined,
          {
            target: object.name,
            configurationList: object.buildConfigurationList,
          }
        );
      }

      return {
        id: object.id,
        name: object.name,
        configurationIds,
      };
    });

  for (const configuration of configurations.values()) {
    if (configuration.buildSettings) {
      configuration.buildSettings.objectId = configuration.id;
      configuration.buildSettings.configuration = configuration.name;
      configuration.buildSettings.hasBaseConfiguration =
        configuration.hasBaseConfiguration;
    }
  }

  for (const target of targets) {
    for (const configurationId of target.configurationIds) {
      const configuration = configurations.get(configurationId);

      if (configuration?.buildSettings) {
        configuration.buildSettings.targets = [
          ...new Set([
            ...(configuration.buildSettings.targets ?? []),
            target.name,
          ]),
        ];
      }
    }
  }

  return { configurations, targets };
}

function targetDetails(graph: IOSProjectGraph) {
  return graph.targets.map((target) => ({
    name: target.name,
    configurations: target.configurationIds.map(
      (configurationId) =>
        graph.configurations.get(configurationId)?.name ?? configurationId
    ),
  }));
}

function selectBuildSettingsBlocks(
  graph: IOSProjectGraph,
  activeBlocks: BuildSettingsBlock[],
  selection: IOSSelectionOptions,
  path: string
): BuildSettingsBlock[] {
  if (selection.target && selection.allTargets) {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      "--ios-target and --all-targets cannot be used together.",
      "--ios-target"
    );
  }

  const hasExplicitSelection = Boolean(
    selection.target || selection.configuration || selection.allTargets
  );

  if (graph.targets.length === 0) {
    if (hasExplicitSelection) {
      throw new BumpVersionError(
        "PARSE_ERROR",
        "Explicit iOS target/configuration selection requires PBXNativeTarget metadata.",
        path
      );
    }

    return activeBlocks;
  }

  let selectedTargets: IOSProjectTarget[];

  if (selection.target) {
    selectedTargets = graph.targets.filter(
      ({ name }) => name === selection.target
    );

    if (selectedTargets.length === 0) {
      throw new BumpVersionError(
        "NOT_FOUND",
        `Could not find iOS target ${selection.target}.`,
        path,
        undefined,
        { targets: targetDetails(graph) }
      );
    }

    if (selectedTargets.length > 1) {
      throw new BumpVersionError(
        "AMBIGUOUS",
        `Multiple iOS targets are named ${selection.target}.`,
        path,
        undefined,
        { targets: targetDetails(graph) }
      );
    }
  } else if (selection.allTargets) {
    selectedTargets = graph.targets;
  } else {
    if (graph.targets.length > 1) {
      throw new BumpVersionError(
        "AMBIGUOUS",
        "Multiple iOS targets were found; use --ios-target or --all-targets.",
        path,
        undefined,
        { targets: targetDetails(graph) }
      );
    }

    selectedTargets = graph.targets;
  }

  const selectedConfigurations: PBXObjectBlock[] = [];

  for (const target of selectedTargets) {
    const targetConfigurations = target.configurationIds.map(
      (configurationId) => {
        const configuration = graph.configurations.get(configurationId);

        if (!configuration) {
          throw new BumpVersionError(
            "PARSE_ERROR",
            "An iOS target references an unknown build configuration.",
            path,
            undefined,
            { target: target.name, configurationId }
          );
        }

        return configuration;
      }
    );
    const matchingConfigurations = selection.configuration
      ? targetConfigurations.filter(
          ({ name }) => name === selection.configuration
        )
      : targetConfigurations;

    if (matchingConfigurations.length === 0) {
      throw new BumpVersionError(
        "NOT_FOUND",
        `Could not find iOS configuration ${selection.configuration} for target ${target.name}.`,
        path,
        undefined,
        { targets: targetDetails(graph) }
      );
    }

    if (selection.configuration && matchingConfigurations.length > 1) {
      throw new BumpVersionError(
        "AMBIGUOUS",
        `Target ${target.name} has multiple configurations named ${selection.configuration}.`,
        path,
        undefined,
        { targets: targetDetails(graph) }
      );
    }

    selectedConfigurations.push(...matchingConfigurations);
  }

  const uniqueConfigurations = [
    ...new Map(
      selectedConfigurations.map((configuration) => [
        configuration.id,
        configuration,
      ])
    ).values(),
  ];

  return uniqueConfigurations.map((configuration) => {
    if (!configuration.buildSettings) {
      throw new BumpVersionError(
        "PARSE_ERROR",
        "A selected iOS configuration has no buildSettings block.",
        path,
        undefined,
        {
          configurationId: configuration.id,
          configuration: configuration.name,
          source: configuration.hasBaseConfiguration ? "xcconfig" : "pbxproj",
        }
      );
    }

    return configuration.buildSettings;
  });
}

function blockForPosition(
  position: number,
  blocks: BuildSettingsBlock[]
): BuildSettingsBlock | undefined {
  return blocks.find(({ open, close }) => position > open && position < close);
}

function parseLiteralExpression(expression: string): {
  value: string;
  offset: number;
  direct: boolean;
} {
  const leading = expression.length - expression.trimStart().length;
  const trimmed = expression.trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    const value = trimmed.slice(1, -1);
    return {
      value,
      offset: leading + 1,
      direct: /^[0-9]+(?:\.[0-9]+){0,2}$/.test(value),
    };
  }

  return {
    value: trimmed,
    offset: leading,
    direct: /^[0-9]+(?:\.[0-9]+){0,2}$/.test(trimmed),
  };
}

function collectAssignments(
  commentMasked: string,
  structuralSource: string,
  blocks: BuildSettingsBlock[]
): IOSAssignment[] {
  return Array.from(
    commentMasked.matchAll(
      /^([ \t]*(CURRENT_PROJECT_VERSION|MARKETING_VERSION)[ \t]*=[ \t]*)([^;\r\n]*)([ \t]*;)/gm
    )
  )
    .map((match) => {
      const field = match[2] as IOSVersionField;
      const fieldStart = match.index! + match[0].indexOf(field);

      if (structuralSource.slice(fieldStart, fieldStart + field.length) !== field) {
        return undefined;
      }

      const literal = parseLiteralExpression(match[3]);
      const valueStart = match.index! + match[1].length + literal.offset;
      const block = blockForPosition(fieldStart, blocks);

      return {
        field,
        fieldStart,
        valueStart,
        valueEnd: valueStart + literal.value.length,
        value: literal.value,
        expression: match[3].trim(),
        line: commentMasked.slice(0, fieldStart).split(/\r?\n/).length,
        block: block?.index,
        direct: literal.direct,
      };
    })
    .filter((assignment): assignment is IOSAssignment => assignment !== undefined);
}

function candidateDetails(
  assignments: IOSAssignment[],
  blocks: BuildSettingsBlock[]
) {
  return assignments.map(({ field, value, expression, line, block }) => {
    const buildSettings = blocks.find(({ index }) => index === block);

    return {
      field,
      value,
      expression,
      line,
      ...(block ? { buildSettings: block } : { buildSettings: null }),
      ...(buildSettings?.objectId
        ? { configurationId: buildSettings.objectId }
        : {}),
      ...(buildSettings?.configuration
        ? { configuration: buildSettings.configuration }
        : {}),
      ...(buildSettings?.targets
        ? { targets: buildSettings.targets }
        : {}),
    };
  });
}

function analyzeIOSConfig(
  file: string,
  path: string,
  selection: IOSSelectionOptions = {}
): IOSSourceAnalysis {
  const commentMasked = maskPBXLexicalContent(file, false);
  const structuralSource = maskPBXLexicalContent(file, true);
  const blocks = collectBuildSettingsBlocks(structuralSource, path);
  const assignments = collectAssignments(commentMasked, structuralSource, blocks);
  const objects = collectPBXObjects(
    commentMasked,
    structuralSource,
    blocks,
    path
  );
  const graph = buildIOSProjectGraph(objects, path);
  const outside = assignments.filter(({ block }) => block === undefined);

  if (outside.length > 0) {
    throw new BumpVersionError(
      "AMBIGUOUS",
      "iOS version assignments outside buildSettings are not supported.",
      path,
      undefined,
      { candidates: candidateDetails(outside, blocks) }
    );
  }

  const activeBlocks = blocks.filter((block) =>
    assignments.some(({ block: assignmentBlock }) => assignmentBlock === block.index)
  );
  const selectedBlocks = selectBuildSettingsBlocks(
    graph,
    activeBlocks,
    selection,
    path
  );

  if (selectedBlocks.length === 0) {
    const hasXCConfig = /\bbaseConfigurationReference\b/.test(structuralSource);
    throw new BumpVersionError(
      "PARSE_ERROR",
      hasXCConfig
        ? "No literal iOS versions were found; the project references an .xcconfig source."
        : "Could not find iOS version assignments inside buildSettings.",
      path,
      undefined,
      hasXCConfig ? { source: "xcconfig" } : undefined
    );
  }

  for (const block of selectedBlocks) {
    const blockAssignments = assignments.filter(
      ({ block: assignmentBlock }) => assignmentBlock === block.index
    );
    const buildCount = blockAssignments.filter(
      ({ field }) => field === "CURRENT_PROJECT_VERSION"
    ).length;
    const marketingCount = blockAssignments.filter(
      ({ field }) => field === "MARKETING_VERSION"
    ).length;

    if (buildCount !== 1 || marketingCount !== 1) {
      if (
        buildCount === 0 &&
        marketingCount === 0 &&
        block.hasBaseConfiguration
      ) {
        throw new BumpVersionError(
          "PARSE_ERROR",
          "No literal iOS versions were found in the selected configuration; it references an .xcconfig source.",
          path,
          undefined,
          {
            source: "xcconfig",
            ...(block.objectId ? { configurationId: block.objectId } : {}),
            ...(block.configuration
              ? { configuration: block.configuration }
              : {}),
            ...(block.targets ? { targets: block.targets } : {}),
          }
        );
      }

      throw new BumpVersionError(
        "AMBIGUOUS",
        "Each supported buildSettings block must contain exactly one paired iOS version.",
        path,
        undefined,
        {
          buildSettings: block.index,
          ...(block.objectId ? { configurationId: block.objectId } : {}),
          ...(block.configuration
            ? { configuration: block.configuration }
            : {}),
          ...(block.targets ? { targets: block.targets } : {}),
          candidates: candidateDetails(blockAssignments, blocks),
        }
      );
    }
  }

  const selectedBlockIndexes = new Set(
    selectedBlocks.map(({ index }) => index)
  );
  const selectedAssignments = assignments.filter(({ block }) =>
    block ? selectedBlockIndexes.has(block) : false
  );
  const indirect = selectedAssignments.filter(({ direct }) => !direct);

  if (indirect.length > 0) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      "iOS versions must be direct numeric literals, not variables or inherited values.",
      path,
      undefined,
      { candidates: candidateDetails(indirect, blocks) }
    );
  }

  const buildAssignments = selectedAssignments.filter(
    ({ field }) => field === "CURRENT_PROJECT_VERSION"
  );
  const marketingAssignments = selectedAssignments.filter(
    ({ field }) => field === "MARKETING_VERSION"
  );
  const buildValues = new Set(buildAssignments.map(({ value }) => value));
  const marketingValues = new Set(marketingAssignments.map(({ value }) => value));

  if (buildValues.size !== 1 || marketingValues.size !== 1) {
    throw new BumpVersionError(
      "AMBIGUOUS",
      "Divergent iOS versions were found across buildSettings blocks.",
      path,
      undefined,
      { candidates: candidateDetails(selectedAssignments, blocks) }
    );
  }

  const buildVersion = buildAssignments[0].value;
  const marketingVersion = marketingAssignments[0].value;

  try {
    validatePositiveBuildVersion(buildVersion, "CURRENT_PROJECT_VERSION");
    validateSemanticVersion(marketingVersion, "iOS");
  } catch (error) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      "The iOS project contains an unsupported version literal.",
      path,
      error
    );
  }

  return {
    config: {
      CURRENT_PROJECT_VERSION: buildVersion,
      MARKETING_VERSION: marketingVersion,
    },
    buildAssignments,
    marketingAssignments,
  };
}

export function parseIOSConfig(
  file: string,
  path: string,
  selection: IOSSelectionOptions = {}
): IOSConfig {
  return analyzeIOSConfig(file, path, selection).config;
}

function readIOSFile(path: string): string {
  try {
    return fs.readFileSync(path, "utf8");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error && error.code === "ENOENT"
        ? "NOT_FOUND"
        : "PARSE_ERROR";

    throw new BumpVersionError(
      code,
      "Could not read the iOS project.pbxproj file.",
      path,
      error
    );
  }
}

export function readIOSConfig(
  path: string,
  selection: IOSSelectionOptions = {}
): IOSConfig {
  return parseIOSConfig(readIOSFile(path), path, selection);
}

export function transformIOSConfig(
  file: string,
  path: string,
  newBuildVersion: string,
  newMarketingVersion: string,
  selection: IOSSelectionOptions = {}
): string {
  const analysis = analyzeIOSConfig(file, path, selection);
  const normalizedBuildVersion = validatePositiveBuildVersion(
    newBuildVersion,
    "CURRENT_PROJECT_VERSION"
  );
  validateSemanticVersion(newMarketingVersion, "iOS");
  const replacements = [
    ...analysis.buildAssignments.map((assignment) => ({
      assignment,
      value: normalizedBuildVersion,
    })),
    ...analysis.marketingAssignments.map((assignment) => ({
      assignment,
      value: newMarketingVersion,
    })),
  ].sort((left, right) => right.assignment.valueStart - left.assignment.valueStart);
  let transformed = file;

  for (const { assignment, value } of replacements) {
    transformed =
      transformed.slice(0, assignment.valueStart) +
      value +
      transformed.slice(assignment.valueEnd);
  }

  const result = parseIOSConfig(transformed, path, selection);

  if (
    result.CURRENT_PROJECT_VERSION !== normalizedBuildVersion ||
    result.MARKETING_VERSION !== newMarketingVersion
  ) {
    throw new BumpVersionError(
      "VERIFY_ERROR",
      "The transformed iOS version does not match the requested values.",
      path
    );
  }

  return transformed;
}

export function createIOSChangePlan(
  path: string,
  newBuildVersion: string,
  newMarketingVersion: string,
  selection: IOSSelectionOptions = {}
): ChangePlan<IOSConfig> {
  const normalizedBuildVersion = validatePositiveBuildVersion(
    newBuildVersion,
    "CURRENT_PROJECT_VERSION"
  );
  validateSemanticVersion(newMarketingVersion, "iOS");
  const file = readIOSFile(path);
  const analysis = analyzeIOSConfig(file, path, selection);
  const transformed = transformIOSConfig(
    file,
    path,
    normalizedBuildVersion,
    newMarketingVersion,
    selection
  );
  const afterAnalysis = analyzeIOSConfig(transformed, path, selection);

  return buildChangePlan({
    platform: "ios",
    path,
    before: analysis.config,
    after: afterAnalysis.config,
    beforeContent: file,
    afterContent: transformed,
    buildMatches: analysis.buildAssignments.length,
    marketingMatches: analysis.marketingAssignments.length,
  });
}

export function applyIOSChangePlan(
  plan: ChangePlan<IOSConfig>,
  selection: IOSSelectionOptions = {}
): AppliedChange<IOSConfig> {
  if (plan.platform !== "ios") {
    throw new BumpVersionError(
      "VERIFY_ERROR",
      "Cannot apply a non-iOS plan with the iOS adapter.",
      plan.path
    );
  }

  const applied = commitChangePlan(plan, (content, path) =>
    parseIOSConfig(content, path, selection)
  );

  if (
    applied.config.CURRENT_PROJECT_VERSION !==
      plan.after.CURRENT_PROJECT_VERSION ||
    applied.config.MARKETING_VERSION !== plan.after.MARKETING_VERSION
  ) {
    throw new BumpVersionError(
      "VERIFY_ERROR",
      "The committed iOS values do not match the plan.",
      plan.path
    );
  }

  return applied;
}

export function writeNewIOSVersion(
  path: string,
  newBuildVersion: string,
  newMarketingVersion: string,
  selection: IOSSelectionOptions = {}
): AppliedChange<IOSConfig> {
  return applyIOSChangePlan(
    createIOSChangePlan(
      path,
      newBuildVersion,
      newMarketingVersion,
      selection
    ),
    selection
  );
}
