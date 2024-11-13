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
  saveComponentDef: boolean; // Save component definition to a component.yml file
  defaultSlotName?: string; // Default slot ID
}

interface ComponentContext {
  name: string;
  components: Record<string, any>;
  props: Record<string, any>;
  slots: Record<string, any>;
  styleSheets: Record<string, any>;
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
    default: '**/!(*.stories).svelte',
  })
  .option('save-ast', {
    type: 'boolean',
    description: 'Save AST to a JSON file',
    demandOption: false,
    default: false,
  })
  .option('save-component-def', {
    type: 'boolean',
    alias: 'c',
    description: 'Save component definition to a component.yml file',
    demandOption: false,
    default: true,
  })
  .option('default-slot-name', {
    type: 'string',
    description: 'Default slot name. Svelte slots get converted to Twig blocks which require names. Svelte allows each component to have up to one default nameless slot. This option is used to identtify the Twig block that replaces any Svelte component\'s default slot.',
    demandOption: false,
    default: 'content',
  })
  .help()
  .argv;

function createOutputDir(outputDir: PathLike) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
}

/**
 * Checks if a tag is self-closing.
 * @param name
 * @returns boolean
 * @see https://developer.mozilla.org/en-US/docs/Glossary/Empty_element
 */
function isSelfClosingTag(name: string): boolean {
  const selfClosingTags = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
  ]);
  return selfClosingTags.has(name);
}

function saveComponentDefToFile(filePath: PathLike, componentDef: string, options: ProcessFilesOptions) {
  const { input, output: dest } = options;
  const relativePath = filePath.toString().replace(input, '');
  const outputDir = path.join(dest.toString(), '/twig');
  const outputFilePath = path.join(outputDir, relativePath.toString().replace('.svelte', '.component.yml'));
  // get the directory name from outputFilePath
  const dirname = path.dirname(outputFilePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, {recursive: true});
  }

  // Format the Twig template using Prettier
  try {
    console.log(`Saving ComponentDef to ${outputFilePath}`);
    fs.writeFileSync(outputFilePath, componentDef.toString());
  } catch (error) {
    console.error('Error formatting Twig template:', error);
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

// Function to convert AST node to component definition
function convertNodeToComponentDef(node: any, context: ComponentContext) : string {
  let output = `$schema: https://git.drupalcode.org/project/drupal/-/raw/10.3.x/core/assets/schemas/v1/metadata.schema.json
name: ${context.name}`;

  /**
   * @todo Add support for required properties
   *
   *    # If your component has required properties, you list them here.
   *  required:
   *   - primary
   */

 if (context.props) {
    output += `
props:
  type: object
  properties:`;
    for (const key in context.props) {
      output += `
    ${key}:
      type: ${context.props[key].type}`;

    /**
     * @todo Add support for human-readable titles
     *
     * title: My Component
     */
    if (context.props[key].title) {
      output += `
      title: ${context.props[key].title}`;
    }

    // Add default value if it exists
    if (context.props[key].default) {
      output += `
      default: ${context.props[key].default}`;
    }

    /**
     * @todo Add support for enum values
     *
     * enum:
     *   - 'One'
     *   - 'Two'
     *   - 'Three'
     *   - null
     */
    if (context.props[key].enum) {
      output += `
      enum: ${context.props[key].enum}`;
    }

    /**
     * @todo Add support for descriptions
     */
    if (context.props[key].description) {
      output += `
      description: ${context.props[key].description}`;
    }
  }}

  if (context.slots.length > 0) {
    output += `
slots:`;
  context.slots.forEach((slot: any) => {
  output += `
  ${slot}: {}`;
  });
}



/**
 * @todo Add support for library overrides
 */
// # This is how you take control of the keys in your library
// # declaration. The overrides specified here will be merged (shallow merge)
// # with the auto-generated library. The result of the merge will become the
// # library for the component.
// libraryOverrides:
//   # Once you add a key in the overrides, you take control of it. What you
//   # type here is what will end up in the library component.
//   dependencies:
//     - core/drupal
//     - core/once

//   # Here we are taking control of the JS assets. So we need to specify
//   # everything, even the parts that were auto-generated. This is useful
//   # when adding additional files or tweaking the <script>
//   # tag's attributes.
//   js:
//     my-component.js: { attributes: { defer: true } }
//     my-other-file.js: {}`

  return output;
}

// Function to convert AST node to Twig
function convertNodeToTwig(node: any, options: ProcessFilesOptions) : string {
  let children = '';
  let attributes = '';
  try {
    switch (node.type) {
      case 'Attribute':
        return `${node.name}="${node.value.map(childNode => convertNodeToTwig(childNode, options)).join('')}"`
      case 'ArrayPattern':
        return `${node.elements.map(childNode => convertNodeToTwig(childNode, options)).join(', ')}`;
      case 'BinaryExpression':
        return `${convertNodeToTwig(node.left, options)} ${node.operator === '===' ? '==' : node.operator } ${convertNodeToTwig(node.right, options)}`;
      case 'CallExpression':
        // Handle Object.entries
        // We'll assume objects passed to the template are associative arrays in PHP,
        // so we should beable to use the arguments directly.
        if (node.callee.type === 'MemberExpression' && node.callee.object.name === 'Object' && node.callee.property.name === 'entries') {
          return node.arguments.map(childNode => convertNodeToTwig(childNode, options)).join(', ');
        }
        return `${convertNodeToTwig(node.callee, options)}(${node.arguments.map(childNode => convertNodeToTwig(childNode, options)).join(', ')})`;
      case 'ConditionalExpression':
        return `${convertNodeToTwig(node.test, options)} ? ${convertNodeToTwig(node.consequent, options)} : ${convertNodeToTwig(node.alternate, options)}`;
      case 'Fragment':
        if (node.children) {
          return node.children.map(childNode => convertNodeToTwig(childNode, options)).join('');
        }
        return '';
      case 'Literal':
        return node.raw;
      case 'LogicalExpression':
        let operator = node.operator === '&&' ? 'and' : 'or';
        return `${convertNodeToTwig(node.left, options)} ${operator} ${convertNodeToTwig(node.right, options)}`;
      case 'Element':
        attributes = node.attributes.map(childNode => convertNodeToTwig(childNode, options)).join(' ');
        children = node.children.map(childNode => convertNodeToTwig(childNode, options)).join('');
        if (isSelfClosingTag(node.name)) {
          return `<${node.name} ${attributes} />`;
        } else {
          return `<${node.name} ${attributes}>${children}</${node.name}>`;
        }
      case 'Identifier':
        return node.name;
      case 'MemberExpression':
        return `${convertNodeToTwig(node.object, options)}.${convertNodeToTwig(node.property, options)}`;
      case 'MustacheTag':
        return node.expression.type === 'TemplateLiteral'
          ? convertNodeToTwig(node.expression, options)
          : `{{ ${convertNodeToTwig(node.expression, options)} }}`;
      case 'IfBlock':
        const condition = convertNodeToTwig(node.expression, options);
        const ifChildren = node.children.map(childNode => convertNodeToTwig(childNode, options)).join('');
        return `{% if ${condition} %}${ifChildren}{% endif %}`;
      case 'InlineComponent':
        children = node.children.map(childNode => convertNodeToTwig(childNode, options)).join('');
        attributes = node.attributes.map(childNode => convertNodeToObjectLiteral(childNode, options)).join(', ');
        return `\n{% embed "${node.name}" with {${attributes}} only %}${children}{% endembed %}`;
      case 'EachBlock':
        const eachChildren = node.children.map(childNode => convertNodeToTwig(childNode, options)).join('');
        // Handle destructured each block
        if (node.context.type === 'ArrayPattern') {
          return `{% for ${convertNodeToTwig(node.context, options)} in ${convertNodeToTwig(node.expression, options)} %}${eachChildren}{% endfor %}`;
        }
        if (node.context.type === 'ObjectPattern') {
          return `{% for ${convertNodeToTwig(node.expression, options)}_item in ${convertNodeToTwig(node.expression, options)} %}${eachChildren}{% endfor %}`;
        }
        return `{% for ${convertNodeToTwig(node.expression, options)}_item in ${convertNodeToTwig(node.expression, options)} %}${eachChildren}{% endfor %}`;
      case 'Slot':
        let id = options.defaultSlotName;
        const nameAttribute = node.attributes.find((attr: any) => { return attr.name === 'name'; });
        if (nameAttribute) {
          id = nameAttribute.value[0].data;
        } else {
          console.warn(`\x1b[43m The svelte component has an unnamed slot which is unsupported in Twig. Using the default-slot-name of "${options.defaultSlotName}" as a fallback. This still may cause issues in component.yml. To fix this, set a name for the slot. \x1b[0m`);
        }
        return `{% block ${id} %}${node.children.map(childNode => convertNodeToTwig(childNode, options)).join('')}{% endblock %}`;
      case 'TemplateElement':
        return node.value.raw;
      case 'TemplateLiteral':
        if (node.expressions?.length > 0) {
          return `${node.quasis.map(childNode => convertNodeToTwig(childNode, options)).join('')} {{${node.expressions.map(childNode => convertNodeToTwig(childNode, options)).join('')}}}`;
        }
        return node.quasis.map(childNode => convertNodeToTwig(childNode, options)).join('');
      case 'Text':
        return node.data;
      case 'UnaryExpression':
        return `${node.operator === '!' ? 'not ' : node.operator}${convertNodeToTwig(node.argument, options)}`;
      default:
        return '';
    }
  } catch (error) {
    console.error('Error converting node to Twig:', error);
    console.log('Element:', node);
  }
  return '';
}

function convertNodeToObjectLiteral(node: any, options: ProcessFilesOptions) : string {
  try {
    switch (node.type) {
      case 'ArrayExpression':
        return `[${node.elements.map(childNode => convertNodeToObjectLiteral(childNode, options)).join(', ')}]`;
      case 'ArrayPattern':
        return `${node.elements.map(childNode => convertNodeToTwig(childNode, options)).join(', ')}`;
      case 'Attribute':
        return `${node.name}: ${node.value.map(childNode => convertNodeToObjectLiteral(childNode, options)).join(' ')}`;
      case 'AttributeShorthand':
        return node.expression.name;
      case 'Identifier':
        return node.name;
      case 'Literal':
        return node.raw;
      case 'ObjectExpression':
        return `{${node.properties.map(childNode => convertNodeToObjectLiteral(childNode, options)).join(', ')}}`;
      case 'Property':
        return `${node.key.name}: ${convertNodeToObjectLiteral(node.value, options)}`;
      case 'MustacheTag':
        return convertNodeToObjectLiteral(node.expression, options);
      case 'Text':
        return `'${node.data}'`;
    }
  } catch (error) {
    console.error('Error converting node to object literal:', error);
    console.log('Element:', node);
  }
  return '';
}

function createComponentContext(
  ast: Record<string, any>,
  filePath: PathLike,
  options: ProcessFilesOptions
): ComponentContext {
  // Extract component name from file path
  const name = path.basename(filePath.toString(), '.svelte');

  // Initialize context
  const context: ComponentContext = {
    name,
    components: {},
    props: null,
    slots: [],
    styleSheets: {},
  };

  // Infer component props from any exported let declarations
  ast.instance?.content.body.forEach((node: any) => {
    if (node.type === 'ExportNamedDeclaration') {
      node.declaration.declarations.forEach((declaration: any) => {

        if (declaration.type === 'VariableDeclarator' && declaration.id.type === 'Identifier') {
          if (!context.props) {
            context.props = {};
          };

          const id = declaration.id.name;
          let type = 'string';
          let defaultValue;

          if (declaration.init?.type === 'ArrayExpression') {
            type = 'array';
            defaultValue = `[${declaration.init.elements.map((element: any) => element.raw).join(', ')}]`;
          } else if (declaration.init?.type === 'Literal') {
            switch (typeof declaration.init.value) {
              case 'boolean':
                type = 'boolean';
                defaultValue = declaration.init.value;
                break;
              case 'number':
                type = 'number';
                defaultValue = declaration.init.value;
                break;
              case 'string':
                type = 'string';
                defaultValue = declaration.init.value;
                break;
              default:
                defaultValue = declaration.init.raw;
                type = 'string';
            }
          } else if (declaration.init?.type === 'ObjectExpression') {
            type = 'object';
          }

          else if (declaration.init?.type) {
            console.log(declaration.init.type);
          }

          context.props[id] = {
            type,
            title: '',
            description: '',
            enum: '',
          };
          // Set default value if it exists
          if (typeof defaultValue !== 'undefined') {
            context.props[id].default = defaultValue;
          }
        }
      });
    }
  });

  // Infer slots by recursively searching the AST html for slot nodes.
  function findSlots(node: any) {
    if (node.type === 'Slot') {
      const id = node.attributes.find((attr: any) => { return attr.name === 'name'; });
      context.slots.push(id ? id.value[0].data : options.defaultSlotName);
    }
    if (node.children) {
      node.children.forEach(findSlots);
    }
  }
  findSlots(ast.html);

  return context;
}

// Function to process each .svelte file
function processFile(options: ProcessFilesOptions) {
  return (filePath: PathLike) => {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const ast: Record<string, any> = parse(fileContent);
    const context = createComponentContext(ast, filePath, options);


    if (options.saveAst) {
      saveAstToFile(filePath, ast, options);
    }

    if (options.saveComponentDef) {
      const componentDef = convertNodeToComponentDef(ast, context);
      saveComponentDefToFile(filePath, componentDef, options);
    }

    const twigTemplate = convertNodeToTwig(ast.html, options);
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
  saveComponentDef: argv['save-component-def'],
  defaultSlotName: argv['default-slot-name'],
});
