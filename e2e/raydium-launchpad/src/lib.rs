mod generated;

pub use generated::programs::RAYDIUM_LAUNCHPAD_ID as ID;
pub use generated::*;

#[cfg(test)]
mod tests {
    use solana_address::{address, Address};

    fn filler(byte: u8) -> Address {
        Address::new_from_array([byte; 32])
    }

    /// PDAs with a dynamic `programId` (a runtime account reference) must derive
    /// under that program, not the local launchpad program. Expected addresses are
    /// computed independently with codama's `dynamic-address-resolution` package
    /// (the runtime source of truth), using
    /// `market = So11111111111111111111111111111111111111112` and the default
    /// (canonical) amm program `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`.
    #[test]
    fn migrate_to_amm_derives_pdas_under_dynamic_amm_program() {
        let market = address!("So11111111111111111111111111111111111111112");
        let ix = crate::instructions::MigrateToAmmBuilder::new(
            filler(1),  // payer
            filler(2),  // base_mint
            filler(3),  // quote_mint
            market,     // market
            filler(5),  // request_queue
            filler(6),  // event_queue
            filler(7),  // bids
            filler(8),  // asks
            filler(9),  // market_vault_signer
            filler(10), // market_base_vault
            filler(11), // market_quote_vault
            filler(12), // amm_create_fee_destination
            filler(13), // global_config
            filler(14), // base_vault
            filler(15), // quote_vault
            filler(16), // pool_lp_token
            1,          // base_lot_size
            1,          // quote_lot_size
            0,          // market_vault_signer_nonce
        )
        .instruction();

        assert_eq!(
            ix.accounts[13].pubkey,
            address!("2ooeaoRtTBK2EgKFLUKeZVz7SJZo3etuVhHagwPxBegj"),
            "amm_pool"
        );
        assert_eq!(
            ix.accounts[14].pubkey,
            address!("5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"),
            "amm_authority"
        );
        assert_eq!(
            ix.accounts[15].pubkey,
            address!("HUGGGKtDNCKVTWPRVcTXyEJxNchMhhyZjhvUpfqPbka"),
            "amm_open_orders"
        );
        assert_eq!(
            ix.accounts[20].pubkey,
            address!("9DCxsMizn3H1hprZ7xWe6LDzeUeZBksYFpBWBtSf1PQX"),
            "amm_config"
        );
    }

    /// Same as above for the cpswap/lock programs, with
    /// `cpswap_pool = base_mint = quote_mint = So11111111111111111111111111111111111111112`
    /// and the default cpswap/lock programs.
    #[test]
    fn migrate_to_cpswap_derives_pdas_under_dynamic_programs() {
        let shared = address!("So11111111111111111111111111111111111111112");
        let ix = crate::instructions::MigrateToCpswapBuilder::new(
            filler(1),  // payer
            shared,     // base_mint
            shared,     // quote_mint
            filler(4),  // platform_config
            shared,     // cpswap_pool
            filler(6),  // cpswap_config
            filler(7),  // cpswap_create_pool_fee
            filler(8),  // lock_lp_vault
            filler(9),  // global_config
            filler(10), // base_vault
            filler(11), // quote_vault
            filler(12), // pool_lp_token
        )
        .instruction();

        assert_eq!(
            ix.accounts[6].pubkey,
            address!("GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL"),
            "cpswap_authority"
        );
        assert_eq!(
            ix.accounts[7].pubkey,
            address!("CnXtmAN29yi5xNoc47HhtfEER7Ei3F3BBDM9KL6jen6d"),
            "cpswap_lp_mint"
        );
        assert_eq!(
            ix.accounts[14].pubkey,
            address!("3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH"),
            "lock_authority"
        );
    }
}
