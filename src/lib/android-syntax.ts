export interface AndroidSyntaxAdapter {
  kind: "groovy" | "kotlin";
  versionCodePattern: () => RegExp;
  versionNamePattern: () => RegExp;
}
