import {
    arrayTypeNode,
    arrayValueNode,
    bytesTypeNode,
    bytesValueNode,
    constantDiscriminatorNode,
    constantValueNode,
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
import { expect, test } from 'vitest';

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
        'data.get(12..12 + MULTI_DISC_EVENT_DISCRIMINATOR2.len()) != Some(&MULTI_DISC_EVENT_DISCRIMINATOR2[..])',
        'Self::deserialize(&mut data)',
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
        'MyProgramEventKind::SettleEvent =>',
        'let mut data = &data[SETTLE_EVENT_DISCRIMINATOR.len()..]',
        'SettleEvent::deserialize(&mut data)',
        'MyProgramEventKind::TradeEvent =>',
        'let mut data = &data[TRADE_EVENT_DISCRIMINATOR.len()..]',
        'TradeEvent::deserialize(&mut data)',
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
        'let mut data = &data[TRADE_EVENT_DISCRIMINATOR.len()..]',
        'TradeEvent::deserialize(&mut data)',
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
        'data.get(8..8 + OFFSET_EVENT_DISCRIMINATOR.len()) == Some(&OFFSET_EVENT_DISCRIMINATOR[..])',
        'return Some(MyProgramEventKind::OffsetEvent)',
        'pub fn try_parse_my_program_event',
        'OffsetEvent::deserialize(&mut data)',
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
        'MULTI_DISC_EVENT_DISCRIMINATOR2.len()) == Some(&MULTI_DISC_EVENT_DISCRIMINATOR2[..])',
        'return Some(MyProgramEventKind::MultiDiscEvent)',
    ]);
    codeContains(code, ['pub enum MyProgramEventKind']);
    codeDoesNotContains(code, ['NoDefaultEvent']);
});
