import type { Readable, Writable } from "node:stream";

export type Platform = "android" | "ios";

export type AutomationCommand = "inspect" | "set" | "bump" | "check";

export type ReleaseType = "major" | "minor" | "patch";

export type EntryKind = "missing" | "file" | "directory" | "other";

export interface Versions {
  build: string;
  marketing: string;
}

export interface Selection {
  target?: string;
  configuration?: string;
  allTargets: boolean;
}

export interface SelectionDocument {
  target?: string;
  configuration?: string;
  allTargets?: true;
}

export interface TextRange {
  start: number;
  end: number;
}

export interface Source {
  current: Versions;
  builds: TextRange[];
  marketing: TextRange[];
}

export interface MatchCounts {
  build: number;
  marketing: number;
  total: number;
}

export interface AndroidState {
  versionName: string;
  versionCode: number;
}

export interface IosState {
  marketingVersion: string;
  buildNumber: string;
}

export interface AutomationOptions {
  root?: string;
  platform?: string;
  androidFile?: string;
  androidModule?: string;
  iosProject?: string;
  iosTarget?: string;
  iosConfiguration?: string;
  allTargets?: boolean;
  config?: string;
  nonInteractive?: boolean;
  format?: string;
  outputFile?: string;
  quiet?: boolean;
  debug?: boolean;
  color?: boolean;
  appVersion?: string;
  versionName?: string;
  versionCode?: string;
  marketingVersion?: string;
  buildNumber?: string;
  release?: string;
  incrementBuild?: boolean;
  dryRun?: boolean;
  allowDowngrade?: boolean;
  version?: boolean;
}

export interface AndroidPlatformResult {
  path: string;
  before: AndroidState;
  after: AndroidState;
  matches: MatchCounts;
  changed: boolean;
}

export interface IosPlatformResult {
  path: string;
  selection?: SelectionDocument;
  before: IosState;
  after: IosState;
  matches: MatchCounts;
  changed: boolean;
}

export interface AutomationResult {
  command: AutomationCommand;
  changed: boolean;
  dryRun: boolean;
  root: string;
  platforms: {
    android?: AndroidPlatformResult;
    ios?: IosPlatformResult;
  };
  warnings: string[];
}

export interface LegacyReadRequest {
  platform: Platform;
  name?: string;
  cwd: string;
}

export interface LegacyUpdateRequest extends LegacyReadRequest {
  marketing: string;
  build: string;
  dryRun?: boolean;
  allowDowngrade?: boolean;
}

export interface LegacyPlanResult {
  platform: Platform;
  path: string;
  before: Versions;
  after: Versions;
  matches: MatchCounts;
  changed: boolean;
}

export interface Host {
  absolute(root: string, name: string): string;
  canonical(name: string): string;
  relative(name: string, root: string): string;
  parent(name: string): string;
  kind(name: string): EntryKind;
  directories(name: string): string[];
  read(name: string): string;
  stage(destination: string, contents: string): string;
  rename(from: string, to: string): void;
  remove(name: string): void;
}

export interface CliRuntime {
  cwd: () => string;
  input: Readable;
  output: Writable;
  log: (message?: string) => void;
  error: (message?: string) => void;
  setExitCode: (code: number) => void;
}

export function isExplicitSelection(selection: Selection): boolean {
  return (
    selection.target !== undefined ||
    selection.configuration !== undefined ||
    selection.allTargets
  );
}

export function selectionDocument(selection: Selection): SelectionDocument {
  const doc: SelectionDocument = {};
  if (selection.target !== undefined) {
    doc.target = selection.target;
  }
  if (selection.configuration !== undefined) {
    doc.configuration = selection.configuration;
  }
  if (selection.allTargets) {
    doc.allTargets = true;
  }
  return doc;
}
