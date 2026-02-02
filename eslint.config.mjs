import pluginJs from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config({
  languageOptions: { globals: globals.node },
  extends: [pluginJs.configs.recommended, ...tseslint.configs.recommended],
  ignores: ['dist/*'],
  rules: {},
});