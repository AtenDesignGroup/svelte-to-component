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
- `--glob` or `-g`: Glob pattern for input files. This can be used to target or exclude specific files within the input directory. (default: `**/*.svelte`)
- `--save-ast`: Save AST to a JSON file (default: `false`).