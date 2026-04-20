import { createRenderMap } from '@codama/renderers-core';
import { describe, expect, test } from 'vitest';

import { ImportMap } from '../../src';
import { assertNoStdCompatible, Fragment } from '../../src/utils';

function fragment(content: string): Fragment {
    return {
        content,
        imports: new ImportMap(),
    };
}

describe('assertNoStdCompatible', () => {
    test('it accepts alloc-only output', () => {
        const renderMap = createRenderMap({
            'lib.rs': fragment('use alloc::vec::Vec;\nextern crate alloc;\n'),
        });

        expect(() => assertNoStdCompatible(renderMap)).not.toThrow();
    });

    test('it rejects generated std references', () => {
        const renderMap = createRenderMap({
            'lib.rs': fragment('use std::vec::Vec;\n'),
        });

        expect(() => assertNoStdCompatible(renderMap)).toThrow('[Rust] Generated output is not no_std-compatible.');
    });
});
