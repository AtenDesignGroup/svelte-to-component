## Usage

You can use the script by running it from the command line with the required `input` and `output` options.

### Example

To convert all `.svelte` component files in the `src` directory to `.twig` files in the `dist` directory, run the following command:

```sh
npx @atendesign/svelte-to-component --input 'src' --output 'dist'
```

This will process all `.svelte` files in the src directory and save the converted `.twig` files in the dist directory, maintaining the relative directory structure.

### Command Line Options

- `--input` or `-i`: Glob pattern for input files (required).
- `--output` or `-o`: Directory where the results are saved (required).
- `--glob` or `-g`: Glob pattern for input files. This can be used to target or exclude specific files within the input directory. (default: `**/components/**/!(*.stories).svelte`)
- `--save-ast`: Save AST to a JSON file (default: `false`).
- `--save-component-def`: Save component definition to a *.component.yml file (default: `true`).
- `--save-styles`: Save styles to the component src directory file (default: `true`).
- `--default-slot-name`: Default slot name. Svelte slots get converted to Twig blocks which require names. Svelte allows each component to have up to one default nameless slot. This option is used to identtify the Twig block that replaces any Svelte component's default slot. (default: `content`).