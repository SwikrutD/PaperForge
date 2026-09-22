import { createContext } from 'react';
import type { CommandRegistry } from './registry';
import type { CommandContext, ResolvedCommand } from './types';

export interface CommandApi {
  registry: CommandRegistry;
  /** Null until settings have loaded; every command is disabled until then. */
  context: CommandContext | null;
  execute: (id: string) => void;
  resolve: (id: string) => ResolvedCommand | undefined;
  resolveAll: () => ResolvedCommand[];
}

export const CommandApiContext = createContext<CommandApi | null>(null);
