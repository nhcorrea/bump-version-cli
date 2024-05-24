"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const readline = __importStar(require("readline"));
const fs = __importStar(require("fs"));
const commander_1 = require("commander");
const figlet = __importStar(require("figlet"));
const ANDROID_BUILD_GRADLE = "./android/app/build.gradle";
const ANDROID_ENCODE_OPTIONS = "utf8";
function readAndroidConfig() {
    try {
        const buildGradleFile = fs.readFileSync(ANDROID_BUILD_GRADLE, ANDROID_ENCODE_OPTIONS);
        const versionCodeMatch = buildGradleFile.match(/versionCode\s+(\d+)/);
        const versionNameMatch = buildGradleFile.match(/versionName\s+"([^"]+)"/);
        const versionCode = versionCodeMatch ? versionCodeMatch[1] : null;
        const versionName = versionNameMatch ? versionNameMatch[1] : null;
        return {
            versionCode,
            versionName,
        };
    }
    catch (e) {
        console.error("Erro ao ler build.gradle", e);
        return null;
    }
}
function writeNewAndroidVersion(newVersionCode, newVersionName) {
    try {
        let data = fs.readFileSync(ANDROID_BUILD_GRADLE, ANDROID_ENCODE_OPTIONS);
        data = data.replace(/versionCode\s+\d+/g, `versionCode ${newVersionCode}`);
        data = data.replace(/versionName\s+"[^"]+"/g, `versionName "${newVersionName}"`);
        fs.writeFileSync(ANDROID_BUILD_GRADLE, data, ANDROID_ENCODE_OPTIONS);
        console.log("Versão do Android atualizada com sucesso!");
    }
    catch (e) {
        console.error("Erro ao atualizar a versão do Android:", e);
    }
}
function headerCLI() {
    let prettyLog = figlet.textSync("bump-version-cli", {
        font: "Ogre",
        horizontalLayout: "full",
        verticalLayout: "default",
    });
    let prettyLogWithColor = `${colors.cyan}${prettyLog}${colors.reset}`;
    let versionWithColor = `${colors.bright}v0.0.1${colors.reset}`;
    console.log(`${prettyLogWithColor}${versionWithColor}`);
    console.log("\n\n");
    console.log(`${colors.bright}created by:${colors.reset} ${colors.yellow}https://github.com/nhcorrea${colors.reset}`);
}
function statusAndroidVersion(androidConfig) {
    const brightText = (text) => `${colors.black}${colors.bgWhite}${text}${colors.reset}`;
    const versionCodeStatus = brightText("Version Code (Build):");
    const versionNameStatus = brightText("Version Name (Marketing Version):");
    const versionCode = `${colors.black}${colors.bgCyan}        ${androidConfig.versionCode}        ${colors.reset}`;
    const versionName = `${colors.black}${colors.bgCyan} ${androidConfig.versionName} ${colors.reset}`;
    console.log(`\n${colors.black}${colors.bgGreen}           ANDROID VERSION            ${colors.reset}`);
    console.log(`${versionCodeStatus}${versionCode}`);
    console.log(`${versionNameStatus}${versionName}`);
}
const program = new commander_1.Command();
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    underscore: "\x1b[4m",
    blink: "\x1b[5m",
    reverse: "\x1b[7m",
    hidden: "\x1b[8m",
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    bgBlack: "\x1b[40m",
    bgRed: "\x1b[41m",
    bgGreen: "\x1b[42m",
    bgYellow: "\x1b[43m",
    bgBlue: "\x1b[44m",
    bgMagenta: "\x1b[45m",
    bgCyan: "\x1b[46m",
    bgWhite: "\x1b[47m",
};
program
    .command("android")
    .description("Atualiza a versão do aplicativo Android")
    .option("-v, --version", "Exibe a versão atual do Android")
    .action(() => {
    const androidConfig = readAndroidConfig();
    if (!androidConfig) {
        console.error("Erro ao ler build.gradle. Certifique-se de estar no diretório correto.");
        return;
    }
    console.clear();
    headerCLI();
    console.log("\n");
    statusAndroidVersion(androidConfig);
    console.log("\n\n");
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question(`${colors.bright}Digite o novo Version Code (atual: ${androidConfig.versionCode}): `, (newVersionCode) => {
        rl.question(`Digite o novo Version Name (atual: ${androidConfig.versionName}): `, (newVersionName) => {
            writeNewAndroidVersion(newVersionCode, newVersionName);
            const androidConfig = readAndroidConfig();
            console.log("\n");
            if (androidConfig) {
                statusAndroidVersion(androidConfig);
            }
            rl.close();
            console.log(`${colors.yellow}createdBy: @nhcorera${colors.reset}`);
        });
    });
});
program.parse(process.argv);
