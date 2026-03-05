import { CODAMA_ERROR__RENDERERS__MISSING_DEPENDENCY_VERSIONS, CodamaError, logWarn } from '@codama/errors';
import { fileExists, joinPath, readFile, RenderMap, writeFile } from '@codama/renderers-core';
import { parse, stringify } from '@iarna/toml';
import { lt as ltVersion, minVersion, subset } from 'semver';

import { ImportMap, RUST_CORE_IMPORTS } from '../ImportMap';
import type { RenderOptions } from '../renderVisitor';
import type { Fragment } from './fragment';

type CargoToml = CargoDependencyGroups & {
    description?: string;
    edition?: string | { workspace: true };
    features?: Record<string, string[]>;
    license?: string | { workspace: true };
    name?: string;
    repository?: string | { workspace: true };
    target?: Record<string, CargoDependencyGroups>;
    version?: string;
    workspace?: { dependencies?: CargoDependencies };
};
type CargoDependencyGroups = {
    'build-dependencies'?: CargoDependencies;
    dependencies?: CargoDependencies;
    'dev-dependencies'?: CargoDependencies;
};

export type CargoDependencies = Record<string, CargoDependency>;
type CargoDependency = CargoDependencyObject | string;
type CargoDependencyObject = {
    branch?: string;
    'default-features'?: boolean;
    features?: string[];
    git?: string;
    optional?: boolean;
    package?: string;
    path?: string;
    tag?: string;
    version?: string;
    workspace?: boolean;
};

export const DEFAULT_DEPENDENCY_VERSIONS: CargoDependencies = {
    'anchor-lang': { optional: true, version: '~0.31' },
    borsh: '^1.0',
    kaigan: { features: ['serde'], version: '^0.3' },
    'num-derive': '^0.4',
    'num-traits': '^0.2',
    serde: { features: ['derive'], optional: true, version: '^1.0' },
    'serde-big-array': '^0.5',
    serde_with: { optional: true, version: '^3.0' },
    'solana-account': '~3.0',
    'solana-account-info': '~3.1',
    'solana-address': { features: ['borsh', 'copy', 'curve25519', 'decode', 'serde'], version: '~2.2' },
    'solana-client': { optional: true, version: '^3.0' },
    'solana-cpi': '~3.1',
    'solana-decode-error': '~2.3',
    'solana-instruction': '~3.2',
    'solana-program-error': '~3.0',
    'solana-sdk': { optional: true, version: '^3.0' },
    thiserror: '^1.0',
};

export function syncCargoToml(
    renderMap: RenderMap<Fragment>,
    crateFolder: string,
    options: Pick<RenderOptions, 'dependencyMap' | 'dependencyVersions' | 'syncCargoToml'>,
): void {
    const shouldSyncCargoToml = options.syncCargoToml ?? false;
    const cargoTomlPath = joinPath(crateFolder, 'Cargo.toml');
    const usedDependencies = getUsedDependencyVersions(
        renderMap,
        options.dependencyMap ?? {},
        options.dependencyVersions ?? {},
    );

    // If we should not sync the Cargo.toml, exit early.
    if (!shouldSyncCargoToml) {
        // However, if the Cargo.toml exists, we can still check it and
        // warn the user about out-of-date or missing dependencies.
        if (fileExists(cargoTomlPath)) {
            checkExistingCargoToml(readCargoToml(cargoTomlPath), usedDependencies);
        }
        return;
    }

    if (fileExists(cargoTomlPath)) {
        const cargoToml = updateExistingCargoToml(readCargoToml(cargoTomlPath), usedDependencies);
        writeFile(cargoTomlPath, stringify(cargoToml) + '\n');
    } else {
        const cargoToml = createNewCargoToml(usedDependencies);
        writeFile(cargoTomlPath, stringify(cargoToml) + '\n');
    }
}

export function createNewCargoToml(usedDependencies: CargoDependencies): CargoToml {
    return updateExistingCargoToml(
        {
            name: 'rust-client',
            // eslint-disable-next-line sort-keys-fix/sort-keys-fix
            description: '',
            version: '1.0.0',
            // eslint-disable-next-line sort-keys-fix/sort-keys-fix
            repository: { workspace: true },
            // eslint-disable-next-line sort-keys-fix/sort-keys-fix
            edition: { workspace: true },
            license: { workspace: true },
            // eslint-disable-next-line sort-keys-fix/sort-keys-fix
            features: {
                anchor: ['dep:anchor-lang'],
                'anchor-idl-build': ['anchor', 'anchor-lang?/idl-build'],
                fetch: ['dep:solana-client', 'dep:solana-sdk'],
                serde: ['dep:serde', 'dep:serde_with'],
            },
            // eslint-disable-next-line sort-keys-fix/sort-keys-fix
            dependencies: {},
        },
        usedDependencies,
    );
}

export function updateExistingCargoToml(cargoToml: CargoToml, usedDependencies: CargoDependencies): CargoToml {
    const foundUsedDependencies = new Set<string>();

    const updatedCargoToml = updateCargoDependencies(cargoToml, dependencyGroup => {
        return Object.fromEntries(
            Object.entries(dependencyGroup).map(([dependencyKey, dependency]) => {
                const foundUsedDependency = findCargoDependencyByImportName(
                    usedDependencies,
                    getCargoDependencyImportName(dependencyKey),
                );
                if (!foundUsedDependency) {
                    return [dependencyKey, dependency];
                }

                const [usedDependencyKey, usedDependency] = foundUsedDependency;
                foundUsedDependencies.add(usedDependencyKey);

                const usedDependencyCrateName = getCargoDependencyCrateName(usedDependencyKey, usedDependency);
                if (!shouldUpdateDependency(usedDependencyCrateName, dependency, usedDependency)) {
                    return [dependencyKey, dependency];
                }

                const newVersion = getCargoDependencyVersion(usedDependency) as string;
                return [
                    dependencyKey,
                    typeof dependency === 'string' ? newVersion : { ...dependency, version: newVersion },
                ];
            }),
        );
    });

    const usedDependenciesToAdd = Object.entries(usedDependencies).filter(
        ([usedDependencyKey]) => !foundUsedDependencies.has(usedDependencyKey),
    );
    for (const [usedDependencyKey, usedDependency] of usedDependenciesToAdd) {
        updatedCargoToml.dependencies = updatedCargoToml.dependencies ?? {};
        updatedCargoToml.dependencies[usedDependencyKey] = usedDependency;
    }

    return updatedCargoToml;
}

export function checkExistingCargoToml(cargoToml: CargoToml, usedDependencies: CargoDependencies): void {
    const missingDependencies: string[] = [];
    const dependenciesToUpdate: string[] = [];
    const existingDependencies = {
        ...cargoToml['build-dependencies'],
        ...cargoToml['dev-dependencies'],
        ...cargoToml.dependencies,
        ...cargoToml.workspace?.dependencies,
        ...Object.values(cargoToml.target ?? {}).reduce((acc, target) => {
            return {
                ...acc,
                ...target['build-dependencies'],
                ...target['dev-dependencies'],
                ...target.dependencies,
            };
        }, {} as CargoDependencies),
    };

    for (const [usedDependencyKey, usedDependency] of Object.entries(usedDependencies)) {
        const foundExistingDependency = findCargoDependencyByImportName(
            existingDependencies,
            getCargoDependencyImportName(usedDependencyKey),
        );
        if (!foundExistingDependency) {
            missingDependencies.push(usedDependencyKey);
        } else if (shouldUpdateDependency(foundExistingDependency[0], foundExistingDependency[1], usedDependency)) {
            dependenciesToUpdate.push(usedDependencyKey);
        }
    }

    if (missingDependencies.length === 0 && dependenciesToUpdate.length === 0) return;
    const missingList = missingDependencies
        .map(d => `- ${d} missing: ${getCargoDependencyVersion(usedDependencies[d])}\n`)
        .join('');
    const outdatedList = dependenciesToUpdate
        .map(
            d =>
                `- ${d} outdated: ${getCargoDependencyVersion(existingDependencies[d])} ` +
                `-> ${getCargoDependencyVersion(usedDependencies[d])}\n`,
        )
        .join('');
    logWarn(
        `The following dependencies in your \`Cargo.toml\` are out-of-date or missing:\n` +
            `${missingList}${outdatedList}`,
    );
}

export function getUsedDependencyVersions(
    renderMap: RenderMap<Fragment>,
    dependencyMap: Record<string, string>,
    dependencyVersions: CargoDependencies,
): CargoDependencies {
    const usedImportNames = getUsedImportNames(renderMap, dependencyMap);
    const dependencyVersionsWithDefaults: CargoDependencies = {
        ...DEFAULT_DEPENDENCY_VERSIONS,
        ...dependencyVersions,
    };

    const [usedDependencyVersion, missingDependencies] = [...usedImportNames].reduce(
        ([acc, missingDependencies], usedImportName) => {
            const usedDependency = findCargoDependencyByImportName(dependencyVersionsWithDefaults, usedImportName);
            if (usedDependency) {
                acc[usedDependency[0]] = usedDependency[1];
            } else {
                missingDependencies.add(usedImportName);
            }
            return [acc, missingDependencies];
        },
        [{} as CargoDependencies, new Set<string>()],
    );

    if (missingDependencies.size > 0) {
        throw new CodamaError(CODAMA_ERROR__RENDERERS__MISSING_DEPENDENCY_VERSIONS, {
            dependencies: [...missingDependencies],
            message: 'Please add these dependencies to the `dependencyVersions` option.',
        });
    }

    return usedDependencyVersion;
}

function getUsedImportNames(renderMap: RenderMap<Fragment>, dependencyMap: Record<string, string>): Set<string> {
    const fragments = [...renderMap.values()];
    const fromImportMap = new ImportMap()
        .mergeWith(...fragments.map(({ imports }) => imports))
        .getExternalDependencies(dependencyMap);

    // Match paths with at least 2 segments, optionally starting with "::"
    // and capturing only the crate name (first segment). For instance,
    // "some_crate::some_module::SomeType" or "::some_crate::SomeType".
    const PATH_REGEX = /\b(?:::)?([a-z_][a-z0-9_]*)(?:::[a-zA-Z0-9_]+)+/g;
    const fromContent = fragments.flatMap(({ content }) => {
        return [...content.matchAll(PATH_REGEX)]
            .map(match => match[1])
            .filter(crateName => !RUST_CORE_IMPORTS.has(crateName));
    });

    return new Set([...fromImportMap, ...fromContent]);
}

export function shouldUpdateDependency(
    dependency: string,
    currentDependency: CargoDependency,
    requiredDependency: CargoDependency,
): boolean {
    const currentRange = getCargoDependencyVersion(currentDependency);
    const requiredRange = getCargoDependencyVersion(requiredDependency);
    return !!currentRange && !!requiredRange && shouldUpdateRange(dependency, currentRange, requiredRange);
}

export function shouldUpdateRange(dependency: string, currentRange: string, requiredRange: string): boolean {
    currentRange = cargoToNpmSemver(currentRange);
    requiredRange = cargoToNpmSemver(requiredRange);

    try {
        // Check if currentRange is a subset of requiredRange
        // If yes, required is looser or equal, no update needed
        if (subset(currentRange, requiredRange)) {
            return false;
        }

        // Get the minimum versions from both ranges.
        const minRequiredVersion = minVersion(requiredRange);
        const minCurrentVersion = minVersion(currentRange);
        if (!minCurrentVersion || !minRequiredVersion) {
            throw new Error('Could not determine minimum versions.');
        }

        // Update if the minimum required version is greater than the current minimum version.
        if (ltVersion(minCurrentVersion, minRequiredVersion)) {
            return true;
        }

        // Otherwise, do not update.
        return false;
    } catch (error) {
        console.warn(
            `Could not parse the following ranges for dependency "${dependency}":` +
                ` [${currentRange}] and/or [${requiredRange}].` +
                ` Caused by: ${(error as Error).message}`,
        );
        return false;
    }
}

function updateCargoDependencies(
    cargoToml: CargoToml,
    updateFn: (deps: CargoDependencies) => CargoDependencies,
): CargoToml {
    const updatedCargoToml = JSON.parse(JSON.stringify(cargoToml)) as CargoToml;

    // Standard dependency sections.
    const standardSections = ['dependencies', 'dev-dependencies', 'build-dependencies'] as const;
    for (const section of standardSections) {
        if (updatedCargoToml[section]) {
            updatedCargoToml[section] = updateFn(updatedCargoToml[section]);
        }
    }

    // Target-specific dependencies.
    if (updatedCargoToml.target) {
        for (const targetKey of Object.keys(updatedCargoToml.target)) {
            for (const section of standardSections) {
                if (updatedCargoToml.target[targetKey][section]) {
                    updatedCargoToml.target[targetKey][section] = updateFn(updatedCargoToml.target[targetKey][section]);
                }
            }
        }
    }

    // Workspace dependencies.
    if (updatedCargoToml.workspace?.dependencies) {
        updatedCargoToml.workspace.dependencies = updateFn(updatedCargoToml.workspace.dependencies);
    }

    return updatedCargoToml;
}

function cargoToNpmSemver(cargoVersion: string): string {
    const version = cargoVersion.trim();
    return /^\d+(\.\d+)?(\.\d+)?/.test(version) ? `^${version}` : version;
}

function getCargoDependencyVersion(dependency: CargoDependency): string | undefined {
    return typeof dependency === 'string' ? dependency : dependency.version;
}

function getCargoDependencyCrateName(key: string, dependency: CargoDependency): string {
    return typeof dependency !== 'string' && dependency.package ? dependency.package : key;
}

function getCargoDependencyImportName(key: string): string {
    return key.replace(/-/g, '_');
}

function findCargoDependencyByImportName(
    dependencies: CargoDependencies,
    importName: string,
): [string, CargoDependency] | undefined {
    return Object.entries(dependencies).find(([key]) => {
        return getCargoDependencyImportName(key) === importName;
    });
}

function readCargoToml(path: string): CargoToml {
    return parse(readFile(path)) as CargoToml;
}
