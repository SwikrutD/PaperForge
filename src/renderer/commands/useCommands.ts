import { useContext } from 'react';
import { CommandApiContext, type CommandApi } from './commandApiContext';

/** Access to the command registry from any shell component. */
export function useCommands(): CommandApi {
  const api = useContext(CommandApiContext);
  if (api === null) {
    throw new Error('PaperForge: useCommands must be used inside a CommandProvider.');
  }
  return api;
}
