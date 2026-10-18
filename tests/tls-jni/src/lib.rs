//! Isolated M2.3.1 probe. Never linked into the application's default build.
use serde_json::{json, Value};
use std::{error::Error, net::SocketAddr, time::Duration};

#[cfg(target_os = "android")]
mod android;

fn certificate_rejection(error: &(dyn Error + 'static)) -> bool {
    let mut current: Option<&(dyn Error + 'static)> = Some(error);
    while let Some(source) = current {
        if matches!(
            source.downcast_ref::<rustls::Error>(),
            Some(rustls::Error::InvalidCertificate(_))
        ) {
            return true;
        }
        if let Some(inner) = source
            .downcast_ref::<std::io::Error>()
            .and_then(|error| error.get_ref())
        {
            if certificate_rejection(inner) {
                return true;
            }
        }
        current = source.source();
    }
    false
}

fn request(host: &str, port: u16, ca: &[u8], extra_root: bool) -> Result<String, reqwest::Error> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let builder = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .connect_timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none())
        .tls_backend_rustls()
        .resolve(host, address);
    // Android roots are controlled by the official test companion via JNI.
    // reqwest cannot merge roots there; never substitute WebPKI silently.
    #[cfg(target_os = "android")]
    let _ = (ca, extra_root);
    #[cfg(not(target_os = "android"))]
    let builder = if extra_root {
        builder.tls_certs_merge([reqwest::Certificate::from_der(ca)?])
    } else {
        builder
    };
    builder
        .build()?
        .get(format!("https://{host}:{port}/probe"))
        .send()?
        .error_for_status()?
        .text()
}

pub fn tls_checks(port: u16, ca: &[u8], mut trust: impl FnMut(bool) -> bool) -> Value {
    let rejected = |host, extra| {
        request(host, port, ca, extra)
            .err()
            .is_some_and(|error| certificate_rejection(&error))
    };
    let system_ready = trust(false);
    let untrusted = system_ready && rejected("untrusted.probe.invalid", false);
    let test_ready = trust(true);
    let trusted = test_ready
        && request("trusted.probe.invalid", port, ca, true).is_ok_and(|body| body == "probe-ok");
    let hostname = test_ready && rejected("mismatch.probe.invalid", true);
    let expired = test_ready && rejected("expired.probe.invalid", true);
    let reset = trust(false);
    let reset_rejected = reset && rejected("trusted.probe.invalid", false);
    json!({
        "trusted": trusted, "untrusted_rejected": untrusted,
        "hostname_rejected": hostname, "expired_rejected": expired,
        "root_reset_rejected": reset_rejected,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wrapped_certificate_error_is_recognized() {
        let error = std::io::Error::other(rustls::Error::InvalidCertificate(
            rustls::CertificateError::UnknownIssuer,
        ));
        assert!(certificate_rejection(&error));
    }
    #[test]
    fn connection_failure_is_not_a_certificate_rejection() {
        assert!(!certificate_rejection(&std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "fixture unavailable"
        )));
    }
}
