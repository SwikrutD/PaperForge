import { createContext } from 'react';
import type { CommandRegistry } from './registry';
import type { CommandContext, ResolvedCommand } from './types';

export interface CommandApi {
  registry: CommandRegistry;
  /** Null until settings have loaded; every command is disabled until then. */
  context: CommandContext | null;
  execute: (id: string) => void;
  /**
   * Runs a command and resolves once it has finished — for a caller that has
   * to know, such as a tool that opens a document before it starts. Failures
   * are reported the same way `execute` reports them.
   */
  run: (id: string) => Promise<void>;
  resolve: (id: string) => ResolvedCommand | undefined;
  resolveAll: () => ResolvedCommand[];
}

export const CommandApiContext = createContext<CommandApi | null>(null);
