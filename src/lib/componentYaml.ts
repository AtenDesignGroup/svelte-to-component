import fs, { PathLike } from 'fs';
import { Pair, parse, stringify } from 'yaml';
import {
  ProcessFilesOptions,
  ComponentDefinition
} from '../types';

/**
 * Looks for a component.yml file in the same directory as the component file and loads it if it exists.
 *
 * @param filePath Pathlike
 *   The path to the component file
 * @param options ProcessFilesOptions
 *   The options for processing the files
 * @returns ComponentDefinition
 *  The component definition object as found in the component.yml file
 */
export function loadComponentDef(filePath: PathLike, options: ProcessFilesOptions) : ComponentDefinition {
  let componentDef = {};

  const componentDefPath = filePath.toString().replace('.svelte', '.component.yml');
  if (fs.existsSync(componentDefPath)) {
    const content = fs.readFileSync(componentDefPath, 'utf8');
    console.log('component.yml found', content);
    componentDef = parse(content);
  }

  return componentDef;
};

/**
 * Sorts the keys in the component.yml file.
 *
 * @param a
 *   The first pair to compare
 * @param b
 *   The second pair to compare
 * @returns number
 */
function sortComponentKeys(a: Pair, b: Pair) {
  const order = [
    '$schema',
    'name',
    'description',
    'group',
    'status',
    'props',
    'slots',
    'libraryOverrides',
    'thirdPartySettings'
  ];
  return order.indexOf(a.key.toString()) - order.indexOf(b.key.toString());
}

/**
 * Stringify the yaml object with sorted keys.
 *
 * @param yml object
 *   The yaml object to stringify
 * @returns
 *   The stringified yaml
 */
export function stringifyYaml(yml) {
  return stringify(yml, { sortMapEntries: sortComponentKeys });
};