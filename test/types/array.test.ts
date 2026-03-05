import {
    arrayTypeNode,
    definedTypeNode,
    numberTypeNode,
    prefixedCountNode,
    publicKeyTypeNode,
    structFieldTypeNode,
    structTypeNode,
} from '@codama/nodes';
import { getFromRenderMap } from '@codama/renderers-core';
import { visit } from '@codama/visitors-core';
import { test } from 'vitest';

import { getRenderMapVisitor } from '../../src';
import { codeContains, codeDoesNotContains } from '../_setup';

test('it exports short vecs', () => {
    // Given an array using a shortU16 prefix.
    const node = definedTypeNode({
        name: 'myShortVec',
        type: arrayTypeNode(publicKeyTypeNode(), prefixedCountNode(numberTypeNode('shortU16'))),
    });

    // When we render the array.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect a short vec to be exported.
    codeContains(getFromRenderMap(renderMap, 'types/my_short_vec.rs').content, [
        /pub type MyShortVec = ShortVec<Address>;/,
        /use solana_address::Address/,
        /use solana_short_vec::ShortVec/,
    ]);
    codeDoesNotContains(getFromRenderMap(renderMap, 'types/my_short_vec.rs').content, [
        /use borsh::BorshSerialize/,
        /use borsh::BorshDeserialize/,
    ]);
});

test('it exports short vecs as struct fields', () => {
    // Given an array using a shortU16 prefix.
    const node = definedTypeNode({
        name: 'myShortVec',
        type: structTypeNode([
            structFieldTypeNode({
                name: 'value',
                type: arrayTypeNode(publicKeyTypeNode(), prefixedCountNode(numberTypeNode('shortU16'))),
            }),
        ]),
    });

    // When we render the array.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect a short vec to be exported as a struct field.
    codeContains(getFromRenderMap(renderMap, 'types/my_short_vec.rs').content, [
        /pub value: ShortVec<Address>,/,
        /use solana_address::Address/,
        /use solana_short_vec::ShortVec/,
    ]);
});
