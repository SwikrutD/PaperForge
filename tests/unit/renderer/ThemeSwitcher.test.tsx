// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThemeSwitcher } from '../../../src/renderer/components/controls/ThemeSwitcher';

describe('ThemeSwitcher', () => {
  it('exposes the three appearance choices as a labelled radio group', () => {
    render(<ThemeSwitcher value="system" onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Light' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dark' })).not.toBeChecked();
  });

  it('reports the selected preference', async () => {
    const onChange = vi.fn();
    render(<ThemeSwitcher value="system" onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('disables every option while settings are unavailable', () => {
    render(<ThemeSwitcher value="light" onChange={vi.fn()} disabled />);
    for (const name of ['System', 'Light', 'Dark']) {
      expect(screen.getByRole('radio', { name })).toBeDisabled();
    }
  });
});
