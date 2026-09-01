import { AndroidSyntaxAdapter } from "./android-syntax";

export const androidKotlinAdapter: AndroidSyntaxAdapter = {
  kind: "kotlin",
  versionCodePattern: () =>
    /^([ \t]*versionCode[ \t]*=[ \t]*)(\d+)([ \t]*;?[ \t]*)\r?$/gm,
  versionNamePattern: () =>
    /^([ \t]*versionName[ \t]*=[ \t]*)(")([^"\r\n]+)\2([ \t]*;?[ \t]*)\r?$/gm,
};
