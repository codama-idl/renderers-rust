import {
    AccountNode,
    assertIsNode,
    camelCase,
    DefinedTypeNode,
    InstructionNode,
    isNode,
    isScalarEnum,
} from '@codama/nodes';

import { ImportMap } from '../ImportMap';

export type TraitOptions = {
    /** The default traits to implement for all types. */
    baseDefaults?: string[];
    /**
     * The default traits to implement for data enums only — on top of the base defaults.
     * Data enums are enums with at least one non-unit variant.
     */
    dataEnumDefaults?: string[];
    /**
     * The mapping of feature flags to traits.
     * For each entry, the traits will be rendered within a
     * `#[cfg_attr(feature = "feature_name", derive(Traits))]` attribute.
     */
    featureFlags?: Record<string, string[]>;
    /** The complete trait overrides of specific types. */
    overrides?: Record<string, string[]>;
    /**
     * The default traits to implement for scalar enums only — on top of the base defaults.
     * Scalar enums are enums with no variants or only unit variants.
     */
    scalarEnumDefaults?: string[];
    /** The default traits to implement for structs only — on top of the base defaults. */
    structDefaults?: string[];
    /** Whether or not to use the fully qualified name for traits, instead of importing them. */
    useFullyQualifiedName?: boolean;
};

export const DEFAULT_TRAIT_OPTIONS: Required<TraitOptions> = {
    baseDefaults: ['borsh::BorshSerialize', 'borsh::BorshDeserialize', 'Clone', 'Debug', 'Eq', 'PartialEq'],
    dataEnumDefaults: [],
    featureFlags: {},
    overrides: {},
    scalarEnumDefaults: ['Copy', 'PartialOrd', 'Hash', 'num_derive::FromPrimitive'],
    structDefaults: [],
    useFullyQualifiedName: false,
};

export type GetTraitsFromNodeFunction = (node: AccountNode | DefinedTypeNode | InstructionNode) => {
    imports: ImportMap;
    render: string;
};

export function getTraitsFromNodeFactory(options: TraitOptions = {}): GetTraitsFromNodeFunction {
    return node => getTraitsFromNode(node, options);
}

export function getTraitsFromNode(
    node: AccountNode | DefinedTypeNode | InstructionNode,
    userOptions: TraitOptions = {},
): { imports: ImportMap; render: string } {
    assertIsNode(node, ['accountNode', 'definedTypeNode', 'instructionNode']);
    const options: Required<TraitOptions> = { ...DEFAULT_TRAIT_OPTIONS, ...userOptions };

    // Get the node type and return early if it's a type alias.
    const nodeType = getNodeType(node);
    if (nodeType === 'alias') {
        return { imports: new ImportMap(), render: '' };
    }

    // Find all the FQN traits for the node.
    const sanitizedOverrides = Object.fromEntries(
        Object.entries(options.overrides).map(([key, value]) => [camelCase(key), value]),
    );
    const nodeOverrides: string[] | undefined = sanitizedOverrides[node.name];
    const allTraits = nodeOverrides === undefined ? getDefaultTraits(nodeType, options) : nodeOverrides;

    // Wrap the traits in feature flags if necessary.
    const partitionedTraits = partitionTraitsInFeatures(allTraits, options.featureFlags);
    let unfeaturedTraits = partitionedTraits[0];
    const featuredTraits = partitionedTraits[1];

    // Import the traits if necessary.
    const imports = new ImportMap();
    if (!options.useFullyQualifiedName) {
        unfeaturedTraits = extractFullyQualifiedNames(unfeaturedTraits, imports);
    }

    // Render the trait lines.
    const traitLines: string[] = [
        ...(unfeaturedTraits.length > 0 ? [`#[derive(${unfeaturedTraits.join(', ')})]\n`] : []),
        ...Object.entries(featuredTraits).map(([feature, traits]) => {
            return `#[cfg_attr(feature = "${feature}", derive(${traits.join(', ')}))]\n`;
        }),
    ];

    // Add serde rename_all = "camelCase" container attribute for structs only.
    // Enums keep PascalCase variant names to match the JS SDK.
    const { featureName, hasSerde } = findSerdeFeature(allTraits, options.featureFlags);
    if (hasSerde && nodeType === 'struct') {
        if (featureName) {
            traitLines.push(`#[cfg_attr(feature = "${featureName}", serde(rename_all = "camelCase"))]\n`);
        } else {
            traitLines.push(`#[serde(rename_all = "camelCase")]\n`);
        }
    }

    return { imports, render: traitLines.join('') };
}

function getNodeType(
    node: AccountNode | DefinedTypeNode | InstructionNode,
): 'alias' | 'dataEnum' | 'scalarEnum' | 'struct' {
    if (isNode(node, ['accountNode', 'instructionNode'])) return 'struct';
    if (isNode(node.type, 'structTypeNode')) return 'struct';
    if (isNode(node.type, 'enumTypeNode')) {
        return isScalarEnum(node.type) ? 'scalarEnum' : 'dataEnum';
    }
    return 'alias';
}

function getDefaultTraits(
    nodeType: 'dataEnum' | 'scalarEnum' | 'struct',
    options: Pick<
        Required<TraitOptions>,
        'baseDefaults' | 'dataEnumDefaults' | 'scalarEnumDefaults' | 'structDefaults'
    >,
): string[] {
    switch (nodeType) {
        case 'dataEnum':
            return [...options.baseDefaults, ...options.dataEnumDefaults];
        case 'scalarEnum':
            return [...options.baseDefaults, ...options.scalarEnumDefaults];
        case 'struct':
            return [...options.baseDefaults, ...options.structDefaults];
    }
}

function partitionTraitsInFeatures(
    traits: string[],
    featureFlags: Record<string, string[]>,
): [string[], Record<string, string[]>] {
    // Reverse the feature flags option for quick lookup.
    // If there are any duplicate traits, the first one encountered will be used.
    const reverseFeatureFlags = Object.entries(featureFlags).reduce(
        (acc, [feature, traits]) => {
            for (const trait of traits) {
                if (!acc[trait]) acc[trait] = feature;
            }
            return acc;
        },
        {} as Record<string, string>,
    );

    const unfeaturedTraits: string[] = [];
    const featuredTraits: Record<string, string[]> = {};
    const seenTraits = new Set<string>();

    for (const trait of traits) {
        seenTraits.add(trait);
        const feature: string | undefined = reverseFeatureFlags[trait];
        if (feature === undefined) {
            unfeaturedTraits.push(trait);
        } else {
            if (!featuredTraits[feature]) featuredTraits[feature] = [];
            featuredTraits[feature].push(trait);
        }
    }

    // Inject feature-flagged traits that weren't already in the defaults/overrides.
    for (const [feature, flaggedTraits] of Object.entries(featureFlags)) {
        for (const trait of flaggedTraits) {
            if (!seenTraits.has(trait)) {
                if (!featuredTraits[feature]) featuredTraits[feature] = [];
                featuredTraits[feature].push(trait);
            }
        }
    }

    return [unfeaturedTraits, featuredTraits];
}

function extractFullyQualifiedNames(traits: string[], imports: ImportMap): string[] {
    return traits.map(trait => {
        const index = trait.lastIndexOf('::');
        if (index === -1) return trait;
        imports.add(trait);
        return trait.slice(index + 2);
    });
}

/**
 * Determines whether serde traits are present and which feature flag (if any) they are behind.
 */
function findSerdeFeature(
    allTraits: string[],
    featureFlags: Record<string, string[]>,
): { featureName: string | undefined; hasSerde: boolean } {
    const allTraitsAndFeatured = [...allTraits, ...Object.values(featureFlags).flat()];
    const hasSerde = allTraitsAndFeatured.some(
        t => t === 'serde::Serialize' || t === 'Serialize' || t === 'serde::Deserialize' || t === 'Deserialize',
    );

    if (!hasSerde) {
        return { featureName: undefined, hasSerde: false };
    }

    const partitioned = partitionTraitsInFeatures(allTraits, featureFlags);
    const featured = partitioned[1];

    let featureName: string | undefined;
    for (const [feature, traits] of Object.entries(featured)) {
        if (
            traits.some(
                t => t === 'serde::Serialize' || t === 'serde::Deserialize' || t === 'Serialize' || t === 'Deserialize',
            )
        ) {
            featureName = feature;
            break;
        }
    }

    return { featureName, hasSerde: true };
}

/**
 * Helper function to get the serde field attribute format based on trait configuration.
 * Returns the appropriate attribute string for serde field customization, or empty string if no serde traits.
 */
export function getSerdeFieldAttribute(
    serdeWith: string,
    node: AccountNode | DefinedTypeNode | InstructionNode,
    userOptions: TraitOptions = {},
): string {
    assertIsNode(node, ['accountNode', 'definedTypeNode', 'instructionNode']);
    const options: Required<TraitOptions> = { ...DEFAULT_TRAIT_OPTIONS, ...userOptions };

    // Get the node type and return early if it's a type alias.
    const nodeType = getNodeType(node);
    if (nodeType === 'alias') {
        return '';
    }

    // Find all the traits for the node.
    const sanitizedOverrides = Object.fromEntries(
        Object.entries(options.overrides).map(([key, value]) => [camelCase(key), value]),
    );
    const nodeOverrides: string[] | undefined = sanitizedOverrides[node.name];
    const allTraits = nodeOverrides === undefined ? getDefaultTraits(nodeType, options) : nodeOverrides;

    const { featureName, hasSerde } = findSerdeFeature(allTraits, options.featureFlags);
    if (!hasSerde) {
        return '';
    }

    if (featureName) {
        return `#[cfg_attr(feature = "${featureName}", serde(with = "${serdeWith}"))]\n`;
    } else {
        return `#[serde(with = "${serdeWith}")]\n`;
    }
}
