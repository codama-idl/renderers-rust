import {
    camelCase,
    ConstantDiscriminatorNode,
    DiscriminatorNode,
    FieldDiscriminatorNode,
    InstructionArgumentNode,
    isNode,
    isNodeFilter,
    SizeDiscriminatorNode,
    snakeCase,
    StructFieldTypeNode,
    VALUE_NODES,
} from '@codama/nodes';
import { visit } from '@codama/visitors-core';

import { getTypeManifestVisitor, TypeManifest } from '../getTypeManifestVisitor';
import { ImportMap } from '../ImportMap';
import { renderValueNode } from '../renderValueNodeVisitor';
import { GetImportFromFunction } from './linkOverrides';

type Fragment = { imports: ImportMap; render: string };

function mergeFragments(fragments: Fragment[], merge: (parts: string[]) => string): Fragment {
    const imports = fragments.reduce((acc, frag) => acc.mergeWith(frag.imports), new ImportMap());
    const render = merge(fragments.map(frag => frag.render));
    return { imports, render };
}

export function getDiscriminatorConstants(scope: {
    discriminatorNodes: DiscriminatorNode[];
    fields: InstructionArgumentNode[] | StructFieldTypeNode[];
    getImportFrom: GetImportFromFunction;
    prefix: string;
    typeManifestVisitor: ReturnType<typeof getTypeManifestVisitor>;
}): Fragment {
    const fragments = scope.discriminatorNodes
        .map(node => getDiscriminatorConstant(node, scope))
        .filter(Boolean) as Fragment[];

    return mergeFragments(fragments, r => r.join('\n\n'));
}

function getDiscriminatorConstant(
    discriminatorNode: DiscriminatorNode,
    scope: {
        discriminatorNodes: DiscriminatorNode[];
        fields: InstructionArgumentNode[] | StructFieldTypeNode[];
        getImportFrom: GetImportFromFunction;
        prefix: string;
        typeManifestVisitor: ReturnType<typeof getTypeManifestVisitor>;
    },
) {
    switch (discriminatorNode.kind) {
        case 'constantDiscriminatorNode':
            return getConstantDiscriminatorConstant(discriminatorNode, scope);
        case 'fieldDiscriminatorNode':
            return getFieldDiscriminatorConstant(discriminatorNode, scope);
        default:
            return null;
    }
}

function getConstantDiscriminatorConstant(
    discriminatorNode: ConstantDiscriminatorNode,
    scope: {
        discriminatorNodes: DiscriminatorNode[];
        getImportFrom: GetImportFromFunction;
        prefix: string;
        typeManifestVisitor: ReturnType<typeof getTypeManifestVisitor>;
    },
): Fragment {
    const { discriminatorNodes, getImportFrom, prefix, typeManifestVisitor } = scope;

    const name = constantDiscriminatorName(prefix, discriminatorNode, discriminatorNodes);
    const typeManifest = visit(discriminatorNode.constant.type, typeManifestVisitor);
    const value = renderValueNode(discriminatorNode.constant.value, getImportFrom);
    return getConstant(name, typeManifest, value);
}

function getFieldDiscriminatorConstant(
    discriminatorNode: FieldDiscriminatorNode,
    scope: {
        fields: InstructionArgumentNode[] | StructFieldTypeNode[];
        getImportFrom: GetImportFromFunction;
        prefix: string;
        typeManifestVisitor: ReturnType<typeof getTypeManifestVisitor>;
    },
): Fragment | null {
    const { fields, prefix, getImportFrom, typeManifestVisitor } = scope;

    const field = fields.find(f => f.name === discriminatorNode.name);
    if (!field || !field.defaultValue || !isNode(field.defaultValue, VALUE_NODES)) {
        return null;
    }

    const typeManifest = visit(field.type, typeManifestVisitor);
    const value = renderValueNode(field.defaultValue, getImportFrom);
    return getConstant(fieldDiscriminatorName(prefix, discriminatorNode.name), typeManifest, value);
}

function getConstant(name: string, typeManifest: TypeManifest, value: Fragment): Fragment {
    const type: Fragment = { imports: typeManifest.imports, render: typeManifest.type };
    return mergeFragments([type, value], ([t, v]) => `pub const ${snakeCase(name).toUpperCase()}: ${t} = ${v};`);
}

export function constantDiscriminatorName(
    prefix: string,
    discriminatorNode: ConstantDiscriminatorNode,
    discriminatorNodes: DiscriminatorNode[],
): string {
    const index = discriminatorNodes.filter(isNodeFilter('constantDiscriminatorNode')).indexOf(discriminatorNode);
    const suffix = index <= 0 ? '' : `_${index + 1}`;
    return camelCase(`${prefix}_discriminator${suffix}`);
}

function fieldDiscriminatorName(prefix: string, fieldName: string): string {
    return camelCase(`${prefix}_${fieldName}`);
}

export function getDiscriminatorConditions(scope: {
    discriminatorNodes: DiscriminatorNode[];
    fields: InstructionArgumentNode[] | StructFieldTypeNode[];
    getImportFrom: GetImportFromFunction;
    importPrefix: string;
    prefix: string;
    typeManifestVisitor: ReturnType<typeof getTypeManifestVisitor>;
}): { conditions: string[]; imports: ImportMap } {
    const imports = new ImportMap();
    const conditions = scope.discriminatorNodes
        .map(node => getDiscriminatorCondition(node, scope, imports))
        .filter(Boolean) as string[];
    return { conditions, imports };
}

function getDiscriminatorCondition(
    discriminatorNode: DiscriminatorNode,
    scope: {
        discriminatorNodes: DiscriminatorNode[];
        fields: InstructionArgumentNode[] | StructFieldTypeNode[];
        getImportFrom: GetImportFromFunction;
        importPrefix: string;
        prefix: string;
        typeManifestVisitor: ReturnType<typeof getTypeManifestVisitor>;
    },
    imports: ImportMap,
): string | null {
    switch (discriminatorNode.kind) {
        case 'sizeDiscriminatorNode':
            return getSizeCondition(discriminatorNode);
        case 'constantDiscriminatorNode':
            return getConstantCondition(discriminatorNode, scope, imports);
        case 'fieldDiscriminatorNode':
            return getFieldCondition(discriminatorNode, scope, imports);
        default:
            return null;
    }
}

function getSizeCondition(discriminatorNode: SizeDiscriminatorNode): string {
    return `data.len() == ${discriminatorNode.size}`;
}

function getConstantCondition(
    discriminatorNode: ConstantDiscriminatorNode,
    scope: {
        discriminatorNodes: DiscriminatorNode[];
        importPrefix: string;
        prefix: string;
    },
    imports: ImportMap,
): string {
    const { discriminatorNodes, importPrefix, prefix } = scope;
    const constName = snakeCase(constantDiscriminatorName(prefix, discriminatorNode, discriminatorNodes)).toUpperCase();
    imports.add(`${importPrefix}::${constName}`);

    const offset = discriminatorNode.offset;
    if (offset === 0) {
        return `data.get(..${constName}.len()) == Some(&${constName}[..])`;
    }
    return `data.get(${offset}..${offset} + ${constName}.len()) == Some(&${constName}[..])`;
}

function getFieldCondition(
    discriminatorNode: FieldDiscriminatorNode,
    scope: {
        fields: InstructionArgumentNode[] | StructFieldTypeNode[];
        importPrefix: string;
        prefix: string;
    },
    imports: ImportMap,
): string | null {
    const { fields, importPrefix, prefix } = scope;
    const field = fields.find(f => f.name === discriminatorNode.name);
    if (!field || !field.defaultValue || !isNode(field.defaultValue, VALUE_NODES)) {
        return null;
    }

    const constName = snakeCase(fieldDiscriminatorName(prefix, discriminatorNode.name)).toUpperCase();
    imports.add(`${importPrefix}::${constName}`);
    const offset = discriminatorNode.offset;

    if (isNode(field.type, 'numberTypeNode')) {
        const byteSize = getNumberByteSize(field.type.format);
        const bytesFn = field.type.endian === 'le' ? 'to_le_bytes' : 'to_be_bytes';
        const range = offset === 0 ? `..${byteSize}` : `${offset}..${offset + byteSize}`;
        return `data.get(${range}) == Some(&${constName}.${bytesFn}())`;
    }

    if (offset === 0) {
        return `data.get(..${constName}.len()) == Some(&${constName}[..])`;
    }
    return `data.get(${offset}..${offset} + ${constName}.len()) == Some(&${constName}[..])`;
}

const NUMBER_BYTE_SIZES: Record<string, number> = {
    f32: 4,
    f64: 8,
    i128: 16,
    i16: 2,
    i32: 4,
    i64: 8,
    i8: 1,
    u128: 16,
    u16: 2,
    u32: 4,
    u64: 8,
    u8: 1,
};

function getNumberByteSize(format: string): number {
    const size = NUMBER_BYTE_SIZES[format];
    if (size === undefined) {
        throw new Error(`Unknown number format: ${format}`);
    }
    return size;
}
