import { defineParadoxConfig } from '@ankhorage/paradox';

export default defineParadoxConfig({
  mode: 'write',
  docs: {
    title: '@ankhorage/renovate',
    description: 'Ankhorage dependency update policy and automation powered by Renovate.',
    usage: {
      description:
        'Extend the repository-hosted preset from each Ankhorage repository that Renovate manages.',
      entrypoints: ['examples/renovate.json5'],
    },
  },
  package: {
    entrypoints: ['src/index.ts'],
  },
  output: {
    dir: 'paradox',
  },
});
