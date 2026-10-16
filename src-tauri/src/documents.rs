//! Session-only selected-document access. No paths, URIs, or persistent grants cross IPC.
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tauri::Manager;

const OWNER_HANDLES: usize = 8;
const TOTAL_HANDLES: usize = 32;
const OWNER_OPERATIONS: usize = 1024;
const TOTAL_OPERATIONS: usize = 4096;
const TOTAL_OWNERS: usize = 32;

#[derive(Clone, Debug, Serialize)]
pub struct Descriptor {
    handle: String,
    name: String,
}
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum SelectResponse {
    Selected { documents: Vec<Descriptor> },
    Cancelled,
    Rejected { reason: &'static str },
    Unknown,
}
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum ReadResponse {
    Read { text: String, bytes: usize },
    Cancelled,
    Rejected { reason: &'static str },
    Unknown,
}
#[derive(Clone)]
enum Source {
    #[cfg(target_os = "macos")]
    File(Arc<Mutex<std::fs::File>>),
    #[cfg(target_os = "android")]
    Uri(String),
    #[cfg(test)]
    Test(Vec<u8>),
}
struct SelectedSource {
    name: String,
    source: Source,
}
struct Binding {
    owner: String,
    descriptor: Descriptor,
    source: Source,
}
#[derive(Default)]
struct Owner {
    allowed: bool,
    generation: u64,
}
struct Operation {
    generation: u64,
    active: bool,
    cancelled: bool,
}
#[derive(Default)]
struct Inner {
    owners: HashMap<String, Owner>,
    bindings: HashMap<String, Arc<Binding>>,
    operations: HashMap<(String, String), Operation>,
    picker: Option<(String, String)>,
}
#[derive(Clone, Default)]
pub struct Documents(Arc<Mutex<Inner>>);
#[derive(Debug)]
struct Ticket {
    owner: String,
    id: String,
    generation: u64,
}
struct ReadTicket {
    operation: Ticket,
    binding: Arc<Binding>,
    max_bytes: usize,
}
impl std::fmt::Debug for ReadTicket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ReadTicket")
    }
}
fn valid_owner(owner: &str) -> bool {
    !owner.is_empty()
        && owner.len() <= 96
        && !owner.contains("..")
        && owner
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'.')
}
fn valid_operation(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}
impl Documents {
    #[cfg(test)]
    fn grant(&self, owner: &str, allowed: bool) -> Result<(), &'static str> {
        self.grant_with(owner, allowed, || Ok(()))
    }
    pub fn grant_with(
        &self,
        owner: &str,
        allowed: bool,
        apply: impl FnOnce() -> Result<(), &'static str>,
    ) -> Result<(), &'static str> {
        if !valid_owner(owner) {
            return Err("invalid-request");
        }
        let mut inner = self.0.lock().map_err(|_| "unknown")?;
        if !inner.owners.contains_key(owner) {
            if !allowed {
                return apply();
            }
            if inner.owners.len() >= TOTAL_OWNERS {
                return Err("resource-limit");
            }
        }
        apply()?;
        let state = inner.owners.entry(owner.into()).or_default();
        if state.allowed && !allowed {
            state.generation += 1;
            inner.bindings.retain(|_, binding| binding.owner != owner);
        }
        inner.owners.get_mut(owner).unwrap().allowed = allowed;
        Ok(())
    }
    fn begin(&self, owner: &str, id: &str, picker: bool) -> Result<Ticket, &'static str> {
        if !valid_owner(owner) || !valid_operation(id) {
            return Err("invalid-request");
        }
        let mut inner = self.0.lock().map_err(|_| "unknown")?;
        let generation = inner
            .owners
            .get(owner)
            .filter(|state| state.allowed)
            .ok_or("denied")?
            .generation;
        let key = (owner.into(), id.into());
        if let Some(previous) = inner.operations.get(&key) {
            return Err(if previous.cancelled {
                "cancelled"
            } else {
                "invalid-request"
            });
        }
        let owned: Vec<_> = inner
            .operations
            .iter()
            .filter(|(key, _)| key.0 == owner)
            .map(|(_, operation)| operation)
            .collect();
        if owned.len() >= OWNER_OPERATIONS
            || inner.operations.len() >= TOTAL_OPERATIONS
            || owned.iter().filter(|operation| operation.active).count() >= 8
            || inner
                .operations
                .values()
                .filter(|operation| operation.active)
                .count()
                >= 32
        {
            return Err("resource-limit");
        }
        if picker && inner.picker.is_some() {
            return Err("busy");
        }
        inner.operations.insert(
            key.clone(),
            Operation {
                generation,
                active: true,
                cancelled: false,
            },
        );
        if picker {
            inner.picker = Some(key);
        }
        Ok(Ticket {
            owner: owner.into(),
            id: id.into(),
            generation,
        })
    }
    fn live(inner: &Inner, ticket: &Ticket) -> bool {
        inner
            .owners
            .get(&ticket.owner)
            .is_some_and(|owner| owner.allowed && owner.generation == ticket.generation)
            && inner
                .operations
                .get(&(ticket.owner.clone(), ticket.id.clone()))
                .is_some_and(|operation| {
                    operation.active
                        && !operation.cancelled
                        && operation.generation == ticket.generation
                })
    }
    fn finish(inner: &mut Inner, ticket: &Ticket) {
        let key = (ticket.owner.clone(), ticket.id.clone());
        if let Some(operation) = inner.operations.get_mut(&key) {
            operation.active = false;
        }
        if inner.picker.as_ref() == Some(&key) {
            inner.picker = None;
        }
    }
    fn finish_select(
        &self,
        ticket: Ticket,
        result: Result<Option<Vec<SelectedSource>>, &'static str>,
    ) -> SelectResponse {
        let Ok(mut inner) = self.0.lock() else {
            return SelectResponse::Unknown;
        };
        let live = Self::live(&inner, &ticket);
        Self::finish(&mut inner, &ticket);
        if !live {
            return SelectResponse::Cancelled;
        }
        let selected = match result {
            Ok(Some(selected)) => selected,
            Ok(None) => return SelectResponse::Cancelled,
            Err("unknown") => return SelectResponse::Unknown,
            Err(reason) => return SelectResponse::Rejected { reason },
        };
        let existing = inner
            .bindings
            .values()
            .filter(|binding| binding.owner == ticket.owner)
            .count();
        if selected.is_empty()
            || selected.len() + existing > OWNER_HANDLES
            || selected.len() + inner.bindings.len() > TOTAL_HANDLES
        {
            return SelectResponse::Rejected {
                reason: "resource-limit",
            };
        }
        let mut descriptors = Vec::new();
        for selected in selected {
            let descriptor = Descriptor {
                handle: uuid::Uuid::new_v4().to_string(),
                name: clean_name(&selected.name),
            };
            inner.bindings.insert(
                descriptor.handle.clone(),
                Arc::new(Binding {
                    owner: ticket.owner.clone(),
                    descriptor: descriptor.clone(),
                    source: selected.source,
                }),
            );
            descriptors.push(descriptor);
        }
        SelectResponse::Selected {
            documents: descriptors,
        }
    }
    pub fn list(&self, owner: &str) -> Result<Vec<Descriptor>, &'static str> {
        if !valid_owner(owner) {
            return Err("invalid-request");
        }
        let inner = self.0.lock().map_err(|_| "unknown")?;
        if !inner.owners.get(owner).is_some_and(|owner| owner.allowed) {
            return Err("denied");
        }
        let mut documents: Vec<_> = inner
            .bindings
            .values()
            .filter(|binding| binding.owner == owner)
            .map(|binding| binding.descriptor.clone())
            .collect();
        documents.sort_by(|a, b| a.handle.cmp(&b.handle));
        Ok(documents)
    }
    fn begin_read(
        &self,
        owner: &str,
        handle: &str,
        max_bytes: usize,
        id: &str,
    ) -> Result<ReadTicket, ReadResponse> {
        if handle.is_empty() || handle.len() > 128 || !(1..=65536).contains(&max_bytes) {
            return Err(ReadResponse::Rejected {
                reason: "invalid-request",
            });
        }
        let operation = self.begin(owner, id, false).map_err(read_failure)?;
        let mut inner = self.0.lock().map_err(|_| ReadResponse::Unknown)?;
        if !Self::live(&inner, &operation) {
            Self::finish(&mut inner, &operation);
            return Err(ReadResponse::Cancelled);
        }
        let binding = inner
            .bindings
            .get(handle)
            .filter(|binding| binding.owner == owner)
            .cloned();
        match binding {
            Some(binding) => Ok(ReadTicket {
                operation,
                binding,
                max_bytes,
            }),
            None => {
                Self::finish(&mut inner, &operation);
                Err(ReadResponse::Rejected { reason: "denied" })
            }
        }
    }
    fn finish_read(
        &self,
        ticket: ReadTicket,
        result: Result<String, &'static str>,
    ) -> ReadResponse {
        let Ok(mut inner) = self.0.lock() else {
            return ReadResponse::Unknown;
        };
        let live = Self::live(&inner, &ticket.operation);
        let bound = inner
            .bindings
            .get(&ticket.binding.descriptor.handle)
            .is_some_and(|binding| Arc::ptr_eq(binding, &ticket.binding));
        Self::finish(&mut inner, &ticket.operation);
        if !live {
            return ReadResponse::Cancelled;
        }
        if !bound {
            return ReadResponse::Rejected { reason: "denied" };
        }
        match result {
            Ok(text) if text.len() <= ticket.max_bytes => ReadResponse::Read {
                bytes: text.len(),
                text,
            },
            Ok(_) => ReadResponse::Rejected {
                reason: "too-large",
            },
            Err(reason) => read_failure(reason),
        }
    }
    pub fn cancel(&self, owner: &str, id: &str) -> Result<(), &'static str> {
        if !valid_owner(owner) || !valid_operation(id) {
            return Err("invalid-request");
        }
        let mut inner = self.0.lock().map_err(|_| "unknown")?;
        let generation = inner.owners.get(owner).ok_or("denied")?.generation;
        let key = (owner.into(), id.into());
        if let Some(operation) = inner.operations.get_mut(&key) {
            operation.cancelled = true;
            return Ok(());
        }
        if inner.operations.len() >= TOTAL_OPERATIONS
            || inner.operations.keys().filter(|key| key.0 == owner).count() >= OWNER_OPERATIONS
        {
            return Err("resource-limit");
        }
        inner.operations.insert(
            key,
            Operation {
                generation,
                active: false,
                cancelled: true,
            },
        );
        Ok(())
    }
    pub fn revoke(&self, owner: &str, handle: Option<&str>) -> Result<(), &'static str> {
        if !valid_owner(owner) {
            return Err("invalid-request");
        }
        let mut inner = self.0.lock().map_err(|_| "unknown")?;
        if let Some(handle) = handle {
            if inner
                .bindings
                .get(handle)
                .is_some_and(|binding| binding.owner == owner)
            {
                inner.bindings.remove(handle);
            }
        } else {
            if let Some(state) = inner.owners.get_mut(owner) {
                state.generation += 1;
            }
            inner.bindings.retain(|_, binding| binding.owner != owner);
        }
        Ok(())
    }
}
fn clean_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !c.is_control() && *c != '/' && *c != '\\')
        .take(160)
        .collect();
    if cleaned.trim().is_empty() {
        "Selected document".into()
    } else {
        cleaned
    }
}
fn read_failure(reason: &'static str) -> ReadResponse {
    match reason {
        "cancelled" => ReadResponse::Cancelled,
        "unknown" => ReadResponse::Unknown,
        reason => ReadResponse::Rejected { reason },
    }
}
#[cfg(any(target_os = "macos", test))]
fn decode_bytes(bytes: Vec<u8>, max_bytes: usize) -> Result<String, &'static str> {
    if bytes.len() > max_bytes {
        return Err("too-large");
    }
    String::from_utf8(bytes).map_err(|_| "encoding")
}
#[tauri::command]
pub fn document_supported() -> bool {
    cfg!(any(target_os = "macos", target_os = "android"))
}
#[tauri::command]
pub fn document_list(
    owner: String,
    state: tauri::State<'_, Documents>,
) -> Result<Vec<Descriptor>, String> {
    state.list(&owner).map_err(str::to_owned)
}
#[tauri::command]
pub fn document_cancel(
    owner: String,
    operation_id: String,
    state: tauri::State<'_, Documents>,
) -> Result<(), String> {
    state.cancel(&owner, &operation_id).map_err(str::to_owned)
}
#[tauri::command]
pub fn document_revoke(
    owner: String,
    handle: Option<String>,
    state: tauri::State<'_, Documents>,
) -> Result<(), String> {
    state
        .revoke(&owner, handle.as_deref())
        .map_err(str::to_owned)
}
#[tauri::command]
pub async fn document_select(
    app: tauri::AppHandle,
    owner: String,
    multiple: bool,
    operation_id: String,
) -> SelectResponse {
    let state = app.state::<Documents>().inner().clone();
    if !document_supported() {
        return SelectResponse::Rejected {
            reason: "unavailable",
        };
    }
    let ticket = match state.begin(&owner, &operation_id, true) {
        Ok(ticket) => ticket,
        Err("cancelled") => return SelectResponse::Cancelled,
        Err("unknown") => return SelectResponse::Unknown,
        Err(reason) => return SelectResponse::Rejected { reason },
    };
    let result = select_native(app, multiple).await;
    state.finish_select(ticket, result)
}
#[tauri::command]
pub async fn document_read(
    app: tauri::AppHandle,
    owner: String,
    handle: String,
    max_bytes: usize,
    operation_id: String,
) -> ReadResponse {
    let state = app.state::<Documents>().inner().clone();
    if !document_supported() {
        return ReadResponse::Rejected {
            reason: "unavailable",
        };
    }
    let ticket = match state.begin_read(&owner, &handle, max_bytes, &operation_id) {
        Ok(ticket) => ticket,
        Err(response) => return response,
    };
    let result = read_native(app, ticket.binding.source.clone(), max_bytes).await;
    state.finish_read(ticket, result)
}

#[cfg(target_os = "macos")]
async fn select_native(
    app: tauri::AppHandle,
    multiple: bool,
) -> Result<Option<Vec<SelectedSource>>, &'static str> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let result = (|| {
            let marker = MainThreadMarker::new().ok_or("unavailable")?;
            let panel = NSOpenPanel::openPanel(marker);
            panel.setCanChooseFiles(true);
            panel.setCanChooseDirectories(false);
            panel.setAllowsMultipleSelection(multiple);
            panel.setCanCreateDirectories(false);
            panel.setTreatsFilePackagesAsDirectories(false);
            if panel.runModal() != NSModalResponseOK {
                return Ok(None);
            }
            let urls = panel.URLs();
            if urls.len() > OWNER_HANDLES {
                return Err("resource-limit");
            }
            let mut paths = Vec::new();
            for url in urls.iter() {
                if !url.isFileURL() {
                    return Err("denied");
                }
                let path = url.path().ok_or("io")?.to_string();
                let name = url
                    .lastPathComponent()
                    .map(|name| name.to_string())
                    .unwrap_or_else(|| "Selected document".into());
                paths.push((path, name));
            }
            Ok(Some(paths))
        })();
        let _ = send.send(result);
    })
    .map_err(|_| "unavailable")?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(paths) = receive.recv().map_err(|_| "unknown")?? else {
            return Ok(None);
        };
        let mut selected = Vec::new();
        for (path, name) in paths {
            let file = std::fs::File::open(path).map_err(|_| "io")?;
            if !file.metadata().map_err(|_| "io")?.is_file() {
                return Err("denied");
            }
            selected.push(SelectedSource {
                name,
                source: Source::File(Arc::new(Mutex::new(file))),
            });
        }
        Ok(Some(selected))
    })
    .await
    .map_err(|_| "unknown")?
}
#[cfg(target_os = "macos")]
async fn read_native(
    _app: tauri::AppHandle,
    source: Source,
    max_bytes: usize,
) -> Result<String, &'static str> {
    use std::io::{Read, Seek, SeekFrom};
    tauri::async_runtime::spawn_blocking(move || match source {
        Source::File(file) => {
            let mut file = file.lock().map_err(|_| "unknown")?;
            file.seek(SeekFrom::Start(0)).map_err(|_| "io")?;
            let mut bytes = Vec::new();
            (&mut *file)
                .take(max_bytes as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "io")?;
            decode_bytes(bytes, max_bytes)
        }
        #[cfg(test)]
        Source::Test(bytes) => decode_bytes(bytes, max_bytes),
    })
    .await
    .map_err(|_| "unknown")?
}
#[cfg(target_os = "android")]
pub struct AndroidDocuments(pub tauri::plugin::PluginHandle<tauri::Wry>);
#[cfg(target_os = "android")]
async fn select_native(
    app: tauri::AppHandle,
    multiple: bool,
) -> Result<Option<Vec<SelectedSource>>, &'static str> {
    use tauri::Manager;
    let response: serde_json::Value = app
        .state::<AndroidDocuments>()
        .0
        .run_mobile_plugin_async("select", serde_json::json!({ "multiple": multiple }))
        .await
        .map_err(|_| "unknown")?;
    match response.get("status").and_then(serde_json::Value::as_str) {
        Some("cancelled") => Ok(None),
        Some("selected") => {
            let documents = response
                .get("documents")
                .and_then(serde_json::Value::as_array)
                .ok_or("unknown")?;
            if documents.is_empty() || documents.len() > OWNER_HANDLES {
                return Err("resource-limit");
            }
            documents
                .iter()
                .map(|document| {
                    let uri = document
                        .get("uri")
                        .and_then(serde_json::Value::as_str)
                        .ok_or("unknown")?;
                    if !uri.starts_with("content://") || uri.len() > 8192 {
                        return Err("denied");
                    }
                    let name = document
                        .get("name")
                        .and_then(serde_json::Value::as_str)
                        .ok_or("unknown")?;
                    Ok(SelectedSource {
                        name: name.into(),
                        source: Source::Uri(uri.into()),
                    })
                })
                .collect::<Result<Vec<_>, _>>()
                .map(Some)
        }
        Some("rejected") => Err(native_reason(&response)),
        _ => Err("unknown"),
    }
}
#[cfg(target_os = "android")]
async fn read_native(
    app: tauri::AppHandle,
    source: Source,
    max_bytes: usize,
) -> Result<String, &'static str> {
    use tauri::Manager;
    let uri = match source {
        Source::Uri(uri) => uri,
        #[cfg(test)]
        Source::Test(bytes) => return decode_bytes(bytes, max_bytes),
    };
    let response: serde_json::Value = app
        .state::<AndroidDocuments>()
        .0
        .run_mobile_plugin_async(
            "read",
            serde_json::json!({ "uri": uri, "maxBytes": max_bytes }),
        )
        .await
        .map_err(|_| "unknown")?;
    match response.get("status").and_then(serde_json::Value::as_str) {
        Some("read") => {
            let text = response
                .get("text")
                .and_then(serde_json::Value::as_str)
                .ok_or("unknown")?;
            if text.len() > max_bytes {
                return Err("too-large");
            }
            Ok(text.into())
        }
        Some("rejected") => Err(native_reason(&response)),
        _ => Err("unknown"),
    }
}
#[cfg(target_os = "android")]
fn native_reason(value: &serde_json::Value) -> &'static str {
    match value.get("reason").and_then(serde_json::Value::as_str) {
        Some("denied") => "denied",
        Some("unavailable") => "unavailable",
        Some("resource-limit") => "resource-limit",
        Some("too-large") => "too-large",
        Some("encoding") => "encoding",
        Some("io") => "io",
        _ => "unknown",
    }
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
async fn select_native(
    _app: tauri::AppHandle,
    _multiple: bool,
) -> Result<Option<Vec<SelectedSource>>, &'static str> {
    Err("unavailable")
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
async fn read_native(
    _app: tauri::AppHandle,
    _source: Source,
    _max_bytes: usize,
) -> Result<String, &'static str> {
    Err("unavailable")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn broker() -> Documents {
        let broker = Documents::default();
        broker.grant("sample", true).unwrap();
        broker
    }
    fn source() -> SelectedSource {
        SelectedSource {
            name: "test.txt".into(),
            source: Source::Test(b"safe text".to_vec()),
        }
    }
    fn selected(broker: &Documents, operation: &str) -> String {
        let ticket = broker.begin("sample", operation, true).unwrap();
        match broker.finish_select(ticket, Ok(Some(vec![source()]))) {
            SelectResponse::Selected { documents } => documents[0].handle.clone(),
            other => panic!("{other:?}"),
        }
    }
    #[test]
    fn handles_are_owner_bound_and_revocation_is_final() {
        let broker = broker();
        let handle = selected(&broker, "pick");
        broker.grant("other", true).unwrap();
        assert_eq!(broker.list("other").unwrap().len(), 0);
        assert!(matches!(
            broker.begin_read("other", &handle, 64, "cross"),
            Err(ReadResponse::Rejected { reason: "denied" })
        ));
        broker.revoke("other", Some(&handle)).unwrap();
        assert_eq!(broker.list("sample").unwrap().len(), 1);
        broker.revoke("sample", Some(&handle)).unwrap();
        assert!(matches!(
            broker.begin_read("sample", &handle, 64, "old"),
            Err(ReadResponse::Rejected { reason: "denied" })
        ));
    }
    #[test]
    fn cancelled_selection_and_late_grant_generation_do_not_bind() {
        let broker = broker();
        let ticket = broker.begin("sample", "cancel-picker", true).unwrap();
        broker.cancel("sample", "cancel-picker").unwrap();
        assert!(matches!(
            broker.finish_select(ticket, Ok(Some(vec![source()]))),
            SelectResponse::Cancelled
        ));
        let ticket = broker.begin("sample", "old-picker", true).unwrap();
        broker.revoke("sample", None).unwrap();
        assert!(matches!(
            broker.finish_select(ticket, Ok(Some(vec![source()]))),
            SelectResponse::Cancelled
        ));
        assert!(broker.list("sample").unwrap().is_empty());
        let ticket = broker.begin("sample", "decline", true).unwrap();
        assert!(matches!(
            broker.finish_select(ticket, Ok(None)),
            SelectResponse::Cancelled
        ));
    }
    #[test]
    fn pre_cancel_and_reused_operation_cannot_start_even_after_release() {
        let broker = broker();
        broker.cancel("sample", "before").unwrap();
        broker.revoke("sample", None).unwrap();
        assert!(matches!(
            broker.begin("sample", "before", false),
            Err("cancelled")
        ));
        selected(&broker, "once");
        assert!(matches!(
            broker.begin("sample", "once", false),
            Err("invalid-request")
        ));
    }
    #[test]
    fn selection_capacity_is_atomic_and_no_existing_handle_is_evicted() {
        let broker = broker();
        for i in 0..7 {
            selected(&broker, &format!("pick-{i}"));
        }
        let ticket = broker.begin("sample", "too-many", true).unwrap();
        assert!(matches!(
            broker.finish_select(ticket, Ok(Some(vec![source(), source()]))),
            SelectResponse::Rejected {
                reason: "resource-limit"
            }
        ));
        assert_eq!(broker.list("sample").unwrap().len(), 7);
        selected(&broker, "last");
        assert_eq!(broker.list("sample").unwrap().len(), 8);
    }
    #[test]
    fn reads_recheck_cancellation_revocation_and_grant_after_io() {
        for mode in 0..3 {
            let broker = broker();
            let handle = selected(&broker, "pick");
            let ticket = broker.begin_read("sample", &handle, 64, "read").unwrap();
            match mode {
                0 => broker.cancel("sample", "read").unwrap(),
                1 => broker.revoke("sample", Some(&handle)).unwrap(),
                _ => broker.grant("sample", false).unwrap(),
            }
            assert!(!matches!(
                broker.finish_read(ticket, Ok("private".into())),
                ReadResponse::Read { .. }
            ));
        }
    }
    #[test]
    fn byte_limit_utf8_errors_and_fixed_failures_have_no_payload() {
        assert!(matches!(decode_bytes(vec![0xff], 64), Err("encoding")));
        assert!(matches!(
            decode_bytes("梅子".as_bytes().to_vec(), 5),
            Err("too-large")
        ));
        let broker = broker();
        let handle = selected(&broker, "pick");
        for bytes in [0, 65537] {
            assert!(matches!(
                broker.begin_read("sample", &handle, bytes, &format!("bad-{bytes}")),
                Err(ReadResponse::Rejected {
                    reason: "invalid-request"
                })
            ));
        }
        let ticket = broker.begin_read("sample", &handle, 64, "read").unwrap();
        let response = broker.finish_read(ticket, Err("io"));
        assert_eq!(
            serde_json::to_string(&response).unwrap(),
            r#"{"status":"rejected","reason":"io"}"#
        );
    }
    #[test]
    fn global_capacity_picker_busy_pending_and_operation_budgets_are_bounded() {
        let broker = broker();
        let picker = broker.begin("sample", "picker", true).unwrap();
        assert!(matches!(
            broker.begin("sample", "second-picker", true),
            Err("busy")
        ));
        broker.finish_select(picker, Ok(None));
        let tickets: Vec<_> = (0..8)
            .map(|i| broker.begin("sample", &format!("hold-{i}"), false).unwrap())
            .collect();
        assert!(matches!(
            broker.begin("sample", "ninth", false),
            Err("resource-limit")
        ));
        for ticket in tickets {
            broker.finish_select(ticket, Ok(None));
        }
        for i in 0..1015 {
            broker.cancel("sample", &format!("cancel-{i}")).unwrap();
        }
        assert!(matches!(
            broker.begin("sample", "over-budget", false),
            Err("resource-limit")
        ));
        broker.revoke("sample", None).unwrap();
        assert!(matches!(
            broker.begin("sample", "still-over-budget", false),
            Err("resource-limit")
        ));
        let broker = super::tests::broker();
        for owner in 0..4 {
            let owner = format!("owner-{owner}");
            broker.grant(&owner, true).unwrap();
            let ticket = broker.begin(&owner, "pick", true).unwrap();
            assert!(matches!(
                broker.finish_select(ticket, Ok(Some((0..8).map(|_| source()).collect()))),
                SelectResponse::Selected { .. }
            ));
        }
        let ticket = broker.begin("sample", "global-full", true).unwrap();
        assert!(matches!(
            broker.finish_select(ticket, Ok(Some(vec![source()]))),
            SelectResponse::Rejected {
                reason: "resource-limit"
            }
        ));
    }
    #[test]
    fn owner_budget_and_grant_failure_preserve_existing_bindings() {
        let broker = broker();
        selected(&broker, "pick");
        assert_eq!(
            broker.grant_with("sample", false, || Err("unknown")),
            Err("unknown")
        );
        assert_eq!(broker.list("sample").unwrap().len(), 1);
        for owner in 0..31 {
            broker.grant(&format!("owner-{owner}"), true).unwrap();
        }
        assert_eq!(broker.grant("extra", true), Err("resource-limit"));
        // Owners without document permission do not consume this platform budget.
        assert_eq!(broker.grant("state-only", false), Ok(()));
    }
    #[test]
    fn grants_and_release_do_not_resurrect_old_documents() {
        let broker = broker();
        let handle = selected(&broker, "pick");
        broker.grant("sample", true).unwrap();
        assert_eq!(broker.list("sample").unwrap().len(), 1);
        broker.grant("sample", false).unwrap();
        broker.grant("sample", true).unwrap();
        assert!(broker.list("sample").unwrap().is_empty());
        assert!(matches!(
            broker.begin_read("sample", &handle, 64, "old"),
            Err(ReadResponse::Rejected { reason: "denied" })
        ));
    }
}
