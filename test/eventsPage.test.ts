import {
    arrayTypeNode,
    arrayValueNode,
    bytesTypeNode,
    bytesValueNode,
    CamelCaseString,
    constantDiscriminatorNode,
    constantValueNode,
    definedTypeLinkNode,
    definedTypeNode,
    eventNode,
    fieldDiscriminatorNode,
    fixedCountNode,
    fixedSizeTypeNode,
    hiddenPrefixTypeNode,
    numberTypeNode,
    numberValueNode,
    programNode,
    rootNode,
    sizeDiscriminatorNode,
    structFieldTypeNode,
    structTypeNode,
} from '@codama/nodes';
import { getFromRenderMap } from '@codama/renderers-core';
import { visit } from '@codama/visitors-core';
import { expect, test, vi } from 'vitest';

import { getRenderMapVisitor } from '../src';
import { codeContains, codeDoesNotContains } from './_setup';

test('it renders an event with discriminator as a struct with from_bytes', () => {
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([
                        structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') }),
                        structFieldTypeNode({ name: 'price', type: numberTypeNode('u64') }),
                    ]),
                    [
                        constantValueNode(
                            fixedSizeTypeNode(bytesTypeNode(), 8),
                            bytesValueNode('base16', 'bddB7fd34ee661ee'),
                        ),
                    ],
                ),
                discriminators: [
                    constantDiscriminatorNode(
                        constantValueNode(
                            fixedSizeTypeNode(bytesTypeNode(), 8),
                            bytesValueNode('base16', 'bddB7fd34ee661ee'),
                        ),
                    ),
                ],
                name: 'tradeEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    codeContains(getFromRenderMap(renderMap, 'events/trade_event.rs').content, [
        '#[derive(',
        'BorshSerialize',
        'BorshDeserialize',
        'pub struct TradeEvent',
        'pub amount: u64,',
        'pub price: u64,',
        'TRADE_EVENT_DISCRIMINATOR',
        'pub fn from_bytes',
        '"invalid event discriminator"',
        'Self::deserialize(&mut data)',
    ]);
});

test('it renders an event without discriminator as a plain struct', () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u32') })]),
                name: 'simpleEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    codeContains(getFromRenderMap(renderMap, 'events/simple_event.rs').content, [
        'pub struct SimpleEvent',
        'pub value: u32,',
    ]);
    codeDoesNotContains(getFromRenderMap(renderMap, 'events/simple_event.rs').content, ['DISCRIMINATOR', 'from_bytes']);
});

test('it does not render events module for programs without events', () => {
    const node = rootNode(
        programNode({
            name: 'myProgram',
            publicKey: '11111111111111111111111111111111',
        }),
    );

    const renderMap = visit(node, getRenderMapVisitor());

    codeDoesNotContains(getFromRenderMap(renderMap, 'mod.rs').content, 'pub mod events;');
});

test('it renders events in the events module', () => {
    const node = rootNode(
        programNode({
            events: [
                eventNode({
                    data: structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                    name: 'transferEvent',
                }),
                eventNode({
                    data: structTypeNode([structFieldTypeNode({ name: 'delegate', type: numberTypeNode('u64') })]),
                    name: 'approveEvent',
                }),
            ],
            name: 'myProgram',
            publicKey: '11111111111111111111111111111111',
        }),
    );

    const renderMap = visit(node, getRenderMapVisitor());
    codeContains(getFromRenderMap(renderMap, 'events/mod.rs').content, [
        'pub(crate) mod r#approve_event;',
        'pub use self::r#approve_event::*;',
        'pub(crate) mod r#transfer_event;',
        'pub use self::r#transfer_event::*;',
    ]);

    codeContains(getFromRenderMap(renderMap, 'mod.rs').content, 'pub mod events;');
});

test('it renders an event with an empty struct', () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([]),
                name: 'emptyEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    codeContains(getFromRenderMap(renderMap, 'events/empty_event.rs').content, ['pub struct EmptyEvent']);
    codeDoesNotContains(getFromRenderMap(renderMap, 'events/empty_event.rs').content, ['from_bytes', 'DISCRIMINATOR']);
});

test('it renders event docs', () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u32') })]),
                docs: ['Some documentation.', 'Second line.'],
                name: 'documentedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    codeContains(getFromRenderMap(renderMap, 'events/documented_event.rs').content, [
        '/// Some documentation.',
        '/// Second line.',
        'pub struct DocumentedEvent',
    ]);
});

test('it renders an event with a nested struct field', () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') }),
                    structFieldTypeNode({
                        name: 'metadata',
                        type: structTypeNode([
                            structFieldTypeNode({ name: 'label', type: numberTypeNode('u8') }),
                            structFieldTypeNode({ name: 'version', type: numberTypeNode('u16') }),
                        ]),
                    }),
                ]),
                name: 'complexEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    codeContains(getFromRenderMap(renderMap, 'events/complex_event.rs').content, [
        'pub struct ComplexEvent',
        'pub amount: u64,',
        'pub metadata: ComplexEventMetadata,',
        'pub struct ComplexEventMetadata',
        'pub label: u8,',
        'pub version: u16,',
    ]);
});

test('it renders field discriminator constants and skips from_bytes without hidden prefix', () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: numberValueNode(7),
                        name: 'eventType',
                        type: numberTypeNode('u8'),
                    }),
                    structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') }),
                ]),
                discriminators: [
                    fieldDiscriminatorNode('eventType'),
                    constantDiscriminatorNode(
                        constantValueNode(
                            fixedSizeTypeNode(bytesTypeNode(), 8),
                            bytesValueNode('base16', 'aabbccdd11223344'),
                        ),
                    ),
                ],
                name: 'mixedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/mixed_event.rs').content;

    codeContains(code, ['MIXED_EVENT_EVENT_TYPE: u8 = 7']);
    codeContains(code, ['MIXED_EVENT_DISCRIMINATOR']);
    codeDoesNotContains(code, ['from_bytes']);
});

test('it validates all constant discriminators in from_bytes for multi-disc events', () => {
    const disc1 = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    const disc2 = constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 4), bytesValueNode('base16', 'eeff0011'));
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [disc1],
                ),
                discriminators: [constantDiscriminatorNode(disc1, 0), constantDiscriminatorNode(disc2, 12)],
                name: 'multiDiscEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/multi_disc_event.rs').content;

    codeContains(code, [
        'pub fn from_bytes',
        'MULTI_DISC_EVENT_DISCRIMINATOR.len()) != Some(&MULTI_DISC_EVENT_DISCRIMINATOR[..])',
        'data.get(12..16) != Some(&MULTI_DISC_EVENT_DISCRIMINATOR2[..])',
        'Self::deserialize(&mut data)',
    ]);
});

test('it uses a literal range in from_bytes for u8-array constant discriminators at non-zero offset', () => {
    const prefix = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    // u8-array constant: no fixedSizeTypeNode, but the fixed count gives a static size of 3.
    const arrayDisc = constantValueNode(
        arrayTypeNode(numberTypeNode('u8'), fixedCountNode(3)),
        arrayValueNode([numberValueNode(1), numberValueNode(2), numberValueNode(3)]),
    );
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [prefix],
                ),
                discriminators: [constantDiscriminatorNode(prefix, 0), constantDiscriminatorNode(arrayDisc, 8)],
                name: 'tailEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/tail_event.rs').content;

    codeContains(code, [
        'pub const TAIL_EVENT_DISCRIMINATOR2: [u8; 3] = [1, 2, 3];',
        'if data.get(8..11) != Some(&TAIL_EVENT_DISCRIMINATOR2[..])',
        'let mut data = &data[8..];',
    ]);
});

test('it falls back to starts_with in from_bytes when a non-zero-offset discriminator size is unknown', () => {
    const prefix = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    // Link-typed constant: byte size not resolvable at the discriminator site.
    const linkDisc = constantValueNode(
        definedTypeLinkNode('discAlias'),
        arrayValueNode([numberValueNode(1), numberValueNode(2), numberValueNode(3)]),
    );
    const node = programNode({
        definedTypes: [definedTypeNode({ name: 'discAlias', type: fixedSizeTypeNode(bytesTypeNode(), 3) })],
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [prefix],
                ),
                discriminators: [constantDiscriminatorNode(prefix, 0), constantDiscriminatorNode(linkDisc, 8)],
                name: 'tailEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/tail_event.rs').content;

    codeContains(code, [
        'pub const TAIL_EVENT_DISCRIMINATOR2: DiscAlias = [1, 2, 3];',
        'if !data.get(8..).is_some_and(|tail| tail.starts_with(&TAIL_EVENT_DISCRIMINATOR2[..]))',
        'let mut data = &data[8..];',
    ]);
});

test('it compares number constant discriminators via to_le_bytes in from_bytes', () => {
    // Number constants render as scalar Rust constants (`pub const X: u32`),
    // so from_bytes must compare their byte encoding, not slice the constant.
    const numDisc = constantValueNode(numberTypeNode('u32'), numberValueNode(42));
    const node = programNode({
        events: [
            // Number discriminator at offset 0.
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 4), bytesValueNode('base16', '2a000000'))],
                ),
                discriminators: [constantDiscriminatorNode(numDisc, 0)],
                name: 'numHeadEvent',
            }),
            // Number discriminator at non-zero offset.
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [
                        constantValueNode(
                            fixedSizeTypeNode(bytesTypeNode(), 8),
                            bytesValueNode('base16', 'aabbccdd11223344'),
                        ),
                    ],
                ),
                discriminators: [
                    constantDiscriminatorNode(
                        constantValueNode(
                            fixedSizeTypeNode(bytesTypeNode(), 8),
                            bytesValueNode('base16', 'aabbccdd11223344'),
                        ),
                        0,
                    ),
                    constantDiscriminatorNode(numDisc, 8),
                ],
                name: 'numTailEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    const headCode = getFromRenderMap(renderMap, 'events/num_head_event.rs').content;
    codeContains(headCode, [
        'pub const NUM_HEAD_EVENT_DISCRIMINATOR: u32 = 42;',
        'if data.get(..4) != Some(&NUM_HEAD_EVENT_DISCRIMINATOR.to_le_bytes())',
        'let mut data = &data[4..];',
    ]);

    const tailCode = getFromRenderMap(renderMap, 'events/num_tail_event.rs').content;
    codeContains(tailCode, [
        'pub const NUM_TAIL_EVENT_DISCRIMINATOR2: u32 = 42;',
        'if data.get(8..12) != Some(&NUM_TAIL_EVENT_DISCRIMINATOR2.to_le_bytes())',
        'let mut data = &data[8..];',
    ]);
});

test('it uses literal byte count in from_bytes for multi-prefix hidden prefix', () => {
    const prefix1 = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    const prefix2 = constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 4), bytesValueNode('base16', 'eeff0011'));
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [prefix1, prefix2],
                ),
                discriminators: [constantDiscriminatorNode(prefix1, 0)],
                name: 'multiPrefixEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/multi_prefix_event.rs').content;

    codeContains(code, ['let mut data = &data[12..];']);
    codeDoesNotContains(code, ['.len()..']);
});

test('it uses literal byte count in from_bytes when constant disc is not at offset 0', () => {
    const prefix = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [prefix],
                ),
                discriminators: [constantDiscriminatorNode(prefix, 8)],
                name: 'offsetPrefixEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/offset_prefix_event.rs').content;

    codeContains(code, ['let mut data = &data[8..];']);
    codeDoesNotContains(code, ['.len()..']);
});

test('it does not render from_bytes when hidden prefix has a non-fixed-size entry', () => {
    const prefix1 = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    const prefix2 = constantValueNode(numberTypeNode('u32'), numberValueNode(42));
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [prefix1, prefix2],
                ),
                discriminators: [constantDiscriminatorNode(prefix1)],
                name: 'dynamicPrefixEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/dynamic_prefix_event.rs').content;

    codeContains(code, ['pub struct DynamicPrefixEvent', 'DYNAMIC_PREFIX_EVENT_DISCRIMINATOR']);
    codeDoesNotContains(code, ['from_bytes']);
});
// --- Program-level event codegen tests ---

test('it does not render program events file when no events have discriminators', () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                name: 'transferEvent',
            }),
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'delegate', type: numberTypeNode('u64') })]),
                name: 'approveEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const keys = [...renderMap.keys()];
    const programEventsFiles = keys.filter(k => k.includes('my_program_events'));
    expect(programEventsFiles).toHaveLength(0);
});

test('it renders identify and try_parse for events with constant discriminators', () => {
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                    [
                        constantValueNode(
                            fixedSizeTypeNode(bytesTypeNode(), 8),
                            bytesValueNode('base16', 'aabbccdd11223344'),
                        ),
                    ],
                ),
                discriminators: [
                    constantDiscriminatorNode(
                        constantValueNode(
                            fixedSizeTypeNode(bytesTypeNode(), 8),
                            bytesValueNode('base16', 'aabbccdd11223344'),
                        ),
                    ),
                ],
                name: 'tradeEvent',
            }),
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'price', type: numberTypeNode('u64') })]),
                    [
                        constantValueNode(
                            fixedSizeTypeNode(bytesTypeNode(), 8),
                            bytesValueNode('base16', '1122334455667788'),
                        ),
                    ],
                ),
                discriminators: [
                    constantDiscriminatorNode(
                        constantValueNode(
                            fixedSizeTypeNode(bytesTypeNode(), 8),
                            bytesValueNode('base16', '1122334455667788'),
                        ),
                    ),
                ],
                name: 'settleEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(code, [
        'pub fn identify_my_program_event(data: &[u8]) -> Option<MyProgramEventKind>',
        'SETTLE_EVENT_DISCRIMINATOR',
        'return Some(MyProgramEventKind::SettleEvent)',
        'TRADE_EVENT_DISCRIMINATOR',
        'return Some(MyProgramEventKind::TradeEvent)',
        'pub fn try_parse_my_program_event(data: &[u8]) -> Option<Result<MyProgramEvent, std::io::Error>>',
        'identify_my_program_event(data)?',
        // Skips are numeric literals (8-byte prefix), so match each arm to keep them distinct.
        /MyProgramEventKind::SettleEvent => \{\s*let mut data = &data\[8\.\.\];\s*SettleEvent::deserialize\(&mut data\)/,
        /MyProgramEventKind::TradeEvent => \{\s*let mut data = &data\[8\.\.\];\s*TradeEvent::deserialize\(&mut data\)/,
    ]);
    codeDoesNotContains(code, ['from_bytes', 'Err(std::io::Error::new']);
});

test('it uses BorshDeserialize for events without from_bytes in try_parse', () => {
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                    [
                        constantValueNode(
                            fixedSizeTypeNode(bytesTypeNode(), 8),
                            bytesValueNode('base16', 'aabbccdd11223344'),
                        ),
                    ],
                ),
                discriminators: [
                    constantDiscriminatorNode(
                        constantValueNode(
                            fixedSizeTypeNode(bytesTypeNode(), 8),
                            bytesValueNode('base16', 'aabbccdd11223344'),
                        ),
                    ),
                ],
                name: 'tradeEvent',
            }),
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u32') })]),
                discriminators: [
                    constantDiscriminatorNode(
                        constantValueNode(
                            fixedSizeTypeNode(bytesTypeNode(), 8),
                            bytesValueNode('base16', '5566778899aabbcc'),
                        ),
                    ),
                ],
                name: 'simpleEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(code, [
        /MyProgramEventKind::TradeEvent => \{\s*let mut data = &data\[8\.\.\];\s*TradeEvent::deserialize\(&mut data\)/,
    ]);
    codeContains(code, ['SimpleEvent::deserialize(&mut data)']);
    codeDoesNotContains(code, ['from_bytes']);
});

test('it excludes non-fixed-size prefix events from program-level try_parse', () => {
    const fixedPrefix = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    const nonFixedPrefix = constantValueNode(numberTypeNode('u32'), numberValueNode(42));
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [fixedPrefix],
                ),
                discriminators: [constantDiscriminatorNode(fixedPrefix)],
                name: 'goodEvent',
            }),
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [fixedPrefix, nonFixedPrefix],
                ),
                discriminators: [constantDiscriminatorNode(fixedPrefix)],
                name: 'dynamicEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(code, ['GoodEvent', 'GoodEvent::deserialize']);
    codeDoesNotContains(code, ['DynamicEvent']);
});

test('it does not render program events file when program has no events', () => {
    const node = programNode({
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const keys = [...renderMap.keys()];
    const programEventsFiles = keys.filter(k => k.includes('_events.rs'));
    expect(programEventsFiles).toHaveLength(0);
});

test('it includes program events module in events mod.rs', () => {
    const node = rootNode(
        programNode({
            events: [
                eventNode({
                    data: hiddenPrefixTypeNode(
                        structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                        [
                            constantValueNode(
                                fixedSizeTypeNode(bytesTypeNode(), 8),
                                bytesValueNode('base16', 'aabbccdd11223344'),
                            ),
                        ],
                    ),
                    discriminators: [
                        constantDiscriminatorNode(
                            constantValueNode(
                                fixedSizeTypeNode(bytesTypeNode(), 8),
                                bytesValueNode('base16', 'aabbccdd11223344'),
                            ),
                        ),
                    ],
                    name: 'transferEvent',
                }),
            ],
            name: 'myProgram',
            publicKey: '11111111111111111111111111111111',
        }),
    );

    const renderMap = visit(node, getRenderMapVisitor());
    expect(renderMap.has('events/my_program_events.rs')).toBe(true);
    codeContains(getFromRenderMap(renderMap, 'events/mod.rs').content, [
        'pub(crate) mod r#my_program_events;',
        'pub use self::r#my_program_events::*;',
    ]);
});

test('it excludes program events module from events mod.rs when no events have discriminators', () => {
    const node = rootNode(
        programNode({
            events: [
                eventNode({
                    data: structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                    name: 'transferEvent',
                }),
            ],
            name: 'myProgram',
            publicKey: '11111111111111111111111111111111',
        }),
    );

    const renderMap = visit(node, getRenderMapVisitor());
    codeDoesNotContains(getFromRenderMap(renderMap, 'events/mod.rs').content, ['my_program_events']);
});

test('it renders identify and try_parse for events with field discriminators', () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: numberValueNode(7),
                        name: 'eventType',
                        type: numberTypeNode('u8'),
                    }),
                    structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') }),
                ]),
                discriminators: [fieldDiscriminatorNode('eventType')],
                name: 'typedEvent',
            }),
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: numberValueNode(1.0),
                        name: 'version',
                        type: numberTypeNode('f32'),
                    }),
                    structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') }),
                ]),
                discriminators: [fieldDiscriminatorNode('version')],
                name: 'floatDiscEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(code, [
        'pub fn identify_my_program_event',
        'data.get(..1) == Some(&TYPED_EVENT_EVENT_TYPE.to_le_bytes())',
        'return Some(MyProgramEventKind::TypedEvent)',
        'data.get(..4) == Some(&FLOAT_DISC_EVENT_VERSION.to_le_bytes())',
        'return Some(MyProgramEventKind::FloatDiscEvent)',
        'pub fn try_parse_my_program_event',
    ]);
});

test('it renders identify and try_parse for events with size discriminators', () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                discriminators: [sizeDiscriminatorNode(8)],
                name: 'fixedSizeEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(code, [
        'pub fn identify_my_program_event',
        'data.len() == 8',
        'return Some(MyProgramEventKind::FixedSizeEvent)',
        'pub fn try_parse_my_program_event',
    ]);
});

test('it AND-s multiple discriminators for the same event in identify', () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: numberValueNode(3),
                        name: 'eventType',
                        type: numberTypeNode('u8'),
                    }),
                    structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') }),
                ]),
                discriminators: [sizeDiscriminatorNode(9), fieldDiscriminatorNode('eventType')],
                name: 'mixedDiscEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(code, [
        'data.len() == 9 && data.get(..1) == Some(&MIXED_DISC_EVENT_EVENT_TYPE.to_le_bytes())',
        'return Some(MyProgramEventKind::MixedDiscEvent)',
    ]);
});

test('it renders identify for events with byte-array field discriminators', () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: arrayValueNode([numberValueNode(1), numberValueNode(2), numberValueNode(3)]),
                        name: 'disc',
                        type: arrayTypeNode(numberTypeNode('u8'), fixedCountNode(3)),
                    }),
                    structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') }),
                ]),
                discriminators: [fieldDiscriminatorNode('disc')],
                name: 'arrayDiscEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(code, [
        'pub fn identify_my_program_event',
        'data.get(..ARRAY_DISC_EVENT_DISC.len()) == Some(&ARRAY_DISC_EVENT_DISC[..])',
        'return Some(MyProgramEventKind::ArrayDiscEvent)',
    ]);
    codeDoesNotContains(code, ['to_le_bytes']);

    const eventCode = getFromRenderMap(renderMap, 'events/array_disc_event.rs').content;
    codeContains(eventCode, ['ARRAY_DISC_EVENT_DISC: [u8; 3] = [1, 2, 3]']);
});

test('it handles non-zero offset in constant discriminator conditions', () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                discriminators: [
                    constantDiscriminatorNode(
                        constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 4), bytesValueNode('base16', 'aabbccdd')),
                        8,
                    ),
                ],
                name: 'offsetEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(code, [
        'pub fn identify_my_program_event',
        'data.get(8..12) == Some(&OFFSET_EVENT_DISCRIMINATOR[..])',
        'return Some(MyProgramEventKind::OffsetEvent)',
        'pub fn try_parse_my_program_event',
        'OffsetEvent::deserialize(&mut data)',
    ]);
});

test('it uses a literal range in identify for u8-array constant discriminators at non-zero offset', () => {
    // u8-array constant: no fixedSizeTypeNode, but the fixed count gives a static size of 3.
    const arrayDisc = constantValueNode(
        arrayTypeNode(numberTypeNode('u8'), fixedCountNode(3)),
        arrayValueNode([numberValueNode(1), numberValueNode(2), numberValueNode(3)]),
    );
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                discriminators: [constantDiscriminatorNode(arrayDisc, 4)],
                name: 'tailDiscEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(code, [
        'data.get(4..7) == Some(&TAIL_DISC_EVENT_DISCRIMINATOR[..])',
        'return Some(MyProgramEventKind::TailDiscEvent)',
    ]);
});

test('it falls back to starts_with in identify when a non-zero-offset discriminator size is unknown', () => {
    // Link-typed constant: byte size not resolvable at the discriminator site.
    const linkDisc = constantValueNode(
        definedTypeLinkNode('discAlias'),
        arrayValueNode([numberValueNode(1), numberValueNode(2), numberValueNode(3)]),
    );
    const node = programNode({
        definedTypes: [definedTypeNode({ name: 'discAlias', type: fixedSizeTypeNode(bytesTypeNode(), 3) })],
        events: [
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                discriminators: [constantDiscriminatorNode(linkDisc, 4)],
                name: 'tailDiscEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(code, [
        'data.get(4..).is_some_and(|tail| tail.starts_with(&TAIL_DISC_EVENT_DISCRIMINATOR[..]))',
        'return Some(MyProgramEventKind::TailDiscEvent)',
    ]);
});

test('it compares number constant discriminators via to_le_bytes in identify', () => {
    // Scalar number constants can't be sliced, so identify compares their byte encoding.
    // Only LE is reachable: the type manifest visitor rejects big-endian numbers for Borsh.
    const numDisc = constantValueNode(numberTypeNode('u32'), numberValueNode(42));
    const shortDisc = constantValueNode(numberTypeNode('u16'), numberValueNode(7));
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                discriminators: [constantDiscriminatorNode(numDisc, 0), constantDiscriminatorNode(shortDisc, 8)],
                name: 'numDiscEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    const eventCode = getFromRenderMap(renderMap, 'events/num_disc_event.rs').content;
    codeContains(eventCode, [
        'pub const NUM_DISC_EVENT_DISCRIMINATOR: u32 = 42;',
        'pub const NUM_DISC_EVENT_DISCRIMINATOR2: u16 = 7;',
    ]);

    const code = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;
    codeContains(code, [
        'data.get(..4) == Some(&NUM_DISC_EVENT_DISCRIMINATOR.to_le_bytes())',
        'data.get(8..10) == Some(&NUM_DISC_EVENT_DISCRIMINATOR2.to_le_bytes())',
        'return Some(MyProgramEventKind::NumDiscEvent)',
    ]);
});

test('it uses a literal range for fixed-size field discriminators at non-zero offset', () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({ name: 'header', type: numberTypeNode('u32') }),
                    structFieldTypeNode({
                        defaultValue: arrayValueNode([numberValueNode(1), numberValueNode(2), numberValueNode(3)]),
                        name: 'disc',
                        type: arrayTypeNode(numberTypeNode('u8'), fixedCountNode(3)),
                    }),
                    structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') }),
                ]),
                discriminators: [fieldDiscriminatorNode('disc', 4)],
                name: 'offsetFieldEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(code, [
        'data.get(4..7) == Some(&OFFSET_FIELD_EVENT_DISC[..])',
        'return Some(MyProgramEventKind::OffsetFieldEvent)',
    ]);
});

test('it falls back to starts_with for field discriminators with unknown size at non-zero offset', () => {
    const node = programNode({
        definedTypes: [definedTypeNode({ name: 'discAlias', type: fixedSizeTypeNode(bytesTypeNode(), 3) })],
        events: [
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({ name: 'header', type: numberTypeNode('u32') }),
                    structFieldTypeNode({
                        defaultValue: arrayValueNode([numberValueNode(1), numberValueNode(2), numberValueNode(3)]),
                        name: 'disc',
                        // Link-typed field: byte size not resolvable at the discriminator site.
                        type: definedTypeLinkNode('discAlias'),
                    }),
                    structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') }),
                ]),
                discriminators: [fieldDiscriminatorNode('disc', 4)],
                name: 'offsetFieldEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(code, [
        'data.get(4..).is_some_and(|tail| tail.starts_with(&OFFSET_FIELD_EVENT_DISC[..]))',
        'return Some(MyProgramEventKind::OffsetFieldEvent)',
    ]);
});

test('it handles multiple constant discriminators and excludes events with unresolvable field discriminators', () => {
    const disc1 = constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 4), bytesValueNode('base16', 'aabbccdd'));
    const disc2 = constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 2), bytesValueNode('base16', 'eeff'));
    const node = programNode({
        events: [
            // Event with two constant discriminators — tests _2 suffix naming and AND-ing.
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                discriminators: [constantDiscriminatorNode(disc1, 0), constantDiscriminatorNode(disc2, 4)],
                name: 'multiDiscEvent',
            }),
            // Event with field discriminator that has no defaultValue — should be excluded.
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({ name: 'eventType', type: numberTypeNode('u8') }),
                    structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') }),
                ]),
                discriminators: [fieldDiscriminatorNode('eventType')],
                name: 'noDefaultEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const code = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(code, [
        'MULTI_DISC_EVENT_DISCRIMINATOR.len()) == Some(&MULTI_DISC_EVENT_DISCRIMINATOR[..])',
        'data.get(4..6) == Some(&MULTI_DISC_EVENT_DISCRIMINATOR2[..])',
        'return Some(MyProgramEventKind::MultiDiscEvent)',
    ]);
    codeContains(code, ['pub enum MyProgramEventKind']);
    codeDoesNotContains(code, ['NoDefaultEvent']);
});

// --- Event framing (CPI-framed) tests ---

const cpiFraming = { kind: 'anchorEventCpi', sharedConstantName: 'eventCpiPrefix' as CamelCaseString };
const framingPrefix = constantValueNode(
    fixedSizeTypeNode(bytesTypeNode(), 8),
    bytesValueNode('base16', 'aabbccdd11223344'),
);
const tradeDisc = constantValueNode(
    fixedSizeTypeNode(bytesTypeNode(), 8),
    bytesValueNode('base16', '1122334455667788'),
);
const settleDisc = constantValueNode(
    fixedSizeTypeNode(bytesTypeNode(), 8),
    bytesValueNode('base16', '99aabbccddeeff00'),
);

function framedEvent(name: string, eventDisc: ReturnType<typeof constantValueNode>) {
    return eventNode({
        data: hiddenPrefixTypeNode(
            structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
            [framingPrefix, eventDisc],
        ),
        discriminators: [constantDiscriminatorNode(framingPrefix, 0), constantDiscriminatorNode(eventDisc, 8)],
        framing: cpiFraming,
        name,
    });
}

test('it hoists the shared framing constant to the program-events file', () => {
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc), framedEvent('settleEvent', settleDisc)],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const programEventsCode = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(programEventsCode, [
        'pub const EVENT_CPI_PREFIX: [u8; 8] = [170, 187, 204, 221, 17, 34, 51, 68];',
        'data.get(..EVENT_CPI_PREFIX.len()) == Some(&EVENT_CPI_PREFIX[..])',
        'return Some(MyProgramEventKind::TradeEvent)',
        'return Some(MyProgramEventKind::SettleEvent)',
    ]);
    expect(programEventsCode.match(/pub const EVENT_CPI_PREFIX/g)).toHaveLength(1);
});

test('it renders per-event _DISCRIMINATOR with IDL bytes, not framing bytes', () => {
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc)],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const tradeEventCode = getFromRenderMap(renderMap, 'events/trade_event.rs').content;

    codeContains(tradeEventCode, ['TRADE_EVENT_DISCRIMINATOR: [u8; 8] = [17, 34, 51, 68, 85, 102, 119, 136]']);
    codeDoesNotContains(tradeEventCode, ['[170, 187, 204, 221, 17, 34, 51, 68]', 'pub const EVENT_CPI_PREFIX']);
});

test('it generates from_bytes that validates both the framing prefix and the event-specific discriminator', () => {
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc)],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const tradeEventCode = getFromRenderMap(renderMap, 'events/trade_event.rs').content;

    codeContains(tradeEventCode, [
        'pub fn from_bytes',
        'data.get(..EVENT_CPI_PREFIX.len()) != Some(&EVENT_CPI_PREFIX[..])',
        'data.get(8..16) != Some(&TRADE_EVENT_DISCRIMINATOR[..])',
        // Both discriminator sizes are known, so the skip folds to a literal
        // with an explanatory comment on the line above.
        /\/\/ EVENT_CPI_PREFIX \(8\) \+ TRADE_EVENT_DISCRIMINATOR \(8\)\n\s*let mut data = &data\[16\.\.\];\n\s*Self::deserialize\(&mut data\)/,
    ]);
});

test('it folds the framed skip to a literal for u8-array discriminators', () => {
    // u8-array discriminator: the fixed count gives a static size of 8, so the skip folds to 16.
    const arrayEventDisc = constantValueNode(
        arrayTypeNode(numberTypeNode('u8'), fixedCountNode(8)),
        arrayValueNode([
            numberValueNode(1),
            numberValueNode(2),
            numberValueNode(3),
            numberValueNode(4),
            numberValueNode(5),
            numberValueNode(6),
            numberValueNode(7),
            numberValueNode(8),
        ]),
    );
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                    [framingPrefix, arrayEventDisc],
                ),
                discriminators: [
                    constantDiscriminatorNode(framingPrefix, 0),
                    constantDiscriminatorNode(arrayEventDisc, 8),
                ],
                framing: cpiFraming,
                name: 'mixedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const eventCode = getFromRenderMap(renderMap, 'events/mixed_event.rs').content;
    const programEventsCode = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(eventCode, [
        'data.get(..EVENT_CPI_PREFIX.len()) != Some(&EVENT_CPI_PREFIX[..])',
        'data.get(8..16) != Some(&MIXED_EVENT_DISCRIMINATOR[..])',
        'let mut data = &data[16..];',
    ]);
    codeContains(programEventsCode, [
        /MyProgramEventKind::MixedEvent => \{\s*\/\/ EVENT_CPI_PREFIX \(8\) \+ MIXED_EVENT_DISCRIMINATOR \(8\)\n\s*let mut data = &data\[16\.\.\];\n\s*MixedEvent::deserialize\(&mut data\)/,
    ]);
});

test('it compares number constant discriminators via to_le_bytes in framed from_bytes', () => {
    const numEventDisc = constantValueNode(numberTypeNode('u32'), numberValueNode(42));
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                    [framingPrefix, numEventDisc],
                ),
                discriminators: [
                    constantDiscriminatorNode(framingPrefix, 0),
                    constantDiscriminatorNode(numEventDisc, 8),
                ],
                framing: cpiFraming,
                name: 'numFramedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const eventCode = getFromRenderMap(renderMap, 'events/num_framed_event.rs').content;
    const programEventsCode = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(eventCode, [
        'pub const NUM_FRAMED_EVENT_DISCRIMINATOR: u32 = 42;',
        'data.get(..EVENT_CPI_PREFIX.len()) != Some(&EVENT_CPI_PREFIX[..])',
        'if data.get(8..12) != Some(&NUM_FRAMED_EVENT_DISCRIMINATOR.to_le_bytes())',
        // Both sizes are known (8 framing + 4 number), so the skip folds to a literal.
        'let mut data = &data[12..];',
    ]);
    codeContains(programEventsCode, [
        'data.get(8..12) == Some(&NUM_FRAMED_EVENT_DISCRIMINATOR.to_le_bytes())',
        /MyProgramEventKind::NumFramedEvent => \{\s*\/\/ EVENT_CPI_PREFIX \(8\) \+ NUM_FRAMED_EVENT_DISCRIMINATOR \(4\)\n\s*let mut data = &data\[12\.\.\];\n\s*NumFramedEvent::deserialize\(&mut data\)/,
    ]);
});

test('it falls back to a chained .len() slice skip when a framed discriminator size is unknown', () => {
    // Link-typed discriminator: the aliased type's byte size is not resolvable
    // at the discriminator site, so the framed skip can't fold to a literal.
    const linkEventDisc = constantValueNode(
        definedTypeLinkNode('discAlias'),
        arrayValueNode([numberValueNode(1), numberValueNode(2), numberValueNode(3)]),
    );
    const node = programNode({
        definedTypes: [definedTypeNode({ name: 'discAlias', type: fixedSizeTypeNode(bytesTypeNode(), 3) })],
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                    [framingPrefix, linkEventDisc],
                ),
                discriminators: [
                    constantDiscriminatorNode(framingPrefix, 0),
                    constantDiscriminatorNode(linkEventDisc, 8),
                ],
                framing: cpiFraming,
                name: 'mixedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const eventCode = getFromRenderMap(renderMap, 'events/mixed_event.rs').content;
    const programEventsCode = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(eventCode, [
        'data.get(..EVENT_CPI_PREFIX.len()) != Some(&EVENT_CPI_PREFIX[..])',
        'if !data.get(8..).is_some_and(|tail| tail.starts_with(&MIXED_EVENT_DISCRIMINATOR[..]))',
        // The framing size (8) is known and folds to a literal; the unknown-size
        // discriminator chains a `[.len()..]` slice so no `+` arithmetic is emitted.
        /\/\/ EVENT_CPI_PREFIX \(8\) \+ MIXED_EVENT_DISCRIMINATOR\n\s*let mut data = &data\[8\.\.\]\[MIXED_EVENT_DISCRIMINATOR\.len\(\)\.\.\];/,
    ]);
    codeContains(programEventsCode, ['let mut data = &data[8..][MIXED_EVENT_DISCRIMINATOR.len()..];']);
});

test('it references the hoisted framing constant in identify and try_parse', () => {
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc), framedEvent('settleEvent', settleDisc)],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const programEventsCode = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(programEventsCode, [
        'pub fn identify_my_program_event',
        'data.get(..EVENT_CPI_PREFIX.len()) == Some(&EVENT_CPI_PREFIX[..])',
        '&& data.get(8..16) == Some(&TRADE_EVENT_DISCRIMINATOR[..])',
        '&& data.get(8..16) == Some(&SETTLE_EVENT_DISCRIMINATOR[..])',
        'pub fn try_parse_my_program_event',
        // Skips are numeric literals (8 framing + 8 event disc), so match each arm to keep them distinct.
        /MyProgramEventKind::TradeEvent => \{\s*\/\/ EVENT_CPI_PREFIX \(8\) \+ TRADE_EVENT_DISCRIMINATOR \(8\)\n\s*let mut data = &data\[16\.\.\];\n\s*TradeEvent::deserialize\(&mut data\)/,
        /MyProgramEventKind::SettleEvent => \{\s*\/\/ EVENT_CPI_PREFIX \(8\) \+ SETTLE_EVENT_DISCRIMINATOR \(8\)\n\s*let mut data = &data\[16\.\.\];\n\s*SettleEvent::deserialize\(&mut data\)/,
    ]);
});

test('it does not hoist a shared constant when no event has framing', () => {
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                    [framingPrefix],
                ),
                discriminators: [constantDiscriminatorNode(framingPrefix, 0)],
                name: 'plainEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const programEventsCode = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;
    const plainEventCode = getFromRenderMap(renderMap, 'events/plain_event.rs').content;

    codeDoesNotContains(programEventsCode, ['EVENT_CPI_PREFIX']);
    codeDoesNotContains(plainEventCode, ['EVENT_CPI_PREFIX']);
    codeContains(plainEventCode, ['PLAIN_EVENT_DISCRIMINATOR: [u8; 8] = [170, 187, 204, 221, 17, 34, 51, 68]']);
});

test('it renders framed and non-framed events side-by-side without cross-contamination', () => {
    const node = programNode({
        events: [
            framedEvent('tradeEvent', tradeDisc),
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u32') })]),
                discriminators: [constantDiscriminatorNode(settleDisc, 0)],
                name: 'plainEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '11111111111111111111111111111111',
    });

    const renderMap = visit(node, getRenderMapVisitor());
    const tradeEventCode = getFromRenderMap(renderMap, 'events/trade_event.rs').content;
    const plainEventCode = getFromRenderMap(renderMap, 'events/plain_event.rs').content;
    const programEventsCode = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

    codeContains(tradeEventCode, [
        'use crate::generated::events::EVENT_CPI_PREFIX;',
        'data.get(..EVENT_CPI_PREFIX.len()) != Some(&EVENT_CPI_PREFIX[..])',
    ]);
    codeDoesNotContains(plainEventCode, ['EVENT_CPI_PREFIX']);
    codeContains(programEventsCode, [
        'pub const EVENT_CPI_PREFIX: [u8; 8] = [170, 187, 204, 221, 17, 34, 51, 68];',
        'return Some(MyProgramEventKind::TradeEvent)',
        'return Some(MyProgramEventKind::PlainEvent)',
    ]);
});

test('it warns and hoists only the first framing when events have conflicting sharedConstantName', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        const altFraming = { kind: 'anchorEventCpi', sharedConstantName: 'altPrefix' as CamelCaseString };
        const altPrefix = constantValueNode(
            fixedSizeTypeNode(bytesTypeNode(), 8),
            bytesValueNode('base16', 'deadbeefcafebabe'),
        );
        const altEvent = eventNode({
            data: hiddenPrefixTypeNode(
                structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                [altPrefix, settleDisc],
            ),
            discriminators: [constantDiscriminatorNode(altPrefix, 0), constantDiscriminatorNode(settleDisc, 8)],
            framing: altFraming,
            name: 'settleEvent',
        });

        const node = programNode({
            events: [framedEvent('tradeEvent', tradeDisc), altEvent],
            name: 'myProgram',
            publicKey: '11111111111111111111111111111111',
        });

        const renderMap = visit(node, getRenderMapVisitor());
        const programEventsCode = getFromRenderMap(renderMap, 'events/my_program_events.rs').content;

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toMatch(/conflicting event framings.*'eventCpiPrefix' vs 'altPrefix'/);

        codeContains(programEventsCode, ['pub const EVENT_CPI_PREFIX']);
        codeDoesNotContains(programEventsCode, ['pub const ALT_PREFIX']);
    } finally {
        warnSpy.mockRestore();
    }
});
