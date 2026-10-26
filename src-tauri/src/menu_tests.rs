use super::*;

#[test]
fn every_command_has_its_own_id_and_key() {
    for (i, (id, _, key)) in COMMANDS.iter().enumerate() {
        assert!(key.starts_with("CmdOrCtrl+"), "{id}");
        for (other, _, other_key) in &COMMANDS[i + 1..] {
            assert_ne!(id, other);
            assert_ne!(key.to_lowercase(), other_key.to_lowercase());
        }
    }
}

#[test]
fn only_the_pages_commands_are_sent_to_it() {
    assert!(is_command("settings"));
    assert!(is_command("new"));
    assert!(is_command("find"));
    // Items AppKit or muda handle themselves never reach the page.
    assert!(!is_command("copy"));
    assert!(!is_command(""));
}
