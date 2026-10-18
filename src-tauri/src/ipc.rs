//! Small wire declarations for the shapes used by the native bridge.
use std::collections::BTreeMap;

pub trait Wire {
    fn typescript() -> String;
    fn optional() -> bool {
        false
    }
}
pub trait Output {
    fn response() -> String;
    fn error() -> String;
}
impl<T: Wire> Output for T {
    fn response() -> String {
        T::typescript()
    }
    fn error() -> String {
        "never".into()
    }
}
impl<T: Wire, E: Wire> Output for Result<T, E> {
    fn response() -> String {
        T::typescript()
    }
    fn error() -> String {
        E::typescript()
    }
}
macro_rules! scalar {
    ($($ty:ty => $ts:literal),* $(,)?) => {$(
        impl Wire for $ty { fn typescript() -> String { $ts.into() } }
    )*};
}
scalar!(String => "string", &'static str => "string", bool => "boolean",
    usize => "number", u16 => "number", u32 => "number", u64 => "number",
    () => "null", serde_json::Value => "unknown");
impl<T: Wire> Wire for Vec<T> {
    fn typescript() -> String {
        format!("Array<{}>", T::typescript())
    }
}
impl<T: Wire> Wire for Option<T> {
    fn optional() -> bool {
        true
    }
    fn typescript() -> String {
        format!("{} | null", T::typescript())
    }
}
impl<T: Wire> Wire for BTreeMap<String, T> {
    fn typescript() -> String {
        format!("Record<string, {}>", T::typescript())
    }
}
// Injected native arguments do not cross the WebView bridge.
impl Wire for tauri::AppHandle {
    fn typescript() -> String {
        String::new()
    }
}
impl<T: Send + Sync> Wire for tauri::State<'_, T> {
    fn typescript() -> String {
        String::new()
    }
}
pub fn camel_case(name: &str) -> String {
    let mut upper = false;
    name.chars()
        .filter_map(|ch| {
            if ch == '_' {
                upper = true;
                None
            } else if upper {
                upper = false;
                Some(ch.to_ascii_uppercase())
            } else {
                Some(ch)
            }
        })
        .collect()
}
pub fn object(fields: Vec<(&str, String, bool)>) -> String {
    object_case(fields, "camelCase")
}
pub fn object_case(fields: Vec<(&str, String, bool)>, case: &str) -> String {
    assert!(
        matches!(case, "camelCase" | "snake_case"),
        "unsupported IPC field naming"
    );
    let fields: Vec<_> = fields
        .into_iter()
        .filter(|(_, ty, _)| !ty.is_empty())
        .map(|(name, ty, optional)| {
            format!(
                "{}{}: {}",
                if case == "camelCase" {
                    camel_case(name)
                } else {
                    name.into()
                },
                if optional { "?" } else { "" },
                ty
            )
        })
        .collect();
    if fields.is_empty() {
        "Record<string, never>".into()
    } else {
        format!("{{ {} }}", fields.join("; "))
    }
}
pub fn command(name: &str, args: String, response: String, error: String) -> String {
    format!("  {name}: {{ args: {args}; response: {response}; error: {error} }};\n")
}

macro_rules! wire_object {
    (#[derive($($derive:path),*)]
    $(#[serde($deny:ident)])?
    $vis:vis struct $name:ident, rename_all = $case:literal {
        $($field_vis:vis $field:ident : $ty:ty $(= $default:ident)?),* $(,)?
    }) => {
        #[derive($($derive),*)]
        $(#[serde($deny)])?
        #[serde(rename_all = $case)]
        $vis struct $name {
            $($(#[serde($default)])? $field_vis $field: $ty),*
        }
        impl crate::ipc::Wire for $name {
            fn typescript() -> String {
                crate::ipc::object_case(vec![$((stringify!($field), <$ty as crate::ipc::Wire>::typescript(), !concat!($(stringify!($default))?).is_empty())),*], $case)
            }
        }
    };
}
macro_rules! wire_enum {
    (#[derive($($derive:path),*)]
    $(#[serde($deny:ident)])?
    $vis:vis enum $name:ident $(, tag = $tag:literal)? {
        $($(#[$variant_attr:ident])? $variant:ident => $wire:literal $({$($field:ident : $ty:ty),* $(,)?})?),* $(,)?
    }) => {
        #[derive($($derive),*)]
        $(#[serde($deny)])?
        $(#[serde(tag = $tag)])?
        $vis enum $name {
            $($(#[$variant_attr])? #[serde(rename = $wire)] $variant $({$($field: $ty),*})?),*
        }
        impl crate::ipc::Wire for $name {
            fn typescript() -> String {
                let tag = concat!($($tag)?);
                let variants = vec![$({
                    let literal = format!("{:?}", $wire);
                    if tag.is_empty() { literal } else {
                        let fields = vec![(tag, literal, false) $(, $( (stringify!($field), <$ty as crate::ipc::Wire>::typescript(), false) ),*)?];
                        crate::ipc::object_case(fields, "snake_case")
                    }
                }),*];
                variants.join(" | ")
            }
        }
    };
}
macro_rules! ipc_command {
    ($(#[$attr:meta])* $vis:vis fn $name:ident ($($arg:ident : $ty:ty),* $(,)?) -> $ret:ty $body:block) => {
        $(#[$attr])* #[tauri::command] $vis fn $name($($arg: $ty),*) -> $ret $body
        ipc_command!(@metadata $name ($($arg: $ty),*) -> $ret);
    };
    ($(#[$attr:meta])* $vis:vis async fn $name:ident ($($arg:ident : $ty:ty),* $(,)?) -> $ret:ty $body:block) => {
        $(#[$attr])* #[tauri::command] $vis async fn $name($($arg: $ty),*) -> $ret $body
        ipc_command!(@metadata $name ($($arg: $ty),*) -> $ret);
    };
    (@metadata $name:ident ($($arg:ident : $ty:ty),*) -> $ret:ty) => {
        pub mod $name {
            #[allow(unused_imports)]
            use super::*;
            pub fn contract() -> String {
                crate::ipc::command(stringify!($name), crate::ipc::object(vec![$(
                    (stringify!($arg), <$ty as crate::ipc::Wire>::typescript(), <$ty as crate::ipc::Wire>::optional())
                ),*]), <$ret as crate::ipc::Output>::response(), <$ret as crate::ipc::Output>::error())
            }
        }
    };
}
pub(crate) use {ipc_command, wire_enum, wire_object};
