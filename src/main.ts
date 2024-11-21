#!/usr/bin/env node
import fs from 'node:fs';
import type { PathLike } from 'fs';
import path from 'path';
import { glob } from 'glob';
import { parse, compile } from 'svelte/compiler';
import merge from 'lodash/merge.js';
import prettier from 'prettier';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { loadComponentDef, stringifyYaml } from './lib/componentYaml';
import { ProcessFilesOptions, ComponentContext } from './types';
import { Alias } from 'yaml';

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
    default: '**/components/**/!(*.stories).svelte',
  })
  .option('theme', {
    alias: 't',
    type: 'string',
    description: 'Theme name used to namespace components',
    demandOption: true,
  })
  .option('save-ast', {
    type: 'boolean',
    description: 'Save AST to a JSON file',
    demandOption: false,
    default: false,
  })
  .option('save-styles', {
    alias: 'css',
    type: 'boolean',
    description: 'Save SCSS styles to the src directory',
    demandOption: false,
    default: true,
  })
  .option('save-scripts', {
    alias: 'js',
    type: 'boolean',
    description: 'Save JS to the src directory',
    demandOption: false,
    default: true,
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

function saveJsToFile(filePath: PathLike, jsContent: string, options: ProcessFilesOptions) {
  const { input, output: dest } = options;
  const relativePath = filePath.toString()
    .replace(input, '')
    .replace(/^(.*)(\/)([^\/]*)$/, '$1/src/$3');

  const outputDir = path.join(dest.toString(), '/twig');
  const outputFilePath = path.join(outputDir, relativePath.toString().replace('.svelte', '.js'));
  const dirname = path.dirname(outputFilePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, {recursive: true});
  }

  // Format the Twig template using Prettier
  try {
    console.log(`Saving JS to ${outputFilePath}`);
    fs.writeFileSync(outputFilePath, jsContent);
  } catch (error) {
    console.error('Error formatting JS:', error);
  }
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
      plugins: ['./node_modules/@supersoniks/prettier-plugin-twig-melody'],
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
  let def: any = {
    '$schema': 'https://git.drupalcode.org/project/drupal/-/raw/10.3.x/core/assets/schemas/v1/metadata.schema.json',
    name: context.name,
  };

  if (context.props) {

    def.props = {
      type: 'object',
      properties: {},
    };

    for (const key in context.props) {
      def.props.properties[key] = {
        type: context.props[key].type,
      };

      if (context.props[key].title) {
        def.props.properties[key].title = context.props[key].title;
      }

      if (context.props[key].default) {
        def.props.properties[key].default = context.props[key].default;
      }

      if (context.props[key].enum) {
        def.props.properties[key].enum = context.props[key].enum;
      }

      if (context.props[key].description) {
        def.props.properties[key].description = context.props[key].description;
      }
    }
  }

  if (context.slots.length > 0) {
    def.slots = {};

    context.slots.forEach((slot: any) => {
      def.slots[slot] = {};
    });
  }

  def = merge(def, context.component);

  return stringifyYaml(def);
}

// Function to convert AST node to Twig
function convertNodeToTwig(node: any, options: ProcessFilesOptions) : string {
  let children = '';
  let attributes = '';
  try {
    switch (node.type) {
      case 'Attribute':
        // Handle boolean attributes.
        if (node.value === true) {
          return node.name;
        }
        return `${node.name}="${node.value.map(childNode => convertNodeToTwig(childNode, options)).join('')}"`
      case 'AttributeShorthand':
        return `{{ ${node.expression.name} }}`;
      case 'ArrayPattern':
        return `${node.elements.map(childNode => convertNodeToTwig(childNode, options)).join(', ')}`;
      case 'BinaryExpression':
        let binaryOperator = node.operator;
        switch (node.operator) {
          case '===':
          case '==':
            binaryOperator = '==';
            break;
          case '!==':
          case '!=':
            binaryOperator = '!=';
        }
        return `${convertNodeToTwig(node.left, options)} ${binaryOperator} ${convertNodeToTwig(node.right, options)}`;
      case 'CallExpression':
        // Handle Object.entries
        // We'll assume objects passed to the template are associative arrays in PHP,
        // so we should beable to use the arguments directly.
        if (node.callee.type === 'MemberExpression' && node.callee.object.name === 'Object' && node.callee.property.name === 'entries') {
          return node.arguments.map(childNode => convertNodeToTwig(childNode, options)).join(', ');
        }
        return `${convertNodeToTwig(node.callee, options)}(${node.arguments.map(childNode => convertNodeToTwig(childNode, options)).join(', ')})`;
      case 'ConditionalExpression':
        return `${convertNodeToTwig(node.test, options)} ? ${convertNodeToObjectLiteral(node.consequent, options)} : ${convertNodeToObjectLiteral(node.alternate, options)}`;
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
        /** @todo Use include syntax if the component has no children.  */
        attributes = node.attributes.map(childNode => convertNodeToObjectLiteral(childNode, options)).join(', ');
        const inlineComponentId = `${options.theme}:${node.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;
        if (node.children.length <= 0) {
          return `\n{{ include('${inlineComponentId}', {${attributes}}, with_context = false) }}`;
        } else {
          children = node.children.map(childNode => convertNodeToTwig(childNode, options)).join('');
          return `\n{% embed "${inlineComponentId}" with {${attributes}} only %}
            {% block ${options.defaultSlotName} %}
            ${children}
            {% endblock %}
          {% endembed %}`;
        }
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
      case 'RawMustacheTag':
        return `{{ ${convertNodeToTwig(node.expression, options)} }}`;
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
          const elements = [...node.expressions, ...node.quasis]
            .sort((a, b) =>  a.start - b.start);
          return `${elements.map(childNode => {
            switch (childNode.type) {
              case 'TemplateElement':
                return childNode.value.raw;
              case 'LogicalExpression':
                if (childNode.operator === '||') {
                  return `{{ ${convertNodeToObjectLiteral(childNode.left, options)}|default(${convertNodeToObjectLiteral(childNode.right, options)}) }}`;
                }
              default:
                return `{{ ${convertNodeToTwig(childNode, options)} }}`;
            }
          }).filter(a => a.length).join('')}`;
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
        if (node.value === true) {
          return node.name;
        }
        return `${node.name}: ${node.value.map(childNode => convertNodeToObjectLiteral(childNode, options)).join(' ')}`;
      case 'AttributeShorthand':
        return node.expression.name;
      case 'BinaryExpression':
        let operator = node.operator;
        switch (node.operator) {
          case '===':
          case '==':
            operator = '==';
            break;
          case '!==':
          case '!=':
            operator = '!=';
        }
        return `${convertNodeToObjectLiteral(node.left, options)} ${operator} ${convertNodeToObjectLiteral(node.right, options)}`;
      case 'CallExpression':
        return `${convertNodeToObjectLiteral(node.callee, options)}(${node.arguments.map(childNode => convertNodeToObjectLiteral(childNode, options)).join(', ')})`;
      case 'ConditionalExpression':
        return `${convertNodeToObjectLiteral(node.test, options)} ? ${convertNodeToObjectLiteral(node.consequent, options)} : ${convertNodeToObjectLiteral(node.alternate, options)}`;
      case 'Identifier':
        return node.name;
      case 'Literal':
        return node.raw;
      case 'LogicalExpression':
        if (node.operator === '&&') {
          return `${convertNodeToObjectLiteral(node.left, options)} ? ${convertNodeToObjectLiteral(node.right, options)}`;
        } else if (node.operator === '||') {
          return `${convertNodeToObjectLiteral(node.left, options)}|default(${convertNodeToObjectLiteral(node.right, options)})`;
        }
      case 'ObjectExpression':
        // Some properties are SpreadElements, which we need to handle separately but preserve the order.
        if (node.properties.some((property: any) => property.type === 'SpreadElement')) {
          // Initialize the object with the first property.
          const firstProperty = node.properties[0];

          const init = firstProperty.type === 'SpreadElement'
            ? convertNodeToObjectLiteral(node.properties[0], options)
            : `{${convertNodeToObjectLiteral(node.properties[0], options)}}`;
          const mergedProperties = node.properties.slice(1).map(childNode =>
            /** @todo handle grouping properties to imporove output. */
            childNode.type === 'Property'
              ? `{${convertNodeToObjectLiteral(childNode, options)}}`
              : convertNodeToObjectLiteral(childNode, options)
            ).join(', ');
          return `${init}|merge(${mergedProperties})`;
        }
        return `{${node.properties.map(childNode => convertNodeToObjectLiteral(childNode, options)).join(', ')}}`;
      case 'MemberExpression':
        return `${convertNodeToObjectLiteral(node.object, options)}.${convertNodeToObjectLiteral(node.property, options)}`;
      case 'MustacheTag':
        return convertNodeToObjectLiteral(node.expression, options);
      case 'Property':
        return `${convertNodeToObjectLiteral(node.key, options)}: ${convertNodeToObjectLiteral(node.value, options)}`;
      case 'RawMustacheTag':
        return `{{ ${convertNodeToTwig(node.expression, options)} }}`;
      case 'SpreadElement':
        return convertNodeToObjectLiteral(node.argument, options);
      case 'TemplateElement':
        return node.value.cooked ? `'${node.value.cooked}'` : '';
      case 'TemplateLiteral':
        if (node.expressions?.length > 0) {
          const elements = [...node.expressions, ...node.quasis]
            .sort((a, b) =>  a.start - b.start);
          return `${elements.map(childNode => {
            switch (childNode.type) {
              case 'TemplateElement':
                return `'${childNode.value.raw}'`;
              case 'LogicalExpression':
                if (childNode.operator === '||') {
                  return `${convertNodeToObjectLiteral(childNode.left, options)}|default(${convertNodeToObjectLiteral(childNode.right, options)})`;
                }
                if (childNode.operator === '&&') {
                  return `${convertNodeToObjectLiteral(childNode.left, options)} ? ${convertNodeToObjectLiteral(childNode.right, options)}`;
                }
              default:
                return `${convertNodeToTwig(childNode, options)}`;
            }
          }).filter(a => a !== "''").join(' ~ ')}`;
        }
        return node.quasis.map(childNode => convertNodeToTwig(childNode, options)).join('');
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
  // Load a component.yml file if it exists
  const userDefinedComponent = loadComponentDef(filePath, options);
  const name = userDefinedComponent.name
    ? userDefinedComponent.name
    // Extract component name from file path as fallback.
    : path.basename(filePath.toString(), '.svelte');

  // Initialize context
  const context: ComponentContext = {
    name,
    component: userDefinedComponent,
    components: {},
    props: null,
    setStatements: {},
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
          } else if (declaration.init?.type === 'Identifier') {
            console.log('It;s an identifier:', node);
          } else if (declaration.init?.type) {
            console.log('Unhandled type:', node);
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

  // Infer set statements by recursively searching the AST script for set nodes.
  ast.instance?.content.body.forEach((node: any) => {
    if (node.type === 'LabeledStatement' && node?.body?.type === 'ExpressionStatement') {
      const expression = node.body.expression;
      if (expression.type === 'AssignmentExpression' && expression.operator === '=') {
        context.setStatements[expression.left.name] = convertNodeToObjectLiteral(expression.right, options);
      }
    }

    if (node.type === 'VariableDeclaration') {
      context.setStatements[node.declarations[0].id.name] = convertNodeToObjectLiteral(node.declarations[0].init, options);
    }
  });

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

    const componentDef = convertNodeToComponentDef(ast, context);

    // Handle component scripts
    if (options.saveScripts) {
      const jsFilePath = filePath.toString().replace('.svelte', '.js');
      if (fs.existsSync(jsFilePath)) {
        const jsContent = fs.readFileSync(jsFilePath, 'utf-8');
        const scriptString = createDrupalBehaviorScript(filePath, fileContent, ast, options, context);
        const updatedJsContent = `${jsContent}\n${scriptString}`;

        saveJsToFile(filePath, updatedJsContent, options);
      }
    }

    const templateSetStatements = Object.entries(context.setStatements)
      .map(([key, value]) => `{% set ${key} = ${value} %}`).join('\n');
    const templateBody = convertNodeToTwig(ast.html, options);

    const twigTemplate = [templateSetStatements, templateBody].join('\n');
    saveTwigToFile(filePath, twigTemplate, options);

    if (options.saveComponentDef && componentDef) {
      saveComponentDefToFile(filePath, componentDef, options);
    }
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

  //
  // Handle component styles.
  //
  if (options.saveStyles) {
    copyScssFiles(options);
  }
};

/**
 * Copies SCSS files from the input directory to the output directory.
 *
 * @param options ProcessFilesOptions
 *   Command configuration options.
 *
 * @returns void
 *
 */
function copyScssFiles(options: ProcessFilesOptions) {
  const { input, output: dest } = options;
  const outputDir = path.join(dest.toString(), '/twig');

  // Find SCSS files in the input directory.
  const scssFiles = glob.sync(path.join(input, '**/components/**/*.scss'));

  // Copy each SCSS file to the output directory.
  scssFiles.forEach((filePath) => {
    try {
      let relativePath = filePath.toString().replace(input, '');
      // Insert /src/ before the filename.
      relativePath = relativePath.replace(/^(.*)(\/)([^\/]*)$/, '$1/src/$3');
      const outputFilePath = path.join(outputDir, relativePath.toString());
      const dirname = path.dirname(outputFilePath);
      if (!fs.existsSync(dirname)) {
        fs.mkdirSync(dirname, {recursive: true});
      }

      fs.copyFileSync(filePath, outputFilePath);
    } catch (error) {
      console.error('Error copying SCSS files:', error);
    }
  });
}

/**
 * Copies JS files from the input directory to the output directory.
 *
 * @param options ProcessFilesOptions
 *   Command configuration options.
 *
 * @returns void
 *
 */
function copyJsFiles(options: ProcessFilesOptions) {
  const { input, output: dest } = options;
  const outputDir = path.join(dest.toString(), '/twig');

  // Find JS files in the input directory.
  const jsFiles = glob.sync(path.join(input, '**/components/**/*.js'));

  // Copy each JS file to the output directory.
  jsFiles.forEach((filePath) => {
    try {
      let relativePath = filePath.toString().replace(input, '');
      // Insert /src/ before the filename.
      relativePath = relativePath.replace(/^(.*)(\/)([^\/]*)$/, '$1/src/$3');
      const outputFilePath = path.join(outputDir, relativePath.toString());
      const dirname = path.dirname(outputFilePath);
      if (!fs.existsSync(dirname)) {
        fs.mkdirSync(dirname, {recursive: true});
      }

      fs.copyFileSync(filePath, outputFilePath);
    } catch (error) {
      console.error('Error copying JS files:', error);
    }
  });
}

function createDrupalBehaviorScript(filePath: PathLike, fileContent: string, ast: Record<string, any>, options: ProcessFilesOptions,  context: ComponentContext) {
  const { input, output: dest, theme } = options;
  const relativePath = filePath.toString().replace(input, '');
  const outputDir = path.join(dest.toString(), '/twig');
  const outputFilePath = path.join(outputDir, relativePath.toString().replace('.svelte', '.js'));
  const dirname = path.dirname(outputFilePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, {recursive: true});
  }

  const behaviorId = [theme, context.name.replace(/[^a-zA-Z0-9]/g, '_')].join('_').toLowerCase();

  /** @todo Translate the `onDestroy` lifecycle hook to `.detach` */

  // Extract the script from the AST onMount function
  const onMount = ast.instance?.content?.body?.find((node: any) => {
    return node.type === 'ExpressionStatement'
      && node?.expression?.type === 'CallExpression'
      && node.expression?.callee?.name === 'onMount';
  });

  if (!onMount) {
    return null;
  }

  // Get the substring of the onMount function from the file content
  // using the start and end positions of the function body from the AST.
  // Reach into onMount and extract the function body.
  const onMountContent = onMount.expression.arguments[0].body.body[0];
  const start = onMountContent.start;
  const end = onMountContent.end;
  const functionBody = fileContent
    .substring(start, end)
    // Replace document with context.
    .replace('.attach(document', '.attach(context');

  const script = `
(function (Drupal) {
  Drupal.behaviors.${behaviorId} = {
    attach: function (context, settings) {
      ${functionBody}
    }
  };
})(Drupal);`;

   return script;
}
//
// Call processFiles with parsed options
//
processFiles({
  input: argv.input,
  output: argv.output,
  glob: argv.glob,
  saveAst: argv['save-ast'],
  saveScripts: argv['save-scripts'],
  saveStyles: argv['save-styles'],
  saveComponentDef: argv['save-component-def'],
  defaultSlotName: argv['default-slot-name'],
  theme: argv.theme,
});
