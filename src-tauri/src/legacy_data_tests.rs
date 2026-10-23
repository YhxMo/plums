use super::*;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
/// `base` stands for the platform's application data folder.
struct Fixture {
    base: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let base = std::env::temp_dir().join(format!(
            "plums-legacy-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&base).unwrap();
        Self { base }
    }
    fn legacy(&self) -> PathBuf {
        self.base.join(LEGACY)
    }
    fn root(&self) -> PathBuf {
        self.base.join("dev.plums.plums/data")
    }
    fn write(&self, path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    /// Names directly inside `dir`, sorted, for spotting leftovers.
    fn entries(&self, dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

#[cfg(unix)]
fn mode(path: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[test]
fn copies_earlier_data_once_and_leaves_the_original_in_place() {
    let fixture = Fixture::new();
    let legacy = fixture.legacy();
    fixture.write(&legacy.join("host.shell.json"), "{\"shell\":1}");
    fixture.write(&legacy.join("state/nested.json"), "{\"nested\":1}");
    fixture.write(&legacy.join("credential-secrets.json"), "{\"keys\":{}}");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            legacy.join("credential-secrets.json"),
            fs::Permissions::from_mode(0o600),
        )
        .unwrap();
    }
    let root = fixture.root();

    assert_eq!(migrate(&legacy, &root).unwrap(), Outcome::Copied);

    assert_eq!(
        fs::read_to_string(root.join("host.shell.json")).unwrap(),
        "{\"shell\":1}"
    );
    assert_eq!(
        fs::read_to_string(root.join("state/nested.json")).unwrap(),
        "{\"nested\":1}"
    );
    #[cfg(unix)]
    assert_eq!(mode(&root.join("credential-secrets.json")), 0o600);
    let marker: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(root.join(MARKER)).unwrap()).unwrap();
    assert_eq!(marker["from"], LEGACY);
    // The original stays as it was, as a backup the person can delete.
    assert_eq!(
        fixture.entries(&legacy),
        ["credential-secrets.json", "host.shell.json", "state"]
    );
    // A later start finds data and copies nothing again.
    fs::write(legacy.join("host.shell.json"), "{\"shell\":2}").unwrap();
    assert_eq!(migrate(&legacy, &root).unwrap(), Outcome::Skipped);
    assert_eq!(
        fs::read_to_string(root.join("host.shell.json")).unwrap(),
        "{\"shell\":1}"
    );
}

#[test]
fn existing_data_is_never_overwritten() {
    let fixture = Fixture::new();
    fixture.write(&fixture.legacy().join("host.shell.json"), "old");
    fixture.write(&fixture.root().join("host.shell.json"), "new");

    assert_eq!(
        migrate(&fixture.legacy(), &fixture.root()).unwrap(),
        Outcome::Skipped
    );
    assert_eq!(fixture.entries(&fixture.root()), ["host.shell.json"]);
    assert_eq!(
        fs::read_to_string(fixture.root().join("host.shell.json")).unwrap(),
        "new"
    );
}

#[test]
fn an_empty_data_folder_still_receives_earlier_data() {
    let fixture = Fixture::new();
    fixture.write(&fixture.legacy().join("host.shell.json"), "old");
    fs::create_dir_all(fixture.root()).unwrap();

    assert_eq!(
        migrate(&fixture.legacy(), &fixture.root()).unwrap(),
        Outcome::Copied
    );
    assert_eq!(
        fs::read_to_string(fixture.root().join("host.shell.json")).unwrap(),
        "old"
    );
}

#[test]
fn nothing_happens_without_earlier_data() {
    let fixture = Fixture::new();

    assert_eq!(
        migrate(&fixture.legacy(), &fixture.root()).unwrap(),
        Outcome::Skipped
    );
    assert!(!fixture.root().exists());
}

#[cfg(unix)]
#[test]
fn a_failed_copy_leaves_no_partial_data() {
    let fixture = Fixture::new();
    let legacy = fixture.legacy();
    fixture.write(&legacy.join("host.shell.json"), "old");
    // Links are refused rather than followed out of the data folder.
    std::os::unix::fs::symlink(&fixture.base, legacy.join("link")).unwrap();

    assert!(migrate(&legacy, &fixture.root()).is_err());

    assert!(!fixture.root().exists());
    let parent = fixture.root().parent().unwrap().to_path_buf();
    assert!(!parent.exists() || fixture.entries(&parent).is_empty());
    assert_eq!(fixture.entries(&legacy), ["host.shell.json", "link"]);
}
