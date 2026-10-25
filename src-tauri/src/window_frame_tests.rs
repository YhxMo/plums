use super::*;

#[test]
fn the_other_two_buttons_sit_20_pt_after_the_one_before() {
    assert_eq!(spaced(7.0), [27.0, 47.0]);
    // AppKit's reset puts them 23 pt apart; only those need moving back.
    assert_eq!(moves(7.0, [30.0, 53.0]), Some([27.0, 47.0]));
    assert_eq!(moves(7.0, [27.0, 47.0]), None);
    assert_eq!(moves(9.0, [32.0, 55.0]), Some([29.0, 49.0]));
}

#[test]
fn the_window_grows_to_four_fifths_of_its_screen_in_whole_points_and_never_below_the_minimum() {
    let min = (652.0, 600.0);
    assert_eq!(largest((1512.0, 982.0), min), (1209.0, 785.0));
    // A small screen still allows the three columns.
    assert_eq!(largest((700.0, 600.0), min), (652.0, 600.0));
}

#[test]
fn a_remembered_size_is_kept_within_the_limits() {
    let min = (652.0, 600.0);
    let max = (1209.0, 785.0);
    assert_eq!(within((940.0, 640.0), min, max), (940.0, 640.0));
    assert_eq!(within((1800.0, 1100.0), min, max), (1209.0, 785.0));
    assert_eq!(within((400.0, 300.0), min, max), (652.0, 600.0));
}

#[test]
fn the_minimum_matches_the_window_configuration() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let main = &config["app"]["windows"][0];
    assert_eq!(
        (main["minWidth"].as_f64(), main["minHeight"].as_f64()),
        (Some(MIN.0), Some(MIN.1))
    );
}
