---
'@codama/renderers-rust': patch
---

Support `@codama/nodes@1.10`, whose node array attributes are now optional (`Array<T> | undefined`). Array reads are guarded with `?? []` throughout the renderer, and the new `injectedValueNode` value kind now throws an explicit unsupported-node error rather than being silently mishandled.
