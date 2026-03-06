---
'@codama/renderers-rust': major
---

Switch generated Rust code from `solana_pubkey::Pubkey` to `solana_address::Address` and update the default dependency set to newer Solana 3.x and `borsh` 1.0 versions. This affects generated program IDs, account/instruction types, PDA helpers, and public key literals, so downstream users may need to update imports and pubkey usage after regenerating clients.
