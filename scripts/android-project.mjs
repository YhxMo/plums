import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const originalActivity = `package {{PACKAGE}}

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
`;
const previousInsetsActivity = `package {{PACKAGE}}

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val safeArea = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime()
      )
      view.setPadding(safeArea.left, safeArea.top, safeArea.right, safeArea.bottom)
      insets
    }
    ViewCompat.requestApplyInsets(content)
  }
}
`;
const callback = 'listOf("tauri", "android", "android-studio-script")';
const npmCallback =
  'listOf("run", "--", "tauri", "android", "android-studio-script")';
const fixedCallback =
  'listOf("../node_modules/@tauri-apps/cli/tauri.js", "android", "android-studio-script")';
const signing = `    signingConfigs {
        getByName("debug") {
            storeFile = file(System.getenv("PLUMS_ANDROID_DEBUG_KEYSTORE")
                ?: error("Use npm run android:build to configure debug signing"))
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }
`;
const limits = `
# Plums local build resources
org.gradle.daemon=false
org.gradle.workers.max=4
`;

/**
 * SHA-256 of earlier committed templates (package dev.plums.plums) that may be replaced.
 * @type {Record<string, Set<string>>}
 */
const previousTemplates = {
  Credentials: new Set([
    // 0e5d114: prompt failures reported as cancelled.
    "e59629add7a0c82ca54085ff7d47cd66df92677ef106a3f348be44c4ddec6e58",
    // 135c149: before bound requests.
    "b1f134a606380b32065e35750e559d85f6047038bd1d8c8d06c37c1d329f015d",
    // 4657f25: 4096-byte request limit.
    "90bf5a0de6c9ad8b56162d2df63409e7b888ad31227bbfc241bf9b33a4fd842f",
    // 45a03dc: 8192-byte response, POST only.
    "98635e13fc5f026f1752502e9ac07f19ff5fa0179e6626573add1e81be865610",
  ]),
};
/** Validate every edit before writing any generated file.
 * @param {string} root @param {string} toolsRoot */
export function prepareAndroid(root, toolsRoot) {
  const config = JSON.parse(
    readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const packageName = config.identifier;
  if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(packageName))
    throw new Error("Android identifier must be a lowercase Java package");
  const generated = join(root, "src-tauri/gen/android");
  const edits = new Map();
  const activity = join(
    generated,
    "app/src/main/java",
    packageName.replaceAll(".", "/"),
    "MainActivity.kt",
  );
  const expected = originalActivity.replace("{{PACKAGE}}", packageName);
  const adapted = readFileSync(
    join(root, "native/android/MainActivity.kt"),
    "utf8",
  ).replace("{{PACKAGE}}", packageName);
  const current = readFileSync(activity, "utf8");
  if (
    ![
      expected,
      adapted,
      previousInsetsActivity.replace("{{PACKAGE}}", packageName),
    ].includes(current)
  )
    throw new Error("MainActivity template changed; review before adapting");
  edits.set(activity, adapted);

  for (const name of ["Appearance", "Documents", "Credentials"]) {
    const filename = `${name}Plugin.kt`;
    const path = join(dirname(activity), filename);
    const source = readFileSync(
      join(root, "native/android", filename),
      "utf8",
    ).replace("{{PACKAGE}}", packageName);
    const accepted = [source];
    if (name === "Appearance")
      accepted.push(
        source.replace('"#fafafa"', '"#f7f4ef"'),
        source.replace('"#181818"', '"#1c1917"'),
        source
          .replace('"#181818"', '"#1c1917"')
          .replace('"#fafafa"', '"#f7f4ef"'),
      );
    const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (
      existing !== null &&
      !accepted.includes(existing) &&
      !previousTemplates[name]?.has(
        createHash("sha256").update(existing).digest("hex"),
      )
    )
      throw new Error(`${name} plugin changed; review before adapting`);
    edits.set(path, source);
  }

  const task = join(
    generated,
    "buildSrc/src/main/java",
    packageName.replaceAll(".", "/"),
    "kotlin/BuildTask.kt",
  );
  const taskText = readFileSync(task, "utf8");
  if (
    !taskText.includes(fixedCallback) &&
    !taskText.includes(callback) &&
    !taskText.includes(npmCallback)
  )
    throw new Error("Gradle callback changed; review the locked CLI template");
  if (!/val executable = """(?:node|npm)""";/.test(taskText))
    throw new Error(
      "Gradle executable changed; review the locked CLI template",
    );
  edits.set(
    task,
    taskText
      .replace('val executable = """npm""";', 'val executable = """node""";')
      .replace(npmCallback, fixedCallback)
      .replace(callback, fixedCallback),
  );

  const app = join(generated, "app/build.gradle.kts");
  const appText = readFileSync(app, "utf8");
  if (!appText.includes(signing) && appText.includes("signingConfigs"))
    throw new Error("Existing signing configuration must be reviewed");
  if (!appText.includes("    buildTypes {"))
    throw new Error("Android buildTypes template changed");
  edits.set(
    app,
    appText.includes(signing)
      ? appText
      : appText.replace("    buildTypes {", `${signing}    buildTypes {`),
  );

  const properties = join(generated, "gradle.properties");
  const propertyText = readFileSync(properties, "utf8");
  edits.set(
    properties,
    propertyText.includes(limits) ? propertyText : propertyText + limits,
  );

  const wrapper = join(generated, "gradle/wrapper/gradle-wrapper.properties");
  const wrapperText = readFileSync(wrapper, "utf8");
  const upstream =
    "https\\://services.gradle.org/distributions/gradle-9.6.1-bin.zip";
  const local = pathToFileURL(
    join(toolsRoot, "downloads/gradle-9.6.1-bin.zip"),
  ).href.replace("file:", "file\\:");
  const distribution = wrapperText.match(/^distributionUrl=(.+)$/m)?.[1];
  if (distribution !== upstream && distribution !== local)
    throw new Error("Gradle distribution changed; review version and archive");
  let preparedWrapper = wrapperText.replace(
    `distributionUrl=${upstream}`,
    `distributionUrl=${local}`,
  );
  const checksum =
    "9c0f7faeeb306cb14e4279a3e084ca6b596894089a0638e68a07c945a32c9e14";
  const existingChecksum = wrapperText.match(
    /^distributionSha256Sum=(.+)$/m,
  )?.[1];
  if (existingChecksum && existingChecksum !== checksum)
    throw new Error(
      "Gradle archive checksum differs from the verified version",
    );
  if (!existingChecksum)
    preparedWrapper += `\ndistributionSha256Sum=${checksum}\n`;
  edits.set(wrapper, preparedWrapper);

  // The generated project keeps the name from its first initialization.
  const strings = join(generated, "app/src/main/res/values/strings.xml");
  if (config.productName && existsSync(strings)) {
    const label = config.productName
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', '\\"');
    edits.set(
      strings,
      readFileSync(strings, "utf8").replace(
        /(<string name="(?:app_name|main_activity_title)">)"[^"]*"(<\/string>)/g,
        (_, open, close) => `${open}"${label}"${close}`,
      ),
    );
  }

  const icons = join(root, "src-tauri/icons/android");
  for (const density of readdirSync(icons))
    for (const name of readdirSync(join(icons, density)))
      edits.set(
        join(generated, "app/src/main/res", density, name),
        readFileSync(join(icons, density, name)),
      );

  for (const [path, value] of edits) {
    const bytes = Buffer.from(value);
    if (!existsSync(path) || !readFileSync(path).equals(bytes)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    }
  }
  return [...edits.keys()];
}
