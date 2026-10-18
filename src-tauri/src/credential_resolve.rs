//! Read-only lookup of a binding for one credential request.
use super::{alias, owner, Bindings, Failure, Status, View};

impl Bindings {
    /// The ready binding and its current secret reference. A binding with a
    /// management action in progress is busy rather than half-changed.
    pub fn resolve(&self, identity: &str, name: &str) -> Result<(View, String), Failure> {
        if !owner(identity) || !alias(name) {
            return Err("invalid-request");
        }
        let inner = self.0.lock().map_err(|_| "unknown")?;
        if inner.faulted {
            return Err("unavailable");
        }
        let key = format!("{identity}:{name}");
        if inner
            .active
            .as_ref()
            .is_some_and(|active| active.key == key)
        {
            return Err("busy");
        }
        let binding = inner.saved.bindings.get(&key).ok_or("missing")?;
        match (&binding.view.status, &binding.reference) {
            (Status::Ready, Some(reference)) => Ok((binding.view.clone(), reference.clone())),
            _ => Err("not-ready"),
        }
    }
}
