import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FestivalEditForm from './FestivalEditForm';

describe('FestivalEditForm B2B separator', () => {
  it('rejoins every B2B set when the separator changes', () => {
    const setFormData = vi.fn();
    const artists = [
      { name: 'Kai', links: { spotify: 'https://s/kai' } },
      { name: 'Mira', links: {} },
    ];
    const formData = {
      name: 'Fest',
      b2bSeparator: 'b2b',
      days: [
        {
          id: 'd1',
          label: 'Friday',
          date: '2026-08-21',
          sets: [
            { id: 's1', artist: 'Kai b2b Mira', artists },
            { id: 's2', artist: 'Solo' },
          ],
        },
      ],
    };
    render(
      <FestivalEditForm
        formData={formData}
        setFormData={setFormData}
        editingId="f1"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('B2B separator'), { target: { value: 'vs' } });
    const next = setFormData.mock.calls.at(-1)![0];
    expect(next.b2bSeparator).toBe('vs');
    expect(next.days[0].sets[0]).toMatchObject({ artist: 'Kai vs Mira', artists });
    expect(next.days[0].sets[1]).toEqual({ id: 's2', artist: 'Solo' });
  });
});
