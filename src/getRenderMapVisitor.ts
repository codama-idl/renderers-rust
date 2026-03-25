import { logWarn } from '@codama/errors';
import {
    camelCase,
    getAllAccounts,
    getAllDefinedTypes,
    getAllInstructionsWithSubs,
    getAllPrograms,
    type InstructionAccountNode,
    InstructionNode,
    isNode,
    isNodeFilter,
    pascalCase,
    PdaNode,
    ProgramNode,
    resolveNestedTypeNode,
    snakeCase,
    structTypeNodeFromInstructionArgumentNodes,
    VALUE_NODES,
} from '@codama/nodes';
import { addToRenderMap, createRenderMap, mergeRenderMaps } from '@codama/renderers-core';
import {
    extendVisitor,
    LinkableDictionary,
    NodeStack,
    pipe,
    recordLinkablesOnFirstVisitVisitor,
    recordNodeStackVisitor,
    staticVisitor,
    visit,
} from '@codama/visitors-core';

import { getTypeManifestVisitor } from './getTypeManifestVisitor';
import { ImportMap } from './ImportMap';
import { renderValueNode } from './renderValueNodeVisitor';
import {
    CargoDependencies,
    Fragment,
    getDiscriminatorConstants,
    getImportFromFactory,
    type GetImportFromFunction,
    getTraitsFromNodeFactory,
    LinkOverrides,
    render,
    TraitOptions,
} from './utils';

export type GetRenderMapOptions = {
    anchorTraits?: boolean;
    defaultTraitOverrides?: string[];
    dependencyMap?: Record<string, string>;
    dependencyVersions?: CargoDependencies;
    linkOverrides?: LinkOverrides;
    renderParentInstructions?: boolean;
    traitOptions?: TraitOptions;
};

export function getRenderMapVisitor(options: GetRenderMapOptions = {}) {
    const linkables = new LinkableDictionary();
    const stack = new NodeStack();
    let program: ProgramNode | null = null;

    const renderParentInstructions = options.renderParentInstructions ?? false;
    const dependencyMap = options.dependencyMap ?? {};
    const getImportFrom = getImportFromFactory(options.linkOverrides ?? {});
    const getTraitsFromNode = getTraitsFromNodeFactory(options.traitOptions);
    const typeManifestVisitor = getTypeManifestVisitor({
        getImportFrom,
        getTraitsFromNode,
        traitOptions: options.traitOptions,
    });
    const anchorTraits = options.anchorTraits ?? true;

    return pipe(
        staticVisitor(() => createRenderMap<Fragment>(), {
            keys: ['rootNode', 'programNode', 'instructionNode', 'accountNode', 'definedTypeNode'],
        }),
        v =>
            extendVisitor(v, {
                visitAccount(node) {
                    const typeManifest = visit(node, typeManifestVisitor);

                    // Discriminator constants.
                    const fields = resolveNestedTypeNode(node.data).fields;
                    const discriminatorConstants = getDiscriminatorConstants({
                        discriminatorNodes: node.discriminators ?? [],
                        fields,
                        getImportFrom,
                        prefix: node.name,
                        typeManifestVisitor,
                    });

                    // Seeds.
                    const seedsImports = new ImportMap();
                    const pda = node.pda ? linkables.get([...stack.getPath(), node.pda]) : undefined;
                    const pdaSeeds = pda?.seeds ?? [];
                    const seeds = pdaSeeds.map(seed => {
                        if (isNode(seed, 'variablePdaSeedNode')) {
                            const seedManifest = visit(seed.type, typeManifestVisitor);
                            seedsImports.mergeWith(seedManifest.imports);
                            const resolvedType = resolveNestedTypeNode(seed.type);
                            return { ...seed, resolvedType, typeManifest: seedManifest };
                        }
                        if (isNode(seed.value, 'programIdValueNode')) {
                            return seed;
                        }
                        const seedManifest = visit(seed.type, typeManifestVisitor);
                        const valueManifest = renderValueNode(seed.value, getImportFrom, true);
                        seedsImports.mergeWith(valueManifest.imports);
                        const resolvedType = resolveNestedTypeNode(seed.type);
                        return { ...seed, resolvedType, typeManifest: seedManifest, valueManifest };
                    });
                    const hasVariableSeeds = pdaSeeds.filter(isNodeFilter('variablePdaSeedNode')).length > 0;
                    const constantSeeds = seeds
                        .filter(isNodeFilter('constantPdaSeedNode'))
                        .filter(seed => !isNode(seed.value, 'programIdValueNode'));

                    const imports = typeManifest.imports
                        .mergeWith(...(hasVariableSeeds ? [seedsImports] : []))
                        .mergeWith(discriminatorConstants.imports)
                        .remove(`generatedAccounts::${pascalCase(node.name)}`);

                    return createRenderMap(`accounts/${snakeCase(node.name)}.rs`, {
                        content: render('accountsPage.njk', {
                            account: node,
                            anchorTraits,
                            constantSeeds,
                            discriminatorConstants: discriminatorConstants.render,
                            hasVariableSeeds,
                            imports: imports.toString(dependencyMap),
                            pda,
                            program,
                            seeds,
                            typeManifest,
                        }),
                        imports,
                    });
                },

                visitDefinedType(node) {
                    const typeManifest = visit(node, typeManifestVisitor);
                    const imports = new ImportMap()
                        .mergeWithManifest(typeManifest)
                        .remove(`generatedTypes::${pascalCase(node.name)}`);

                    return createRenderMap(`types/${snakeCase(node.name)}.rs`, {
                        content: render('definedTypesPage.njk', {
                            definedType: node,
                            imports: imports.toString(dependencyMap),
                            typeManifest,
                        }),
                        imports,
                    });
                },

                visitInstruction(node) {
                    // Imports.
                    const imports = new ImportMap();

                    // canMergeAccountsAndArgs
                    const accountsAndArgsConflicts = getConflictsForInstructionAccountsAndArgs(node);
                    if (accountsAndArgsConflicts.length > 0) {
                        logWarn(
                            `[Rust] Accounts and args of instruction [${node.name}] have the following ` +
                                `conflicting attributes [${accountsAndArgsConflicts.join(', ')}]. ` +
                                `Thus, the conflicting arguments will be suffixed with "_arg". ` +
                                'You may want to rename the conflicting attributes.',
                        );
                    }

                    // Discriminator constants.
                    const discriminatorConstants = getDiscriminatorConstants({
                        discriminatorNodes: node.discriminators ?? [],
                        fields: node.arguments,
                        getImportFrom,
                        prefix: node.name,
                        typeManifestVisitor,
                    });

                    // Instruction args.
                    const instructionArgs: {
                        default: boolean;
                        innerOptionType: string | null;
                        name: string;
                        optional: boolean;
                        type: string;
                        value: string | null;
                    }[] = [];
                    let hasArgs = false;
                    let hasOptional = false;

                    node.arguments.forEach(argument => {
                        const argumentVisitor = getTypeManifestVisitor({
                            getImportFrom,
                            getTraitsFromNode,
                            nestedStruct: true,
                            parentName: `${pascalCase(node.name)}InstructionData`,
                        });
                        const manifest = visit(argument.type, argumentVisitor);
                        imports.mergeWith(manifest.imports);
                        const innerOptionType = isNode(argument.type, 'optionTypeNode')
                            ? manifest.type.slice('Option<'.length, -1)
                            : null;

                        const hasDefaultValue = !!argument.defaultValue && isNode(argument.defaultValue, VALUE_NODES);
                        let renderValue: string | null = null;
                        if (hasDefaultValue) {
                            const { imports: argImports, render: value } = renderValueNode(
                                argument.defaultValue,
                                getImportFrom,
                            );
                            imports.mergeWith(argImports);
                            renderValue = value;
                        }

                        hasArgs = hasArgs || argument.defaultValueStrategy !== 'omitted';
                        hasOptional = hasOptional || (hasDefaultValue && argument.defaultValueStrategy !== 'omitted');

                        const name = accountsAndArgsConflicts.includes(argument.name)
                            ? `${argument.name}_arg`
                            : argument.name;

                        instructionArgs.push({
                            default: hasDefaultValue && argument.defaultValueStrategy === 'omitted',
                            innerOptionType,
                            name,
                            optional: hasDefaultValue && argument.defaultValueStrategy !== 'omitted',
                            type: manifest.type,
                            value: renderValue,
                        });
                    });

                    const struct = structTypeNodeFromInstructionArgumentNodes(node.arguments);
                    const structVisitor = getTypeManifestVisitor({
                        getImportFrom,
                        getTraitsFromNode,
                        parentName: `${pascalCase(node.name)}InstructionData`,
                    });
                    const typeManifest = visit(struct, structVisitor);

                    // Resolve PDA defaults and topologically sort accounts by dependency.
                    const resolvedAccounts = resolveInstructionPdaDefaults({
                        accounts: node.accounts,
                        getImportFrom,
                        imports,
                        instructionName: node.name,
                        linkables,
                        program: program!,
                        stack,
                    });

                    const dataTraits = getTraitsFromNode(node);
                    imports
                        .mergeWith(dataTraits.imports)
                        .mergeWith(discriminatorConstants.imports)
                        .remove(`generatedInstructions::${pascalCase(node.name)}`);

                    return createRenderMap(`instructions/${snakeCase(node.name)}.rs`, {
                        content: render('instructionsPage.njk', {
                            dataTraits: dataTraits.render,
                            discriminatorConstants: discriminatorConstants.render,
                            hasArgs,
                            hasOptional,
                            imports: imports.toString(dependencyMap),
                            instruction: node,
                            instructionArgs,
                            program,
                            resolvedAccounts,
                            typeManifest,
                        }),
                        imports,
                    });
                },

                visitProgram(node, { self }) {
                    program = node;
                    let renders = mergeRenderMaps([
                        ...node.accounts.map(account => visit(account, self)),
                        ...node.definedTypes.map(type => visit(type, self)),
                        ...getAllInstructionsWithSubs(node, {
                            leavesOnly: !renderParentInstructions,
                        }).map(ix => visit(ix, self)),
                    ]);

                    // Errors.
                    if (node.errors.length > 0) {
                        renders = addToRenderMap(renders, `errors/${snakeCase(node.name)}.rs`, {
                            content: render('errorsPage.njk', {
                                errors: node.errors,
                                imports: new ImportMap().toString(dependencyMap),
                                program: node,
                            }),
                            imports: new ImportMap(),
                        });
                    }

                    program = null;
                    return renders;
                },

                visitRoot(node, { self }) {
                    const programsToExport = getAllPrograms(node);
                    const accountsToExport = getAllAccounts(node);
                    const instructionsToExport = getAllInstructionsWithSubs(node, {
                        leavesOnly: !renderParentInstructions,
                    });
                    const definedTypesToExport = getAllDefinedTypes(node);
                    const hasAnythingToExport =
                        programsToExport.length > 0 ||
                        accountsToExport.length > 0 ||
                        instructionsToExport.length > 0 ||
                        definedTypesToExport.length > 0;

                    const ctx = {
                        accountsToExport,
                        definedTypesToExport,
                        hasAnythingToExport,
                        instructionsToExport,
                        programsToExport,
                        root: node,
                    };

                    return mergeRenderMaps([
                        createRenderMap({
                            ['accounts/mod.rs']:
                                accountsToExport.length > 0
                                    ? { content: render('accountsMod.njk', ctx), imports: new ImportMap() }
                                    : undefined,
                            ['errors/mod.rs']:
                                programsToExport.length > 0
                                    ? { content: render('errorsMod.njk', ctx), imports: new ImportMap() }
                                    : undefined,
                            ['instructions/mod.rs']:
                                instructionsToExport.length > 0
                                    ? { content: render('instructionsMod.njk', ctx), imports: new ImportMap() }
                                    : undefined,
                            ['mod.rs']: { content: render('rootMod.njk', ctx), imports: new ImportMap() },
                            ['programs.rs']:
                                programsToExport.length > 0
                                    ? { content: render('programsMod.njk', ctx), imports: new ImportMap() }
                                    : undefined,
                            ['shared.rs']:
                                accountsToExport.length > 0
                                    ? { content: render('sharedPage.njk', ctx), imports: new ImportMap() }
                                    : undefined,
                            ['types/mod.rs']:
                                definedTypesToExport.length > 0
                                    ? { content: render('definedTypesMod.njk', ctx), imports: new ImportMap() }
                                    : undefined,
                        }),
                        ...getAllPrograms(node).map(p => visit(p, self)),
                    ]);
                },
            }),
        v => recordNodeStackVisitor(v, stack),
        v => recordLinkablesOnFirstVisitVisitor(v, linkables),
    );
}

type RenderedSeed = {
    kind: 'accountRef' | 'argumentRef' | 'constant' | 'programId' | 'value';
    rawName?: string;
    render: string;
};

type ResolvedPdaInfo = {
    accountDeps: string[];
    isLinked: boolean;
    linkedAccountName?: string;
    linkedImportFrom?: string;
    programAddressExpr: string;
    renderedSeeds: RenderedSeed[];
};

type ResolvedAccount = InstructionAccountNode & { pdaDefault: ResolvedPdaInfo | null };

function resolveInstructionPdaDefaults(ctx: {
    accounts: readonly InstructionAccountNode[];
    getImportFrom: GetImportFromFunction;
    imports: ImportMap;
    instructionName: string;
    linkables: LinkableDictionary;
    program: ProgramNode;
    stack: NodeStack;
}): ResolvedAccount[] {
    const { accounts, getImportFrom, imports, instructionName, linkables, program, stack } = ctx;

    const resolvedPdaAccounts: Record<string, ResolvedPdaInfo> = {};

    for (const account of accounts) {
        if (!account.defaultValue || !isNode(account.defaultValue, 'pdaValueNode')) {
            continue;
        }

        const defaultValue = account.defaultValue;
        let pdaNode: PdaNode | undefined;
        let isLinked = false;
        let linkedAccountName: string | undefined;
        let linkedImportFrom: string | undefined;

        if (isNode(defaultValue.pda, 'pdaLinkNode')) {
            pdaNode = linkables.get([...stack.getPath(), defaultValue.pda]);
            if (pdaNode) {
                isLinked = true;
                linkedAccountName = pdaNode.name;
                linkedImportFrom = getImportFrom(defaultValue.pda);
            }
        } else if (isNode(defaultValue.pda, 'pdaNode')) {
            pdaNode = defaultValue.pda;
        }

        if (!pdaNode) {
            logWarn(
                `[Rust] Could not resolve PDA node for account [${account.name}] ` +
                    `in instruction [${instructionName}]. The account will be treated as required.`,
            );
            continue;
        }

        // Resolve programId: check pdaValueNode override, then pdaNode.programId, then default.
        let programIdOverride: string | undefined;
        if (isNode(defaultValue.programId, 'accountValueNode')) {
            programIdOverride = snakeCase(defaultValue.programId.name);
        } else if (isNode(defaultValue.programId, 'argumentValueNode')) {
            programIdOverride = snakeCase(defaultValue.programId.name);
        } else if (pdaNode.programId) {
            programIdOverride = `solana_address::address!("${pdaNode.programId}")`;
        }

        const programAddressExpr = programIdOverride ?? `crate::${snakeCase(program.name).toUpperCase()}_ID`;

        // Render seeds — bail out entirely if any variable seed value is missing.
        const renderedSeeds: RenderedSeed[] = [];
        const seedAccountDeps: string[] = [];
        let seedsComplete = true;

        if (isNode(defaultValue.programId, 'accountValueNode')) {
            seedAccountDeps.push(camelCase(defaultValue.programId.name));
        }

        for (const seed of pdaNode.seeds) {
            if (isNode(seed, 'constantPdaSeedNode')) {
                if (isNode(seed.value, 'programIdValueNode')) {
                    renderedSeeds.push({
                        kind: 'programId',
                        render: `${programAddressExpr}.as_ref()`,
                    });
                } else {
                    const valueManifest = renderValueNode(seed.value, getImportFrom, true);
                    imports.mergeWith(valueManifest.imports);
                    const rendered = valueManifest.render;
                    const suffix = rendered.startsWith('[') ? '' : '.as_bytes()';
                    const prefix = rendered.startsWith('[') ? '&' : '';
                    renderedSeeds.push({
                        kind: 'constant',
                        render: `${prefix}${rendered}${suffix}`,
                    });
                }
            } else if (isNode(seed, 'variablePdaSeedNode')) {
                const seedValue = defaultValue.seeds.find(s => s.name === seed.name)?.value;

                if (!seedValue) {
                    logWarn(
                        `[Rust] Missing seed value for variable seed [${seed.name}] ` +
                            `in PDA default for account [${account.name}] ` +
                            `of instruction [${instructionName}]. Skipping PDA resolution.`,
                    );
                    seedsComplete = false;
                    break;
                }

                const resolvedType = resolveNestedTypeNode(seed.type);
                if (isNode(seedValue, 'accountValueNode')) {
                    const refName = snakeCase(seedValue.name);
                    seedAccountDeps.push(camelCase(seedValue.name));
                    if (resolvedType.kind === 'publicKeyTypeNode') {
                        renderedSeeds.push({
                            kind: 'accountRef',
                            rawName: refName,
                            render: `${refName}.as_ref()`,
                        });
                    } else if (resolvedType.kind === 'bytesTypeNode') {
                        renderedSeeds.push({
                            kind: 'accountRef',
                            rawName: refName,
                            render: `&${refName}`,
                        });
                    } else {
                        renderedSeeds.push({
                            kind: 'accountRef',
                            rawName: refName,
                            render: `${refName}.to_string().as_ref()`,
                        });
                    }
                } else if (isNode(seedValue, 'argumentValueNode')) {
                    const refName = snakeCase(seedValue.name);
                    if (resolvedType.kind === 'publicKeyTypeNode') {
                        renderedSeeds.push({
                            kind: 'argumentRef',
                            render: `self.${refName}.as_ref().expect("${refName} is not set").as_ref()`,
                        });
                    } else {
                        renderedSeeds.push({
                            kind: 'argumentRef',
                            render: `self.${refName}.as_ref().expect("${refName} is not set").to_string().as_ref()`,
                        });
                    }
                } else {
                    const valueManifest = renderValueNode(seedValue, getImportFrom, true);
                    imports.mergeWith(valueManifest.imports);
                    if (resolvedType.kind === 'publicKeyTypeNode') {
                        renderedSeeds.push({
                            kind: 'value',
                            render: `${valueManifest.render}.as_ref()`,
                        });
                    } else {
                        renderedSeeds.push({
                            kind: 'value',
                            render: `${valueManifest.render}.as_bytes()`,
                        });
                    }
                }
            }
        }

        if (!seedsComplete) continue;

        if (isLinked && linkedImportFrom && linkedAccountName) {
            imports.add(`${linkedImportFrom}::${pascalCase(linkedAccountName)}`);
        }

        resolvedPdaAccounts[camelCase(account.name)] = {
            accountDeps: seedAccountDeps,
            isLinked,
            linkedAccountName,
            linkedImportFrom,
            programAddressExpr,
            renderedSeeds,
        };
    }

    // Build dependency graph and topologically sort accounts.
    const accountDeps = new Map<string, Set<string>>();
    for (const account of accounts) {
        const name = camelCase(account.name);
        accountDeps.set(name, new Set());
        const pdaInfo = resolvedPdaAccounts[name];
        if (pdaInfo) {
            for (const dep of pdaInfo.accountDeps) {
                accountDeps.get(name)!.add(dep);
            }
        }
    }

    const sortedAccountNames: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const topoSort = (name: string): boolean => {
        if (visited.has(name)) return true;
        if (visiting.has(name)) {
            logWarn(
                `[Rust] Circular PDA dependency detected for account [${name}] ` +
                    `in instruction [${instructionName}]. Falling back to required account.`,
            );
            delete resolvedPdaAccounts[name];
            return false;
        }
        visiting.add(name);
        const deps = accountDeps.get(name) ?? new Set();
        for (const dep of deps) {
            if (accountDeps.has(dep) && !topoSort(dep)) {
                // Dependency lost its PDA resolution — remove ours too.
                delete resolvedPdaAccounts[name];
            }
        }
        visiting.delete(name);
        visited.add(name);
        sortedAccountNames.push(name);
        return resolvedPdaAccounts[name] !== undefined || !accountDeps.get(name)?.size;
    };

    for (const account of accounts) {
        topoSort(camelCase(account.name));
    }

    return sortedAccountNames.map(name => {
        const account = accounts.find(a => camelCase(a.name) === name)!;
        return {
            ...account,
            pdaDefault: resolvedPdaAccounts[name] ?? null,
        };
    });
}

function getConflictsForInstructionAccountsAndArgs(instruction: InstructionNode): string[] {
    const allNames = [
        ...instruction.accounts.map(account => account.name),
        ...instruction.arguments.map(argument => argument.name),
    ];
    const duplicates = allNames.filter((e, i, a) => a.indexOf(e) !== i);
    return [...new Set(duplicates)];
}
