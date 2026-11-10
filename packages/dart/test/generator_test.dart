import 'dart:io';

import 'package:test/test.dart';

void main() {
  test('generated models match data/schema/v1', () async {
    final result = await Process.run(Platform.resolvedExecutable, [
      'run',
      'tool/generate_models.dart',
      '--check',
    ]);
    expect(result.exitCode, 0, reason: '${result.stdout}\n${result.stderr}');
  }, timeout: const Timeout(Duration(minutes: 2)));
}
