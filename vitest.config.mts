import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['services/*/tests/**/*.test.ts'],
        setupFiles: ['tests/configuration_setup.ts'],
        restoreMocks: true,
        clearMocks: true,
    },
});
