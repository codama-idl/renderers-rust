import { logWarn } from '@codama/errors';
import {
    constantValueNode,
    getAllAccounts,
    getAllDefinedTypes,
    getAllInstructionsWithSubs,
    getAllPdas,
    getAllPrograms,
    type InstructionAccountNode,
    type InstructionArgumentNode,
    InstructionNode,
    isNode,
    isNodeFilter,
    pascalCase,
    type PdaNode,
    type ProgramNode,
    resolveNestedTypeNode,
    snakeCase,
    structTypeNodeFromInstructionArgumentNodes,
    VALUE_NODES,
} from '@codama/nodes';
import { addToRenderMap, createRenderMap, mergeRenderMaps } from '@codama/renderers-core';
import {
    extendVisitor,
    findProgramNodeFromPath,
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
    computePdaAddress,
    Fragment,
    getByteArrayDiscriminatorConstantName,
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
            keys: ['rootNode', 'programNode', 'instructionNode', 'accountNode', 'definedTypeNode', 'pdaNode'],
        }),
        v =>
            extendVisitor(v, {
                visitAccount(node) {
                    const accountPath = stack.getPath('accountNode');
                    const program = findProgramNodeFromPath(accountPath);
                    if (!program) {
                        throw new Error('Account must be visited inside a program.');
                    }
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

                    const discriminatorConstantName = getByteArrayDiscriminatorConstantName({
                        discriminatorNodes: node.discriminators ?? [],
                        fields,
                        prefix: node.name,
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
                        const resolvedType = resolveNestedTypeNode(seed.type);
                        let seedBytesExpr: string;
                        if (isNode(seed.value, 'stringValueNode')) {
                            const m = renderValueNode(seed.value, getImportFrom, true);
                            seedsImports.mergeWith(m.imports);
                            seedBytesExpr = `b${m.render}`;
                        } else if (isNode(seed.value, 'bytesValueNode')) {
                            const m = renderValueNode(seed.value, getImportFrom, true);
                            seedsImports.mergeWith(m.imports);
                            seedBytesExpr = `&${m.render}`;
                        } else {
                            const m = renderValueNode(constantValueNode(seed.type, seed.value), getImportFrom, true);
                            seedsImports.mergeWith(m.imports);
                            seedBytesExpr = `&${m.render}`;
                        }
                        return { ...seed, resolvedType, seedBytesExpr, typeManifest: seedManifest };
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
                            discriminatorConstantName,
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
                    const instructionPath = stack.getPath('instructionNode');
                    const program = findProgramNodeFromPath(instructionPath);
                    if (!program) {
                        throw new Error('Instruction must be visited inside a program.');
                    }
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

                    const dataTraits = getTraitsFromNode(node);
                    imports
                        .mergeWith(dataTraits.imports)
                        .mergeWith(discriminatorConstants.imports)
                        .remove(`generatedInstructions::${pascalCase(node.name)}`);

                    // Resolve PDA defaults and topologically sort accounts by dependency.
                    const resolvedAccounts = resolveInstructionPdaDefaults({
                        accounts: node.accounts,
                        accountsAndArgsConflicts,
                        getImportFrom,
                        imports,
                        instructionArguments: node.arguments,
                        instructionName: node.name,
                        linkables,
                        program,
                        stack,
                    });

                    return createRenderMap(`instructions/${snakeCase(node.name)}.rs`, {
                        content: render('instructionsPage.njk', {
                            accountsAndArgsConflicts,
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

                visitPda(node) {
                    const pdaPath = stack.getPath('pdaNode');
                    const program = findProgramNodeFromPath(pdaPath);
                    if (!program) {
                        throw new Error('PDA must be visited inside a program.');
                    }
                    const imports = new ImportMap();

                    // Process seeds
                    const seeds = node.seeds.map(seed => {
                        if (isNode(seed, 'variablePdaSeedNode')) {
                            const seedManifest = visit(seed.type, typeManifestVisitor);
                            imports.mergeWith(seedManifest.imports);
                            const resolvedType = resolveNestedTypeNode(seed.type);
                            return { ...seed, resolvedType, typeManifest: seedManifest };
                        }
                        if (isNode(seed.value, 'programIdValueNode')) {
                            return seed;
                        }
                        const seedManifest = visit(seed.type, typeManifestVisitor);
                        const resolvedType = resolveNestedTypeNode(seed.type);
                        let seedBytesExpr: string;
                        if (isNode(seed.value, 'stringValueNode')) {
                            const m = renderValueNode(seed.value, getImportFrom, true);
                            imports.mergeWith(m.imports);
                            seedBytesExpr = `b${m.render}`;
                        } else if (isNode(seed.value, 'bytesValueNode')) {
                            const m = renderValueNode(seed.value, getImportFrom, true);
                            imports.mergeWith(m.imports);
                            seedBytesExpr = `&${m.render}`;
                        } else {
                            const m = renderValueNode(constantValueNode(seed.type, seed.value), getImportFrom, true);
                            imports.mergeWith(m.imports);
                            seedBytesExpr = `&${m.render}`;
                        }
                        return { ...seed, resolvedType, seedBytesExpr, typeManifest: seedManifest };
                    });

                    const hasVariableSeeds = node.seeds.filter(isNodeFilter('variablePdaSeedNode')).length > 0;
                    const constantSeeds = seeds
                        .filter(isNodeFilter('constantPdaSeedNode'))
                        .filter(seed => !isNode(seed.value, 'programIdValueNode'));

                    const programAddress = node.programId ?? program?.publicKey;

                    let precomputedAddress: string | undefined;
                    if (!hasVariableSeeds && programAddress) {
                        precomputedAddress = computePdaAddress(node.seeds, programAddress) ?? undefined;
                    }

                    // Template uses fully-qualified paths for return types and static methods,
                    // but variable seed types use the short form from the type manifest.
                    // Only remove the import when there are no variable seeds.
                    if (!hasVariableSeeds) {
                        imports.remove('solana_address::Address');
                    }

                    return createRenderMap(`pdas/${snakeCase(node.name)}.rs`, {
                        content: render('pdasPage.njk', {
                            constantSeeds,
                            hasVariableSeeds,
                            imports: imports.toString(dependencyMap),
                            pda: node,
                            precomputedAddress,
                            program,
                            programAddress,
                            seeds,
                        }),
                        imports,
                    });
                },

                visitProgram(node, { self }) {
                    let renders = mergeRenderMaps([
                        ...node.accounts.map(account => visit(account, self)),
                        ...node.definedTypes.map(type => visit(type, self)),
                        ...getAllInstructionsWithSubs(node, {
                            leavesOnly: !renderParentInstructions,
                        }).map(ix => visit(ix, self)),
                        ...node.pdas.map(pda => visit(pda, self)),
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

                    return renders;
                },

                visitRoot(node, { self }) {
                    const programsToExport = getAllPrograms(node);
                    const accountsToExport = getAllAccounts(node);
                    const instructionsToExport = getAllInstructionsWithSubs(node, {
                        leavesOnly: !renderParentInstructions,
                    });
                    const pdasToExport = getAllPdas(node);
                    const definedTypesToExport = getAllDefinedTypes(node);
                    const hasAnythingToExport =
                        programsToExport.length > 0 ||
                        accountsToExport.length > 0 ||
                        instructionsToExport.length > 0 ||
                        pdasToExport.length > 0 ||
                        definedTypesToExport.length > 0;

                    const ctx = {
                        accountsToExport,
                        definedTypesToExport,
                        hasAnythingToExport,
                        instructionsToExport,
                        pdasToExport,
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
                            ['pdas/mod.rs']:
                                pdasToExport.length > 0
                                    ? { content: render('pdasMod.njk', ctx), imports: new ImportMap() }
                                    : undefined,
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

function getConflictsForInstructionAccountsAndArgs(instruction: InstructionNode): string[] {
    const allNames = [
        ...instruction.accounts.map(account => account.name),
        ...instruction.arguments.map(argument => argument.name),
    ];
    const duplicates = allNames.filter((e, i, a) => a.indexOf(e) !== i);
    return [...new Set(duplicates)];
}

type RenderedSeed = {
    kind: 'accountRef' | 'argumentRef' | 'constant' | 'programId' | 'value';
    rawName?: string;
    render: string;
};

type ResolvedPdaDefault = {
    accountDeps: string[];
    hasVariableSeeds: boolean;
    isLinked: boolean;
    linkedPdaName?: string;
    programAddressExpr?: string;
    renderedSeeds: RenderedSeed[];
};

type ResolvedAccount = InstructionAccountNode & {
    pdaDefault: ResolvedPdaDefault | null;
};

function resolveInstructionPdaDefaults(ctx: {
    accounts: readonly InstructionAccountNode[];
    accountsAndArgsConflicts: string[];
    getImportFrom: GetImportFromFunction;
    imports: ImportMap;
    instructionArguments: readonly InstructionArgumentNode[];
    instructionName: string;
    linkables: LinkableDictionary;
    program: ProgramNode;
    stack: NodeStack;
}): ResolvedAccount[] {
    const {
        accounts,
        accountsAndArgsConflicts,
        getImportFrom,
        imports,
        instructionArguments,
        instructionName,
        linkables,
        program,
        stack,
    } = ctx;

    // Cast to string to avoid branded CamelCaseString type.
    const pdaDefaultedNames = new Set<string>(
        accounts.filter(a => a.defaultValue?.kind === 'pdaValueNode').map(a => a.name as string),
    );

    const resolvedPdas: Record<string, ResolvedPdaDefault> = {};

    for (const account of accounts) {
        if (!account.defaultValue || !isNode(account.defaultValue, 'pdaValueNode')) {
            continue;
        }
        const defaultValue = account.defaultValue;

        let pdaNode: PdaNode | undefined;
        const isLinked = isNode(defaultValue.pda, 'pdaLinkNode');
        const linkedPdaName = isLinked ? (defaultValue.pda as { name: string }).name : undefined;

        if (isLinked) {
            pdaNode = linkables.get([...stack.getPath(), defaultValue.pda]) ?? undefined;
        } else if (isNode(defaultValue.pda, 'pdaNode')) {
            pdaNode = defaultValue.pda;
        }

        // Linked PDAs can work without pdaNode (iterate defaultValue.seeds directly).
        if (!isLinked && !pdaNode) {
            logWarn(
                `[Rust] Could not resolve PDA node for account [${account.name}] ` +
                    `in instruction [${instructionName}]. The account will be treated as required.`,
            );
            continue;
        }

        const programAddressExpr = pdaNode?.programId
            ? `solana_address::address!("${pdaNode.programId}")`
            : `crate::${snakeCase(program.name).toUpperCase()}_ID`;

        // Upstream account defaults for seed resolution.
        const accountDefaults: Record<string, string> = {};
        const eitherSignerAccounts = new Set<string>();
        for (const seedBinding of defaultValue.seeds) {
            if (isNode(seedBinding.value, 'accountValueNode')) {
                const refName = seedBinding.value.name;
                const refAccount = accounts.find(a => a.name === refName);
                if (refAccount?.defaultValue && isNode(refAccount.defaultValue, 'publicKeyValueNode')) {
                    accountDefaults[refName] = `solana_address::address!("${refAccount.defaultValue.publicKey}")`;
                } else if (refAccount?.defaultValue && isNode(refAccount.defaultValue, 'programIdValueNode')) {
                    accountDefaults[refName] = `crate::${snakeCase(program.name).toUpperCase()}_ID`;
                }
                if (refAccount?.isSigner === 'either') {
                    eitherSignerAccounts.add(refName);
                }
            }
        }

        const renderedSeeds: RenderedSeed[] = [];
        const accountDeps: string[] = [];
        let seedsComplete = true;

        // Two rendering paths because extractPdasVisitor only extracts same-program
        // PDAs — cross-program derivations (e.g. ATAs via the associated-token-program)
        // stay inline as pdaNode since they can't live in this program's pdas module.
        //
        // Linked (pdaLinkNode): call the standalone find_*_pda() with typed args.
        // Inline (pdaNode):     emit find_program_address() with raw byte-slice seeds.
        if (isLinked) {
            for (const seedBinding of defaultValue.seeds) {
                const seedValue = seedBinding.value;

                if (isNode(seedValue, 'accountValueNode')) {
                    const refName = snakeCase(seedValue.name);
                    const isEither = eitherSignerAccounts.has(seedValue.name);
                    const eitherExtract = isEither ? '.map(|(k, _)| k)' : '';

                    if (pdaDefaultedNames.has(seedValue.name)) {
                        accountDeps.push(seedValue.name);
                        renderedSeeds.push({ kind: 'accountRef', rawName: refName, render: `&${refName}` });
                    } else {
                        const defaultExpr = accountDefaults[seedValue.name];
                        let render: string;
                        if (defaultExpr) {
                            render = `&self.${refName}${eitherExtract}.unwrap_or(${defaultExpr})`;
                        } else {
                            render = `&self.${refName}${eitherExtract}.expect("${refName} is needed for ${snakeCase(account.name)} PDA")`;
                        }
                        renderedSeeds.push({ kind: 'accountRef', rawName: refName, render });
                    }
                } else if (isNode(seedValue, 'argumentValueNode')) {
                    const argFieldName = accountsAndArgsConflicts.includes(seedValue.name)
                        ? `${seedValue.name}_arg`
                        : seedValue.name;
                    const fieldName = snakeCase(argFieldName);

                    const arg = instructionArguments.find(a => a.name === seedValue.name);
                    let argDefault: { isOmitted: boolean; value: string } | null = null;
                    if (arg?.defaultValue && isNode(arg.defaultValue, VALUE_NODES)) {
                        const { render: value } = renderValueNode(arg.defaultValue, getImportFrom);
                        argDefault = { isOmitted: arg.defaultValueStrategy === 'omitted', value };
                    }

                    // Pubkey seeds need by-ref for the typed find_*_pda() signature.
                    let isByRef = false;
                    if (pdaNode) {
                        const pdaSeed = pdaNode.seeds.find(
                            s => isNode(s, 'variablePdaSeedNode') && s.name === seedBinding.name,
                        );
                        if (pdaSeed && isNode(pdaSeed, 'variablePdaSeedNode')) {
                            isByRef = resolveNestedTypeNode(pdaSeed.type).kind === 'publicKeyTypeNode';
                        }
                    }

                    if (argDefault && argDefault.isOmitted) {
                        renderedSeeds.push({
                            kind: 'argumentRef',
                            render: `${isByRef ? '&' : ''}${argDefault.value}`,
                        });
                    } else {
                        renderedSeeds.push({
                            kind: 'argumentRef',
                            render: `${isByRef ? '&' : ''}self.${fieldName}.clone().expect("${fieldName} is needed for ${snakeCase(account.name)} PDA")`,
                        });
                    }
                }
            }
        } else {
            for (const seed of pdaNode!.seeds) {
                if (isNode(seed, 'constantPdaSeedNode')) {
                    if (isNode(seed.value, 'programIdValueNode')) {
                        renderedSeeds.push({
                            kind: 'programId',
                            render: `crate::${snakeCase(program.name).toUpperCase()}_ID.as_ref()`,
                        });
                    } else {
                        const valueManifest = renderValueNode(seed.value, getImportFrom);
                        imports.mergeWith(valueManifest.imports);
                        renderedSeeds.push({ kind: 'constant', render: `&${valueManifest.render}` });
                    }
                    continue;
                }

                if (!isNode(seed, 'variablePdaSeedNode')) continue;

                const binding = defaultValue.seeds.find(s => s.name === seed.name);
                if (!binding) {
                    logWarn(
                        `[Rust] Missing seed value for variable seed [${seed.name}] ` +
                            `in PDA default for account [${account.name}] ` +
                            `of instruction [${instructionName}]. Skipping PDA resolution.`,
                    );
                    seedsComplete = false;
                    break;
                }

                const resolvedType = resolveNestedTypeNode(seed.type);
                const seedValue = binding.value;

                if (isNode(seedValue, 'accountValueNode')) {
                    const refName = snakeCase(seedValue.name);
                    const isEither = eitherSignerAccounts.has(seedValue.name);
                    const eitherExtract = isEither ? '.map(|(k, _)| k)' : '';
                    const defaultExpr = accountDefaults[seedValue.name];

                    if (pdaDefaultedNames.has(seedValue.name)) {
                        accountDeps.push(seedValue.name);
                    }

                    let valueExpr: string;
                    if (pdaDefaultedNames.has(seedValue.name)) {
                        valueExpr = refName;
                    } else if (defaultExpr) {
                        valueExpr = `self.${refName}${eitherExtract}.unwrap_or(${defaultExpr})`;
                    } else {
                        valueExpr = `self.${refName}${eitherExtract}.expect("${refName} is needed for ${snakeCase(account.name)} PDA")`;
                    }

                    if (resolvedType.kind === 'publicKeyTypeNode') {
                        renderedSeeds.push({ kind: 'accountRef', rawName: refName, render: `${valueExpr}.as_ref()` });
                    } else if (resolvedType.kind === 'bytesTypeNode') {
                        renderedSeeds.push({ kind: 'accountRef', rawName: refName, render: `&${valueExpr}` });
                    } else {
                        renderedSeeds.push({
                            kind: 'accountRef',
                            rawName: refName,
                            render: `${valueExpr}.to_string().as_ref()`,
                        });
                    }
                } else if (isNode(seedValue, 'argumentValueNode')) {
                    const argFieldName = accountsAndArgsConflicts.includes(seedValue.name)
                        ? `${seedValue.name}_arg`
                        : seedValue.name;
                    const fieldName = snakeCase(argFieldName);

                    const arg = instructionArguments.find(a => a.name === seedValue.name);
                    let argDefault: { isOmitted: boolean; value: string } | null = null;
                    if (arg?.defaultValue && isNode(arg.defaultValue, VALUE_NODES)) {
                        const { render: value } = renderValueNode(arg.defaultValue, getImportFrom);
                        argDefault = { isOmitted: arg.defaultValueStrategy === 'omitted', value };
                    }

                    if (argDefault && argDefault.isOmitted) {
                        if (resolvedType.kind === 'publicKeyTypeNode') {
                            renderedSeeds.push({ kind: 'argumentRef', render: `${argDefault.value}.as_ref()` });
                        } else if (resolvedType.kind === 'bytesTypeNode') {
                            renderedSeeds.push({ kind: 'argumentRef', render: `&${argDefault.value}` });
                        } else {
                            renderedSeeds.push({
                                kind: 'argumentRef',
                                render: `${argDefault.value}.to_string().as_ref()`,
                            });
                        }
                    } else {
                        const valueExpr = `self.${fieldName}.clone().expect("${fieldName} is needed for ${snakeCase(account.name)} PDA")`;
                        if (resolvedType.kind === 'publicKeyTypeNode') {
                            renderedSeeds.push({ kind: 'argumentRef', render: `${valueExpr}.as_ref()` });
                        } else if (resolvedType.kind === 'bytesTypeNode') {
                            renderedSeeds.push({ kind: 'argumentRef', render: `&${valueExpr}` });
                        } else {
                            renderedSeeds.push({
                                kind: 'argumentRef',
                                render: `${valueExpr}.to_string().as_ref()`,
                            });
                        }
                    }
                } else {
                    const valueManifest = renderValueNode(seedValue, getImportFrom, true);
                    imports.mergeWith(valueManifest.imports);
                    if (resolvedType.kind === 'publicKeyTypeNode') {
                        renderedSeeds.push({ kind: 'value', render: `${valueManifest.render}.as_ref()` });
                    } else {
                        renderedSeeds.push({ kind: 'value', render: `${valueManifest.render}.as_bytes()` });
                    }
                }
            }
        }

        if (!seedsComplete) continue;

        const pdaHasVariableSeeds = pdaNode ? pdaNode.seeds.some(s => isNode(s, 'variablePdaSeedNode')) : true;

        resolvedPdas[account.name] = {
            accountDeps,
            hasVariableSeeds: pdaHasVariableSeeds,
            isLinked,
            linkedPdaName,
            programAddressExpr,
            renderedSeeds,
        };
    }

    // DFS topological sort with cycle detection and propagation.
    const accountDeps = new Map<string, Set<string>>();
    for (const account of accounts) {
        const name = account.name;
        accountDeps.set(name, new Set());
        const pdaInfo = resolvedPdas[name];
        if (pdaInfo) {
            for (const dep of pdaInfo.accountDeps) {
                accountDeps.get(name)!.add(dep);
            }
        }
    }

    const sortedNames: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const topoVisit = (name: string): boolean => {
        if (visited.has(name)) return resolvedPdas[name] !== undefined || !pdaDefaultedNames.has(name);
        if (visiting.has(name)) {
            logWarn(
                `[Rust] Circular PDA dependency detected for account [${name}] ` +
                    `in instruction [${instructionName}]. Falling back to required account.`,
            );
            delete resolvedPdas[name];
            return false;
        }
        visiting.add(name);
        for (const dep of accountDeps.get(name) ?? []) {
            if (accountDeps.has(dep) && !topoVisit(dep)) {
                // Dependency lost its PDA resolution — remove ours too.
                delete resolvedPdas[name];
            }
        }
        visiting.delete(name);
        visited.add(name);
        sortedNames.push(name);
        return resolvedPdas[name] !== undefined || !pdaDefaultedNames.has(name);
    };

    for (const account of accounts) {
        topoVisit(account.name);
    }

    return sortedNames.map(name => {
        const account = accounts.find(a => a.name === name)!;
        return { ...account, pdaDefault: resolvedPdas[name] ?? null };
    });
}
