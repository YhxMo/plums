//! Non-secret credential wire data and policy validation.
use crate::credential_bindings::Failure;
use crate::ipc::{wire_enum, wire_object};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
wire_enum! {
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum Authentication, tag = "type" {
    Bearer => "bearer",
    Header => "header" { name: String },
}
}
impl Authentication {
    pub fn name(&self) -> &str {
        match self {
            Self::Bearer => "authorization",
            Self::Header { name } => name,
        }
    }
}
wire_object! {
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Declaration, rename_all = "camelCase" {
    pub label: String,
    pub target: String,
    pub content_type: String,
    pub headers: BTreeMap<String, String>,
    pub authentication: Authentication,
}
}
wire_enum! {
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum Route, tag = "type" {
    #[default]
    Direct => "direct",
    Proxy => "proxy" { url: String },
}
}
wire_enum! {
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Status {
    Pending => "pending", Ready => "ready", Disabled => "disabled", DeletePending => "delete-pending",
}
}
wire_object! {
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct View, rename_all = "camelCase" {
    pub owner: String,
    pub alias: String,
    pub source: String,
    pub version: String,
    pub declaration: Declaration,
    pub route: Route,
    pub revision: u64,
    pub status: Status,
}
}
fn header(name: &str) -> Result<String, Failure> {
    let parsed = http::HeaderName::from_bytes(name.as_bytes()).map_err(|_| "invalid-policy")?;
    let name = parsed.as_str();
    if name.len() > 80
        || name.starts_with("proxy-")
        || [
            "host",
            "content-length",
            "transfer-encoding",
            "connection",
            "keep-alive",
            "te",
            "trailer",
            "upgrade",
            "cookie",
            "set-cookie",
            "content-type",
        ]
        .contains(&name)
    {
        return Err("invalid-policy");
    }
    Ok(name.into())
}
fn url(value: &str) -> Result<url::Url, Failure> {
    if value.len() > 512 || value.bytes().any(|c| c <= 32 || c == 127 || c == b'\\') {
        return Err("invalid-policy");
    }
    let url = url::Url::parse(value).map_err(|_| "invalid-policy")?;
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("invalid-policy");
    }
    Ok(url)
}
impl Declaration {
    pub fn validate(&self) -> Result<(), Failure> {
        let target = url(&self.target)?;
        if !text(&self.label, 240)
            || target.scheme() != "https"
            || target.port().is_some()
            || target.as_str() != self.target
            || self.content_type.len() > 120
        {
            return Err("invalid-policy");
        }
        let mut media = self.content_type.split('/');
        let token = |part: &str| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"!#$&^_.+-".contains(&c))
        };
        if !media.next().is_some_and(token)
            || !media.next().is_some_and(token)
            || media.next().is_some()
        {
            return Err("invalid-policy");
        }
        let auth = header(self.authentication.name())?;
        if self.headers.len() > 8 {
            return Err("invalid-policy");
        }
        let mut seen = HashSet::from([auth, "authorization".into()]);
        for (name, value) in &self.headers {
            if !seen.insert(header(name)?)
                || value.len() > 256
                || value.bytes().any(|c| !(32..=126).contains(&c))
            {
                return Err("invalid-policy");
            }
        }
        Ok(())
    }
    /// A read of another path on the bound site, such as a model list: same
    /// scheme and host, a plain absolute path, no query.
    pub fn read_target(&self, path: &str) -> Result<String, Failure> {
        let plain = path.len() <= 256
            && path.starts_with('/')
            && path[1..].split('/').all(|segment| {
                !segment.is_empty()
                    && segment != "."
                    && segment != ".."
                    && segment
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"-._~".contains(&c))
            });
        let mut url = url::Url::parse(&self.target).map_err(|_| "invalid-request")?;
        if !plain {
            return Err("invalid-request");
        }
        url.set_path(path);
        Ok(url.into())
    }
}
impl Route {
    pub fn validate(&self) -> Result<(), Failure> {
        if let Self::Proxy { url: endpoint } = self {
            let proxy = url(endpoint)?;
            if !["http", "https"].contains(&proxy.scheme()) || proxy.path() != "/" {
                return Err("invalid-policy");
            }
        }
        Ok(())
    }
    pub fn from_input(value: &str) -> Result<Self, Failure> {
        let route = if value.trim().is_empty() {
            Self::Direct
        } else {
            Self::Proxy {
                url: value.trim().into(),
            }
        };
        route.validate()?;
        Ok(route)
    }
}
pub(crate) fn owner(value: &str) -> bool {
    value.starts_with("extension.")
        && value.len() <= 74
        && value.len() > 10
        && !value.contains("..")
        && value.as_bytes()[10].is_ascii_lowercase()
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'.' | b'-'))
}
pub(crate) fn alias(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}
pub(crate) fn text(value: &str, limit: usize) -> bool {
    !value.trim().is_empty() && value.len() <= limit && !value.chars().any(char::is_control)
}
