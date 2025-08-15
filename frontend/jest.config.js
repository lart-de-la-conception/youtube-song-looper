const nextJest = require('next/jest');

const createJestConfig = nextJest({
	dir: './',
});

const customJestConfig = {
	testEnvironment: 'jsdom',
	setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
	},
	testMatch: [
		'**/__tests__/**/*.[jt]s?(x)',
		'**/?(*.)+(test).[jt]s?(x)'
	],
};

module.exports = createJestConfig(customJestConfig);


