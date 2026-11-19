// @ts-expect-error -- @types/react-dom is not a mobile dependency; the call below is typed by usage
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UIProvider, useUI } from './UIContext';

function Probe() {
  const ui = useUI();
  return (
    <span>
      {String(ui.sheetOpen)}:{typeof ui.openSheet}:{typeof ui.closeSheet}
    </span>
  );
}

describe('UIContext', () => {
  it('provides a closed sheet and open/close callbacks', () => {
    expect(
      renderToStaticMarkup(
        <UIProvider>
          <Probe />
        </UIProvider>,
      ),
    ).toBe('<span>false:function:function</span>');
  });

  it('throws an actionable error when used outside UIProvider', () => {
    expect(() => renderToStaticMarkup(<Probe />)).toThrow('useUI must be used within a UIProvider');
  });
});
