// ESM config: package.json declares "type": "module".
// ts-jest transpiles the TS sources (which use NodeNext ".js" import specifiers)
// to CommonJS for the test runner; moduleNameMapper strips the ".js" so Jest
// resolves the ".ts" source files.
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // Transpile-only: type-checking is done by `npm run build:server`.
        // This keeps the runner fast and avoids deep zod×SDK type instantiation
        // errors (TS2589) that don't affect the real build.
        isolatedModules: true,
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'Node',
          esModuleInterop: true,
          verbatimModuleSyntax: false,
          skipLibCheck: true,
        },
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/cli.ts',
    '!src/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
