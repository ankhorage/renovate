import { describe, expect, test } from 'bun:test';

import { dependency, readPreset, resolveRules } from './renovatePreset.testSupport';

const consumerPreset = readPreset('../default.json');

const PLATFORM_OWNED_PACKAGES = [
  '@expo/metro-runtime',
  '@types/node',
  '@types/react',
  'expo',
  'expo-constants',
  'expo-dev-client',
  'expo-doctor',
  'expo-document-picker',
  'expo-file-system',
  'expo-font',
  'expo-image-picker',
  'expo-linking',
  'expo-router',
  'expo-splash-screen',
  'expo-status-bar',
  'react',
  'react-dom',
  'react-native',
  'react-native-gesture-handler',
  'react-native-reanimated',
  'react-native-safe-area-context',
  'react-native-screens',
  'react-native-web',
  'react-native-worklets',
  'typescript',
] as const;

describe('Studio Expo platform ownership', () => {
  test('leaves Studio platform dependency versions to the Expo Runtime owner rollout', () => {
    for (const packageName of PLATFORM_OWNED_PACKAGES) {
      expect(
        resolveRules(
          consumerPreset.packageRules,
          dependency(packageName, { repository: 'ankhorage/studio' }),
        ),
      ).toMatchObject({ enabled: false });
    }
  });

  test('keeps ordinary external Studio dependencies on the generic update lane', () => {
    expect(
      resolveRules(
        consumerPreset.packageRules,
        dependency('vitest', { repository: 'ankhorage/studio' }),
      ),
    ).toMatchObject({
      automerge: true,
      enabled: true,
      groupName: 'External npm dependencies',
    });
  });

  test('keeps the same external packages Renovate-managed outside Studio', () => {
    expect(
      resolveRules(
        consumerPreset.packageRules,
        dependency('react', { repository: 'ankhorage/zora' }),
      ),
    ).toMatchObject({
      automerge: true,
      enabled: true,
      groupName: 'External npm dependencies',
    });
  });
});
