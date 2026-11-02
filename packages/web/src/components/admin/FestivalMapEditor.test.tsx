import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const get = vi.fn();
const put = vi.fn();
const uploadSiteplanImage = vi.fn();
const CLICK = { latitude: 28.6, longitude: -81.4 };

vi.mock('@festie/shared/services/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) },
}));
vi.mock('@festie/shared/services', () => ({
  uploadSiteplanImage: (...a: unknown[]) => uploadSiteplanImage(...a),
}));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }) }));
vi.mock('../crew/CrewMap', () => ({
  default: ({ onMapClick }: { onMapClick?: (c: { latitude: number; longitude: number }) => void }) => (
    <button type="button" onClick={() => onMapClick?.(CLICK)}>
      stub map
    </button>
  ),
}));

import FestivalMapEditor from './FestivalMapEditor';

const water = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-81.3, 28.5] },
  properties: { id: 'am1', amenityType: 'water', label: 'Water' },
};

function festival(overrides: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    name: 'Fest',
    location: 'Orlando',
    updatedAt: '2026-11-01T00:00:00Z',
    latitude: null,
    longitude: null,
    stages: [{ id: 'st1', name: 'Main', color: '#fff', latitude: null, longitude: null }],
    mapConfig: { version: 1, amenities: { type: 'FeatureCollection', features: [water] } },
    ...overrides,
  };
}

async function renderEditor(props: Partial<React.ComponentProps<typeof FestivalMapEditor>> = {}) {
  render(<FestivalMapEditor festivalId="f1" onClose={() => {}} {...props} />);
  await screen.findByText('Venue');
}

type SavedPayload = {
  latitude?: number;
  longitude?: number;
  mapConfig: {
    amenities: { features: Array<{ geometry: { coordinates: number[] }; properties: { label: string } }> };
  };
};

function savedPayload() {
  return put.mock.calls[0]![1] as SavedPayload;
}

describe('FestivalMapEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue(festival());
    put.mockResolvedValue(undefined);
  });

  it('sends a pasted venue on save', async () => {
    await renderEditor();
    fireEvent.change(screen.getByLabelText('Venue coordinates'), { target: { value: '28.53834, -81.37923' } });
    fireEvent.click(screen.getByText('Use'));
    expect(screen.getByText('The map and weather use 28.53834, -81.37923.')).toBeTruthy();
    fireEvent.click(screen.getByText('Save map'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(savedPayload().latitude).toBe(28.53834);
    expect(savedPayload().longitude).toBe(-81.37923);
  });

  it('shows the paste error for text that is not coordinates', async () => {
    await renderEditor();
    fireEvent.change(screen.getByLabelText('Venue coordinates'), { target: { value: 'Orlando' } });
    fireEvent.click(screen.getByText('Use'));
    expect(screen.getByText('Use latitude, longitude. For example: 28.53834, -81.37923')).toBeTruthy();
  });

  it('a save without a venue change sends neither key', async () => {
    await renderEditor();
    fireEvent.click(screen.getByText('Save map'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect('latitude' in savedPayload()).toBe(false);
    expect('longitude' in savedPayload()).toBe(false);
  });

  it('commits an amenity rename on blur', async () => {
    await renderEditor();
    const input = screen.getByLabelText('Name of Water');
    fireEvent.change(input, { target: { value: 'North water' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByText('Save map'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(savedPayload().mapConfig.amenities.features[0].properties.label).toBe('North water');
  });

  it('moves an amenity to the clicked point and keeps its name', async () => {
    await renderEditor();
    fireEvent.click(screen.getByText('Move'));
    expect(screen.getByText('Click the map where Water should go')).toBeTruthy();
    fireEvent.click(await screen.findByText('stub map'));
    fireEvent.click(screen.getByText('Save map'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const moved = savedPayload().mapConfig.amenities.features[0];
    expect(moved.geometry.coordinates).toEqual([CLICK.longitude, CLICK.latitude]);
    expect(moved.properties.label).toBe('Water');
  });

  it('refuses a site-plan image over 10 MB without uploading', async () => {
    await renderEditor();
    const file = new File(['x'], 'plan.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText('Site-plan image file'), { target: { files: [file] } });
    expect(await screen.findByText('The image must be 10 MB or smaller.')).toBeTruthy();
    expect(uploadSiteplanImage).not.toHaveBeenCalled();
  });

  it('Add stages calls onEditFestival straight away when nothing changed', async () => {
    get.mockResolvedValue(festival({ stages: [] }));
    const onEditFestival = vi.fn();
    await renderEditor({ onEditFestival });
    expect(screen.getByText('This festival has no stages yet.')).toBeTruthy();
    fireEvent.click(screen.getByText('Add stages'));
    expect(onEditFestival).toHaveBeenCalledTimes(1);
  });

  it('Add stages asks first when the map has unsaved changes', async () => {
    get.mockResolvedValue(festival({ stages: [] }));
    const onEditFestival = vi.fn();
    await renderEditor({ onEditFestival });
    fireEvent.change(screen.getByLabelText('Venue coordinates'), { target: { value: '28.5, -81.3' } });
    fireEvent.click(screen.getByText('Use'));
    fireEvent.click(screen.getByText('Add stages'));
    expect(onEditFestival).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText('Leave without saving'));
    await waitFor(() => expect(onEditFestival).toHaveBeenCalledTimes(1));
  });

  it('hides Add stages without onEditFestival', async () => {
    get.mockResolvedValue(festival({ stages: [] }));
    await renderEditor();
    expect(screen.queryByText('Add stages')).toBeNull();
  });
});
