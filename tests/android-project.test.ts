import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, expect, test } from "vitest";
import { prepareAndroid } from "../scripts/android-project.mjs";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "plums-android-"));
  roots.push(root);
  const activity =
    "src-tauri/gen/android/app/src/main/java/dev/plums/plums/MainActivity.kt";
  const adapted = readFileSync(
    new URL("../native/android/MainActivity.kt", import.meta.url),
    "utf8",
  );
  const original = `package dev.plums.plums

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
`;
  const files = {
    "src-tauri/tauri.conf.json":
      '{"identifier":"dev.plums.plums","productName":"Plums"}',
    "src-tauri/gen/android/app/src/main/res/values/strings.xml":
      '<resources>\n    <string name="app_name">"Plums M1"</string>\n    <string name="main_activity_title">"Plums M1"</string>\n</resources>\n',
    "native/android/MainActivity.kt": adapted,
    "native/android/AppearancePlugin.kt": readFileSync(
      new URL("../native/android/AppearancePlugin.kt", import.meta.url),
      "utf8",
    ),
    "native/android/DocumentsPlugin.kt": readFileSync(
      new URL("../native/android/DocumentsPlugin.kt", import.meta.url),
      "utf8",
    ),
    "native/android/CredentialsPlugin.kt": readFileSync(
      new URL("../native/android/CredentialsPlugin.kt", import.meta.url),
      "utf8",
    ),
    "native/android/NetworkPlugin.kt": readFileSync(
      new URL("../native/android/NetworkPlugin.kt", import.meta.url),
      "utf8",
    ),
    [activity]: original,
    "src-tauri/gen/android/buildSrc/src/main/java/dev/plums/plums/kotlin/BuildTask.kt":
      'val executable = """node""";\nval args = listOf("tauri", "android", "android-studio-script");\n',
    "src-tauri/gen/android/app/build.gradle.kts":
      "android {\n    buildTypes {\n    }\n}\n",
    "src-tauri/gen/android/gradle.properties": "android.builtInKotlin=false\n",
    "src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties":
      "distributionUrl=https\\://services.gradle.org/distributions/gradle-9.6.1-bin.zip\n",
    "src-tauri/icons/android/mipmap-mdpi/ic_launcher.png": "current icon",
    "src-tauri/gen/android/app/src/main/res/mipmap-mdpi/ic_launcher.png":
      "old icon",
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return { root, activity, original };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

test("preparation is repeatable and preserves the verified Insets behavior and CLI callback", () => {
  const { root, activity } = fixture();
  const paths = prepareAndroid(root, "/toolchain with spaces");
  const first = paths.map((path) => readFileSync(path, "utf8"));
  prepareAndroid(root, "/toolchain with spaces");
  expect(paths.map((path) => readFileSync(path, "utf8"))).toEqual(first);
  expect(readFileSync(join(root, activity), "utf8")).toContain(
    "WindowInsetsCompat.Type.ime()",
  );
  expect(first.join("\n")).toContain(
    "../node_modules/@tauri-apps/cli/tauri.js",
  );
  expect(first.join("\n")).toContain("file\\:///toolchain%20with%20spaces/");
});

test("preparation upgrades the known Insets-only activity without accepting unknown edits", () => {
  const { root, activity } = fixture();
  const previous = `package dev.plums.plums

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
  writeFileSync(join(root, activity), previous);
  prepareAndroid(root, "/toolchain");
  expect(readFileSync(join(root, activity), "utf8")).toContain("plums:back");
  writeFileSync(join(root, activity), previous.replace("safeArea.left", "0"));
  expect(() => prepareAndroid(root, "/toolchain")).toThrow(
    "MainActivity template changed",
  );
});

test("npm-launched initialization still calls the local CLI from the Rust directory", () => {
  const { root } = fixture();
  const task = join(
    root,
    "src-tauri/gen/android/buildSrc/src/main/java/dev/plums/plums/kotlin/BuildTask.kt",
  );
  writeFileSync(
    task,
    'val executable = """npm""";\nval args = listOf("run", "--", "tauri", "android", "android-studio-script");\n',
  );
  prepareAndroid(root, "/toolchain");
  expect(readFileSync(task, "utf8")).toContain('val executable = """node""";');
  expect(readFileSync(task, "utf8")).toContain(
    'listOf("../node_modules/@tauri-apps/cli/tauri.js", "android", "android-studio-script")',
  );
});

test("preparation refreshes launcher assets in an already generated project", () => {
  const { root } = fixture();
  prepareAndroid(root, "/toolchain");
  expect(
    readFileSync(
      join(
        root,
        "src-tauri/gen/android/app/src/main/res/mipmap-mdpi/ic_launcher.png",
      ),
      "utf8",
    ),
  ).toBe("current icon");
});

test("preparation keeps the launcher label in step with the product name", () => {
  const { root } = fixture();
  prepareAndroid(root, "/toolchain");
  const strings = readFileSync(
    join(root, "src-tauri/gen/android/app/src/main/res/values/strings.xml"),
    "utf8",
  );
  expect(strings).toContain('<string name="app_name">"Plums"</string>');
  expect(strings).toContain(
    '<string name="main_activity_title">"Plums"</string>',
  );
});

test("missing icon sources fail before generated templates are changed", () => {
  const { root, activity, original } = fixture();
  rmSync(join(root, "src-tauri/icons/android"), { recursive: true });
  expect(() => prepareAndroid(root, "/toolchain")).toThrow();
  expect(readFileSync(join(root, activity), "utf8")).toBe(original);
});

test.each(["Appearance", "Documents", "Credentials", "Network"])(
  "unknown %s plugin code is preserved before any template writes",
  (name) => {
    const { root, activity, original } = fixture();
    const plugin = activity.replace("MainActivity.kt", `${name}Plugin.kt`);
    writeFileSync(join(root, plugin), `custom ${name}\n`);
    expect(() => prepareAndroid(root, "/toolchain")).toThrow(
      `${name} plugin changed`,
    );
    expect(readFileSync(join(root, activity), "utf8")).toBe(original);
    expect(readFileSync(join(root, plugin), "utf8")).toBe(`custom ${name}\n`);
  },
);

test.each(["activity", "callback", "signing", "distribution"] as const)(
  "unknown %s changes are rejected before any file is overwritten",
  (changed) => {
    const { root, activity, original } = fixture();
    const target = {
      activity,
      callback:
        "src-tauri/gen/android/buildSrc/src/main/java/dev/plums/plums/kotlin/BuildTask.kt",
      signing: "src-tauri/gen/android/app/build.gradle.kts",
      distribution:
        "src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties",
    }[changed];
    writeFileSync(
      join(root, target),
      changed === "signing"
        ? "signingConfigs {}\n    buildTypes {\n"
        : "unknown template\n",
    );
    expect(() => prepareAndroid(root, "/toolchain")).toThrow(
      /changed|reviewed/,
    );
    if (changed !== "activity")
      expect(readFileSync(join(root, activity), "utf8")).toBe(original);
  },
);

test("preparation upgrades the known previous light system-bar color", () => {
  const { root, activity } = fixture();
  const plugin = join(
    root,
    activity.replace("MainActivity.kt", "AppearancePlugin.kt"),
  );
  const current = readFileSync(
    join(root, "native/android/AppearancePlugin.kt"),
    "utf8",
  ).replace("{{PACKAGE}}", "dev.plums.plums");
  writeFileSync(plugin, current.replace('"#fafafa"', '"#f7f4ef"'));
  prepareAndroid(root, "/toolchain");
  expect(readFileSync(plugin, "utf8")).toBe(current);
  writeFileSync(plugin, current.replace('"#181818"', '"#1c1917"'));
  prepareAndroid(root, "/toolchain");
  expect(readFileSync(plugin, "utf8")).toBe(current);
});

test("preparation replaces only known earlier credential plugin templates", () => {
  const { root, activity } = fixture();
  const plugin = join(
    root,
    activity.replace("MainActivity.kt", "CredentialsPlugin.kt"),
  );
  const current = readFileSync(
    join(root, "native/android/CredentialsPlugin.kt"),
    "utf8",
  ).replace("{{PACKAGE}}", "dev.plums.plums");
  for (const commit of [
    "0e5d114",
    "135c149",
    "4657f25",
    "45a03dc",
    "e06aeb7",
    "6fc58eb",
  ]) {
    const previous = execFileSync(
      "git",
      ["show", `${commit}:native/android/CredentialsPlugin.kt`],
      { cwd: process.cwd(), encoding: "utf8" },
    ).replace("{{PACKAGE}}", "dev.plums.plums");
    writeFileSync(plugin, previous);
    prepareAndroid(root, "/toolchain");
    expect(readFileSync(plugin, "utf8")).toBe(current);
  }
  writeFileSync(plugin, current.replace("600, TimeUnit", "60, TimeUnit"));
  expect(() => prepareAndroid(root, "/toolchain")).toThrow(
    "Credentials plugin changed",
  );
});

test("document picker requests only temporary read access and bounded worker reads", () => {
  const { root, activity } = fixture();
  prepareAndroid(root, "/toolchain");
  const source = readFileSync(
    join(root, activity.replace("MainActivity.kt", "DocumentsPlugin.kt")),
    "utf8",
  );
  expect(source).toContain("Intent.ACTION_GET_CONTENT");
  expect(source).toContain("Intent.FLAG_GRANT_READ_URI_PERMISSION");
  expect(source).not.toContain("FLAG_GRANT_PERSISTABLE_URI_PERMISSION");
  expect(source).not.toContain("takePersistableUriPermission");
  expect(source).toContain("args.maxBytes + 1 - output.size()");
  expect(source).toContain("CodingErrorAction.REPORT");
});
