use super::*;
use crate::storage::Broker;

#[test]
fn only_png_and_plums_names_without_folders_are_saved() {
    for name in ["写作助手.png", "card.PNG", "旅伴.plums", "a b.png"] {
        assert!(file_name(name).is_ok(), "{name}");
    }
    let long = format!("{}.png", "长".repeat(200));
    for name in [
        "a.exe",
        "a.png.exe",
        "../a.png",
        "dir/a.png",
        "dir\\a.png",
        "C:a.png",
        ".png",
        "a\0.png",
        "",
        long.as_str(),
    ] {
        assert_eq!(file_name(name), Err("invalid-request"), "{name}");
    }
}

#[test]
fn decodes_base64_and_refuses_anything_else() {
    assert_eq!(decode("").unwrap(), b"");
    assert_eq!(decode("cG5n").unwrap(), b"png");
    assert_eq!(decode("cG5nIGJ5dGVz").unwrap(), b"png bytes");
    assert_eq!(decode("YQ==").unwrap(), b"a");
    assert_eq!(decode("YWI=").unwrap(), b"ab");
    for data in ["YQ=", "Y*Q=", "YQ==YQ==", "=YQ=", "Y Q=="] {
        assert_eq!(decode(data), Err("invalid-request"), "{data}");
    }
}

#[test]
fn file_save_is_a_grantable_capability() {
    assert!(Broker::validate_grant("extension.ui.agents", &["file.save".into()]).is_ok());
}
