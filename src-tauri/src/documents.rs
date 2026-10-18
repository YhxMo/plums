//! Session-only selected-document access. No paths, URIs, or persistent grants cross IPC.
use crate::ipc::{ipc_command, wire_enum, wire_object};
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

wire_object! {
#[derive(Clone, Debug, Serialize)]
pub struct Descriptor, rename_all = "camelCase" { handle: String, name: String }
}
wire_enum! {
#[derive(Debug, Serialize)]
pub enum SelectResponse, tag = "status" {
    Selected => "selected" { documents: Vec<Descriptor> }, Cancelled => "cancelled",
    Rejected => "rejected" { reason: &'static str }, Unknown => "unknown"
}
}
wire_enum! {
#[derive(Debug, Serialize)]
pub enum ReadResponse, tag = "status" {
    Read => "read" { text: String, bytes: usize }, Cancelled => "cancelled",
    Rejected => "rejected" { reason: &'static str }, Unknown => "unknown"
}
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
ipc_command! {
pub fn document_supported() -> bool {
    cfg!(any(target_os = "macos", target_os = "android"))
}
}
ipc_command! {
pub fn document_list(
    owner: String,
    state: tauri::State<'_, Documents>,
) -> Result<Vec<Descriptor>, String> {
    state.list(&owner).map_err(str::to_owned)
}
}
ipc_command! {
pub fn document_cancel(
    owner: String,
    operation_id: String,
    state: tauri::State<'_, Documents>,
) -> Result<(), String> {
    state.cancel(&owner, &operation_id).map_err(str::to_owned)
}
}
ipc_command! {
pub fn document_revoke(
    owner: String,
    handle: Option<String>,
    state: tauri::State<'_, Documents>,
) -> Result<(), String> {
    state
        .revoke(&owner, handle.as_deref())
        .map_err(str::to_owned)
}
}
ipc_command! {
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
}
ipc_command! {
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
}

mod native;
#[cfg(target_os = "android")]
pub use native::AndroidDocuments;
use native::{read_native, select_native};
#[cfg(test)]
mod tests;
