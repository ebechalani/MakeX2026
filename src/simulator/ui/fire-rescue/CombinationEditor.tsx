'use client';

/**
 * Set up a Fire Rescue combination by hand:
 *   - which coloured bucket stands on each water tower W1..W4,
 *   - for each building A..D: the square its person stands in (1 = left, 2 = right; the other
 *     square is then the water square) and the colour of that person.
 *
 * Each colour exists exactly once, so picking a colour swaps it with whoever had it before.
 */
import type { ColorName } from '../../core/types';
import { BUILDINGS, BUILDING_IDS, WATER_TOWER_IDS, type BuildingSlot } from '../../fire-rescue/field';
import { COLORS, withBucket, withPersonColor, withPersonSlot, type FireRescueScenario } from '../../fire-rescue/scenario';

const COLOR_CSS: Record<ColorName, { fill: string; ink: string; letter: string }> = {
  red: { fill: '#ef4044', ink: '#ffffff', letter: 'R' },
  green: { fill: '#40ad49', ink: '#ffffff', letter: 'G' },
  blue: { fill: '#00aeef', ink: '#ffffff', letter: 'B' },
  yellow: { fill: '#ffe600', ink: '#1f2937', letter: 'Y' },
};

interface ColorChipsProps {
  /** what is being coloured, for screen readers: "Bucket on W1" */
  label: string;
  value: ColorName;
  onChange: (color: ColorName) => void;
}

/** Four round colour buttons; the chosen one has a dark ring. Letters make the colours readable without colour vision. */
function ColorChips({ label, value, onChange }: ColorChipsProps) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {COLORS.map((color) => {
        const css = COLOR_CSS[color];
        const selected = color === value;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color}
            title={color}
            onClick={() => onChange(color)}
            style={{ background: css.fill, color: css.ink }}
            className={
              'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 ' +
              (selected ? 'ring-2 ring-slate-900 ring-offset-2' : 'opacity-45 hover:opacity-80')
            }
          >
            {css.letter}
          </button>
        );
      })}
    </div>
  );
}

export interface CombinationEditorProps {
  scenario: FireRescueScenario;
  onChange: (next: FireRescueScenario) => void;
}

export function CombinationEditor({ scenario, onChange }: CombinationEditorProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <fieldset className="rounded-lg border border-slate-200 p-2.5">
        <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500">Buckets on the water towers</legend>
        <ul className="flex flex-col gap-2">
          {WATER_TOWER_IDS.map((tower) => (
            <li key={tower} className="flex items-center justify-between gap-2">
              <span className="w-8 font-mono text-sm font-bold text-slate-800">{tower}</span>
              <ColorChips label={`Bucket on water tower ${tower}`} value={scenario.buckets[tower]} onChange={(color) => onChange(withBucket(scenario, tower, color))} />
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 p-2.5">
        <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500">People at the buildings</legend>
        <ul className="flex flex-col gap-2">
          {BUILDING_IDS.map((building) => {
            const person = scenario.people[building];
            return (
              <li key={building} className="flex items-center justify-between gap-2">
                <span className="w-5 font-mono text-sm font-bold text-slate-800" title={`${BUILDINGS[building].name} - wants the ${BUILDINGS[building].color} bucket`}>
                  {building}
                </span>
                <div
                  role="radiogroup"
                  aria-label={`Square of the person at building ${building}`}
                  className="flex overflow-hidden rounded-md border border-slate-300"
                  title="The square the person stands in. The other square is where the water goes."
                >
                  {([1, 2] as BuildingSlot[]).map((slot) => {
                    const selected = person.slot === slot;
                    return (
                      <button
                        key={slot}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={`Square ${slot} (${slot === 1 ? 'left' : 'right'})`}
                        onClick={() => onChange(withPersonSlot(scenario, building, slot))}
                        className={
                          'h-7 w-7 border-l border-slate-300 text-xs font-bold first:border-l-0 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 ' +
                          (selected ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')
                        }
                      >
                        {slot}
                      </button>
                    );
                  })}
                </div>
                <ColorChips label={`Colour of the person at building ${building}`} value={person.color} onChange={(color) => onChange(withPersonColor(scenario, building, color))} />
              </li>
            );
          })}
        </ul>
      </fieldset>

      <p className="text-xs text-slate-500 sm:col-span-2">
        Square 1 is the left one, square 2 the right one; the person stands in the chosen square and the water goes into the
        other. Every colour exists once, so choosing a colour swaps it with the one that had it.
      </p>
    </div>
  );
}
