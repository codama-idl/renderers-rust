import {
    accountNode,
    accountValueNode,
    argumentValueNode,
    bytesTypeNode,
    constantPdaSeedNodeFromProgramId,
    constantPdaSeedNodeFromString,
    instructionAccountNode,
    instructionArgumentNode,
    instructionNode,
    numberTypeNode,
    pdaLinkNode,
    pdaNode,
    pdaSeedValueNode,
    pdaValueNode,
    programNode,
    publicKeyTypeNode,
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

test('it resolves inline pdaValueNode defaults with constant seeds', () => {
    // Given an instruction with an account that defaults to an inline PDA with constant seeds.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'eventAuthority',
                                seeds: [constantPdaSeedNodeFromString('utf8', '__event_authority')],
                            }),
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'eventAuthority',
                    }),
                ],
                name: 'emitEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111111111111111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/emit_event.rs').content;

    // Then the builder resolves the PDA using find_program_address.
    codeContains(content, [
        'unwrap_or_else',
        'find_program_address',
        '"__event_authority".as_bytes()',
        'MY_PROGRAM_ID',
    ]);
});

test('it resolves linked pdaValueNode defaults', () => {
    // Given an instruction with an account that defaults to a linked PDA.
    const node = programNode({
        accounts: [
            accountNode({
                name: 'testAccount',
                pda: pdaLinkNode('testPda'),
            }),
        ],
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode('testPda'),
                        isSigner: false,
                        isWritable: false,
                        name: 'testAccount',
                    }),
                ],
                name: 'doSomething',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'testPda', seeds: [constantPdaSeedNodeFromString('utf8', 'seed')] })],
        publicKey: '1111111111111111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/do_something.rs').content;

    // Then the builder calls the account's find_pda method (using the account name, not PDA name).
    codeContains(content, ['unwrap_or_else', 'TestAccount::find_pda']);
});

test('it resolves pdaValueNode defaults with variable seeds referencing accounts', () => {
    // Given an instruction with accounts where a PDA seed references another account.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        isSigner: false,
                        isWritable: false,
                        name: 'owner',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'myPda',
                                seeds: [
                                    constantPdaSeedNodeFromString('utf8', 'token'),
                                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                                ],
                            }),
                            [pdaSeedValueNode('owner', accountValueNode('owner'))],
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'tokenAccount',
                    }),
                ],
                name: 'transfer',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111111111111111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/transfer.rs').content;

    // Then the builder resolves the PDA with the owner account as a seed.
    codeContains(content, ['find_program_address', '"token".as_bytes()', 'owner.as_ref()']);
});

test('it orders accounts by dependency for PDA resolution', () => {
    // Given an instruction where the PDA account depends on another account.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    // PDA account listed BEFORE its dependency.
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'derivedPda',
                                seeds: [variablePdaSeedNode('base', publicKeyTypeNode())],
                            }),
                            [pdaSeedValueNode('base', accountValueNode('base'))],
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'derived',
                    }),
                    instructionAccountNode({
                        isSigner: false,
                        isWritable: false,
                        name: 'base',
                    }),
                ],
                name: 'init',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111111111111111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/init.rs').content;

    // Then the base account is resolved before the derived PDA account.
    const baseIdx = content.indexOf('let base =');
    const derivedIdx = content.indexOf('let derived =');
    codeContains(content, ['let base =', 'let derived =']);
    expect(baseIdx).toBeLessThan(derivedIdx);
});

test('it marks pdaValueNode accounts as optional in docblock', () => {
    // Given an instruction with a PDA-defaulted account.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'authority',
                                seeds: [constantPdaSeedNodeFromString('utf8', 'auth')],
                            }),
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'authority',
                    }),
                ],
                name: 'doStuff',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111111111111111111111111111111111111111111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/do_stuff.rs').content;

    // Then the docblock marks it as optional with PDA default.
    codeContains(content, ['optional', 'default to PDA']);
});

test('it resolves pdaValueNode defaults with argument seeds', () => {
    // Given a PDA with a variable seed referencing an instruction argument.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'lookup',
                                seeds: [
                                    constantPdaSeedNodeFromString('utf8', 'lookup'),
                                    variablePdaSeedNode('id', numberTypeNode('u64')),
                                ],
                            }),
                            [pdaSeedValueNode('id', argumentValueNode('lookupId'))],
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'lookupAccount',
                    }),
                ],
                arguments: [
                    instructionArgumentNode({
                        name: 'lookupId',
                        type: numberTypeNode('u64'),
                    }),
                ],
                name: 'lookup',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111111111111111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/lookup.rs').content;

    // Then the builder uses the argument value as a seed.
    codeContains(content, [
        'unwrap_or_else',
        'find_program_address',
        '"lookup".as_bytes()',
        'self.lookup_id.as_ref().expect("lookup_id is not set")',
    ]);
});

test('it uses pdaNode.programId for inline PDAs with custom program', () => {
    // Given an inline PDA with a hardcoded programId.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'crossPda',
                                programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
                                seeds: [constantPdaSeedNodeFromString('utf8', 'cross')],
                            }),
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'crossAccount',
                    }),
                ],
                name: 'crossProgram',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111111111111111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/cross_program.rs').content;

    // Then it uses the PDA's custom program address, not the current program.
    codeContains(content, ['find_program_address', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL']);
    // The PDA derivation should NOT use the current program's ID.
    codeDoesNotContains(content, ['&crate::MY_PROGRAM_ID']);
});

test('it renders programIdValueNode constant seeds', () => {
    // Given a PDA with a programIdValueNode seed (program address used as seed bytes).
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'programData',
                                seeds: [
                                    constantPdaSeedNodeFromString('utf8', 'data'),
                                    constantPdaSeedNodeFromProgramId(),
                                ],
                            }),
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'programData',
                    }),
                ],
                name: 'readData',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111111111111111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/read_data.rs').content;

    // Then the programId seed renders using the program constant.
    codeContains(content, ['find_program_address', '"data".as_bytes()', 'MY_PROGRAM_ID.as_ref()']);
});

test('it renders bytesTypeNode variable seeds with & prefix', () => {
    // Given a PDA with a variable seed of bytesTypeNode.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        isSigner: false,
                        isWritable: false,
                        name: 'data',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'derived',
                                seeds: [variablePdaSeedNode('rawData', bytesTypeNode())],
                            }),
                            [pdaSeedValueNode('rawData', accountValueNode('data'))],
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'derived',
                    }),
                ],
                name: 'process',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111111111111111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/process.rs').content;

    // Then the bytes seed uses & prefix, not .as_ref().
    codeContains(content, ['&data,']);
    codeDoesNotContains(content, ['data.as_ref()']);
});

test('it resolves linked pdaValueNode with variable account seeds', () => {
    // Given a linked PDA whose find_pda takes an account reference.
    const node = programNode({
        accounts: [
            accountNode({
                name: 'userToken',
                pda: pdaLinkNode('userTokenPda'),
            }),
        ],
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        isSigner: false,
                        isWritable: false,
                        name: 'owner',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode('userTokenPda', [
                            pdaSeedValueNode('owner', accountValueNode('owner')),
                        ]),
                        isSigner: false,
                        isWritable: false,
                        name: 'userToken',
                    }),
                ],
                name: 'claim',
            }),
        ],
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'userTokenPda',
                seeds: [
                    constantPdaSeedNodeFromString('utf8', 'token'),
                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                ],
            }),
        ],
        publicKey: '1111111111111111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/claim.rs').content;

    // Then the linked find_pda uses the account name (not PDA name) and receives the account reference.
    codeContains(content, ['UserToken::find_pda', '&owner,']);
});

test('it falls back to .expect() on circular PDA dependencies', () => {
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
                        isSigner: false,
                        isWritable: false,
                        name: 'accountB',
                    }),
                ],
                name: 'circular',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111111111111111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/circular.rs').content;

    // Then both accounts fall back to .expect() since neither PDA can be resolved.
    codeContains(content, [
        'account_a = self.account_a.expect("account_a is not set")',
        'account_b = self.account_b.expect("account_b is not set")',
    ]);
    codeDoesNotContains(content, ['find_program_address', 'unwrap_or_else']);
});

test('it uses optional path (not PDA) when account is isOptional with PDA default', () => {
    // Given an account that is both isOptional and has a PDA default.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'optPda',
                                seeds: [constantPdaSeedNodeFromString('utf8', 'opt')],
                            }),
                        ),
                        isOptional: true,
                        isSigner: false,
                        isWritable: false,
                        name: 'optionalAccount',
                    }),
                ],
                name: 'maybeUse',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111111111111111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/maybe_use.rs').content;

    // Then the optional flag takes precedence — no PDA auto-derivation.
    codeContains(content, ['let optional_account = self.optional_account;']);
    codeDoesNotContains(content, ['find_program_address', 'unwrap_or_else']);
});

test('it inlines find_program_address for linked PDA without matching account struct', () => {
    // Given a PDA defined in program.pdas but with NO corresponding account in program.accounts.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode('pdaOnly', []),
                        isSigner: false,
                        isWritable: false,
                        name: 'derivedAccount',
                    }),
                ],
                name: 'useIt',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'pdaOnly', seeds: [constantPdaSeedNodeFromString('utf8', 'pda_only')] })],
        publicKey: '1111111111111111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/use_it.rs').content;

    // Then it falls back to inline find_program_address (not find_pda).
    codeContains(content, ['find_program_address', '"pda_only".as_bytes()']);
    codeDoesNotContains(content, ['::find_pda']);
});

test('it uses the account name (not PDA name) for linked find_pda when names differ', () => {
    // Given an account named differently from its PDA.
    const node = programNode({
        accounts: [
            accountNode({
                name: 'extensionsHeader',
                pda: pdaLinkNode('extensions'),
            }),
        ],
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        isSigner: false,
                        isWritable: false,
                        name: 'owner',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode('extensions', [
                            pdaSeedValueNode('owner', accountValueNode('owner')),
                        ]),
                        isSigner: false,
                        isWritable: false,
                        name: 'ext',
                    }),
                ],
                name: 'readExtensions',
            }),
        ],
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'extensions',
                seeds: [
                    constantPdaSeedNodeFromString('utf8', 'ext'),
                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                ],
            }),
        ],
        publicKey: '1111111111111111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const content = getFromRenderMap(renderMap, 'instructions/read_extensions.rs').content;

    // Then it calls ExtensionsHeader::find_pda (the account name), not Extensions::find_pda.
    codeContains(content, ['ExtensionsHeader::find_pda']);
    codeDoesNotContains(content, ['Extensions::find_pda']);
});
