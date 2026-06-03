import {
    accountNode,
    bytesTypeNode,
    bytesValueNode,
    camelCase,
    constantDiscriminatorNode,
    constantPdaSeedNode,
    constantPdaSeedNodeFromString,
    constantValueNode,
    fixedSizeTypeNode,
    numberTypeNode,
    numberValueNode,
    pdaLinkNode,
    pdaNode,
    programNode,
    publicKeyTypeNode,
    structFieldTypeNode,
    structTypeNode,
    variablePdaSeedNode,
} from '@codama/nodes';
import { getFromRenderMap } from '@codama/renderers-core';
import { visit } from '@codama/visitors-core';
import { test } from 'vitest';

import { getRenderMapVisitor } from '../src';
import { codeContains, codeDoesNotContains } from './_setup';

test('it renders a byte array seed used on an account', () => {
    // Given the following program with 1 account and 1 pda with a byte array as seeds.
    const node = programNode({
        accounts: [
            accountNode({
                name: 'testAccount',
                pda: pdaLinkNode('testPda'),
            }),
        ],
        name: 'splToken',
        pdas: [
            // Byte array seeds.
            pdaNode({
                name: 'testPda',
                seeds: [variablePdaSeedNode('byteArraySeed', fixedSizeTypeNode(bytesTypeNode(), 32))],
            }),
        ],
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following identifier and reference to the byte array
    // as a parameters to be rendered.
    codeContains(getFromRenderMap(renderMap, 'accounts/test_account.rs').content, [
        `byte_array_seed: [u8; 32],`,
        `&byte_array_seed,`,
    ]);
});

test('it renders an empty array of seeds for seedless PDAs', () => {
    // Given the following program with 1 account and 1 pda with empty seeds.
    const node = programNode({
        accounts: [
            accountNode({
                discriminators: [],
                name: 'testAccount',
                pda: pdaLinkNode('testPda'),
            }),
        ],
        name: 'splToken',
        pdas: [
            // Empty array seeds.
            pdaNode({ name: 'testPda', seeds: [] }),
        ],
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following identifier and reference to the byte array
    // as a parameters to be rendered.
    codeContains(getFromRenderMap(renderMap, 'accounts/test_account.rs').content, [/pub fn find_pda\(/, /&\[\s*\]/]);
});

test('it renders constant PDA seeds as prefix consts', () => {
    // Given the following PDA node attached to an account.
    const node = programNode({
        accounts: [accountNode({ discriminators: [], name: 'testAccount', pda: pdaLinkNode('testPda') })],
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'testPda',
                seeds: [
                    constantPdaSeedNodeFromString('utf8', 'myPrefix'),
                    variablePdaSeedNode('myAccount', publicKeyTypeNode()),
                    constantPdaSeedNode(numberTypeNode('u64'), numberValueNode(42)),
                ],
            }),
        ],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following const helpers for constant seeds.
    codeContains(getFromRenderMap(renderMap, 'accounts/test_account.rs').content, [
        '///   0. `TestAccount::PREFIX.0`',
        '///   1. my_account (`Address`)',
        '///   2. `TestAccount::PREFIX.1`',
        /pub const PREFIX: \(\s*&'static \[u8\],\s*&'static \[u8\],\s*\) = \(\s*b"myPrefix",\s*&42u64\.to_le_bytes\(\),\s*\)/,
    ]);
});

test('it renders anchor traits impl', () => {
    // Given the following account.
    const node = programNode({
        accounts: [
            accountNode({
                discriminators: [
                    {
                        kind: 'fieldDiscriminatorNode',
                        name: camelCase('discriminator'),
                        offset: 0,
                    },
                ],
                name: 'testAccount',
                pda: pdaLinkNode('testPda'),
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following Anchor traits impl.
    codeContains(getFromRenderMap(renderMap, 'accounts/test_account.rs').content, [
        '#[cfg(feature = "anchor")]',
        'impl anchor_lang::AccountDeserialize for TestAccount',
        'impl anchor_lang::AccountSerialize for TestAccount {}',
        'impl anchor_lang::Owner for TestAccount',
        'const DISCRIMINATOR: &[u8] = &[0; 8]',
    ]);
});

test('it renders fetch functions', () => {
    // Given the following account.
    const node = programNode({
        accounts: [
            accountNode({
                discriminators: [
                    {
                        kind: 'fieldDiscriminatorNode',
                        name: camelCase('discriminator'),
                        offset: 0,
                    },
                ],
                name: 'testAccount',
                pda: pdaLinkNode('testPda'),
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following fetch functions to be rendered.
    codeContains(getFromRenderMap(renderMap, 'accounts/test_account.rs').content, [
        'pub fn fetch_test_account',
        'pub fn fetch_maybe_test_account',
        'pub fn fetch_all_test_account',
        'pub fn fetch_all_maybe_test_account',
    ]);
});

test('it validates byte-array discriminator in from_bytes and TryFrom', () => {
    // Given an account with a byte-array discriminator field.
    const node = programNode({
        accounts: [
            accountNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: bytesValueNode('base16', 'b9959c4ef56cac44'),
                        defaultValueStrategy: 'omitted',
                        name: 'discriminator',
                        type: fixedSizeTypeNode(bytesTypeNode(), 8),
                    }),
                    structFieldTypeNode({
                        name: 'amount',
                        type: numberTypeNode('u64'),
                    }),
                ]),
                discriminators: [
                    {
                        kind: 'fieldDiscriminatorNode',
                        name: camelCase('discriminator'),
                        offset: 0,
                    },
                ],
                name: 'testAccount',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'accounts/test_account.rs').content;

    // Then from_bytes validates the discriminator before deserializing.
    codeContains(code, ['TEST_ACCOUNT_DISCRIMINATOR', 'invalid account discriminator', 'Self::from_bytes(data)']);

    // And the Discriminator trait uses the real constant.
    codeContains(code, ['const DISCRIMINATOR: &[u8] = &TEST_ACCOUNT_DISCRIMINATOR;']);
});

test('it validates constant discriminator in from_bytes and TryFrom', () => {
    // Given an account with a constantDiscriminatorNode (no discriminator struct field).
    const node = programNode({
        accounts: [
            accountNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        name: 'amount',
                        type: numberTypeNode('u64'),
                    }),
                ]),
                discriminators: [
                    constantDiscriminatorNode(
                        constantValueNode(
                            fixedSizeTypeNode(bytesTypeNode(), 8),
                            bytesValueNode('base16', 'aabbccdd11223344'),
                        ),
                    ),
                ],
                name: 'testAccount',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'accounts/test_account.rs').content;

    // from_bytes validates the discriminator.
    codeContains(code, ['TEST_ACCOUNT_DISCRIMINATOR', 'invalid account discriminator']);

    // Anchor Discriminator trait uses the real constant.
    codeContains(code, ['const DISCRIMINATOR: &[u8] = &TEST_ACCOUNT_DISCRIMINATOR;']);
});

test('it validates account owner in TryFrom and fetch', () => {
    // Given an account with a discriminator.
    const node = programNode({
        accounts: [
            accountNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: bytesValueNode('base16', 'b9959c4ef56cac44'),
                        defaultValueStrategy: 'omitted',
                        name: 'discriminator',
                        type: fixedSizeTypeNode(bytesTypeNode(), 8),
                    }),
                ]),
                discriminators: [
                    {
                        kind: 'fieldDiscriminatorNode',
                        name: camelCase('discriminator'),
                        offset: 0,
                    },
                ],
                name: 'testAccount',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'accounts/test_account.rs').content;

    // TryFrom checks account owner.
    codeContains(code, ['invalid account owner', 'account_info.owner', 'MY_PROGRAM_ID']);

    // Fetch functions check account owner.
    codeContains(code, ['Invalid owner for account']);
});

test('it validates account owner even without a discriminator', () => {
    const node = programNode({
        accounts: [accountNode({ name: 'testAccount' })],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'accounts/test_account.rs').content;

    codeContains(code, ['invalid account owner', 'MY_PROGRAM_ID']);
    codeDoesNotContains(code, ['invalid account discriminator']);
});

test('it validates discriminator in anchor try_deserialize', () => {
    // Given an account with a byte-array discriminator.
    const node = programNode({
        accounts: [
            accountNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: bytesValueNode('base16', 'b9959c4ef56cac44'),
                        defaultValueStrategy: 'omitted',
                        name: 'discriminator',
                        type: fixedSizeTypeNode(bytesTypeNode(), 8),
                    }),
                ]),
                discriminators: [
                    {
                        kind: 'fieldDiscriminatorNode',
                        name: camelCase('discriminator'),
                        offset: 0,
                    },
                ],
                name: 'testAccount',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'accounts/test_account.rs').content;

    // try_deserialize checks the discriminator before delegating to unchecked.
    codeContains(code, [
        'fn try_deserialize(buf: &mut &[u8])',
        'AccountDiscriminatorMismatch',
        'TEST_ACCOUNT_DISCRIMINATOR',
    ]);
});

test('it skips discriminator validation when field has no default value', () => {
    // Given an account with a byte-array discriminator field but no defaultValue.
    const node = programNode({
        accounts: [
            accountNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        name: 'discriminator',
                        type: fixedSizeTypeNode(bytesTypeNode(), 8),
                    }),
                ]),
                discriminators: [
                    {
                        kind: 'fieldDiscriminatorNode',
                        name: camelCase('discriminator'),
                        offset: 0,
                    },
                ],
                name: 'testAccount',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'accounts/test_account.rs').content;

    // Then from_bytes does not validate a discriminator.
    codeDoesNotContains(code, ['invalid account discriminator', 'TEST_ACCOUNT_DISCRIMINATOR']);
});

test('it renders account without anchor traits', () => {
    // Given the following account.
    const node = programNode({
        accounts: [
            accountNode({
                discriminators: [
                    {
                        kind: 'fieldDiscriminatorNode',
                        name: camelCase('discriminator'),
                        offset: 0,
                    },
                ],
                name: 'testAccount',
                pda: pdaLinkNode('testPda'),
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it with anchor traits disabled.
    const renderMap = visit(node, getRenderMapVisitor({ anchorTraits: false }));

    // Then we do not expect Anchor traits.
    codeDoesNotContains(getFromRenderMap(renderMap, 'accounts/test_account.rs').content, [
        '#[cfg(feature = "anchor")]',
        '#[cfg(feature = "anchor-idl-build")]',
    ]);
});
