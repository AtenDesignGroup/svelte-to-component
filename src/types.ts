
export interface ProcessFilesOptions {
  defaultSlotName?: string; // Default slot ID
  glob: string; // Glob pattern for input files
  input: string; // Directory where svelte components are located
  output: string; // Directory where the results are saved
  saveAst: boolean; // Save AST to a JSON file
  saveComponentDef: boolean; // Save component definition to a component.yml file
  saveStyles: boolean; // Save SCSS styles to the src directory
  theme: string; // Theme name used to namespace components
}

export interface ComponentContext {
  name: string;
  component: any;
  components: Record<string, any>;
  props: Record<string, any>;
  setStatements: Record<string, any>;
  slots: Record<string, any>;
  styleSheets: Record<string, any>;
}

export interface ComponentDefinition {
  name?: string;
  description?: string;
  status?: string;
  props?: Record<string, any>;
  slots?: Record<string, any>;
  libraryOverrides?: Record<string, any>;
  thirdPartySettings?: Record<string, any>;
}