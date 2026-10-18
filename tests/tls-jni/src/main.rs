fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 || std::env::consts::OS != "macos" {
        return Err("Usage on macOS: plums-tls-jni-probe PORT CA_DER RESULT_JSON".into());
    }
    let result = serde_json::json!({
        "platform": "macos",
        "tls": plums_tls_jni_probe::tls_checks(args[1].parse()?, &std::fs::read(&args[2])?, |_| true),
    });
    std::fs::write(&args[3], serde_json::to_string_pretty(&result)? + "\n")?;
    Ok(())
}
