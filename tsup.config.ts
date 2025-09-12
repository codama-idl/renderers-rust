import { env } from 'node:process';

import { defineConfig, Format, Options as TsupConfig } from 'tsup';

type Platform = 'browser' | 'node' | 'react-native';

type BuildOptions = {
    format: Format;
    platform: Platform;
};

export default defineConfig([
    getBuildConfig({ format: 'cjs', platform: 'node' }),
    getBuildConfig({ format: 'esm', platform: 'node' }),
    getBuildConfig({ format: 'cjs', platform: 'browser' }),
    getBuildConfig({ format: 'esm', platform: 'browser' }),
    getBuildConfig({ format: 'esm', platform: 'react-native' }),
]);

function getBuildConfig(options: BuildOptions): TsupConfig {
    const { format, platform } = options;
    return {
        define: {
            __BROWSER__: `${platform === 'browser'}`,
            __ESM__: `${format === 'esm'}`,
            __NODEJS__: `${platform === 'node'}`,
            __REACTNATIVE__: `${platform === 'react-native'}`,
            __TEST__: 'false',
            __VERSION__: `"${env.npm_package_version}"`,
        },
        entry: [`./src/index.ts`],
        esbuildOptions(options) {
            options.define = { ...options.define, 'process.env.NODE_ENV': 'process.env.NODE_ENV' };
        },
        format,
        name: platform,
        outExtension({ format }) {
            return { js: `.${platform}.${format === 'cjs' ? 'cjs' : 'mjs'}` };
        },
        platform: platform === 'node' ? 'node' : 'browser',
        publicDir: true,
        pure: ['process'],
        sourcemap: true,
    };
}
