import { logWarn } from '@codama/errors';
import {
    type ConstantPdaSeedNode,
    ConstantValueNode,
    constantValueNode,
    definedTypeNode,
    EventFraming,
    EventNode,
    getAllAccounts,
    getAllDefinedTypes,
    getAllEvents,
    getAllInstructionArguments,
    getAllInstructionsWithSubs,
    getAllPdas,
    getAllPrograms,
    type InstructionAccountNode,
    InstructionNode,
    isNode,
    isNodeFilter,
    pascalCase,
    type PdaNode,
    type PdaValueNode,
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
    getResolvedInstructionInputsVisitor,
    LinkableDictionary,
    NodeStack,
    pipe,
    recordLinkablesOnFirstVisitVisitor,
    recordNodeStackVisitor,
    staticVisitor,
    visit,
} from '@codama/visitors-core';
import { getBase58Encoder } from '@solana/codecs-strings';

import { getTypeManifestVisitor } from './getTypeManifestVisitor';
import { ImportMap } from './ImportMap';
import { renderValueNode } from './renderValueNodeVisitor';
import {
    CargoDependencies,
    computePdaAddress,
    constantDiscriminatorName,
    constantDiscriminatorSize,
    Fragment,
    getByteArrayDiscriminatorConstantName,
    getDiscriminatorConditions,
    getDiscriminatorConstants,
    getImportFromFactory,
    type GetImportFromFunction,
    getTraitsFromNodeFactory,
    LinkOverrides,
    render,
    renderByteCheck,
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
    let programEventFraming: ResolvedProgramEventFraming | undefined = undefined;
    const programsWithEventEnum = new Set<string>();

    const renderParentInstructions = options.renderParentInstructions ?? false;
    const dependencyMap = options.dependencyMap ?? {};
    const getImportFrom = getImportFromFactory(options.linkOverrides ?? {});
    const getTraitsFromNode = getTraitsFromNodeFactory(options.traitOptions);
    const typeManifestVisitor = getTypeManifestVisitor({
        getImportFrom,
        getTraitsFromNode,
        traitOptions: options.traitOptions,
    });
    // Optional accounts are safe as PDA seeds: builders hold accounts as
    // Option<Pubkey> and only expect() them on the derive path.
    const resolvedInstructionInputVisitor = getResolvedInstructionInputsVisitor({
        allowOptionalAccountsAsPdaSeeds: true,
    });
    const anchorTraits = options.anchorTraits ?? true;

    return pipe(
        staticVisitor(() => createRenderMap<Fragment>(), {
            keys: [
                'rootNode',
                'programNode',
                'instructionNode',
                'accountNode',
                'definedTypeNode',
                'eventNode',
                'pdaNode',
            ],
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
                        const seedBytes = renderConstantSeedBytes(seed, getImportFrom);
                        seedsImports.mergeWith(seedBytes.imports);
                        return { ...seed, resolvedType, seedBytesExpr: seedBytes.render, typeManifest: seedManifest };
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

                visitEvent(node) {
                    const allDiscriminators = node.discriminators ?? [];
                    const isCpiFramed = isEventCpiFramed(node, programEventFraming);
                    const framingConstantName = isCpiFramed
                        ? snakeCase(programEventFraming!.framing.sharedConstantName).toUpperCase()
                        : null;
                    // Strip the hoisted framing constant so per-event _DISCRIMINATOR matches IDL events[].discriminator bytes.
                    const discriminators = isCpiFramed ? allDiscriminators.slice(1) : allDiscriminators;
                    const innerType = resolveNestedTypeNode(node.data);
                    // Wrap as definedTypeNode so typeManifestVisitor generates the struct with derives.
                    const syntheticType = definedTypeNode({
                        docs: node.docs,
                        name: node.name,
                        type: innerType,
                    });
                    const typeManifest = visit(syntheticType, typeManifestVisitor);

                    // Discriminator constants (excluding the hoisted framing one for CPI-framed events).
                    const fields = isNode(innerType, 'structTypeNode') ? innerType.fields : [];
                    const discriminatorConstants = getDiscriminatorConstants({
                        discriminatorNodes: discriminators,
                        fields,
                        getImportFrom,
                        prefix: node.name,
                        typeManifestVisitor,
                    });

                    const hasFromBytes = eventHasFromBytes(node);
                    const perEventConstantDiscriminators = hasFromBytes
                        ? discriminators
                              .filter(isNodeFilter('constantDiscriminatorNode'))
                              .map(d => {
                                  const name = snakeCase(
                                      constantDiscriminatorName(node.name, d, discriminators),
                                  ).toUpperCase();
                                  return {
                                      condition: renderByteCheck(name, d.constant.type, d.offset, true),
                                      name,
                                      offset: d.offset,
                                      size: constantDiscriminatorSize(d),
                                  };
                              })
                              .sort((a, b) => a.offset - b.offset)
                        : [];

                    const allConstantDiscriminators =
                        isCpiFramed && framingConstantName
                            ? [
                                  {
                                      condition: renderByteCheck(
                                          framingConstantName,
                                          programEventFraming!.constant.type,
                                          0,
                                          true,
                                      ),
                                      name: framingConstantName,
                                      offset: 0,
                                      size: renderConstantBytesArray(programEventFraming!.constant)?.len ?? null,
                                  },
                                  ...perEventConstantDiscriminators,
                              ]
                            : perEventConstantDiscriminators;

                    const hiddenPrefixSkipResult = hasFromBytes
                        ? isCpiFramed
                            ? getCpiFramedSkip(allConstantDiscriminators)
                            : getHiddenPrefixSkip(node)
                        : null;
                    const generateFromBytes = hasFromBytes && hiddenPrefixSkipResult !== null;
                    const hiddenPrefixSkip = hiddenPrefixSkipResult ?? NO_SKIP;
                    const constantDiscriminators = generateFromBytes ? allConstantDiscriminators : [];

                    const imports = new ImportMap()
                        .mergeWithManifest(typeManifest)
                        .mergeWith(discriminatorConstants.imports)
                        .remove(`generatedEvents::${pascalCase(node.name)}`);
                    if (framingConstantName) {
                        imports.add(`generatedEvents::${framingConstantName}`);
                    }

                    return createRenderMap(`events/${snakeCase(node.name)}.rs`, {
                        content: render('eventsPage.njk', {
                            constantDiscriminators,
                            discriminatorConstants: discriminatorConstants.render,
                            event: node,
                            hiddenPrefixSkip,
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

                    // Extra arguments: required, non-serialized caller inputs (e.g. Anchor
                    // account-data seeds lowered to argumentValueNodes). They become builder
                    // fields read by PDA derivations but never enter InstructionData/Args.
                    const extraArgs = (node.extraArguments ?? []).map(argument => {
                        const manifest = visit(argument.type, typeManifestVisitor);
                        imports.mergeWith(manifest.imports);
                        const name = accountsAndArgsConflicts.includes(argument.name)
                            ? `${argument.name}_arg`
                            : argument.name;
                        return { name, type: manifest.type };
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

                    // Accounts that are optional in the builder (have defaults or are IDL-optional).
                    const builderOptionalAccounts = new Set(
                        node.accounts
                            .filter(
                                account =>
                                    account.isOptional ||
                                    (account.defaultValue != null &&
                                        (isNode(account.defaultValue, ['publicKeyValueNode', 'programIdValueNode']) ||
                                            account.defaultValue.kind === 'pdaValueNode')),
                            )
                            .map(a => a.name),
                    );
                    // CPI can't derive AccountInfo from PDA/publicKey defaults.
                    const cpiBuilderOptionalAccounts = new Set(
                        node.accounts
                            .filter(
                                account =>
                                    account.isOptional ||
                                    (account.defaultValue != null &&
                                        isNode(account.defaultValue, ['programIdValueNode'])),
                            )
                            .map(a => a.name),
                    );
                    // Extra args are always required builder inputs.
                    const hasRequiredArgs =
                        instructionArgs.some(arg => !arg.default && !arg.optional && !arg.innerOptionType) ||
                        extraArgs.length > 0;
                    const requiredArgNames = [
                        ...instructionArgs
                            .filter(arg => !arg.default && !arg.optional && !arg.innerOptionType)
                            .map(arg => snakeCase(arg.name)),
                        ...extraArgs.map(arg => snakeCase(arg.name)),
                    ];

                    // Resolve PDA defaults; builder `let` bindings follow the visitor's
                    // dependency-first order so derived PDAs can feed later derivations.
                    // Strip `isOptional` for the ordering visit: codama rejects optional
                    // accounts as seed sources, but the builder unwraps them at runtime.
                    const orderingNode = { ...node, accounts: node.accounts.map(a => ({ ...a, isOptional: false })) };
                    const orderedAccountNames = visit(orderingNode, resolvedInstructionInputVisitor)
                        .filter(isNodeFilter('instructionAccountNode'))
                        .map(input => input.name as string);
                    const resolvedAccounts = resolveInstructionPdaDefaults({
                        accountsAndArgsConflicts,
                        builderOptionalAccounts,
                        getImportFrom,
                        imports,
                        instruction: node,
                        linkables,
                        orderedAccountNames,
                        program,
                        requiredArgNames,
                        stack,
                    });
                    const hasRequiredAccounts = node.accounts.some(a => !builderOptionalAccounts.has(a.name));

                    return createRenderMap(`instructions/${snakeCase(node.name)}.rs`, {
                        content: render('instructionsPage.njk', {
                            accountsAndArgsConflicts,
                            builderOptionalAccounts: [...builderOptionalAccounts],
                            cpiBuilderOptionalAccounts: [...cpiBuilderOptionalAccounts],
                            dataTraits: dataTraits.render,
                            discriminatorConstants: discriminatorConstants.render,
                            extraArgs,
                            hasArgs,
                            hasOptional,
                            hasRequiredAccounts,
                            hasRequiredArgs,
                            imports: imports.toString(dependencyMap),
                            instruction: node,
                            instructionArgs,
                            program,
                            requiredArgNames,
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
                        const seedBytes = renderConstantSeedBytes(seed, getImportFrom);
                        imports.mergeWith(seedBytes.imports);
                        return { ...seed, resolvedType, seedBytesExpr: seedBytes.render, typeManifest: seedManifest };
                    });

                    const hasVariableSeeds = node.seeds.filter(isNodeFilter('variablePdaSeedNode')).length > 0;
                    const constantSeeds = seeds
                        .filter(isNodeFilter('constantPdaSeedNode'))
                        .filter(seed => !isNode(seed.value, 'programIdValueNode'));

                    const programAddress = node.programId ?? program?.publicKey;

                    // Dynamic-only PDAs: helpers take the deriving program as a parameter,
                    // and _ADDRESS folds under the canonical program, not this program's ID.
                    const dynamicProgramOnly = getDynamicProgramOnlyPdas(program).has(node.name as string);
                    // Codama pins foreign programs (IDL address constraint) on
                    // pdaNode.programId; bake that address into the helpers.
                    const canonicalProgramAddress =
                        node.programId && node.programId !== program.publicKey ? node.programId : undefined;

                    let precomputedAddress: string | undefined;
                    if (!hasVariableSeeds) {
                        const foldProgram = dynamicProgramOnly ? canonicalProgramAddress : programAddress;
                        if (foldProgram) {
                            precomputedAddress = computePdaAddress(node.seeds, foldProgram) ?? undefined;
                        }
                    }

                    // Template uses fully-qualified paths for return types and static methods,
                    // but variable seed types use the short form from the type manifest.
                    // Only remove the import when there are no variable seeds.
                    if (!hasVariableSeeds) {
                        imports.remove('solana_address::Address');
                    }

                    return createRenderMap(`pdas/${snakeCase(node.name)}.rs`, {
                        content: render('pdasPage.njk', {
                            canonicalProgramAddress,
                            constantSeeds,
                            dynamicProgramOnly,
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
                    programEventFraming = deriveProgramEventFraming(node);
                    let renders = mergeRenderMaps([
                        ...node.accounts.map(account => visit(account, self)),
                        ...node.definedTypes.map(type => visit(type, self)),
                        ...(node.events ?? []).map(event => visit(event, self)),
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

                    // Program events (enum + identify + try_parse).
                    const programEventsRender = buildProgramEventsRender(
                        node.events ?? [],
                        node,
                        programEventFraming,
                        getImportFrom,
                        typeManifestVisitor,
                        dependencyMap,
                    );
                    if (programEventsRender) {
                        programsWithEventEnum.add(node.name);
                        renders = addToRenderMap(
                            renders,
                            `events/${snakeCase(node.name)}_events.rs`,
                            programEventsRender,
                        );
                    }

                    programEventFraming = undefined;
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
                    const eventsToExport = getAllEvents(node).filter(Boolean);
                    const hasAnythingToExport =
                        programsToExport.length > 0 ||
                        accountsToExport.length > 0 ||
                        instructionsToExport.length > 0 ||
                        pdasToExport.length > 0 ||
                        definedTypesToExport.length > 0 ||
                        eventsToExport.length > 0;

                    const ctx = {
                        accountsToExport,
                        definedTypesToExport,
                        eventsToExport,
                        hasAnythingToExport,
                        instructionsToExport,
                        pdasToExport,
                        programsToExport,
                        programsWithEventEnum,
                        root: node,
                    };

                    // Visit programs first so programsWithEventEnum is populated.
                    const programRenders = getAllPrograms(node).map(p => visit(p, self));

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
                            ['events/mod.rs']:
                                eventsToExport.length > 0
                                    ? { content: render('eventsMod.njk', ctx), imports: new ImportMap() }
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
                        ...programRenders,
                    ]);
                },
            }),
        v => recordNodeStackVisitor(v, stack),
        v => recordLinkablesOnFirstVisitVisitor(v, linkables),
    );
}

function eventHasFromBytes(event: EventNode): boolean {
    const hasConstantDiscriminator = (event.discriminators ?? []).some(d => isNode(d, 'constantDiscriminatorNode'));
    const dataHasHiddenPrefix = isNode(event.data, 'hiddenPrefixTypeNode');
    return hasConstantDiscriminator && dataHasHiddenPrefix;
}

/** A rendered `&data[..]` skip expression; `comment` lists the constants folded into a literal offset. */
type SkipExpr = { comment: string | null; expr: string };

const NO_SKIP: SkipExpr = { comment: null, expr: 'data' };

function getHiddenPrefixSkip(event: EventNode): SkipExpr | null {
    if (!isNode(event.data, 'hiddenPrefixTypeNode')) {
        return NO_SKIP;
    }
    let hasNonFixedSize = false;
    const prefixSize = event.data.prefix.reduce((sum, p) => {
        if (!isNode(p.type, 'fixedSizeTypeNode')) {
            logWarn(
                `[Rust] Event [${event.name}] has a non-fixed-size hidden prefix entry; ` +
                    `from_bytes will not be generated.`,
            );
            hasNonFixedSize = true;
            return sum;
        }
        return sum + p.type.size;
    }, 0);
    if (hasNonFixedSize) {
        return null;
    }
    // Literal byte count: keeps arithmetic out of generated code (clippy::arithmetic_side_effects).
    return { comment: null, expr: `&data[${prefixSize}..]` };
}

/** Resolved program-level framing: the hoisted prefix constant + its source EventFraming. */
type ResolvedProgramEventFraming = { constant: ConstantValueNode; framing: EventFraming };

function deriveProgramEventFraming(programNode: ProgramNode | null): ResolvedProgramEventFraming | undefined {
    if (!programNode) return undefined;
    let resolved: ResolvedProgramEventFraming | undefined;
    for (const event of programNode.events ?? []) {
        if (!event.framing) continue;
        if (!isNode(event.data, 'hiddenPrefixTypeNode')) continue;
        if (event.data.prefix.length === 0) continue;
        if (!resolved) {
            resolved = { constant: event.data.prefix[0], framing: event.framing };
            continue;
        }
        if (resolved.framing.sharedConstantName !== event.framing.sharedConstantName) {
            logWarn(
                `[Rust] Program [${programNode.name}] has events with conflicting event framings ` +
                    `('${resolved.framing.sharedConstantName}' vs '${event.framing.sharedConstantName}'). ` +
                    `Only the first will be hoisted.`,
            );
            break;
        }
    }
    return resolved;
}

function isEventCpiFramed(event: EventNode, programEventFraming: ResolvedProgramEventFraming | undefined): boolean {
    if (programEventFraming === undefined) return false;
    if (!event.framing) return false;
    if (event.framing.sharedConstantName !== programEventFraming.framing.sharedConstantName) return false;
    if (!isNode(event.data, 'hiddenPrefixTypeNode')) return false;
    return event.data.prefix.length > 0;
}

function getCpiFramedSkip(constantDiscriminators: { name: string; offset: number; size: number | null }[]): SkipExpr {
    // Fold known sizes into one leading literal range and chain `[X.len()..]` for the rest,
    // so generated code never emits `+` (clippy::arithmetic_side_effects).
    const knownSize = constantDiscriminators.reduce((sum, d) => sum + (d.size ?? 0), 0);
    const ranges = constantDiscriminators.filter(d => d.size === null).map(d => `[${d.name}.len()..]`);
    if (knownSize > 0 || ranges.length === 0) {
        ranges.unshift(`[${knownSize}..]`);
    }
    const comment =
        constantDiscriminators.length > 1
            ? constantDiscriminators.map(d => (d.size === null ? d.name : `${d.name} (${d.size})`)).join(' + ')
            : null;
    return { comment, expr: `&data${ranges.join('')}` };
}

/** Renders a fixed-size bytes ConstantValueNode as a Rust `[u8; N] = [b0, b1, ...]` array literal. */
function renderConstantBytesArray(constant: ConstantValueNode): { len: number; literal: string } | null {
    if (!isNode(constant.type, 'fixedSizeTypeNode')) return null;
    if (!isNode(constant.value, 'bytesValueNode')) return null;
    const size = constant.type.size;
    const bytes: number[] = [];
    const hex = constant.value.encoding === 'base16' ? constant.value.data.toLowerCase() : null;
    if (hex === null || hex.length !== size * 2) return null;
    for (let i = 0; i < size; i++) {
        const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        if (Number.isNaN(byte)) return null;
        bytes.push(byte);
    }
    return { len: size, literal: `[${bytes.join(', ')}]` };
}

function buildProgramEventsRender(
    events: EventNode[],
    programNode: ProgramNode,
    programEventFraming: ResolvedProgramEventFraming | undefined,
    getImportFrom: GetImportFromFunction,
    typeManifestVisitor: ReturnType<typeof getTypeManifestVisitor>,
    dependencyMap: Record<string, string>,
): { content: string; imports: ImportMap } | null {
    if (events.length === 0) {
        return null;
    }

    const imports = new ImportMap();
    const framingConstantName = programEventFraming
        ? snakeCase(programEventFraming.framing.sharedConstantName).toUpperCase()
        : null;

    const eventsWithDiscriminators = events
        .filter(event => (event.discriminators ?? []).length > 0)
        .flatMap(event => {
            const isCpiFramed = isEventCpiFramed(event, programEventFraming);
            const allDiscriminators = event.discriminators ?? [];
            // For CPI-framed events, strip the leading framing discriminator — it's hoisted to the
            // program-level shared constant and prepended manually below.
            const perEventDiscriminators = isCpiFramed ? allDiscriminators.slice(1) : allDiscriminators;
            const innerType = resolveNestedTypeNode(event.data);
            const fields = isNode(innerType, 'structTypeNode') ? innerType.fields : [];
            const { conditions: perEventConditions, imports: condImports } = getDiscriminatorConditions({
                discriminatorNodes: perEventDiscriminators,
                fields,
                getImportFrom,
                importPrefix: 'generatedEvents',
                prefix: event.name,
                typeManifestVisitor,
            });
            const perEventConstantDiscs = perEventDiscriminators
                .filter(isNodeFilter('constantDiscriminatorNode'))
                .map(d => ({
                    name: snakeCase(constantDiscriminatorName(event.name, d, perEventDiscriminators)).toUpperCase(),
                    offset: d.offset,
                    size: constantDiscriminatorSize(d),
                }));

            let conditions: string[];
            let hiddenPrefixSkipResult: SkipExpr | null;
            if (isCpiFramed && framingConstantName) {
                conditions = [
                    renderByteCheck(framingConstantName, programEventFraming!.constant.type, 0),
                    ...perEventConditions,
                ];
                const allConstantDiscs = [
                    {
                        name: framingConstantName,
                        offset: 0,
                        size: renderConstantBytesArray(programEventFraming!.constant)?.len ?? null,
                    },
                    ...perEventConstantDiscs,
                ];
                hiddenPrefixSkipResult = getCpiFramedSkip(allConstantDiscs);
            } else {
                conditions = perEventConditions;
                hiddenPrefixSkipResult = isNode(event.data, 'hiddenPrefixTypeNode')
                    ? getHiddenPrefixSkip(event)
                    : NO_SKIP;
            }

            if (hiddenPrefixSkipResult === null || conditions.length === 0) {
                return [];
            }

            imports.mergeWith(condImports);
            return [{ ...event, conditions, hiddenPrefixSkip: hiddenPrefixSkipResult }];
        });

    if (eventsWithDiscriminators.length === 0) {
        return null;
    }

    imports.add('borsh::BorshDeserialize');
    eventsWithDiscriminators.forEach(event => {
        imports.add(`generatedEvents::${pascalCase(event.name)}`);
    });

    const anyCpiFramed = eventsWithDiscriminators.some(event => isEventCpiFramed(event, programEventFraming));
    const eventFramingBytes =
        anyCpiFramed && programEventFraming !== undefined
            ? renderConstantBytesArray(programEventFraming.constant)
            : null;

    return {
        content: render('programEventsPage.njk', {
            eventFramingBytes,
            eventFramingName: anyCpiFramed ? framingConstantName : null,
            eventsWithDiscriminators,
            imports: imports.toString(dependencyMap),
            program: programNode,
        }),
        imports,
    };
}

/**
 * Linked PDAs whose every use-site passes a dynamic programId. Their helpers
 * take the deriving program as a parameter (unless pinned to a foreign address).
 */
function getDynamicProgramOnlyPdas(program: ProgramNode): Set<string> {
    const allUsagesDynamic = new Map<string, boolean>();
    for (const instruction of getAllInstructionsWithSubs(program, { leavesOnly: false })) {
        for (const account of instruction.accounts) {
            const defaultValue = account.defaultValue;
            if (!defaultValue || !isNode(defaultValue, 'pdaValueNode')) continue;
            if (!isNode(defaultValue.pda, 'pdaLinkNode')) continue;
            const name = defaultValue.pda.name as string;
            allUsagesDynamic.set(name, (allUsagesDynamic.get(name) ?? true) && defaultValue.programId != null);
        }
    }
    return new Set([...allUsagesDynamic.entries()].filter(([, allDynamic]) => allDynamic).map(([name]) => name));
}

/**
 * Renders a constant PDA seed as a raw byte-slice expression suitable for
 * `find_program_address(&[...])`: `b"…"` for strings, `&[…]` for bytes, and
 * `&N.to_le_bytes()`-style for typed values. Shared by the PDA-helper pages
 * and the inline instruction-builder derivations.
 */
function renderConstantSeedBytes(
    seed: ConstantPdaSeedNode,
    getImportFrom: GetImportFromFunction,
): { imports: ImportMap; render: string } {
    if (isNode(seed.value, 'programIdValueNode')) {
        // The program reference is context-dependent; callers render it themselves.
        throw new Error('programIdValueNode seeds must be rendered by the caller.');
    }
    if (isNode(seed.value, 'stringValueNode')) {
        const m = renderValueNode(seed.value, getImportFrom, true);
        return { imports: m.imports, render: `b${m.render}` };
    }
    if (isNode(seed.value, 'bytesValueNode')) {
        const m = renderValueNode(seed.value, getImportFrom, true);
        return { imports: m.imports, render: `&${m.render}` };
    }
    if (isNode(seed.value, 'publicKeyValueNode')) {
        // Codama folds address-pinned program accounts used as seeds into
        // constant publicKey seeds; emit the decoded 32 bytes.
        const bytes = getBase58Encoder().encode(seed.value.publicKey);
        return { imports: new ImportMap(), render: `&[${Array.from(bytes).join(', ')}]` };
    }
    const m = renderValueNode(constantValueNode(seed.type, seed.value), getImportFrom, true);
    return { imports: m.imports, render: `&${m.render}` };
}

function getConflictsForInstructionAccountsAndArgs(instruction: InstructionNode): string[] {
    const allNames = [
        ...instruction.accounts.map(account => account.name),
        ...getAllInstructionArguments(instruction).map(argument => argument.name),
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
    /**
     * True when the helper call needs a runtime program argument, i.e. the
     * deriving program is dynamic and not address-pinned (pinned ones are baked in).
     */
    hasDynamicProgram: boolean;
    hasVariableSeeds: boolean;
    isLinked: boolean;
    linkedPdaName?: string;
    programAddressExpr: string;
    renderedSeeds: RenderedSeed[];
};

type ResolvedAccount = InstructionAccountNode & {
    pdaDefault: ResolvedPdaDefault | null;
};

function resolveInstructionPdaDefaults(ctx: {
    accountsAndArgsConflicts: string[];
    builderOptionalAccounts: Set<string>;
    getImportFrom: GetImportFromFunction;
    imports: ImportMap;
    instruction: InstructionNode;
    linkables: LinkableDictionary;
    orderedAccountNames: string[];
    program: ProgramNode;
    requiredArgNames: string[];
    stack: NodeStack;
}): ResolvedAccount[] {
    const {
        accountsAndArgsConflicts,
        builderOptionalAccounts,
        getImportFrom,
        imports,
        instruction,
        linkables,
        orderedAccountNames,
        program,
        requiredArgNames,
        stack,
    } = ctx;

    const accounts = instruction.accounts;
    // Includes extraArguments — Anchor lowers account-data seeds (e.g. `guard.mint`)
    // to caller-supplied extra arguments.
    const instructionArguments = getAllInstructionArguments(instruction);
    const instructionName = instruction.name;
    const localProgramIdExpr = `crate::${snakeCase(program.name).toUpperCase()}_ID`;
    // PDAs whose helpers require the deriving program as a parameter.
    const dynamicOnlyPdas = getDynamicProgramOnlyPdas(program);

    // Cast to string to avoid branded CamelCaseString type.
    const pdaDefaultedNames = new Set<string>(
        accounts.filter(a => a.defaultValue?.kind === 'pdaValueNode').map(a => a.name as string),
    );

    // Nested argument paths (e.g. `guard.mint`) have no builder field to read from.
    const assertNoArgumentPath = (ref: { name: string; path?: readonly string[] }, accountName: string) => {
        if (ref.path && ref.path.length > 0) {
            throw new Error(
                `[Rust] Account [${accountName}] of instruction [${instructionName}] references nested ` +
                    `argument path [${ref.name}.${ref.path.join('.')}], which the Rust renderer does not support.`,
            );
        }
    };

    // Renders the builder expression for the account/argument reference used as a
    // PDA's dynamic deriving program.
    const renderProgramRefExpr = (ref: NonNullable<PdaValueNode['programId']>, accountName: string): string => {
        if (isNode(ref, 'accountValueNode')) {
            const refName = snakeCase(ref.name);
            if (pdaDefaultedNames.has(ref.name)) {
                // Previously derived in the builder; visitor ordering guarantees it.
                return refName;
            }
            const refAccount = accounts.find(a => a.name === ref.name);
            const isEither = refAccount?.isSigner === 'either';
            const isOptional = builderOptionalAccounts.has(ref.name);
            const eitherExtract = isEither ? (isOptional ? '.map(|(k, _)| k)' : '.0') : '';
            if (!isOptional) {
                return `self.${refName}${eitherExtract}`;
            }
            if (refAccount?.defaultValue && isNode(refAccount.defaultValue, 'publicKeyValueNode')) {
                return `self.${refName}${eitherExtract}.unwrap_or(solana_address::address!("${refAccount.defaultValue.publicKey}"))`;
            }
            if (refAccount?.defaultValue && isNode(refAccount.defaultValue, 'programIdValueNode')) {
                return `self.${refName}${eitherExtract}.unwrap_or(${localProgramIdExpr})`;
            }
            return `self.${refName}${eitherExtract}.expect("${refName} is needed for ${snakeCase(accountName)} PDA")`;
        }
        assertNoArgumentPath(ref, accountName);
        const argFieldName = accountsAndArgsConflicts.includes(ref.name) ? `${ref.name}_arg` : ref.name;
        const fieldName = snakeCase(argFieldName);
        if (requiredArgNames.includes(fieldName)) {
            return `self.${fieldName}`;
        }
        return `self.${fieldName}.clone().expect("${fieldName} is needed for ${snakeCase(accountName)} PDA")`;
    };

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

        // Dynamic programId: render as linked only when the PDA's helper takes a
        // program parameter (dynamic-only); mixed-use PDAs fall back to inline.
        const dynamicProgramRef = defaultValue.programId;
        const renderAsLinked =
            isLinked && (!dynamicProgramRef || (linkedPdaName !== undefined && dynamicOnlyPdas.has(linkedPdaName)));

        // Program priority mirrors codama resolve-pda-address.ts:
        // dynamic runtime ref > pdaNode constant > local program ID.
        let programAddressExpr: string;
        if (dynamicProgramRef) {
            programAddressExpr = renderProgramRefExpr(dynamicProgramRef, account.name);
        } else if (pdaNode?.programId) {
            programAddressExpr = `solana_address::address!("${pdaNode.programId}")`;
        } else {
            programAddressExpr = localProgramIdExpr;
        }

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
                    accountDefaults[refName] = localProgramIdExpr;
                }
                if (refAccount?.isSigner === 'either') {
                    eitherSignerAccounts.add(refName);
                }
            }
        }

        const renderedSeeds: RenderedSeed[] = [];

        // Two rendering paths because extractPdasVisitor only extracts same-program
        // PDAs — cross-program derivations (e.g. ATAs via the associated-token-program)
        // stay inline as pdaNode since they can't live in this program's pdas module.
        //
        // Linked (pdaLinkNode): call find_*_pda() with typed args (and the program
        //                       when the helper takes one).
        // Inline (pdaNode):     emit find_program_address() with raw byte-slice seeds.
        if (renderAsLinked) {
            for (const seedBinding of defaultValue.seeds) {
                const seedValue = seedBinding.value;

                if (isNode(seedValue, 'accountValueNode')) {
                    const refName = snakeCase(seedValue.name);
                    const isEither = eitherSignerAccounts.has(seedValue.name);
                    const isOptional = builderOptionalAccounts.has(seedValue.name);
                    const eitherExtract = isEither ? (isOptional ? '.map(|(k, _)| k)' : '.0') : '';

                    if (pdaDefaultedNames.has(seedValue.name)) {
                        renderedSeeds.push({ kind: 'accountRef', rawName: refName, render: `&${refName}` });
                    } else if (!isOptional) {
                        // Required account — direct field access, no Option unwrap.
                        renderedSeeds.push({
                            kind: 'accountRef',
                            rawName: refName,
                            render: `&self.${refName}${eitherExtract}`,
                        });
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
                    assertNoArgumentPath(seedValue, account.name);
                    const argFieldName = accountsAndArgsConflicts.includes(seedValue.name)
                        ? `${seedValue.name}_arg`
                        : seedValue.name;
                    const fieldName = snakeCase(argFieldName);
                    const isRequiredArg = requiredArgNames.includes(fieldName);

                    const arg = instructionArguments.find(a => a.name === seedValue.name);
                    if (!arg) {
                        // The native visitor validates seed dependencies upfront, so this is
                        // unreachable for well-formed IDLs.
                        throw new Error(
                            `[Rust] Seed argument [${seedValue.name}] for account [${account.name}] in ` +
                                `instruction [${instructionName}] does not match any instruction argument.`,
                        );
                    }
                    let argDefault: { isOmitted: boolean; value: string } | null = null;
                    if (arg.defaultValue && isNode(arg.defaultValue, VALUE_NODES)) {
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
                    } else if (isRequiredArg) {
                        // Required arg — direct field access, no Option unwrap.
                        renderedSeeds.push({
                            kind: 'argumentRef',
                            render: `${isByRef ? '&' : ''}self.${fieldName}.clone()`,
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
            if (!pdaNode) {
                throw new Error(
                    `[Rust] Could not resolve PDA node for account [${account.name}] ` +
                        `in instruction [${instructionName}].`,
                );
            }
            for (const seed of pdaNode.seeds) {
                if (isNode(seed, 'constantPdaSeedNode')) {
                    if (isNode(seed.value, 'programIdValueNode')) {
                        // The deriving program doubles as a seed; honor the runtime ref.
                        const programSeedExpr = dynamicProgramRef ? programAddressExpr : localProgramIdExpr;
                        renderedSeeds.push({
                            kind: 'programId',
                            render: `${programSeedExpr}.as_ref()`,
                        });
                    } else {
                        const seedBytes = renderConstantSeedBytes(seed, getImportFrom);
                        imports.mergeWith(seedBytes.imports);
                        renderedSeeds.push({ kind: 'constant', render: seedBytes.render });
                    }
                    continue;
                }

                if (!isNode(seed, 'variablePdaSeedNode')) continue;

                const binding = defaultValue.seeds.find(s => s.name === seed.name);
                if (!binding) {
                    throw new Error(
                        `[Rust] Missing seed value for variable seed [${seed.name}] in PDA default ` +
                            `for account [${account.name}] of instruction [${instructionName}].`,
                    );
                }

                const resolvedType = resolveNestedTypeNode(seed.type);
                const seedValue = binding.value;

                if (isNode(seedValue, 'accountValueNode')) {
                    const refName = snakeCase(seedValue.name);
                    const isEither = eitherSignerAccounts.has(seedValue.name);
                    const isOptional = builderOptionalAccounts.has(seedValue.name);
                    const eitherExtract = isEither ? (isOptional ? '.map(|(k, _)| k)' : '.0') : '';
                    const defaultExpr = accountDefaults[seedValue.name];

                    let valueExpr: string;
                    if (pdaDefaultedNames.has(seedValue.name)) {
                        valueExpr = refName;
                    } else if (!isOptional) {
                        // Required account — direct field access.
                        valueExpr = `self.${refName}${eitherExtract}`;
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
                    assertNoArgumentPath(seedValue, account.name);
                    const argFieldName = accountsAndArgsConflicts.includes(seedValue.name)
                        ? `${seedValue.name}_arg`
                        : seedValue.name;
                    const fieldName = snakeCase(argFieldName);
                    const isRequiredArg = requiredArgNames.includes(fieldName);

                    const arg = instructionArguments.find(a => a.name === seedValue.name);
                    if (!arg) {
                        // The native visitor validates seed dependencies upfront, so this is
                        // unreachable for well-formed IDLs.
                        throw new Error(
                            `[Rust] Seed argument [${seedValue.name}] for account [${account.name}] in ` +
                                `instruction [${instructionName}] does not match any instruction argument.`,
                        );
                    }
                    let argDefault: { isOmitted: boolean; value: string } | null = null;
                    if (arg.defaultValue && isNode(arg.defaultValue, VALUE_NODES)) {
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
                    } else if (isRequiredArg) {
                        // Required arg — direct field access, no Option unwrap.
                        const valueExpr = `self.${fieldName}.clone()`;
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

        const pdaHasVariableSeeds = pdaNode ? pdaNode.seeds.some(s => isNode(s, 'variablePdaSeedNode')) : true;

        // Pinned programs (pdaNode.programId) are baked into the generated
        // helpers and _ADDRESS constant, so the builder passes no program arg.
        const pinnedProgram =
            renderAsLinked && pdaNode?.programId && pdaNode.programId !== program.publicKey
                ? pdaNode.programId
                : undefined;

        resolvedPdas[account.name] = {
            hasDynamicProgram: !!dynamicProgramRef && !pinnedProgram,
            hasVariableSeeds: pdaHasVariableSeeds,
            isLinked: renderAsLinked,
            linkedPdaName,
            programAddressExpr,
            renderedSeeds,
        };
    }

    // Inputs are already validated and dependency-ordered; emit builder `let`
    // bindings in that order so derived PDAs can feed later derivations.
    const accountsByName = new Map(accounts.map(a => [a.name as string, a]));
    return orderedAccountNames.map(name => {
        const account = accountsByName.get(name)!;
        return { ...account, pdaDefault: resolvedPdas[name] ?? null };
    });
}
