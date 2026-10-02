import {
    definedTypeNode,
    enumEmptyVariantTypeNode,
    enumStructVariantTypeNode,
    enumTupleVariantTypeNode,
    enumTypeNode,
    numberTypeNode,
    programNode,
    sizePrefixTypeNode,
    stringTypeNode,
    structFieldTypeNode,
    structTypeNode,
    tupleTypeNode,
} from '@codama/nodes';
import { getFromRenderMap } from '@codama/renderers-core';
import { visit } from '@codama/visitors-core';
import { expect, test } from 'vitest';

import { getRenderMapVisitor } from '../src';
import { codeContains, codeDoesNotContains } from './_setup';

test('it renders a prefix string on a defined type', () => {
    // Given the following program with 1 defined type using a prefixed size string.
    const node = programNode({
        definedTypes: [
            definedTypeNode({
                name: 'blob',
                type: structTypeNode([
                    structFieldTypeNode({
                        name: 'contentType',
                        type: sizePrefixTypeNode(stringTypeNode('utf8'), numberTypeNode('u8')),
                    }),
                ]),
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following use and identifier to be rendered.
    codeContains(getFromRenderMap(renderMap, 'types/blob.rs').content, [
        `use spl_collections::U8PrefixedStr;`,
        `content_type: U8PrefixedStr,`,
    ]);
});

test('it renders a scalar enum with Copy derive', () => {
    // Given the following program with 1 defined type using a prefixed size string.
    const node = programNode({
        definedTypes: [
            definedTypeNode({
                name: 'tag',
                type: enumTypeNode([enumEmptyVariantTypeNode('Uninitialized'), enumEmptyVariantTypeNode('Account')]),
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following use and identifier to be rendered.
    codeContains(getFromRenderMap(renderMap, 'types/tag.rs').content, [`#[derive(`, `Copy`, `pub enum Tag`]);
});

test('it renders a non-scalar enum without Copy derive', () => {
    // Given the following program with 1 defined type using a prefixed size string.
    const node = programNode({
        definedTypes: [
            definedTypeNode({
                name: 'tagWithStruct',
                type: enumTypeNode([
                    enumEmptyVariantTypeNode('Uninitialized'),
                    enumStructVariantTypeNode(
                        'Account',
                        structTypeNode([
                            structFieldTypeNode({
                                name: 'contentType',
                                type: sizePrefixTypeNode(stringTypeNode('utf8'), numberTypeNode('u8')),
                            }),
                        ]),
                    ),
                ]),
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following use and identifier to be rendered.
    codeContains(getFromRenderMap(renderMap, 'types/tag_with_struct.rs').content, [
        `#[derive(`,
        `pub enum TagWithStruct`,
    ]);
    // And we expect the Copy derive to be missing.
    codeDoesNotContains(getFromRenderMap(renderMap, 'types/tag_with_struct.rs').content, `Copy`);
});

test('it renders scalar enum variants with their custom discriminators', () => {
    // Given a scalar enum whose variants carry custom discriminators.
    const node = programNode({
        definedTypes: [
            definedTypeNode({
                name: 'direction',
                type: enumTypeNode([
                    enumEmptyVariantTypeNode('up'),
                    enumEmptyVariantTypeNode('down', 3),
                    enumEmptyVariantTypeNode('left', 5),
                ]),
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then every variant gets an explicit value, with omitted ones falling back to their position.
    codeContains(getFromRenderMap(renderMap, 'types/direction.rs').content, [
        '#[repr(u8)]',
        '#[borsh(use_discriminant = true)]',
        'pub enum Direction',
        'Up = 0,',
        'Down = 3,',
        'Left = 5,',
    ]);
});

test('it renders data enum variants with their custom discriminators', () => {
    // Given a data enum whose variants carry custom discriminators.
    const node = programNode({
        definedTypes: [
            definedTypeNode({
                name: 'command',
                type: enumTypeNode([
                    enumEmptyVariantTypeNode('quit'),
                    enumTupleVariantTypeNode('write', tupleTypeNode([numberTypeNode('u32')]), 3),
                    enumStructVariantTypeNode(
                        'move',
                        structTypeNode([structFieldTypeNode({ name: 'x', type: numberTypeNode('u32') })]),
                        5,
                    ),
                ]),
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the explicit values follow the variant payloads.
    codeContains(getFromRenderMap(renderMap, 'types/command.rs').content, [
        '#[repr(u8)]',
        '#[borsh(use_discriminant = true)]',
        'Quit = 0,',
        'Write(u32) = 3,',
        '} = 5,',
    ]);
});

test('it rejects custom discriminators on enums that are not u8-sized', () => {
    // Given a u16-sized enum with a custom discriminator.
    const node = programNode({
        definedTypes: [
            definedTypeNode({
                name: 'direction',
                type: enumTypeNode([enumEmptyVariantTypeNode('up', 300), enumEmptyVariantTypeNode('down')], {
                    size: numberTypeNode('u16'),
                }),
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // Then rendering it throws, since Borsh only supports u8 discriminants.
    expect(() => visit(node, getRenderMapVisitor())).toThrow(/u8-sized/);
});

test('it renders enums without custom discriminators as before', () => {
    // Given a scalar enum without custom discriminators.
    const node = programNode({
        definedTypes: [
            definedTypeNode({
                name: 'direction',
                type: enumTypeNode([enumEmptyVariantTypeNode('up'), enumEmptyVariantTypeNode('down')]),
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then no attributes or explicit values are added.
    codeContains(getFromRenderMap(renderMap, 'types/direction.rs').content, ['Up,', 'Down,']);
    codeDoesNotContains(getFromRenderMap(renderMap, 'types/direction.rs').content, [
        'use_discriminant',
        '#[repr(u8)]',
        '= 0,',
    ]);
});
