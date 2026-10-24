use super::*;
use crate::storage::Broker;

#[test]
fn only_https_links_with_a_host_and_no_user_info_open() {
    for url in [
        "https://example.com",
        "https://docs.example.com/guide?q=1#install",
        "https://example.com:8443/path",
        "https://127.0.0.1/",
    ] {
        assert!(target(url).is_ok(), "{url}");
    }
    for url in [
        "http://example.com",
        "file:///etc/hosts",
        "javascript:alert(1)",
        "mailto:someone@example.com",
        "https://user:pass@example.com/",
        "https://user@example.com/",
        "https://",
        "not a url",
        "",
    ] {
        assert_eq!(target(url).map(|_| ()), Err("invalid-request"), "{url}");
    }
    let long = format!("https://example.com/{}", "a".repeat(2048));
    assert_eq!(target(&long).map(|_| ()), Err("invalid-request"));
}

#[test]
fn link_open_is_a_grantable_capability() {
    assert!(Broker::validate_grant("extension.ui.agents", &["link.open".into()]).is_ok());
}
