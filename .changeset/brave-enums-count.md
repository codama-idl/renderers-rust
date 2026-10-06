---
'@codama/renderers-rust': minor
---

Honor custom variant discriminators when rendering enums. When any variant declares a `discriminator`, the enum is rendered with `#[repr(u8)]`, `#[borsh(use_discriminant = true)]` and an explicit value on every variant (omitted ones fall back to their position), so the generated Borsh layout matches the program instead of numbering variants from zero.
