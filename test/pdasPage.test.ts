import {
    bytesTypeNode,
    constantPdaSeedNode,
    constantPdaSeedNodeFromBytes,
    constantPdaSeedNodeFromString,
    fixedSizeTypeNode,
    numberTypeNode,
    numberValueNode,
    pdaNode,
    programNode,
    publicKeyTypeNode,
    rootNode,
    variablePdaSeedNode,
} from '@codama/nodes';
import { getFromRenderMap } from '@codama/renderers-core';
import { visit } from '@codama/visitors-core';
import { test } from 'vitest';

import { getRenderMapVisitor } from '../src';
import { codeContains, codeDoesNotContains } from './_setup';

test('it renders a standalone PDA with variable seeds', () => {
    // Given a program with a PDA that has variable seeds.
    const node = programNode({
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'myPda',
                seeds: [
                    constantPdaSeedNodeFromString('utf8', 'metadata'),
                    variablePdaSeedNode('mint', publicKeyTypeNode()),
                ],
            }),
        ],
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect a standalone PDA file to be created.
    codeContains(getFromRenderMap(renderMap, 'pdas/my_pda.rs').content, [
        'pub const MY_PDA_SEED: &\'static [u8] = b"metadata";',
        'pub fn create_my_pda_pda(',
        'mint: Address,',
        'bump: u8,',
        'pub fn find_my_pda_pda(',
        'mint: &Address,',
        '-> (solana_address::Address, u8)',
    ]);
});

test('it renders a PDA with only constant seeds', () => {
    // Given a program with a PDA that has only constant seeds.
    const node = programNode({
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'configPda',
                seeds: [
                    constantPdaSeedNodeFromString('utf8', 'config'),
                    constantPdaSeedNode(numberTypeNode('u64'), numberValueNode(1)),
                ],
            }),
        ],
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    codeContains(getFromRenderMap(renderMap, 'pdas/config_pda.rs').content, [
        'pub const CONFIG_PDA_SEED_0: &\'static [u8] = b"config";',
        "pub const CONFIG_PDA_SEED_1: &'static [u8] = &1u64.to_le_bytes();",
        'pub const CONFIG_PDA_ADDRESS: solana_address::Address =',
        'solana_address::address!("EdgDu3sEjDtMpJuDkG8VsWnKq16EYxTsuwCmSko3wZnR")',
        'pub fn create_config_pda_pda(',
        'bump: u8,',
        'pub fn find_config_pda_pda(',
        ') -> (solana_address::Address, u8)',
    ]);
});

test('it renders a PDA with byte array seeds', () => {
    // Given a program with a PDA that has byte array seeds.
    const node = programNode({
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'hashPda',
                seeds: [
                    constantPdaSeedNodeFromString('utf8', 'hash'),
                    variablePdaSeedNode('dataHash', fixedSizeTypeNode(bytesTypeNode(), 32)),
                ],
            }),
        ],
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the byte array to be handled correctly.
    codeContains(getFromRenderMap(renderMap, 'pdas/hash_pda.rs').content, [
        'pub const HASH_PDA_SEED: &\'static [u8] = b"hash";',
        'pub fn create_hash_pda_pda(',
        'data_hash: [u8; 32],',
        '&data_hash,',
        'pub fn find_hash_pda_pda(',
        'data_hash: [u8; 32],',
    ]);
});

test('it renders a PDA module file', () => {
    // Given a root node with a program containing multiple PDAs.
    const program = programNode({
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'firstPda',
                seeds: [constantPdaSeedNodeFromString('utf8', 'first')],
            }),
            pdaNode({
                name: 'secondPda',
                seeds: [constantPdaSeedNodeFromString('utf8', 'second')],
            }),
        ],
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });
    const node = rootNode(program);

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect a module file to be created.
    codeContains(getFromRenderMap(renderMap, 'pdas/mod.rs').content, [
        'pub mod first_pda;',
        'pub mod second_pda;',
        'pub use self::first_pda::*;',
        'pub use self::second_pda::*;',
    ]);
});

test('it includes PDAs module in the root mod file', () => {
    // Given a root node with a program containing PDAs.
    const program = programNode({
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'myPda',
                seeds: [constantPdaSeedNodeFromString('utf8', 'test')],
            }),
        ],
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });
    const node = rootNode(program);

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the pdas module to be included in the root mod.
    codeContains(getFromRenderMap(renderMap, 'mod.rs').content, ['pub mod pdas;']);
});

test('it does not emit a precomputed address for PDAs with variable seeds', () => {
    const node = programNode({
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'myPda',
                seeds: [
                    constantPdaSeedNodeFromString('utf8', 'metadata'),
                    variablePdaSeedNode('mint', publicKeyTypeNode()),
                ],
            }),
        ],
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    codeDoesNotContains(getFromRenderMap(renderMap, 'pdas/my_pda.rs').content, ['_ADDRESS']);
});

test('it renders a PDA with byte array constant seeds', () => {
    // Given a program with a PDA that has byte array seeds (e.g. from Anchor IDL extraction).
    const node = programNode({
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'guardPda',
                seeds: [
                    constantPdaSeedNodeFromBytes('base58', 'F9bS'),
                    variablePdaSeedNode('mint', publicKeyTypeNode()),
                ],
            }),
        ],
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect byte array seeds to use &[...] syntax, not b[...].
    codeContains(getFromRenderMap(renderMap, 'pdas/guard_pda.rs').content, [
        "pub const GUARD_PDA_SEED: &'static [u8] = &[",
        'pub fn create_guard_pda_pda(',
        'mint: Address,',
        'pub fn find_guard_pda_pda(',
        'mint: &Address,',
    ]);
});
