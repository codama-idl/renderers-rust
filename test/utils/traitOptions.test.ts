import {
    accountNode,
    arrayTypeNode,
    bytesTypeNode,
    camelCase,
    definedTypeNode,
    enumEmptyVariantTypeNode,
    enumStructVariantTypeNode,
    enumTypeNode,
    fixedSizeTypeNode,
    instructionArgumentNode,
    instructionNode,
    numberTypeNode,
    prefixedCountNode,
    programNode,
    publicKeyTypeNode,
    rootNode,
    structFieldTypeNode,
    structTypeNode,
} from '@codama/nodes';
import { getFromRenderMap } from '@codama/renderers-core';
import { visit } from '@codama/visitors-core';
import { describe, expect, test } from 'vitest';

import { getRenderMapVisitor } from '../../src';
import { getTraitsFromNode, TraitOptions } from '../../src/utils';

describe('default values', () => {
    test('it defaults to a set of traits for data enums', () => {
        // Given a data enum defined type.
        const node = definedTypeNode({
            name: 'Command',
            type: enumTypeNode([
                enumStructVariantTypeNode(
                    'Play',
                    structTypeNode([structFieldTypeNode({ name: 'guess', type: numberTypeNode('u16') })]),
                ),
                enumEmptyVariantTypeNode('Quit'),
            ]),
        });

        // When we get the traits from the node using the default options.
        const { render, imports } = getTraitsFromNode(node);

        // Then we expect the following traits to be rendered.
        expect(render).toBe(`#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, Eq, PartialEq)]\n`);

        // And the following imports to be used.
        expect([...imports.imports]).toStrictEqual(['borsh::BorshSerialize', 'borsh::BorshDeserialize']);
    });

    test('it defaults to a set of traits for scalar enums', () => {
        // Given a scalar enum defined type.
        const node = definedTypeNode({
            name: 'Feedback',
            type: enumTypeNode([enumEmptyVariantTypeNode('Good'), enumEmptyVariantTypeNode('Bad')]),
        });

        // When we get the traits from the node using the default options.
        const { render, imports } = getTraitsFromNode(node);

        // Then we expect the following traits to be rendered.
        expect(render).toBe(
            `#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, Eq, PartialEq, Copy, PartialOrd, Hash, FromPrimitive)]\n`,
        );

        // And the following imports to be used.
        expect([...imports.imports]).toStrictEqual([
            'borsh::BorshSerialize',
            'borsh::BorshDeserialize',
            'num_derive::FromPrimitive',
        ]);
    });

    test('it defaults to a set of traits for structs', () => {
        // Given an account node.
        const node = accountNode({
            data: structTypeNode([
                structFieldTypeNode({ name: 'x', type: numberTypeNode('u64') }),
                structFieldTypeNode({ name: 'y', type: numberTypeNode('u64') }),
            ]),
            name: 'Coordinates',
        });

        // When we get the traits from the node using the default options.
        const { render, imports } = getTraitsFromNode(node);

        // Then we expect the following traits to be rendered.
        expect(render).toBe(`#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, Eq, PartialEq)]\n`);

        // And the following imports to be used.
        expect([...imports.imports]).toStrictEqual(['borsh::BorshSerialize', 'borsh::BorshDeserialize']);
    });

    test('it does not use default traits if they are overridden', () => {
        // Given a defined type node that should use custom traits.
        const node = accountNode({
            data: structTypeNode([
                structFieldTypeNode({ name: 'x', type: numberTypeNode('u64') }),
                structFieldTypeNode({ name: 'y', type: numberTypeNode('u64') }),
            ]),
            name: 'Coordinates',
        });

        // When we get the traits from the node using the
        // default options with the overrides attribute.
        const { render, imports } = getTraitsFromNode(node, {
            overrides: { coordinates: ['My', 'special::Traits'] },
        });

        // Then we expect the following traits to be rendered.
        expect(render).toBe(`#[derive(My, Traits)]\n`);

        // And the following imports to be used.
        expect([...imports.imports]).toStrictEqual(['special::Traits']);
    });

    test('it still uses feature flags for overridden traits', () => {
        // Given a defined type node that should use custom traits.
        const node = accountNode({
            data: structTypeNode([
                structFieldTypeNode({ name: 'x', type: numberTypeNode('u64') }),
                structFieldTypeNode({ name: 'y', type: numberTypeNode('u64') }),
            ]),
            name: 'Coordinates',
        });

        // When we get the traits from the node using custom traits
        // such that some are part of the feature flag defaults.
        const { render } = getTraitsFromNode(node, {
            overrides: { coordinates: ['My', 'special::Traits', 'serde::Serialize'] },
        });

        // Then we expect the following traits to be rendered.
        expect(render).toBe(`#[derive(My, Traits, Serialize)]\n`);
    });
});

const RESET_OPTIONS: Required<TraitOptions> = {
    baseDefaults: [],
    dataEnumDefaults: [],
    featureFlags: {},
    overrides: {},
    scalarEnumDefaults: [],
    structDefaults: [],
    useFullyQualifiedName: false,
};

describe('base traits', () => {
    test('it uses both the base and data enum traits', () => {
        // Given a data enum defined type.
        const node = definedTypeNode({
            name: 'Command',
            type: enumTypeNode([
                enumStructVariantTypeNode(
                    'Play',
                    structTypeNode([structFieldTypeNode({ name: 'guess', type: numberTypeNode('u16') })]),
                ),
                enumEmptyVariantTypeNode('Quit'),
            ]),
        });

        // When we get the traits from the node using custom base and data enum defaults.
        const { render } = getTraitsFromNode(node, {
            ...RESET_OPTIONS,
            baseDefaults: ['MyBaseTrait'],
            dataEnumDefaults: ['MyDataEnumTrait'],
        });

        // Then we expect both the base and data enum traits to be rendered.
        expect(render).toBe(`#[derive(MyBaseTrait, MyDataEnumTrait)]\n`);
    });

    test('it uses both the base and scalar enum traits', () => {
        // Given a scalar enum defined type.
        const node = definedTypeNode({
            name: 'Feedback',
            type: enumTypeNode([enumEmptyVariantTypeNode('Good'), enumEmptyVariantTypeNode('Bad')]),
        });

        // When we get the traits from the node using custom base and scalar enum defaults.
        const { render } = getTraitsFromNode(node, {
            ...RESET_OPTIONS,
            baseDefaults: ['MyBaseTrait'],
            scalarEnumDefaults: ['MyScalarEnumTrait'],
        });

        // Then we expect both the base and scalar enum traits to be rendered.
        expect(render).toBe(`#[derive(MyBaseTrait, MyScalarEnumTrait)]\n`);
    });

    test('it uses both the base and struct traits', () => {
        // Given an account node.
        const node = accountNode({
            data: structTypeNode([
                structFieldTypeNode({ name: 'x', type: numberTypeNode('u64') }),
                structFieldTypeNode({ name: 'y', type: numberTypeNode('u64') }),
            ]),
            name: 'Coordinates',
        });

        // When we get the traits from the node using custom base and struct defaults.
        const { render } = getTraitsFromNode(node, {
            ...RESET_OPTIONS,
            baseDefaults: ['MyBaseTrait'],
            structDefaults: ['MyStructTrait'],
        });

        // Then we expect both the base and struct traits to be rendered.
        expect(render).toBe(`#[derive(MyBaseTrait, MyStructTrait)]\n`);
    });

    test('it never uses traits for type aliases', () => {
        // Given a defined type node that is not an enum or struct.
        const node = definedTypeNode({
            name: 'Score',
            type: numberTypeNode('u64'),
        });

        // When we get the traits from the node such that we have base defaults.
        const { render } = getTraitsFromNode(node, {
            ...RESET_OPTIONS,
            baseDefaults: ['MyBaseTrait'],
        });

        // Then we expect no traits to be rendered.
        expect(render).toBe('');
    });

    test('it identifies feature flags under all default traits', () => {
        // Given a scalar enum defined type.
        const node = definedTypeNode({
            name: 'Feedback',
            type: enumTypeNode([enumEmptyVariantTypeNode('Good'), enumEmptyVariantTypeNode('Bad')]),
        });

        // When we get the traits from the node such that:
        // - We provide custom base and scalar enum defaults.
        // - We provide custom feature flags for traits in both categories.
        const { render } = getTraitsFromNode(node, {
            ...RESET_OPTIONS,
            baseDefaults: ['MyBaseTrait', 'MyNonFeatureTrait'],
            featureFlags: {
                base: ['MyBaseTrait'],
                enum: ['MyScalarEnumTrait'],
            },
            scalarEnumDefaults: ['MyScalarEnumTrait'],
        });

        // Then we expect both the base and enum traits to be rendered as separate feature flags.
        expect(render).toBe(
            `#[derive(MyNonFeatureTrait)]\n` +
                `#[cfg_attr(feature = "base", derive(MyBaseTrait))]\n` +
                `#[cfg_attr(feature = "enum", derive(MyScalarEnumTrait))]\n`,
        );
    });

    test('it renders traits correctly when they are all under feature flags', () => {
        // Given a scalar enum defined type.
        const node = definedTypeNode({
            name: 'Feedback',
            type: enumTypeNode([enumEmptyVariantTypeNode('Good'), enumEmptyVariantTypeNode('Bad')]),
        });

        // When we get the traits from the node such that
        // all traits are under feature flags.
        const { render } = getTraitsFromNode(node, {
            ...RESET_OPTIONS,
            baseDefaults: ['MyBaseTrait'],
            featureFlags: {
                base: ['MyBaseTrait'],
                enum: ['MyScalarEnumTrait'],
            },
            scalarEnumDefaults: ['MyScalarEnumTrait'],
        });

        // Then we expect the following traits to be rendered.
        expect(render).toBe(
            `#[cfg_attr(feature = "base", derive(MyBaseTrait))]\n#[cfg_attr(feature = "enum", derive(MyScalarEnumTrait))]\n`,
        );
    });
});

describe('overridden traits', () => {
    test('it replaces all default traits with the overridden traits', () => {
        // Given a scalar enum defined type.
        const node = definedTypeNode({
            name: 'Feedback',
            type: enumTypeNode([enumEmptyVariantTypeNode('Good'), enumEmptyVariantTypeNode('Bad')]),
        });

        // When we get the traits from the node such that:
        // - We provide custom base and enum defaults.
        // - We override the feedback type with custom traits.
        const { render } = getTraitsFromNode(node, {
            ...RESET_OPTIONS,
            baseDefaults: ['MyBaseTrait'],
            overrides: { feedback: ['MyFeedbackTrait'] },
            scalarEnumDefaults: ['MyScalarEnumTrait'],
        });

        // Then we expect only the feedback traits to be rendered.
        expect(render).toBe(`#[derive(MyFeedbackTrait)]\n`);
    });

    test('it finds traits to override when using pascal case', () => {
        // Given a scalar enum defined type.
        const node = definedTypeNode({
            name: 'Feedback',
            type: enumTypeNode([enumEmptyVariantTypeNode('Good'), enumEmptyVariantTypeNode('Bad')]),
        });

        // When we get the traits from the node such that
        // we use PascalCase for the type name.
        const { render } = getTraitsFromNode(node, {
            ...RESET_OPTIONS,
            overrides: { Feedback: ['MyFeedbackTrait'] },
        });

        // Then we still expect the custom feedback traits to be rendered.
        expect(render).toBe(`#[derive(MyFeedbackTrait)]\n`);
    });

    test('it identifies feature flags under all overridden traits', () => {
        // Given a scalar enum defined type.
        const node = definedTypeNode({
            name: 'Feedback',
            type: enumTypeNode([enumEmptyVariantTypeNode('Good'), enumEmptyVariantTypeNode('Bad')]),
        });

        // When we get the traits from the node such that:
        // - We override the feedback type with custom traits.
        // - We provide custom feature flags for these some of these custom traits.
        const { render } = getTraitsFromNode(node, {
            ...RESET_OPTIONS,
            featureFlags: { custom: ['MyFeedbackTrait'] },
            overrides: { feedback: ['MyFeedbackTrait', 'MyNonFeatureTrait'] },
        });

        // Then we expect some of the overridden traits to be rendered under feature flags.
        expect(render).toBe(`#[derive(MyNonFeatureTrait)]\n#[cfg_attr(feature = "custom", derive(MyFeedbackTrait))]\n`);
    });
});

describe('feature-flag-only traits (not in defaults)', () => {
    test('it injects feature-flagged traits that are not in any defaults', () => {
        // Given a struct defined type with no serde in defaults.
        const node = definedTypeNode({
            name: 'MyStruct',
            type: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
        });

        // When we specify traits only in featureFlags (not in baseDefaults).
        const { render } = getTraitsFromNode(node, {
            ...RESET_OPTIONS,
            baseDefaults: ['Clone', 'Debug'],
            featureFlags: {
                serde: ['serde::Serialize'],
            },
        });

        // Then we expect the feature-only trait to appear in cfg_attr.
        expect(render).toBe(`#[derive(Clone, Debug)]\n` + `#[cfg_attr(feature = "serde", derive(serde::Serialize))]\n`);
    });

    test('it injects multiple feature-flag-only traits across different features', () => {
        // Given a struct defined type.
        const node = definedTypeNode({
            name: 'MyStruct',
            type: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
        });

        // When we specify traits only in featureFlags with multiple features.
        const { render } = getTraitsFromNode(node, {
            ...RESET_OPTIONS,
            baseDefaults: ['Clone'],
            featureFlags: {
                extra: ['MyExtraTrait'],
                serde: ['serde::Serialize', 'serde::Deserialize'],
            },
        });

        // Then all feature-only traits appear in their respective cfg_attr blocks.
        expect(render).toBe(
            `#[derive(Clone)]\n` +
                `#[cfg_attr(feature = "extra", derive(MyExtraTrait))]\n` +
                `#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]\n`,
        );
    });

    test('it mixes default-partitioned and feature-only traits correctly', () => {
        // Given a struct defined type.
        const node = definedTypeNode({
            name: 'MyStruct',
            type: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
        });

        // When some featureFlags traits are in defaults and some are not.
        const { render } = getTraitsFromNode(node, {
            ...RESET_OPTIONS,
            baseDefaults: ['Clone', 'Debug', 'serde::Serialize'],
            featureFlags: {
                serde: ['serde::Serialize', 'serde::Deserialize'],
            },
        });

        // Then Serialize (in defaults) and Deserialize (not in defaults) both appear under serde.
        expect(render).toBe(
            `#[derive(Clone, Debug)]\n` +
                `#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]\n`,
        );
    });

    test('it works with feature-only traits and no defaults at all', () => {
        // Given a struct defined type.
        const node = definedTypeNode({
            name: 'MyStruct',
            type: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
        });

        // When all traits are only in featureFlags.
        const { render } = getTraitsFromNode(node, {
            ...RESET_OPTIONS,
            featureFlags: {
                serde: ['serde::Serialize'],
            },
        });

        // Then only cfg_attr is rendered with no #[derive(...)].
        expect(render).toBe(`#[cfg_attr(feature = "serde", derive(serde::Serialize))]\n`);
    });
});

describe('fully qualified name traits', () => {
    test('it can use fully qualified names for traits instead of importing them', () => {
        // Given a scalar enum defined type.
        const node = definedTypeNode({
            name: 'Feedback',
            type: enumTypeNode([enumEmptyVariantTypeNode('Good'), enumEmptyVariantTypeNode('Bad')]),
        });

        // When we get the traits from the node such that we use fully qualified names.
        const { render, imports } = getTraitsFromNode(node, {
            ...RESET_OPTIONS,
            baseDefaults: ['fruits::Apple', 'fruits::Banana', 'vegetables::Carrot'],
            useFullyQualifiedName: true,
        });

        // Then we expect the fully qualified names to be used for the traits.
        expect(render).toBe(`#[derive(fruits::Apple, fruits::Banana, vegetables::Carrot)]\n`);

        // And no imports should be used.
        expect([...imports.imports]).toStrictEqual([]);
    });
});

describe('conditional try_to_vec generation', () => {
    test('it generates try_to_vec method when BorshSerialize is present', () => {
        // Given an instruction node.
        const node = instructionNode({ name: 'transfer' });

        // When we render the instruction with default traits (which include BorshSerialize).
        const renderMap = visit(
            rootNode(programNode({ instructions: [node], name: 'myProgram', publicKey: '1111' })),
            getRenderMapVisitor(),
        );

        // Then we expect the try_to_vec method to be included with borsh::to_vec implementation.
        const instruction = getFromRenderMap(renderMap, 'instructions/transfer.rs').content;
        expect(instruction).toContain('pub(crate) fn try_to_vec(&self) -> Result<Vec<u8>, std::io::Error>');
        expect(instruction).toContain('borsh::to_vec(self)');

        // And the instruction functions should use try_to_vec.
        expect(instruction).toContain('data = TransferInstructionData::new().try_to_vec().unwrap()');
    });

    test('it does not generate try_to_vec method when BorshSerialize is removed', () => {
        // Given an instruction node.
        const node = instructionNode({ name: 'transfer' });

        // When we render the instruction without BorshSerialize trait.
        const renderMap = visit(
            rootNode(programNode({ instructions: [node], name: 'myProgram', publicKey: '1111' })),
            getRenderMapVisitor({
                traitOptions: {
                    baseDefaults: ['Clone', 'Debug'], // No BorshSerialize
                },
            }),
        );

        // Then we expect no try_to_vec method and no borsh::to_vec calls.
        const instruction = getFromRenderMap(renderMap, 'instructions/transfer.rs').content;
        expect(instruction).not.toContain('pub(crate) fn try_to_vec(&self)');
        expect(instruction).not.toContain('borsh::to_vec');

        // But it should still have the try_to_vec().unwrap() call (user must implement).
        expect(instruction).toContain('data = TransferInstructionData::new().try_to_vec().unwrap()');
    });

    test('it generates try_to_vec for instruction args when BorshSerialize is present', () => {
        // Given an instruction node with arguments.
        const node = instructionNode({
            arguments: [
                instructionArgumentNode({ name: camelCase('amount'), type: numberTypeNode('u64') }),
                instructionArgumentNode({ name: camelCase('memo'), type: numberTypeNode('u8') }),
            ],
            name: 'transfer',
        });

        // When we render the instruction with default traits.
        const renderMap = visit(
            rootNode(programNode({ instructions: [node], name: 'myProgram', publicKey: '1111' })),
            getRenderMapVisitor(),
        );

        // Then we expect try_to_vec to be included for both InstructionData and InstructionArgs.
        const instruction = getFromRenderMap(renderMap, 'instructions/transfer.rs').content;
        expect(instruction).toMatch(/impl TransferInstructionData \{[\s\S]*?pub\(crate\) fn try_to_vec/);
        expect(instruction).toMatch(/impl TransferInstructionArgs \{[\s\S]*?pub\(crate\) fn try_to_vec/);

        // And both should use borsh::to_vec internally.
        expect(instruction.match(/borsh::to_vec/g)?.length).toBe(2);
    });

    test('it handles fully qualified BorshSerialize in templates', () => {
        // Given an instruction node.
        const node = instructionNode({ name: 'transfer' });

        // When we render with fully qualified BorshSerialize trait.
        const renderMap = visit(
            rootNode(programNode({ instructions: [node], name: 'myProgram', publicKey: '1111' })),
            getRenderMapVisitor({
                traitOptions: {
                    baseDefaults: ['borsh::BorshSerialize', 'borsh::BorshDeserialize'],
                    useFullyQualifiedName: true,
                },
            }),
        );

        // Then we expect try_to_vec to be generated even with fully qualified trait name.
        const instruction = getFromRenderMap(renderMap, 'instructions/transfer.rs').content;
        expect(instruction).toContain('pub(crate) fn try_to_vec(&self) -> Result<Vec<u8>, std::io::Error>');
        expect(instruction).toContain('borsh::to_vec(self)');
        expect(instruction).toContain('#[derive(borsh::BorshSerialize');
    });

    test('it respects overrides that exclude BorshSerialize', () => {
        // Given an instruction node.
        const node = instructionNode({ name: 'transfer' });

        // When we render the instruction with overrides that exclude BorshSerialize.
        const renderMap = visit(
            rootNode(programNode({ instructions: [node], name: 'myProgram', publicKey: '1111' })),
            getRenderMapVisitor({
                traitOptions: {
                    baseDefaults: ['BorshSerialize', 'BorshDeserialize'],
                    overrides: {
                        transfer: ['Clone', 'Debug'], // Override removes BorshSerialize
                    },
                },
            }),
        );

        // Then we expect the try_to_vec method to be omitted and no borsh::to_vec calls.
        const instruction = getFromRenderMap(renderMap, 'instructions/transfer.rs').content;
        expect(instruction).not.toContain('pub(crate) fn try_to_vec(&self)');
        expect(instruction).not.toContain('borsh::to_vec');
        expect(instruction).toContain('#[derive(Clone, Debug)]');
    });
});

describe('conditional serde field attributes', () => {
    test('it generates plain serde field attributes when serde is not feature-flagged', () => {
        // Given an account with a Pubkey field.
        const node = accountNode({
            data: structTypeNode([
                structFieldTypeNode({ name: 'authority', type: publicKeyTypeNode() }),
                structFieldTypeNode({
                    name: 'tokens',
                    type: arrayTypeNode(publicKeyTypeNode(), prefixedCountNode(numberTypeNode('u32'))),
                }),
            ]),
            name: 'myAccount',
        });

        // When we render with serde in base defaults but no feature flags.
        const renderMap = visit(
            rootNode(programNode({ accounts: [node], name: 'myProgram', publicKey: '1111' })),
            getRenderMapVisitor({
                traitOptions: {
                    baseDefaults: [
                        'BorshSerialize',
                        'BorshDeserialize',
                        'serde::Serialize',
                        'serde::Deserialize',
                        'Clone',
                        'Debug',
                        'Eq',
                        'PartialEq',
                    ],
                    featureFlags: {}, // No feature flags
                },
            }),
        );

        // Then we expect field attributes without cfg_attr.
        const account = getFromRenderMap(renderMap, 'accounts/my_account.rs').content;
        expect(account).toContain('#[serde(with = "serde_with::As::<serde_with::DisplayFromStr>")]');
        expect(account).toContain('#[serde(with = "serde_with::As::<Vec<serde_with::DisplayFromStr>>")]');
        expect(account).not.toContain('#[cfg_attr(feature = "serde"');
    });

    test('it omits serde field attributes when serde traits are removed', () => {
        // Given an account with a Pubkey field.
        const node = accountNode({
            data: structTypeNode([
                structFieldTypeNode({ name: 'authority', type: publicKeyTypeNode() }),
                structFieldTypeNode({
                    name: 'tokens',
                    type: arrayTypeNode(publicKeyTypeNode(), prefixedCountNode(numberTypeNode('u32'))),
                }),
            ]),
            name: 'myAccount',
        });

        // When we render without serde traits.
        const renderMap = visit(
            rootNode(programNode({ accounts: [node], name: 'myProgram', publicKey: '1111' })),
            getRenderMapVisitor({
                traitOptions: {
                    baseDefaults: ['BorshSerialize', 'BorshDeserialize', 'Clone', 'Debug'],
                    featureFlags: {},
                },
            }),
        );

        // Then we expect no serde field attributes at all.
        const account = getFromRenderMap(renderMap, 'accounts/my_account.rs').content;
        expect(account).not.toContain('serde(with');
        expect(account).not.toContain('serde_with::As');
        expect(account).not.toContain('DisplayFromStr');
    });

    test('it handles bytes serde attributes conditionally', () => {
        // Given an account with a fixed-size bytes field.
        const node = accountNode({
            data: structTypeNode([
                structFieldTypeNode({
                    name: 'signature',
                    type: fixedSizeTypeNode(bytesTypeNode(), 64),
                }),
            ]),
            name: 'myAccount',
        });

        // When we render with serde not feature-flagged.
        const renderMap = visit(
            rootNode(programNode({ accounts: [node], name: 'myProgram', publicKey: '1111' })),
            getRenderMapVisitor({
                traitOptions: {
                    baseDefaults: ['serde::Serialize', 'serde::Deserialize', 'Clone', 'Debug'],
                    featureFlags: {},
                },
            }),
        );

        // Then we expect the bytes attribute without cfg_attr.
        const account = getFromRenderMap(renderMap, 'accounts/my_account.rs').content;
        expect(account).toContain('#[serde(with = "serde_with::As::<serde_with::Bytes>")]');
        expect(account).not.toContain('#[cfg_attr(feature = "serde"');
    });

    test('it uses custom feature names for serde field attributes', () => {
        // Given an account with a Pubkey field.
        const node = accountNode({
            data: structTypeNode([structFieldTypeNode({ name: 'authority', type: publicKeyTypeNode() })]),
            name: 'myAccount',
        });

        // When we render with serde under a custom feature name.
        const renderMap = visit(
            rootNode(programNode({ accounts: [node], name: 'myProgram', publicKey: '1111' })),
            getRenderMapVisitor({
                traitOptions: {
                    baseDefaults: ['BorshSerialize', 'BorshDeserialize', 'serde::Serialize', 'serde::Deserialize'],
                    featureFlags: {
                        json_support: ['serde::Serialize', 'serde::Deserialize'],
                    },
                },
            }),
        );

        // Then we expect field attributes with the custom feature name.
        const account = getFromRenderMap(renderMap, 'accounts/my_account.rs').content;
        expect(account).toContain(
            '#[cfg_attr(feature = "json_support", serde(with = "serde_with::As::<serde_with::DisplayFromStr>"))]',
        );
        expect(account).not.toContain('#[cfg_attr(feature = "serde"');
    });

    test('it respects overrides for serde field attributes', () => {
        // Given an account with a Pubkey field.
        const node = accountNode({
            data: structTypeNode([structFieldTypeNode({ name: 'authority', type: publicKeyTypeNode() })]),
            name: 'myAccount',
        });

        // When we render with overrides that include serde but not feature-flagged.
        const renderMap = visit(
            rootNode(programNode({ accounts: [node], name: 'myProgram', publicKey: '1111' })),
            getRenderMapVisitor({
                traitOptions: {
                    baseDefaults: ['Clone', 'Debug'],
                    featureFlags: {},
                    overrides: {
                        myAccount: ['serde::Serialize', 'serde::Deserialize', 'Clone', 'Debug'],
                    },
                },
            }),
        );

        // Then we expect field attributes without cfg_attr since override has serde but no feature flag.
        const account = getFromRenderMap(renderMap, 'accounts/my_account.rs').content;
        expect(account).toContain('#[serde(with = "serde_with::As::<serde_with::DisplayFromStr>")]');
        expect(account).not.toContain('#[cfg_attr(feature = "serde"');
    });

    test('it emits serde field attributes when serde is only in featureFlags (not in defaults)', () => {
        // Given an account with a Pubkey field.
        const node = accountNode({
            data: structTypeNode([structFieldTypeNode({ name: 'authority', type: publicKeyTypeNode() })]),
            name: 'myAccount',
        });

        // When serde traits are only in featureFlags, not in baseDefaults.
        const renderMap = visit(
            rootNode(programNode({ accounts: [node], name: 'myProgram', publicKey: '1111' })),
            getRenderMapVisitor({
                traitOptions: {
                    baseDefaults: ['BorshSerialize', 'BorshDeserialize', 'Clone', 'Debug'],
                    featureFlags: {
                        serde: ['serde::Serialize', 'serde::Deserialize'],
                    },
                },
            }),
        );

        // Then we expect both cfg_attr derive and cfg_attr serde field attributes.
        const account = getFromRenderMap(renderMap, 'accounts/my_account.rs').content;
        expect(account).toContain('#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]');
        expect(account).toContain(
            '#[cfg_attr(feature = "serde", serde(with = "serde_with::As::<serde_with::DisplayFromStr>"))]',
        );
    });
});
