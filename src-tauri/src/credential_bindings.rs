//! Host-owned, non-secret binding records. No transport or operating-system vault calls.
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const MAX_BINDINGS: usize = 32;
const MAX_BYTES: usize = 65536;
const MAX_REFERENCES: usize = 8;
pub type Failure = &'static str;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Authentication {
    Bearer,
    Header { name: String },
}
impl Authentication {
    pub fn name(&self) -> &str {
        match self {
            Self::Bearer => "authorization",
            Self::Header { name } => name,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Declaration {
    pub label: String,
    pub target: String,
    pub content_type: String,
    pub headers: BTreeMap<String, String>,
    pub authentication: Authentication,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Route {
    #[default]
    Direct,
    Proxy {
        url: String,
    },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    Pending,
    Ready,
    Disabled,
    DeletePending,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct View {
    pub owner: String,
    pub alias: String,
    pub source: String,
    pub version: String,
    pub declaration: Declaration,
    pub route: Route,
    pub revision: u64,
    pub status: Status,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    view: View,
    reference: Option<String>,
    retired: Vec<String>,
}
impl Binding {
    fn references(&self) -> Vec<String> {
        self.reference
            .iter()
            .chain(self.retired.iter())
            .cloned()
            .collect()
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Saved {
    schema: u32,
    bindings: BTreeMap<String, Binding>,
}
struct Active {
    token: String,
    key: String,
    previous: Option<Binding>,
}
struct Inner {
    root: PathBuf,
    saved: Saved,
    faulted: bool,
    active: Option<Active>,
}
#[derive(Clone)]
pub struct Bindings(Arc<Mutex<Inner>>);
pub struct Ticket {
    token: String,
    pub view: View,
    pub reference: Option<String>,
    pub references: Vec<String>,
}
#[derive(Clone, Copy, Debug)]
pub enum KeyResult {
    Stored,
    Cancelled,
    Rejected,
    Unavailable,
    Unknown,
}
pub fn owner(value: &str) -> bool {
    value.starts_with("extension.")
        && value.len() <= 74
        && value.len() > 10
        && !value.contains("..")
        && value.as_bytes()[10].is_ascii_lowercase()
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'.' | b'-'))
}
fn alias(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}
fn text(value: &str, limit: usize) -> bool {
    !value.trim().is_empty() && value.len() <= limit && !value.chars().any(char::is_control)
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
impl Saved {
    fn validate(&self) -> Result<(), Failure> {
        if self.schema != 1 || self.bindings.len() > MAX_BINDINGS {
            return Err("corrupt");
        }
        let mut references = HashSet::new();
        for (key, binding) in &self.bindings {
            let view = &binding.view;
            if !owner(&view.owner)
                || !alias(&view.alias)
                || *key != format!("{}:{}", view.owner, view.alias)
                || !text(&view.source, 512)
                || !text(&view.version, 80)
                || view.revision == 0
                || view.revision >= 9_007_199_254_740_991
                || binding.references().len() > MAX_REFERENCES
            {
                return Err("corrupt");
            }
            view.declaration.validate().map_err(|_| "corrupt")?;
            view.route.validate().map_err(|_| "corrupt")?;
            if matches!(view.status, Status::Ready | Status::Pending) && binding.reference.is_none()
            {
                return Err("corrupt");
            }
            for reference in binding.references() {
                if uuid::Uuid::parse_str(&reference).is_err() || !references.insert(reference) {
                    return Err("corrupt");
                }
            }
        }
        Ok(())
    }
}
impl Bindings {
    pub fn new(root: PathBuf) -> Self {
        let loaded = (|| {
            let bytes = match fs::read(root.join("credential-bindings.json")) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(Saved {
                        schema: 1,
                        bindings: BTreeMap::new(),
                    })
                }
                Err(_) => return Err("unavailable"),
            };
            if bytes.len() > MAX_BYTES {
                return Err("corrupt");
            }
            let saved: Saved = serde_json::from_slice(&bytes).map_err(|_| "corrupt")?;
            saved.validate()?;
            Ok(saved)
        })();
        let faulted = loaded.is_err();
        Self(Arc::new(Mutex::new(Inner {
            root,
            saved: loaded.unwrap_or(Saved {
                schema: 1,
                bindings: BTreeMap::new(),
            }),
            faulted,
            active: None,
        })))
    }
    pub fn list(&self, identity: &str) -> Result<Vec<View>, Failure> {
        if !owner(identity) {
            return Err("invalid-request");
        }
        let inner = self.0.lock().map_err(|_| "unknown")?;
        if inner.faulted {
            return Err("unavailable");
        }
        Ok(inner
            .saved
            .bindings
            .values()
            .filter(|binding| binding.view.owner == identity)
            .map(|binding| binding.view.clone())
            .collect())
    }
    pub fn inventory(&self) -> Result<Vec<View>, Failure> {
        let inner = self.0.lock().map_err(|_| "unknown")?;
        if inner.faulted {
            return Err("unavailable");
        }
        Ok(inner
            .saved
            .bindings
            .values()
            .filter(|binding| {
                !binding.references().is_empty() || binding.view.status == Status::DeletePending
            })
            .map(|binding| binding.view.clone())
            .collect())
    }
    pub fn retain_disabled(&self, identity: &str) -> Result<(), Failure> {
        if !owner(identity) {
            return Err("invalid-request");
        }
        let mut inner = self.0.lock().map_err(|_| "unknown")?;
        inner.check()?;
        let mut next = inner.saved.clone();
        let mut changed = false;
        for binding in next
            .bindings
            .values_mut()
            .filter(|binding| binding.view.owner == identity)
        {
            if !matches!(
                binding.view.status,
                Status::Disabled | Status::DeletePending
            ) {
                binding.view.status = Status::Disabled;
                binding.view.revision += 1;
                changed = true;
            }
        }
        if changed {
            inner.save(next)?;
        }
        Ok(())
    }
    pub fn begin_key(
        &self,
        identity: String,
        name: String,
        source: String,
        version: String,
        declaration: Declaration,
        revision: u64,
    ) -> Result<Ticket, Failure> {
        if !owner(&identity) || !alias(&name) || !text(&source, 512) || !text(&version, 80) {
            return Err("invalid-request");
        }
        declaration.validate()?;
        let mut inner = self.0.lock().map_err(|_| "unknown")?;
        inner.check()?;
        let key = format!("{identity}:{name}");
        let previous = inner.saved.bindings.get(&key).cloned();
        if previous.as_ref().map_or(0, |binding| binding.view.revision) != revision {
            return Err("conflict");
        }
        if previous.as_ref().is_some_and(|binding| {
            matches!(binding.view.status, Status::Pending | Status::DeletePending)
        }) {
            return Err("reconcile-required");
        }
        if previous.is_none() && inner.saved.bindings.len() >= MAX_BINDINGS {
            return Err("resource-limit");
        }
        let retired = previous.as_ref().map_or(Vec::new(), Binding::references);
        if retired.len() >= MAX_REFERENCES {
            return Err("cleanup-required");
        }
        let binding = Binding {
            view: View {
                owner: identity,
                alias: name,
                source,
                version,
                declaration,
                route: previous
                    .as_ref()
                    .map_or(Route::Direct, |binding| binding.view.route.clone()),
                revision: revision + 1,
                status: Status::Pending,
            },
            reference: Some(uuid::Uuid::new_v4().to_string()),
            retired,
        };
        let mut next = inner.saved.clone();
        next.bindings.insert(key.clone(), binding.clone());
        inner.save(next)?;
        Ok(inner.activate(key, previous, binding))
    }
    pub fn finish_key(&self, ticket: Ticket, result: KeyResult) -> Result<(), Failure> {
        let mut inner = self.0.lock().map_err(|_| "unknown")?;
        let active = inner.take(&ticket)?;
        let mut next = inner.saved.clone();
        match result {
            KeyResult::Stored => {
                next.bindings
                    .get_mut(&active.key)
                    .ok_or("unknown")?
                    .view
                    .status = Status::Ready
            }
            KeyResult::Cancelled | KeyResult::Rejected | KeyResult::Unavailable => {
                if let Some(mut previous) = active.previous {
                    previous.view.revision = ticket.view.revision + 1;
                    next.bindings.insert(active.key, previous);
                } else {
                    next.bindings.remove(&active.key);
                }
            }
            KeyResult::Unknown => return Err("unknown"),
        }
        inner.save(next)
    }
    pub fn begin_action(
        &self,
        identity: &str,
        name: &str,
        revision: u64,
    ) -> Result<Ticket, Failure> {
        if !owner(identity) || !alias(name) {
            return Err("invalid-request");
        }
        let mut inner = self.0.lock().map_err(|_| "unknown")?;
        inner.check()?;
        let key = format!("{identity}:{name}");
        let binding = inner.saved.bindings.get(&key).cloned().ok_or("missing")?;
        if binding.view.revision != revision {
            return Err("conflict");
        }
        Ok(inner.activate(key, Some(binding.clone()), binding))
    }
    pub fn cancel_action(&self, ticket: &Ticket) -> Result<(), Failure> {
        self.0.lock().map_err(|_| "unknown")?.take(ticket)?;
        Ok(())
    }
    pub fn finish_route(&self, ticket: Ticket, route: Route) -> Result<(), Failure> {
        route.validate()?;
        let mut inner = self.0.lock().map_err(|_| "unknown")?;
        let active = inner.take(&ticket)?;
        let mut next = inner.saved.clone();
        let binding = next.bindings.get_mut(&active.key).ok_or("unknown")?;
        binding.view.route = route;
        binding.view.revision += 1;
        inner.save(next)
    }
    pub fn disable(&self, ticket: &Ticket) -> Result<(), Failure> {
        let mut inner = self.0.lock().map_err(|_| "unknown")?;
        inner.matches(ticket)?;
        let mut next = inner.saved.clone();
        let binding = next
            .bindings
            .get_mut(&format!("{}:{}", ticket.view.owner, ticket.view.alias))
            .ok_or("unknown")?;
        binding.view.status = Status::DeletePending;
        binding.view.revision += 1;
        inner.save(next)
    }
    pub fn finish_delete(&self, ticket: Ticket, removed: bool) -> Result<(), Failure> {
        let mut inner = self.0.lock().map_err(|_| "unknown")?;
        let active = inner.take(&ticket)?;
        if !removed {
            return Err("unknown");
        }
        let mut next = inner.saved.clone();
        let binding = next.bindings.get_mut(&active.key).ok_or("unknown")?;
        if binding.view.status != Status::DeletePending {
            return Err("invalid-request");
        }
        binding.reference = None;
        binding.retired.clear();
        binding.view.status = Status::Disabled;
        inner.save(next)
    }
    pub fn finish_reconcile(
        &self,
        ticket: Ticket,
        exists: Result<bool, Failure>,
    ) -> Result<(), Failure> {
        let mut inner = self.0.lock().map_err(|_| "unknown")?;
        let active = inner.take(&ticket)?;
        let exists = exists?;
        let mut next = inner.saved.clone();
        let binding = next.bindings.get_mut(&active.key).ok_or("unknown")?;
        if binding.view.status != Status::Pending {
            return Err("invalid-request");
        }
        binding.view.status = if exists {
            Status::Ready
        } else {
            Status::Disabled
        };
        binding.view.revision += 1;
        inner.save(next)
    }
}
impl Inner {
    fn check(&self) -> Result<(), Failure> {
        if self.faulted {
            return Err("unavailable");
        }
        if self.active.is_some() {
            return Err("busy");
        }
        Ok(())
    }
    fn activate(&mut self, key: String, previous: Option<Binding>, binding: Binding) -> Ticket {
        let token = uuid::Uuid::new_v4().to_string();
        self.active = Some(Active {
            token: token.clone(),
            key,
            previous,
        });
        Ticket {
            token,
            view: binding.view.clone(),
            reference: binding.reference.clone(),
            references: binding.references(),
        }
    }
    fn matches(&self, ticket: &Ticket) -> Result<(), Failure> {
        if self.faulted
            || !self
                .active
                .as_ref()
                .is_some_and(|active| active.token == ticket.token)
        {
            return Err("unknown");
        }
        Ok(())
    }
    fn take(&mut self, ticket: &Ticket) -> Result<Active, Failure> {
        self.matches(ticket)?;
        self.active.take().ok_or("unknown")
    }
    fn save(&mut self, next: Saved) -> Result<(), Failure> {
        next.validate()?;
        let bytes = serde_json::to_vec(&next).map_err(|_| "invalid-policy")?;
        if bytes.len() > MAX_BYTES {
            return Err("resource-limit");
        }
        if persist(&self.root, &bytes).is_err() {
            self.faulted = true;
            return Err("unknown");
        }
        self.saved = next;
        Ok(())
    }
}
fn persist(root: &Path, bytes: &[u8]) -> std::io::Result<()> {
    fs::create_dir_all(root)?;
    let pending = root.join(format!(
        "credential-bindings.{}.pending",
        uuid::Uuid::new_v4()
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&pending)?;
    let written = file
        .write_all(bytes)
        .and_then(|_| file.sync_all())
        .and_then(|_| fs::rename(&pending, root.join("credential-bindings.json")));
    if let Err(error) = written {
        let _ = fs::remove_file(&pending);
        return Err(error);
    }
    std::fs::File::open(root)?.sync_all()
}

#[cfg(test)]
#[path = "credential_bindings_tests.rs"]
mod tests;
