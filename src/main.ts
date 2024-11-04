#!/usr/bin/env node
import fs from 'node:fs';
import type { PathLike } from 'fs';
import path from 'path';
import { glob } from 'glob';
import { parse } from 'svelte/compiler';
import prettier from 'prettier';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface ProcessFilesOptions {
  input: string; // Directory where svelte components are located
  output: string; // Directory where the results are saved
  glob: string; // Glob pattern for input files
  saveAst: boolean; // Save AST to a JSON file
}

// Parse command-line arguments
const argv = yargs(hideBin(process.argv))
  .option('input', {
    alias: 'i',
    type: 'string',
    description: 'Glob pattern for input files',
    demandOption: true, // Make input option required
  })
  .option('output', {
    alias: 'o',
    type: 'string',
    description: 'Directory where the results are saved',
    demandOption: true, // Make output option required
  })
  .option('glob', {
    alias: 'g',
    type: 'string',
    description: 'Glob pattern for input files. This can be used to target specific files within the input directory.',
    demandOption: false,
    default: '**/*.svelte',
  })
  .option('save-ast', {
    type: 'boolean',
    description: 'Save AST to a JSON file',
    demandOption: false,
    default: false,
  })
  .help()
  .argv;

function createOutputDir(outputDir: PathLike) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
}

// Function to save AST to a JSON file
function saveAstToFile(filePath: PathLike, ast: Record<string, any>, options: ProcessFilesOptions) {
  const dest = path.resolve(options.output);
  const outputDir = path.join(dest.toString(), '/ast');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  const outputFilePath = path.join(outputDir, `${path.basename(filePath.toString())}.json`);
  console.log(`Saving AST to ${outputFilePath}`);
  fs.writeFileSync(outputFilePath, JSON.stringify(ast, null, 2));
}

// Function to save Twig file
async function saveTwigToFile(filePath: PathLike, template: string, options: ProcessFilesOptions) {
  const { input, output: dest } = options;
  const relativePath = filePath.toString().replace(input, '');
  const outputDir = path.join(dest.toString(), '/twig');
  const outputFilePath = path.join(outputDir, relativePath.toString().replace('.svelte', '.twig'));
  // get the directory name from outputFilePath
  const dirname = path.dirname(outputFilePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, {recursive: true});
  }

  // Format the Twig template using Prettier
  try {
    const formattedTemplate = await prettier.format(template, {
      parser: 'melody',
      plugins: ['prettier-plugin-twig-melody'],
    });
    console.log(`Saving Twig to ${outputFilePath}`);
    fs.writeFileSync(outputFilePath, formattedTemplate);
  } catch (error) {
    console.error('Error formatting Twig template:', error);
    console.log('Template:', template);
    fs.writeFileSync(outputFilePath, template);
  }

}

// Function to convert AST node to Twig
function convertNodeToTwig(node: any) : string {
  let children = '';
  let attributes = '';
  try {
    switch (node.type) {
      case 'Attribute':
        return `${node.name}="${node.value.map(convertNodeToTwig).join(' ')}"`
      case 'ArrayPattern':
        return `${node.elements.map(convertNodeToTwig).join(', ')}`;
      case 'BinaryExpression':
        return `${convertNodeToTwig(node.left)} ${node.operator === '===' ? '==' : node.operator } ${convertNodeToTwig(node.right)}`;
      case 'CallExpression':
        return `${convertNodeToTwig(node.callee)}(${node.arguments.map(convertNodeToTwig).join(', ')})`;
      case 'ConditionalExpression':
        return `${convertNodeToTwig(node.test)} ? ${convertNodeToTwig(node.consequent)} : ${convertNodeToTwig(node.alternate)}`;
      case 'Fragment':
        if (node.children) {
          return node.children.map(convertNodeToTwig).join('');
        }
        return '';
      case 'Literal':
        return node.raw;
      case 'LogicalExpression':
        let operator = node.operator === '&&' ? 'and' : 'or';
        return `${convertNodeToTwig(node.left)} ${operator} ${convertNodeToTwig(node.right)}`;
      case 'Element':
        attributes = node.attributes.map(convertNodeToTwig).join(' ');
        children = node.children.map(convertNodeToTwig).join('');
        return `<${node.name} ${attributes}>${children}</${node.name}>`;
      case 'Identifier':
        return node.name;
      case 'MemberExpression':
        return `${convertNodeToTwig(node.object)}.${convertNodeToTwig(node.property)}`;
      case 'MustacheTag':
        return node.expression.type === 'TemplateLiteral'
          ? convertNodeToTwig(node.expression)
          : `{{ ${convertNodeToTwig(node.expression)} }}`;
      case 'IfBlock':
        const condition = convertNodeToTwig(node.expression);
        const ifChildren = node.children.map(convertNodeToTwig).join('');
        return `{% if ${condition} %}${ifChildren}{% endif %}`;
      case 'InlineComponent':
        children = node.children.map(convertNodeToTwig).join('');
        attributes = node.attributes.map(convertNodeToObjectLiteral).join(', ');
        return `\n{% embed "${node.name}" with {${attributes}} only %}${children}{% endembed %}`;
      case 'EachBlock':
        const eachChildren = node.children.map(convertNodeToTwig).join('');
        // Handle destructured each block
        if (node.context.type === 'ArrayPattern') {
          return `{% for ${convertNodeToTwig(node.context)} in ${convertNodeToTwig(node.expression)} %}${eachChildren}{% endfor %}`;
        }
        if (node.context.type === 'ObjectPattern') {
          return `{% for ${convertNodeToTwig(node.expression)}_item in ${convertNodeToTwig(node.expression)} %}${eachChildren}{% endfor %}`;
        }
        return `{% for ${convertNodeToTwig(node.expression)}_item in ${convertNodeToTwig(node.expression)} %}${eachChildren}{% endfor %}`;
      case 'TemplateElement':
        return node.value.raw;
      case 'TemplateLiteral':
        if (node.expressions?.length > 0) {
          return `${node.quasis.map(convertNodeToTwig).join('')} {{${node.expressions.map(convertNodeToTwig).join('')}}}`;
        }
        return node.quasis.map(convertNodeToTwig).join('');
      case 'Text':
        return node.data;
      case 'UnaryExpression':
        return `${node.operator === '!' ? 'not ' : node.operator}${convertNodeToTwig(node.argument)}`;
      default:
        return '';
    }
  } catch (error) {
    console.error('Error converting node to Twig:', error);
    console.log('Element:', node);
  }
  return '';
}

function convertNodeToObjectLiteral(node: any) : string {
  try {
    switch (node.type) {
      case 'ArrayExpression':
        return `[${node.elements.map(convertNodeToObjectLiteral).join(', ')}]`;
      case 'ArrayPattern':
        return `${node.elements.map(convertNodeToTwig).join(', ')}`;
      case 'Attribute':
        return `${node.name}: ${node.value.map(convertNodeToObjectLiteral).join(' ')}`;
      case 'Identifier':
        return node.name;
      case 'Literal':
        return node.raw;
      case 'ObjectExpression':
        return `{${node.properties.map(convertNodeToObjectLiteral).join(', ')}}`;
      case 'Property':
        return `${node.key.name}: ${convertNodeToObjectLiteral(node.value)}`;
      case 'MustacheTag':
        return convertNodeToObjectLiteral(node.expression);
      case 'Text':
        return `'${node.data}'`;
    }
  } catch (error) {
    console.error('Error converting node to object literal:', error);
    console.log('Element:', node);
  }
  return '';
}

// Function to process each .svelte file
function processFile(options: ProcessFilesOptions) {
  return (filePath: PathLike) => {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const ast: Record<string, any> = parse(fileContent);

    if (options.saveAst) {
      saveAstToFile(filePath, ast, options);
    }

    const twigTemplate = convertNodeToTwig(ast.html);
    saveTwigToFile(filePath, twigTemplate, options);
  }
}

export default async function processFiles(options: ProcessFilesOptions): Promise<void> {
  const { input, output, glob: globPattern } = options;

  // Ensure the output directory exists
  createOutputDir(output);

  // Find files matching the input glob pattern and process each one.
  try {
    const files: PathLike[] = await glob(path.join(input, globPattern));
    files.forEach(processFile(options));
  } catch (error) {
    console.error('Error finding files:', error);
    return;
  }
};

// Call processFiles with parsed options
processFiles({
  input: argv.input,
  output: argv.output,
  glob: argv.glob,
  saveAst: argv['save-ast'],
});