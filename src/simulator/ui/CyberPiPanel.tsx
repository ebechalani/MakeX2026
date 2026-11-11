'use client';

/**
 * The CyberPi (the mBot2's brain) as the student sees it on the real robot: the small screen with
 * printed lines and labels, the strip of five LEDs, buttons A and B and the joystick.
 * Pressing a button here presses it on the simulated robot, for as long as it is held down.
 */
import { useState, type ReactNode } from 'react';
import type { ButtonName, RGB, ScreenLabel } from '../core/types';
import { rgbCss, wrapScreenLines } from './format';
import { SoundIcon } from './icons';
import { toggleClass } from './widgets';

/** The real screen is 128 x 128 pixels; it is drawn a little larger here. */
const SCREEN_PIXELS = 128;
const SCREEN_ZOOM = 1.25;
/** Height of one printed line, in screen pixels. */
const LINE_HEIGHT = 16;
/** Characters that fit on one line of the screen; longer lines continue on the next row. */
const SCREEN_COLUMNS = 18;

interface HoldButtonProps {
  name: ButtonName;
  label: string;
  onButton: (name: ButtonName, down: boolean) => void;
  className: string;
  children: ReactNode;
}

/** A button that reports "down" while it is held and "up" when it is let go (mouse, touch or keyboard). */
export function HoldButton({ name, label, onButton, className, children }: HoldButtonProps) {
  const [down, setDown] = useState(false);
  const press = (next: boolean) => {
    if (next === down) return;
    setDown(next);
    onButton(name, next);
  };
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={down}
      title={label}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        press(true);
      }}
      onPointerUp={() => press(false)}
      onPointerCancel={() => press(false)}
      onLostPointerCapture={() => press(false)}
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          press(true);
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') press(false);
      }}
      onBlur={() => press(false)}
      className={
        `${className} select-none touch-none font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-800 ` +
        (down ? 'translate-y-px bg-sky-400 text-slate-900' : 'bg-slate-600 text-white hover:bg-slate-500')
      }
    >
      {children}
    </button>
  );
}

export interface CyberPiPanelProps {
  lines: string[];
  labels: ScreenLabel[];
  leds: RGB[];
  onButton: (name: ButtonName, down: boolean) => void;
  soundOn: boolean;
  onSound: (on: boolean) => void;
}

export function CyberPiPanel({ lines, labels, leds, onButton, soundOn, onSound }: CyberPiPanelProps) {
  // like the real screen: long lines wrap, and when the screen is full the oldest rows scroll away
  const visibleLines = wrapScreenLines(lines, SCREEN_COLUMNS).slice(-Math.floor(SCREEN_PIXELS / LINE_HEIGHT));
  const size = SCREEN_PIXELS * SCREEN_ZOOM;
  const arrow = 'flex h-9 w-9 items-center justify-center rounded-md text-sm';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-center gap-4 rounded-xl bg-slate-800 p-3">
        {/* joystick */}
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Joystick">
          <span />
          <HoldButton name="up" label="Joystick up" onButton={onButton} className={arrow}>
            ▲
          </HoldButton>
          <span />
          <HoldButton name="left" label="Joystick left" onButton={onButton} className={arrow}>
            ◀
          </HoldButton>
          <HoldButton name="middle" label="Joystick pressed in the middle" onButton={onButton} className={arrow}>
            ●
          </HoldButton>
          <HoldButton name="right" label="Joystick right" onButton={onButton} className={arrow}>
            ▶
          </HoldButton>
          <span />
          <HoldButton name="down" label="Joystick down" onButton={onButton} className={arrow}>
            ▼
          </HoldButton>
          <span />
        </div>

        {/* screen and LED strip */}
        <div className="flex flex-col items-center gap-2">
          <div
            className="relative overflow-hidden rounded-md bg-black font-mono text-white ring-2 ring-slate-600"
            style={{ width: size, height: size }}
            role="log"
            aria-label="CyberPi screen"
          >
            <div className="absolute inset-x-0 top-0 px-1" style={{ fontSize: 11 * SCREEN_ZOOM, lineHeight: `${LINE_HEIGHT * SCREEN_ZOOM}px` }}>
              {visibleLines.map((line, i) => (
                <div key={i} className="overflow-hidden whitespace-pre">
                  {line === '' ? ' ' : line}
                </div>
              ))}
            </div>
            {labels.map((label, i) => (
              <span
                key={i}
                className="absolute whitespace-pre leading-none text-sky-200"
                style={{
                  left: label.x * SCREEN_ZOOM,
                  top: label.y * SCREEN_ZOOM,
                  fontSize: Math.max(6, Math.min(64, label.size)) * SCREEN_ZOOM,
                }}
              >
                {label.text}
              </span>
            ))}
            {lines.length === 0 && labels.length === 0 && (
              <span className="absolute inset-0 flex items-center justify-center px-3 text-center font-sans text-xs text-slate-500">
                Use a &quot;print&quot; block to write here
              </span>
            )}
          </div>
          <div className="flex gap-1.5" role="img" aria-label="The five LEDs of the CyberPi">
            {[0, 1, 2, 3, 4].map((i) => {
              const led = leds[i] ?? { r: 0, g: 0, b: 0 };
              const lit = led.r + led.g + led.b > 24;
              return (
                <span
                  key={i}
                  className="h-3 w-6 rounded-full ring-1 ring-slate-600"
                  style={{ background: lit ? rgbCss(led) : '#1e293b', boxShadow: lit ? `0 0 10px 2px ${rgbCss(led)}` : 'none' }}
                />
              );
            })}
          </div>
        </div>

        {/* buttons A and B */}
        <div className="flex flex-col gap-2" role="group" aria-label="Buttons">
          <HoldButton name="a" label="Button A" onButton={onButton} className="h-11 w-11 rounded-full text-base">
            A
          </HoldButton>
          <HoldButton name="b" label="Button B" onButton={onButton} className="h-11 w-11 rounded-full text-base">
            B
          </HoldButton>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Hold a button down to press it on the robot.</p>
        <button type="button" aria-pressed={soundOn} onClick={() => onSound(!soundOn)} className={toggleClass(soundOn)}>
          <SoundIcon className="h-4 w-4" on={soundOn} />
          Sound {soundOn ? 'on' : 'off'}
        </button>
      </div>
    </div>
  );
}
