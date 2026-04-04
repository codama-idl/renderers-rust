import { logWarn } from '@codama/errors';
import {
    getAllAccounts,
    getAllDefinedTypes,
    getAllInstructionsWithSubs,
    getAllPdas,
    getAllPrograms,
    InstructionNode,
    isNode,
    isNodeFilter,
    pascalCase,
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
    Fragment,
    getDiscriminatorConstants,
    getImportFromFactory,
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
                        const valueManifest = renderValueNode(seed.value, getImportFrom, true);
                        imports.mergeWith(valueManifest.imports);
                        const resolvedType = resolveNestedTypeNode(seed.type);
                        return { ...seed, resolvedType, typeManifest: seedManifest, valueManifest };
                    });

                    const hasVariableSeeds = node.seeds.filter(isNodeFilter('variablePdaSeedNode')).length > 0;
                    const constantSeeds = seeds
                        .filter(isNodeFilter('constantPdaSeedNode'))
                        .filter(seed => !isNode(seed.value, 'programIdValueNode'));

                    const programAddress = node.programId ?? program?.publicKey;

                    return createRenderMap(`pdas/${snakeCase(node.name)}.rs`, {
                        content: render('pdasPage.njk', {
                            constantSeeds,
                            hasVariableSeeds,
                            imports: imports.toString(dependencyMap),
                            pda: node,
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
