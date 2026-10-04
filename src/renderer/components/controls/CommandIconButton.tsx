import type { ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useCommands } from '../../commands/useCommands';
import { IconButton } from './IconButton';

interface CommandIconButtonProps {
  /** The command this button runs, as registered. */
  id: string;
  icon: LucideIcon;
  /** Off for reasons of its own, on top of whatever the command says. */
  disabled?: boolean;
}

/**
 * A toolbar button backed by a command, so a toolbar, the menus, the palette
 * and the keyboard cannot disagree about whether something is possible, or why
 * not. A command that is not registered renders nothing at all.
 */
export function CommandIconButton({
  id,
  icon,
  disabled = false,
}: CommandIconButtonProps): ReactElement | null {
  const { execute, resolve } = useCommands();
  const command = resolve(id);
  if (command === undefined) return null;

  const tooltip =
    command.definition.shortcut === undefined
      ? command.definition.title
      : `${command.definition.title} (${command.definition.shortcut})`;

  return (
    <IconButton
      icon={icon}
      label={command.definition.title}
      tooltip={tooltip}
      disabled={disabled || !command.enabled}
      disabledReason={command.reason}
      // A toggle shows whether it is on, to the eye and to a screen reader.
      pressed={command.definition.isChecked === undefined ? undefined : command.checked}
      onClick={() => execute(id)}
    />
  );
}
