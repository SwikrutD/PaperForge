import { AppError } from '@shared/errors/appError';
import type {
  CommandAvailability,
  CommandContext,
  CommandDefinition,
  ResolvedCommand,
} from './types';

/**
 * The single place a command exists.
 *
 * Menus, toolbar buttons, the left rail, the command palette and keyboard
 * shortcuts all resolve through this registry, so a command has exactly one
 * implementation and exactly one enablement rule. Only commands that really do
 * something are registered — there are no placeholder entries.
 */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  register(definition: CommandDefinition): void {
    if (this.commands.has(definition.id)) {
      throw new Error(`PaperForge: command "${definition.id}" is already registered.`);
    }
    if (definition.shortcut !== undefined) {
      const clash = this.list().find((other) => other.shortcut === definition.shortcut);
      if (clash !== undefined) {
        throw new Error(
          `PaperForge: shortcut "${definition.shortcut}" is claimed by both "${clash.id}" and "${definition.id}".`,
        );
      }
    }
    this.commands.set(definition.id, definition);
  }

  registerAll(definitions: readonly CommandDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  get(id: string): CommandDefinition | undefined {
    return this.commands.get(id);
  }

  /** Registration order, which is also menu order. */
  list(): CommandDefinition[] {
    return [...this.commands.values()];
  }

  listByCategory(category: CommandDefinition['category']): CommandDefinition[] {
    return this.list().filter((definition) => definition.category === category);
  }

  /** Current enabled/checked state of one command. */
  resolve(id: string, context: CommandContext): ResolvedCommand | undefined {
    const definition = this.commands.get(id);
    if (definition === undefined) return undefined;
    const availability = normalizeAvailability(definition.isAvailable?.(context));
    return {
      definition,
      enabled: availability.enabled,
      reason: availability.reason,
      checked: definition.isChecked?.(context) ?? false,
    };
  }

  resolveAll(context: CommandContext): ResolvedCommand[] {
    return this.list().map((definition) => {
      const availability = normalizeAvailability(definition.isAvailable?.(context));
      return {
        definition,
        enabled: availability.enabled,
        reason: availability.reason,
        checked: definition.isChecked?.(context) ?? false,
      };
    });
  }

  /**
   * Runs a command. An unknown or currently unavailable command is refused
   * rather than silently ignored, so callers cannot present a dead control.
   */
  async execute(id: string, context: CommandContext): Promise<void> {
    const resolved = this.resolve(id, context);
    if (resolved === undefined) {
      throw new AppError('internal/unexpected', {
        message: 'That action is not available.',
        details: `Unknown command "${id}".`,
      });
    }
    if (!resolved.enabled) {
      throw new AppError('internal/unexpected', {
        message: resolved.reason ?? 'That action is not available right now.',
        details: `Command "${id}" is disabled.`,
      });
    }
    await resolved.definition.run(context);
  }
}

function normalizeAvailability(
  value: boolean | CommandAvailability | undefined,
): CommandAvailability {
  if (value === undefined) return { enabled: true };
  if (typeof value === 'boolean') return { enabled: value };
  return value;
}
