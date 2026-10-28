// Generates lib/src/generated/models.g.dart from data/schema/v1/*.schema.json.
//
//   dart run tool/generate_models.dart          # rewrite the generated file
//   dart run tool/generate_models.dart --check  # exit 1 if it is out of date
//
// Supports exactly the JSON Schema subset the v1 schemas use: objects with
// properties/required, const, enum, primitive and nullable types, arrays,
// local $ref into $defs, and oneOf/anyOf unions. Anything else is a hard
// error, so a schema change that the generator can't express is noticed
// instead of silently mis-generated.
import 'dart:convert';
import 'dart:io';

/// Schema file (in data/schema/v1) -> Dart name of its root type.
const schemaRoots = {
  'catalog.schema.json': 'Catalog',
  'chapter.schema.json': 'Chapter',
  'index.schema.json': 'IndexListing',
  'alignment.schema.json': 'Alignment',
  'transcript.schema.json': 'Transcript',
};

/// Derived names that read badly are renamed here.
const nameOverrides = {
  'CatalogSectionItem': 'CatalogItem',
  'CatalogLectureMediaType': 'MediaType',
  'TextNodeChildren': 'TextNodeChild',
  'ChapterTextNode': 'TextNode',
  'ChapterLine': 'TextLine',
};

const outputPath = 'lib/src/generated/models.g.dart';

final packageDir = File.fromUri(Platform.script).parent.parent;
final schemaDir = Directory('${packageDir.path}/../../data/schema/v1').absolute;

Future<void> main(List<String> args) async {
  final check = args.contains('--check');
  final source = generate();
  final target = File('${packageDir.path}/$outputPath');

  final tmpDir = await Directory.systemTemp.createTemp('shd_gen');
  try {
    final tmp = File('${tmpDir.path}/models.g.dart');
    await tmp.writeAsString(source);
    final fmt = await Process.run(Platform.resolvedExecutable, [
      'format',
      tmp.path,
    ]);
    if (fmt.exitCode != 0) {
      stderr.writeln('dart format failed:\n${fmt.stdout}\n${fmt.stderr}');
      exit(2);
    }
    final formatted = await tmp.readAsString();
    if (check) {
      final current = target.existsSync() ? target.readAsStringSync() : '';
      if (current != formatted) {
        stderr.writeln(
          '$outputPath is out of date with data/schema/v1. '
          'Run: dart run tool/generate_models.dart',
        );
        exit(1);
      }
      stdout.writeln('$outputPath is up to date.');
    } else {
      await target.parent.create(recursive: true);
      await target.writeAsString(formatted);
      stdout.writeln('Wrote $outputPath');
    }
  } finally {
    await tmpDir.delete(recursive: true);
  }
}

// ---------------------------------------------------------------------------
// Intermediate representation
// ---------------------------------------------------------------------------

sealed class DType {
  const DType();
}

class PrimType extends DType {
  const PrimType(this.dart);
  final String dart; // String | int | double | bool
}

class NullableType extends DType {
  const NullableType(this.inner);
  final DType inner;
}

class EnumRef extends DType {
  const EnumRef(this.name);
  final String name;
}

class ClassRef extends DType {
  const ClassRef(this.name);
  final String name;
}

class UnionRef extends DType {
  const UnionRef(this.name);
  final String name;
}

class ListType extends DType {
  const ListType(this.item);
  final DType item;
}

class FieldDef {
  FieldDef({
    required this.jsonKey,
    required this.dartName,
    required this.type,
    required this.required,
    required this.description,
    this.constValue,
  });
  final String jsonKey;
  final String dartName;
  final DType type;
  final bool required;
  final String? description;
  final Object? constValue;
  bool get isConst => constValue != null;
}

class ClassDef {
  ClassDef(
    this.name,
    this.description,
    this.fields, {
    this.wrapsString = false,
  });
  final String name;
  final String? description;
  final List<FieldDef> fields;
  final bool wrapsString;
  final List<String> implementsUnions = [];
  String? reservedNote;
}

class EnumDef {
  EnumDef(this.name, this.description, this.values);
  final String name;
  final String? description;
  final List<String> values;
}

class UnionDef {
  UnionDef(this.name, this.description, this.members);
  final String name;
  final String? description;
  final List<String> members; // class names
}

class TypedefDef {
  TypedefDef(this.name, this.description, this.type);
  final String name;
  final String? description;
  final DType type;
}

final classes = <String, ClassDef>{};
final enums = <String, EnumDef>{};
final unions = <String, UnionDef>{};
final typedefs = <TypedefDef>[];

String named(String derived) => nameOverrides[derived] ?? derived;

String cap(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

String singular(String s) => s.endsWith('ies')
    ? '${s.substring(0, s.length - 3)}y'
    : s.endsWith('s')
    ? s.substring(0, s.length - 1)
    : s;

String dartIdent(String key) {
  final cleaned = key.replaceAll(RegExp(r'[^A-Za-z0-9_]'), '');
  return cleaned;
}

String enumValueName(String v) {
  final parts = v
      .split(RegExp(r'[^A-Za-z0-9]+'))
      .where((p) => p.isNotEmpty)
      .toList();
  return parts.first.toLowerCase() + parts.skip(1).map(cap).join();
}

class SchemaFile {
  SchemaFile(this.fileName, this.rootName, this.json);
  final String fileName;
  final String rootName;
  final Map<String, Object?> json;
  Map<String, Object?> get defs =>
      (json[r'$defs'] as Map<String, Object?>?) ?? const {};
  final defClassNames = <String, DType>{};
}

Never unsupported(String where, Object? node) =>
    throw StateError('Unsupported schema construct at $where: $node');

DType resolveRef(SchemaFile file, String ref, String where) {
  const prefix = r'#/$defs/';
  if (!ref.startsWith(prefix)) unsupported(where, ref);
  final key = ref.substring(prefix.length);
  final existing = file.defClassNames[key];
  if (existing != null) return existing;
  final def = file.defs[key] as Map<String, Object?>?;
  if (def == null) unsupported(where, ref);
  final name = named('${file.rootName}${cap(key)}');
  if (def['type'] == 'object') {
    // Register before resolving so recursive refs (TextNode) terminate.
    file.defClassNames[key] = ClassRef(name);
    buildClass(file, name, def, '$where>$key');
    return ClassRef(name);
  }
  final t = resolve(file, def, name, '$where>$key');
  file.defClassNames[key] = t;
  return t;
}

/// Resolves [node] to a Dart type. [hint] names any class/enum/union that
/// has to be created for it.
DType resolve(
  SchemaFile file,
  Map<String, Object?> node,
  String hint,
  String where,
) {
  if (node.containsKey(r'$ref')) {
    return resolveRef(file, node[r'$ref'] as String, where);
  }
  if (node.containsKey('enum')) {
    final name = named(hint);
    enums[name] = EnumDef(
      name,
      node['description'] as String?,
      (node['enum'] as List).cast<String>(),
    );
    return EnumRef(name);
  }
  final union = node['oneOf'] ?? node['anyOf'];
  if (union != null) {
    final name = named(hint);
    final members = <String>[];
    for (final m in (union as List).cast<Map<String, Object?>>()) {
      if (m['type'] == 'string' && m.length == 1) {
        final wrapName = named('${name}String');
        classes[wrapName] =
            ClassDef(wrapName, 'A plain text item of [$name].', [
              FieldDef(
                jsonKey: '',
                dartName: 'text',
                type: const PrimType('String'),
                required: true,
                description: null,
              ),
            ], wrapsString: true);
        members.add(wrapName);
        continue;
      }
      final t = resolve(file, m, '$name${members.length}', '$where|');
      if (t is! ClassRef) unsupported(where, m);
      members.add(t.name);
    }
    unions[name] = UnionDef(name, node['description'] as String?, members);
    for (final m in members) {
      classes[m]?.implementsUnions.add(name);
    }
    return UnionRef(name);
  }
  final type = node['type'];
  if (type is List) {
    final nonNull = type.where((t) => t != 'null').toList();
    if (nonNull.length != 1 || type.length != 2) unsupported(where, node);
    final inner = resolve(file, {...node, 'type': nonNull.single}, hint, where);
    return NullableType(inner);
  }
  switch (type) {
    case 'string':
      return const PrimType('String');
    case 'integer':
      return const PrimType('int');
    case 'number':
      return const PrimType('double');
    case 'boolean':
      return const PrimType('bool');
    case 'array':
      final items = node['items'] as Map<String, Object?>?;
      if (items == null) unsupported(where, node);
      return ListType(resolve(file, items, hint, '$where[]'));
    case 'object':
      final name = named(hint);
      buildClass(file, name, node, where);
      return ClassRef(name);
  }
  unsupported(where, node);
}

void buildClass(
  SchemaFile file,
  String name,
  Map<String, Object?> node,
  String where,
) {
  final props = (node['properties'] as Map<String, Object?>?) ?? const {};
  final required = ((node['required'] as List?) ?? const []).cast<String>();
  final fields = <FieldDef>[];
  for (final entry in props.entries) {
    final key = entry.key;
    final prop = entry.value! as Map<String, Object?>;
    final isRequired = required.contains(key);
    String? description = prop['description'] as String?;
    if (prop.containsKey(r'$ref') && description == null) {
      final key2 = (prop[r'$ref'] as String).split('/').last;
      description = (file.defs[key2] as Map?)?['description'] as String?;
    }
    if (prop.containsKey('const')) {
      if (!isRequired) unsupported('$where.$key (optional const)', prop);
      final c = prop['const'];
      fields.add(
        FieldDef(
          jsonKey: key,
          dartName: dartIdent(key),
          type: PrimType(c is int ? 'int' : 'String'),
          required: true,
          description: description,
          constValue: c,
        ),
      );
      continue;
    }
    final isArray = prop['type'] == 'array';
    final hint =
        '$name${cap(isArray ? singular(dartIdent(key)) : dartIdent(key))}';
    final t = resolve(file, prop, hint, '$where.$key');
    fields.add(
      FieldDef(
        jsonKey: key,
        dartName: dartIdent(key),
        type: t,
        required: isRequired,
        description: description,
      ),
    );
  }
  final cls = ClassDef(name, node['description'] as String?, fields);
  classes[name] = cls;
}

void loadSchemas() {
  for (final entry in schemaRoots.entries) {
    final f = File('${schemaDir.path}/${entry.key}');
    final json = jsonDecode(f.readAsStringSync()) as Map<String, Object?>;
    final file = SchemaFile(entry.key, entry.value, json);
    final description = [
      json['title'],
      json['description'],
    ].whereType<String>().join('\n\n');
    final type = json['type'];
    if (type == 'object') {
      buildClass(file, entry.value, json, entry.key);
      classes[entry.value]!.reservedNote = json['x-status'] == 'reserved'
          ? 'RESERVED: no files are published with this shape yet.'
          : null;
      // Root descriptions come from title + description.
      final root = classes[entry.value]!;
      classes[entry.value] = ClassDef(root.name, description, root.fields)
        ..reservedNote = root.reservedNote;
    } else if (type == 'array') {
      final t = resolve(file, json, entry.value, entry.key);
      typedefs.add(TypedefDef(entry.value, description, t));
    } else {
      unsupported(entry.key, type);
    }
  }
  // Re-attach union membership on root classes that were replaced above.
  for (final u in unions.values) {
    for (final m in u.members) {
      final c = classes[m]!;
      if (!c.implementsUnions.contains(u.name)) c.implementsUnions.add(u.name);
    }
  }
}

// ---------------------------------------------------------------------------
// Emitting
// ---------------------------------------------------------------------------

String typeName(DType t) => switch (t) {
  PrimType(:final dart) => dart,
  NullableType(:final inner) => '${typeName(inner)}?',
  EnumRef(:final name) => name,
  ClassRef(:final name) => name,
  UnionRef(:final name) => name,
  ListType(:final item) => 'List<${typeName(item)}>',
};

String decodeExpr(DType t, String v, String ctx) => switch (t) {
  PrimType(dart: 'String') => '_string($v, $ctx)',
  PrimType(dart: 'int') => '_int($v, $ctx)',
  PrimType(dart: 'double') => '_double($v, $ctx)',
  PrimType(dart: 'bool') => '_bool($v, $ctx)',
  PrimType() => throw StateError('prim ${t.dart}'),
  NullableType(:final inner) =>
    '_opt($v, (v) => ${decodeExpr(inner, 'v', ctx)})',
  EnumRef(:final name) => '$name.fromJson($v)',
  ClassRef(:final name) => '$name.fromJson($v)',
  UnionRef(:final name) => '$name.fromJson($v)',
  ListType(:final item) =>
    'List.unmodifiable(_list($v, $ctx).map((e) => ${decodeExpr(item, 'e', ctx)}))',
};

String encodeExpr(DType t, String v) => switch (t) {
  PrimType() => v,
  NullableType(:final inner) =>
    inner is PrimType ? v : '$v?.${encodeExpr(inner, '').substring(1)}',
  EnumRef() => '$v.json',
  ClassRef() || UnionRef() => '$v.toJson()',
  ListType(:final item) => '[for (final e in $v) ${encodeExpr(item, 'e')}]',
};

bool isListType(DType t) =>
    t is ListType || (t is NullableType && t.inner is ListType);

void doc(StringBuffer out, String? text, {String indent = ''}) {
  if (text == null || text.isEmpty) return;
  final safe = text.replaceAllMapped(RegExp(r'<[^<>\n]+>'), (m) => '`${m[0]}`');
  for (final line in const LineSplitter().convert(safe)) {
    out.writeln(line.isEmpty ? '$indent///' : '$indent/// $line');
  }
}

String literal(Object? v) =>
    v is String ? jsonEncode(v).replaceAll(r'$', r'\$') : '$v';

String emit() {
  final out = StringBuffer()
    ..writeln('// GENERATED by tool/generate_models.dart from data/schema/v1.')
    ..writeln('// Do not edit by hand; re-run the generator instead.')
    ..writeln();

  for (final td in typedefs) {
    doc(out, td.description);
    out.writeln('typedef ${td.name} = ${typeName(td.type)};');
    out.writeln();
    final lower = td.name[0].toLowerCase() + td.name.substring(1);
    out
      ..writeln('/// Decodes a [${td.name}] from parsed JSON.')
      ..writeln(
        '${td.name} ${lower}FromJson(Object? json) => '
        '${decodeExpr(td.type, 'json', "'${td.name}'")};',
      )
      ..writeln()
      ..writeln('/// Encodes a [${td.name}] to JSON-compatible values.')
      ..writeln(
        'Object? ${lower}ToJson(${td.name} value) => '
        '${encodeExpr(td.type, 'value')};',
      )
      ..writeln();
  }

  for (final e in enums.values) {
    doc(out, e.description);
    out.writeln('enum ${e.name} {');
    final values = e.values
        .map((v) => '  ${enumValueName(v)}(${literal(v)})')
        .join(',\n');
    out.writeln('$values;');
    out
      ..writeln()
      ..writeln('  const ${e.name}(this.json);')
      ..writeln()
      ..writeln('  /// The value as it appears in JSON.')
      ..writeln('  final String json;')
      ..writeln()
      ..writeln('  static ${e.name} fromJson(Object? json) {')
      ..writeln('    for (final v in values) {')
      ..writeln('      if (v.json == json) return v;')
      ..writeln('    }')
      ..writeln("    throw FormatException('${e.name}: unknown value \$json');")
      ..writeln('  }')
      ..writeln('}')
      ..writeln();
  }

  for (final u in unions.values) {
    final members = u.members.map((m) => classes[m]!).toList();
    // Getters shared (same name and type) by every non-wrapper member.
    final common = <FieldDef>[];
    if (members.every((m) => !m.wrapsString)) {
      for (final f in members.first.fields) {
        if (f.isConst) continue;
        final sameEverywhere = members.every(
          (m) => m.fields.any(
            (g) =>
                g.dartName == f.dartName &&
                !g.isConst &&
                typeName(fieldType(g)) == typeName(fieldType(f)),
          ),
        );
        if (sameEverywhere) common.add(f);
      }
    }
    doc(
      out,
      u.description ?? 'One of: ${u.members.map((m) => '[$m]').join(', ')}.',
    );
    out.writeln('sealed class ${u.name} {');
    out.writeln('  const ${u.name}();');
    out.writeln();
    out.writeln('  factory ${u.name}.fromJson(Object? json) {');
    for (final m in members) {
      if (m.wrapsString) {
        out.writeln('    if (json is String) return ${m.name}(json);');
        continue;
      }
      final disc = m.fields.where((f) => f.isConst && f.jsonKey == 'type');
      if (disc.isNotEmpty) {
        out.writeln(
          "    if (json is Map && json['type'] == ${literal(disc.first.constValue)}) {",
        );
      } else {
        out.writeln('    if (json is Map${keyDiscriminator(u, m)}) {');
      }
      out
        ..writeln('      return ${m.name}.fromJson(json);')
        ..writeln('    }');
    }
    out
      ..writeln(
        "    throw FormatException('${u.name}: unrecognised value \$json');",
      )
      ..writeln('  }')
      ..writeln();
    for (final f in common) {
      doc(out, f.description, indent: '  ');
      out.writeln('  ${typeName(fieldType(f))} get ${f.dartName};');
      out.writeln();
    }
    out
      ..writeln('  /// Encodes this value to JSON-compatible values.')
      ..writeln('  Object? toJson();')
      ..writeln('}')
      ..writeln();
  }

  for (final c in classes.values) {
    emitClass(out, c);
  }

  out.writeln(_helpers);
  return out.toString();
}

/// Without a `type` const, object members of a union are told apart by a
/// required key that no other object member has (e.g. `children` for
/// TextNode). A single object member needs no check.
String keyDiscriminator(UnionDef u, ClassDef m) {
  final others = u.members
      .map((n) => classes[n]!)
      .where((c) => c != m && !c.wrapsString)
      .toList();
  if (others.isEmpty) return '';
  final otherKeys = {
    for (final c in others)
      for (final f in c.fields) f.jsonKey,
  };
  final own = m.fields.where(
    (f) => f.required && !otherKeys.contains(f.jsonKey),
  );
  if (own.isEmpty) {
    unsupported(
      'union ${u.name} member ${m.name}',
      'no distinguishing required key',
    );
  }
  return ' && json.containsKey(${literal(own.first.jsonKey)})';
}

DType fieldType(FieldDef f) =>
    f.required || f.type is NullableType ? f.type : NullableType(f.type);

void emitClass(StringBuffer out, ClassDef c) {
  final impl = c.implementsUnions.isEmpty
      ? ''
      : ' implements ${c.implementsUnions.join(', ')}';
  doc(out, c.description);
  if (c.reservedNote != null) {
    if (c.description != null) out.writeln('///');
    doc(out, c.reservedNote);
  }
  out.writeln('final class ${c.name}$impl {');

  final stored = c.fields.where((f) => !f.isConst).toList();

  if (c.wrapsString) {
    out
      ..writeln('  const ${c.name}(this.text);')
      ..writeln()
      ..writeln(
        '  ${impl.isEmpty ? '' : '@override\n  '}String toJson() => text;',
      )
      ..writeln()
      ..writeln('  final String text;')
      ..writeln()
      ..writeln('  @override')
      ..writeln('  bool operator ==(Object other) =>')
      ..writeln('      other is ${c.name} && other.text == text;')
      ..writeln()
      ..writeln('  @override')
      ..writeln('  int get hashCode => text.hashCode;')
      ..writeln()
      ..writeln('  @override')
      ..writeln("  String toString() => '${c.name}(\$text)';")
      ..writeln('}')
      ..writeln();
    return;
  }

  // Constructor
  if (stored.isEmpty) {
    out.writeln('  const ${c.name}();');
  } else {
    out.writeln('  const ${c.name}({');
    for (final f in stored) {
      final isReq = f.required;
      out.writeln('    ${isReq ? 'required ' : ''}this.${f.dartName},');
    }
    out.writeln('  });');
  }
  out.writeln();

  // fromJson
  out
    ..writeln('  /// Decodes from parsed JSON. Throws [FormatException] when')
    ..writeln(
      '  /// [json] does not match the schema. Unknown keys are ignored.',
    )
    ..writeln('  factory ${c.name}.fromJson(Object? json) {')
    ..writeln("    final m = _map(json, '${c.name}');");
  for (final f in c.fields.where((f) => f.isConst)) {
    out
      ..writeln("    if (m['${f.jsonKey}'] != ${literal(f.constValue)}) {")
      ..writeln(
        "      throw FormatException('${c.name}.${f.jsonKey}: expected "
        "${literal(f.constValue).replaceAll("'", r"\'")}, got \${m['${f.jsonKey}']}');",
      )
      ..writeln('    }');
  }
  out.writeln('    return ${c.name}(');
  for (final f in stored) {
    final ctx = "'${c.name}.${f.jsonKey.replaceAll(r'$', r'\$')}'";
    final key = literal(f.jsonKey);
    final access = f.required ? '_req(m, $key, $ctx)' : 'm[$key]';
    final t = f.required ? f.type : fieldType(f);
    out.writeln('      ${f.dartName}: ${decodeExpr(t, access, ctx)},');
  }
  out
    ..writeln('    );')
    ..writeln('  }')
    ..writeln();

  // Const getters
  for (final f in c.fields.where((f) => f.isConst)) {
    doc(out, f.description ?? 'Always ${f.constValue}.', indent: '  ');
    out.writeln(
      '  ${typeName(f.type)} get ${f.dartName} => ${literal(f.constValue)};',
    );
    out.writeln();
  }

  // Fields
  for (final f in stored) {
    doc(out, f.description, indent: '  ');
    if (c.implementsUnions.isNotEmpty && isCommon(c, f)) {
      out.writeln('  @override');
    }
    out.writeln('  final ${typeName(fieldType(f))} ${f.dartName};');
    out.writeln();
  }

  // toJson
  if (c.implementsUnions.isNotEmpty) out.writeln('  @override');
  out.writeln('  Map<String, Object?> toJson() => {');
  for (final f in c.fields) {
    final key = literal(f.jsonKey);
    if (f.isConst) {
      out.writeln('    $key: ${f.dartName},');
    } else if (f.required) {
      out.writeln('    $key: ${encodeExpr(f.type, f.dartName)},');
    } else {
      final enc = encodeExpr(f.type, f.dartName);
      out.writeln(
        '    if (${f.dartName} != null) $key: ${enc == f.dartName ? f.dartName : encodeExpr(f.type, '${f.dartName}!')},',
      );
    }
  }
  out
    ..writeln('  };')
    ..writeln();

  // Equality
  out
    ..writeln('  @override')
    ..writeln('  bool operator ==(Object other) =>')
    ..write('      identical(this, other) ||')
    ..write(' (other is ${c.name}');
  for (final f in stored) {
    if (isListType(f.type)) {
      out.write(' && _listEquals(other.${f.dartName}, ${f.dartName})');
    } else {
      out.write(' && other.${f.dartName} == ${f.dartName}');
    }
  }
  out
    ..writeln(');')
    ..writeln()
    ..writeln('  @override');
  if (stored.isEmpty) {
    out.writeln('  int get hashCode => ${c.name}.hashCode;');
  } else {
    final parts = stored
        .map(
          (f) => isListType(f.type)
              ? (f.required
                    ? 'Object.hashAll(${f.dartName})'
                    : "${f.dartName} == null ? null : Object.hashAll(${f.dartName}!)")
              : f.dartName,
        )
        .toList();
    out.writeln('  int get hashCode => Object.hashAll([${parts.join(', ')}]);');
  }
  out
    ..writeln()
    ..writeln('  @override')
    ..writeln("  String toString() => '${c.name}(\${toJson()})';")
    ..writeln('}')
    ..writeln();
}

bool isCommon(ClassDef c, FieldDef f) {
  for (final uName in c.implementsUnions) {
    final members = unions[uName]!.members.map((m) => classes[m]!).toList();
    if (members.any((m) => m.wrapsString)) continue;
    final all = members.every(
      (m) => m.fields.any(
        (g) =>
            g.dartName == f.dartName &&
            !g.isConst &&
            typeName(fieldType(g)) == typeName(fieldType(f)),
      ),
    );
    if (all) return true;
  }
  return false;
}

const _helpers = r'''
Map<String, Object?> _map(Object? json, String ctx) {
  if (json is Map<String, Object?>) return json;
  if (json is Map) return json.cast<String, Object?>();
  throw FormatException('$ctx: expected an object, got ${json.runtimeType}');
}

Object? _req(Map<String, Object?> m, String key, String ctx) {
  if (!m.containsKey(key)) {
    throw FormatException('$ctx: missing required key');
  }
  return m[key];
}

List<Object?> _list(Object? v, String ctx) {
  if (v is List) return v;
  throw FormatException('$ctx: expected a list, got ${v.runtimeType}');
}

String _string(Object? v, String ctx) {
  if (v is String) return v;
  throw FormatException('$ctx: expected a string, got ${v.runtimeType}');
}

int _int(Object? v, String ctx) {
  if (v is int) return v;
  if (v is double && v == v.truncateToDouble()) return v.toInt();
  throw FormatException('$ctx: expected an integer, got $v');
}

double _double(Object? v, String ctx) {
  if (v is num) return v.toDouble();
  throw FormatException('$ctx: expected a number, got ${v.runtimeType}');
}

// ignore: unused_element
bool _bool(Object? v, String ctx) {
  if (v is bool) return v;
  throw FormatException('$ctx: expected a boolean, got ${v.runtimeType}');
}

T? _opt<T>(Object? v, T Function(Object v) decode) =>
    v == null ? null : decode(v);

bool _listEquals<T>(List<T>? a, List<T>? b) {
  if (identical(a, b)) return true;
  if (a == null || b == null || a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}
''';

String generate() {
  loadSchemas();
  return emit();
}
