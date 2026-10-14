import {
    bytesTypeNode,
    bytesValueNode,
    constantValueNode,
    eventNode,
    fixedSizeTypeNode,
    hiddenPrefixTypeNode,
    numberTypeNode,
    programNode,
    rootNode,
    structFieldTypeNode,
    structTypeNode,
} from '@codama/nodes';
import { getFromRenderMap } from '@codama/renderers-core';
import { visit } from '@codama/visitors-core';
import { test } from 'vitest';

import { getRenderMapVisitor } from '../src';
import { codeContains } from './_setup';

test('it renders deserializable events in an events module', () => {
    // Given the following program with an event.
    const node = rootNode(
        programNode({
            events: [
                eventNode({
                    data: hiddenPrefixTypeNode(
                        structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                        [
                            constantValueNode(
                                fixedSizeTypeNode(bytesTypeNode(), 8),
                                bytesValueNode('base16', '0102030405060708'),
                            ),
                        ],
                    ),
                    name: 'transferEvent',
                }),
            ],
            name: 'splToken',
            publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        }),
    );

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then it exposes the event from a dedicated module with a byte deserializer.
    codeContains(getFromRenderMap(renderMap, 'events/transfer_event.rs').content, [
        'pub struct TransferEvent',
        'pub amount: u64,',
        'pub fn from_bytes(data: &[u8]) -> Result<Self, std::io::Error>',
        'Self::deserialize(&mut data)',
    ]);
    codeContains(getFromRenderMap(renderMap, 'events/mod.rs').content, [
        'pub(crate) mod r#transfer_event;',
        'pub use self::r#transfer_event::*;',
    ]);
    codeContains(getFromRenderMap(renderMap, 'mod.rs').content, 'pub mod events;');
});
