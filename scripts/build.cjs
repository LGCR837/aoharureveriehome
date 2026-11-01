"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { transform } = require("esbuild");
const { minify } = require("html-minifier-terser");
const JavaScriptObfuscator = require("javascript-obfuscator");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "public");

const read = (file) => fs.readFile(path.join(root, file), "utf8");

const formatSize = (buffer) => `${(Buffer.byteLength(buffer) / 1024).toFixed(1)} KB`;

async function copyReferencedAssets(source) {
  const references = new Set(
    [...source.matchAll(/assets\/[A-Za-z0-9._/-]+/g)].map((match) => match[0])
  );

  for (const relativePath of references) {
    const sourcePath = path.join(root, relativePath);
    const destinationPath = path.join(outputDirectory, relativePath);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }

  return references.size;
}

async function build() {
  const [htmlSource, cssSource, jsSource] = await Promise.all([
    read("index.html"),
    read("styles.css"),
    read("script.js")
  ]);

  const [htmlResult, cssResult, jsMinified] = await Promise.all([
    minify(htmlSource, {
      collapseWhitespace: true,
      conservativeCollapse: true,
      removeComments: true,
      removeRedundantAttributes: true,
      useShortDoctype: true
    }),
    transform(cssSource, {
      loader: "css",
      minify: true,
      legalComments: "none",
      target: ["chrome100", "firefox100", "safari15"]
    }),
    transform(jsSource, {
      loader: "js",
      minify: true,
      legalComments: "none",
      target: ["es2020"]
    })
  ]);

  const obfuscator = JavaScriptObfuscator.default || JavaScriptObfuscator;
  const obfuscated = obfuscator.obfuscate(jsMinified.code, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: "hexadecimal",
    log: false,
    numbersToExpressions: false,
    renameGlobals: false,
    renameProperties: false,
    selfDefending: false,
    simplify: true,
    splitStrings: false,
    stringArray: true,
    stringArrayCallsTransform: false,
    stringArrayEncoding: [],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayThreshold: 0.6,
    stringArrayWrappersCount: 1,
    stringArrayWrappersType: "variable",
    target: "browser-no-eval",
    transformObjectKeys: false,
    unicodeEscapeSequence: false
  }).getObfuscatedCode();

  const jsResult = await transform(obfuscated, {
    loader: "js",
    minify: true,
    legalComments: "none",
    target: ["es2020"]
  });

  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true });

  await Promise.all([
    fs.writeFile(path.join(outputDirectory, "index.html"), htmlResult),
    fs.writeFile(path.join(outputDirectory, "styles.css"), cssResult.code),
    fs.writeFile(path.join(outputDirectory, "script.js"), jsResult.code)
  ]);

  const assetCount = await copyReferencedAssets(`${htmlSource}\n${cssSource}`);

  console.log(`[build] HTML  ${formatSize(htmlResult)}`);
  console.log(`[build] CSS   ${formatSize(cssResult.code)}`);
  console.log(`[build] JS    ${formatSize(jsResult.code)}`);
  console.log(`[build] assets ${assetCount} files`);
  console.log(`[build] output ${path.relative(root, outputDirectory)}/`);
}

build().catch((error) => {
  console.error("[build] failed:", error);
  process.exitCode = 1;
});
