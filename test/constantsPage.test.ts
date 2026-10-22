import {
    bytesTypeNode,
    bytesValueNode,
    constantNode,
    fixedSizeTypeNode,
    numberTypeNode,
    numberValueNode,
    programNode,
    rootNode,
    stringValueNode,
} from '@codama/nodes';
import { getFromRenderMap } from '@codama/renderers-core';
import { visit } from '@codama/visitors-core';
import { test } from 'vitest';

import { getRenderMapVisitor } from '../src';
import { codeContains } from './_setup';

test('it renders program constants in a top-level constants page', () => {
    const node = rootNode(
        programNode({
            constants: [
                constantNode('maxOption', numberTypeNode('u8'), numberValueNode(10), ['Maximum options.']),
                constantNode('seed', bytesTypeNode(), bytesValueNode('utf8', 'seed')),
            ],
            name: 'governance',
            publicKey: 'GovER5Lthms3bLBqWub97yVrQm9WLZ7YgRrxYQYy2f',
        }),
    );

    const renderMap = visit(node, getRenderMapVisitor());

    codeContains(getFromRenderMap(renderMap, 'constants.rs').content, [
        '/// Maximum options.',
        'pub const MAX_OPTION: u8 = 10;',
        "pub const SEED: &'static [u8] = &[115, 101, 101, 100];",
    ]);
    codeContains(getFromRenderMap(renderMap, 'mod.rs').content, 'pub mod constants;');
});

test('it renders JSON byte arrays from Anchor constants as fixed byte arrays', () => {
    const node = rootNode(
        programNode({
            constants: [
                constantNode('guardV1', fixedSizeTypeNode(bytesTypeNode(), 3), stringValueNode('[103, 117, 97]')),
            ],
            name: 'tokenGuard',
            publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        }),
    );

    const renderMap = visit(node, getRenderMapVisitor());

    codeContains(getFromRenderMap(renderMap, 'constants.rs').content, 'pub const GUARD_V1: [u8; 3] = [103, 117, 97];');
});
