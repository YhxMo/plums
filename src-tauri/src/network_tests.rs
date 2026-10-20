use super::*;

#[test]
fn only_public_https_names_on_the_default_port_are_read() {
    for url in [
        "https://models.dev/api.json",
        "https://api.example.com/v1/list?page=2",
        "https://models.dev:443/api.json",
    ] {
        assert!(target(url).is_ok(), "{url}");
    }
    for url in [
        "http://models.dev/api.json",
        "https://localhost/api.json",
        "https://127.0.0.1/api.json",
        "https://[::1]/api.json",
        "https://models.dev:8443/api.json",
        "https://user:pass@models.dev/api.json",
        "https://models.dev/api.json#part",
        "https://intranet/api.json",
        "https://10.0.0.1/",
        "file:///etc/hosts",
        "not a url",
    ] {
        assert_eq!(target(url).map(|_| ()), Err("invalid-request"), "{url}");
    }
    let long = format!("https://models.dev/{}", "a".repeat(2048));
    assert_eq!(target(&long).map(|_| ()), Err("invalid-request"));
}

// models.dev is about 6 MB uncompressed and grows.
const _: () = assert!(MAX_RESPONSE >= 16 << 20);
const _: () = assert!(TOTAL.as_secs() <= 60);

#[test]
fn one_read_per_owner_and_an_early_abort_stops_it() {
    let reads = Reads::default();
    let first = reads.0.reserve("extension.connector.models", "a").unwrap();
    assert_eq!(
        reads.0.reserve("extension.connector.models", "b").err(),
        Some("busy")
    );
    assert!(reads.0.reserve("extension.other", "c").is_ok());
    drop(first);
    reads.0.abort("extension.connector.models", "d");
    assert_eq!(
        reads.0.reserve("extension.connector.models", "d").err(),
        Some("cancelled")
    );
}
