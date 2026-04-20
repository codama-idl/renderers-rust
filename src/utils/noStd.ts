import type { RenderMap } from '@codama/renderers-core';

import type { Fragment } from './fragment';

const STD_REFERENCE_PATTERN = /\bstd::/;

export function assertNoStdCompatible(renderMap: RenderMap<Fragment>): void {
    const offenders = [...renderMap.entries()].flatMap(([filePath, fragment]) => {
        return fragment.content
            .split('\n')
            .map((line, index) => ({ filePath, line, lineNumber: index + 1 }))
            .filter(({ line }) => STD_REFERENCE_PATTERN.test(line));
    });

    if (offenders.length === 0) {
        return;
    }

    const details = offenders
        .map(({ filePath, line, lineNumber }) => `- ${filePath}:${lineNumber}: ${line.trim()}`)
        .join('\n');
    throw new Error(`[Rust] Generated output is not no_std-compatible.\n${details}`);
}
