import { logError, logWarn } from '@codama/errors';
import { deleteDirectory, joinPath, writeRenderMap } from '@codama/renderers-core';
import { rootNodeVisitor, visit } from '@codama/visitors-core';
import { spawnSync } from 'child_process';

import { GetRenderMapOptions, getRenderMapVisitor } from './getRenderMapVisitor';
import { syncCargoToml } from './utils';
import { assertNoStdCompatible } from './utils/noStd';

export type RenderOptions = GetRenderMapOptions & {
    deleteFolderBeforeRendering?: boolean;
    formatCode?: boolean;
    generatedFolder?: string;
    syncCargoToml?: boolean;
    toolchain?: string;
};

export function renderVisitor(crateFolder: string, options: RenderOptions = {}) {
    return rootNodeVisitor(root => {
        const generatedFolder = joinPath(crateFolder, options.generatedFolder ?? 'src/generated');

        // Delete existing generated folder.
        if (options.deleteFolderBeforeRendering ?? true) {
            deleteDirectory(generatedFolder);
        }

        // Render the new files.
        const renderMap = visit(root, getRenderMapVisitor(options));
        assertNoStdCompatible(renderMap);
        writeRenderMap(renderMap, generatedFolder);

        // Sync Cargo.toml dependencies and versions, if requested.
        syncCargoToml(renderMap, crateFolder, options);

        // format the code
        if (options.formatCode) {
            const removeFalsy = <T>(arg: T | false | null | undefined): arg is T => Boolean(arg);
            runFormatter(
                'cargo',
                [options.toolchain, 'fmt', '--manifest-path', `${crateFolder}/Cargo.toml`].filter(removeFalsy),
            );
        }
    });
}

function runFormatter(cmd: string, args: string[]) {
    const { stdout, stderr, error } = spawnSync(cmd, args);
    if (error?.message?.includes('ENOENT')) {
        logWarn(`Could not find ${cmd}, skipping formatting.`);
        return;
    }
    if (stdout.length > 0) {
        logWarn(`(cargo-fmt) ${stdout ? stdout?.toString() : error}`);
    }
    if (stderr.length > 0) {
        logError(`(cargo-fmt) ${stderr ? stderr.toString() : error}`);
    }
}
