mod generated;

pub use generated::programs::WEN_TRANSFER_GUARD_ID as ID;
pub use generated::*;

#[cfg(test)]
mod tests {
    use solana_address::Address;

    #[test]
    fn execute_auto_derives_guard_from_guard_mint() {
        let mint = Address::new_from_array([2u8; 32]);
        let guard_mint = Address::new_from_array([7u8; 32]);
        let ix = crate::instructions::ExecuteBuilder::new(
            Address::new_from_array([1u8; 32]), // source_account
            mint,                               // mint
            Address::new_from_array([3u8; 32]), // destination_account
            Address::new_from_array([4u8; 32]), // owner_delegate
            42,                                 // amount
            guard_mint,
        )
        .instruction();

        let expected = crate::pdas::find_guard_pda(&guard_mint).0;
        assert_eq!(ix.accounts[5].pubkey, expected, "guard");
        // The seed must come from `guard_mint`, not the instruction's `mint` account.
        assert_ne!(ix.accounts[5].pubkey, crate::pdas::find_guard_pda(&mint).0);
    }

    #[test]
    fn initialize_auto_derives_guard_from_guard_mint() {
        let guard_mint = Address::new_from_array([9u8; 32]);
        let ix = crate::instructions::InitializeBuilder::new(
            Address::new_from_array([1u8; 32]), // mint
            Address::new_from_array([2u8; 32]), // transfer_hook_authority
            Address::new_from_array([3u8; 32]), // payer
            guard_mint,
        )
        .instruction();

        let expected = crate::pdas::find_guard_pda(&guard_mint).0;
        assert_eq!(ix.accounts[1].pubkey, expected, "guard");
    }
}
