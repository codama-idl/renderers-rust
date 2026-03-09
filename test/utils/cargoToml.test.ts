import { CODAMA_ERROR__RENDERERS__MISSING_DEPENDENCY_VERSIONS, CodamaError } from '@codama/errors';
import { createRenderMap } from '@codama/renderers-core';
import { describe, expect, test } from 'vitest';

import { ImportMap } from '../../src';
import {
    createNewCargoToml,
    DEFAULT_DEPENDENCY_VERSIONS,
    Fragment,
    getUsedDependencyVersions,
    shouldUpdateRange,
    updateExistingCargoToml,
} from '../../src/utils';

function fragment(content: string): Fragment {
    return {
        content: content,
        imports: new ImportMap(),
    };
}

function use(dependency: string): Fragment {
    const segments = dependency.split('::');
    return {
        content: segments[segments.length - 1],
        imports: new ImportMap().add(dependency),
    };
}

describe('getUsedDependencyVersions', () => {
    test('it returns the parsed dependencies of all used imports', () => {
        const renderMap = createRenderMap({
            'mint.rs': use('foo_crate::Foo'),
            'token.rs': use('bar_crate::Bar'),
        });
        const dependencyVersions = {
            'bar-crate': '^1.0.0',
            'foo-crate': '^2.0.0',
            'unused-crate': '^3.0.0',
        };

        expect(getUsedDependencyVersions(renderMap, {}, dependencyVersions)).toEqual({
            'bar-crate': '^1.0.0',
            'foo-crate': '^2.0.0',
        });
    });

    test('it also supports crate names with underscores', () => {
        const renderMap = createRenderMap({ 'mint.rs': use('foo_crate::Foo') });
        const dependencyVersions = { foo_crate: '^2.0.0' };

        expect(getUsedDependencyVersions(renderMap, {}, dependencyVersions)).toEqual({
            foo_crate: '^2.0.0',
        });
    });

    test('it automatically includes solana SDK dependencies', () => {
        const renderMap = createRenderMap({
            'mint.rs': use('solana_address::Address'),
            'token.rs': use('solana_instruction::AccountMeta'),
        });

        expect(getUsedDependencyVersions(renderMap, {}, {})).toEqual({
            'solana-address': DEFAULT_DEPENDENCY_VERSIONS['solana-address'],
            'solana-instruction': DEFAULT_DEPENDENCY_VERSIONS['solana-instruction'],
        });
    });

    test('it throws if used dependency versions are not provided', () => {
        const renderMap = createRenderMap({ 'mint.rs': use('foo_crate::Foo') });

        expect(() => getUsedDependencyVersions(renderMap, {}, {})).toThrow(
            new CodamaError(CODAMA_ERROR__RENDERERS__MISSING_DEPENDENCY_VERSIONS, {
                dependencies: ['foo_crate'],
                message: 'Please add these dependencies to the `dependencyVersions` option.',
            }),
        );
    });

    test('it identifies used dependencies from the content itself', () => {
        const renderMap = createRenderMap({
            'mint.rs': fragment('pub Struct Mint(solana_address::Address);'),
            'token.rs': fragment('pub Struct Token(solana_instruction::AccountMeta);'),
        });

        expect(getUsedDependencyVersions(renderMap, {}, {})).toEqual({
            'solana-address': DEFAULT_DEPENDENCY_VERSIONS['solana-address'],
            'solana-instruction': DEFAULT_DEPENDENCY_VERSIONS['solana-instruction'],
        });
    });
});

describe('createNewCargoToml', () => {
    test('it returns a new Cargo.toml object with the given dependencies', () => {
        const cargoToml = createNewCargoToml({
            'bar-crate': '^1.0.0',
            'foo-crate': '^2.0.0',
        });
        expect(cargoToml.dependencies).toEqual({
            'bar-crate': '^1.0.0',
            'foo-crate': '^2.0.0',
        });
    });
    test('it adds features to the new Cargo.toml object', () => {
        const cargoToml = createNewCargoToml({});
        expect(cargoToml.features).toEqual({
            anchor: ['dep:anchor-lang'],
            'anchor-idl-build': ['anchor', 'anchor-lang?/idl-build'],
            fetch: ['dep:solana-client', 'dep:solana-sdk'],
            serde: ['dep:serde', 'dep:serde_with'],
        });
    });
});

describe('updateExistingCargoToml', () => {
    test('it updates a Cargo.toml with the given dependencies in all standard dependency groups', () => {
        const cargoToml = updateExistingCargoToml(
            {
                'build-dependencies': {
                    'crate-a': '^1.0.0',
                    'crate-d': '^1.0.0',
                },
                dependencies: {
                    'crate-b': '^1.0.0',
                    'crate-d': '^1.0.0',
                },
                'dev-dependencies': {
                    'crate-c': '^1.0.0',
                    'crate-d': '^1.0.0',
                },
            },
            {
                'crate-a': '^2.0.0',
                'crate-b': '^2.0.0',
                'crate-c': '^2.0.0',
                'crate-d': '^2.0.0',
            },
        );
        expect(cargoToml).toEqual({
            'build-dependencies': {
                'crate-a': '^2.0.0',
                'crate-d': '^2.0.0',
            },
            dependencies: {
                'crate-b': '^2.0.0',
                'crate-d': '^2.0.0',
            },
            'dev-dependencies': {
                'crate-c': '^2.0.0',
                'crate-d': '^2.0.0',
            },
        });
    });

    test('it updates a Cargo.toml with the given dependencies in any target-specific dependency groups', () => {
        const cargoToml = updateExistingCargoToml(
            {
                target: {
                    'cfg(unix)': {
                        'build-dependencies': { 'my-crate': '^1.0.0' },
                        dependencies: { 'my-crate': '^1.0.0' },
                        'dev-dependencies': { 'my-crate': '^1.0.0' },
                    },
                    'cfg(windows)': {
                        'build-dependencies': { 'my-crate': '^1.0.0' },
                        dependencies: { 'my-crate': '^1.0.0' },
                        'dev-dependencies': { 'my-crate': '^1.0.0' },
                    },
                },
            },
            { 'my-crate': '^2.0.0' },
        );
        expect(cargoToml).toEqual({
            target: {
                'cfg(unix)': {
                    'build-dependencies': { 'my-crate': '^2.0.0' },
                    dependencies: { 'my-crate': '^2.0.0' },
                    'dev-dependencies': { 'my-crate': '^2.0.0' },
                },
                'cfg(windows)': {
                    'build-dependencies': { 'my-crate': '^2.0.0' },
                    dependencies: { 'my-crate': '^2.0.0' },
                    'dev-dependencies': { 'my-crate': '^2.0.0' },
                },
            },
        });
    });

    test('it updates a Cargo.toml with the given dependencies in a workspace dependency group', () => {
        const cargoToml = updateExistingCargoToml(
            { workspace: { dependencies: { 'my-crate': '^1.0.0' } } },
            { 'my-crate': '^2.0.0' },
        );
        expect(cargoToml).toEqual({
            workspace: { dependencies: { 'my-crate': '^2.0.0' } },
        });
    });

    test('it does not update non-dependency attributes', () => {
        const cargoToml = updateExistingCargoToml(
            {
                dependencies: { 'my-crate': '^1.0.0' },
                name: 'my-crate',
                version: '1.2.3',
            },
            { 'my-crate': '^2.0.0' },
        );
        expect(cargoToml).toEqual({
            dependencies: { 'my-crate': '^2.0.0' },
            name: 'my-crate',
            version: '1.2.3',
        });
    });

    test('it adds new dependencies to the main dependencies group by default', () => {
        const cargoToml = updateExistingCargoToml({}, { 'new-crate': '^1.0.0' });
        expect(cargoToml).toEqual({ dependencies: { 'new-crate': '^1.0.0' } });
    });

    test('it does not update nor add dependencies whose range is newer or stricter', () => {
        const cargoToml = updateExistingCargoToml(
            {
                'build-dependencies': { 'crate-a': '^2.0.0' },
                dependencies: { 'crate-b': '^2.5.0' },
                'dev-dependencies': { 'crate-c': '^2.0.0' },
            },
            {
                'crate-a': '^1.0.0',
                'crate-b': '^2.0.0',
                'crate-c': '>=1 <5',
            },
        );
        expect(cargoToml).toEqual({
            'build-dependencies': { 'crate-a': '^2.0.0' },
            dependencies: { 'crate-b': '^2.5.0' },
            'dev-dependencies': { 'crate-c': '^2.0.0' },
        });
    });
});

describe('shouldUpdateRange', () => {
    test('it returns true if the required version is stricter', () => {
        expect(shouldUpdateRange('module', '^1.0.0', '^1.1.0')).toBe(true);
        expect(shouldUpdateRange('module', '^0.1', '^0.1.5')).toBe(true);
        expect(shouldUpdateRange('module', '>=1 <5', '^3.0')).toBe(true);
        expect(shouldUpdateRange('module', '>=1 <5', '>=2 <4')).toBe(true);
    });

    test('it returns true if the required version is newer', () => {
        expect(shouldUpdateRange('module', '^1.0', '^2.0')).toBe(true);
        expect(shouldUpdateRange('module', '^1.0.0', '^2.0.0')).toBe(true);
        expect(shouldUpdateRange('module', '^0.1', '^42.99.99')).toBe(true);
        expect(shouldUpdateRange('module', '>=1 <5', '>=2 <6')).toBe(true);
    });

    test('it returns false if the required version is looser', () => {
        expect(shouldUpdateRange('module', '^1.1.0', '^1.0.0')).toBe(false);
        expect(shouldUpdateRange('module', '^0.1.5', '^0.1')).toBe(false);
        expect(shouldUpdateRange('module', '^3.0', '>=1 <5')).toBe(false);
        expect(shouldUpdateRange('module', '>=2 <4', '>=1 <5')).toBe(false);
    });

    test('it returns false if the required version is older', () => {
        expect(shouldUpdateRange('module', '^2.0', '^1.0')).toBe(false);
        expect(shouldUpdateRange('module', '^2.0.0', '^1.0.0')).toBe(false);
        expect(shouldUpdateRange('module', '^42.99.99', '^0.1')).toBe(false);
        expect(shouldUpdateRange('module', '>=2 <6', '>=1 <5')).toBe(false);
    });

    test('it returns false if either range cannot be parsed', () => {
        expect(shouldUpdateRange('module', 'invalid', '^1.0.0')).toBe(false);
        expect(shouldUpdateRange('module', '^1.0.0', 'invalid')).toBe(false);
    });

    test('it handles bare versions like caret versions', () => {
        expect(shouldUpdateRange('module', '1.0.0', '1.1.0')).toBe(true);
        expect(shouldUpdateRange('module', '1.1.0', '1.0.0')).toBe(false);
    });

    test('it handles equal versions like locked versions', () => {
        expect(shouldUpdateRange('module', '=1.0.0', '=1.1.0')).toBe(true);
        expect(shouldUpdateRange('module', '=1.1.0', '=1.0.0')).toBe(false);
    });
});
