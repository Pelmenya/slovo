// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    {
        ignores: [
            'dist/**',
            '**/dist/**',
            'node_modules/**',
            'coverage/**',
            'libs/database/src/generated/**',
            // Служебные CJS-скрипты (webpack config, bootstrap-обёртки) —
            // require() в них легальный, TS-правила неприменимы
            '**/*.cjs',
            'scripts/**',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    prettier,
    {
        languageOptions: {
            parserOptions: {
                project: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unsafe-argument': 'error',
            '@typescript-eslint/no-unsafe-assignment': 'error',
            '@typescript-eslint/no-unsafe-call': 'error',
            '@typescript-eslint/no-unsafe-member-access': 'error',
            '@typescript-eslint/no-unsafe-return': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    ignoreRestSiblings: true,
                },
            ],
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            // Жёсткое предпочтение разработчика: только `type`, никаких `interface`.
            // Причины: единый синтаксис (не два способа делать одно и то же),
            // `type` поддерживает unions/intersections/computed types нативно.
            '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
            // Все типы (type aliases) с префиксом T — C#-style.
            // Помогает глазом отличать тип от переменной / класса в импортах.
            '@typescript-eslint/naming-convention': [
                'error',
                {
                    selector: 'typeAlias',
                    format: ['PascalCase'],
                    prefix: ['T'],
                },
            ],
        },
    },
    {
        // Jest asymmetric matchers (expect.objectContaining, expect.any) типизированы
        // как any в @types/jest — это known issue, не лечится без потери читаемости.
        // Моки обычно получают any-возвраты даже с jest.fn<T>() generics из-за сложной
        // сигнатуры mockResolvedValue. Runtime-безопасность не страдает: это тесты,
        // typo ловится первым прогоном. Правила ослабляются ТОЛЬКО для *.spec.ts /
        // *.e2e-spec.ts — в прод-коде (apps/**, libs/**/*.ts) остаётся strict.
        files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
        rules: {
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
        },
    },
);
