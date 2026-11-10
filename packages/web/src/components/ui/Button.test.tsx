import type React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button from './Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('fires onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Press</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  describe('variants', () => {
    it('applies primary variant by default', () => {
      render(<Button>Primary</Button>);
      expect(screen.getByRole('button').className).toContain('bg-accent-aqua');
    });

    it('applies danger variant', () => {
      render(<Button variant="danger">Delete</Button>);
      // Deepened coral so white label text passes WCAG AA (coral=danger only).
      expect(screen.getByRole('button').className).toContain('bg-accent-coral-strong');
    });

    it('applies ghost variant', () => {
      render(<Button variant="ghost">Ghost</Button>);
      expect(screen.getByRole('button').className).toContain('bg-transparent');
      expect(screen.getByRole('button').className).toContain('text-text-secondary');
      expect(screen.getByRole('button').className).not.toContain('border-border-light');
    });

    it('applies secondary variant', () => {
      render(<Button variant="secondary">Secondary</Button>);
      expect(screen.getByRole('button').className).toContain('border-accent-aqua/70');
    });

    it('applies outline variant', () => {
      render(<Button variant="outline">Outline</Button>);
      expect(screen.getByRole('button').className).toContain('bg-transparent');
      expect(screen.getByRole('button').className).toContain('border');
    });
  });

  describe('shared vocabulary', () => {
    const classOf = (variant: React.ComponentProps<typeof Button>['variant']) => {
      const { unmount } = render(<Button variant={variant}>x</Button>);
      const cls = screen.getByRole('button').className;
      unmount();
      return cls;
    };

    it('outline renders the same classes as secondary', () => {
      expect(classOf('outline')).toBe(classOf('secondary'));
    });

    it('util renders the same classes as utility', () => {
      expect(classOf('util')).toBe(classOf('utility'));
    });

    it('is a pill', () => {
      expect(classOf('primary')).toContain('rounded-full');
    });
  });

  describe('sizes', () => {
    it('applies sm size', () => {
      render(<Button size="sm">Small</Button>);
      expect(screen.getByRole('button').className).toContain('px-3');
      expect(screen.getByRole('button').className).toContain('text-sm');
    });

    it('applies md size by default', () => {
      render(<Button>Medium</Button>);
      expect(screen.getByRole('button').className).toContain('px-4');
      expect(screen.getByRole('button').className).toContain('text-base');
    });

    it('applies lg size', () => {
      render(<Button size="lg">Large</Button>);
      expect(screen.getByRole('button').className).toContain('px-5');
      expect(screen.getByRole('button').className).toContain('text-lg');
    });
  });

  describe('loading state', () => {
    it('marks the button aria-disabled and busy, not natively disabled, when loading', () => {
      render(<Button isLoading>Save</Button>);
      const btn = screen.getByRole('button');
      expect(btn).toHaveAttribute('aria-disabled', 'true');
      expect(btn).toHaveAttribute('aria-busy', 'true');
      expect(btn).not.toBeDisabled();
    });

    it('stays focusable when loading', async () => {
      const user = userEvent.setup();
      render(<Button isLoading>Save</Button>);
      await user.tab();
      expect(screen.getByRole('button')).toHaveFocus();
    });

    it('does not fire onClick when loading', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(
        <Button isLoading onClick={onClick}>
          Save
        </Button>,
      );
      await user.click(screen.getByRole('button'));
      screen.getByRole('button').focus();
      await user.keyboard('{Enter}');
      await user.keyboard(' ');
      expect(onClick).not.toHaveBeenCalled();
    });

    it('does not submit the form when loading', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
      render(
        <form onSubmit={onSubmit}>
          <Button type="submit" isLoading>
            Save
          </Button>
        </form>,
      );
      await user.click(screen.getByRole('button'));
      screen.getByRole('button').focus();
      await user.keyboard('{Enter}');
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('submits the form when not loading', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
      render(
        <form onSubmit={onSubmit}>
          <Button type="submit">Save</Button>
        </form>,
      );
      await user.click(screen.getByRole('button'));
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('keeps native disabled when both disabled and loading', () => {
      render(
        <Button disabled isLoading>
          Save
        </Button>,
      );
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('shows spinner icon when loading', () => {
      const { container } = render(<Button isLoading>Save</Button>);
      expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('still shows children text when loading', () => {
      render(<Button isLoading>Save</Button>);
      expect(screen.getByText('Save')).toBeInTheDocument();
    });
  });

  describe('disabled state', () => {
    it('disables button when disabled prop is true', () => {
      render(<Button disabled>Disabled</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('does not fire onClick when disabled', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(
        <Button disabled onClick={onClick}>
          Disabled
        </Button>,
      );
      await user.click(screen.getByRole('button'));
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  it('applies fullWidth class', () => {
    render(<Button fullWidth>Full</Button>);
    expect(screen.getByRole('button').className).toContain('w-full');
  });

  it('does not apply w-full by default', () => {
    render(<Button>Normal</Button>);
    expect(screen.getByRole('button').className).not.toContain('w-full');
  });

  it('applies custom className', () => {
    render(<Button className="extra">btn</Button>);
    expect(screen.getByRole('button').className).toContain('extra');
  });

  it('passes through HTML button attributes', () => {
    render(
      <Button type="submit" name="submit-btn">
        Submit
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('type', 'submit');
    expect(btn).toHaveAttribute('name', 'submit-btn');
  });
});
