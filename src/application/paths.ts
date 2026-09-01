import * as fs from "fs";
import { isAbsolute, relative, resolve, sep } from "path";
import { BumpVersionError } from "../lib/errors";

function isInside(root: string, target: string): boolean {
  const relation = relative(root, target);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== "..");
}

export function resolveProjectRoot(cwd: string, rootOption?: string): string {
  const candidate = resolve(cwd, rootOption ?? ".");

  try {
    const root = fs.realpathSync(candidate);

    if (!fs.statSync(root).isDirectory()) {
      throw new Error("Project root is not a directory.");
    }

    return root;
  } catch (error) {
    throw new BumpVersionError(
      "NOT_FOUND",
      "Could not resolve the project root.",
      candidate,
      error
    );
  }
}

export function resolveConfinedFile(root: string, candidate: string): string {
  const lexicalPath = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);

  if (!isInside(root, lexicalPath)) {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      "The selected file must be inside the project root.",
      lexicalPath
    );
  }

  let realPath: string;

  try {
    realPath = fs.realpathSync(lexicalPath);
  } catch (error) {
    throw new BumpVersionError(
      "NOT_FOUND",
      "Could not find the selected project file.",
      lexicalPath,
      error
    );
  }

  if (!isInside(root, realPath)) {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      "The selected file resolves outside the project root.",
      lexicalPath
    );
  }

  if (!fs.statSync(realPath).isFile()) {
    throw new BumpVersionError(
      "NOT_FOUND",
      "The selected path is not a regular file.",
      realPath
    );
  }

  return realPath;
}

export function resolveAndroidFile(options: {
  root: string;
  androidFile?: string;
  androidModule?: string;
}): string {
  if (options.androidFile) {
    return resolveConfinedFile(options.root, options.androidFile);
  }

  const moduleName = options.androidModule ?? "app";
  const candidates = [
    `android/${moduleName}/build.gradle.kts`,
    `android/${moduleName}/build.gradle`,
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(resolve(options.root, candidate))) {
      return resolveConfinedFile(options.root, candidate);
    }
  }

  throw new BumpVersionError(
    "NOT_FOUND",
    `Could not find build.gradle.kts or build.gradle for Android module ${moduleName}.`,
    resolve(options.root, "android", moduleName)
  );
}

export function resolveIOSFile(options: {
  root: string;
  iosProject?: string;
}): string {
  if (options.iosProject) {
    const value = options.iosProject;
    const hasDirectory = value.includes("/") || value.includes("\\");
    const candidate = value.endsWith("project.pbxproj")
      ? value
      : value.endsWith(".xcodeproj")
      ? hasDirectory
        ? `${value}/project.pbxproj`
        : `ios/${value}/project.pbxproj`
      : hasDirectory
      ? value
      : `ios/${value}.xcodeproj/project.pbxproj`;

    return resolveConfinedFile(options.root, candidate);
  }

  const iosDirectory = resolve(options.root, "ios");
  let projects: string[];

  try {
    projects = fs
      .readdirSync(iosDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(".xcodeproj"))
      .map((entry) => entry.name);
  } catch (error) {
    throw new BumpVersionError(
      "NOT_FOUND",
      "Could not inspect the iOS directory.",
      iosDirectory,
      error
    );
  }

  if (projects.length === 0) {
    throw new BumpVersionError(
      "NOT_FOUND",
      "No iOS .xcodeproj was found.",
      iosDirectory
    );
  }

  if (projects.length > 1) {
    throw new BumpVersionError(
      "AMBIGUOUS",
      `Multiple iOS projects were found: ${projects.sort().join(", ")}. Use --ios-project.`,
      iosDirectory
    );
  }

  return resolveConfinedFile(
    options.root,
    `ios/${projects[0]}/project.pbxproj`
  );
}

export function portableRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}
