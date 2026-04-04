import {
    accountValueNode,
    argumentValueNode,
    bytesTypeNode,
    bytesValueNode,
    constantPdaSeedNode,
    constantPdaSeedNodeFromString,
    instructionAccountNode,
    instructionArgumentNode,
    instructionNode,
    numberTypeNode,
    numberValueNode,
    pdaLinkNode,
    pdaNode,
    pdaSeedValueNode,
    pdaValueNode,
    programIdValueNode,
    programNode,
    publicKeyTypeNode,
    publicKeyValueNode,
    stringTypeNode,
    variablePdaSeedNode,
} from '@codama/nodes';
import { getFromRenderMap } from '@codama/renderers-core';
import { visit } from '@codama/visitors-core';
import { expect, test } from 'vitest';

import { getRenderMapVisitor } from '../src';
import { codeContains, codeDoesNotContains } from './_setup';

test('it renders a public instruction data struct', () => {
    // Given the following program with 1 instruction.
    const node = programNode({
        instructions: [instructionNode({ name: 'mintTokens' })],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following pub struct.
    codeContains(getFromRenderMap(renderMap, 'instructions/mint_tokens.rs').content, [
        `pub struct MintTokensInstructionData`,
        `pub fn new(`,
    ]);
});

test('it renders an instruction with a remainder str', () => {
    // Given the following program with 1 instruction.
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        name: 'memo',
                        type: stringTypeNode('utf8'),
                    }),
                ],
                name: 'addMemo',
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following pub struct.
    codeContains(getFromRenderMap(renderMap, 'instructions/add_memo.rs').content, [
        `use spl_collections::TrailingStr`,
        `pub memo: TrailingStr`,
    ]);
});

test('it auto-derives PDA accounts from pdaLinkNode defaults', () => {
    // Given an instruction with a PDA-defaulted account.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'realm' }),
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'mint' }),
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'owner' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('record'), [
                            pdaSeedValueNode('realm', accountValueNode('realm')),
                            pdaSeedValueNode('mint', accountValueNode('mint')),
                            pdaSeedValueNode('owner', accountValueNode('owner')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    // Then we expect the PDA to be auto-derived.
    codeContains(content, [
        `unwrap_or_else(|| {`,
        `crate::pdas::find_record_pda(`,
        `&self.realm,`,
        `&self.mint,`,
        `&self.owner,`,
        `.0`,
        `default to PDA derived from 'record'`,
    ]);
});

test('it passes argument seeds by value for non-Pubkey types', () => {
    // Given an instruction with a PDA that has a string argument seed.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'owner' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('record'), [
                            pdaSeedValueNode('owner', accountValueNode('owner')),
                            pdaSeedValueNode('label', argumentValueNode('label')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                arguments: [instructionArgumentNode({ name: 'label', type: stringTypeNode('utf8') })],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        pdas: [
            pdaNode({
                name: 'record',
                seeds: [
                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                    variablePdaSeedNode('label', stringTypeNode('utf8')),
                ],
            }),
        ],
        publicKey: '11111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    // Then we expect by-ref for the account seed (required, direct access)
    // and by-value for the argument seed (required, direct clone).
    codeContains(content, [`crate::pdas::find_record_pda(`, `&self.owner,`, `self.label.clone(),`]);
});

test('it resolves upstream account defaults as PDA seeds', () => {
    // Given an instruction where a PDA seed references an account with a publicKeyValueNode default.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'owner' }),
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'mint' }),
                    instructionAccountNode({
                        defaultValue: publicKeyValueNode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                        isOptional: false,
                        isSigner: false,
                        isWritable: false,
                        name: 'tokenProgram',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('ata'), [
                            pdaSeedValueNode('owner', accountValueNode('owner')),
                            pdaSeedValueNode('tokenProgram', accountValueNode('tokenProgram')),
                            pdaSeedValueNode('mint', accountValueNode('mint')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'ata',
                    }),
                ],
                name: 'createAta',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_ata.rs').content;

    // Then we expect the tokenProgram seed to use unwrap_or with its default.
    codeContains(content, [
        `crate::pdas::find_ata_pda(`,
        `&self.owner,`,
        `&self.token_program.unwrap_or(solana_address::address!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))`,
        `&self.mint,`,
    ]);
});

test('it resolves programIdValueNode defaults as PDA seed defaults', () => {
    // Given a PDA seed that references an account with a programIdValueNode default.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'owner' }),
                    instructionAccountNode({
                        defaultValue: programIdValueNode(),
                        isOptional: false,
                        isSigner: false,
                        isWritable: false,
                        name: 'programAddress',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('record'), [
                            pdaSeedValueNode('owner', accountValueNode('owner')),
                            pdaSeedValueNode('programAddress', accountValueNode('programAddress')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    // Then the programAddress seed uses unwrap_or with the program ID constant.
    codeContains(content, [`&self.program_address.unwrap_or(crate::TEST_PROGRAM_ID)`]);
});

test('it passes Pubkey argument seeds by reference', () => {
    // Given an instruction with a PDA that has a Pubkey argument seed.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'owner' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('record'), [
                            pdaSeedValueNode('owner', accountValueNode('owner')),
                            pdaSeedValueNode('delegate', argumentValueNode('delegate')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                arguments: [instructionArgumentNode({ name: 'delegate', type: publicKeyTypeNode() })],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        pdas: [
            pdaNode({
                name: 'record',
                seeds: [
                    constantPdaSeedNode(bytesTypeNode(), bytesValueNode('utf8', 'rec')),
                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                    variablePdaSeedNode('delegate', publicKeyTypeNode()),
                ],
            }),
        ],
        publicKey: '11111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    // owner is required (direct), delegate is a required arg (direct clone).
    codeContains(content, [`&self.owner,`, `&self.delegate.clone(),`]);
});

test('it handles argument/account name conflicts in PDA seeds', () => {
    // Given a non-Pubkey argument that conflicts with an account name.
    const stringConflict = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'owner' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('record'), [
                            pdaSeedValueNode('owner', accountValueNode('owner')),
                            pdaSeedValueNode('label', argumentValueNode('owner')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                arguments: [instructionArgumentNode({ name: 'owner', type: stringTypeNode('utf8') })],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        pdas: [
            pdaNode({
                name: 'record',
                seeds: [
                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                    variablePdaSeedNode('label', stringTypeNode('utf8')),
                ],
            }),
        ],
        publicKey: '11111111111111111111111111111111',
    });

    const content1 = getFromRenderMap(
        visit(stringConflict, getRenderMapVisitor()),
        'instructions/create_record.rs',
    ).content;
    // owner is required (direct), owner_arg is a required arg (direct clone).
    codeContains(content1, [`&self.owner,`, `self.owner_arg.clone(),`]);

    // And a Pubkey argument that conflicts — should also get _arg suffix with by-ref.
    const pubkeyConflict = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'delegate' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('record'), [
                            pdaSeedValueNode('owner', accountValueNode('delegate')),
                            pdaSeedValueNode('delegate', argumentValueNode('delegate')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                arguments: [instructionArgumentNode({ name: 'delegate', type: publicKeyTypeNode() })],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        pdas: [
            pdaNode({
                name: 'record',
                seeds: [
                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                    variablePdaSeedNode('delegate', publicKeyTypeNode()),
                ],
            }),
        ],
        publicKey: '11111111111111111111111111111111',
    });

    const content2 = getFromRenderMap(
        visit(pubkeyConflict, getRenderMapVisitor()),
        'instructions/create_record.rs',
    ).content;
    // delegate is required (direct), delegate_arg is a required arg (direct clone).
    codeContains(content2, [`&self.delegate,`, `&self.delegate_arg.clone(),`]);
});

test('it handles argument defaults in PDA seeds', () => {
    // Omitted arguments are inlined as their default value.
    const omittedArg = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'owner' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('record'), [
                            pdaSeedValueNode('owner', accountValueNode('owner')),
                            pdaSeedValueNode('kind', argumentValueNode('kind')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(42),
                        defaultValueStrategy: 'omitted',
                        name: 'kind',
                        type: numberTypeNode('u32'),
                    }),
                ],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        pdas: [
            pdaNode({
                name: 'record',
                seeds: [
                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                    variablePdaSeedNode('kind', numberTypeNode('u32')),
                ],
            }),
        ],
        publicKey: '11111111111111111111111111111111',
    });

    const content1 = getFromRenderMap(
        visit(omittedArg, getRenderMapVisitor()),
        'instructions/create_record.rs',
    ).content;
    codeContains(content1, [`42`]);
    expect(content1).not.toContain('self.kind');

    // Non-omitted arguments still use expect (no silent defaulting for PDA seeds).
    const nonOmittedArg = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'owner' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('record'), [
                            pdaSeedValueNode('owner', accountValueNode('owner')),
                            pdaSeedValueNode('version', argumentValueNode('version')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(1),
                        name: 'version',
                        type: numberTypeNode('u32'),
                    }),
                ],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        pdas: [
            pdaNode({
                name: 'record',
                seeds: [
                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                    variablePdaSeedNode('version', numberTypeNode('u32')),
                ],
            }),
        ],
        publicKey: '11111111111111111111111111111111',
    });

    const content2 = getFromRenderMap(
        visit(nonOmittedArg, getRenderMapVisitor()),
        'instructions/create_record.rs',
    ).content;
    codeContains(content2, [`self.version.clone().expect("version is needed for record PDA")`]);
});

test('it extracts Pubkey from either-signer tuple for PDA seeds', () => {
    // Given a PDA seed that references an isSigner: 'either' account.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        isOptional: false,
                        isSigner: 'either',
                        isWritable: false,
                        name: 'authority',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('record'), [
                            pdaSeedValueNode('authority', accountValueNode('authority')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    // authority is required either-signer — direct .0 extraction, no expect.
    codeContains(content, [`&self.authority.0,`]);
});

test('it extracts Pubkey from either-signer tuple for inline pdaNode seeds', () => {
    // Given an inline pdaNode seed that references an isSigner: 'either' account.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        isOptional: false,
                        isSigner: 'either',
                        isWritable: false,
                        name: 'authority',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'record',
                                seeds: [variablePdaSeedNode('authority', publicKeyTypeNode())],
                            }),
                            [pdaSeedValueNode('authority', accountValueNode('authority'))],
                        ),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    // Then we expect the seed to extract the Pubkey from the (Pubkey, bool) tuple.
    // authority is a required constructor arg, so the field is (Pubkey, bool) directly.
    codeContains(content, [`self.authority.0.as_ref()`]);
});

test('it renders a builder that auto-derives inline pdaNode accounts', () => {
    // Given an instruction with an inline pdaNode default (constant + variable seeds).
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'mint' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'guard',
                                seeds: [
                                    constantPdaSeedNode(bytesTypeNode(), bytesValueNode('utf8', 'my_seed')),
                                    variablePdaSeedNode('mint', publicKeyTypeNode()),
                                ],
                            }),
                            [pdaSeedValueNode('mint', accountValueNode('mint'))],
                        ),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'guard',
                    }),
                ],
                name: 'createGuard',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_guard.rs').content;

    // Then the builder should generate inline find_program_address.
    codeContains(content, [
        `unwrap_or_else(|| {`,
        `solana_address::Address::find_program_address(`,
        // Constant seed rendered as byte array reference.
        /&\[109, 121, 95, 115, 101, 101, 100\]/,
        // Variable seed — mint is required, direct .as_ref().
        `self.mint.as_ref()`,
        // Uses default program ID.
        `&crate::TEST_PROGRAM_ID`,
        `.0`,
        `default to PDA derived from 'guard'`,
    ]);
});

test('it renders inline pdaNode with argumentValueNode variable seed using type dispatch', () => {
    // Given an instruction with an argument-valued variable seed.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'mint' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'record',
                                seeds: [
                                    constantPdaSeedNode(bytesTypeNode(), bytesValueNode('utf8', 'rec')),
                                    variablePdaSeedNode('mint', publicKeyTypeNode()),
                                    variablePdaSeedNode('label', stringTypeNode('utf8')),
                                ],
                            }),
                            [
                                pdaSeedValueNode('mint', accountValueNode('mint')),
                                pdaSeedValueNode('label', argumentValueNode('label')),
                            ],
                        ),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                arguments: [instructionArgumentNode({ name: 'label', type: stringTypeNode('utf8') })],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    // Then argument seeds use .to_string().as_ref() for string types (not bare .as_ref()).
    codeContains(content, [`self.mint.as_ref()`, `self.label.clone().to_string().as_ref()`]);
});

test('it renders inline pdaNode with custom programId', () => {
    // Given an instruction with an inline pdaNode that specifies a custom programId.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'mint' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'ata',
                                programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
                                seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())],
                            }),
                            [pdaSeedValueNode('mint', accountValueNode('mint'))],
                        ),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'ata',
                    }),
                ],
                name: 'createAta',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_ata.rs').content;

    // Then the custom programId is used instead of the current program's ID.
    codeContains(content, [`&solana_address::address!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")`]);
});

test('it resolves upstream account defaults when used as inline PDA seeds', () => {
    // Given an instruction where a PDA seed references an account with its own default.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'mint' }),
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'owner' }),
                    instructionAccountNode({
                        defaultValue: publicKeyValueNode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                        isOptional: false,
                        isSigner: false,
                        isWritable: false,
                        name: 'tokenProgram',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'ata',
                                programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
                                seeds: [
                                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                                    variablePdaSeedNode('tokenProgram', publicKeyTypeNode()),
                                    variablePdaSeedNode('mint', publicKeyTypeNode()),
                                ],
                            }),
                            [
                                pdaSeedValueNode('owner', accountValueNode('owner')),
                                pdaSeedValueNode('tokenProgram', accountValueNode('tokenProgram')),
                                pdaSeedValueNode('mint', accountValueNode('mint')),
                            ],
                        ),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'ata',
                    }),
                ],
                name: 'createAta',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_ata.rs').content;

    // Then tokenProgram seed uses unwrap_or with its default instead of expect.
    codeContains(content, [
        `self.token_program.unwrap_or(solana_address::address!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")).as_ref()`,
    ]);
    // And required accounts without defaults still use expect.
    codeContains(content, [`self.owner.as_ref()`, `self.mint.as_ref()`]);
});

test('it renders inline pdaNode with programIdValueNode constant seed', () => {
    // Given an instruction with a programIdValueNode as a constant seed.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'mint' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'record',
                                seeds: [
                                    constantPdaSeedNode(bytesTypeNode(), programIdValueNode()),
                                    variablePdaSeedNode('mint', publicKeyTypeNode()),
                                ],
                            }),
                            [pdaSeedValueNode('mint', accountValueNode('mint'))],
                        ),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    // Then the programId is used as a constant seed.
    codeContains(content, [`crate::TEST_PROGRAM_ID.as_ref()`]);
});

test('it renders a default impl for instruction data struct', () => {
    // Given the following program with 1 instruction.
    const node = programNode({
        instructions: [instructionNode({ name: 'mintTokens' })],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following Default trait to be implemented.
    codeContains(getFromRenderMap(renderMap, 'instructions/mint_tokens.rs').content, [
        `impl Default for MintTokensInstructionData`,
        `fn default(`,
    ]);
});

test('it resolves cascading PDA defaults via let bindings', () => {
    // Given an instruction where vault (inline PDA) depends on pool (linked PDA).
    // Without let bindings, vault would read self.pool (still None) and panic.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'mint' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('pool'), [
                            pdaSeedValueNode('mint', accountValueNode('mint')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'pool',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'vault',
                                programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
                                seeds: [
                                    variablePdaSeedNode('authority', publicKeyTypeNode()),
                                    variablePdaSeedNode('mint', publicKeyTypeNode()),
                                ],
                            }),
                            [
                                pdaSeedValueNode('authority', accountValueNode('pool')),
                                pdaSeedValueNode('mint', accountValueNode('mint')),
                            ],
                        ),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'vault',
                    }),
                ],
                name: 'swap',
            }),
        ],
        name: 'testProgram',
        pdas: [
            pdaNode({
                name: 'pool',
                seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())],
            }),
        ],
        publicKey: '11111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/swap.rs').content;

    // Then pool is emitted as a let binding.
    codeContains(content, [`let pool = self.pool.unwrap_or_else(|| {`, `find_pool_pda(`]);
    // And vault is also a let binding that references the local `pool`, not self.pool.
    codeContains(content, [`let vault = self.vault.unwrap_or_else(|| {`, `pool.as_ref()`]);
    // And the struct literal uses shorthand field names.
    codeContains(content, [/Swap \{\s*mint,/]);
    // Verify vault does NOT read self.pool (which would panic).
    expect(content).not.toContain('self.pool.expect');
});

test('it topologically sorts PDA let bindings when dependency is declared after dependent', () => {
    // Given an instruction where vault (inline PDA) references authority (linked PDA),
    // but vault is declared BEFORE authority in the accounts list.
    // This mirrors the real-world claim_airdrop pattern.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'mint' }),
                    // vault comes first but depends on authority
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'vault',
                                programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
                                seeds: [
                                    variablePdaSeedNode('authority', publicKeyTypeNode()),
                                    variablePdaSeedNode('mint', publicKeyTypeNode()),
                                ],
                            }),
                            [
                                pdaSeedValueNode('authority', accountValueNode('authority')),
                                pdaSeedValueNode('mint', accountValueNode('mint')),
                            ],
                        ),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'vault',
                    }),
                    // authority comes second but is vault's dependency
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('authority'), []),
                        isOptional: false,
                        isSigner: false,
                        isWritable: false,
                        name: 'authority',
                    }),
                ],
                name: 'claimAirdrop',
            }),
        ],
        name: 'testProgram',
        pdas: [pdaNode({ name: 'authority', seeds: [] })],
        publicKey: '11111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/claim_airdrop.rs').content;

    // Then authority's let binding must appear BEFORE vault's let binding,
    // even though vault is declared first in the accounts list.
    const authorityPos = content.indexOf('let authority =');
    const vaultPos = content.indexOf('let vault =');
    expect(authorityPos).toBeGreaterThan(-1);
    expect(vaultPos).toBeGreaterThan(-1);
    expect(authorityPos).toBeLessThan(vaultPos);

    // And vault references the local `authority`, not self.authority.
    codeContains(content, [`authority.as_ref()`]);
    expect(content).not.toContain('self.authority.expect');
});

test('it handles argument/account name conflicts in inline pdaNode seeds', () => {
    // Given an inline PDA with an argument seed whose name conflicts with an account name.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'owner' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'record',
                                seeds: [
                                    variablePdaSeedNode('authority', publicKeyTypeNode()),
                                    variablePdaSeedNode('label', stringTypeNode('utf8')),
                                ],
                            }),
                            [
                                pdaSeedValueNode('authority', accountValueNode('owner')),
                                pdaSeedValueNode('label', argumentValueNode('owner')),
                            ],
                        ),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                arguments: [instructionArgumentNode({ name: 'owner', type: stringTypeNode('utf8') })],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    // The account seed should reference self.owner (the account field).
    codeContains(content, [`self.owner.as_ref()`]);
    // The argument seed should reference self.owner_arg (the _arg suffixed field).
    codeContains(content, [`self.owner_arg.clone()`]);
});

test('it handles omitted-default argument seeds in inline pdaNode', () => {
    // Given an inline PDA with an omitted-default argument seed.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'owner' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'record',
                                seeds: [
                                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                                    variablePdaSeedNode('kind', numberTypeNode('u32')),
                                ],
                            }),
                            [
                                pdaSeedValueNode('owner', accountValueNode('owner')),
                                pdaSeedValueNode('kind', argumentValueNode('kind')),
                            ],
                        ),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(42),
                        defaultValueStrategy: 'omitted',
                        name: 'kind',
                        type: numberTypeNode('u32'),
                    }),
                ],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    // The omitted arg should be inlined as its default value, not read from self.kind.
    codeContains(content, [`42`]);
    expect(content).not.toContain('self.kind');
});

test('it falls back to .expect() for both accounts in a circular PDA dependency', () => {
    // Given two accounts with circular PDA dependencies (A depends on B, B depends on A).
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'pdaA',
                                seeds: [variablePdaSeedNode('b', publicKeyTypeNode())],
                            }),
                            [pdaSeedValueNode('b', accountValueNode('accountB'))],
                        ),
                        isOptional: false,
                        isSigner: false,
                        isWritable: false,
                        name: 'accountA',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'pdaB',
                                seeds: [variablePdaSeedNode('a', publicKeyTypeNode())],
                            }),
                            [pdaSeedValueNode('a', accountValueNode('accountA'))],
                        ),
                        isOptional: false,
                        isSigner: false,
                        isWritable: false,
                        name: 'accountB',
                    }),
                ],
                name: 'circular',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/circular.rs').content;

    // Then BOTH accounts lose PDA resolution and become required constructor params.
    // They resolve via let-bindings with direct field access.
    codeContains(content, ['let account_a = self.account_a', 'let account_b = self.account_b']);
    // No PDA derivation code should be emitted for either.
    codeDoesNotContains(content, ['find_program_address', 'unwrap_or_else']);
});

test('it bails entire PDA resolution when a variable seed has no binding', () => {
    // Given an inline PDA with a variable seed that has no matching binding.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'mint' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'vault',
                                seeds: [
                                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                                    variablePdaSeedNode('mint', publicKeyTypeNode()),
                                ],
                            }),
                            // Only provide binding for 'mint', not 'owner' — incomplete seeds.
                            [pdaSeedValueNode('mint', accountValueNode('mint'))],
                        ),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'vault',
                    }),
                ],
                name: 'deposit',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/deposit.rs').content;

    // PDA resolution fails — vault becomes a required constructor param.
    // Resolved via let-binding with direct field access.
    codeContains(content, ['let vault = self.vault']);
    codeDoesNotContains(content, ['find_program_address', 'unwrap_or_else', '.expect(']);
});

test('it renders required args as constructor params', () => {
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [instructionAccountNode({ isSigner: false, isWritable: true, name: 'myAccount' })],
                arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: 'Dummy11111111111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'instructions/my_instruction.rs').content;

    codeContains(code, [
        /pub struct MyInstructionBuilder \{[^}]*amount: u64,/,
        /pub fn new\([^)]*amount: u64/,
        `#[derive(Clone, Debug)]`,
    ]);

    codeDoesNotContains(code, [
        `pub fn amount(&mut self`,
        `expect("amount is not set")`,
        `#[derive(Clone, Debug, Default)]`,
    ]);
});

test('it renders required args as constructor params even without required accounts', () => {
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: 'Dummy11111111111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'instructions/my_instruction.rs').content;

    codeContains(code, [`#[derive(Clone, Debug)]`, /pub fn new\([^)]*amount: u64/]);

    codeDoesNotContains(code, [`#[derive(Clone, Debug, Default)]`, `Self::default()`]);
});

test('it renders required accounts as constructor params with PDA accounts staying optional', () => {
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'realm' }),
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'mint' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('record'), [
                            pdaSeedValueNode('realm', accountValueNode('realm')),
                            pdaSeedValueNode('mint', accountValueNode('mint')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    // Required accounts in new().
    codeContains(content, [
        `#[derive(Clone, Debug)]`,
        /pub fn new\(\s*realm: solana_address::Address,\s*mint: solana_address::Address,/,
    ]);

    // PDA account is NOT in new(), stays Option.
    codeContains(content, [/record: Option<solana_address::Address>/, `pub fn record(&mut self`]);

    // Required accounts are bare types, not Option.
    codeContains(content, [
        /realm: solana_address::Address,\s*mint: solana_address::Address,\s*record: Option<solana_address::Address>/,
    ]);

    // No setters for required accounts.
    codeDoesNotContains(content, [`pub fn realm(&mut self`, `pub fn mint(&mut self`]);
});

test('it renders required account as pdaLinkNode seed without expect', () => {
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'owner' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('record'), [
                            pdaSeedValueNode('owner', accountValueNode('owner')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    // Required account used as PDA seed — direct access, no expect.
    codeContains(content, [`&self.owner,`]);
    codeDoesNotContains(content, [`self.owner.expect`]);
});

test('it renders required either-signer account as pdaLinkNode seed with .0 extraction', () => {
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        isOptional: false,
                        isSigner: 'either',
                        isWritable: false,
                        name: 'authority',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('record'), [
                            pdaSeedValueNode('authority', accountValueNode('authority')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    // Required either-signer: bare tuple type, new() param, .0 in seed.
    codeContains(content, [
        /authority: \(solana_address::Address, bool\),/,
        /pub fn new\([^)]*authority: \(solana_address::Address, bool\)/,
        `&self.authority.0,`,
    ]);
    codeDoesNotContains(content, [
        `Option<(solana_address::Address, bool)>`,
        `.map(|(k, _)| k).expect`,
        `pub fn authority(&mut self`,
    ]);
});

test('it renders required account as inline pdaNode seed without expect', () => {
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'mint' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'guard',
                                seeds: [
                                    constantPdaSeedNode(bytesTypeNode(), bytesValueNode('utf8', 'my_seed')),
                                    variablePdaSeedNode('mint', publicKeyTypeNode()),
                                ],
                            }),
                            [pdaSeedValueNode('mint', accountValueNode('mint'))],
                        ),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'guard',
                    }),
                ],
                name: 'createGuard',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_guard.rs').content;

    // Required account as inline PDA seed — direct .as_ref(), no expect.
    codeContains(content, [`self.mint.as_ref()`]);
    codeDoesNotContains(content, [`self.mint.expect`]);
});

test('it renders required arg as pdaLinkNode seed without expect', () => {
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'owner' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('record'), [
                            pdaSeedValueNode('owner', accountValueNode('owner')),
                            pdaSeedValueNode('label', argumentValueNode('label')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                ],
                arguments: [instructionArgumentNode({ name: 'label', type: stringTypeNode('utf8') })],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        pdas: [
            pdaNode({
                name: 'record',
                seeds: [
                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                    variablePdaSeedNode('label', stringTypeNode('utf8')),
                ],
            }),
        ],
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    // Required arg in new().
    codeContains(content, [/pub fn new\([^)]*label: TrailingStr/]);
    // Required arg as PDA seed — no expect.
    codeContains(content, [`self.label.clone(),`]);
    codeDoesNotContains(content, [`self.label.clone().expect`]);
});

test('it renders mixed required accounts, PDA defaults, and publicKey defaults', () => {
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'owner' }),
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'mint' }),
                    instructionAccountNode({
                        defaultValue: publicKeyValueNode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                        isOptional: false,
                        isSigner: false,
                        isWritable: false,
                        name: 'tokenProgram',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('ata'), [
                            pdaSeedValueNode('owner', accountValueNode('owner')),
                            pdaSeedValueNode('tokenProgram', accountValueNode('tokenProgram')),
                            pdaSeedValueNode('mint', accountValueNode('mint')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'ata',
                    }),
                ],
                arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
                name: 'createAta',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_ata.rs').content;

    // Required accounts and args in new().
    codeContains(content, [
        /pub fn new\(\s*owner: solana_address::Address,\s*mint: solana_address::Address,\s*amount: u64,/,
        `#[derive(Clone, Debug)]`,
    ]);

    // publicKey default stays optional with setter.
    codeContains(content, [
        `pub fn token_program(&mut self`,
        `unwrap_or(solana_address::address!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))`,
    ]);

    // PDA account stays optional with setter.
    codeContains(content, [`pub fn ata(&mut self`, /ata: Option<solana_address::Address>/]);

    // Required accounts: no setters, no expect.
    codeDoesNotContains(content, [
        `pub fn owner(&mut self`,
        `pub fn mint(&mut self`,
        `pub fn amount(&mut self`,
        `expect("owner is not set")`,
        `expect("mint is not set")`,
        `expect("amount is not set")`,
    ]);

    // PDA seed for required accounts uses direct access.
    codeContains(content, [`&self.owner,`]);
    // PDA seed for publicKey default uses unwrap_or.
    codeContains(content, [
        `&self.token_program.unwrap_or(solana_address::address!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))`,
    ]);
    // PDA seed for required account 'mint' uses direct access.
    codeContains(content, [`&self.mint,`]);
});

test('it renders programIdValueNode default account with unwrap_or program ID', () => {
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'owner' }),
                    instructionAccountNode({
                        defaultValue: programIdValueNode(),
                        isOptional: false,
                        isSigner: false,
                        isWritable: false,
                        name: 'selfProgram',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/my_instruction.rs').content;

    // programIdValueNode account is builder-optional (Option in struct).
    codeContains(content, [`self_program: Option<solana_address::Address>`, `pub fn self_program(&mut self`]);
    // In struct literal, unwraps with program ID default.
    codeContains(content, [`self.self_program.unwrap_or(crate::TEST_PROGRAM_ID)`]);
    // Required account 'owner' is in new().
    codeContains(content, [/pub fn new\([^)]*owner: solana_address::Address/]);
    // programIdValueNode account is NOT in new().
    codeDoesNotContains(content, [/pub fn new\([^)]*self_program/]);
});

test('it renders CPI builder with required accounts, args, and defaults', () => {
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'owner' }),
                    instructionAccountNode({
                        defaultValue: publicKeyValueNode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                        isOptional: false,
                        isSigner: false,
                        isWritable: false,
                        name: 'tokenProgram',
                    }),
                    instructionAccountNode({
                        defaultValue: programIdValueNode(),
                        isOptional: false,
                        isSigner: false,
                        isWritable: false,
                        name: 'selfProgram',
                    }),
                ],
                arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
                name: 'myInstruction',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/my_instruction.rs').content;

    const cpiSection = content.substring(content.indexOf('Instruction builder for `MyInstruction` via CPI'));

    codeContains(cpiSection, [
        /MyInstructionCpiBuilder<'a, 'b>/,
        /pub fn new\(\s*__program: &'b solana_account_info::AccountInfo<'a>,\s*owner: &'b solana_account_info::AccountInfo<'a>,\s*token_program: &'b solana_account_info::AccountInfo<'a>,\s*amount: u64,/,
    ]);
    codeContains(cpiSection, [
        /owner: &'b solana_account_info::AccountInfo<'a>,\s*token_program: &'b solana_account_info::AccountInfo<'a>,\s*self_program: Option<&'b solana_account_info::AccountInfo<'a>>,/,
    ]);
    codeContains(cpiSection, [/amount: u64,\s*\/\/\//]);
    codeContains(cpiSection, [`self.instruction.self_program.unwrap_or(self.instruction.__program)`]);
    codeContains(cpiSection, [/token_program: self\.instruction\.token_program,/]);
    codeContains(cpiSection, [/\[signer\].*owner/, /\[optional\].*self_program/]);
    codeDoesNotContains(cpiSection, [/\[optional\].*token_program/]);
    codeDoesNotContains(cpiSection, [`pub fn token_program(`]);
});

test('it renders CPI builder with PDA-defaulted accounts as required constructor params', () => {
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'owner' }),
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'mint' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('record'), [
                            pdaSeedValueNode('owner', accountValueNode('owner')),
                            pdaSeedValueNode('mint', accountValueNode('mint')),
                        ]),
                        isOptional: false,
                        isSigner: false,
                        isWritable: true,
                        name: 'record',
                    }),
                    instructionAccountNode({
                        defaultValue: programIdValueNode(),
                        isOptional: false,
                        isSigner: false,
                        isWritable: false,
                        name: 'selfProgram',
                    }),
                ],
                name: 'createRecord',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/create_record.rs').content;

    const cpiSection = content.substring(content.indexOf('Instruction builder for `CreateRecord` via CPI'));

    codeContains(cpiSection, [
        /CreateRecordCpiBuilder<'a, 'b>/,
        /pub fn new\(\s*__program: &'b solana_account_info::AccountInfo<'a>,\s*owner: &'b solana_account_info::AccountInfo<'a>,\s*mint: &'b solana_account_info::AccountInfo<'a>,\s*record: &'b solana_account_info::AccountInfo<'a>,/,
    ]);
    codeContains(cpiSection, [
        /record: &'b solana_account_info::AccountInfo<'a>,\s*self_program: Option<&'b solana_account_info::AccountInfo<'a>>,/,
    ]);
    codeContains(cpiSection, [/record: self\.instruction\.record,/]);
    codeContains(cpiSection, [`self.instruction.self_program.unwrap_or(self.instruction.__program)`]);
    codeDoesNotContains(cpiSection, [`pub fn record(`]);
    codeContains(cpiSection, [`pub fn self_program(`]);
    codeDoesNotContains(cpiSection, [/\[optional\].*record/]);
    codeContains(cpiSection, [/\[optional\].*self_program/]);

    // Regular Builder still has record as optional (PDA auto-derived).
    codeContains(content, [/pub struct CreateRecordBuilder \{[^}]*record: Option<solana_address::Address>/]);
});

test('it avoids CPI builder param name collision when instruction has an account named program', () => {
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isOptional: false, isSigner: true, isWritable: false, name: 'user' }),
                    instructionAccountNode({ isOptional: false, isSigner: false, isWritable: false, name: 'program' }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'testProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/my_instruction.rs').content;
    const cpiSection = content.substring(content.indexOf('Instruction builder for `MyInstruction` via CPI'));

    // CPI builder first param is __program (not program) to avoid collision.
    codeContains(cpiSection, [/pub fn new\(\s*__program: &'b solana_account_info::AccountInfo<'a>,/]);
    // The instruction account named 'program' is a separate param.
    codeContains(cpiSection, [/program: &'b solana_account_info::AccountInfo<'a>,/]);
});

test('it uses unwrap_or with precomputed address for zero-variable-seed linked PDA', () => {
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('config'), []),
                        isOptional: false,
                        isSigner: false,
                        isWritable: false,
                        name: 'config',
                    }),
                ],
                name: 'doSomething',
            }),
        ],
        name: 'testProgram',
        pdas: [
            pdaNode({
                name: 'config',
                seeds: [constantPdaSeedNodeFromString('utf8', 'config')],
            }),
        ],
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/do_something.rs').content;

    codeContains(content, ['unwrap_or(', 'crate::pdas::CONFIG_ADDRESS']);
    codeDoesNotContains(content, ['unwrap_or_else', 'find_config_pda']);
});
