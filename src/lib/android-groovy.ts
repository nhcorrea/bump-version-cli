import { AndroidSyntaxAdapter } from "./android-syntax";

export const androidGroovyAdapter: AndroidSyntaxAdapter = {
  kind: "groovy",
  versionCodePattern: () =>
    /^([ \t]*versionCode(?:[ \t]*=[ \t]*|[ \t]+))(\d+)([ \t]*;?[ \t]*)\r?$/gm,
  versionNamePattern: () =>
    /^([ \t]*versionName(?:[ \t]*=[ \t]*|[ \t]+))(["'])([^"'\r\n]+)\2([ \t]*;?[ \t]*)\r?$/gm,
};
