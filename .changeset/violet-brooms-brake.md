---
'@codama/renderers-rust': major
---

Make generated Rust clients `no_std`-compatible by default.

Generated Rust output now emits `extern crate alloc`, replaces `std` collection and string usage with `alloc`-backed equivalents, and fails rendering if any `std::` references remain in generated files.

This changes part of the generated API surface:
- map and set types now use `BTreeMap` and `BTreeSet`
- generated scalar enums now also derive `Ord` by default
- Borsh serialization and deserialization helpers now return `borsh::io::Error` instead of `std::io::Error`

When syncing Cargo dependencies, the renderer now disables default features for crates that would otherwise pull in `std` and upgrades `thiserror` to v2 with `default-features = false`.

This is a breaking change because upgrading changes generated Rust types, error types, and synced Cargo dependency declarations for existing clients.
