//! Read-side binding queries for listing and requests, and the user's consent
//! to send with a binding, which lapses when its revision changes.
use super::{alias, owner, Bindings, Failure, Status, View};

impl Bindings {
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
    /// Whether the user allowed sends with this exact binding revision.
    pub fn consented(&self, view: &View) -> bool {
        self.0.lock().is_ok_and(|inner| {
            inner
                .saved
                .bindings
                .get(&format!("{}:{}", view.owner, view.alias))
                .is_some_and(|binding| {
                    binding.view.revision == view.revision
                        && binding.consented == Some(view.revision)
                })
        })
    }
    /// Remember the consent across restarts; a stale revision is not recorded.
    pub fn consent(&self, view: &View) -> Result<(), Failure> {
        let mut inner = self.0.lock().map_err(|_| "unknown")?;
        if inner.faulted {
            return Err("unavailable");
        }
        let key = format!("{}:{}", view.owner, view.alias);
        let mut next = inner.saved.clone();
        let binding = next.bindings.get_mut(&key).ok_or("missing")?;
        if binding.view.revision != view.revision {
            return Err("stale");
        }
        binding.consented = Some(view.revision);
        inner.save(next)
    }
}
